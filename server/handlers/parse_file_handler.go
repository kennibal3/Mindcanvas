package handlers

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"mindcanvas-server/services"
)

// ============================================================
// ParseFileHandler — POST /api/ai/parse-file
// REQ-038：AI 工作台文件上传解析入口
// 教师把任意文件（PDF/Word/PPT/Excel/图片/文本）丢进 AI 工作台，
// 本接口转发给 MarkItDown 微服务解析为 Markdown 返回前端填入输入框，
// 再走既有「智能提炼(/api/ai/refine) → 生成图形(/api/ai/diagram)」链路。
// 复用 AssignmentService.CallParseFile（Phase8 作业评价同款调用），
// 不落库、不留盘（临时文件用完即删）。
// ============================================================

// maxParseFileSize 工作台同步等待场景限 20MB（低于 Phase8 材料上传的 50MB）
const maxParseFileSize = 20 << 20

// ParseFileHandler 处理器
type ParseFileHandler struct {
	assignmentSvc *services.AssignmentService
}

// NewParseFileHandler 构造（注入 AssignmentService 以复用其 MarkItDown 调用）
func NewParseFileHandler(assignmentSvc *services.AssignmentService) *ParseFileHandler {
	return &ParseFileHandler{assignmentSvc: assignmentSvc}
}

// ParseFile 处理请求
//
//	POST /api/ai/parse-file  (multipart/form-data，字段名 file)
//	Auth: AuthRequired (Cookie JWT)
func (h *ParseFileHandler) ParseFile(c *gin.Context) {
	fh, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择要解析的文件"})
		return
	}
	if fh.Size <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件为空"})
		return
	}
	if fh.Size > maxParseFileSize {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "文件超过 20MB 限制，请压缩或拆分后再试"})
		return
	}

	// 存到系统临时目录，仅用于转发给解析微服务，处理完即删
	tmp, err := os.CreateTemp("", "aiparse-*"+filepath.Ext(fh.Filename))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器临时文件创建失败"})
		return
	}
	tmpPath := tmp.Name()
	tmp.Close()
	defer os.Remove(tmpPath)

	if err := c.SaveUploadedFile(fh, tmpPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件保存失败"})
		return
	}

	result, err := h.assignmentSvc.CallParseFile(tmpPath, fh.Filename)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "解析服务暂时不可用，请稍后重试"})
		return
	}
	if !result.Success {
		msg := result.Error
		if msg == "" {
			msg = "该文件无法解析，请确认格式（支持 PDF/Word/PPT/Excel/图片/文本）"
		}
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": msg})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"markdown":   result.Markdown,
		"word_count": result.WordCount,
		"char_count": result.CharCount,
		"elapsed_ms": result.ElapsedMs,
		"file_name":  fh.Filename,
	})
}
