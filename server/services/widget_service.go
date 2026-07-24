// =============================================================
// MindCanvas v4.3 - 互动组件服务
// 修复记录：
//   REQ-003-ROOT: 数据库 payload 双层嵌套结构
//                 room_elements.payload = {x,y,width,height,payload:{status,options,...}}
//                 所有读取组件配置必须读 payload->'payload' 而非顶层
//   REQ-003-FIX1: HandleVote 读嵌套 inner payload；ON CONFLICT 防重复投票
//   REQ-003-FIX2: updateVoteCount 回写嵌套路径 {payload,votes}/{payload,total_voters}
//   REQ-003-FIX3: HandleWordCloud/HandleAnswer 同样读嵌套 inner payload
//   V4.3-STABLE:
//     - extractInnerPayload 增加类型保护：payload.payload 为非 object 时回退平铺格式
//     - updateVoteCount/updateWordCloudFreq/updateAnswerStats 自动检测嵌套/平铺格式
//     - HandleWordCloud 移除无效 ON CONFLICT DO NOTHING（无对应唯一索引）
//     - HandleAnswer 防重通过捕获 unique constraint 错误返回明确提示
// =============================================================
package services

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"mindcanvas-server/models"
)

// WidgetService 互动组件服务
type WidgetService struct {
	db        *sql.DB
	profanity *ProfanityService
}

// NewWidgetService 构造函数
func NewWidgetService(db *sql.DB, profanity *ProfanityService) *WidgetService {
	return &WidgetService{db: db, profanity: profanity}
}

// extractInnerPayload 从双层嵌套的 room_elements.payload 中提取内层业务 payload
//
// 数据库存储格式（嵌套）：
//   {x, y, width, height, payload: {status, options, votes, ...}}
//
// 兼容格式（平铺，历史数据或教师状态切换后写入）：
//   {x, y, width, height, status, options, votes, ...}
//
// 安全保护：
//   - payload.payload 存在且为 JSON object（{ 开头）时，使用内层
//   - payload.payload 为字符串、数组、null 等非 object 时，回退到平铺格式
//   - 内层 JSON 解析失败时，同样回退到平铺格式，不静默失败
func extractInnerPayload(outerBytes []byte) ([]byte, error) {
	var outer map[string]json.RawMessage
	if err := json.Unmarshal(outerBytes, &outer); err != nil {
		return nil, fmt.Errorf("外层 payload 解析失败: %w", err)
	}

	innerRaw, exists := outer["payload"]
	if !exists || len(innerRaw) <= 2 {
		// 无内层 payload 字段，使用平铺格式
		return outerBytes, nil
	}

	// 类型保护：必须是 JSON object（以 { 开头），否则回退
	trimmed := strings.TrimSpace(string(innerRaw))
	if len(trimmed) == 0 || trimmed[0] != '{' {
		log.Printf("[extractInnerPayload] payload.payload 非 object 类型（前缀: %s），使用平铺格式",
			safePrefix(trimmed, 20))
		return outerBytes, nil
	}

	// 验证内层可被解析为 map
	var innerCheck map[string]json.RawMessage
	if err := json.Unmarshal(innerRaw, &innerCheck); err != nil {
		log.Printf("[extractInnerPayload] 内层 payload 解析失败，回退平铺格式: %v", err)
		return outerBytes, nil
	}

	return innerRaw, nil
}

// isNestedPayload 检测给定的外层 payload 字节是否为嵌套格式
// 用于 updateVoteCount / updateWordCloudFreq / updateAnswerStats 选择回写路径
func isNestedPayload(outerBytes []byte) bool {
	var outer map[string]json.RawMessage
	if json.Unmarshal(outerBytes, &outer) != nil {
		return false
	}
	innerRaw, ok := outer["payload"]
	if !ok || len(innerRaw) <= 2 {
		return false
	}
	trimmed := strings.TrimSpace(string(innerRaw))
	return len(trimmed) > 0 && trimmed[0] == '{'
}

