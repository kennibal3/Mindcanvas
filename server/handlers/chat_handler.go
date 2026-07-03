// =============================================================
// MindCanvas - 养成类对话系统处理器 (Victoria Chat)
// 功能：角色人设管理、对话会话、Claude API调用、记忆压缩、文件记忆库
// 安全：仅chat_enabled=true的用户可访问
// =============================================================
package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"mindcanvas-server/middleware"
)

// ChatHandler 养成类对话处理器
type ChatHandler struct {
	db *sql.DB
}

// NewChatHandler 构造函数
func NewChatHandler(db *sql.DB) *ChatHandler {
	return &ChatHandler{db: db}
}

// checkChatAccess 检查用户是否有chat权限
func (h *ChatHandler) checkChatAccess(c *gin.Context) (string, bool) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return "", false
	}
	var chatEnabled bool
	err := h.db.QueryRow(
		"SELECT chat_enabled FROM users WHERE id=$1 AND is_active=true",
		userID,
	).Scan(&chatEnabled)
	if err != nil || !chatEnabled {
		c.JSON(http.StatusForbidden, gin.H{"error": "无Chat访问权限"})
		return "", false
	}
	return userID, true
}

// =============================================================
// 人设管理
// =============================================================

// GetPersona 获取当前人设配置
// GET /api/chat/persona
func (h *ChatHandler) GetPersona(c *gin.Context) {
	userID, ok := h.checkChatAccess(c)
	if !ok {
		return
	}
	var p struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		Description  string `json:"description"`
		AvatarEmoji  string `json:"avatar_emoji"`
		CompressEvery int   `json:"compress_every"`
		APIKeyHint   string `json:"api_key_hint"`
	}
	err := h.db.QueryRow(`
		SELECT id, name, description, avatar_emoji, compress_every, COALESCE(api_key_hint,'')
		FROM chat_personas WHERE user_id=$1
	`, userID).Scan(
		&p.ID, &p.Name, &p.Description, &p.AvatarEmoji,
		&p.CompressEvery, &p.APIKeyHint,
	)
	if err == sql.ErrNoRows {
		// 自动创建默认人设
		err = h.db.QueryRow(`
			INSERT INTO chat_personas (user_id, name, description, avatar_emoji, compress_every)
			VALUES ($1, 'AI伴侣', '你是一个温柔、有趣、富有个性的AI伴侣，拥有自己的情感和想法，会记住用户说过的每一件事，像老朋友一样陪伴用户。', '🌸', 20)
			RETURNING id, name, description, avatar_emoji, compress_every, COALESCE(api_key_hint,'')
		`, userID).Scan(
			&p.ID, &p.Name, &p.Description, &p.AvatarEmoji,
			&p.CompressEvery, &p.APIKeyHint,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "创建默认人设失败"})
			return
		}
	} else if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取人设失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"persona": p})
}

