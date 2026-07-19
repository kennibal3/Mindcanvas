// =============================================================
// MindCanvas REQ-039 第三期 3c - 学生补救处理器
// 教师侧 API（挂 assignments 路由组，自动继承 AuthRequired + RequireRole）：
//   GET    /api/assignments/:aid/remediations                        学生列表（含补救状态）
//   POST   /api/assignments/:aid/students/:sid/remediation/generate  生成（异步，返回 job_id）
//   GET    /api/assignments/:aid/remediation/jobs/:jid               轮询生成状态
//   GET    /api/assignments/:aid/students/:sid/remediation           详情（含诊断，仅教师）
//   PATCH  /api/assignments/:aid/students/:sid/remediation           编辑温和版/备注
//   POST   /api/assignments/:aid/students/:sid/remediation/send      发送给学生
//
// 学生侧公开 API（挂 /api/submit 组，完全公开，token+uuid 双证）：
//   GET    /api/submit/:aid/remediation?token=XXX（uuid 走 X-Student-UUID 或 ?uuid=）
//
// 注：:sid 为学生 uuid，含中文/连字符，前端务必 encodeURIComponent。
// =============================================================
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/middleware"
	"mindcanvas-server/services"
)

// ListRemediations GET /api/assignments/:aid/remediations
func (h *AssignmentHandler) ListRemediations(c *gin.Context) {
	aid := c.Param("aid")
	list, err := h.svc.ListRemediations(c.Request.Context(), aid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"students": list, "total": len(list)})
}

// GenerateStudentRemediation POST /api/assignments/:aid/students/:sid/remediation/generate
func (h *AssignmentHandler) GenerateStudentRemediation(c *gin.Context) {
	aid := c.Param("aid")
	sid := c.Param("sid")
	teacherID := middleware.GetUserID(c)
	jobID, err := h.svc.EnqueueStudentRemediation(c.Request.Context(), aid, sid, teacherID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"job_id":  jobID,
		"status":  "queued",
		"message": "正在生成该学生的补救建议",
	})
}

// GetRemediationJob GET /api/assignments/:aid/remediation/jobs/:jid
func (h *AssignmentHandler) GetRemediationJob(c *gin.Context) {
	aid := c.Param("aid")
	jid := c.Param("jid")
	status, lastError, err := h.svc.GetRemediationJobStatus(c.Request.Context(), aid, jid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": status, "last_error": lastError})
}

// GetStudentRemediation GET /api/assignments/:aid/students/:sid/remediation
func (h *AssignmentHandler) GetStudentRemediation(c *gin.Context) {
	aid := c.Param("aid")
	sid := c.Param("sid")
	view, err := h.svc.GetStudentRemediation(c.Request.Context(), aid, sid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"remediation": view})
}

// UpdateStudentRemediation PATCH /api/assignments/:aid/students/:sid/remediation
func (h *AssignmentHandler) UpdateStudentRemediation(c *gin.Context) {
	aid := c.Param("aid")
	sid := c.Param("sid")
	teacherID := middleware.GetUserID(c)
	var req services.UpdateRemediationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误: " + err.Error()})
		return
	}
	if err := h.svc.UpdateStudentRemediation(c.Request.Context(), aid, sid, teacherID, req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "已保存"})
}

// SendStudentRemediation POST /api/assignments/:aid/students/:sid/remediation/send
func (h *AssignmentHandler) SendStudentRemediation(c *gin.Context) {
	aid := c.Param("aid")
	sid := c.Param("sid")
	teacherID := middleware.GetUserID(c)
	sentAt, err := h.svc.SendStudentRemediation(c.Request.Context(), aid, sid, teacherID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"sent_at": sentAt,
		"message": "已发送，学生用作业码进入提交页即可看到",
	})
}

// GetStudentRemediationPublic GET /api/submit/:aid/remediation
// 完全公开，凭「作业码 + 学生 uuid」双证；只返回温和版反馈与题面，不含诊断/答案。
// 挂在 AssignmentHandler 而非 TokenHandler：本方法要用 AssignmentService，
// 这样无需改 main.go 的服务装配（TokenHandler 只持有 TokenService）。
func (h *AssignmentHandler) GetStudentRemediationPublic(c *gin.Context) {
	aid := c.Param("aid")
	token := c.Query("token")

	studentUUID := c.GetHeader("X-Student-UUID")
	if studentUUID == "" {
		studentUUID = c.Query("uuid")
	}
	if token == "" || studentUUID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少作业码或学生身份"})
		return
	}

	view, err := h.svc.GetStudentRemediationPublic(c.Request.Context(), aid, token, studentUUID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"remediation": view})
}
