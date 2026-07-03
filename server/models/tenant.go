// =============================================================
// MindCanvas v3.0 - 租户数据模型
// 对应数据库表：tenants
// =============================================================
package models

import "time"

// Tenant 租户模型（学校/机构）
type Tenant struct {
	ID          string    `json:"id"`           // UUID 主键
	Name        string    `json:"name"`         // 租户名称
	MaxTeachers int       `json:"max_teachers"` // 最大教师数
	MaxRooms    int       `json:"max_rooms"`    // 最大房间数
	IsActive    bool      `json:"is_active"`    // 是否启用
	CreatedAt   time.Time `json:"created_at"`   // 创建时间
}

// CreateTenantRequest 创建租户请求
type CreateTenantRequest struct {
	Name        string `json:"name" binding:"required"`          // 租户名称（必填）
	MaxTeachers int    `json:"max_teachers"`                     // 最大教师数（默认50）
	MaxRooms    int    `json:"max_rooms"`                        // 最大房间数（默认100）
}

// UpdateTenantRequest 更新租户请求
type UpdateTenantRequest struct {
	Name        *string `json:"name"`         // 租户名称（可选）
	MaxTeachers *int    `json:"max_teachers"` // 最大教师数（可选）
	MaxRooms    *int    `json:"max_rooms"`    // 最大房间数（可选）
	IsActive    *bool   `json:"is_active"`    // 是否启用（可选）
}