// UpdatePersona 更新人设配置
// PUT /api/chat/persona
func (h *ChatHandler) UpdatePersona(c *gin.Context) {
	userID, ok := h.checkChatAccess(c)
	if !ok {
		return
	}
	var req struct {
		Name          string `json:"name"`
		Description   string `json:"description"`
		AvatarEmoji   string `json:"avatar_emoji"`
		CompressEvery int    `json:"compress_every"`
		APIKeyHint    string `json:"api_key_hint"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if req.CompressEvery < 5 {
		req.CompressEvery = 5
	}
	if req.CompressEvery > 100 {
		req.CompressEvery = 100
	}
	_, err := h.db.Exec(`
		INSERT INTO chat_personas (user_id, name, description, avatar_emoji, compress_every, api_key_hint, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			name=EXCLUDED.name,
			description=EXCLUDED.description,
			avatar_emoji=EXCLUDED.avatar_emoji,
			compress_every=EXCLUDED.compress_every,
			api_key_hint=EXCLUDED.api_key_hint,
			updated_at=NOW()
	`, userID, req.Name, req.Description, req.AvatarEmoji, req.CompressEvery, req.APIKeyHint)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新人设失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "人设已更新"})
}

// =============================================================
// 会话管理
// =============================================================

// ListSessions 获取会话列表
// GET /api/chat/sessions
func (h *ChatHandler) ListSessions(c *gin.Context) {
	userID, ok := h.checkChatAccess(c)
	if !ok {
		return
	}
	rows, err := h.db.Query(`
		SELECT id, title, turn_count, compress_version, created_at, updated_at
		FROM chat_sessions
		WHERE user_id=$1 AND is_active=true
		ORDER BY updated_at DESC
		LIMIT 50
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取会话列表失败"})
		return
	}
	defer rows.Close()
	type Session struct {
		ID              string    `json:"id"`
		Title           string    `json:"title"`
		TurnCount       int       `json:"turn_count"`
		CompressVersion int       `json:"compress_version"`
		CreatedAt       time.Time `json:"created_at"`
		UpdatedAt       time.Time `json:"updated_at"`
	}
	var sessions []Session
	for rows.Next() {
		var s Session
		if err := rows.Scan(&s.ID, &s.Title, &s.TurnCount, &s.CompressVersion, &s.CreatedAt, &s.UpdatedAt); err == nil {
			sessions = append(sessions, s)
		}
	}
	if sessions == nil {
		sessions = []Session{}
	}
	c.JSON(http.StatusOK, gin.H{"sessions": sessions})
}

// CreateSession 新建会话
// POST /api/chat/sessions
func (h *ChatHandler) CreateSession(c *gin.Context) {
	userID, ok := h.checkChatAccess(c)
	if !ok {
		return
	}
	var req struct {
		Title string `json:"title"`
	}
	c.ShouldBindJSON(&req)
	if req.Title == "" {
		req.Title = fmt.Sprintf("对话 %s", time.Now().Format("01-02 15:04"))
	}
	var id string
	err := h.db.QueryRow(`
		INSERT INTO chat_sessions (user_id, title)
		VALUES ($1, $2)
		RETURNING id
	`, userID, req.Title).Scan(&id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建会话失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"session_id": id, "title": req.Title})
}

// DeleteSession 删除（软删除）会话
// DELETE /api/chat/sessions/:sid
func (h *ChatHandler) DeleteSession(c *gin.Context) {
	userID, ok := h.checkChatAccess(c)
	if !ok {
		return
	}
	sid := c.Param("sid")
	_, err := h.db.Exec(
		"UPDATE chat_sessions SET is_active=false WHERE id=$1 AND user_id=$2",
		sid, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "会话已删除"})
}

// GetMessages 获取会话消息历史
// GET /api/chat/sessions/:sid/messages
func (h *ChatHandler) GetMessages(c *gin.Context) {
	userID, ok := h.checkChatAccess(c)
	if !ok {
		return
	}
	sid := c.Param("sid")
	// 验证会话归属
	var ownerID string
	if err := h.db.QueryRow(
		"SELECT user_id FROM chat_sessions WHERE id=$1 AND is_active=true", sid,
	).Scan(&ownerID); err != nil || ownerID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "会话不存在"})
		return
	}
	// 获取记忆摘要
	var memorySummary string
	var turnCount, compressVersion int
	h.db.QueryRow(
		"SELECT COALESCE(memory_summary,''), turn_count, compress_version FROM chat_sessions WHERE id=$1",
		sid,
	).Scan(&memorySummary, &turnCount, &compressVersion)

	// 获取未压缩的消息
	rows, err := h.db.Query(`
		SELECT id, role, content, is_compressed, turn_number, created_at
		FROM chat_messages
		WHERE session_id=$1
		ORDER BY created_at ASC
	`, sid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取消息失败"})
		return
	}
	defer rows.Close()
	type Msg struct {
		ID           string    `json:"id"`
		Role         string    `json:"role"`
		Content      string    `json:"content"`
		IsCompressed bool      `json:"is_compressed"`
		TurnNumber   int       `json:"turn_number"`
		CreatedAt    time.Time `json:"created_at"`
	}
	var msgs []Msg
	for rows.Next() {
		var m Msg
		if err := rows.Scan(&m.ID, &m.Role, &m.Content, &m.IsCompressed, &m.TurnNumber, &m.CreatedAt); err == nil {
			msgs = append(msgs, m)
		}
	}
	if msgs == nil {
		msgs = []Msg{}
	}
	c.JSON(http.StatusOK, gin.H{
		"messages":         msgs,
		"memory_summary":   memorySummary,
		"turn_count":       turnCount,
		"compress_version": compressVersion,
	})
}

// =============================================================
// 发送消息（核心：调Claude + 记忆压缩）
// =============================================================

