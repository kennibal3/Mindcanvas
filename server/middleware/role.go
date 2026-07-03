// =============================================================
// MindCanvas v3.0 - 角色权限中间件
// 功能：基于角色的访问控制（RBAC）
// 使用方式：router.POST("/api/xxx", middleware.RequireRole("superadmin", "admin"), handler)
// =============================================================
package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// RequireRole 角色检查中间件
// 参数 roles：允许访问的角色列表
// superadmin 拥有最高权限，始终放行
func RequireRole(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 获取当前用户角色
		currentRole := GetRole(c)
		if currentRole == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "未认证",
				"message": "无法获取用户角色信息",
			})
			return
		}

		// superadmin 始终放行（最高权限）
		if currentRole == "superadmin" {
			c.Next()
			return
		}

		// 检查当前角色是否在允许列表中
		for _, allowedRole := range roles {
			if currentRole == allowedRole {
				c.Next()
				return
			}
		}

		// 权限不足
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error":   "权限不足",
			"message": "您的角色无权访问此资源",
		})
	}
}

// RequireTenantAccess 租户隔离中间件
// 确保 admin/teacher 只能访问自己租户的数据
// superadmin 可访问所有租户
func RequireTenantAccess() gin.HandlerFunc {
	return func(c *gin.Context) {
		currentRole := GetRole(c)

		// superadmin 不受租户限制
		if currentRole == "superadmin" {
			c.Next()
			return
		}

		// 获取当前用户的租户 ID
		userTenantID := GetTenantID(c)
		if userTenantID == "" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "租户信息缺失",
				"message": "无法确认您所属的租户",
			})
			return
		}

		// 将租户 ID 存入 Context，后续查询时用于数据过滤
		c.Set("tenant_filter", userTenantID)
		c.Next()
	}
}
