// =============================================================
// MindCanvas REQ-045 P2 - 班级 / 花名册处理器
// API（认证组，教师私有）：
//   POST   /api/classes                         建班
//   GET    /api/classes                         列班（含学生数）
//   DELETE /api/classes/:cid                    删班（先解绑房间）
//   GET    /api/classes/:cid/students           花名册
//   POST   /api/classes/:cid/students           单个添加
//   POST   /api/classes/:cid/students/import    粘名批量导入
//   DELETE /api/classes/:cid/students/:sid      删学生
// =============================================================
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/middleware"
	"mindcanvas-server/models"
	"mindcanvas-server/services"
)

// ClassHandler 班级/花名册处理器。
type ClassHandler struct {
	svc *services.ClassService
}

// NewClassHandler 构造。
func NewClassHandler(svc *services.ClassService) *ClassHandler {
	return &ClassHandler{svc: svc}
}

// CreateClass POST /api/classes
func (h *ClassHandler) CreateClass(c *gin.Context) {
	var req models.CreateClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误", "message": "班级名称不能为空"})
		return
	}
	teacherID := middleware.GetUserID(c)
	tenantID := middleware.GetTenantID(c)
	class, err := h.svc.CreateClass(teacherID, tenantID, req.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "创建失败", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "创建成功", "data": class})
}

// ListClasses GET /api/classes
func (h *ClassHandler) ListClasses(c *gin.Context) {
	teacherID := middleware.GetUserID(c)
	classes, err := h.svc.ListClasses(teacherID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": classes})
}

// DeleteClass DELETE /api/classes/:cid
func (h *ClassHandler) DeleteClass(c *gin.Context) {
	classID := c.Param("cid")
	teacherID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	if err := h.svc.DeleteClass(classID, teacherID, role); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "删除失败", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// ListStudents GET /api/classes/:cid/students
func (h *ClassHandler) ListStudents(c *gin.Context) {
	classID := c.Param("cid")
	teacherID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	students, err := h.svc.ListStudents(classID, teacherID, role)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "查询失败", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": students})
}

// ImportStudents POST /api/classes/:cid/students/import
func (h *ClassHandler) ImportStudents(c *gin.Context) {
	classID := c.Param("cid")
	var req models.ImportStudentsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误", "message": "names 不能为空"})
		return
	}
	teacherID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	inserted, skipped, err := h.svc.ImportStudents(classID, teacherID, role, req.Names)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "导入失败", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "导入完成", "inserted": inserted, "skipped": skipped})
}

// AddStudent POST /api/classes/:cid/students
func (h *ClassHandler) AddStudent(c *gin.Context) {
	classID := c.Param("cid")
	var req models.AddStudentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误", "message": "学生姓名不能为空"})
		return
	}
	teacherID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	st, err := h.svc.AddStudent(classID, teacherID, role, req.StudentName, req.Disambig)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "添加失败", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "添加成功", "data": st})
}

// DeleteStudent DELETE /api/classes/:cid/students/:sid
func (h *ClassHandler) DeleteStudent(c *gin.Context) {
	classID := c.Param("cid")
	studentID := c.Param("sid")
	teacherID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	if err := h.svc.DeleteStudent(classID, studentID, teacherID, role); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "删除失败", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}
