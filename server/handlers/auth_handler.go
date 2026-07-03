// =============================================================
// MindCanvas - 登录鉴权处理器
// 需求3：UpdateProfile 支持 avatar_url 字段更新
//        GetCurrentUser 返回 avatar_url
// =============================================================
package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"mindcanvas-server/config"
	"mindcanvas-server/middleware"
	"mindcanvas-server/models"
	"mindcanvas-server/utils"
)

// AuthHandler 登录鉴权处理器
type AuthHandler struct {
	db *sql.DB
}

// NewAuthHandler 创建鉴权处理器
func NewAuthHandler(db *sql.DB) *AuthHandler {
	return &AuthHandler{db: db}
}

// Login 用户登录
// POST /api/auth/login
func (h *AuthHandler) Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "参数错误",
			"message": "用户名和密码不能为空",
		})
		return
	}
	// 查询用户（需求3：同时读取 avatar_url）
	var user models.User
	var tenantID sql.NullString
	var avatarURL sql.NullString
	var chatEnabled bool
	err := h.db.QueryRow(
		`SELECT id, tenant_id, username, password, display_name, role, is_active, avatar_url, COALESCE(chat_enabled, false) FROM users WHERE username = $1`,
		req.Username,
	).Scan(
		&user.ID, &tenantID, &user.Username, &user.Password,
		&user.DisplayName, &user.Role, &user.IsActive, &avatarURL, &chatEnabled,
	)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "登录失败",
			"message": "用户名或密码错误",
		})
		return
	}
	if err != nil {
		log.Printf("[登录] 查询用户失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "服务器错误",
			"message": "登录失败，请稍后重试",
		})
		return
	}
	if !user.IsActive {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "账号已禁用",
			"message": "请联系管理员启用账号",
		})
		return
	}
	// 验证密码（bcrypt）
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "登录失败",
			"message": "用户名或密码错误",
		})
		return
	}
	tenantIDStr := ""
	if tenantID.Valid {
		tenantIDStr = tenantID.String
	}
	user.TenantID = &tenantIDStr
	// 签发 JWT
	cfg := config.Get()
	token, err := utils.GenerateToken(
		cfg.JWT.Secret,
		user.ID,
		user.Role,
		tenantIDStr,
		user.DisplayName,
		cfg.JWT.Expire,
	)
	if err != nil {
		log.Printf("[登录] JWT 签发失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "服务器错误",
			"message": "Token 生成失败",
		})
		return
	}
	// 写入 HttpOnly Cookie
	maxAge := int(cfg.JWT.Expire.Seconds())
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(cfg.JWT.CookieName, token, maxAge, "/", cfg.JWT.CookieDomain, cfg.JWT.CookieSecure, true)
	log.Printf("[登录] 成功 - 用户:%s 角色:%s", user.Username, user.Role)
	// 需求3：返回 avatar_url
	avatarURLStr := ""
	if avatarURL.Valid {
		avatarURLStr = avatarURL.String
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "登录成功",
		"user": gin.H{
			"id":           user.ID,
			"username":     user.Username,
			"display_name": user.DisplayName,
			"role":         user.Role,
			"tenant_id":    tenantIDStr,
			"avatar_url":   avatarURLStr,
			"chat_enabled": chatEnabled,
		},
	})
}

// Logout 退出登录
// POST /api/auth/logout
func (h *AuthHandler) Logout(c *gin.Context) {
	cfg := config.Get()
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(cfg.JWT.CookieName, "", -1, "/", cfg.JWT.CookieDomain, cfg.JWT.CookieSecure, true)
	c.JSON(http.StatusOK, gin.H{"message": "已退出登录"})
}

// GetCurrentUser 获取当前登录用户信息
// GET /api/auth/me
// 需求3：从数据库读取最新 avatar_url
func (h *AuthHandler) GetCurrentUser(c *gin.Context) {
	userID, _ := c.Get("user_id")
	role, _ := c.Get("role")
	tenantID, _ := c.Get("tenant_id")
	displayName, _ := c.Get("display_name")
	avatarURL := ""
	if userID != nil {
		h.db.QueryRow(
			"SELECT COALESCE(avatar_url, '') FROM users WHERE id = $1",
			fmt.Sprintf("%v", userID),
		).Scan(&avatarURL)
	}
	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":           userID,
			"role":         role,
			"tenant_id":    tenantID,
			"display_name": displayName,
			"avatar_url":   avatarURL,
		},
	})
}

// UpdateProfile 教师修改自己的显示名、密码和头像
// PUT /api/auth/profile
// 需求3：新增 avatar_url 字段支持
func (h *AuthHandler) UpdateProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}
	var req struct {
		DisplayName string `json:"display_name"`
		AvatarURL   string `json:"avatar_url"`
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	hasDisplayName := req.DisplayName != ""
	hasAvatarURL   := req.AvatarURL != ""
	hasNewPassword := req.NewPassword != ""
	if !hasDisplayName && !hasAvatarURL && !hasNewPassword {
		c.JSON(http.StatusBadRequest, gin.H{"error": "没有要更新的内容"})
		return
	}
	if hasNewPassword {
		if req.OldPassword == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请输入当前密码"})
			return
		}
		var hashedPwd string
		if err := h.db.QueryRow("SELECT password FROM users WHERE id=$1", userID).Scan(&hashedPwd); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "用户不存在"})
			return
		}
		if err := bcrypt.CompareHashAndPassword([]byte(hashedPwd), []byte(req.OldPassword)); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "当前密码错误"})
			return
		}
		newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
			return
		}
		_, err = h.db.Exec(
			`UPDATE users SET password=$1, display_name=CASE WHEN $2!='' THEN $2 ELSE display_name END, avatar_url=CASE WHEN $3!='' THEN $3 ELSE avatar_url END, updated_at=NOW() WHERE id=$4`,
			string(newHash), req.DisplayName, req.AvatarURL, userID,
		)
		if err != nil {
			log.Printf("[UpdateProfile] 更新失败: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
			return
		}
	} else {
		_, err := h.db.Exec(
			`UPDATE users SET display_name=CASE WHEN $1!='' THEN $1 ELSE display_name END, avatar_url=CASE WHEN $2!='' THEN $2 ELSE avatar_url END, updated_at=NOW() WHERE id=$3`,
			req.DisplayName, req.AvatarURL, userID,
		)
		if err != nil {
			log.Printf("[UpdateProfile] 更新失败: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"message": "个人信息已更新"})
}