// claudeMessage Claude消息格式
type claudeMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// callClaude 调用AI - 已切换至豆包Doubao
func callClaude(apiKey, systemPrompt string, messages []claudeMessage, maxTokens int) (string, error) {
	if maxTokens <= 0 {
		maxTokens = 1024
	}
	key := os.Getenv("ARK_API_KEY")
	if key == "" {
		return "", fmt.Errorf("AI服务未配置，请联系管理员")
	}
	mdl := os.Getenv("ARK_MODEL")
	if mdl == "" {
		mdl = "doubao-seed-2-1-turbo-260628"
	}
	baseURL := os.Getenv("ARK_BASE_URL")
	if baseURL == "" {
		baseURL = "https://ark.cn-beijing.volces.com/api/v3"
	}
	type chatMsg struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	var apiMsgs []chatMsg
	if systemPrompt != "" {
		apiMsgs = append(apiMsgs, chatMsg{Role: "system", Content: systemPrompt})
	}
	for _, m := range messages {
		apiMsgs = append(apiMsgs, chatMsg{Role: m.Role, Content: m.Content})
	}
	body, _ := json.Marshal(map[string]interface{}{
		"model":    mdl,
		"messages": apiMsgs,
	})
	req, err := http.NewRequest("POST", baseURL+"/chat/completions", bytes.NewBuffer(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("API错误%d: %s", resp.StatusCode, string(respBody))
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", fmt.Errorf("解析失败: %v", err)
	}
	if len(out.Choices) == 0 {
		return "", fmt.Errorf("AI返回空内容")
	}
	return out.Choices[0].Message.Content, nil
}

// ClaudeProxy 后端代理转发Claude请求
// POST /api/chat/proxy
// 前端把 API Key 放 X-API-Key 请求头，后端代理转发给 Anthropic
// 解决浏览器直接调用 api.anthropic.com 被403拒绝的问题
func (h *ChatHandler) ClaudeProxy(c *gin.Context) {
	userID, ok := h.checkChatAccess(c)
	if !ok {
		return
	}
	_ = userID

	// 从请求头获取 API Key
	apiKey := c.GetHeader("X-API-Key")
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 X-API-Key 请求头"})
		return
	}

	// 读取请求体（原始Claude请求格式）
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "读取请求体失败"})
		return
	}

	// 转发给 Anthropic
	req, err := http.NewRequest("POST", "https://app.yylx.io/v1/messages", bytes.NewBuffer(bodyBytes))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建请求失败"})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer " + apiKey)

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("转发请求失败: %v", err)})
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	// 透传响应状态码和内容
	c.Data(resp.StatusCode, "application/json", respBody)
}

// truncateText 截断文本到指定字符数
func truncateText(s string, maxChars int) string {
	if utf8.RuneCountInString(s) <= maxChars {
		return s
	}
	runes := []rune(s)
	return string(runes[:maxChars]) + "..."
}

