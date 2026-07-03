// =============================================================
// MindCanvas Phase8-v2 - 作业码与花名册API处理器
// 功能：生成作业码、管理花名册、学生凭码提交、查看评价结果
// API路由：
//   POST   /api/assignments/:aid/tokens/generate  生成作业码
//   GET    /api/assignments/:aid/tokens            查询作业码列表
//   GET    /api/assignments/:aid/tokens/export     导出CSV
//   GET    /api/assignments/:aid/roster            花名册+提交状态
//   POST   /api/assignments/:aid/roster            手动添加花名册条目
//   POST   /api/assignments/:aid/roster/import     CSV批量导入
//   POST   /api/assignments/:aid/roster/sync       从课堂同步花名册
//   DELETE /api/assignments/:aid/roster/:rid       删除花名册条目
//   POST   /api/submit/verify                      验证作业码（公开）
//   POST   /api/submit                             凭作业码提交（公开）
//   GET    /api/submit/:aid/result                 学生查看评价结果（公开）
// =============================================================
package handlers

import (
	"encoding/csv"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"mindcanvas-server/models"
	"mindcanvas-server/services"
)

// TokenHandler 作业码处理器
type TokenHandler struct {
	svc *services.TokenService
}

// NewTokenHandler 创建作业码处理器
func NewTokenHandler(svc *services.TokenService) *TokenHandler {
	return &TokenHandler{svc: svc}
}

// =============================================================
// 教师端：作业码管理
// =============================================================

// GenerateTokens POST /api/assignments/:aid/tokens/generate
// 生成作业码（专属码或通用码）
func (h *TokenHandler) GenerateTokens(c *gin.Context) {
	aid := c.Param("aid")
	if aid == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少作业ID"})
		return
	}

	var req models.GenerateTokensRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}

	result, err := h.svc.GenerateTokens(aid, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"tokens":      result.Tokens,
		"total_count": result.TotalCount,
		"token_type":  result.TokenType,
		"expires_at":  result.ExpiresAt,
		"message":     "作业码生成成功",
	})
}

// ListTokens GET /api/assignments/:aid/tokens
// 查询作业的所有作业码
func (h *TokenHandler) ListTokens(c *gin.Context) {
	aid := c.Param("aid")
	tokens, err := h.svc.ListTokens(aid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if tokens == nil {
		tokens = []models.AssignmentToken{}
	}
	c.JSON(http.StatusOK, gin.H{
		"tokens": tokens,
		"total":  len(tokens),
	})
}

// ExportTokensCSV GET /api/assignments/:aid/tokens/export
// 导出作业码为CSV文件（兼容Excel中文）
func (h *TokenHandler) ExportTokensCSV(c *gin.Context) {
	aid := c.Param("aid")
	data, err := h.svc.ExportTokensCSV(aid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=\"assignment_tokens.csv\"")
	c.Data(http.StatusOK, "text/csv; charset=utf-8", data)
}

// =============================================================
// 教师端：花名册管理
// =============================================================

// GetRoster GET /api/assignments/:aid/roster
// 获取花名册+提交状态（老师核心视图）
func (h *TokenHandler) GetRoster(c *gin.Context) {
	aid := c.Param("aid")
	summary, err := h.svc.GetRosterWithStatus(aid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"total_expected":  summary.TotalExpected,
		"total_submitted": summary.TotalSubmitted,
		"total_pending":   summary.TotalPending,
		"submit_rate":     summary.SubmitRate,
		"roster":          summary.Roster,
	})
}

// AddRosterEntry POST /api/assignments/:aid/roster
// 手动添加花名册条目
func (h *TokenHandler) AddRosterEntry(c *gin.Context) {
	aid := c.Param("aid")
	var req models.AddRosterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}

	entry, err := h.svc.AddRosterEntry(aid, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"roster_entry": entry,
		"message":      "花名册条目已添加",
	})
}

