// =============================================================
// MindCanvas v3.0 - JWT 认证中间件
// 功能：从 HttpOnly Cookie 提取 JWT，验证后注入用户信息到 Context
// 安全：Cookie 传输（防 XSS），不使用 LocalStorage
// =============================================================
package middleware

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/config"
	"mindcanvas-server/utils"
)

// Context Key 常量，用于在 gin.Context 中存取用户信息
const (
	ContextKeyUserID      = "user_id"      // 用户 UUID
	ContextKeyRole        = "role"          // 用户角色
	ContextKeyTenantID    = "tenant_id"     // 租户 ID
	ContextKeyDisplayName = "display_name"  // 显示名称
	ContextKeyPermissions = "permissions"   // 权限列表
)

// AuthRequired JWT 认证中间件
// 从 HttpOnly Cookie 中提取 Token，解析验证后注入 Context
// 验证失败返回 401 Unauthorized
func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := config.Get()

		// 从 Cookie 中提取 JWT Token
		tokenString, err := c.Cookie(cfg.JWT.CookieName)
		if err != nil {
			log.Printf("[认证] Cookie 中未找到 Token: %v", err)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "未登录",
				"message": "请先登录后再操作",
			})
			return
		}

		// 解析并验证 Token
		claims, err := utils.ParseToken(tokenString, cfg.JWT.Secret)
		if err != nil {
			log.Printf("[认证] Token 验证失败: %v", err)
			// 清除无效 Cookie
			c.SetCookie(cfg.JWT.CookieName, "", -1, "/", cfg.JWT.CookieDomain, cfg.JWT.CookieSecure, true)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "认证失败",
				"message": err.Error(),
			})
			return
		}

		// 将用户信息注入到 gin.Context，后续 Handler 可直接读取
		c.Set(ContextKeyUserID, claims.UserID)
		c.Set(ContextKeyRole, claims.Role)
		c.Set(ContextKeyTenantID, claims.TenantID)
		c.Set(ContextKeyDisplayName, claims.DisplayName)
		c.Set(ContextKeyPermissions, claims.Permissions)

		c.Next()
	}
}

// GetUserID 从 Context 获取当前用户 ID（辅助函数）
func GetUserID(c *gin.Context) string {
	if v, exists := c.Get(ContextKeyUserID); exists {
		return v.(string)
	}
	return ""
}

// GetRole 从 Context 获取当前用户角色
func GetRole(c *gin.Context) string {
	if v, exists := c.Get(ContextKeyRole); exists {
		return v.(string)
	}
	return ""
}

// GetTenantID 从 Context 获取当前用户租户 ID
func GetTenantID(c *gin.Context) string {
	if v, exists := c.Get(ContextKeyTenantID); exists {
		return v.(string)
	}
	return ""
}

// GetDisplayName 从 Context 获取当前用户显示名称
func GetDisplayName(c *gin.Context) string {
	if v, exists := c.Get(ContextKeyDisplayName); exists {
		return v.(string)
	}
	return ""
}

// OptionalAuth 可选鉴权中间件（需求3：头像上传接口使用）
// 有 JWT Cookie 时解析并注入 user_id（教师场景）
// 无 JWT Cookie 时直接放行（学生入场前上传场景）
// 与 AuthRequired 的区别：无 token 时不返回 401，继续执行后续 handler
func OptionalAuth() gin.HandlerFunc {
	cfg := config.Get()
	return func(c *gin.Context) {
		// 尝试从 Cookie 读取 token
		tokenStr, err := c.Cookie(cfg.JWT.CookieName)
		if err != nil || tokenStr == "" {
			// 无 token：放行，不注入任何用户信息
			c.Next()
			return
		}
		// 有 token：尝试解析，解析失败也放行（不阻断请求）
		claims, err := utils.ParseToken(tokenStr, cfg.JWT.Secret)
		if err != nil {
			// token 无效或过期，作为匿名请求处理
			c.Next()
			return
		}
		// token 有效：注入用户信息到 Context
		c.Set(ContextKeyUserID, claims.UserID)
		c.Set(ContextKeyRole, claims.Role)
		c.Set(ContextKeyTenantID, claims.TenantID)
		c.Set(ContextKeyDisplayName, claims.DisplayName)
		c.Next()
	}
}
