// =============================================================
// MindCanvas Phase8 - 作业评价中心处理器
// API：
//   POST   /api/assignments                    创建作业
//   GET    /api/assignments                    列出作业（可?room_id=过滤）
//   GET    /api/assignments/:aid               作业详情
//   PATCH  /api/assignments/:aid/status        更新状态
//   DELETE /api/assignments/:aid               删除作业
//   POST   /api/assignments/:aid/materials     上传材料（文件）
//   POST   /api/assignments/:aid/materials/text 添加文字材料
//   GET    /api/assignments/:aid/materials     列出材料
//   DELETE /api/assignments/:aid/materials/:mid 删除材料
//   POST   /api/assignments/:aid/materials/:mid/parse 触发重新解析
//   POST   /api/assignments/:aid/rubric/generate 生成默认Rubric
//   PUT    /api/assignments/:aid/rubric        教师确认Rubric
//   GET    /api/assignments/:aid/rubric        获取最新Rubric
//   POST   /api/assignments/:aid/submit        学生提交作业
//   GET    /api/assignments/:aid/submissions   列出所有提交
//   GET    /api/assignments/:aid/parser/health 检查解析服务状态
// =============================================================
package handlers

import (
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"
	"io"
	"os"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/middleware"
	"mindcanvas-server/models"
	"mindcanvas-server/services"
)

// AssignmentHandler 作业评价处理器
type AssignmentHandler struct {
	svc *services.AssignmentService
}

// NewAssignmentHandler 构造函数
func NewAssignmentHandler(svc *services.AssignmentService) *AssignmentHandler {
	return &AssignmentHandler{svc: svc}
}

// =============================================================
// 作业 CRUD
// =============================================================

// CreateAssignment POST /api/assignments
func (h *AssignmentHandler) CreateAssignment(c *gin.Context) {
	userID := middleware.GetUserID(c)
	var req models.CreateAssignmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}
	a, err := h.svc.CreateAssignment(userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"assignment": a})
}

// ListAssignments GET /api/assignments?room_id=
func (h *AssignmentHandler) ListAssignments(c *gin.Context) {
	userID := middleware.GetUserID(c)
	roomID := c.Query("room_id")
	var roomIDPtr *string
	if roomID != "" {
		roomIDPtr = &roomID
	}
	list, err := h.svc.ListAssignments(userID, roomIDPtr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"assignments": list, "total": len(list)})
}

// GetAssignment GET /api/assignments/:aid
func (h *AssignmentHandler) GetAssignment(c *gin.Context) {
	aid := c.Param("aid")
	detail, err := h.svc.GetAssignment(aid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"assignment": detail})
}

// UpdateStatus PATCH /api/assignments/:aid/status
func (h *AssignmentHandler) UpdateStatus(c *gin.Context) {
	aid := c.Param("aid")
	var req struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 status 字段"})
		return
	}
	validStatuses := map[string]bool{
		"draft": true, "collecting": true, "reviewing": true, "closed": true,
	}
	if !validStatuses[req.Status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的状态值"})
		return
	}
	if err := h.svc.UpdateAssignmentStatus(aid, req.Status); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "状态已更新", "status": req.Status})
}

// DeleteAssignment DELETE /api/assignments/:aid
func (h *AssignmentHandler) DeleteAssignment(c *gin.Context) {
	aid := c.Param("aid")
	if err := h.svc.DeleteAssignment(aid); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "作业已删除"})
}

// =============================================================
// 材料管理
// =============================================================

// UploadMaterialFile POST /api/assignments/:aid/materials（multipart 文件上传）
func (h *AssignmentHandler) UploadMaterialFile(c *gin.Context) {
	aid := c.Param("aid")
	userID := middleware.GetUserID(c)

	materialRole := c.PostForm("material_role")
	if materialRole == "" {
		materialRole = models.MaterialRoleInstruction
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择文件"})
		return
	}
	defer file.Close()

	// 文件大小限制 50MB
	if header.Size > 50*1024*1024 {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "文件不能超过 50MB"})
		return
	}

	// 安全文件名（UUID + 原始扩展名）
	ext := strings.ToLower(filepath.Ext(header.Filename))
	safeExt := sanitizeExtForAssignment(ext)
	savedName := fmt.Sprintf("%d%s", time.Now().UnixNano(), safeExt)

	// 保存到 uploads/assignments/ 目录
	uploadDir := "/opt/mindcanvas/uploads/assignments"
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建目录失败"})
		return
	}

	savePath := filepath.Join(uploadDir, savedName)
	dst, err := os.Create(savePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存文件失败"})
		return
	}
	defer dst.Close()
	if _, err = io.Copy(dst, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "写入文件失败"})
		return
	}
	dst.Close()

	accessURL := "/uploads/assignments/" + savedName
	fileType := services.FileTypeFromExt(header.Filename)

	// 保存材料记录
	m, err := h.svc.SaveFileMaterial(
		aid, userID, "teacher", materialRole,
		header.Filename, savePath, accessURL, fileType, header.Size,
	)
	if err != nil {
		os.Remove(savePath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 异步触发解析
	h.svc.ParseMaterialAsync(m.ID)
	log.Printf("[作业材料] 文件上传 作业:%s 材料:%s 文件:%s", aid, m.ID, header.Filename)

	c.JSON(http.StatusCreated, gin.H{
		"material": m,
		"message":  "文件已上传，正在解析中...",
	})
}

// AddTextMaterial POST /api/assignments/:aid/materials/text（文字材料）
func (h *AssignmentHandler) AddTextMaterial(c *gin.Context) {
	aid := c.Param("aid")
	userID := middleware.GetUserID(c)

	var req models.UploadMaterialRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if req.OriginalName == "" {
		req.OriginalName = "文字材料"
	}

	m, err := h.svc.SaveMaterial(aid, userID, "teacher", req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"material": m})
}

