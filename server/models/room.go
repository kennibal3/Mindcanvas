// =============================================================
// MindCanvas v3.0 - 房间数据模型
// 对应数据库表：rooms
// 支持 room_mode 字段：whiteboard / cards / interactive
// =============================================================
package models

import "time"

// Room 房间模型
type Room struct {
	ID          string     `json:"id"`
	TeacherID   string     `json:"teacher_id"`
	TenantID    string     `json:"tenant_id"`
	Title       string     `json:"title"`
	InviteCode  string     `json:"invite_code"`
	IsLocked    bool       `json:"is_locked"`
	IsReadOnly  bool       `json:"is_readonly"`
	MaxCapacity int        `json:"max_capacity"`
	Status      string     `json:"status"`
	RoomMode    string     `json:"room_mode"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	FinishedAt  *time.Time `json:"finished_at,omitempty"`
}

// 房间模式常量
const (
	RoomModeWhiteboard  = "whiteboard"
	RoomModeCards       = "cards"
	RoomModeInteractive = "interactive"
)

// CreateRoomRequest 创建房间请求
type CreateRoomRequest struct {
	Title       string `json:"title" binding:"required"`
	MaxCapacity int    `json:"max_capacity"`
	RoomMode    string `json:"room_mode"`
}

// UpdateRoomRequest 更新房间请求（字段可选）
type UpdateRoomRequest struct {
	Title       *string `json:"title"`
	MaxCapacity *int    `json:"max_capacity"`
	ExpiresAt   *string `json:"expires_at"` // 有效期，格式 "2006-01-02"，空字符串表示清除
}

// LockRoomRequest 锁定请求
type LockRoomRequest struct {
	IsLocked bool `json:"is_locked"`
}

// ReadOnlyRequest 只读请求
type ReadOnlyRequest struct {
	IsReadOnly bool `json:"is_readonly"`
}

// KickRequest 踢人请求
type KickRequest struct {
	TargetUUID string `json:"target_uuid" binding:"required"`
	Reason     string `json:"reason"`
}

// GatherRequest 召集请求
type GatherRequest struct {
	ViewportX float64 `json:"viewport_x"`
	ViewportY float64 `json:"viewport_y"`
	Zoom      float64 `json:"zoom"`
}
