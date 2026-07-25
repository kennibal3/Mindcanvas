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
	"mindcanvas-server/middleware"
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
	// REQ-050 一期：结构体检的自动修复记录与遗留问题，前端据此提示老师
	Repairs []DiagramRepair `json:"repairs,omitempty"`
	Issues  []DiagramIssue  `json:"issues,omitempty"`
	// Regenerated＝首轮结构烂到修不动，已自动回 AI 重生成过一次
	Regenerated bool `json:"regenerated,omitempty"`
	// GenerationID＝本次采集记录 id（REQ-050 B），前端据此回报老师后续动作；
	// 采集失败时为空串，前端应静默跳过上报
	GenerationID string `json:"generation_id,omitempty"`
}

// DiagramRequest 请求体
type DiagramRequest struct {
	Markdown    string `json:"markdown"    binding:"required"`
	DiagramType string `json:"diagram_type" binding:"required"`
	RoomID      string `json:"room_id"` // 可选，仅用于采集归因
}

// DiagramOutcomeRequest 老师后续动作上报（REQ-050 B）
type DiagramOutcomeRequest struct {
	Outcome string `json:"outcome" binding:"required"`
}

// DiagramHandler 处理器
type DiagramHandler struct {
	aiSvc     *services.AIService
	sampleSvc *services.DiagramSampleService
}

// NewDiagramHandler 构造（注入 AIService + 采集服务）
func NewDiagramHandler(aiSvc *services.AIService, sampleSvc *services.DiagramSampleService) *DiagramHandler {
	return &DiagramHandler{aiSvc: aiSvc, sampleSvc: sampleSvc}
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

	log.Printf("[DiagramHandler] type=%s mdLen=%d", req.DiagramType, utf8.RuneCountInString(md))
	startedAt := time.Now()
	ctx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
	ctx = services.WithFastMode(ctx) // 关闭深度思考，图形生成提速
	defer cancel()

	// ── 第一轮生成 ──
	result, raw, httpErr := h.generateOnce(ctx, systemPrompt, md, req.DiagramType)
	if httpErr != nil {
		c.JSON(httpErr.status, httpErr.body)
		return
	}

	// ── REQ-050 一期 A 防护网：转图前结构体检 + 自动修复 ──
	check := validateAndRepairDiagram(req.DiagramType, result.Nodes, result.Edges)

	// 修不动（如只返回一个节点）→ 带着上轮的毛病回 AI 重生成一次
	if check.Fatal != "" {
		log.Printf("[DiagramHandler] structure fatal=%q, regenerating once", check.Fatal)
		retryPrompt := systemPrompt + "\n\n上一次生成的结果不可用（" + check.Fatal +
			"）。请重新生成，务必满足节点数量要求与上述全部结构约束。"
		retryResult, retryRaw, retryErr := h.generateOnce(ctx, retryPrompt, md, req.DiagramType)
		if retryErr == nil {
			retryCheck := validateAndRepairDiagram(req.DiagramType, retryResult.Nodes, retryResult.Edges)
			if retryCheck.Fatal == "" {
				result, raw, check = retryResult, retryRaw, retryCheck
				result.Regenerated = true
			} else {
				check = retryCheck
			}
		}
		if check.Fatal != "" {
			log.Printf("[DiagramHandler] structure still fatal after retry: %s, raw=%s", check.Fatal, raw)
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"error": "AI 两次都没能生成可用的结构（" + check.Fatal + "），请调整输入文本或换一种图型",
				"raw":   raw,
			})
			return
		}
	}

	result.Nodes = check.Nodes
	result.Edges = check.Edges
	result.Repairs = check.Repairs
	result.Issues = check.Issues
	if len(check.Repairs) > 0 || len(check.Issues) > 0 {
		log.Printf("[DiagramHandler] structure check: type=%s nodes=%d repairs=%d issues=%d",
			req.DiagramType, len(result.Nodes), len(check.Repairs), len(check.Issues))
	}

	// ── REQ-050 一期 B：采集信号（旁路，失败只记日志绝不影响出图）──
	result.GenerationID = h.recordSample(c, req, md, &result, check, int(time.Since(startedAt).Milliseconds()))

	c.JSON(http.StatusOK, result)
}

