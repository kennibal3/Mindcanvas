// =============================================================
// MindCanvas - 文件上传处理器
// 新增：UploadAvatar 头像上传接口（需求3）
// =============================================================
package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/google/uuid"
)

// UploadHandler 文件上传处理器
type UploadHandler struct {
	db  *sql.DB
	rdb *redis.Client
}

// NewUploadHandler 创建上传处理器
func NewUploadHandler(db *sql.DB, rdb *redis.Client) *UploadHandler {
	return &UploadHandler{db: db, rdb: rdb}
}

// allowedImageMIMEs 图片MIME白名单
var allowedImageMIMEs = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

// allowedAvatarMIMEs 头像MIME白名单（不含gif）
var allowedAvatarMIMEs = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

// allowedFileExtensions 通用文件扩展名白名单
var allowedFileExtensions = map[string]string{
	".pdf":  "document",
	".doc":  "document",
	".docx": "document",
	".xls":  "document",
	".xlsx": "document",
	".ppt":  "document",
	".pptx": "document",
	".txt":  "document",
	".md":   "document",
	".csv":  "document",
	".zip":  "archive",
	".rar":  "archive",
	".7z":   "archive",
	".jpg":  "image",
	".jpeg": "image",
	".png":  "image",
	".gif":  "image",
	".webp": "image",
	".mp3":  "audio",
	".wav":  "audio",
	".m4a":  "audio",
	".ogg":  "audio",
	".py":   "code",
	".js":   "code",
	".ts":   "code",
	".html": "code",
	".css":  "code",
	".go":   "code",
	".java": "code",
	".cpp":  "code",
	".c":    "code",
	".json": "code",
	".xml":  "code",
	".yaml": "code",
	".yml":  "code",
	".sh":   "code",
	".sql":  "code",
}

// 文件大小限制常量
const (
	maxImageSize  = 10 * 1024 * 1024  // 图片：10MB
	maxFileSize   = 100 * 1024 * 1024 // 通用文件：100MB
	maxAvatarSize = 2 * 1024 * 1024   // 头像：2MB
)

// UploadAvatar 头像上传接口（需求3）
// POST /api/upload/avatar
// 公开接口：学生入场时调用无需登录
// 教师场景：携带 JWT Cookie 时自动更新 users.avatar_url
// 前端用 Canvas API 裁剪为 200x200 正方形后上传
func (h *UploadHandler) UploadAvatar(c *gin.Context) {
	file, header, err := c.Request.FormFile("avatar")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择要上传的头像图片"})
		return
	}
	defer file.Close()

	// 大小校验：不超过 2MB
	if header.Size > maxAvatarSize {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("头像图片不能超过 2MB，当前 %.1fMB", float64(header.Size)/1024/1024),
		})
		return
	}

	// MIME 嗅探：读取前 512 字节判断真实类型
	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	mimeType := http.DetectContentType(buf[:n])
	if seeker, ok := file.(io.Seeker); ok {
		seeker.Seek(0, io.SeekStart)
	}

	// MIME 校验：只允许 JPEG / PNG / WebP
	ext, allowed := allowedAvatarMIMEs[mimeType]
	if !allowed {
		origExt := strings.ToLower(filepath.Ext(header.Filename))
		extFallback := map[string]string{
			".jpg":  ".jpg",
			".jpeg": ".jpg",
			".png":  ".png",
			".webp": ".webp",
		}
		if e, ok := extFallback[origExt]; ok {
			ext = e
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "头像只支持 JPG、PNG、WebP 格式"})
			return
		}
	}

	// 生成唯一文件名并确保目录存在
	fileID := uuid.New().String()
	storageName := fileID + ext
	uploadDir := "/opt/mindcanvas/uploads/avatars"
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		log.Printf("[头像上传] 创建目录失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "存储目录创建失败"})
		return
	}
	storagePath := filepath.Join(uploadDir, storageName)

	// 写入磁盘
	dst, err := os.Create(storagePath)
	if err != nil {
		log.Printf("[头像上传] 创建文件失败: %v path:%s", err, storagePath)
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

	accessURL := "/uploads/avatars/" + storageName

	// 如果携带了有效 JWT（教师场景），同步更新 users.avatar_url
	if userID, exists := c.Get("user_id"); exists && userID != nil {
		uid := fmt.Sprintf("%v", userID)
		if uid != "" && uid != "<nil>" {
			if _, dbErr := h.db.Exec(
				"UPDATE users SET avatar_url=$1, updated_at=NOW() WHERE id=$2",
				accessURL, uid,
			); dbErr != nil {
				log.Printf("[头像上传] 更新教师头像URL失败（不影响文件保存）: %v", dbErr)
			} else {
				log.Printf("[头像上传] 教师头像已更新 user_id:%s url:%s", uid, accessURL)
			}
		}
	}

	log.Printf("[头像上传] 成功 file:%s size:%d mime:%s", storageName, written, mimeType)
	c.JSON(http.StatusOK, gin.H{
		"url":     accessURL,
		"file_id": fileID,
		"size":    written,
		"mime":    mimeType,
	})
}