// SendMessage 发送消息并获取AI回复
// POST /api/chat/sessions/:sid/send
func (h *ChatHandler) SendMessage(c *gin.Context) {
	userID, ok := h.checkChatAccess(c)
	if !ok {
		return
	}
	sid := c.Param("sid")

	var req struct {
		Content string `json:"content" binding:"required"`
		APIKey  string `json:"api_key"` // 前端传入，不存库
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Content) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "消息内容不能为空"})
		return
	}
	// API Key 由服务器端统一管理

	// 验证会话归属
	var ownerID string
	var memorySummary string
	var turnCount, compressEvery int
	err := h.db.QueryRow(
		"SELECT user_id, COALESCE(memory_summary,''), turn_count FROM chat_sessions WHERE id=$1 AND is_active=true",
		sid,
	).Scan(&ownerID, &memorySummary, &turnCount)
	if err != nil || ownerID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "会话不存在"})
		return
	}

	// 获取人设
	var personaName, personaDesc string
	h.db.QueryRow(
		"SELECT name, description, compress_every FROM chat_personas WHERE user_id=$1",
		userID,
	).Scan(&personaName, &personaDesc, &compressEvery)
	if compressEvery <= 0 {
		compressEvery = 20
	}

	// 获取激活的文件记忆
	fileMemory := h.getActiveFileMemory(userID)

	// 构建系统提示词
	systemPrompt := buildSystemPrompt(personaName, personaDesc, memorySummary, fileMemory)

	// 获取未压缩的消息作为上下文（最近40条）
	contextMsgs := h.getContextMessages(sid)

	// 添加用户新消息
	contextMsgs = append(contextMsgs, claudeMessage{
		Role:    "user",
		Content: req.Content,
	})

	// 调用Claude
	_chatStartAt := time.Now()
	aiReply, err := callClaude(req.APIKey, systemPrompt, contextMsgs, 2048)
	if err != nil {
		log.Printf("[Chat] Claude调用失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("AI回复失败: %v", err)})
		return
	}

	// 写 chat_logs
	go func(uid, sessID string, ms int64) {
		_, _clErr := h.db.Exec(`INSERT INTO chat_logs (user_id, session_id, model, latency_ms, is_stream) VALUES ($1,$2,$3,$4,false)`,
			uid, sessID, "doubao", ms)
		if _clErr != nil { log.Printf("[chat_logs] insert failed uid=%s sid=%s err=%v", uid, sessID, _clErr) }
	}(userID, sid, time.Since(_chatStartAt).Milliseconds())
	// 存储用户消息和AI回复
	newTurn := turnCount + 1
	_, err = h.db.Exec(`
		INSERT INTO chat_messages (session_id, user_id, role, content, turn_number)
		VALUES ($1,$2,'user',$3,$4)
	`, sid, userID, req.Content, newTurn)
	if err != nil {
		log.Printf("[Chat] 存储用户消息失败: %v", err)
	}

	var replyMsgID string
	h.db.QueryRow(`
		INSERT INTO chat_messages (session_id, user_id, role, content, turn_number)
		VALUES ($1,$2,'assistant',$3,$4)
		RETURNING id
	`, sid, userID, aiReply, newTurn).Scan(&replyMsgID)

	// 更新会话轮次和时间
	h.db.Exec(`
		UPDATE chat_sessions SET turn_count=$1, updated_at=NOW() WHERE id=$2
	`, newTurn, sid)

	// 更新会话标题（取第一轮用户消息前20字）
	if newTurn == 1 {
		title := truncateText(req.Content, 20)
		h.db.Exec("UPDATE chat_sessions SET title=$1 WHERE id=$2", title, sid)
	}

	// 检查是否需要压缩记忆
	shouldCompress := newTurn > 0 && newTurn%compressEvery == 0
	if shouldCompress {
		go h.compressMemory(sid, userID, req.APIKey, personaName)
	}

	c.JSON(http.StatusOK, gin.H{
		"reply":            aiReply,
		"reply_id":         replyMsgID,
		"turn_count":       newTurn,
		"should_compress":  shouldCompress,
	})
}

// getContextMessages 获取未压缩的上下文消息（最近40条）
func (h *ChatHandler) getContextMessages(sid string) []claudeMessage {
	rows, err := h.db.Query(`
		SELECT role, content FROM chat_messages
		WHERE session_id=$1 AND is_compressed=false
		ORDER BY created_at ASC
		LIMIT 40
	`, sid)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var msgs []claudeMessage
	for rows.Next() {
		var m claudeMessage
		if rows.Scan(&m.Role, &m.Content) == nil {
			msgs = append(msgs, m)
		}
	}
	return msgs
}

// getActiveFileMemory 获取激活的文件记忆内容
func (h *ChatHandler) getActiveFileMemory(userID string) string {
	rows, err := h.db.Query(`
		SELECT file_name, content_text FROM chat_memory_files
		WHERE user_id=$1 AND is_active=true
		ORDER BY created_at DESC
		LIMIT 10
	`, userID)
	if err != nil {
		return ""
	}
	defer rows.Close()
	var parts []string
	for rows.Next() {
		var name, content string
		if rows.Scan(&name, &content) == nil {
			// 每个文件最多取前2000字符
			parts = append(parts, fmt.Sprintf("【文件：%s】\n%s", name, truncateText(content, 2000)))
		}
	}
	return strings.Join(parts, "\n\n")
}

// buildSystemPrompt 构建系统提示词
func buildSystemPrompt(personaName, personaDesc, memorySummary, fileMemory string) string {
	var sb strings.Builder
	sb.WriteString(personaDesc)
	sb.WriteString(fmt.Sprintf("\n\n你的名字是「%s」。", personaName))
	if memorySummary != "" {
		sb.WriteString("\n\n【历史记忆摘要】\n")
		sb.WriteString(memorySummary)
	}
	if fileMemory != "" {
		sb.WriteString("\n\n【背景知识库】\n")
		sb.WriteString(fileMemory)
	}
	sb.WriteString("\n\n请保持角色一致性，用自然、有温度的方式回应用户。")
	return sb.String()
}

