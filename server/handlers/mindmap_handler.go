package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"mindcanvas-server/services"
)

// ============================================================
// MindmapHandler — POST /api/ai/mindmap（REQ-068 第二步）
// 原始文字 → 多步流水线 → 带说明/图标/重点的缩进大纲，SSE 推送真实步骤进度。
// 超长输入不在这里自动提炼：返回 413 + code=too_long，由前端先走 /api/ai/refine 再重试。
// ============================================================

// MindmapMaxInputRunes 单次输入上限（超过须先智能提炼）
const MindmapMaxInputRunes = 12000

type MindmapHandler struct {
	aiSvc *services.AIService
}

func NewMindmapHandler(aiSvc *services.AIService) *MindmapHandler {
	return &MindmapHandler{aiSvc: aiSvc}
}

type MindmapRequest struct {
	Text string `json:"text" binding:"required"`
}

// mindmapErrorMessage 把流水线错误映射成面向老师的文案
func mindmapErrorMessage(err error) string {
	var me *services.MindmapError
	if errors.As(err, &me) {
		switch me.Stage {
		case "skeleton":
			return "没能理出清晰的结构，请换一段更完整的文字，或先点「智能提炼」再生成"
		case "thin":
			return "内容太少，生成不出像样的导图，请补充一些文字后重试"
		}
	}
	var re *services.RefineError
	if errors.As(err, &re) {
		switch re.Kind {
		case services.RefineErrTimeout:
			return "豆包处理超时，请缩短文本后重试"
		case services.RefineErrUpstream:
			if re.Status == 429 {
				return "豆包请求过于频繁，请稍后重试"
			}
			if re.Status == 503 {
				return "智能生成服务尚未配置"
			}
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "生成时间过长，请缩短文本后重试"
	}
	return "豆包暂时无法完成生成，请稍后重试"
}

// Generate 处理请求（SSE：progress / result / error）
func (h *MindmapHandler) Generate(c *gin.Context) {
	var req MindmapRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数缺失：需要 text"})
		return
	}
	n := utf8.RuneCountInString(req.Text)
	if n == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文本不能为空"})
		return
	}
	if n > MindmapMaxInputRunes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{
			"error": fmt.Sprintf("文本超过 %d 字，请先智能提炼", MindmapMaxInputRunes),
			"code":  "too_long",
		})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	flusher, _ := c.Writer.(http.Flusher)
	send := func(event string, payload interface{}) {
		b, _ := json.Marshal(payload)
		fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, b)
		if flusher != nil {
			flusher.Flush()
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 180*time.Second)
	defer cancel()

	start := time.Now()
	res, err := h.aiSvc.GenerateMindmapOutline(ctx, req.Text, func(e services.MindmapEvent) {
		send("progress", e)
	})
	if err != nil {
		log.Printf("[mindmap] failed after %s: %v", time.Since(start).Round(time.Millisecond), err)
		send("error", gin.H{"error": mindmapErrorMessage(err)})
		return
	}
	log.Printf("[mindmap] ok in %s: framework=%s branches=%d nodes=%d flagged=%d rewritten=%d failed=%d truncated=%d supplement=%d emphasis_dropped=%d topic=%v",
		time.Since(start).Round(time.Millisecond), res.Framework, res.Branches, res.Nodes,
		res.Flagged, res.Rewritten, len(res.FailedBranches), len(res.TruncatedBranches), res.SupplementNotes, res.EmphasisDropped, res.TopicMode)
	send("result", gin.H{
		"outline":          res.Outline,
		"framework":        res.Framework,
		"root":             res.Root,
		"branches":         res.Branches,
		"nodes":            res.Nodes,
		"rewritten":        res.Rewritten,
		"supplement_notes": res.SupplementNotes,
		"topic_mode":       res.TopicMode,
		"warnings":         res.Warnings,
	})
}
