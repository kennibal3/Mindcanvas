// =============================================================
// MindCanvas - 作业归属校验中间件（BUG-015）
// 功能：拦截 /api/assignments/:aid 下的全部子路由，确认该作业属于当前登录教师
// 背景：该路由组此前只校验「是不是登录教师」，不校验「这份作业是不是你的」，
//       46 条路由中 43 条可被任意登录教师凭 UUID 直接读写删（详见 V6 BUG-015）。
// 口径：superadmin 全放行（与 RequireRole 一致）；admin 与普通教师同权，
//       只能操作自己 created_by 名下的作业（assignments 表无 tenant_id，
//       不做租户级放行）。
// 说明：挂在路由组上而非逐个 service 补 SQL —— 新增路由默认即受保护。
// =============================================================
package middleware

import (
	"database/sql"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

// ContextKeyAssignmentOwner 校验通过后写入 Context，供 handler 复用，避免重复查库
const ContextKeyAssignmentOwner = "assignment_owner"

// isUUIDLike 粗校验 UUID 字面量（8-4-4-4-12 十六进制）
// 目的：非法 :aid 直接判 404，避免把 "invalid input syntax for type uuid"
// 这类 PG 报错误当成 500 抛给前端
func isUUIDLike(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, ch := range s {
		switch i {
		case 8, 13, 18, 23:
			if ch != '-' {
				return false
			}
		default:
			isHex := (ch >= '0' && ch <= '9') ||
				(ch >= 'a' && ch <= 'f') ||
				(ch >= 'A' && ch <= 'F')
			if !isHex {
				return false
			}
		}
	}
	return true
}

// AssignmentOwnership 作业归属校验中间件
// 用法：assignments.Use(AuthRequired(), RequireRole(...), AssignmentOwnership(db))
// 无 :aid 的路由（GET/POST ""、/parser/health）自动放行。
func AssignmentOwnership(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		aid := c.Param("aid")

		// 该路由不带 :aid（列表、创建、parser/health）→ 与本中间件无关
		if aid == "" {
			c.Next()
			return
		}

		// superadmin 最高权限，始终放行（与 RequireRole 的既有约定保持一致）
		if GetRole(c) == "superadmin" {
			c.Next()
			return
		}

		if !isUUIDLike(aid) {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{
				"error":   "作业不存在或无权操作",
				"message": "作业不存在或无权操作",
			})
			return
		}

		var createdBy sql.NullString
		err := db.QueryRow(
			`SELECT created_by FROM assignments WHERE id = $1`, aid,
		).Scan(&createdBy)

		if err == sql.ErrNoRows {
			// 与越权返回同一措辞，不泄露「该作业是否存在」
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{
				"error":   "作业不存在或无权操作",
				"message": "作业不存在或无权操作",
			})
			return
		}
		if err != nil {
			log.Printf("[作业归属] 查询失败 作业:%s 错误:%v", aid, err)
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"error":   "校验作业归属失败",
				"message": "服务器内部错误，请稍后重试",
			})
			return
		}

		userID := GetUserID(c)
		if !createdBy.Valid || createdBy.String != userID {
			log.Printf("[作业归属] 拦截越权访问 作业:%s 归属:%s 请求者:%s 路径:%s %s",
				aid, createdBy.String, userID, c.Request.Method, c.Request.URL.Path)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "作业不存在或无权操作",
				"message": "作业不存在或无权操作",
			})
			return
		}

		c.Set(ContextKeyAssignmentOwner, createdBy.String)
		c.Next()
	}
}
