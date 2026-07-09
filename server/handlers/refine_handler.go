package handlers

import (
	"context"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"mindcanvas-server/services"
)

// ============================================================
// RefineHandler — POST /api/ai/refine
// REQ-028（第一步）：普通文本 → Markdown AI 提炼
// 供前端在生成图形前先把杂乱文本整理成结构化 Markdown，用户可预览/编辑后
// 再走既有的 /api/ai/diagram 生成思维导图等图形（复用 diagramBuilder 的
// Excalidraw 画布注入路径，本接口只负责“提炼”这一步，不直接产出图形）。
// ============================================================

// RefineHandler 处理器
type RefineHandler struct {
	aiSvc *services.AIService
}

// NewRefineHandler 构造（注入 AIService）
func NewRefineHandler(aiSvc *services.AIService) *RefineHandler {
	return &RefineHandler{aiSvc: aiSvc}
}

// RefineRequest 请求体
type RefineRequest struct {
	Text string `json:"text" binding:"required"`
}

// Refine 处理请求
//
//	POST /api/ai/refine
//	Auth: AuthRequired (Cookie JWT)
func (h *RefineHandler) Refine(c *gin.Context) {
	var req RefineRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数缺失：需要 text"})
		return
	}

	n := utf8.RuneCountInString(req.Text)
	if n == 0 || n > 20000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文本长度应为 1 至 20,000 个字符"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	result, err := h.aiSvc.RefineToMarkdown(ctx, req.Text)
	if err != nil {
		status, msg := mapRefineError(err)
		c.JSON(status, gin.H{"error": msg})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"markdown": result.Markdown,
		"model":    result.Model,
		"provider": "doubao",
	})
}

// mapRefineError 把 services.RefineError 映射为对外 HTTP 状态码与用户可读文案，
// 对应 markdown-mindmap 项目 api/refine.ts 里的错误分支处理
func mapRefineError(err error) (int, string) {
	re, ok := err.(*services.RefineError)
	if !ok {
		return http.StatusBadGateway, "豆包暂时无法完成提炼，请稍后重试"
	}
	switch re.Kind {
	case services.RefineErrTimeout:
		return http.StatusGatewayTimeout, "豆包处理超时，请缩短文本后重试"
	case services.RefineErrUpstream:
		if re.Status == 429 {
			return http.StatusTooManyRequests, "豆包请求过于频繁，请稍后重试"
		}
		if re.Status == 503 {
			return http.StatusServiceUnavailable, "智能提炼服务尚未配置"
		}
	}
	return http.StatusBadGateway, "豆包暂时无法完成提炼，请稍后重试"
}
