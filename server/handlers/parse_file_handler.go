package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
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

// ── REQ-040 二期：扫描 PDF 分页 OCR ─────────────────────────────
// ocrPDFConcurrency 逐页 OCR 的并发数（网络 IO 密集，3 路并发把 10 页
// 最坏耗时从 ~200s 压到 ~70s，仍在 Nginx 300s / Ark 客户端 120s 之内）
const ocrPDFConcurrency = 3

// ocrPDFTimeout 整个分页 OCR 流程的总超时
const ocrPDFTimeout = 240 * time.Second

// pdfRenderResult 对应 markitdown-service /render/pdf-pages 的返回
type pdfRenderResult struct {
	Success       bool     `json:"success"`
	PageCount     int      `json:"page_count"`
	RenderedPages int      `json:"rendered_pages"`
	Pages         []string `json:"pages"`
	Error         string   `json:"error"`
}

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

	// ── REQ-040 二期：扫描 PDF（MarkItDown 解出 0 字符）→ 分页 OCR ──
	// 严格 0 字符才触发（用户拍板），OCR 全程失败则回退到原 0 字符结果，
	// 前端行为与一期一致（黄色警告），不因 OCR 故障把整个解析变成报错。
	if ext == ".pdf" && result.CharCount == 0 && h.aiSvc.IsConfigured() {
		if h.parsePDFByOCR(c, tmpPath, fh.Filename) {
			return
		}
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

// parsePDFByOCR 扫描 PDF：渲染分页 → 逐页豆包 OCR → 拼接（REQ-040 二期）。
// 成功写出响应返回 true；任何环节失败返回 false，由调用方回退 MarkItDown 结果。
func (h *ParseFileHandler) parsePDFByOCR(c *gin.Context, tmpPath, filename string) bool {
	start := time.Now()

	render, err := h.renderPDFPages(tmpPath, filename)
	if err != nil || !render.Success || len(render.Pages) == 0 {
		return false
	}

	ctx, cancel := context.WithTimeout(services.WithFastMode(c.Request.Context()), ocrPDFTimeout)
	defer cancel()

	// 3 路并发逐页 OCR，结果按页序写入定长切片
	texts := make([]string, len(render.Pages))
	errs := make([]error, len(render.Pages))
	sem := make(chan struct{}, ocrPDFConcurrency)
	var wg sync.WaitGroup
	for i, b64 := range render.Pages {
		wg.Add(1)
		go func(i int, b64 string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			dataURL := "data:image/jpeg;base64," + b64
			text, _, err := h.aiSvc.AnalyzeWithImage(
				ctx,
				ocrSystemPrompt,
				fmt.Sprintf("这是一份 PDF 的第 %d 页，请提取本页全部文字，按系统要求输出 Markdown。", i+1),
				dataURL,
			)
			if err != nil {
				errs[i] = err
				return
			}
			text = strings.TrimSpace(text)
			if text == "（未识别到文字）" {
				text = ""
			}
			texts[i] = text
		}(i, b64)
	}
	wg.Wait()

	// 全部页都失败 → 回退；个别页失败 → 占位说明，保住已识别内容
	allFailed := true
	for _, e := range errs {
		if e == nil {
			allFailed = false
			break
		}
	}
	if allFailed {
		return false
	}

	var parts []string
	for i, t := range texts {
		if errs[i] != nil {
			parts = append(parts, fmt.Sprintf("> （第 %d 页识别失败，可稍后重试）", i+1))
			continue
		}
		if t != "" {
			parts = append(parts, t)
		}
	}
	markdown := strings.TrimSpace(strings.Join(parts, "\n\n"))
	if markdown != "" && render.PageCount > render.RenderedPages {
		markdown += fmt.Sprintf("\n\n> （原文共 %d 页，仅识别前 %d 页）", render.PageCount, render.RenderedPages)
	}

	charCount := utf8.RuneCountInString(markdown)
	c.JSON(http.StatusOK, gin.H{
		"markdown":   markdown,
		"word_count": charCount,
		"char_count": charCount,
		"elapsed_ms": time.Since(start).Milliseconds(),
		"file_name":  filename,
		"source":     "doubao_ocr_pdf",
		"page_count": render.PageCount,
		"ocr_pages":  render.RenderedPages,
	})
	return true
}

// renderPDFPages 调 markitdown-service 把 PDF 渲染成 base64 JPEG 分页
func (h *ParseFileHandler) renderPDFPages(tmpPath, filename string) (*pdfRenderResult, error) {
	f, err := os.Open(tmpPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", filename)
	if err != nil {
		return nil, err
	}
	if _, err = io.Copy(fw, f); err != nil {
		return nil, err
	}
	w.Close()

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Post(h.assignmentSvc.GetParserURL()+"/render/pdf-pages", w.FormDataContentType(), &buf)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result pdfRenderResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
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