// recordSample 落一条生成记录，返回记录 id（失败返回空串）。
// 这是旁路：老师正在上课，采集不通不能变成生成不出图。
func (h *DiagramHandler) recordSample(
	c *gin.Context,
	req DiagramRequest,
	md string,
	result *DiagramResponse,
	check diagramCheck,
	elapsedMs int,
) string {
	if h.sampleSvc == nil {
		return ""
	}
	teacherID := middleware.GetUserID(c)
	if teacherID == "" {
		return ""
	}

	repairsJSON, _ := json.Marshal(check.Repairs)
	issuesJSON, _ := json.Marshal(check.Issues)
	resultJSON, _ := json.Marshal(gin.H{"nodes": result.Nodes, "edges": result.Edges})

	id, err := h.sampleSvc.Record(services.DiagramSample{
		TeacherID:   teacherID,
		RoomID:      req.RoomID,
		DiagramType: req.DiagramType,
		InputText:   truncateRunes(md, 4000),
		InputChars:  utf8.RuneCountInString(req.Markdown),
		NodeCount:   len(result.Nodes),
		EdgeCount:   len(result.Edges),
		RepairsJSON: repairsJSON,
		IssuesJSON:  issuesJSON,
		RepairCount: len(check.Repairs),
		IssueCount:  len(check.Issues),
		Regenerated: result.Regenerated,
		ResultJSON:  resultJSON,
		ElapsedMs:   elapsedMs,
	})
	if err != nil {
		log.Printf("[DiagramHandler] 采集入库失败（不影响出图）: %v", err)
		return ""
	}
	return id
}

// RecordOutcome 记录老师拿到图之后干了什么
//
//	POST /api/ai/diagram/:gid/outcome
//	Auth: AuthRequired（归属校验在 service 的 UPDATE ... WHERE teacher_id）
func (h *DiagramHandler) RecordOutcome(c *gin.Context) {
	if h.sampleSvc == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true}) // 采集未启用，静默成功
		return
	}
	gid := c.Param("gid")
	var req DiagramOutcomeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数缺失：需要 outcome"})
		return
	}
	if !services.IsValidDiagramOutcome(req.Outcome) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的 outcome：" + req.Outcome})
		return
	}
	teacherID := middleware.GetUserID(c)
	if err := h.sampleSvc.SetOutcome(gid, teacherID, req.Outcome); err != nil {
		// 采集是旁路：失败不打扰老师，日志留痕即可
		log.Printf("[DiagramHandler] outcome 记录失败 gid=%s outcome=%s: %v", gid, req.Outcome, err)
		c.JSON(http.StatusOK, gin.H{"ok": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// httpError 内部错误载体（让 generateOnce 能把 4xx/5xx 原样交回 Generate 决定怎么发）
type httpError struct {
	status int
	body   gin.H
}

// generateOnce 调一次 AI 并把回复解析成 DiagramResponse（不含结构体检）
func (h *DiagramHandler) generateOnce(
	ctx context.Context,
	systemPrompt, md, diagramType string,
) (DiagramResponse, string, *httpError) {
	var result DiagramResponse

	raw, _, err := h.aiSvc.Analyze(ctx, systemPrompt, md)
	if err != nil {
		log.Printf("[DiagramHandler] AI error: %v", err)
		return result, raw, &httpError{http.StatusInternalServerError, gin.H{"error": "AI 调用失败: " + err.Error()}}
	}

	// 提取 JSON（去除 ```json 围栏、多嘴内容）
	jsonStr := extractJSONObject(raw)
	if jsonStr == "" {
		log.Printf("[DiagramHandler] JSON extract failed, raw=%s", raw)
		return result, raw, &httpError{http.StatusUnprocessableEntity, gin.H{
			"error": "AI 返回格式异常，无法解析 JSON",
			"raw":   raw,
		}}
	}

	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		log.Printf("[DiagramHandler] JSON parse failed: %v, json=%s", err, jsonStr)
		return result, raw, &httpError{http.StatusUnprocessableEntity, gin.H{
			"error": "JSON 解析失败: " + err.Error(),
			"raw":   raw,
		}}
	}

	// 保证字段完整
	if result.DiagramType == "" {
		result.DiagramType = diagramType
	}
	if result.Nodes == nil {
		result.Nodes = []DiagramNode{}
	}
	if result.Edges == nil {
		result.Edges = []DiagramEdge{}
	}
	return result, raw, nil
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
