// =============================================================
// MindCanvas v4.1 Phase7 - 公开分享页数据模型
// 对应数据库表：room_shares、room_templates
// =============================================================
package models

import "time"

// ============================================================
// room_shares：公开分享配置
// ============================================================

// RoomShare 公开分享记录
type RoomShare struct {
    ID           string     `json:"id"`
    RoomID       string     `json:"room_id"`
    ShareToken   string     `json:"share_token"`
    Title        string     `json:"title"`
    Description  string     `json:"description"`
    Visibility   string     `json:"visibility"`   // public | password
    HideNames    bool       `json:"hide_names"`
    ShowStats    bool       `json:"show_stats"`
    ShowCanvas   bool       `json:"show_canvas"`
    ShowDropzone bool       `json:"show_dropzone"`
    ExpiresAt    *time.Time `json:"expires_at,omitempty"`
    ViewCount    int        `json:"view_count"`
    CreatedBy    string     `json:"created_by"`
    CreatedAt    time.Time  `json:"created_at"`
    UpdatedAt    time.Time  `json:"updated_at"`
}

// CreateShareRequest 创建/更新分享请求体
type CreateShareRequest struct {
    Title        string  `json:"title"`
    Description  string  `json:"description"`
    Visibility   string  `json:"visibility"`    // public | password，默认 public
    Password     string  `json:"password"`      // visibility=password 时必填
    HideNames    bool    `json:"hide_names"`
    ShowStats    bool    `json:"show_stats"`
    ShowCanvas   bool    `json:"show_canvas"`
    ShowDropzone bool    `json:"show_dropzone"`
    ExpiresAt    string  `json:"expires_at"`    // ISO8601 字符串，空字符串表示不过期
}

// ShareMetaResponse 分享页元数据（公开，不含密码散列）
type ShareMetaResponse struct {
    ShareToken   string     `json:"share_token"`
    Title        string     `json:"title"`
    Description  string     `json:"description"`
    Visibility   string     `json:"visibility"`
    HideNames    bool       `json:"hide_names"`
    ShowStats    bool       `json:"show_stats"`
    ShowCanvas   bool       `json:"show_canvas"`
    ShowDropzone bool       `json:"show_dropzone"`
    ExpiresAt    *time.Time `json:"expires_at,omitempty"`
    ViewCount    int        `json:"view_count"`
    CreatedAt    time.Time  `json:"created_at"`
    // 房间基本信息（冗余，避免额外查询）
    RoomTitle    string     `json:"room_title"`
    TeacherName  string     `json:"teacher_name"`
}

// VerifyPasswordRequest 密码验证请求
type VerifyPasswordRequest struct {
    Password string `json:"password" binding:"required"`
}

// ============================================================
// room_templates：课堂模板
// ============================================================

// RoomTemplate 课堂模板记录
type RoomTemplate struct {
    ID           string      `json:"id"`
    Name         string      `json:"name"`
    Description  string      `json:"description"`
    Category     string      `json:"category"`
    Tags         []string    `json:"tags"`
    Thumbnail    string      `json:"thumbnail"`
    SourceRoom   string      `json:"source_room,omitempty"`
    StepsJSON    interface{} `json:"steps_json"`
    ElementsJSON interface{} `json:"elements_json"`
    IsPublic     bool        `json:"is_public"`
    AuthorID     string      `json:"author_id"`
    AuthorName   string      `json:"author_name"`
    UseCount     int         `json:"use_count"`
    CreatedAt    time.Time   `json:"created_at"`
    UpdatedAt    time.Time   `json:"updated_at"`
}

// CreateTemplateRequest 保存模板请求体
type CreateTemplateRequest struct {
    Name        string `json:"name" binding:"required"`
    Description string `json:"description"`
    Category    string `json:"category"`
    IsPublic    bool   `json:"is_public"`
}