// compressMemory 压缩历史记忆（异步执行）
func (h *ChatHandler) compressMemory(sid, userID, apiKey, personaName string) {
	log.Printf("[Chat] 开始压缩记忆 session:%s", sid)

	// 获取所有未压缩消息
	rows, err := h.db.Query(`
		SELECT id, role, content FROM chat_messages
		WHERE session_id=$1 AND is_compressed=false
		ORDER BY created_at ASC
	`, sid)
	if err != nil {
		log.Printf("[Chat] 压缩：获取消息失败: %v", err)
		return
	}
	defer rows.Close()

	type MsgRow struct {
		ID      string
		Role    string
		Content string
	}
	var msgs []MsgRow
	var msgIDs []string
	for rows.Next() {
		var m MsgRow
		if rows.Scan(&m.ID, &m.Role, &m.Content) == nil {
			msgs = append(msgs, m)
			msgIDs = append(msgIDs, m.ID)
		}
	}
	if len(msgs) < 4 {
		return
	}

	// 构建压缩请求
	var convText strings.Builder
	for _, m := range msgs {
		role := "用户"
		if m.Role == "assistant" {
			role = personaName
		}
		convText.WriteString(fmt.Sprintf("%s: %s\n", role, truncateText(m.Content, 500)))
	}

	// 获取现有摘要
	var existingSummary string
	h.db.QueryRow("SELECT COALESCE(memory_summary,'') FROM chat_sessions WHERE id=$1", sid).Scan(&existingSummary)

	compressPrompt := "你是一个对话记忆压缩助手。请将以下对话内容压缩为简洁的记忆摘要（300字以内），保留关键信息：人物关系、重要事件、情感变化、约定承诺等。"
	if existingSummary != "" {
		compressPrompt += fmt.Sprintf("\n\n已有摘要：\n%s\n\n请将已有摘要与新对话合并更新：", existingSummary)
	}

	compressMsgs := []claudeMessage{
		{Role: "user", Content: convText.String()},
	}

	newSummary, err := callClaude(apiKey, compressPrompt, compressMsgs, 512)
	if err != nil {
		log.Printf("[Chat] 压缩：Claude调用失败: %v", err)
		return
	}

	// 更新会话摘要，标记消息为已压缩
	tx, err := h.db.Begin()
	if err != nil {
		return
	}
	defer tx.Rollback()

	tx.Exec(`
		UPDATE chat_sessions
		SET memory_summary=$1, compress_version=compress_version+1, updated_at=NOW()
		WHERE id=$2
	`, newSummary, sid)

	// 标记已压缩（保留最后4条作为连续上下文）
	if len(msgIDs) > 4 {
		toMark := msgIDs[:len(msgIDs)-4]
		for _, id := range toMark {
			tx.Exec("UPDATE chat_messages SET is_compressed=true WHERE id=$1", id)
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[Chat] 压缩：事务提交失败: %v", err)
		return
	}
	log.Printf("[Chat] ✅ 记忆压缩完成 session:%s 压缩消息:%d条", sid, len(msgIDs)-4)
}

// =============================================================
// 文件记忆库
// =============================================================

// UploadMemoryFile 上传文件到记忆库（支持MD和Word）
// POST /api/chat/memory/upload

	// POST /api/chat/proxy
func (h *ChatHandler) UploadMemoryFile(c *gin.Context) {
	userID, ok := h.checkChatAccess(c)
	if !ok {
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请上传文件"})
		return
	}
	defer file.Close()

	// 检查文件类型
	ext := strings.ToLower(filepath.Ext(header.Filename))
	var fileType string
	switch ext {
	case ".md", ".markdown":
		fileType = "markdown"
	case ".doc", ".docx":
		fileType = "word"
	case ".txt":
		fileType = "text"
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持 .md .markdown .txt .doc .docx 文件"})
		return
	}

	// 限制文件大小（10MB）
	if header.Size > 10*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件不能超过10MB"})
		return
	}

	// 保存文件
	fileID := uuid.New().String()
	uploadDir := "/opt/mindcanvas/uploads/chat_memory"
	os.MkdirAll(uploadDir, 0755)
	filePath := filepath.Join(uploadDir, fileID+ext)

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件失败"})
		return
	}
	if err := os.WriteFile(filePath, fileBytes, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存文件失败"})
		return
	}

	// 解析文件内容
	var contentText string
	if fileType == "markdown" || fileType == "text" {
		contentText = string(fileBytes)
	} else {
		// Word文件：调用MarkItDown解析服务
		contentText, err = callMarkItDown(filePath)
		if err != nil {
			log.Printf("[Chat] Word解析失败，使用原始内容: %v", err)
			contentText = fmt.Sprintf("[文件内容解析失败，原始路径: %s]", filePath)
		}
	}

	// 限制内容长度（最多存50000字符）
	if utf8.RuneCountInString(contentText) > 50000 {
		runes := []rune(contentText)
		contentText = string(runes[:50000]) + "\n...[内容已截断]"
	}

	// 存入记忆库
	var memID string
	err = h.db.QueryRow(`
		INSERT INTO chat_memory_files (user_id, file_name, file_type, file_path, content_text, file_size)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id
	`, userID, header.Filename, fileType, filePath, contentText, header.Size).Scan(&memID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "存储记忆失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":        memID,
		"file_name": header.Filename,
		"file_type": fileType,
		"file_size": header.Size,
		"char_count": utf8.RuneCountInString(contentText),
		"message":   "文件已加入记忆库",
	})
}