// ListMaterials GET /api/assignments/:aid/materials
func (h *AssignmentHandler) ListMaterials(c *gin.Context) {
	aid := c.Param("aid")
	list, err := h.svc.ListMaterials(aid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"materials": list, "total": len(list)})
}

// DeleteMaterial DELETE /api/assignments/:aid/materials/:mid
func (h *AssignmentHandler) DeleteMaterial(c *gin.Context) {
	aid := c.Param("aid")
	mid := c.Param("mid")
	if err := h.svc.DeleteMaterial(mid, aid); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "材料已删除"})
}

// ReParseMaterial POST /api/assignments/:aid/materials/:mid/parse
func (h *AssignmentHandler) ReParseMaterial(c *gin.Context) {
	mid := c.Param("mid")
	h.svc.ParseMaterialAsync(mid)
	c.JSON(http.StatusOK, gin.H{"message": "已触发重新解析", "material_id": mid})
}

// =============================================================
// Rubric 评分标准
// =============================================================

// GenerateRubric POST /api/assignments/:aid/rubric/generate
func (h *AssignmentHandler) GenerateRubric(c *gin.Context) {
	aid := c.Param("aid")
	r, err := h.svc.GenerateDefaultRubric(aid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"rubric": r, "message": "已生成默认评分标准，请确认后启用"})
}

// GetRubric GET /api/assignments/:aid/rubric
func (h *AssignmentHandler) GetRubric(c *gin.Context) {
	aid := c.Param("aid")
	r, err := h.svc.GetLatestRubric(aid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "暂无评分标准"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rubric": r})
}

// ConfirmRubric PUT /api/assignments/:aid/rubric
func (h *AssignmentHandler) ConfirmRubric(c *gin.Context) {
	aid := c.Param("aid")
	userID := middleware.GetUserID(c)
	var req models.ConfirmRubricRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}
	r, err := h.svc.ConfirmRubric(aid, userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rubric": r, "message": "评分标准已确认"})
}

// =============================================================
// 学生提交
// =============================================================

// StudentSubmit POST /api/assignments/:aid/submit（学生端，UUID鉴权）
func (h *AssignmentHandler) StudentSubmit(c *gin.Context) {
	aid := c.Param("aid")

	// 从 Header 或 Query 获取学生 UUID
	studentUUID := c.GetHeader("X-Student-UUID")
	if studentUUID == "" {
		studentUUID = c.Query("uuid")
	}
	if studentUUID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "缺少学生身份"})
		return
	}

	var req models.SubmitAssignmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if req.ContentType == "" {
		req.ContentType = "text"
	}

	sub, err := h.svc.CreateSubmission(aid, req, studentUUID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"submission": sub, "message": "提交成功"})
}

// ListSubmissions GET /api/assignments/:aid/submissions
func (h *AssignmentHandler) ListSubmissions(c *gin.Context) {
	aid := c.Param("aid")
	list, err := h.svc.ListSubmissions(aid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"submissions": list, "total": len(list)})
}

// =============================================================
// 解析服务状态
// =============================================================

// ParserHealth GET /api/assignments/parser/health
func (h *AssignmentHandler) ParserHealth(c *gin.Context) {
	ok := h.svc.CheckParserHealth()
	if ok {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "parser_url": h.svc.GetParserURL()})
	} else {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status": "unavailable",
			"error":  "解析服务不可用，文件解析功能暂时失效",
		})
	}
}

// =============================================================
// 工具函数
// =============================================================

// sanitizeExtForAssignment 只允许安全的文件扩展名
func sanitizeExtForAssignment(ext string) string {
	allowed := map[string]bool{
		".pdf": true, ".doc": true, ".docx": true,
		".ppt": true, ".pptx": true, ".xls": true, ".xlsx": true,
		".txt": true, ".html": true, ".htm": true, ".csv": true,
		".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
		".zip": true,
	}
	if allowed[ext] {
		return ext
	}
	return ".bin"
}
