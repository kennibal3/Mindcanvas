// =============================================================
// MindCanvas Phase8 - 作业评价中心数据模型
// =============================================================
package models

import "time"

// ===== 状态常量 =====

// 作业状态
const (
	AssignmentStatusDraft      = "draft"      // 草稿（未发布）
	AssignmentStatusCollecting = "collecting" // 收集中（学生可提交）
	AssignmentStatusReviewing  = "reviewing"  // 评审中
	AssignmentStatusClosed     = "closed"     // 已关闭
)

// 材料角色
const (
	MaterialRoleInstruction  = "instruction"   // 任务说明
	MaterialRoleRubricSource = "rubric_source" // 评分标准原文
	MaterialRoleReference    = "reference"     // 参考资料
	MaterialRoleExample      = "example"       // 优秀样例
	MaterialRoleSubmission   = "submission"    // 学生提交
)

// 解析状态
const (
	ParseStatusPending  = "pending"
	ParseStatusParsing  = "parsing"
	ParseStatusDone     = "done"
	ParseStatusFailed   = "failed"
	ParseStatusSkipped  = "skipped"
)

// 评审状态
const (
	ReviewStatusPending          = "pending"
	ReviewStatusAIDone           = "ai_done"
	ReviewStatusTeacherConfirmed = "teacher_confirmed"
	ReviewStatusPublished        = "published"
)

// ===== 数据结构 =====

