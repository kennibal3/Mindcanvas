// =============================================================
// MindCanvas v4.1 Phase7 - 公开分享页处理器
// API：
//   POST   /api/rooms/:id/share          发布/更新分享
//   GET    /api/rooms/:id/share          查看当前房间的分享配置
//   DELETE /api/rooms/:id/share/:sid     删除分享
//   GET    /api/share/:token/meta        获取分享页元数据（公开）
//   POST   /api/share/:token/verify      验证分享密码（公开）
//   GET    /api/share/:token/data        获取分享页完整数据（公开）
//   GET    /api/templates                获取模板列表（当前用户）
//   POST   /api/rooms/:id/templates      保存模板
//   DELETE /api/rooms/:id/templates/:tid 删除模板
// =============================================================
package handlers

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/models"
	"mindcanvas-server/services"
)

// ShareHandler 公开分享页处理器
type ShareHandler struct {
	shareSvc *services.ShareService
}

// NewShareHandler 创建分享处理器实例
func NewShareHandler(shareSvc *services.ShareService) *ShareHandler {
	return &ShareHandler{shareSvc: shareSvc}
}

// =============================================================
// 教师端：分享管理（需认证）
// =============================================================

// PublishShare 发布或更新公开分享页
// POST /api/rooms/:id/share
// 说明：show_stats/show_canvas/show_dropzone 默认值为 true
//       前端需明确传 false 才会关闭对应区块
func (h *ShareHandler) PublishShare(c *gin.Context) {
	roomID := c.Param("id")
	userID, _ := c.Get("user_id")

	// 读取原始 body 以区分"未传字段"和"传了 false"
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "读取请求体失败"})
		return
	}

	// 先用 map 检测哪些字段被传入
	var rawMap map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &rawMap); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "JSON 格式错误"})
		return
	}

	// 构造请求体，未传字段使用默认值 true
	req := models.CreateShareRequest{
		Title:        stringFromMap(rawMap, "title"),
		Description:  stringFromMap(rawMap, "description"),
		Visibility:   stringFromMap(rawMap, "visibility"),
		Password:     stringFromMap(rawMap, "password"),
		ExpiresAt:    stringFromMap(rawMap, "expires_at"),
		HideNames:    boolFromMap(rawMap, "hide_names", false),
		ShowStats:    boolFromMapDefault(rawMap, "show_stats", true),
		ShowCanvas:   boolFromMapDefault(rawMap, "show_canvas", true),
		ShowDropzone: boolFromMapDefault(rawMap, "show_dropzone", true),
	}

	share, err := h.shareSvc.PublishShare(roomID, userID.(string), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"share":     share,
		"share_url": "/share/" + share.ShareToken,
		"message":   "分享页已发布",
	})
}

// GetRoomShares 获取房间的分享配置列表
// GET /api/rooms/:id/share
func (h *ShareHandler) GetRoomShares(c *gin.Context) {
	roomID := c.Param("id")
	shares, err := h.shareSvc.GetSharesByRoom(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if shares == nil {
		shares = []models.RoomShare{}
	}
	c.JSON(http.StatusOK, gin.H{"shares": shares})
}

// DeleteShare 删除分享记录
// DELETE /api/rooms/:id/share/:sid
func (h *ShareHandler) DeleteShare(c *gin.Context) {
	shareID := c.Param("sid")
	userID, _ := c.Get("user_id")

	if err := h.shareSvc.DeleteShare(shareID, userID.(string)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "分享已删除"})
}

// =============================================================
// 公开端：分享页访问（无需认证）
// =============================================================

// GetShareMeta 获取分享页元数据（标题、作者、可见性等）
// GET /api/share/:token/meta
func (h *ShareHandler) GetShareMeta(c *gin.Context) {
	token := c.Param("token")
	meta, err := h.shareSvc.GetShareMetaByToken(token)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"meta": meta})
}

// VerifySharePassword 验证分享页密码
// POST /api/share/:token/verify
func (h *ShareHandler) VerifySharePassword(c *gin.Context) {
	token := c.Param("token")
	var req models.VerifyPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供密码"})
		return
	}
	if err := h.shareSvc.VerifySharePassword(token, req.Password); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"verified": true, "message": "密码正确"})
}

// GetShareData 获取分享页完整数据
// GET /api/share/:token/data
func (h *ShareHandler) GetShareData(c *gin.Context) {
	token := c.Param("token")

	// 1. 先获取元数据（含有效性和过期校验）
	meta, err := h.shareSvc.GetShareMetaByToken(token)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	// 2. 密码保护：检查查询参数或请求头中的密码
	if meta.Visibility == "password" {
		pwd := c.Query("pwd")
		if pwd == "" {
			pwd = c.GetHeader("X-Share-Password")
		}
		if pwd == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":         "该分享页需要密码访问",
				"need_password": true,
			})
			return
		}
		if err := h.shareSvc.VerifySharePassword(token, pwd); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "密码错误"})
			return
		}
	}

	// 3. 获取完整数据
	data, err := h.shareSvc.GetShareData(token)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, data)
}

// =============================================================
// 模板管理（需认证）
// =============================================================

// ListTemplates 获取模板列表（自己的 + 公开的）
// GET /api/templates
func (h *ShareHandler) ListTemplates(c *gin.Context) {
	userID, _ := c.Get("user_id")
	templates, err := h.shareSvc.ListTemplates(userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if templates == nil {
		templates = []models.RoomTemplate{}
	}
	c.JSON(http.StatusOK, gin.H{"templates": templates})
}

// SaveTemplate 从当前房间保存模板
// POST /api/rooms/:id/templates
func (h *ShareHandler) SaveTemplate(c *gin.Context) {
	roomID := c.Param("id")
	userID, _ := c.Get("user_id")

	var req models.CreateTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数格式错误"})
		return
	}
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "模板名称不能为空"})
		return
	}

	tmpl, err := h.shareSvc.SaveTemplate(roomID, userID.(string), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"template": tmpl, "message": "模板保存成功"})
}

// DeleteTemplate 删除模板
// DELETE /api/rooms/:id/templates/:tid
func (h *ShareHandler) DeleteTemplate(c *gin.Context) {
	templateID := c.Param("tid")
	userID, _ := c.Get("user_id")

	if err := h.shareSvc.DeleteTemplate(templateID, userID.(string)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "模板已删除"})
}

// =============================================================
// 内部辅助函数：从原始 map 安全读取字段值
// =============================================================

// stringFromMap 从 map 中读取字符串，字段不存在或非字符串时返回空串
func stringFromMap(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// boolFromMap 从 map 中读取布尔值，字段不存在时返回 defaultVal
func boolFromMap(m map[string]interface{}, key string, defaultVal bool) bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return defaultVal
}

// boolFromMapDefault 同 boolFromMap，默认值为 true
func boolFromMapDefault(m map[string]interface{}, key string, defaultVal bool) bool {
	return boolFromMap(m, key, defaultVal)
}

// UseTemplate 使用模板创建新房间
// POST /api/templates/:id/use
func (h *ShareHandler) UseTemplate(c *gin.Context) {
	templateID := c.Param("id")
	userID, _ := c.Get("user_id")

	var req struct {
		Title string `json:"title"`
	}
	// title 可选，不绑定报错
	_ = c.ShouldBindJSON(&req)

	// 获取模板内容并递增计数
	tmpl, err := h.shareSvc.UseTemplate(templateID, userID.(string))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"template": tmpl,
		"message":  "模板加载成功，请基于此创建房间",
	})
}
