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
	CollabMode  string     `json:"collab_mode"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	FinishedAt  *time.Time `json:"finished_at,omitempty"`
}

// 房间模式常量（画布形态维度）
const (
	RoomModeWhiteboard  = "whiteboard"
	RoomModeCards       = "cards"
	RoomModeInteractive = "interactive"
)

// 房间协作形态常量（身份/权限维度，与 RoomMode 正交）
const (
	CollabModeRoster    = "roster"    // 实名上课
	CollabModeAnonymous = "anonymous" // 匿名培训（默认）
	CollabModeTeam      = "team"      // 团队协作（人人可删）
)

// CreateRoomRequest 创建房间请求
type CreateRoomRequest struct {
	Title       string `json:"title" binding:"required"`
	MaxCapacity int    `json:"max_capacity"`
	RoomMode    string `json:"room_mode"`
	CollabMode  string `json:"collab_mode"` // roster/anonymous/team，空则默认 anonymous
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
