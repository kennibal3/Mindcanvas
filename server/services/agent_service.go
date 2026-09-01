// =============================================================
// MindCanvas - REQ-062 一期：房间内智能体（头脑风暴伙伴）· 服务层
//
// 职责：读画布内容、取提示词、管会话与消息、写调用日志。
// 不负责 HTTP 与流式输出，那在 handlers/agent_handler.go。
//
// 与既有 AI 功能的关系：本文件不碰 doChat / Chat / Analyze 任何一条既有路径，
// 只调用新增的 AIService.StreamChatEx。理由见 ai_service.go 文件末尾的说明。
// =============================================================
package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"

	"github.com/redis/go-redis/v9"
)

// AgentPromptBrainstorm 头脑风暴系统提示词在 agent_prompts 表里的 key
const AgentPromptBrainstorm = "brainstorm_system"

// agentMaxCanvasChars 一次喂给模型的画布文本上限。
// 超过就截断并明确告诉模型「还有内容没给你」——**不能静默截断**，
// 否则模型会对着半份白板信心十足地下结论，而没人知道它只看了一半。
const agentMaxCanvasChars = 12000

// agentHistoryTurns 带入上下文的历史轮数（一问一答算两条）
const agentHistoryTurns = 12

// AgentService 智能体服务
type AgentService struct {
	db  *sql.DB
	rdb *redis.Client
	ai  *AIService
}

// NewAgentService 构造（rdb 可选，与 NewExportService 同风格）
func NewAgentService(db *sql.DB, ai *AIService, rdb ...*redis.Client) *AgentService {
	svc := &AgentService{db: db, ai: ai}
	if len(rdb) > 0 {
		svc.rdb = rdb[0]
	}
	return svc
}

// IsEnabled 该用户是否被管理员开通了智能体（照抄 chat_handler.checkChatAccess 的口径）
func (s *AgentService) IsEnabled(userID string) bool {
	var on bool
	err := s.db.QueryRow(
		`SELECT COALESCE(agent_enabled, false) FROM users WHERE id = $1 AND is_active = true`,
		userID,
	).Scan(&on)
	return err == nil && on
}

// =============================================================
// 一、读画布
// =============================================================

// CanvasContext 一次对话所依据的画布内容快照
type CanvasContext struct {
	Text         string // 拼好的、给模型看的文本
	ElementCount int    // 存活元素总数（含图形，不只文字）
	Chars        int    // Text 的字符数
	Truncated    bool   // 是否因超上限被截断
	Source       string // redis / db / empty —— 排查时第一个要看的就是这个
}

func agentSceneKey(roomID string) string { return "room:scene:" + roomID }

// loadScene 读房间当前场景。
//
// ⚠️ 这里刻意**没有**复用 ExportService.getSceneElements，尽管那个函数就在隔壁。
// 原因：它是 Redis-only、没有数据库兜底（`if s.rdb == nil { return err }` 之后
// 直接 rdb.Get，拿不到就返回错误）。而 ws_handler 的真实加载顺序是
// 「Redis 命中即用，未命中回 PostgreSQL 兜底」（ws_handler.go:340-361）。
//
// 差别不是理论上的：2026-09-01 全库普查实测**有 9 个房间的 Redis 场景已因 7 天 TTL
// 过期**，它们靠 DB 兜底正常工作。用 Redis-only 的读法，老师打开一个上个月的房间
// 问智能体，会得到一句「白板上还没有内容」——而白板上明明满满当当。
//
// 这类错最难发现，因为它不报错、不崩溃，只是安静地答错。
// 8-11 事故的第一条教训就是这个：**先确认「我查的数据源，是不是用户前端实际读的那一份」**。
func (s *AgentService) loadScene(roomID string) (map[string]interface{}, string, error) {
	if s.rdb != nil {
		if raw, err := s.rdb.Get(context.Background(), agentSceneKey(roomID)).Result(); err == nil && len(raw) > 10 {
			var scene map[string]interface{}
			if json.Unmarshal([]byte(raw), &scene) == nil {
				return scene, "redis", nil
			}
		}
	}
	var raw []byte
	err := s.db.QueryRow(`
		SELECT scene_data FROM room_scenes
		WHERE room_id = $1 AND data_size > 10
		ORDER BY updated_at DESC LIMIT 1
	`, roomID).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, "empty", nil
	}
	if err != nil {
		return nil, "", err
	}
	var scene map[string]interface{}
	if err := json.Unmarshal(raw, &scene); err != nil {
		return nil, "", err
	}
	return scene, "db", nil
}

