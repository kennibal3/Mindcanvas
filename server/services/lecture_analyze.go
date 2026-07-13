package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// =============================================================
// REQ-039 第二期：讲评分析异步生成
// 复用 job_queue（task_type=assignment_lecture_analyze）+ ai_service 结构化输出。
// 方案一：只用 Rubric + 提交原文，不依赖 assessments。
// =============================================================

// lectureAnalyzeResult 对齐 AIPromptLectureAnalyze 的输出结构
type lectureAnalyzeResult struct {
	Title    string `json:"title"`
	Overview struct {
		ClassSummary   string   `json:"class_summary"`
		Strengths      []string `json:"strengths"`
		CommonIssues   []string `json:"common_issues"`
		PriorityTopics []string `json:"priority_topics"`
	} `json:"overview"`
	DimensionAnalyses []struct {
		DimensionName string `json:"dimension_name"`
		ScoreSummary  struct {
			Average       float64 `json:"average"`
			LowScoreCount int     `json:"low_score_count"`
		} `json:"score_summary"`
		CommonProblems       []string `json:"common_problems"`
		TeacherTalkingPoints []string `json:"teacher_talking_points"`
		ExampleQuotes        []string `json:"example_quotes"`
	} `json:"dimension_analyses"`
}

// EnqueueLectureAnalyze 发起一次讲评分析：
//   1. upsert 一条 assignment_lecture_reports（generation_status=analyzing）
//   2. 写 job_queue（task_type=assignment_lecture_analyze）
// 返回 reportID 供前端轮询。
func (s *AssignmentService) EnqueueLectureAnalyze(ctx context.Context, assignmentID, teacherID string) (string, error) {
	var reportID string
	// 已有报告则复用（重新生成），否则新建
	err := s.db.QueryRowContext(ctx,
		`SELECT id FROM assignment_lecture_reports WHERE assignment_id=$1 ORDER BY created_at DESC LIMIT 1`,
		assignmentID).Scan(&reportID)
	if err == sql.ErrNoRows {
		var tid interface{}
		if teacherID != "" {
			tid = teacherID
		}
		err = s.db.QueryRowContext(ctx,
			`INSERT INTO assignment_lecture_reports (assignment_id, teacher_id, generation_status)
			 VALUES ($1, $2, 'analyzing') RETURNING id`,
			assignmentID, tid).Scan(&reportID)
		if err != nil {
			return "", fmt.Errorf("create report: %w", err)
		}
	} else if err != nil {
		return "", fmt.Errorf("query report: %w", err)
	} else {
		if _, err := s.db.ExecContext(ctx,
			`UPDATE assignment_lecture_reports
			   SET generation_status='analyzing', last_error='', updated_at=NOW()
			 WHERE id=$1`, reportID); err != nil {
			return "", fmt.Errorf("reset report: %w", err)
		}
	}

	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO job_queue (task_type, entity_type, entity_id, payload, priority, created_by)
		 VALUES ('assignment_lecture_analyze', 'assignment', $1, '{}'::jsonb, 6, $2)`,
		assignmentID, teacherID); err != nil {
		return "", fmt.Errorf("enqueue job: %w", err)
	}
	return reportID, nil
}

// executeLectureAnalyze 由 job worker 调用：加载 rubric+提交 → AI → 落库 report+blocks
func (s *AssignmentService) executeLectureAnalyze(ctx context.Context, job jobRecord) (retErr error) {
	if s.aiSvc == nil || !s.aiSvc.IsConfigured() {
		return fmt.Errorf("ai service not configured")
	}
	assignmentID := job.EntityID

	// 定位本次报告行（EnqueueLectureAnalyze 已建/置为 analyzing）
	var reportID string
	if err := s.db.QueryRowContext(ctx,
		`SELECT id FROM assignment_lecture_reports WHERE assignment_id=$1 ORDER BY created_at DESC LIMIT 1`,
		assignmentID).Scan(&reportID); err != nil {
		return fmt.Errorf("load report row: %w", err)
	}
	// 任一失败：把报告标记 failed（保留旧块，便于排查/重试）
	defer func() {
		if retErr != nil {
			s.db.ExecContext(context.Background(),
				`UPDATE assignment_lecture_reports
				   SET generation_status='failed', last_error=$2, updated_at=NOW()
				 WHERE id=$1`, reportID, retErr.Error())
		}
	}()

	// 作业标题
	var title string
	_ = s.db.QueryRowContext(ctx, `SELECT title FROM assignments WHERE id=$1`, assignmentID).Scan(&title)

	// 最新 Rubric
	var criteriaJSON string
	var rubricVersion int
	_ = s.db.QueryRowContext(ctx,
		`SELECT criteria_json, version FROM assignment_rubrics
		  WHERE assignment_id=$1 ORDER BY version DESC LIMIT 1`,
		assignmentID).Scan(&criteriaJSON, &rubricVersion)
	if strings.TrimSpace(criteriaJSON) == "" {
		criteriaJSON = "[]"
	}

	// 全部提交（截断控制 prompt 体量：每人≤500 字，最多 60 人）
	rows, err := s.db.QueryContext(ctx,
		`SELECT COALESCE(student_name,''), COALESCE(content_text,'')
		   FROM assignment_submissions WHERE assignment_id=$1
		  ORDER BY submitted_at LIMIT 60`, assignmentID)
	if err != nil {
		return fmt.Errorf("load submissions: %w", err)
	}
	var subParts []string
	subCount := 0
	for rows.Next() {
		var name, content string
		_ = rows.Scan(&name, &content)
		content = strings.TrimSpace(content)
		if content == "" {
			continue
		}
		if name == "" {
			name = fmt.Sprintf("学生%d", subCount+1)
		}
		subParts = append(subParts, fmt.Sprintf("【%s】%s", name, truncateStr(content, 500)))
		subCount++
	}
	rows.Close()
	if subCount == 0 {
		return fmt.Errorf("暂无文字提交可供分析")
	}

	// 花名册人数（快照用）
	var rosterCount int
	_ = s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM assignment_rosters WHERE assignment_id=$1`, assignmentID).Scan(&rosterCount)

	userPrompt := fmt.Sprintf(
		"作业标题：%s\n\n评分标准（Rubric 维度 JSON）：\n%s\n\n全班提交原文（共 %d 份）：\n%s",
		title, criteriaJSON, subCount, strings.Join(subParts, "\n\n---\n\n"))

	ctx2, cancel := context.WithTimeout(WithFastMode(ctx), 120*time.Second)
	defer cancel()
	reply, _, err := s.aiSvc.Analyze(ctx2, AIPromptLectureAnalyze, userPrompt)
	if err != nil {
		return fmt.Errorf("ai analyze: %w", err)
	}
	jsonStr := extractJSON(reply)
	if jsonStr == "" {
		return fmt.Errorf("ai returned no valid json")
	}
	var result lectureAnalyzeResult
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		return fmt.Errorf("parse analyze result: %w", err)
	}

	reportTitle := strings.TrimSpace(result.Title)
	if reportTitle == "" {
		reportTitle = title + " · 讲评分析"
	}
	snapshot, _ := json.Marshal(map[string]interface{}{
		"roster_count":     rosterCount,
		"submission_count": subCount,
		"rubric_version":   rubricVersion,
		"scope":            "class",
		"generated_at":     time.Now().Format(time.RFC3339),
	})

	// 事务：更新报告 + 清旧块 + 写新块
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		if retErr != nil {
			tx.Rollback()
		}
	}()

	if _, err := tx.ExecContext(ctx,
		`UPDATE assignment_lecture_reports
		   SET title=$2, summary=$3, source_snapshot=$4::jsonb,
		       generation_status='done', last_error='', updated_at=NOW()
		 WHERE id=$1`,
		reportID, reportTitle, result.Overview.ClassSummary, string(snapshot)); err != nil {
		return fmt.Errorf("update report: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM assignment_report_blocks WHERE report_id=$1`, reportID); err != nil {
		return fmt.Errorf("clear blocks: %w", err)
	}

	sort := 0
	// 概览块
	overviewJSON, _ := json.Marshal(result.Overview)
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO assignment_report_blocks
		   (report_id, block_type, sort_order, title, content, ai_generated, teacher_confirmed)
		 VALUES ($1,'overview',$2,'班级总体概览',$3::jsonb,TRUE,FALSE)`,
		reportID, sort, string(overviewJSON)); err != nil {
		return fmt.Errorf("insert overview block: %w", err)
	}
	sort++
	// 维度分析块
	for _, d := range result.DimensionAnalyses {
		dJSON, _ := json.Marshal(d)
		blockTitle := d.DimensionName
		if blockTitle == "" {
			blockTitle = fmt.Sprintf("维度%d", sort)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO assignment_report_blocks
			   (report_id, block_type, sort_order, title, content, ai_generated, teacher_confirmed)
			 VALUES ($1,'dimension_analysis',$2,$3,$4::jsonb,TRUE,FALSE)`,
			reportID, sort, blockTitle, string(dJSON)); err != nil {
			return fmt.Errorf("insert dimension block: %w", err)
		}
		sort++
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}