// safePrefix 安全截取字符串前 n 个字节，避免 index out of range
func safePrefix(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// =============================================================
// 投票组件
// =============================================================

// HandleVote 处理学生投票提交
func (s *WidgetService) HandleVote(elementID, roomID, studentUUID, studentName string, actionData json.RawMessage) error {
	// 1. 读取外层 payload
	var outerPayloadBytes []byte
	err := s.db.QueryRow(
		"SELECT payload FROM room_elements WHERE id = $1 AND is_deleted = FALSE", elementID,
	).Scan(&outerPayloadBytes)
	if err != nil {
		return fmt.Errorf("投票组件不存在")
	}

	// 2. 提取内层业务 payload（含类型保护）
	innerBytes, err := extractInnerPayload(outerPayloadBytes)
	if err != nil {
		return fmt.Errorf("投票配置解析失败: %w", err)
	}

	var pollPayload struct {
		Status      string   `json:"status"`
		IsOpen      bool     `json:"is_open"`
		Mode        string   `json:"mode"`
		Options     []string `json:"options"`
		AllowChange bool     `json:"allowChange"`
	}
	if err := json.Unmarshal(innerBytes, &pollPayload); err != nil {
		return fmt.Errorf("投票内层配置解析失败: %w", err)
	}

	// 3. 状态判断：优先 status 字段，兼容旧 is_open
	status := pollPayload.Status
	if status == "" {
		if pollPayload.IsOpen {
			status = "open"
		} else {
			status = "draft"
		}
	}
	if status != "open" {
		return fmt.Errorf("投票未开放（当前状态: %s）", status)
	}

	// 4. 校验 options 字段有效性（平铺格式下 options 可能为空导致"无效选项"误报）
	if len(pollPayload.Options) == 0 {
		return fmt.Errorf("投票选项配置异常，请联系教师重新创建")
	}

	// 5. 解析提交数据
	var voteData struct {
		Option  string   `json:"option"`
		Options []string `json:"options"`
	}
	if err := json.Unmarshal(actionData, &voteData); err != nil {
		return fmt.Errorf("投票数据格式错误")
	}

	mode := pollPayload.Mode
	if mode == "" {
		mode = "single"
	}

	if mode == "single" {
		option := voteData.Option
		if option == "" {
			return fmt.Errorf("请选择一个选项")
		}
		if !contains(pollPayload.Options, option) {
			return fmt.Errorf("无效的选项: %s（可用: %v）", option, pollPayload.Options)
		}

		if pollPayload.AllowChange {
			// 允许改票：ON CONFLICT DO UPDATE
			_, err = s.db.Exec(
				`INSERT INTO widget_interactions
				 (element_id, room_id, student_uuid, student_name, widget_type, action_type, action_data)
				 VALUES ($1, $2, $3, $4, 'polling_widget', 'vote', $5)
				 ON CONFLICT (element_id, student_uuid, action_type) WHERE action_type='vote'
				 DO UPDATE SET action_data = EXCLUDED.action_data, updated_at = NOW()`,
				elementID, roomID, studentUUID, studentName, actionData,
			)
		} else {
			// 不允许改票：DO NOTHING，检查 RowsAffected
			var result sql.Result
			result, err = s.db.Exec(
				`INSERT INTO widget_interactions
				 (element_id, room_id, student_uuid, student_name, widget_type, action_type, action_data)
				 VALUES ($1, $2, $3, $4, 'polling_widget', 'vote', $5)
				 ON CONFLICT (element_id, student_uuid, action_type) WHERE action_type='vote' DO NOTHING`,
				elementID, roomID, studentUUID, studentName, actionData,
			)
			if err == nil {
				rows, _ := result.RowsAffected()
				if rows == 0 {
					return fmt.Errorf("您已经投过票了")
				}
			}
		}
		if err != nil {
			return fmt.Errorf("投票写入失败: %w", err)
		}

	} else {
		// 多选：先删除旧记录再批量插入（绕过单条唯一约束）
		options := voteData.Options
		if len(options) == 0 {
			if voteData.Option != "" {
				options = []string{voteData.Option}
			} else {
				return fmt.Errorf("请至少选择一个选项")
			}
		}
		for _, opt := range options {
			if !contains(pollPayload.Options, opt) {
				return fmt.Errorf("无效的选项: %s", opt)
			}
		}
		_, err = s.db.Exec(
			`DELETE FROM widget_interactions
			 WHERE element_id=$1 AND student_uuid=$2 AND action_type='vote'`,
			elementID, studentUUID,
		)
		if err != nil {
			return fmt.Errorf("清除旧投票失败: %w", err)
		}
		for _, opt := range options {
			optData, _ := json.Marshal(map[string]string{"option": opt})
			_, insertErr := s.db.Exec(
				`INSERT INTO widget_interactions
				 (element_id, room_id, student_uuid, student_name, widget_type, action_type, action_data)
				 VALUES ($1, $2, $3, $4, 'polling_widget', 'vote', $5)`,
				elementID, roomID, studentUUID, studentName, optData,
			)
			if insertErr != nil {
				log.Printf("[投票多选] 写入选项失败 opt:%s err:%v", opt, insertErr)
			}
		}
	}

	// 6. 聚合更新
	if err := s.updateVoteCount(elementID, outerPayloadBytes); err != nil {
		log.Printf("[投票] 更新计数失败: %v", err)
	}
	log.Printf("[投票] ✅ 成功 - 组件:%s 学生:%s 模式:%s", elementID, studentUUID, mode)
	return nil
}

// updateVoteCount 聚合投票结果并回写 payload
// 自动检测嵌套/平铺格式，选择正确的 jsonb_set 路径
func (s *WidgetService) updateVoteCount(elementID string, outerBytes []byte) error {
	rows, err := s.db.Query(
		`SELECT action_data->>'option' as opt, COUNT(*) as cnt
		 FROM widget_interactions
		 WHERE element_id = $1 AND action_type = 'vote'
		 GROUP BY action_data->>'option'`,
		elementID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	votes := make(map[string]int)
	for rows.Next() {
		var opt string
		var cnt int
		if err := rows.Scan(&opt, &cnt); err != nil {
			return err
		}
		votes[opt] = cnt
	}

	var uniqueVoters int
	s.db.QueryRow(
		`SELECT COUNT(DISTINCT student_uuid)
		 FROM widget_interactions
		 WHERE element_id = $1 AND action_type = 'vote'`,
		elementID,
	).Scan(&uniqueVoters)

	votesJSON, _ := json.Marshal(votes)
	votersJSON := fmt.Sprintf("%d", uniqueVoters)

	if isNestedPayload(outerBytes) {
		// 嵌套格式：回写到 outer.payload.votes 和 outer.payload.total_voters
		_, err = s.db.Exec(
			`UPDATE room_elements
			 SET payload = jsonb_set(
			       jsonb_set(payload, '{payload,votes}', $1::jsonb, true),
			       '{payload,total_voters}', $2::jsonb, true
			     ),
			     updated_at = NOW()
			 WHERE id = $3`,
			votesJSON, votersJSON, elementID,
		)
	} else {
		// 平铺格式：回写到顶层 votes 和 total_voters
		_, err = s.db.Exec(
			`UPDATE room_elements
			 SET payload = jsonb_set(
			       jsonb_set(payload, '{votes}', $1::jsonb, true),
			       '{total_voters}', $2::jsonb, true
			     ),
			     updated_at = NOW()
			 WHERE id = $3`,
			votesJSON, votersJSON, elementID,
		)
	}
	return err
}

// =============================================================
// 词云组件
// =============================================================

// HandleWordCloud 处理学生词云提交
func (s *WidgetService) HandleWordCloud(elementID, roomID, studentUUID, studentName string, actionData json.RawMessage) error {
	var data struct {
		Word string `json:"word"`
	}
	if err := json.Unmarshal(actionData, &data); err != nil {
		return fmt.Errorf("词云数据格式错误: %w", err)
	}

	word := strings.TrimSpace(data.Word)
	if word == "" {
		return fmt.Errorf("词语不能为空")
	}
	if len([]rune(word)) > 20 {
		return fmt.Errorf("词语不能超过20个字符")
	}
	if s.profanity.Contains(word) {
		return fmt.Errorf("提交内容包含不当用语")
	}

	// 读取外层 payload
	var outerBytes []byte
	if err := s.db.QueryRow(
		"SELECT payload FROM room_elements WHERE id = $1 AND is_deleted = false", elementID,
	).Scan(&outerBytes); err != nil {
		return fmt.Errorf("组件不存在")
	}

	// 提取内层 payload（含类型保护）
	innerBytes, err := extractInnerPayload(outerBytes)
	if err != nil {
		return fmt.Errorf("词云配置解析失败: %w", err)
	}

	var wcPayload struct {
		IsOpen             bool   `json:"is_open"`
		Status             string `json:"status"`
		MaxWordsPerStudent int    `json:"max_words_per_student"`
	}
	if err := json.Unmarshal(innerBytes, &wcPayload); err != nil {
		return fmt.Errorf("词云内层配置解析失败: %w", err)
	}

	// 状态判断：优先 status 字段，兼容旧 is_open
	wcStatus := wcPayload.Status
	if wcStatus == "" {
		if wcPayload.IsOpen {
			wcStatus = "open"
		} else {
			wcStatus = "draft"
		}
	}
	if wcStatus != "open" {
		return fmt.Errorf("词云当前不开放提交（当前状态: %s）", wcStatus)
	}

	// 检查每人提交上限
	maxWords := wcPayload.MaxWordsPerStudent
	if maxWords <= 0 {
		maxWords = 5
	}
	var count int
	s.db.QueryRow(
		`SELECT COUNT(*) FROM widget_interactions
		 WHERE element_id = $1 AND student_uuid = $2 AND action_type = 'add_word'`,
		elementID, studentUUID,
	).Scan(&count)
	if count >= maxWords {
		return fmt.Errorf("已达到最大提交数量(%d个)", maxWords)
	}

	// 写入词云提交记录
	// add_word 无唯一约束（同一学生可提交不同词），直接 INSERT
	updatedData, _ := json.Marshal(map[string]string{"word": word})
	_, err = s.db.Exec(
		`INSERT INTO widget_interactions
		 (element_id, room_id, student_uuid, student_name, widget_type, action_type, action_data)
		 VALUES ($1, $2, $3, $4, 'wordcloud_widget', 'add_word', $5)`,
		elementID, roomID, studentUUID, studentName, updatedData,
	)
	if err != nil {
		return fmt.Errorf("词云写入失败: %w", err)
	}

	if err := s.updateWordCloudFreq(elementID, outerBytes); err != nil {
		log.Printf("[词云] 更新词频失败: %v", err)
	}
	return nil
}

// updateWordCloudFreq 聚合词频并回写 payload
// 自动检测嵌套/平铺格式
func (s *WidgetService) updateWordCloudFreq(elementID string, outerBytes []byte) error {
	rows, err := s.db.Query(
		`SELECT action_data->>'word' as word, COUNT(*) as cnt
		 FROM widget_interactions
		 WHERE element_id = $1 AND action_type = 'add_word'
		 GROUP BY action_data->>'word'`,
		elementID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	words := make(map[string]int)
	for rows.Next() {
		var word string
		var cnt int
		rows.Scan(&word, &cnt)
		words[word] = cnt
	}

	wordsJSON, _ := json.Marshal(words)

	if isNestedPayload(outerBytes) {
		_, err = s.db.Exec(
			`UPDATE room_elements
			 SET payload = jsonb_set(payload, '{payload,words}', $1::jsonb, true),
			     updated_at = NOW()
			 WHERE id = $2`,
			wordsJSON, elementID,
		)
	} else {
		_, err = s.db.Exec(
			`UPDATE room_elements
			 SET payload = jsonb_set(payload, '{words}', $1::jsonb, true),
			     updated_at = NOW()
			 WHERE id = $2`,
			wordsJSON, elementID,
		)
	}
	return err
}

// =============================================================
// 问答组件
// =============================================================

// HandleAnswer 处理学生答题提交
func (s *WidgetService) HandleAnswer(elementID, roomID, studentUUID, studentName string, actionData json.RawMessage) (map[string]interface{}, error) {
	// 读取外层 payload
	var outerBytes []byte
	err := s.db.QueryRow(
		"SELECT payload FROM room_elements WHERE id = $1 AND room_id = $2 AND is_deleted = FALSE",
		elementID, roomID,
	).Scan(&outerBytes)
	if err != nil {
		return nil, fmt.Errorf("问答组件不存在")
	}

	// 提取内层 payload（含类型保护）
	innerBytes, extractErr := extractInnerPayload(outerBytes)
	if extractErr != nil {
		return nil, fmt.Errorf("问答配置解析失败: %w", extractErr)
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(innerBytes, &payload); err != nil {
		return nil, fmt.Errorf("payload 解析失败: %w", err)
	}

	// 状态判断：优先 status 字段，兼容旧 is_open
	status, _ := payload["status"].(string)
	if status == "" {
		if isOpen, _ := payload["is_open"].(bool); isOpen {
			status = "open"
		} else {
			status = "draft"
		}
	}
	if status != "open" {
		return nil, fmt.Errorf("问答题未开放（当前状态: %s）", status)
	}

	var submitData struct {
		ChoiceIdx float64 `json:"choice_idx"`
	}
	if err := json.Unmarshal(actionData, &submitData); err != nil {
		return nil, fmt.Errorf("提交数据格式错误: %w", err)
	}

	choiceIdx := int(submitData.ChoiceIdx)
	optionsRaw, _ := payload["options"].([]interface{})
	if choiceIdx < 0 || choiceIdx >= len(optionsRaw) {
		return nil, fmt.Errorf("选项索引 %d 超出范围", choiceIdx)
	}

	correctIdxFloat, _ := payload["correctIdx"].(float64)
	correctIdx := int(correctIdxFloat)
	isCorrect := choiceIdx == correctIdx

	writeData, _ := json.Marshal(map[string]interface{}{"choice_idx": choiceIdx})
	_, err = s.db.Exec(
		`INSERT INTO widget_interactions
		 (room_id, element_id, student_uuid, student_name, widget_type, action_type, action_data, is_correct)
		 VALUES ($1, $2, $3, $4, 'qa_widget', 'answer', $5, $6)`,
		roomID, elementID, studentUUID, studentName, writeData, isCorrect,
	)
	if err != nil {
		// 捕获唯一约束冲突，返回用户友好提示
		if strings.Contains(err.Error(), "idx_wi_no_duplicate_answer") ||
			strings.Contains(err.Error(), "unique constraint") ||
			strings.Contains(err.Error(), "duplicate key") {
			return nil, fmt.Errorf("已经提交过答案了")
		}
		return nil, fmt.Errorf("答案写入失败: %w", err)
	}

	updatedPayload, err := s.updateAnswerStats(elementID, payload, outerBytes)
	if err != nil {
		log.Printf("[HandleAnswer] updateAnswerStats 失败 element=%s: %v", elementID, err)
		updatedPayload = payload
	}
	return updatedPayload, nil
}

// updateAnswerStats 聚合答题统计并回写 payload
// 自动检测嵌套/平铺格式
func (s *WidgetService) updateAnswerStats(elementID string, innerPayload map[string]interface{}, outerBytes []byte) (map[string]interface{}, error) {
	rows, err := s.db.Query(
		`SELECT action_data->>'choice_idx' AS choice_idx, COUNT(*) AS cnt
		 FROM widget_interactions
		 WHERE element_id = $1 AND action_type = 'answer'
		 GROUP BY action_data->>'choice_idx'`,
		elementID,
	)
	if err != nil {
		return nil, fmt.Errorf("查询答题统计失败: %w", err)
	}
	defer rows.Close()

	stats := make(map[string]interface{})
	for rows.Next() {
		var idxStr string
		var cnt int
		if err := rows.Scan(&idxStr, &cnt); err != nil {
			continue
		}
		stats[idxStr] = cnt
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	innerPayload["stats"] = stats
	innerJSON, err := json.Marshal(innerPayload)
	if err != nil {
		return nil, fmt.Errorf("inner payload 序列化失败: %w", err)
	}

	if isNestedPayload(outerBytes) {
		// 嵌套格式：替换 outer.payload 整体
		_, err = s.db.Exec(
			`UPDATE room_elements
			 SET payload = jsonb_set(payload, '{payload}', $1::jsonb, true),
			     updated_at = NOW()
			 WHERE id = $2`,
			innerJSON, elementID,
		)
	} else {
		// 平铺格式：merge 到顶层
		_, err = s.db.Exec(
			`UPDATE room_elements
			 SET payload = payload || $1::jsonb,
			     updated_at = NOW()
			 WHERE id = $2`,
			innerJSON, elementID,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("更新 payload 失败: %w", err)
	}
	return innerPayload, nil
}

// =============================================================
// DropZone 作品墙组件
// =============================================================

// DropzoneSubmitRequest 学生提交作品请求
type DropzoneSubmitRequest struct {
	StudentUUID string `json:"student_uuid"`
	StudentName string `json:"student_name"`
	GroupID     string `json:"group_id,omitempty"`
	ContentType string `json:"content_type"`
	Content     string `json:"content"`
	Thumbnail   string `json:"thumbnail,omitempty"`
}

// DropzoneActionRequest 教师对单条作品的操作请求
type DropzoneActionRequest struct {
	SubmissionID string   `json:"submission_id"`
	ActionType   string   `json:"action_type"`
	Tags         []string `json:"tags,omitempty"`
}

// HandleDropzoneSubmit 处理学生提交作品
func (s *WidgetService) HandleDropzoneSubmit(
	roomID, elementID string,
	req DropzoneSubmitRequest,
) (updatedPayload map[string]interface{}, submissionID string, err error) {

	var outerBytes []byte
	if err = s.db.QueryRow(
		`SELECT payload FROM room_elements WHERE id = $1 AND room_id = $2 AND is_deleted = FALSE`,
		elementID, roomID,
	).Scan(&outerBytes); err != nil {
		return nil, "", fmt.Errorf("作品收集区不存在")
	}

	// 提取内层 payload（含类型保护）
	innerBytes, extractErr := extractInnerPayload(outerBytes)
	if extractErr != nil {
		return nil, "", fmt.Errorf("payload 解析失败: %w", extractErr)
	}

	var payload map[string]interface{}
	if err = json.Unmarshal(innerBytes, &payload); err != nil {
		return nil, "", fmt.Errorf("inner payload 解析失败: %w", err)
	}

	// 状态判断
	status, _ := payload["status"].(string)
	if status != "open" {
		return nil, "", fmt.Errorf("作品收集区未开放（当前状态: %s）", status)
	}

	// 检查允许的提交类型
	acceptTypesRaw, _ := payload["acceptTypes"].([]interface{})
	if len(acceptTypesRaw) > 0 {
		allowed := false
		for _, t := range acceptTypesRaw {
			if fmt.Sprintf("%v", t) == req.ContentType {
				allowed = true
				break
			}
		}
		if !allowed {
			return nil, "", fmt.Errorf("不支持的内容类型: %s", req.ContentType)
		}
	}

	// 检查每人提交上限
	maxPerStudent := 3
	if v, ok := payload["maxPerStudent"].(float64); ok {
		maxPerStudent = int(v)
	}
	if maxPerStudent > 0 {
		var count int
		s.db.QueryRow(
			`SELECT COUNT(*) FROM widget_interactions
			 WHERE element_id = $1 AND student_uuid = $2 AND action_type = 'submit'`,
			elementID, req.StudentUUID,
		).Scan(&count)
		if count >= maxPerStudent {
			return nil, "", fmt.Errorf("已达到提交上限（%d件）", maxPerStudent)
		}
	}

	// 敏感词过滤
	if req.ContentType == "text" && s.profanity != nil {
		if s.profanity.Contains(req.Content) {
			return nil, "", fmt.Errorf("提交内容包含不当用语")
		}
	}

	actionData, _ := json.Marshal(map[string]interface{}{
		"content_type": req.ContentType,
		"content":      req.Content,
		"thumbnail":    req.Thumbnail,
		"likes":        0,
		"tags":         []string{},
		"pinned":       false,
		"hidden":       false,
	})

	var groupIDVal interface{} = nil
	if req.GroupID != "" {
		groupIDVal = req.GroupID
	}

	if err = s.db.QueryRow(
		`INSERT INTO widget_interactions
		 (room_id, element_id, student_uuid, student_name, group_id,
		  widget_type, action_type, action_data, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, 'dropzone_widget', 'submit', $6, NOW(), NOW())
		 RETURNING id`,
		roomID, elementID, req.StudentUUID, req.StudentName, groupIDVal, actionData,
	).Scan(&submissionID); err != nil {
		return nil, "", fmt.Errorf("作品写入失败: %w", err)
	}

	// 更新 submissionOrder
	submissionOrder := []interface{}{}
	if raw, ok := payload["submissionOrder"].([]interface{}); ok {
		submissionOrder = raw
	}
	submissionOrder = append(submissionOrder, submissionID)
	orderJSON, _ := json.Marshal(submissionOrder)
	patch := fmt.Sprintf(`{"submissionOrder": %s}`, string(orderJSON))

	if isNestedPayload(outerBytes) {
		if _, updateErr := s.db.Exec(
			`UPDATE room_elements
			 SET payload = jsonb_set(payload, '{payload}', (payload->'payload') || $1::jsonb, true),
			     updated_at = NOW()
			 WHERE id = $2`,
			patch, elementID,
		); updateErr != nil {
			log.Printf("[DropZone] 更新嵌套 submissionOrder 失败: %v", updateErr)
		}
	} else {
		if _, updateErr := s.db.Exec(
			`UPDATE room_elements
			 SET payload = payload || $1::jsonb,
			     updated_at = NOW()
			 WHERE id = $2`,
			patch, elementID,
		); updateErr != nil {
			log.Printf("[DropZone] 更新平铺 submissionOrder 失败: %v", updateErr)
		}
	}

	payload["submissionOrder"] = submissionOrder
	log.Printf("[DropZone] 新作品提交 element:%s student:%s type:%s id:%s",
		elementID, req.StudentUUID, req.ContentType, submissionID)
	return payload, submissionID, nil
}

// HandleDropzoneAction 处理教师对单条作品的操作
func (s *WidgetService) HandleDropzoneAction(
	roomID, elementID string,
	req DropzoneActionRequest,
	operatorUUID string,
) (map[string]interface{}, error) {

	validActions := map[string]bool{
		"like": true, "pin": true, "tag": true,
		"hide": true, "delete_submission": true,
	}
	if !validActions[req.ActionType] {
		return nil, fmt.Errorf("不支持的操作类型: %s", req.ActionType)
	}

	var rawActionData []byte
	if err := s.db.QueryRow(
		`SELECT action_data FROM widget_interactions
		 WHERE id = $1 AND element_id = $2 AND action_type = 'submit'`,
		req.SubmissionID, elementID,
	).Scan(&rawActionData); err != nil {
		return nil, fmt.Errorf("作品不存在: %w", err)
	}

	var actionData map[string]interface{}
	if err := json.Unmarshal(rawActionData, &actionData); err != nil {
		return nil, fmt.Errorf("action_data 解析失败: %w", err)
	}

	switch req.ActionType {
	case "like":
		likes, _ := actionData["likes"].(float64)
		actionData["likes"] = int(likes) + 1
	case "pin":
		pinned, _ := actionData["pinned"].(bool)
		actionData["pinned"] = !pinned
	case "tag":
		if req.Tags != nil {
			actionData["tags"] = req.Tags
		}
	case "hide":
		hidden, _ := actionData["hidden"].(bool)
		actionData["hidden"] = !hidden
	case "delete_submission":
		actionData["deleted"] = true
	}

	newData, _ := json.Marshal(actionData)
	if _, err := s.db.Exec(
		`UPDATE widget_interactions SET action_data = $1, updated_at = NOW() WHERE id = $2`,
		newData, req.SubmissionID,
	); err != nil {
		return nil, fmt.Errorf("更新作品失败: %w", err)
	}

	// 删除时同步更新 submissionOrder
	if req.ActionType == "delete_submission" {
		var outerBytes []byte
		if err := s.db.QueryRow(
			`SELECT payload FROM room_elements WHERE id = $1`, elementID,
		).Scan(&outerBytes); err == nil {
			innerBytes, _ := extractInnerPayload(outerBytes)
			var payload map[string]interface{}
			if json.Unmarshal(innerBytes, &payload) == nil {
				if order, ok := payload["submissionOrder"].([]interface{}); ok {
					newOrder := make([]interface{}, 0, len(order))
					for _, id := range order {
						if fmt.Sprintf("%v", id) != req.SubmissionID {
							newOrder = append(newOrder, id)
						}
					}
					orderJSON, _ := json.Marshal(newOrder)
					patch := fmt.Sprintf(`{"submissionOrder": %s}`, string(orderJSON))

					if isNestedPayload(outerBytes) {
						s.db.Exec(
							`UPDATE room_elements
							 SET payload = jsonb_set(payload, '{payload}', (payload->'payload') || $1::jsonb, true),
							     updated_at = NOW()
							 WHERE id = $2`,
							patch, elementID,
						)
					} else {
						s.db.Exec(
							`UPDATE room_elements
							 SET payload = payload || $1::jsonb,
							     updated_at = NOW()
							 WHERE id = $2`,
							patch, elementID,
						)
					}
					payload["submissionOrder"] = newOrder
					return payload, nil
				}
			}
		}
	}

	// 返回当前内层 payload
	var outerBytes []byte
	s.db.QueryRow(`SELECT payload FROM room_elements WHERE id = $1`, elementID).Scan(&outerBytes)
	innerBytes, _ := extractInnerPayload(outerBytes)
	var payload map[string]interface{}
	json.Unmarshal(innerBytes, &payload)
	return payload, nil
}

// GetDropzoneSubmissions 聚合作品列表（REST 接口用）
func (s *WidgetService) GetDropzoneSubmissions(elementID string) ([]map[string]interface{}, error) {
	rows, err := s.db.Query(
		`SELECT id, student_uuid, student_name, group_id, action_data, created_at
		 FROM widget_interactions
		 WHERE element_id = $1 AND action_type = 'submit'
		 ORDER BY created_at ASC`,
		elementID,
	)
	if err != nil {
		return nil, fmt.Errorf("查询作品列表失败: %w", err)
	}
	defer rows.Close()

	var submissions []map[string]interface{}
	for rows.Next() {
		var (
			id          string
			studentUUID string
			studentName string
			groupID     sql.NullString
			rawData     []byte
			createdAt   string
		)
		if err := rows.Scan(&id, &studentUUID, &studentName, &groupID, &rawData, &createdAt); err != nil {
			log.Printf("[DropZone] 扫描行失败: %v", err)
			continue
		}
		var data map[string]interface{}
		if err := json.Unmarshal(rawData, &data); err != nil {
			continue
		}
		if deleted, _ := data["deleted"].(bool); deleted {
			continue
		}
		data["id"] = id
		data["student_uuid"] = studentUUID
		data["student_name"] = studentName
		if groupID.Valid {
			data["group_id"] = groupID.String
		}
		data["submitted_at"] = createdAt
		submissions = append(submissions, data)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return submissions, nil
}

// GetStudentSubmittedElements 返回该学生在本房间内已提交过互动的组件 ID 列表（去重）。
// BUG-008：崩溃/断线重连后，前端 widgetStore（Zustand，无持久化）会丢失"我是否已提交"这一客户端状态，
// 导致投票/问答等组件重新渲染成未提交表单，即使后端数据完全正确。room_sync 时把这份列表带给前端，
// 前端据此重新调用 markSubmitted 补齐状态。
func (s *WidgetService) GetStudentSubmittedElements(roomID, studentUUID string) ([]string, error) {
	if studentUUID == "" {
		return nil, nil
	}
	rows, err := s.db.Query(
		`SELECT DISTINCT element_id FROM widget_interactions
		 WHERE room_id = $1 AND student_uuid = $2`,
		roomID, studentUUID,
	)
	if err != nil {
		return nil, fmt.Errorf("查询学生已提交组件失败: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			log.Printf("[BUG-008] 扫描已提交组件ID失败: %v", err)
			continue
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return ids, nil
}

// GetStudentWordCloudSubmissions BUG-009：返回该学生在本房间内所有词云组件下已提交的具体词语，
// 按 element_id 分组。与 GetStudentSubmittedElements（只返回组件ID的布尔标记场景）不同，
// 词云需要恢复"具体提交过哪些词"这份内容本身，供前端 WordCloudWidget 初始化 myWords。
func (s *WidgetService) GetStudentWordCloudSubmissions(roomID, studentUUID string) (map[string][]string, error) {
	result := make(map[string][]string)
	if studentUUID == "" {
		return result, nil
	}
	rows, err := s.db.Query(
		`SELECT element_id, action_data->>'word' AS word
		 FROM widget_interactions
		 WHERE room_id = $1 AND student_uuid = $2 AND action_type = 'add_word'
		 ORDER BY created_at ASC`,
		roomID, studentUUID,
	)
	if err != nil {
		return nil, fmt.Errorf("查询学生词云提交记录失败: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var elementID, word string
		if err := rows.Scan(&elementID, &word); err != nil {
			log.Printf("[BUG-009] 扫描词云提交记录失败: %v", err)
			continue
		}
		if word == "" {
			continue
		}
		result[elementID] = append(result[elementID], word)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// =============================================================
// 通用元素操作
// =============================================================

// UpdateElementPayload 合并更新元素 payload（JSONB merge，不覆盖其他字段）
func (s *WidgetService) UpdateElementPayload(elementID string, newPayload json.RawMessage) error {
	_, err := s.db.Exec(
		`UPDATE room_elements
		 SET payload = CASE
		     WHEN $1::jsonb ? 'payload' THEN
		         (payload || $1::jsonb) || jsonb_build_object(
		             'payload',
		             COALESCE(payload->'payload', '{}'::jsonb) || ($1::jsonb->'payload')
		         )
		     ELSE
		         payload || $1::jsonb
		     END,
		 updated_at = NOW()
		 WHERE id = $2`,
		newPayload, elementID,
	)
	return err
}

// GetElementType 按元素 ID 查类型（BUG-012：element_update 缺 type 时的兜底反查）
func (s *WidgetService) GetElementType(elementID string) string {
	var t string
	_ = s.db.QueryRow(
		`SELECT type FROM room_elements WHERE id = $1`, elementID,
	).Scan(&t)
	return t
}

// GetElementsByRoom 获取房间内所有未删除元素
func (s *WidgetService) GetElementsByRoom(roomID string) ([]models.Element, error) {
	rows, err := s.db.Query(
		`SELECT id, room_id, creator_uuid, creator_name, type, payload, is_deleted, created_at, updated_at
		 FROM room_elements WHERE room_id = $1 AND is_deleted = FALSE ORDER BY created_at ASC`,
		roomID,
	)
	if err != nil {
		return nil, fmt.Errorf("查询元素失败: %w", err)
	}
	defer rows.Close()

	var elements []models.Element
	for rows.Next() {
		var elem models.Element
		if err := rows.Scan(
			&elem.ID, &elem.RoomID, &elem.CreatorUUID, &elem.CreatorName,
			&elem.Type, &elem.Payload, &elem.IsDeleted, &elem.CreatedAt, &elem.UpdatedAt,
		); err != nil {
			return nil, err
		}
		elements = append(elements, elem)
	}
	return elements, nil
}

// CreateElement 创建画布元素（含文本卡片敏感词过滤）
func (s *WidgetService) CreateElement(roomID, creatorUUID, creatorName, elemType string, payload json.RawMessage) (*models.Element, error) {
	if elemType == models.ElementTypeTextCard {
		var tp map[string]interface{}
		if json.Unmarshal(payload, &tp) == nil {
			if content, ok := tp["content"].(string); ok {
				tp["content"] = s.profanity.Filter(content)
				payload, _ = json.Marshal(tp)
			}
		}
	}

	elem := &models.Element{}
	err := s.db.QueryRow(
		`INSERT INTO room_elements (room_id, creator_uuid, creator_name, type, payload)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, room_id, creator_uuid, creator_name, type, payload, is_deleted, created_at, updated_at`,
		roomID, creatorUUID, creatorName, elemType, payload,
	).Scan(
		&elem.ID, &elem.RoomID, &elem.CreatorUUID, &elem.CreatorName,
		&elem.Type, &elem.Payload, &elem.IsDeleted, &elem.CreatedAt, &elem.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("创建元素失败: %w", err)
	}
	return elem, nil
}

// SoftDeleteElement 软删除元素
func (s *WidgetService) SoftDeleteElement(elementID string) error {
	_, err := s.db.Exec(
		"UPDATE room_elements SET is_deleted = TRUE, updated_at = NOW() WHERE id = $1",
		elementID,
	)
	return err
}

// =============================================================
// REQ-041 HTML 展示组件：源码存 html_widget_contents 表（不进 payload）
//   元素本体仍是一条 room_elements（type=html_widget，payload 仅 {title}），
//   源码按 element_id 引用落此表，广播只传 element_id，客户端各自 GET 拉取。
// =============================================================

// SaveHtmlContent 落库/更新 HTML 组件源码（按 element_id upsert）
func (s *WidgetService) SaveHtmlContent(elementID, roomID, html string) error {
	_, err := s.db.Exec(
		`INSERT INTO html_widget_contents (element_id, room_id, html, byte_size, updated_at)
		 VALUES ($1, $2, $3, $4, NOW())
		 ON CONFLICT (element_id)
		 DO UPDATE SET html = EXCLUDED.html, byte_size = EXCLUDED.byte_size, updated_at = NOW()`,
		elementID, roomID, html, len(html),
	)
	if err != nil {
		return fmt.Errorf("保存 HTML 源码失败: %w", err)
	}
	return nil
}

// GetHtmlContent 读取 HTML 组件源码（无记录返回空串，非错误）
func (s *WidgetService) GetHtmlContent(elementID string) (string, error) {
	var html string
	err := s.db.QueryRow(
		`SELECT html FROM html_widget_contents WHERE element_id = $1`,
		elementID,
	).Scan(&html)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf("读取 HTML 源码失败: %w", err)
	}
	return html, nil
}

// =============================================================
// REQ-043 HTML 课件互动数据收集
//   课件 iframe 经 postMessage → HtmlWidget → onSubmit('html_event') → WS widget_submit
//   → 本方法落 widget_interactions（widget_type='html_widget', action_type='html_event'）。
//   身份由调用方（ws_handler）传入 client.UUID/Nickname，课件自报的任何 id 一律不信。
// =============================================================

// htmlEventData 课件上报的结构化事件（mc_event 契约的服务端镜像）
type htmlEventData struct {
	Event          string          `json:"event"`
	QuestionID     string          `json:"questionId"`
	IsCorrect      *bool           `json:"isCorrect"`
	KnowledgePoint string          `json:"knowledgePoint"`
	Score          *float64        `json:"score"`
	Data           json.RawMessage `json:"data"`
}

// HandleHtmlEvent 处理 HTML 课件的互动事件
func (s *WidgetService) HandleHtmlEvent(
	elementID, roomID, studentUUID, studentName string, actionData json.RawMessage,
) error {
	// 防滥用：限制单条事件体积
	if len(actionData) > 8*1024 {
		return fmt.Errorf("事件数据过大")
	}

	// 1. 校验元素存在、类型为 html_widget、属于本房间（课件传的 elementId 也要核）
	var elemType, teacherID string
	if err := s.db.QueryRow(
		`SELECT e.type, r.teacher_id
		   FROM room_elements e JOIN rooms r ON r.id = e.room_id
		  WHERE e.id = $1 AND e.room_id = $2 AND e.is_deleted = FALSE`,
		elementID, roomID,
	).Scan(&elemType, &teacherID); err != nil {
		return fmt.Errorf("HTML 组件不存在")
	}
	if elemType != models.ElementTypeHtmlWidget {
		return fmt.Errorf("目标元素不是 HTML 组件")
	}

	// 2. 解析事件 + 字段收敛
	var ev htmlEventData
	if err := json.Unmarshal(actionData, &ev); err != nil {
		return fmt.Errorf("事件数据格式错误: %w", err)
	}
	ev.Event = strings.TrimSpace(ev.Event)
	if ev.Event == "" {
		ev.Event = "interact"
	}
	if len(ev.Event) > 40 {
		ev.Event = ev.Event[:40]
	}
	if len(ev.QuestionID) > 80 {
		ev.QuestionID = ev.QuestionID[:80]
	}
	ev.KnowledgePoint = strings.TrimSpace(ev.KnowledgePoint)
	if len(ev.KnowledgePoint) > 100 {
		ev.KnowledgePoint = ev.KnowledgePoint[:100]
	}

	// 3. 知识点 resolve-or-create（按房间 teacher_id，课件自报名字；失败不阻断落库）
	var kpID interface{} = nil
	if ev.KnowledgePoint != "" {
		var id string
		if e := s.db.QueryRow(
			`INSERT INTO knowledge_points (teacher_id, name)
			 VALUES ($1, $2)
			 ON CONFLICT (teacher_id, name) DO UPDATE SET name = EXCLUDED.name
			 RETURNING id`,
			teacherID, ev.KnowledgePoint,
		).Scan(&id); e != nil {
			log.Printf("[html_event] 知识点 resolve 失败 kp=%q: %v", ev.KnowledgePoint, e)
		} else {
			kpID = id
		}
	}

	// 4. 组织存库 action_data（只留白名单字段）
	stored := map[string]interface{}{"event": ev.Event}
	if ev.QuestionID != "" {
		stored["questionId"] = ev.QuestionID
	}
	if ev.KnowledgePoint != "" {
		stored["knowledgePoint"] = ev.KnowledgePoint
	}
	if ev.Score != nil {
		stored["score"] = *ev.Score
	}
	if len(ev.Data) > 0 {
		stored["data"] = json.RawMessage(ev.Data)
	}
	storedJSON, _ := json.Marshal(stored)

	// 5. 落库（html_event 无去重约束，学生可多次触发）
	if _, err := s.db.Exec(
		`INSERT INTO widget_interactions
		   (room_id, element_id, student_uuid, student_name, widget_type, action_type, action_data, is_correct, knowledge_point_id)
		 VALUES ($1, $2, $3, $4, 'html_widget', 'html_event', $5, $6, $7)`,
		roomID, elementID, studentUUID, studentName, storedJSON, ev.IsCorrect, kpID,
	); err != nil {
		return fmt.Errorf("互动事件写入失败: %w", err)
	}
	return nil
}

// =============================================================
// 辅助函数
// =============================================================

// contains 检查字符串切片中是否包含指定元素
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// =============================================================
// FlattenWidgetPayload 展平 Widget payload，防止三层嵌套写入数据库
//
// 问题场景：前端 element_update 可能携带三层嵌套结构：
//   {x,y,width,height, payload:{..., payload:{业务字段}}}
// 若直接写库，后续 extractInnerPayload 会读到错误层级的数据。
//
// 处理规则：
//   - 检测到三层嵌套（outer.payload.payload 是 object）时，自动展平
//   - 展平策略：外层保留位置字段，内层取第二层业务字段（去掉 payload 子键），
//     聚合数据（words/votes/stats/submissionOrder/total_voters）优先取第三层
//   - 非 Widget 类型或非三层嵌套时，原样返回
// =============================================================
func FlattenWidgetPayload(elemType string, rawPayload []byte) []byte {
	widgetTypes := map[string]bool{
		"polling_widget":   true,
		"wordcloud_widget": true,
		"qa_widget":        true,
		"dropzone_widget":  true,
		"html_widget":      true,
		"shelf_widget":     true,
	}
	if !widgetTypes[elemType] {
		return rawPayload
	}

	var outer map[string]json.RawMessage
	if err := json.Unmarshal(rawPayload, &outer); err != nil {
		return rawPayload
	}

	// 检查是否三层嵌套：outer.payload.payload 是 object
	l2Raw, hasL2 := outer["payload"]
	if !hasL2 || len(l2Raw) <= 2 {
		return rawPayload
	}
	var l2 map[string]json.RawMessage
	if err := json.Unmarshal(l2Raw, &l2); err != nil {
		return rawPayload
	}
	l3Raw, hasL3 := l2["payload"]
	if !hasL3 || len(l3Raw) <= 2 {
		return rawPayload
	}
	trimmed := strings.TrimSpace(string(l3Raw))
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return rawPayload
	}
	var l3 map[string]json.RawMessage
	if err := json.Unmarshal(l3Raw, &l3); err != nil {
		return rawPayload
	}

	log.Printf("[FlattenWidgetPayload] 检测到三层嵌套，自动展平 type:%s", elemType)

	// 位置字段：优先外层，次选第二层
	getNum := func(key string, fallback float64) float64 {
		if v, ok := outer[key]; ok {
			var f float64
			if json.Unmarshal(v, &f) == nil {
				return f
			}
		}
		if v, ok := l2[key]; ok {
			var f float64
			if json.Unmarshal(v, &f) == nil {
				return f
			}
		}
		return fallback
	}

	// 构建内层业务字段：第二层去掉结构字段，聚合字段用第三层覆盖
	skipKeys := map[string]bool{
		"payload": true, "x": true, "y": true,
		"width": true, "height": true, "id": true, "type": true,
	}
	// 聚合字段名（优先取第三层最新值）

	mergedBusiness := make(map[string]json.RawMessage)
	// 先写第二层业务字段（跳过结构字段）
	for k, v := range l2 {
		if !skipKeys[k] {
			mergedBusiness[k] = v
		}
	}
	// 保护键：由服务端聚合计算，客户端不可覆盖
	protectedFromL3 := map[string]bool{
		"votes": true, "total_voters": true,
		"words": true,
		"stats": true,
	}
	// 再用第三层聚合字段覆盖（这些是最新值），跳过服务端保护键
	for k, v := range l3 {
		if !protectedFromL3[k] {
			mergedBusiness[k] = v
		}
	}

	innerJSON, err := json.Marshal(mergedBusiness)
	if err != nil {
		return rawPayload
	}

	result := map[string]interface{}{
		"x":       getNum("x", 0),
		"y":       getNum("y", 0),
		"width":   getNum("width", 360),
		"height":  getNum("height", 380),
		"payload": json.RawMessage(innerJSON),
	}
	flattened, err := json.Marshal(result)
	if err != nil {
		return rawPayload
	}
	return flattened
}
