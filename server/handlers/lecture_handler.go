// =============================================================
// MindCanvas REQ-039 第二期 - 讲评分析处理器
// API：
//   POST /api/assignments/:aid/lecture/analyze  发起讲评分析（异步）
//   GET  /api/assignments/:aid/lecture/report   获取讲评报告+内容块（供轮询/展示）
// 挂在 assignments 路由组内，自动继承 AuthRequired + RequireRole(teacher…)
// =============================================================
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/middleware"
)

// LectureAnalyze POST /api/assignments/:aid/lecture/analyze
func (h *AssignmentHandler) LectureAnalyze(c *gin.Context) {
	aid := c.Param("aid")
	teacherID := middleware.GetUserID(c)
	reportID, err := h.svc.EnqueueLectureAnalyze(c.Request.Context(), aid, teacherID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"report_id": reportID,
		"status":    "analyzing",
		"message":   "讲评分析已开始生成，约 1-3 分钟",
	})
}

// GetLectureReport GET /api/assignments/:aid/lecture/report
func (h *AssignmentHandler) GetLectureReport(c *gin.Context) {
	aid := c.Param("aid")
	report, err := h.svc.GetLectureReport(c.Request.Context(), aid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// report 为 nil 时序列化为 {"report":null}，前端据此判定"尚未生成"
	c.JSON(http.StatusOK, gin.H{"report": report})
}
