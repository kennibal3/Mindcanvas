package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func (s *AssignmentService) executeGenerateRubric(ctx context.Context, job jobRecord) error {
	if s.aiSvc == nil || !s.aiSvc.IsConfigured() {
		return fmt.Errorf("ai service not configured")
	}
	var assignment struct {
		Title       string
		Description string
	}
	row := s.db.QueryRowContext(ctx,
		`SELECT title, COALESCE(description,'') FROM assignments WHERE id=$1`, job.EntityID)
	if err := row.Scan(&assignment.Title, &assignment.Description); err != nil {
		return fmt.Errorf("load assignment: %w", err)
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT COALESCE(parsed_markdown,'') FROM assignment_materials
		  WHERE assignment_id=$1 AND material_role='teacher' AND parse_status='done'
		  ORDER BY created_at LIMIT 3`, job.EntityID)
	if err != nil {
		return fmt.Errorf("load materials: %w", err)
	}
	defer rows.Close()
	var matParts []string
	for rows.Next() {
		var md string
		_ = rows.Scan(&md)
		if len(md) > 1000 {
			md = md[:1000] + "..."
		}
		matParts = append(matParts, md)
	}
	materialSummary := strings.Join(matParts, "\n\n---\n\n")
	userPrompt := fmt.Sprintf("作业标题：%s\n作业说明：%s", assignment.Title, assignment.Description)
	if materialSummary != "" {
		userPrompt += "\n\n参考材料摘要：\n" + materialSummary
	}
	ctx2, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	reply, _, err := s.aiSvc.Analyze(ctx2, AIPromptGenerateRubric, userPrompt)
	if err != nil {
		return fmt.Errorf("ai generate rubric: %w", err)
	}
	criteriaJSON := extractJSON(reply)
	if criteriaJSON == "" {
		return fmt.Errorf("ai returned no valid json")
	}
	var rubricData map[string]interface{}
	if err := json.Unmarshal([]byte(criteriaJSON), &rubricData); err != nil {
		return fmt.Errorf("invalid rubric json: %w", err)
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO assignment_rubrics
		   (assignment_id, version, source, criteria_json, total_score, teacher_confirmed)
		 VALUES ($1,
		   COALESCE((SELECT MAX(version) FROM assignment_rubrics WHERE assignment_id=$1),0)+1,
		   'ai', $2, 100, false)`,
		job.EntityID, criteriaJSON)
	return err
}

func (s *AssignmentService) executeAIAssess(ctx context.Context, job jobRecord) error {
	if s.aiSvc == nil || !s.aiSvc.IsConfigured() {
		return fmt.Errorf("ai service not configured")
	}
	var payload struct {
		SubmissionID string `json:"submission_id"`
		RubricID     string `json:"rubric_id"`
	}
	if err := json.Unmarshal(job.Payload, &payload); err != nil {
		return fmt.Errorf("parse payload: %w", err)
	}
	var submission struct {
		StudentName string
		ContentText string
		ContentType string
	}
	row := s.db.QueryRowContext(ctx,
		`SELECT student_name, COALESCE(content_text,''), content_type
		   FROM assignment_submissions WHERE id=$1`, payload.SubmissionID)
	if err := row.Scan(&submission.StudentName, &submission.ContentText, &submission.ContentType); err != nil {
		return fmt.Errorf("load submission: %w", err)
	}
	var criteriaJSON string
	row = s.db.QueryRowContext(ctx,
		`SELECT criteria_json FROM assignment_rubrics WHERE id=$1`, payload.RubricID)
	if err := row.Scan(&criteriaJSON); err != nil {
		return fmt.Errorf("load rubric: %w", err)
	}
	userPrompt := fmt.Sprintf("评分标准：\n%s\n\n学生提交内容（%s）：\n%s",
		criteriaJSON, submission.ContentType, truncateStr(submission.ContentText, 3000))
	ctx2, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	reply, _, err := s.aiSvc.Analyze(ctx2, AIPromptAssessSubmission, userPrompt)
	if err != nil {
		return fmt.Errorf("ai assess: %w", err)
	}
	assessJSON := extractJSON(reply)
	if assessJSON == "" {
		return fmt.Errorf("ai returned no valid json")
	}
	var result struct {
		TotalScore      float64 `json:"total_score"`
		DimensionScores []struct {
			CriterionName string  `json:"criterion_name"`
			Score         float64 `json:"score"`
			Feedback      string  `json:"feedback"`
		} `json:"dimension_scores"`
		OverallFeedback string `json:"overall_feedback"`
		Highlights      string `json:"highlights"`
		Issues          string `json:"issues"`
		Suggestions     string `json:"suggestions"`
	}
	if err := json.Unmarshal([]byte(assessJSON), &result); err != nil {
		return fmt.Errorf("parse assess result: %w", err)
	}
	dimScoresJSON, _ := json.Marshal(result.DimensionScores)
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO assignment_assessments
		   (submission_id, rubric_id, ai_score, ai_dimension_scores,
		    ai_feedback, ai_highlights, ai_issues, ai_suggestions, review_status)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ai_done')
		 ON CONFLICT (submission_id) DO UPDATE SET
		   ai_score=$3, ai_dimension_scores=$4,
		   ai_feedback=$5, ai_highlights=$6, ai_issues=$7, ai_suggestions=$8,
		   review_status='ai_done'`,
		payload.SubmissionID, payload.RubricID,
		result.TotalScore, string(dimScoresJSON),
		result.OverallFeedback, result.Highlights, result.Issues, result.Suggestions)
	return err
}

func (s *AssignmentService) EnqueueGenerateRubricAI(ctx context.Context, assignmentID string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO job_queue (task_type, entity_type, entity_id, payload, priority)
		 VALUES ('generate_rubric', 'assignment', $1, '{}', 8)`, assignmentID)
	return err
}

func (s *AssignmentService) EnqueueAIAssess(ctx context.Context, submissionID, rubricID string) error {
	payload, _ := json.Marshal(map[string]string{
		"submission_id": submissionID,
		"rubric_id":     rubricID,
	})
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO job_queue (task_type, entity_type, entity_id, payload, priority)
		 VALUES ('ai_assess', 'submission', $1, $2, 7)`, submissionID, string(payload))
	return err
}

func extractJSON(s string) string {
	if idx := strings.Index(s, "```json"); idx >= 0 {
		s = s[idx+7:]
		if end := strings.Index(s, "```"); end >= 0 {
			s = s[:end]
		}
	} else if idx := strings.Index(s, "```"); idx >= 0 {
		s = s[idx+3:]
		if end := strings.Index(s, "```"); end >= 0 {
			s = s[:end]
		}
	}
	s = strings.TrimSpace(s)
	start := strings.IndexAny(s, "{[")
	if start < 0 {
		return ""
	}
	end := strings.LastIndexAny(s, "}]")
	if end < start {
		return ""
	}
	return s[start : end+1]
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