// canvasTextItem 一条画布文字及其位置
type canvasTextItem struct {
	x, y float64
	text string
}

func floatOf(m map[string]interface{}, key string) float64 {
	if v, ok := m[key].(float64); ok {
		return v
	}
	return 0
}

// BuildCanvasContext 把房间当前画布整理成给模型看的一段文本。
//
// 两个刻意的设计：
//  1. **按位置排序，不按数组顺序。** 白板的意思有一半在布局里——数组顺序是
//     「谁先被画出来」，与阅读顺序无关。按「从上到下、从左到右」排一遍，
//     模型才有机会看出哪几条属于同一组。（分行容差 60px，同一横排的算一行。）
//  2. **互动组件单独列一段。** 投票题目、问答题目、词云提示语都是画布上的内容，
//     但它们不在场景 JSON 里、而在 room_elements 表（widget_service.go:113），
//     只读场景会整段漏掉。
func (s *AgentService) BuildCanvasContext(roomID string) CanvasContext {
	out := CanvasContext{Source: "empty"}

	scene, src, err := s.loadScene(roomID)
	out.Source = src
	if err != nil {
		log.Printf("[智能体] 读取场景失败 room:%s err:%v", roomID, err)
	}

	var items []canvasTextItem
	if scene != nil {
		els, _ := scene["elements"].([]interface{})
		for _, e := range els {
			m, ok := e.(map[string]interface{})
			if !ok {
				continue
			}
			if deleted, _ := m["isDeleted"].(bool); deleted {
				continue
			}
			out.ElementCount++

			txt := ""
			if t, ok := m["text"].(string); ok {
				txt = strings.TrimSpace(t)
			}
			if txt == "" {
				if p, ok := m["payload"].(map[string]interface{}); ok {
					if c, ok := p["content"].(string); ok {
						txt = strings.TrimSpace(c)
					}
				}
			}
			if txt == "" {
				continue
			}
			items = append(items, canvasTextItem{x: floatOf(m, "x"), y: floatOf(m, "y"), text: txt})
		}
	}

	// 从上到下、从左到右。同一横排（y 相差 60px 以内）按 x 排。
	sort.SliceStable(items, func(i, j int) bool {
		ri := int(items[i].y / 60)
		rj := int(items[j].y / 60)
		if ri != rj {
			return ri < rj
		}
		return items[i].x < items[j].x
	})

	var sb strings.Builder
	if len(items) > 0 {
		sb.WriteString("【白板上的文字】（按从上到下、从左到右的阅读顺序）\n")
		for i, it := range items {
			sb.WriteString(fmt.Sprintf("%d. %s\n", i+1, strings.ReplaceAll(it.text, "\n", " ")))
		}
	}

	if widgets := s.buildWidgetLines(roomID); widgets != "" {
		if sb.Len() > 0 {
			sb.WriteString("\n")
		}
		sb.WriteString("【白板上的互动组件】\n")
		sb.WriteString(widgets)
	}

	text := sb.String()
	if text == "" {
		text = "（这块白板目前还没有任何文字内容。）"
	}

	runes := []rune(text)
	if len(runes) > agentMaxCanvasChars {
		text = string(runes[:agentMaxCanvasChars]) +
			"\n\n（⚠️ 白板内容较多，以上只是前一部分，后面还有内容没有给你。" +
			"回答时如果涉及可能没看到的部分，必须明确说明你只看到了一部分。）"
		out.Truncated = true
	}

	out.Text = text
	out.Chars = len([]rune(text))
	return out
}

