// =============================================================
// MindCanvas - REQ-059 一期：zip 课件上传与下发
//
// 两个接口：
//
//	POST /api/rooms/:id/courseware                      教师上传 zip，建 html_widget 组件并挂接
//	GET  /api/rooms/:id/elements/:eid/courseware/*path  下发课件里的单个文件（学生也可读）
//
// 下发侧刻意**不走 nginx**：nginx 的 /uploads/ 是直出零鉴权的，
// 课件放那里则二期的密码与有效期会被「知道路径就能访问」绕过。
// 经 Go 下发才有地方挂校验。
//
// 鉴权口径与既有 GetHtmlWidgetContent 完全一致（OptionalAuth + 校验
// element 确实属于该 room 且未删除）——学生要能看课件，而学生可能是
// 没有 JWT 的访客。一期不发明新的访问模型，二期做分享链接时再加 token 层。
// =============================================================
package handlers

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/middleware"
	"mindcanvas-server/models"
	"mindcanvas-server/services"
	"mindcanvas-server/ws"
)

// CoursewareHandler zip 课件处理器
type CoursewareHandler struct {
	roomService       *services.RoomService
	widgetService     *services.WidgetService
	coursewareService *services.CoursewareService
	hub               *ws.Hub
}

func NewCoursewareHandler(
	roomService *services.RoomService,
	widgetService *services.WidgetService,
	coursewareService *services.CoursewareService,
	hub *ws.Hub,
) *CoursewareHandler {
	return &CoursewareHandler{
		roomService:       roomService,
		widgetService:     widgetService,
		coursewareService: coursewareService,
		hub:               hub,
	}
}

// coursewareMIME 扩展名 → Content-Type 白名单。
//
// 白名单而非黑名单：未知扩展名一律当二进制附件下发（见 serveOne），
// 不给它在浏览器里被当成可执行文档的机会。
// video/mp4 是必须的——实测真实课件里有 14.6MB 的 mp4。
var coursewareMIME = map[string]string{
	".html":  "text/html; charset=utf-8",
	".htm":   "text/html; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".mjs":   "text/javascript; charset=utf-8",
	".json":  "application/json; charset=utf-8",
	".txt":   "text/plain; charset=utf-8",
	".svg":   "image/svg+xml",
	".png":   "image/png",
	".jpg":   "image/jpeg",
	".jpeg":  "image/jpeg",
	".gif":   "image/gif",
	".webp":  "image/webp",
	".ico":   "image/x-icon",
	".bmp":   "image/bmp",
	".woff":  "font/woff",
	".woff2": "font/woff2",
	".ttf":   "font/ttf",
	".otf":   "font/otf",
	".eot":   "application/vnd.ms-fontobject",
	".mp4":   "video/mp4",
	".webm":  "video/webm",
	".ogv":   "video/ogg",
	".mp3":   "audio/mpeg",
	".wav":   "audio/wav",
	".m4a":   "audio/mp4",
	".ogg":   "audio/ogg",
	".xml":   "application/xml; charset=utf-8",
	".csv":   "text/csv; charset=utf-8",
}