// UploadImage 图片上传接口（原有，保持兼容）
// POST /api/upload/image
func (h *UploadHandler) UploadImage(c *gin.Context) {
	uploaderUUID, uploaderName, roomID, err := h.resolveUploaderUUID(c)
	if err != nil {
		log.Printf("[图片上传] 身份验证失败: %v", err)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "身份验证失败: " + err.Error()})
		return
	}
	file, header, err := c.Request.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择要上传的图片"})
		return
	}
	defer file.Close()
	if header.Size > maxImageSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "图片大小不能超过 10MB"})
		return
	}
	buffer := make([]byte, 512)
	n, _ := file.Read(buffer)
	mimeType := http.DetectContentType(buffer[:n])
	if seeker, ok := file.(io.Seeker); ok {
		seeker.Seek(0, io.SeekStart)
	}
	ext, allowed := allowedImageMIMEs[mimeType]
	if !allowed {
		origExt := strings.ToLower(filepath.Ext(header.Filename))
		imgExts := map[string]string{
			".jpg":  ".jpg",
			".jpeg": ".jpg",
			".png":  ".png",
			".gif":  ".gif",
			".webp": ".webp",
		}
		if e, ok := imgExts[origExt]; ok {
			ext = e
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的图片格式，请上传 JPG/PNG/GIF/WebP"})
			return
		}
	}
	fileID := uuid.New().String()
	storageName := fileID + ext
	uploadDir := "/opt/mindcanvas/uploads/images"
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "存储目录创建失败"})
		return
	}
	storagePath := filepath.Join(uploadDir, storageName)
	dst, err := os.Create(storagePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件保存失败"})
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件写入失败"})
		return
	}
	accessURL := "/uploads/images/" + storageName
	if roomID != "" {
		if _, dbErr := h.db.Exec(
			`INSERT INTO room_images (room_id, uploader_uuid, file_name, file_size, mime_type, storage_path, url) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			roomID, uploaderUUID, header.Filename, header.Size, mimeType, storagePath, accessURL,
		); dbErr != nil {
			log.Printf("[图片上传] 数据库记录失败（不影响功能）: %v", dbErr)
		}
	}
	log.Printf("[图片上传] 成功 uploader:%s room:%s file:%s size:%d", uploaderUUID, roomID, storageName, header.Size)
	c.JSON(http.StatusOK, gin.H{
		"url":           accessURL,
		"file_name":     header.Filename,
		"storage_name":  storageName,
		"uploader_uuid": uploaderUUID,
		"uploader_name": uploaderName,
	})
}

// UploadFile 通用文件上传接口
// POST /api/upload/file
func (h *UploadHandler) UploadFile(c *gin.Context) {
	uploaderUUID, uploaderName, roomID, err := h.resolveUploaderUUID(c)
	if err != nil {
		log.Printf("[文件上传] 身份验证失败: %v", err)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "身份验证失败: " + err.Error()})
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择要上传的文件"})
		return
	}
	defer file.Close()
	if header.Size > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("文件大小不能超过 %dMB，当前文件 %.1fMB", maxFileSize/1024/1024, float64(header.Size)/1024/1024),
		})
		return
	}
	origExt := strings.ToLower(filepath.Ext(header.Filename))
	if origExt == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件必须有扩展名"})
		return
	}
	category, extAllowed := allowedFileExtensions[origExt]
	if !extAllowed {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("不支持的文件类型 %s", origExt),
		})
		return
	}
	buffer := make([]byte, 512)
	n, _ := file.Read(buffer)
	mimeType := http.DetectContentType(buffer[:n])
	if seeker, ok := file.(io.Seeker); ok {
		seeker.Seek(0, io.SeekStart)
	}
	subDir := category
	if subDir == "" {
		subDir = "other"
	}
	uploadDir := fmt.Sprintf("/opt/mindcanvas/uploads/files/%s", subDir)
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "存储目录创建失败"})
		return
	}
	fileID := uuid.New().String()
	storageName := fileID + origExt
	storagePath := filepath.Join(uploadDir, storageName)
	dst, err := os.Create(storagePath)
	if err != nil {
		log.Printf("[文件上传] 创建文件失败: %v path:%s", err, storagePath)
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
	accessURL := fmt.Sprintf("/uploads/files/%s/%s", subDir, storageName)
	var fileDBID string
	if roomID != "" {
		elementID := c.GetHeader("X-Element-Id")
		if elementID == "" {
			elementID = c.Query("element_id")
		}
		var elemIDPtr interface{} = nil
		if elementID != "" {
			elemIDPtr = elementID
		}
		if dbErr := h.db.QueryRow(
			`INSERT INTO room_files (room_id, element_id, uploader_uuid, uploader_name, original_name, storage_name, storage_path, url, mime_type, file_size, file_category) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
			roomID, elemIDPtr, uploaderUUID, uploaderName, header.Filename, storageName, storagePath, accessURL, mimeType, written, category,
		).Scan(&fileDBID); dbErr != nil {
			log.Printf("[文件上传] 数据库记录失败（不影响功能）: %v", dbErr)
		}
	}
	log.Printf("[文件上传] 成功 uploader:%s room:%s file:%s size:%.1fMB category:%s", uploaderUUID, roomID, storageName, float64(written)/1024/1024, category)
	c.JSON(http.StatusOK, gin.H{
		"file_id":       fileDBID,
		"url":           accessURL,
		"original_name": header.Filename,
		"storage_name":  storageName,
		"file_size":     written,
		"file_size_mb":  fmt.Sprintf("%.2f", float64(written)/1024/1024),
		"mime_type":     mimeType,
		"file_category": category,
		"ext":           origExt,
		"uploader_uuid": uploaderUUID,
		"uploader_name": uploaderName,
	})
}

