// =============================================================
// MindCanvas REQ-039 第三期 3a - 讲评报告编辑处理器
// API（挂在 assignments 路由组内，自动继承 AuthRequired + RequireRole(teacher…)）：
//   PATCH  /api/assignments/:aid/lecture/blocks/:bid            更新块（标题/内容/移动/确认）
//   DELETE /api/assignments/:aid/lecture/blocks/:bid            删除块
//   POST   /api/assignments/:aid/lecture/blocks/:bid/regenerate 单块重新生成（异步，返回 job_id）
//   GET    /api/assignments/:aid/lecture/jobs/:jid              查询重生成任务状态（供轮询）
//   POST   /api/assignments/:aid/lecture/confirm                确认整份报告
// =============================================================
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/middleware"
	"mindcanvas-server/services"
)

// UpdateLectureBlock PATCH /api/assignments/:aid/lecture/blocks/:bid
func (h *AssignmentHandler) UpdateLectureBlock(c *gin.Context) {
	aid := c.Param("aid")
	bid := c.Param("bid")
	teacherID := middleware.GetUserID(c)
	var req services.UpdateLectureBlockRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误: " + err.Error()})
		return
	}
	if err := h.svc.UpdateLectureBlock(c.Request.Context(), aid, bid, teacherID, req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "已更新"})
}

// DeleteLectureBlock DELETE /api/assignments/:aid/lecture/blocks/:bid
func (h *AssignmentHandler) DeleteLectureBlock(c *gin.Context) {
	aid := c.Param("aid")
	bid := c.Param("bid")
	teacherID := middleware.GetUserID(c)
	if err := h.svc.DeleteLectureBlock(c.Request.Context(), aid, bid, teacherID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

// RegenerateLectureBlock POST /api/assignments/:aid/lecture/blocks/:bid/regenerate
func (h *AssignmentHandler) RegenerateLectureBlock(c *gin.Context) {
	aid := c.Param("aid")
	bid := c.Param("bid")
	teacherID := middleware.GetUserID(c)
	jobID, err := h.svc.EnqueueLectureBlockRegen(c.Request.Context(), aid, bid, teacherID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"job_id":  jobID,
		"status":  "queued",
		"message": "该内容块正在重新生成",
	})
}

// GetLectureJob GET /api/assignments/:aid/lecture/jobs/:jid
func (h *AssignmentHandler) GetLectureJob(c *gin.Context) {
	aid := c.Param("aid")
	jid := c.Param("jid")
	status, lastError, err := h.svc.GetLectureJobStatus(c.Request.Context(), aid, jid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": status, "last_error": lastError})
}

// ConfirmLectureReport POST /api/assignments/:aid/lecture/confirm
func (h *AssignmentHandler) ConfirmLectureReport(c *gin.Context) {
	aid := c.Param("aid")
	teacherID := middleware.GetUserID(c)
	if err := h.svc.ConfirmLectureReport(c.Request.Context(), aid, teacherID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "报告已确认"})
}