// buildWidgetLines 读 room_elements 里的互动组件，整理成几行人话。
// payload 是双层结构 {x,y,width,height,payload:{业务字段}}（widget_service.go:39），
// 业务字段在内层——**外层那一层前端根本不读**，这正是 BUG-005 那一轮的病灶，别再踩。
func (s *AgentService) buildWidgetLines(roomID string) string {
	rows, err := s.db.Query(
		`SELECT type, payload FROM room_elements WHERE room_id = $1 AND is_deleted = FALSE`,
		roomID,
	)
	if err != nil {
		log.Printf("[智能体] 读取组件失败 room:%s err:%v", roomID, err)
		return ""
	}
	defer rows.Close()

	var sb strings.Builder
	for rows.Next() {
		var elemType string
		var raw json.RawMessage
		if err := rows.Scan(&elemType, &raw); err != nil {
			continue
		}
		var outer map[string]interface{}
		if json.Unmarshal(raw, &outer) != nil {
			continue
		}
		inner, ok := outer["payload"].(map[string]interface{})
		if !ok {
			inner = outer // 兼容早期未双层包裹的存量数据
		}
		pick := func(keys ...string) string {
			for _, k := range keys {
				if v, ok := inner[k].(string); ok && strings.TrimSpace(v) != "" {
					return strings.TrimSpace(v)
				}
			}
			return ""
		}
		label := pick("question", "prompt", "title", "content")
		if label == "" {
			continue
		}
		var name string
		switch elemType {
		case "poll":
			name = "投票"
		case "qa":
			name = "问答"
		case "wordcloud":
			name = "词云"
		case "dropzone":
			name = "作品收集"
		case "html_widget":
			name = "HTML 课件"
		case "text_card":
			name = "文本卡片"
		default:
			name = elemType
		}
		sb.WriteString(fmt.Sprintf("- %s：%s\n", name, strings.ReplaceAll(label, "\n", " ")))
	}
	return sb.String()
}

// =============================================================
// 二、提示词（L3：从库里读，改一个字不用发版）
// =============================================================

// agentBrainstormFallback 兜底提示词。
// 存在的理由：迁移 025 未执行、或有人误把所有版本都置为 inactive 时，
// 功能应该降级而不是罢工。**降级要留日志**，否则"为什么它今天变笨了"没人查得到。
const agentBrainstormFallback = `你是一位陪老师在电子白板上一起备课、一起想问题的搭档。
你能看到白板上的全部文字内容。你提到的每一个概念、每一个数字，都必须在白板内容里能找到出处；
白板上没有的东西，可以建议加进去，但不能说得像它已经在上面。宁可说少，不要编。
面对的是中小学老师，说人话，一次说一件事，三五句话就够。`

// ActivePrompt 取当前生效的提示词
func (s *AgentService) ActivePrompt(key string) string {
	var content string
	err := s.db.QueryRow(
		`SELECT content FROM agent_prompts
		 WHERE prompt_key = $1 AND is_active = true
		 ORDER BY version DESC LIMIT 1`, key,
	).Scan(&content)
	if err != nil || strings.TrimSpace(content) == "" {
		log.Printf("[智能体] 提示词 %s 未取到（err:%v），降级使用内置兜底版本", key, err)
		return agentBrainstormFallback
	}
	return content
}

// =============================================================
// 三、会话与消息
// =============================================================

// EnsureConversation 取一条会话；convID 为空则新建。
// **归属校验直接进 SQL 的 WHERE**（BUG-015 的教训：只在 Go 里比对变量，
// 看着像鉴权，实际没进查询条件，等于没校验）。
func (s *AgentService) EnsureConversation(convID, roomID, userID, scope string, isTest bool) (string, error) {
	if convID != "" {
		var got string
		err := s.db.QueryRow(
			`SELECT id FROM agent_conversations
			 WHERE id = $1 AND room_id = $2 AND user_id = $3`,
			convID, roomID, userID,
		).Scan(&got)
		if err == nil {
			return got, nil
		}
		if err != sql.ErrNoRows {
			return "", err
		}
		// 不存在或不属于此人：不报错、直接开一条新的。
		// 「不存在」与「越权」故意同样处理，不给探测者区分信号（同 BUG-015 的口径）。
	}
	var newID string
	err := s.db.QueryRow(
		`INSERT INTO agent_conversations (room_id, user_id, scope, is_test)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		roomID, userID, scope, isTest,
	).Scan(&newID)
	return newID, err
}

// History 取最近若干条消息，按时间正序返回，供拼多轮上下文。
func (s *AgentService) History(convID string, limit int) []AIMessage {
	if limit <= 0 {
		limit = agentHistoryTurns
	}
	rows, err := s.db.Query(
		`SELECT role, content FROM (
			SELECT role, content, created_at FROM agent_messages
			WHERE conversation_id = $1 AND content <> ''
			ORDER BY created_at DESC LIMIT $2
		 ) t ORDER BY created_at ASC`,
		convID, limit,
	)
	if err != nil {
		log.Printf("[智能体] 读取历史失败 conv:%s err:%v", convID, err)
		return nil
	}
	defer rows.Close()

	var msgs []AIMessage
	for rows.Next() {
		var role, content string
		if rows.Scan(&role, &content) != nil {
			continue
		}
		msgs = append(msgs, AIMessage{Role: role, Content: content})
	}
	return msgs
}

// SaveUserMessage 落用户这一轮
func (s *AgentService) SaveUserMessage(convID, content string) {
	if _, err := s.db.Exec(
		`INSERT INTO agent_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
		convID, content,
	); err != nil {
		log.Printf("[智能体] 写用户消息失败 conv:%s err:%v", convID, err)
	}
}