// ImportRosterCSV POST /api/assignments/:aid/roster/import
// CSV批量导入花名册
// 支持两种格式：
//   1. JSON body: {"names": ["张三", "李四,uuid-xxx"]}
//   2. multipart CSV文件上传
func (h *TokenHandler) ImportRosterCSV(c *gin.Context) {
	aid := c.Param("aid")

	// 优先尝试JSON格式
	contentType := c.GetHeader("Content-Type")
	if strings.Contains(contentType, "application/json") {
		var req models.ImportRosterCSVRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
			return
		}
		count, err := h.svc.ImportRosterFromCSV(aid, req.Names)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"imported": count,
			"message":  "花名册导入成功",
		})
		return
	}

	// 文件上传格式（multipart CSV）
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请上传CSV文件或提供JSON格式名单"})
		return
	}

	f, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件读取失败"})
		return
	}
	defer f.Close()

	reader := csv.NewReader(f)
	records, err := reader.ReadAll()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "CSV解析失败: " + err.Error()})
		return
	}

	// 将CSV记录转为字符串列表（跳过表头行）
	var names []string
	for i, row := range records {
		if i == 0 && len(row) > 0 {
			// 检查是否是表头（包含"姓名"字样则跳过）
			if strings.Contains(row[0], "姓名") || strings.Contains(row[0], "name") {
				continue
			}
		}
		if len(row) == 0 || strings.TrimSpace(row[0]) == "" {
			continue
		}
		if len(row) >= 2 {
			names = append(names, strings.TrimSpace(row[0])+","+strings.TrimSpace(row[1]))
		} else {
			names = append(names, strings.TrimSpace(row[0]))
		}
	}

	count, err := h.svc.ImportRosterFromCSV(aid, names)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"imported": count,
		"message":  "花名册导入成功",
	})
}

// SyncRosterFromClassroom POST /api/assignments/:aid/roster/sync
// 从课堂在线人数同步花名册（实时拉取当前在线学生）
func (h *TokenHandler) SyncRosterFromClassroom(c *gin.Context) {
	aid := c.Param("aid")

	var req models.SyncFromClassroomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误，需要room_id"})
		return
	}

	count, err := h.svc.SyncFromClassroom(aid, req.RoomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"synced":  count,
		"message": "课堂花名册同步成功",
	})
}

// DeleteRosterEntry DELETE /api/assignments/:aid/roster/:rid
// 删除花名册条目
func (h *TokenHandler) DeleteRosterEntry(c *gin.Context) {
	aid := c.Param("aid")
	rid := c.Param("rid")

	if err := h.svc.DeleteRosterEntry(aid, rid); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "花名册条目已删除"})
}

// =============================================================
// 公开端：学生凭作业码提交（无需教师登录）
// =============================================================

