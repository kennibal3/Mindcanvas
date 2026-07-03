// =============================================================
// MindCanvas v3.0 - 用户数据模型
// 对应数据库表：users（统一四级角色：superadmin/admin/teacher）
// 学生无账号，不在此模型中
// =============================================================
package models

import "time"

// User 用户模型
type User struct {
	ID          string    `json:"id"`           // UUID 主键
	TenantID    *string   `json:"tenant_id"`    // 租户 ID（superadmin 为 null）
	Username    string    `json:"username"`      // 登录用户名
	Password    string    `json:"-"`             // 密码（bcrypt，JSON 序列化时隐藏）
	DisplayName string    `json:"display_name"`  // 显示名称
	Role        string    `json:"role"`          // 角色
	IsActive    bool      `json:"is_active"`     // 是否启用
	CreatedBy   *string   `json:"created_by"`    // 创建者 ID
	CreatedAt   time.Time `json:"created_at"`    // 创建时间
	UpdatedAt   time.Time `json:"updated_at"`    // 更新时间
}

// LoginRequest 登录请求
type LoginRequest struct {
	Username string `json:"username" binding:"required"` // 用户名（必填）
	Password string `json:"password" binding:"required"` // 密码（必填）
}

// LoginResponse 登录响应
type LoginResponse struct {
	User  User   `json:"user"`  // 用户信息（不含密码）
	Token string `json:"token"` // JWT Token（同时写入 Cookie）
}

// CreateUserRequest 创建用户请求
type CreateUserRequest struct {
	Username    string `json:"username" binding:"required"`     // 用户名（必填）
	Password    string `json:"password" binding:"required"`     // 密码（必填）
	DisplayName string `json:"display_name"`                    // 显示名称
	Role        string `json:"role" binding:"required"`         // 角色（必填）
	TenantID    string `json:"tenant_id"`                       // 租户 ID
}

// UpdateUserStatusRequest 更新用户状态请求
type UpdateUserStatusRequest struct {
	IsActive bool `json:"is_active"` // 是否启用
}
