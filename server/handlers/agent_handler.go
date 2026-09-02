// =============================================================
// MindCanvas - REQ-062 一期：房间内智能体（头脑风暴伙伴）· 接口层
//
//	POST /api/ai/agent/chat     多轮对话，SSE 流式返回
//	GET  /api/ai/agent/history  恢复上次对话（刷新页面后不丢）
//
// 权限三道：登录 → agent_enabled（管理员逐个开通）→ 房间归属校验。
// =============================================================
package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/middleware"
	"mindcanvas-server/services"
)

// AgentHandler 智能体处理器
type AgentHandler struct {
	agentSvc *services.AgentService
	roomSvc  *services.RoomService
	// 独立的 AIService 实例：智能体用自己的 key 与模型，
	// 与图形生成/讲评分析/提炼/养成对话共用的那个实例互不影响。
	// 装配见 main.go。
	aiSvc *services.AIService
}

// NewAgentHandler 构造
func NewAgentHandler(agentSvc *services.AgentService, roomSvc *services.RoomService, aiSvc *services.AIService) *AgentHandler {
	return &AgentHandler{agentSvc: agentSvc, roomSvc: roomSvc, aiSvc: aiSvc}
}

type agentChatRequest struct {
	RoomID         string `json:"room_id" binding:"required"`
	ConversationID string `json:"conversation_id"`
	Message        string `json:"message" binding:"required"`
	// 验收自测时前端置 true。**从第一天就把测试数据分开**——
	// REQ-050 二期就是卡在「8 条样本回头才发现全是自测」上，
	// 那时已经无法区分，飞轮直接停摆。
	IsTest bool `json:"is_test"`
}

// guard 三道权限校验，通过则返回 userID
func (h *AgentHandler) guard(c *gin.Context, roomID string) (string, bool) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return "", false
	}
	if !h.agentSvc.IsEnabled(userID) {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "尚未开通智能体",
			"message": "这个功能需要管理员为你开通后才能使用",
		})
		return "", false
	}
	if err := h.roomSvc.CheckRoomOwnership(roomID, userID, middleware.GetRole(c), middleware.GetTenantID(c)); err != nil {
		// 「房间不存在」与「无权访问」故意同措辞，不给探测者区分信号（同 BUG-015 口径）
		c.JSON(http.StatusForbidden, gin.H{"error": "无权访问该课堂"})
		return "", false
	}
	return userID, true
}

