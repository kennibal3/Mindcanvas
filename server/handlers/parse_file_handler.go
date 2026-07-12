package handlers

import (
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

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
//
// REQ-040 一期：图片文件不走 MarkItDown（其无 OCR 能力，只能读出元数据），
// 改为 base64 直发豆包多模态模型识别文字（复用 AIService.AnalyzeWithImage），
// 返回结构与 MarkItDown 分支一致，前端无感知。
// ============================================================

// maxParseFileSize 工作台同步等待场景限 20MB（低于 Phase8 材料上传的 50MB）
const maxParseFileSize = 20 << 20

// maxOCRImageSize 图片 OCR 限 10MB（base64 后约 13MB，防请求体过大/超时）
const maxOCRImageSize = 10 << 20

// ocrSystemPrompt 图片 OCR 系统提示词（REQ-040）
const ocrSystemPrompt = `你是一个精准的图片文字识别助手。请提取图片中的全部文字内容，并整理为结构清晰的 Markdown：
- 有明显标题层级的用 #/## 表示；列表用 - 表示；表格尽量还原为 Markdown 表格
- 保持原文语言，不翻译、不概括、不评论、不补充图片里没有的内容
- 如果图片里没有任何可识别文字，只输出：（未识别到文字）`

// ocrImageExts 走豆包视觉 OCR 的图片扩展名 → MIME
var ocrImageExts = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif":  "image/gif",
	".bmp":  "image/bmp",
}

// ParseFileHandler 处理器
type ParseFileHandler struct {
	assignmentSvc *services.AssignmentService
	aiSvc         *services.AIService
}

// NewParseFileHandler 构造（注入 AssignmentService 复用 MarkItDown 调用；
// AIService 用于 REQ-040 图片 OCR）
func NewParseFileHandler(assignmentSvc *services.AssignmentService, aiSvc *services.AIService) *ParseFileHandler {
	return &ParseFileHandler{assignmentSvc: assignmentSvc, aiSvc: aiSvc}
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

	// 存到系统临时目录，仅用于本次解析，处理完即删
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

	// ── REQ-040 一期：图片 → 豆包视觉 OCR ──────────────────────
	ext := strings.ToLower(filepath.Ext(fh.Filename))
	if mime, isImage := ocrImageExts[ext]; isImage {
		h.parseImageByOCR(c, tmpPath, mime, fh.Filename, fh.Size)
		return
	}

	// ── REQ-038：其余格式 → MarkItDown 微服务 ─────────────────
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
		"source":     "markitdown",
	})
}

// parseImageByOCR 图片文件走豆包多模态识别（REQ-040 一期）
func (h *ParseFileHandler) parseImageByOCR(c *gin.Context, tmpPath, mime, filename string, size int64) {
	if !h.aiSvc.IsConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "图片识别服务尚未配置"})
		return
	}
	if size > maxOCRImageSize {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "图片超过 10MB 限制，请压缩后再试"})
		return
	}

	raw, err := os.ReadFile(tmpPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取图片失败"})
		return
	}
	dataURL := "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(raw)

	start := time.Now()
	// FastMode：关闭深度思考 + 限制输出，OCR 场景纯提取不需要推理（同 REQ-027 图形生成的用法）
	markdown, _, err := h.aiSvc.AnalyzeWithImage(
		services.WithFastMode(c.Request.Context()),
		ocrSystemPrompt,
		"请提取这张图片中的全部文字，按系统要求输出 Markdown。",
		dataURL,
	)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "图片识别暂时不可用，请稍后重试"})
		return
	}

	markdown = strings.TrimSpace(markdown)
	if markdown == "（未识别到文字）" {
		markdown = ""
	}
	charCount := utf8.RuneCountInString(markdown)
	c.JSON(http.StatusOK, gin.H{
		"markdown":   markdown,
		"word_count": charCount,
		"char_count": charCount,
		"elapsed_ms": time.Since(start).Milliseconds(),
		"file_name":  filename,
		"source":     "doubao_ocr",
	})
}
