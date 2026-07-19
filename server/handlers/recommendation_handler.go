// =============================================================
// MindCanvas REQ-039 第三期 3b - 推荐练习处理器
// API（挂在 assignments 路由组内，自动继承 AuthRequired + RequireRole(teacher…)）：
//   POST   /api/assignments/:aid/recommendations/generate     生成推荐题（异步，返回 job_id）
//   GET    /api/assignments/:aid/recommendations/jobs/:jid    查询生成任务状态（供轮询）
//   GET    /api/assignments/:aid/recommendations              列出推荐题
//   PATCH  /api/assignments/:aid/recommendations/:rid         审核（采用/拒绝/修改）
//   POST   /api/assignments/:aid/recommendations/publish      发布为新作业
// =============================================================
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/middleware"
	"mindcanvas-server/services"
)

// GenerateRecommendations POST /api/assignments/:aid/recommendations/generate
func (h *AssignmentHandler) GenerateRecommendations(c *gin.Context) {
	aid := c.Param("aid")
	teacherID := middleware.GetUserID(c)
	jobID, err := h.svc.EnqueueRecommendationGenerate(c.Request.Context(), aid, teacherID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"job_id":  jobID,
		"status":  "queued",
		"message": "正在生成推荐练习题",
	})
}

// GetRecommendationJob GET /api/assignments/:aid/recommendations/jobs/:jid
func (h *AssignmentHandler) GetRecommendationJob(c *gin.Context) {
	aid := c.Param("aid")
	jid := c.Param("jid")
	status, lastError, err := h.svc.GetRecommendationJobStatus(c.Request.Context(), aid, jid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": status, "last_error": lastError})
}

// ListRecommendations GET /api/assignments/:aid/recommendations
func (h *AssignmentHandler) ListRecommendations(c *gin.Context) {
	aid := c.Param("aid")
	list, err := h.svc.ListRecommendations(c.Request.Context(), aid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"questions": list, "total": len(list)})
}

// UpdateRecommendation PATCH /api/assignments/:aid/recommendations/:rid
func (h *AssignmentHandler) UpdateRecommendation(c *gin.Context) {
	aid := c.Param("aid")
	rid := c.Param("rid")
	teacherID := middleware.GetUserID(c)
	var req services.UpdateRecommendationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误: " + err.Error()})
		return
	}
	if err := h.svc.UpdateRecommendation(c.Request.Context(), aid, rid, teacherID, req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "已更新"})
}

// PublishRecommendations POST /api/assignments/:aid/recommendations/publish
func (h *AssignmentHandler) PublishRecommendations(c *gin.Context) {
	aid := c.Param("aid")
	teacherID := middleware.GetUserID(c)
	var req services.PublishRecommendationsRequest
	// 允许空 body（全量发布 accepted 题）
	_ = c.ShouldBindJSON(&req)
	result, err := h.svc.PublishRecommendations(c.Request.Context(), aid, teacherID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"result":  result,
		"message": "已发布为新作业（草稿），可前往新作业开放提交",
	})
}
