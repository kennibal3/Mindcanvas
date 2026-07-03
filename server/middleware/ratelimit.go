// =============================================================
// MindCanvas v3.0 - 限速中间件
// 功能：基于 Redis 的滑动窗口限速，按 IP 限制请求频率
// 防护：登录暴力破解、API 滥用、文件上传滥用
// V4.3新增：UploadRateLimit 公开上传接口专用限速
// =============================================================
package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/database"
)

// RateLimit 创建限速中间件
// 参数：
//   - maxRequests: 时间窗口内最大请求数
//   - window: 时间窗口长度
//   - keyPrefix: Redis 键前缀（区分不同接口）
func RateLimit(maxRequests int, window time.Duration, keyPrefix string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 获取客户端 IP
		clientIP := c.ClientIP()

		// 构建 Redis 键
		key := fmt.Sprintf("ratelimit:%s:%s", keyPrefix, clientIP)

		ctx := context.Background()
		rdb := database.GetRedis()

		// Redis 不可用时放行，不影响正常业务
		if rdb == nil {
			c.Next()
			return
		}

		// 递增计数器
		count, err := rdb.Incr(ctx, key).Result()
		if err != nil {
			// Redis 不可用时放行
			c.Next()
			return
		}

		// 首次请求时设置过期时间
		if count == 1 {
			rdb.Expire(ctx, key, window)
		}

		// 超过限制则拒绝
		if count > int64(maxRequests) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":   "请求过于频繁",
				"message": fmt.Sprintf("请在 %v 后重试", window),
				"limit":   maxRequests,
				"window":  window.String(),
			})
			return
		}

		c.Next()
	}
}

// LoginRateLimit 登录接口专用限速（10次/分钟）
// 防止暴力破解教师/管理员账号
func LoginRateLimit() gin.HandlerFunc {
	return RateLimit(10, time.Minute, "login")
}

// APIRateLimit 通用 API 限速（200次/分钟）
// 用于学生入场、验证作业码等普通公开接口
func APIRateLimit() gin.HandlerFunc {
	return RateLimit(200, time.Minute, "api")
}

// UploadRateLimit 公开文件上传专用限速（每IP每分钟10次）
// 用于 POST /api/submit/upload（学生作业文件上传，完全公开接口）
// 比 APIRateLimit 严格20倍，防止脚本批量上传占用存储
// 合法学生场景：一次作业最多提交2-3个文件，10次/分钟完全够用
func UploadRateLimit() gin.HandlerFunc {
	return RateLimit(10, time.Minute, "upload")
}