// Chat 多轮对话（SSE）
// POST /api/ai/agent/chat
func (h *AgentHandler) Chat(c *gin.Context) {
	var req agentChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数缺失：需要 room_id 与 message"})
		return
	}
	msg := strings.TrimSpace(req.Message)
	n := utf8.RuneCountInString(msg)
	if n == 0 || n > 2000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "提问长度应为 1 至 2000 个字符"})
		return
	}
	userID, ok := h.guard(c, req.RoomID)
	if !ok {
		return
	}
	if !h.aiSvc.IsConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "智能体尚未配置",
			"message": "服务器未配置 AGENT_ARK_API_KEY",
		})
		return
	}

	convID, err := h.agentSvc.EnsureConversation(req.ConversationID, req.RoomID, userID, "brainstorm", req.IsTest)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "会话创建失败"})
		return
	}

	// 读画布。**这一步在拼消息之前做，且它的统计要随 meta 事件发给前端**——
	// 「它当时到底看见了什么」是排查"为什么答不出来"时第一个要问的问题，
	// 不能只躺在服务端日志里。
	cc := h.agentSvc.BuildCanvasContext(req.RoomID)

	sys := h.agentSvc.ActivePrompt(services.AgentPromptBrainstorm)
	msgs := []services.AIMessage{{
		Role:    "system",
		// REQ-062 收尾：画布内容含学生互动组件填写的内容，用 WrapUntrustedCanvasText
		// 包一层边界，避免学生借互动组件里的文字冒充给模型的新指令（见 agent_service.go）。
		Content: sys + "\n\n" + services.WrapUntrustedCanvasText("这块白板此刻的全部内容", cc.Text),
	}}
	// REQ-062 Slice-3：History 是「这一轮之前」的记录，空的话说明这是本会话第一轮问答，
	// 用来决定要不要在下面触发一次自动命名
	history := h.agentSvc.History(convID, 0)
	isFirstTurn := len(history) == 0
	msgs = append(msgs, history...)
	msgs = append(msgs, services.AIMessage{Role: "user", Content: msg})

	// ── SSE ──（写法照抄 chat_handler_patch.streamResponse，保持项目内一致）
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	flusher, okFlush := c.Writer.(http.Flusher)
	if !okFlush {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming not supported"})
		return
	}
	sendEvent := func(event string, payload interface{}) {
		data, _ := json.Marshal(payload)
		fmt.Fprintf(c.Writer, "event: %s\n", event)
		fmt.Fprintf(c.Writer, "data: %s\n\n", string(data))
		flusher.Flush()
	}

	sendEvent("meta", gin.H{
		"conversation_id":  convID,
		"canvas_elements":  cc.ElementCount,
		"canvas_chars":     cc.Chars,
		"canvas_source":    cc.Source,
		"canvas_truncated": cc.Truncated,
		"model":            h.aiSvc.Model(),
	})

	h.agentSvc.SaveUserMessage(convID, msg)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
	defer cancel()

	start := time.Now()
	res, err := h.aiSvc.StreamChatEx(ctx, msgs, services.AIStreamOptions{MaxTokens: 2048}, func(chunk string) {
		sendEvent("chunk", gin.H{"content": chunk})
	})
	latencyMs := time.Since(start).Milliseconds()

	if err != nil {
		sendEvent("error", gin.H{"error": "智能体暂时无法回答，请稍后重试"})
		h.agentSvc.SaveAssistantMessage(convID, res, latencyMs, cc, false, err.Error())
		return
	}

	done := gin.H{
		"content":         res.Content,
		"finished":        true,
		"conversation_id": convID,
		"model":           res.Model,
	}
	// REQ-057 的教训：截断必须**如实告知**。
	// 看得见的截断老师会反馈，看不见的只会被归因成「AI 不好使」。
	if res.Truncated {
		done["truncated"] = true
		done["warning"] = "回答较长，结尾可能被截断；可以让我接着往下说"
	}
	sendEvent("done", done)

	h.agentSvc.SaveAssistantMessage(convID, res, latencyMs, cc, false, "")

	// REQ-062 Slice-3：首轮问答落库后台异步生成会话标题；自测数据不占用这次调用
	if isFirstTurn && !req.IsTest {
		h.agentSvc.MaybeNameConversation(convID, msg, res.Content)
	}
}

// Prime 冷启动欢迎卡片：画布摘要 + 建议问题（REQ-062 Slice-3）
// GET /api/ai/agent/prime?room_id=xxx
// 前端只在这个房间还没有任何对话历史时调用一次，不在每次展开面板时重复调用。
func (h *AgentHandler) Prime(c *gin.Context) {
	roomID := c.Query("room_id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数缺失：需要 room_id"})
		return
	}
	_, ok := h.guard(c, roomID)
	if !ok {
		return
	}
	if !h.aiSvc.IsConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "智能体尚未配置",
			"message": "服务器未配置 AGENT_ARK_API_KEY",
		})
		return
	}
	result, err := h.agentSvc.Prime(c.Request.Context(), roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "摘要生成失败，请稍后重试"})
		return
	}
	c.JSON(http.StatusOK, result)
}

// History 恢复上次对话
// GET /api/ai/agent/history?room_id=xxx
func (h *AgentHandler) History(c *gin.Context) {
	roomID := c.Query("room_id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数缺失：需要 room_id"})
		return
	}
	userID, ok := h.guard(c, roomID)
	if !ok {
		return
	}
	convID := h.agentSvc.LatestConversation(roomID, userID)
	if convID == "" {
		c.JSON(http.StatusOK, gin.H{"conversation_id": "", "messages": []services.AgentMessageView{}})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"conversation_id": convID,
		"messages":        h.agentSvc.MessagesFor(convID, 0),
	})
}
