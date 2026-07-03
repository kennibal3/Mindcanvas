// =============================================================
// MindCanvas v3.0 - JWT 工具模块
// 功能：Token 签发与解析，支持四级角色
// 算法：HS256，存储于 HttpOnly Cookie
// =============================================================
package utils

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims JWT 自定义声明
type Claims struct {
	UserID      string   `json:"user_id"`      // 用户 UUID
	Role        string   `json:"role"`          // 角色：superadmin/admin/teacher
	TenantID    string   `json:"tenant_id"`     // 租户 ID（superadmin 为空字符串）
	DisplayName string   `json:"display_name"`  // 显示名称
	Permissions []string `json:"permissions"`   // 权限列表
	jwt.RegisteredClaims                        // 标准声明（过期时间等）
}

// JWT 相关错误定义
var (
	ErrTokenExpired = errors.New("Token 已过期")
	ErrTokenInvalid = errors.New("Token 无效")
	ErrTokenEmpty   = errors.New("Token 为空")
)

// GenerateToken 签发 JWT Token
// 参数：
//   - secret: JWT 密钥
//   - userID: 用户 UUID
//   - role: 用户角色
//   - tenantID: 租户 ID
//   - displayName: 显示名称
//   - expire: 过期时长
//
// 返回：Token 字符串和错误
func GenerateToken(secret, userID, role, tenantID, displayName string, expire time.Duration) (string, error) {
	// 根据角色设置权限列表
	permissions := getPermissionsByRole(role)

	// 构建声明
	claims := Claims{
		UserID:      userID,
		Role:        role,
		TenantID:    tenantID,
		DisplayName: displayName,
		Permissions: permissions,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expire)), // 过期时间
			IssuedAt:  jwt.NewNumericDate(time.Now()),             // 签发时间
			Issuer:    "mindcanvas",                               // 签发者
		},
	}

	// 使用 HS256 算法签发
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseToken 解析并验证 JWT Token
// 参数：
//   - tokenString: Token 字符串
//   - secret: JWT 密钥
//
// 返回：解析后的 Claims 和错误
func ParseToken(tokenString, secret string) (*Claims, error) {
	if tokenString == "" {
		return nil, ErrTokenEmpty
	}

	// 解析 Token
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		// 验证签名算法
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrTokenInvalid
		}
		return []byte(secret), nil
	})

	if err != nil {
		// 区分过期和其他错误
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrTokenExpired
		}
		return nil, ErrTokenInvalid
	}

	// 提取声明
	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, ErrTokenInvalid
}

// getPermissionsByRole 根据角色返回权限列表
// 权限采用 resource:action 格式
func getPermissionsByRole(role string) []string {
	switch role {
	case "superadmin":
		return []string{
			// 租户管理
			"tenant:create", "tenant:read", "tenant:update", "tenant:disable",
			// 用户管理
			"user:create", "user:read", "user:update", "user:disable",
			// 房间管理
			"room:create", "room:read", "room:update", "room:delete",
			"room:lock", "room:readonly",
			// 场控
			"member:kick", "member:gather", "member:list",
			// 元素管理
			"element:create", "element:update", "element:delete",
			// 导出
			"export:csv", "export:image",
			// 系统
			"system:config", "system:stats",
		}
	case "admin":
		return []string{
			// 用户管理（本租户）
			"user:create", "user:read", "user:update", "user:disable",
			// 房间管理
			"room:create", "room:read", "room:update", "room:delete",
			"room:lock", "room:readonly",
			// 场控
			"member:kick", "member:gather", "member:list",
			// 元素管理
			"element:create", "element:update", "element:delete",
			// 导出
			"export:csv", "export:image",
		}
	case "teacher":
		return []string{
			// 房间管理（自己的）
			"room:create", "room:read", "room:update", "room:delete",
			"room:lock", "room:readonly",
			// 场控
			"member:kick", "member:gather", "member:list",
			// 元素管理
			"element:create", "element:update", "element:delete",
			// 导出
			"export:csv", "export:image",
		}
	default:
		return []string{}
	}
}