// Assignment 作业任务
type Assignment struct {
	ID            string     `json:"id"`
	RoomID        *string    `json:"room_id,omitempty"`
	CreatedBy     string     `json:"created_by"`
	Title         string     `json:"title"`
	Description   string     `json:"description"`
	Status        string     `json:"status"`
	AllowResubmit bool       `json:"allow_resubmit"`
	DueAt         *time.Time `json:"due_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// AssignmentMaterial 作业材料
type AssignmentMaterial struct {
	ID             string     `json:"id"`
	AssignmentID   string     `json:"assignment_id"`
	UploaderID     string     `json:"uploader_id"`
	UploaderRole   string     `json:"uploader_role"`
	MaterialRole   string     `json:"material_role"`
	OriginalName   string     `json:"original_name"`
	FilePath       string     `json:"file_path,omitempty"`
	FileURL        string     `json:"file_url,omitempty"`
	FileType       string     `json:"file_type,omitempty"`
	FileSize       int64      `json:"file_size"`
	ContentText    string     `json:"content_text,omitempty"`
	ParsedMarkdown string     `json:"parsed_markdown,omitempty"`
	ParseStatus    string     `json:"parse_status"`
	ParseError     string     `json:"parse_error,omitempty"`
	WordCount      int        `json:"word_count"`
	CharCount      int        `json:"char_count"`
	ParseElapsedMs int        `json:"parse_elapsed_ms"`
	ParsedAt       *time.Time `json:"parsed_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

// RubricCriterion 评分维度
type RubricCriterion struct {
	Name   string       `json:"name"`
	Weight int          `json:"weight"` // 权重百分比
	Levels []RubricLevel `json:"levels"`
}

// RubricLevel 评分等级
type RubricLevel struct {
	Score int    `json:"score"`
	Label string `json:"label"` // 优秀/良好/待改进
	Desc  string `json:"desc"`
}

// AssignmentRubric 评分标准版本
type AssignmentRubric struct {
	ID               string    `json:"id"`
	AssignmentID     string    `json:"assignment_id"`
	Version          int       `json:"version"`
	Source           string    `json:"source"` // extracted/generated/manual
	CriteriaJSON     string    `json:"criteria_json"` // 原始JSON字符串
	Criteria         []RubricCriterion `json:"criteria,omitempty"`
	TotalScore       int       `json:"total_score"`
	TeacherConfirmed bool      `json:"teacher_confirmed"`
	ConfirmedAt      *time.Time `json:"confirmed_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

// AssignmentSubmission 学生提交
type AssignmentSubmission struct {
	ID           string    `json:"id"`
	AssignmentID string    `json:"assignment_id"`
	StudentUUID  string    `json:"student_uuid"`
	StudentName  string    `json:"student_name"`
	GroupID      *string   `json:"group_id,omitempty"`
	Version      int       `json:"version"`
	ContentType  string    `json:"content_type"`
	ContentText  string    `json:"content_text,omitempty"`
	MaterialIDs  []string  `json:"material_ids,omitempty"`
	SubmittedAt  time.Time `json:"submitted_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// AssignmentAssessment AI初评与教师确认
type AssignmentAssessment struct {
	ID                  string     `json:"id"`
	SubmissionID        string     `json:"submission_id"`
	RubricID            string     `json:"rubric_id"`
	AIScore             *float64   `json:"ai_score,omitempty"`
	AIDimensionScores   string     `json:"ai_dimension_scores,omitempty"`
	AIFeedback          string     `json:"ai_feedback,omitempty"`
	AIHighlights        string     `json:"ai_highlights,omitempty"`
	AIIssues            string     `json:"ai_issues,omitempty"`
	AISuggestions       string     `json:"ai_suggestions,omitempty"`
	AIAssessedAt        *time.Time `json:"ai_assessed_at,omitempty"`
	FinalScore          *float64   `json:"final_score,omitempty"`
	FinalDimensionScores string    `json:"final_dimension_scores,omitempty"`
	FinalFeedback       string     `json:"final_feedback,omitempty"`
	ReviewStatus        string     `json:"review_status"`
	ReviewedBy          *string    `json:"reviewed_by,omitempty"`
	ReviewedAt          *time.Time `json:"reviewed_at,omitempty"`
	PublishedAt         *time.Time `json:"published_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

// ===== 请求/响应结构 =====

// CreateAssignmentRequest 创建作业请求
type CreateAssignmentRequest struct {
	RoomID        *string `json:"room_id"`
	Title         string  `json:"title" binding:"required"`
	Description   string  `json:"description"`
	AllowResubmit bool    `json:"allow_resubmit"`
	DueAt         *string `json:"due_at"` // ISO8601 字符串
}

// UpdateAssignmentRoomRequest 关联/解绑课堂房间（REQ-048）
// RoomID 为 null 或空串表示解绑
type UpdateAssignmentRoomRequest struct {
	RoomID *string `json:"room_id"`
}

// UploadMaterialRequest 上传材料请求（文字类型）
type UploadMaterialRequest struct {
	MaterialRole string `json:"material_role" binding:"required"`
	ContentText  string `json:"content_text"`
	OriginalName string `json:"original_name"`
}

// ConfirmRubricRequest 教师确认/更新评分标准
type ConfirmRubricRequest struct {
	Criteria   []RubricCriterion `json:"criteria" binding:"required"`
	TotalScore int               `json:"total_score"`
}

// SubmitAssignmentRequest 学生提交作业
type SubmitAssignmentRequest struct {
	ContentType string `json:"content_type"` // text/link
	ContentText string `json:"content_text"`
	StudentName string `json:"student_name"`
}

// ReviewAssessmentRequest 教师复核
type ReviewAssessmentRequest struct {
	FinalScore          float64           `json:"final_score"`
	FinalDimensionScores map[string]float64 `json:"final_dimension_scores"`
	FinalFeedback       string            `json:"final_feedback"`
	Publish             bool              `json:"publish"` // 是否直接发布给学生
}

// AssignmentDetail 作业详情（含统计）
type AssignmentDetail struct {
	Assignment
	MaterialCount    int `json:"material_count"`
	SubmissionCount  int `json:"submission_count"`
	AssessedCount    int `json:"assessed_count"`
	PublishedCount   int `json:"published_count"`
	LatestRubric     *AssignmentRubric `json:"latest_rubric,omitempty"`
}

// ParseResult 解析服务返回结果
type ParseResult struct {
	Success    bool   `json:"success"`
	Markdown   string `json:"markdown"`
	WordCount  int    `json:"word_count"`
	CharCount  int    `json:"char_count"`
	ElapsedMs  int    `json:"elapsed_ms"`
	Error      string `json:"error,omitempty"`
}