// VerifyToken POST /api/submit/verify
// 验证作业码，返回作业信息（学生提交页第一步）
func (h *TokenHandler) VerifyToken(c *gin.Context) {
	var req struct {
		Token string `json:"token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请输入作业码"})
		return
	}

	result, err := h.svc.VerifyToken(req.Token)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"valid": false,
			"error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"valid":                  result.Valid,
		"token":                  result.Token,
		"token_type":             result.TokenType,
		"student_uuid":           result.StudentUUID,
		"student_name":           result.StudentName,
		"assignment_id":          result.AssignmentID,
		"assignment_title":       result.AssignmentTitle,
		"assignment_description": result.AssignmentDescription,
		"assignment_status":      result.AssignmentStatus,
		"due_at":                 result.DueAt,
		"allow_resubmit":         result.AllowResubmit,
		"existing_submission":    result.ExistingSubmission,
	})
}

// SubmitByToken POST /api/submit
// 学生凭作业码提交作业（完全公开接口）
func (h *TokenHandler) SubmitByToken(c *gin.Context) {
	var req models.SubmitByTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}

	if req.Token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少作业码"})
		return
	}

	subID, studentUUID, err := h.svc.SubmitByToken(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"submission_id": subID,
		"student_uuid":  studentUUID,
		"message":       "作业提交成功",
	})
}

// GetStudentResult GET /api/submit/:aid/result
// 学生查看自己的评价结果（凭student_uuid，仅published状态可见）
func (h *TokenHandler) GetStudentResult(c *gin.Context) {
	aid := c.Param("aid")

	// 从Header或Query获取学生UUID
	studentUUID := c.GetHeader("X-Student-UUID")
	if studentUUID == "" {
		studentUUID = c.Query("uuid")
	}
	if studentUUID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少学生身份（uuid）"})
		return
	}

	assessment, err := h.svc.GetStudentAssessment(aid, studentUUID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"assessment": assessment})
}


// =============================================================
// 公开端：学生作业文件上传（无需登录，凭作业码身份上传）
// POST /api/submit/upload
// 支持：PDF/Word/PPT/Excel/图片/TXT/ZIP等
// 上传后返回文件URL，学生再调用/api/submit提交
// =============================================================

// 作业提交文件类型白名单（扩展名→分类）
var submitFileExtensions = map[string]string{
	".pdf":  "document",
	".doc":  "document",
	".docx": "document",
	".ppt":  "presentation",
	".pptx": "presentation",
	".xls":  "spreadsheet",
	".xlsx": "spreadsheet",
	".txt":  "text",
	".md":   "text",
	".jpg":  "image",
	".jpeg": "image",
	".png":  "image",
	".gif":  "image",
	".webp": "image",
	".zip":  "archive",
	".rar":  "archive",
	".mp4":  "video",
	".mov":  "video",
}

// UploadSubmitFile POST /api/submit/upload
// 学生作业文件上传（公开接口，不需要房间ID）
// 文件保存到 /opt/mindcanvas/uploads/assignments/submissions/
func (h *TokenHandler) UploadSubmitFile(c *gin.Context) {
	// 从Header获取学生UUID（可选，用于日志）
	studentUUID := c.GetHeader("X-Student-UUID")
	if studentUUID == "" {
		studentUUID = "anonymous"
	}

	// 读取文件
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择要上传的文件"})
		return
	}
	defer file.Close()

	// 文件大小限制：50MB
	const maxSize = 50 * 1024 * 1024
	if header.Size > maxSize {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("文件大小不能超过50MB，当前文件 %.1fMB",
				float64(header.Size)/1024/1024),
		})
		return
	}

	// 扩展名白名单校验
	origExt := strings.ToLower(filepath.Ext(header.Filename))
	if origExt == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件必须有扩展名"})
		return
	}
	category, allowed := submitFileExtensions[origExt]
	if !allowed {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "不支持的文件类型，支持：PDF/Word/PPT/Excel/图片/TXT/ZIP/视频",
		})
		return
	}

	// 创建存储目录
	uploadDir := "/opt/mindcanvas/uploads/assignments/submissions"
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "存储目录创建失败"})
		return
	}

	// 生成唯一文件名
	fileID := uuid.New().String()
	storageName := fileID + origExt
	storagePath := filepath.Join(uploadDir, storageName)

	// 写入磁盘
	dst, err := os.Create(storagePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件保存失败"})
		return
	}
	defer dst.Close()

	written, err := io.Copy(dst, file)
	if err != nil {
		os.Remove(storagePath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件写入失败"})
		return
	}

	accessURL := "/uploads/assignments/submissions/" + storageName

	log.Printf("[作业文件上传] student:%s file:%s size:%.1fMB category:%s",
		studentUUID, storageName, float64(written)/1024/1024, category)

	c.JSON(http.StatusOK, gin.H{
		"file_url":      accessURL,
		"file_name":     header.Filename,
		"file_size":     written,
		"file_size_mb":  fmt.Sprintf("%.2f", float64(written)/1024/1024),
		"file_category": category,
		"ext":           origExt,
	})
}