// UploadCourseware POST /api/rooms/:id/courseware （教师）
//
// 流程：校验归属 → 收 zip → 先插库拿 id（id 即目录名）→ 解压 →
//
//	建 html_widget 元素 → 挂接 → 广播 element_create。
//
// 任一步失败都回滚（删库删盘），不留半成品——一个指向空目录的课件组件
// 点开是白屏，老师只会以为「这功能坏了」。
func (h *CoursewareHandler) UploadCourseware(c *gin.Context) {
	roomID := c.Param("id")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)
	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择要上传的 zip 文件"})
		return
	}
	if fileHeader.Size > services.CoursewareMaxUploadBytes {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("压缩包 %.1fMB，超过 %dMB 上限",
				float64(fileHeader.Size)/(1<<20), services.CoursewareMaxUploadBytes>>20),
		})
		return
	}
	if !strings.EqualFold(filepath.Ext(fileHeader.Filename), ".zip") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "只支持 .zip 压缩包"})
		return
	}

	src, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "读取上传文件失败"})
		return
	}
	defer src.Close()

	// zip.NewReader 需要 io.ReaderAt。multipart.File 接口本身就内嵌了 ReaderAt
	// （大文件时底层是落在临时盘的 *os.File，小文件是内存 reader），直接传即可。
	zr, err := zip.NewReader(src, fileHeader.Size)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "压缩包已损坏或不是有效的 zip 文件"})
		return
	}

	title := strings.TrimSpace(c.PostForm("title"))
	if title == "" {
		title = strings.TrimSuffix(fileHeader.Filename, filepath.Ext(fileHeader.Filename))
	}
	if title == "" {
		title = "HTML 课件"
	}

	pkgID, err := h.coursewareService.CreatePackage(userID, roomID, title, fileHeader.Filename)
	if err != nil {
		log.Printf("[Courseware] 建记录失败 room=%s: %v", roomID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建课件记录失败"})
		return
	}

	destDir := filepath.Join(services.CoursewareRoot, pkgID)
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		h.coursewareService.DeletePackage(pkgID)
		log.Printf("[Courseware] 建目录失败 %s: %v", destDir, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器存储目录不可写"})
		return
	}

	res, err := services.ExtractZip(zr, destDir)
	if err != nil {
		h.coursewareService.DeletePackage(pkgID)
		// 解压失败的原因基本都是「用户该知道的事」（没有 index.html、超限、
		// 含越界条目），原样透出去，不要吞成一句「导入失败」
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.coursewareService.FinalizePackage(pkgID, res.EntryFile, res.FileCount, res.TotalBytes); err != nil {
		h.coursewareService.DeletePackage(pkgID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存课件信息失败"})
		return
	}

	// ── 建画布组件（沿用 CreateHtmlWidget 的结构，payload 只放位置与标题）──
	var geo struct {
		X, Y, Width, Height float64
	}
	geo.X = parseFormFloat(c, "x", 0)
	geo.Y = parseFormFloat(c, "y", 0)
	geo.Width = parseFormFloat(c, "width", 720)   // 课件多为 16:9 整页，比粘贴源码的 480×360 大
	geo.Height = parseFormFloat(c, "height", 460) //

	elemData := map[string]interface{}{
		"type":   models.ElementTypeHtmlWidget,
		"x":      geo.X,
		"y":      geo.Y,
		"width":  geo.Width,
		"height": geo.Height,
		"payload": map[string]interface{}{
			"title":  title,
			"source": "zip", // 前端据此走 iframe src 而非 srcDoc
		},
	}
	payloadJSON, _ := json.Marshal(elemData)

	elem, err := h.widgetService.CreateElement(roomID, userID, "老师", models.ElementTypeHtmlWidget, payloadJSON)
	if err != nil {
		h.coursewareService.DeletePackage(pkgID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建组件失败"})
		return
	}
	// 先挂接再广播：确保各端收到 element_create 后立刻来拉一定拿得到
	if err := h.coursewareService.BindToElement(elem.ID, roomID, pkgID); err != nil {
		h.coursewareService.DeletePackage(pkgID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "挂接课件失败"})
		return
	}

	elemData["id"] = elem.ID
	broadcastBytes, _ := json.Marshal(map[string]interface{}{
		"type": ws.MsgElementCreate,
		"data": elemData,
		"from": userID,
	})
	if room := h.hub.GetRoom(roomID); room != nil {
		room.BroadcastRaw(broadcastBytes)
	}

	log.Printf("[Courseware] 导入成功 room=%s element=%s pkg=%s 文件=%d 解压=%.1fMB 入口=%s 剥前缀=%q 跳过垃圾=%d",
		roomID, elem.ID, pkgID, res.FileCount, float64(res.TotalBytes)/(1<<20),
		res.EntryFile, res.Stripped, res.SkippedN)

	c.JSON(http.StatusOK, gin.H{
		"id":            elem.ID,
		"courseware_id": pkgID,
		"entry_file":    res.EntryFile,
		"file_count":    res.FileCount,
		"total_bytes":   res.TotalBytes,
		"stripped_dir":  res.Stripped,
		"skipped":       res.SkippedN,
	})
}

func parseFormFloat(c *gin.Context, key string, def float64) float64 {
	s := c.PostForm(key)
	if s == "" {
		return def
	}
	var v float64
	if _, err := fmt.Sscanf(s, "%f", &v); err != nil || v <= 0 {
		return def
	}
	return v
}

// GetCoursewareMeta GET /api/rooms/:id/elements/:eid/courseware （OptionalAuth）
// 前端拿它判断这个 html_widget 是 zip 课件还是粘贴源码，并取入口文件名。
func (h *CoursewareHandler) GetCoursewareMeta(c *gin.Context) {
	roomID := c.Param("id")
	elementID := c.Param("eid")
	if !h.elementBelongsToRoom(c, elementID, roomID) {
		return
	}
	pkg, err := h.coursewareService.GetPackageByElement(elementID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询课件失败"})
		return
	}
	if pkg == nil {
		// 不是错误：这个组件就是粘贴源码的
		c.JSON(http.StatusOK, gin.H{"is_courseware": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"is_courseware": true,
		"courseware_id": pkg.ID,
		"title":         pkg.Title,
		"entry_file":    pkg.EntryFile,
		"file_count":    pkg.FileCount,
		"total_bytes":   pkg.TotalBytes,
	})
}

// ServeCoursewareFile GET /api/rooms/:id/elements/:eid/courseware/files/*filepath （OptionalAuth）
//
// 两个容易翻车处，都写在这里免得下次再踩：
//
//  1. **不能用 http.ServeFile**：它对以 "/index.html" 结尾的请求会做一次
//     localRedirect 到 "./"，而我们的入口恰好就叫 index.html，
//     结果是课件一加载就被重定向到一个不存在的路径。改用 http.ServeContent，
//     它同样支持 Range 请求（mp4 拖进度条要靠它），但不做那个重定向。
//  2. **中文文件名**：真实课件的 assets 里全是
//     `ai_左侧为清澈_流动的液态水.jpg` 这种名字，浏览器请求时会 percent-encode。
//     gin 的 *filepath 参数取自 URL.Path，Go 的 net/http 已经解码过，
//     所以这里拿到的是解码后的原名——**不要再手动 unescape 一次**，
//     二次解码会把 %2e%2e 变回 ..，反而开出一个穿越口子。
func (h *CoursewareHandler) ServeCoursewareFile(c *gin.Context) {
	roomID := c.Param("id")
	elementID := c.Param("eid")
	if !h.elementBelongsToRoom(c, elementID, roomID) {
		return
	}

	pkg, err := h.coursewareService.GetPackageByElement(elementID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询课件失败"})
		return
	}
	if pkg == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "该组件不是 zip 课件"})
		return
	}

	rel := strings.TrimPrefix(c.Param("filepath"), "/")
	if rel == "" {
		rel = pkg.EntryFile
	}

	root := filepath.Join(services.CoursewareRoot, pkg.StorageDir)
	// 与解压时同一套夹紧逻辑：URL 里同样可能出现 ../
	cleaned := path.Clean("/" + strings.ReplaceAll(rel, `\`, "/"))
	target := filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(cleaned, "/")))
	if target != root && !strings.HasPrefix(target, root+string(os.PathSeparator)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "非法路径"})
		return
	}

	f, err := os.Open(target)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在"})
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在"})
		return
	}

	ext := strings.ToLower(filepath.Ext(target))
	if ct, ok := coursewareMIME[ext]; ok {
		c.Header("Content-Type", ct)
	} else {
		// 白名单外一律当附件，不给它在浏览器里执行的机会
		c.Header("Content-Type", "application/octet-stream")
		c.Header("Content-Disposition", "attachment")
	}
	c.Header("X-Content-Type-Options", "nosniff")
	// 课件内容一经导入不再变化（要改就是重新上传成新包），可放心长缓存
	c.Header("Cache-Control", "private, max-age=3600")

	http.ServeContent(c.Writer, c.Request, filepath.Base(target), st.ModTime(), f)
}

// elementBelongsToRoom 校验组件确属该房间且未删除。
// 口径与 room_handler.go 的 GetHtmlWidgetContent 保持一致，
// 不在此处发明新的访问控制。
func (h *CoursewareHandler) elementBelongsToRoom(c *gin.Context, elementID, roomID string) bool {
	var count int
	err := h.roomService.DB().QueryRowContext(
		c.Request.Context(),
		`SELECT COUNT(*) FROM room_elements
		  WHERE id = $1 AND room_id = $2 AND type = $3 AND is_deleted = FALSE`,
		elementID, roomID, models.ElementTypeHtmlWidget,
	).Scan(&count)
	if err != nil || count == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "HTML 组件不存在"})
		return false
	}
	return true
}