// SaveAssistantMessage 落 AI 这一轮 ＋ 全量调用日志（L0 可观测）。
//
// ⚠️ 这里用 context 无关的 db.Exec，**不是** ExecContext(请求 ctx)。
// 现成的 chat_handler_patch.writeChatLog 在 goroutine 里用了请求 context，
// 而请求一结束该 context 就被取消，那次日志写入很可能失败、且只有一行 log.Printf
// 知道——又是一个「有信号没人读」的静默丢弃点。日志本身不该跟着请求生命周期走。
func (s *AgentService) SaveAssistantMessage(convID string, res AIStreamResult, latencyMs int64, cc CanvasContext, hadImage bool, errMsg string) {
	_, err := s.db.Exec(`
		INSERT INTO agent_messages
			(conversation_id, role, content, model,
			 prompt_tokens, completion_tokens, total_tokens, latency_ms,
			 finish_reason, truncated, canvas_elements, canvas_chars, had_image, error)
		VALUES ($1,'assistant',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		convID, res.Content, res.Model,
		res.Usage.PromptTokens, res.Usage.CompletionTokens, res.Usage.TotalTokens, latencyMs,
		res.FinishReason, res.Truncated, cc.ElementCount, cc.Chars, hadImage, errMsg,
	)
	if err != nil {
		log.Printf("[智能体] 写 AI 消息失败 conv:%s err:%v", convID, err)
	}
	if _, err := s.db.Exec(
		`UPDATE agent_conversations SET updated_at = NOW() WHERE id = $1`, convID,
	); err != nil {
		log.Printf("[智能体] 更新会话时间失败 conv:%s err:%v", convID, err)
	}
}

// LatestConversation 取该用户在该房间最近的一条会话（用于刷新页面后恢复对话）。
// 归属条件同样进 WHERE，不在 Go 里事后比对。
func (s *AgentService) LatestConversation(roomID, userID string) string {
	var id string
	err := s.db.QueryRow(
		`SELECT id FROM agent_conversations
		 WHERE room_id = $1 AND user_id = $2
		 ORDER BY updated_at DESC LIMIT 1`,
		roomID, userID,
	).Scan(&id)
	if err != nil {
		return ""
	}
	return id
}

// AgentMessageView 给前端看的一条消息
type AgentMessageView struct {
	Role      string `json:"role"`
	Content   string `json:"content"`
	Truncated bool   `json:"truncated"`
	CreatedAt string `json:"created_at"`
}

// MessagesFor 按时间正序取一条会话的全部消息（供前端恢复对话）
func (s *AgentService) MessagesFor(convID string, limit int) []AgentMessageView {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.Query(
		`SELECT role, content, truncated, to_char(created_at, 'YYYY-MM-DD HH24:MI:SS')
		 FROM agent_messages
		 WHERE conversation_id = $1 AND content <> ''
		 ORDER BY created_at ASC LIMIT $2`,
		convID, limit,
	)
	if err != nil {
		log.Printf("[智能体] 读取消息失败 conv:%s err:%v", convID, err)
		return []AgentMessageView{}
	}
	defer rows.Close()

	// 返回空切片而不是 nil：前端拿到 null 会在 .map 上崩，
	// BUG-011 那一轮白屏就是「后端空切片序列化成 null」引起的。
	out := []AgentMessageView{}
	for rows.Next() {
		var m AgentMessageView
		if rows.Scan(&m.Role, &m.Content, &m.Truncated, &m.CreatedAt) != nil {
			continue
		}
		out = append(out, m)
	}
	return out
}