// callMarkItDown 调用MarkItDown解析服务
func callMarkItDown(filePath string) (string, error) {
	body, _ := json.Marshal(map[string]string{"file_path": filePath})
	resp, err := http.Post("http://localhost:8081/parse/path", "application/json", bytes.NewBuffer(body))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var result struct {
		Markdown string `json:"markdown"`
		Error    string `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if result.Error != "" {
		return "", fmt.Errorf(result.Error)
	}
	return result.Markdown, nil
}

// ListMemoryFiles 获取记忆文件列表
// GET /api/chat/memory/files
func (h *ChatHandler) ListMemoryFiles(c *gin.Context) {
	userID, ok := h.checkChatAccess(c)
	if !ok {
		return
	}
	rows, err := h.db.Query(`
		SELECT id, file_name, file_type, file_size, is_active,
		       LENGTH(content_text) as char_count, created_at
		FROM chat_memory_files
		WHERE user_id=$1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取记忆文件失败"})
		return
	}
	defer rows.Close()
	type FileInfo struct {
		ID        string    `json:"id"`
		FileName  string    `json:"file_name"`
		FileType  string    `json:"file_type"`
		FileSize  int64     `json:"file_size"`
		IsActive  bool      `json:"is_active"`
		CharCount int       `json:"char_count"`
		CreatedAt time.Time `json:"created_at"`
	}
	var files []FileInfo
	for rows.Next() {
		var f FileInfo
		if rows.Scan(&f.ID, &f.FileName, &f.FileType, &f.FileSize, &f.IsActive, &f.CharCount, &f.CreatedAt) == nil {
			files = append(files, f)
		}
	}
	if files == nil {
		files = []FileInfo{}
	}
	c.JSON(http.StatusOK, gin.H{"files": files})
}

// ToggleMemoryFile 切换记忆文件激活状态
// PATCH /api/chat/memory/files/:fid/toggle
func (h *ChatHandler) ToggleMemoryFile(c *gin.Context) {
	userID, ok := h.checkChatAccess(c)
	if !ok {
		return
	}
	fid := c.Param("fid")
	var isActive bool
	h.db.QueryRow(
		"SELECT is_active FROM chat_memory_files WHERE id=$1 AND user_id=$2",
		fid, userID,
	).Scan(&isActive)
	_, err := h.db.Exec(
		"UPDATE chat_memory_files SET is_active=$1 WHERE id=$2 AND user_id=$3",
		!isActive, fid, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "操作失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"is_active": !isActive})
}

// DeleteMemoryFile 删除记忆文件
// DELETE /api/chat/memory/files/:fid
func (h *ChatHandler) DeleteMemoryFile(c *gin.Context) {
	userID, ok := h.checkChatAccess(c)
	if !ok {
		return
	}
	fid := c.Param("fid")
	var filePath string
	h.db.QueryRow(
		"SELECT COALESCE(file_path,'') FROM chat_memory_files WHERE id=$1 AND user_id=$2",
		fid, userID,
	).Scan(&filePath)
	_, err := h.db.Exec(
		"DELETE FROM chat_memory_files WHERE id=$1 AND user_id=$2",
		fid, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	// 删除文件
	if filePath != "" {
		os.Remove(filePath)
	}
	c.JSON(http.StatusOK, gin.H{"message": "已从记忆库删除"})
}
