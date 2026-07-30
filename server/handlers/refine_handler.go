package handlers

import (
	"context"
	"fmt"
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

	resp := gin.H{
		"markdown": result.Markdown,
		"model":    result.Model,
		"provider": "doubao",
	}
	// REQ-057：被上游 max_tokens 截断时如实告知。
	// 此前截断结果一路以 200 + 完整外观返回，老师拿到少一截的内容毫不知情——
	// 看得见的截断他会反馈，看不见的只会被归因成「AI 不好使」。
	if result.Truncated {
		resp["truncated"] = true
		resp["warning"] = refineTruncationWarning(result)
	}
	c.JSON(http.StatusOK, resp)
}

// refineTruncationWarning 按截断发生的阶段给不同的用户可读提示。
// 分阶段是有必要的：合并阶段截断＝结尾断掉，老师看一眼末尾就能确认；
// 压缩阶段截断＝中间少了内容但成文通顺，必须明说「可能缺细节」他才会去核对原文。
func refineTruncationWarning(r *services.RefineResult) string {
	switch r.TruncatedStage {
	case "direct", "synthesis":
		return "内容较多，提炼结果的结尾可能被截断，请检查末尾是否完整；必要时缩短原文后重试"
	case "compress":
		return fmt.Sprintf("原文较长，分段处理时有 %d 段未能完整保留，提炼结果可能缺少部分细节，建议对照原文核对", r.TruncatedChunks)
	default: // compress+synthesis
		return fmt.Sprintf("原文较长，有 %d 段未能完整保留且结尾可能被截断，建议把原文分成两三批分别提炼", r.TruncatedChunks)
	}
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
