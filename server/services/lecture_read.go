package services

import (
	"context"
	"database/sql"
	"encoding/json"
)

// =============================================================
// REQ-039 第二期：讲评报告读取（供前端轮询/展示）
// =============================================================

type LectureBlockView struct {
	ID               string          `json:"id"`
	BlockType        string          `json:"block_type"`
	SortOrder        int             `json:"sort_order"`
	Title            string          `json:"title"`
	Content          json.RawMessage `json:"content"`
	AIGenerated      bool            `json:"ai_generated"`
	TeacherConfirmed bool            `json:"teacher_confirmed"`
}

type LectureReportView struct {
	ID               string             `json:"id"`
	AssignmentID     string             `json:"assignment_id"`
	Status           string             `json:"status"`
	Title            string             `json:"title"`
	Summary          string             `json:"summary"`
	GenerationStatus string             `json:"generation_status"`
	LastError        string             `json:"last_error"`
	SourceSnapshot   json.RawMessage    `json:"source_snapshot"`
	Blocks           []LectureBlockView `json:"blocks"`
	CreatedAt        string             `json:"created_at"`
	UpdatedAt        string             `json:"updated_at"`
}

// GetLectureReport 返回该作业最新一份讲评报告 + 其内容块；无报告返回 (nil, nil)
func (s *AssignmentService) GetLectureReport(ctx context.Context, assignmentID string) (*LectureReportView, error) {
	var v LectureReportView
	var snapshot string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, assignment_id, status, COALESCE(title,''), COALESCE(summary,''),
		        generation_status, COALESCE(last_error,''), source_snapshot::text,
		        created_at::text, updated_at::text
		   FROM assignment_lecture_reports
		  WHERE assignment_id=$1 ORDER BY created_at DESC LIMIT 1`,
		assignmentID).Scan(
		&v.ID, &v.AssignmentID, &v.Status, &v.Title, &v.Summary,
		&v.GenerationStatus, &v.LastError, &snapshot, &v.CreatedAt, &v.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if snapshot == "" {
		snapshot = "{}"
	}
	v.SourceSnapshot = json.RawMessage(snapshot)

	rows, err := s.db.QueryContext(ctx,
		`SELECT id, block_type, sort_order, COALESCE(title,''), content::text,
		        ai_generated, teacher_confirmed
		   FROM assignment_report_blocks
		  WHERE report_id=$1 ORDER BY sort_order`, v.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	v.Blocks = []LectureBlockView{}
	for rows.Next() {
		var b LectureBlockView
		var content string
		if err := rows.Scan(&b.ID, &b.BlockType, &b.SortOrder, &b.Title, &content,
			&b.AIGenerated, &b.TeacherConfirmed); err != nil {
			return nil, err
		}
		if content == "" {
			content = "{}"
		}
		b.Content = json.RawMessage(content)
		v.Blocks = append(v.Blocks, b)
	}
	return &v, nil
}
