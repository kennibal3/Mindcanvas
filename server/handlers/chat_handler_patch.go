package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"mindcanvas-server/services"
)

type ChatDoubaoHandler struct {
	db    *sql.DB
	aiSvc *services.AIService
}

func NewChatDoubaoHandler(db *sql.DB, aiSvc *services.AIService) *ChatDoubaoHandler {
	return &ChatDoubaoHandler{db: db, aiSvc: aiSvc}
}

type chatDoubaoMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type sendDoubaoMessageReq struct {
	Messages     []chatDoubaoMessage `json:"messages" binding:"required"`
	SystemPrompt string              `json:"system_prompt"`
	ImageURL     string              `json:"image_url"`
	SessionID    string              `json:"session_id"`
}

func (h *ChatDoubaoHandler) SendMessage(c *gin.Context) {
	startAt := time.Now()
	userID, _ := c.Get("user_id")
	userIDStr := fmt.Sprintf("%v", userID)
	if !h.checkChatEnabled(c, userIDStr) {
		return
	}
	var req sendDoubaoMessageReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Messages) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "messages 不能为空"})
		return
	}
	var msgs []services.AIMessage
	if req.SystemPrompt != "" {
		msgs = append(msgs, services.AIMessage{Role: "system", Content: req.SystemPrompt})
	}
	lastIdx := len(req.Messages) - 1
	for i, m := range req.Messages {
		if i == lastIdx && req.ImageURL != "" && m.Role == "user" {
			parts := []services.AIContentPart{
				{Type: "image_url", ImageURL: &services.AIImageURL{URL: req.ImageURL}},
				{Type: "text", Text: m.Content},
			}
			msgs = append(msgs, services.AIMessage{Role: "user", Content: parts})
		} else {
			msgs = append(msgs, services.AIMessage{Role: m.Role, Content: m.Content})
		}
	}
	h.streamResponse(c, msgs, userIDStr, req.SessionID, startAt)
}

func (h *ChatDoubaoHandler) streamResponse(c *gin.Context, msgs []services.AIMessage, userID, sessionID string, startAt time.Time) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming not supported"})
		return
	}
	sendEvent := func(event, data string) {
		if event != "" {
			fmt.Fprintf(c.Writer, "event: %s\n", event)
		}
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		flusher.Flush()
	}
	modelInfo, _ := json.Marshal(map[string]string{"model": h.aiSvc.Model()})
	sendEvent("model", string(modelInfo))
	ctx := c.Request.Context()
	var fullReply strings.Builder
	usage, err := h.aiSvc.ChatStream(ctx, msgs, func(chunk string) {
		fullReply.WriteString(chunk)
		data, _ := json.Marshal(map[string]string{"content": chunk})
		sendEvent("chunk", string(data))
	})
	latencyMs := time.Since(startAt).Milliseconds()
	if err != nil {
		errData, _ := json.Marshal(map[string]string{"error": err.Error()})
		sendEvent("error", string(errData))
		h.writeChatLog(ctx, userID, sessionID, usage, latencyMs, err.Error())
		return
	}
	doneData, _ := json.Marshal(map[string]interface{}{
		"content":   fullReply.String(),
		"finished":  true,
		"timestamp": time.Now().Unix(),
	})
	sendEvent("done", string(doneData))
	h.writeChatLog(ctx, userID, sessionID, usage, latencyMs, "")
}

func (h *ChatDoubaoHandler) writeChatLog(ctx context.Context, userID, sessionID string, usage services.AIUsage, latencyMs int64, errMsg string) {
	go func() {
		var errPtr *string
		if errMsg != "" {
			errPtr = &errMsg
		}
		_, dbErr := h.db.ExecContext(ctx, `
			INSERT INTO chat_logs
				(user_id, session_id, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, is_stream, error)
			VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)`,
			userID, sessionID, h.aiSvc.Model(),
			usage.PromptTokens, usage.CompletionTokens, usage.TotalTokens,
			latencyMs, errPtr,
		)
		if dbErr != nil {
			log.Printf("[chat_logs] write failed: %v", dbErr)
		}
	}()
}

func (h *ChatDoubaoHandler) ListModels(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"models": []map[string]string{
			{
				"id":          "doubao-seed-2-1-turbo-260628",
				"name":        "豆包 Seed 2.1 Turbo",
				"description": "多模态，支持图文理解，速度快",
			},
		},
		"current": h.aiSvc.Model(),
	})
}

func (h *ChatDoubaoHandler) checkChatEnabled(c *gin.Context, userID string) bool {
	if userID == "" || userID == "<nil>" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return false
	}
	var enabled bool
	err := h.db.QueryRowContext(c.Request.Context(),
		`SELECT COALESCE(chat_enabled, false) FROM users WHERE id=$1`, userID).Scan(&enabled)
	if err != nil || !enabled {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "无 Chat 访问权限，请联系管理员开通",
			"code":  "CHAT_DISABLED",
		})
		return false
	}
	return true
}
