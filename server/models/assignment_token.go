// =============================================================
// MindCanvas Phase8-v2 - 作业码与花名册数据模型
// 功能：作业码生成/验证、花名册管理、学生身份续接
// =============================================================
package models

import "time"

// ===== Token类型常量 =====
const (
	TokenTypeDedicated = "dedicated" // 专属码：绑定课堂学生uuid（强身份）
	TokenTypeUniversal = "universal" // 通用码：任何人可用，提交时填姓名（弱身份）
)

// ===== 花名册来源常量 =====
const (
	RosterSourceClassroom = "classroom" // 从课堂在线人数同步
	RosterSourceManual    = "manual"    // 老师手动添加
	RosterSourceImport    = "import"    // CSV导入
)

// AssignmentToken 作业码
type AssignmentToken struct {
	ID           string     `json:"id"`
	AssignmentID string     `json:"assignment_id"`
	StudentUUID  string     `json:"student_uuid,omitempty"`
	StudentName  string     `json:"student_name,omitempty"`
	Token        string     `json:"token"`
	TokenType    string     `json:"token_type"`
	ExpiresAt    time.Time  `json:"expires_at"`
	UsedAt       *time.Time `json:"used_at,omitempty"`
	SubmissionID *string    `json:"submission_id,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

// AssignmentRoster 花名册条目
type AssignmentRoster struct {
	ID           string    `json:"id"`
	AssignmentID string    `json:"assignment_id"`
	StudentName  string    `json:"student_name"`
	StudentUUID  string    `json:"student_uuid,omitempty"`
	TokenID      *string   `json:"token_id,omitempty"`
	Source       string    `json:"source"`
	Expected     bool      `json:"expected"`
	CreatedAt    time.Time `json:"created_at"`
}

// RosterWithStatus 花名册条目含提交状态（老师视图核心）
type RosterWithStatus struct {
	AssignmentRoster
	Token          string     `json:"token,omitempty"`
	TokenType      string     `json:"token_type,omitempty"`
	TokenExpiresAt *time.Time `json:"token_expires_at,omitempty"`
	HasSubmitted   bool       `json:"has_submitted"`
	SubmissionID   *string    `json:"submission_id,omitempty"`
	SubmittedAt    *time.Time `json:"submitted_at,omitempty"`
	ContentType    string     `json:"content_type,omitempty"`
	AssessStatus   string     `json:"assess_status,omitempty"`
}

// TokenVerifyResult 作业码验证结果
type TokenVerifyResult struct {
	Valid        bool   `json:"valid"`
	Token        string `json:"token"`
	TokenType    string `json:"token_type"`
	StudentUUID  string `json:"student_uuid,omitempty"`
	StudentName  string `json:"student_name,omitempty"`
	AssignmentID string `json:"assignment_id"`
	AssignmentTitle       string     `json:"assignment_title"`
	AssignmentDescription string     `json:"assignment_description"`
	AssignmentStatus      string     `json:"assignment_status"`
	DueAt                 *time.Time `json:"due_at,omitempty"`
	AllowResubmit         bool       `json:"allow_resubmit"`
	ExistingSubmission *AssignmentSubmission `json:"existing_submission,omitempty"`
}

// ===== 请求结构体 =====

// GenerateTokensRequest 生成作业码请求
type GenerateTokensRequest struct {
	TokenType  string `json:"token_type" binding:"required"`
	RoomID     string `json:"room_id,omitempty"`
	Count      int    `json:"count,omitempty"`
	ExpireDays int    `json:"expire_days,omitempty"`
}

// AddRosterRequest 手动添加花名册条目
type AddRosterRequest struct {
	StudentName string `json:"student_name" binding:"required"`
	StudentUUID string `json:"student_uuid,omitempty"`
}

// ImportRosterCSVRequest CSV导入花名册
type ImportRosterCSVRequest struct {
	Names []string `json:"names" binding:"required"`
}

// SyncFromClassroomRequest 从课堂在线人数同步花名册
type SyncFromClassroomRequest struct {
	RoomID string `json:"room_id" binding:"required"`
}

// SubmitByTokenRequest 学生凭作业码提交
// 支持文字/文件/链接三种提交方式
type SubmitByTokenRequest struct {
	Token       string `json:"token" binding:"required"`
	StudentName string `json:"student_name"` // 通用码时必填
	ContentType string `json:"content_type"` // text/file/link/mixed
	ContentText string `json:"content_text"` // 文字内容
	FileURL     string `json:"file_url"`     // 文件提交时的URL
	FileName    string `json:"file_name"`    // 文件原始名称（展示用）
	LinkURL     string `json:"link_url"`     // 链接提交时的URL
}

// ===== 响应结构体 =====

// GenerateTokensResponse 生成作业码响应
type GenerateTokensResponse struct {
	Tokens     []AssignmentToken `json:"tokens"`
	TotalCount int               `json:"total_count"`
	TokenType  string            `json:"token_type"`
	ExpiresAt  time.Time         `json:"expires_at"`
}

// RosterSummary 花名册汇总
type RosterSummary struct {
	TotalExpected  int                `json:"total_expected"`
	TotalSubmitted int                `json:"total_submitted"`
	TotalPending   int                `json:"total_pending"`
	SubmitRate     float64            `json:"submit_rate"`
	Roster         []RosterWithStatus `json:"roster"`
}

// SubmitFileResponse 作业文件上传响应
type SubmitFileResponse struct {
	FileURL      string `json:"file_url"`
	FileName     string `json:"file_name"`
	FileSize     int64  `json:"file_size"`
	FileSizeMB   string `json:"file_size_mb"`
	FileCategory string `json:"file_category"`
	Ext          string `json:"ext"`
}
