// =============================================================
// MindCanvas v3.0 - 房间会话数据模型
// 对应数据库表：room_sessions
// 记录学生入场/离场信息
// =============================================================
package models

import "time"

// Session 房间会话模型
type Session struct {
	ID          string     `json:"id"`           // UUID 主键
	RoomID      string     `json:"room_id"`      // 所属房间 ID
	StudentUUID string     `json:"student_uuid"` // 学生 UUID
	Nickname    string     `json:"nickname"`      // 昵称
	Suffix      string     `json:"suffix"`        // 4 位防冒充后缀
	AvatarID    int        `json:"avatar_id"`     // 头像 ID
	IPAddress   *string    `json:"ip_address"`    // IP 地址
	IsBanned    bool       `json:"is_banned"`     // 是否封禁
	JoinedAt    time.Time  `json:"joined_at"`     // 入场时间
	LeftAt      *time.Time `json:"left_at"`       // 离场时间
}

// JoinRoomRequest 学生入场请求
type JoinRoomRequest struct {
	RoomCode string `json:"room_code" binding:"required"` // 房间邀请码（必填）
	Nickname string `json:"nickname" binding:"required"`  // 昵称（必填）
	AvatarID int    `json:"avatar_id"`                    // 头像 ID（默认1）
}

// JoinRoomResponse 学生入场响应
type JoinRoomResponse struct {
	UUID     string `json:"uuid"`      // 生成的学生 UUID
	Nickname string `json:"nickname"`  // 处理后的昵称（含后缀）
	RoomID   string `json:"room_id"`   // 房间 ID
	AvatarID int    `json:"avatar_id"` // 头像 ID
}

// ReclaimGenerateResponse 生成认领码响应
type ReclaimGenerateResponse struct {
	Code      string `json:"code"`       // 4 位认领码
	ExpiresIn int    `json:"expires_in"` // 有效期（秒）
}

// ReclaimVerifyRequest 验证认领码请求
type ReclaimVerifyRequest struct {
	Code string `json:"code" binding:"required"` // 4 位认领码
}