// GetFileInfo 获取文件信息
// GET /api/upload/file/:id
func (h *UploadHandler) GetFileInfo(c *gin.Context) {
	fileID := c.Param("id")
	var info struct {
		ID           string    `json:"id"`
		OriginalName string    `json:"original_name"`
		URL          string    `json:"url"`
		MimeType     string    `json:"mime_type"`
		FileSize     int64     `json:"file_size"`
		FileCategory string    `json:"file_category"`
		CreatedAt    time.Time `json:"created_at"`
	}
	err := h.db.QueryRow(
		`SELECT id, original_name, url, mime_type, file_size, file_category, created_at FROM room_files WHERE id = $1`,
		fileID,
	).Scan(&info.ID, &info.OriginalName, &info.URL, &info.MimeType, &info.FileSize, &info.FileCategory, &info.CreatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在"})
		return
	}
	c.JSON(http.StatusOK, info)
}

// resolveUploaderUUID 解析上传者身份
// 优先级：JWT Cookie（教师）> X-Student-UUID Header（学生）
func (h *UploadHandler) resolveUploaderUUID(c *gin.Context) (uploaderUUID, uploaderName, roomID string, err error) {
	// 方式1：教师通过 JWT Cookie（middleware 注入 user_id）
	if userID, exists := c.Get("user_id"); exists {
		uid := fmt.Sprintf("%v", userID)
		if uid != "" && uid != "<nil>" {
			name := ""
			h.db.QueryRow("SELECT display_name FROM users WHERE id = $1", uid).Scan(&name)
			rID := c.GetHeader("X-Room-Id")
			if rID == "" {
				rID = c.Query("room_id")
			}
			return uid, name, rID, nil
		}
	}
	// 方式2：学生通过 UUID Header
	studentUUID := c.GetHeader("X-Student-UUID")
	if studentUUID == "" {
		studentUUID = c.Query("student_uuid")
	}
	if studentUUID == "" {
		return "", "", "", fmt.Errorf("缺少身份标识，请提供 X-Student-UUID Header")
	}
	rID := c.GetHeader("X-Room-Id")
	if rID == "" {
		rID = c.Query("room_id")
	}
	if rID == "" {
		return "", "", "", fmt.Errorf("学生上传必须提供 X-Room-Id")
	}
	// Redis 验证 session 有效性
	if h.rdb != nil {
		ctx := context.Background()
		sessionKey := "session:" + studentUUID
		sessionJSON, redisErr := h.rdb.Get(ctx, sessionKey).Result()
		if redisErr == nil {
			var sessionData struct {
				RoomID   string `json:"room_id"`
				Nickname string `json:"nickname"`
			}
			if jsonErr := json.Unmarshal([]byte(sessionJSON), &sessionData); jsonErr == nil {
				if sessionData.RoomID != rID {
					return "", "", "", fmt.Errorf("会话不属于该房间")
				}
				return studentUUID, sessionData.Nickname, rID, nil
			}
		}
	}
	// Redis 不可用时降级到数据库验证
	var count int
	if dbErr := h.db.QueryRow(
		`SELECT COUNT(*) FROM room_sessions WHERE student_uuid = $1 AND room_id = $2 AND is_banned = FALSE`,
		studentUUID, rID,
	).Scan(&count); dbErr != nil || count == 0 {
		return "", "", "", fmt.Errorf("无效的学生会话，请重新进入房间")
	}
	// 获取昵称
	nickname := ""
	h.db.QueryRow(
		`SELECT nickname FROM room_sessions WHERE student_uuid = $1 AND room_id = $2 ORDER BY joined_at DESC LIMIT 1`,
		studentUUID, rID,
	).Scan(&nickname)
	return studentUUID, nickname, rID, nil
}
