// =============================================================
// MindCanvas v3.0 - CORS 跨域中间件
// 功能：处理跨域请求，支持 Cookie 传输
// 安全：仅允许配置的白名单域名
// =============================================================
package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/config"
)

// CORS 跨域中间件
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := config.Get()

		// 获取请求来源
		origin := c.GetHeader("Origin")

		// 检查来源是否在白名单中
		allowedOrigins := strings.Split(cfg.CORS.Origins, ",")
		allowed := false
		for _, o := range allowedOrigins {
			if strings.TrimSpace(o) == origin {
				allowed = true
				break
			}
		}

		if allowed {
			// 设置 CORS 响应头
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
			c.Header("Access-Control-Allow-Credentials", "true") // 允许 Cookie
			c.Header("Access-Control-Max-Age", "86400")          // 预检缓存 24 小时
		}

		// 处理 OPTIONS 预检请求
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
