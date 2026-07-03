package models

import "time"

// Group 课堂分组
type Group struct {
	ID            string    `json:"id"`
	RoomID        string    `json:"room_id"`
	Name          string    `json:"name"`
	Color         string    `json:"color"`
	Members       []string  `json:"members"`
	LeaderUUID    string    `json:"leader_uuid"`
	SortOrder     int       `json:"sort_order"`
	ZoneElementID *string   `json:"zone_element_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// AutoGroupRequest 自动分组请求体
// mode="by_groups": n 为组数
// mode="by_count":  n 为每组人数
type AutoGroupRequest struct {
	Mode string `json:"mode" binding:"required"`
	N    int    `json:"n"    binding:"required,min=1"`
}
