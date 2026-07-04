package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"mindcanvas-server/services"
)

// ============================================================
// DiagramHandler — POST /api/ai/diagram
// 统一 AI 图形生成入口（思维导图/流程图/时间轴/组织架构/鱼骨图）
// ============================================================

// DiagramNode 统一节点结构（兼容所有图形类型）
type DiagramNode struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Parent   string `json:"parent"`
	Level    int    `json:"level,omitempty"`
	NodeType string `json:"node_type,omitempty"` // flowchart: start|end|process|decision
	Role     string `json:"role,omitempty"`      // orgchart: lead|dept|member
	Side     string `json:"side,omitempty"`      // fishbone: top|bottom
	Sequence int    `json:"sequence,omitempty"`  // timeline: 排序
	Time     string `json:"time,omitempty"`      // timeline: 时间标注
}

// DiagramEdge 额外边（主要用于 flowchart 分支）
type DiagramEdge struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Label string `json:"label,omitempty"`
}

// DiagramResponse 返回给前端
type DiagramResponse struct {
	DiagramType string        `json:"diagram_type"`
	Nodes       []DiagramNode `json:"nodes"`
	Edges       []DiagramEdge `json:"edges"`
}

// DiagramRequest 请求体
type DiagramRequest struct {
	Markdown    string `json:"markdown"    binding:"required"`
	DiagramType string `json:"diagram_type" binding:"required"`
}

// DiagramHandler 处理器
type DiagramHandler struct {
	aiSvc *services.AIService
}

// NewDiagramHandler 构造（注入 AIService）
func NewDiagramHandler(aiSvc *services.AIService) *DiagramHandler {
	return &DiagramHandler{aiSvc: aiSvc}
}

// Generate 处理请求
//
//	POST /api/ai/diagram
//	Auth: AuthRequired (Cookie JWT)
func (h *DiagramHandler) Generate(c *gin.Context) {
	var req DiagramRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数缺失：需要 markdown 和 diagram_type"})
		return
	}

	// 校验图形类型
	validTypes := map[string]bool{
		services.DiagramTypeMindmap:   true,
		services.DiagramTypeFlowchart: true,
		services.DiagramTypeTimeline:  true,
		services.DiagramTypeOrgchart:  true,
		services.DiagramTypeFishbone:  true,
	}
	if !validTypes[req.DiagramType] {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("不支持的图形类型 %q，可选值：mindmap/flowchart/timeline/orgchart/fishbone", req.DiagramType),
		})
		return
	}

	// 截断防超 token（按 rune，8000 字）
	md := truncateRunes(req.Markdown, 8000)
	if md == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "markdown 内容为空"})
		return
	}

	// 获取对应系统提示词
	systemPrompt := services.GetDiagramPrompt(req.DiagramType)

	// 调用 AI（非流式）
	log.Printf("[DiagramHandler] type=%s mdLen=%d", req.DiagramType, utf8.RuneCountInString(md))
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	raw, _, err := h.aiSvc.Analyze(ctx, systemPrompt, md)
	if err != nil {
		log.Printf("[DiagramHandler] AI error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 调用失败: " + err.Error()})
		return
	}

	// 提取 JSON（去除 ```json 围栏、多嘴内容）
	jsonStr := extractJSONObject(raw)
	if jsonStr == "" {
		log.Printf("[DiagramHandler] JSON extract failed, raw=%s", raw)
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error": "AI 返回格式异常，无法解析 JSON",
			"raw":   raw,
		})
		return
	}

	// 解析 JSON
	var result DiagramResponse
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		log.Printf("[DiagramHandler] JSON parse failed: %v, json=%s", err, jsonStr)
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error": "JSON 解析失败: " + err.Error(),
			"raw":   raw,
		})
		return
	}

	// 保证字段完整
	if result.DiagramType == "" {
		result.DiagramType = req.DiagramType
	}
	if result.Nodes == nil {
		result.Nodes = []DiagramNode{}
	}
	if result.Edges == nil {
		result.Edges = []DiagramEdge{}
	}

	// 校验：至少有一个节点
	if len(result.Nodes) == 0 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error": "AI 返回了空节点列表",
			"raw":   raw,
		})
		return
	}

	c.JSON(http.StatusOK, result)
}

// ──────────────────────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────────────────────

// extractJSONObject 从 AI 回复中提取首个 { ... } JSON 对象
// 兼容 ```json ... ``` 代码围栏、前缀说明文字等
func extractJSONObject(s string) string {
	// 先去除 markdown 代码围栏
	re := regexp.MustCompile("(?s)```(?:json)?\\s*(\\{.*?\\})\\s*```")
	if m := re.FindStringSubmatch(s); len(m) > 1 {
		return strings.TrimSpace(m[1])
	}
	// 直接找第一个 { 到最后一个 }
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start >= 0 && end > start {
		return strings.TrimSpace(s[start : end+1])
	}
	return ""
}

// truncateRunes 按 Unicode 字符数截断字符串
func truncateRunes(s string, max int) string {
	count := 0
	for i := range s {
		if count >= max {
			return s[:i]
		}
		count++
	}
	return s
}
