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
// REQ-039 第三期 3a：讲评报告块编辑 / 单块重新生成 / 报告确认
// 新文件承载（不覆盖既有 lecture_*.go），只依赖既有 job_queue 模板。
// =============================================================

// AIPromptLectureBlockRegen 单块重新生成 Prompt（与整报告生成同源约束）
const AIPromptLectureBlockRegen = `你是一位资深的备课组长，正在为一次已完成的作业修订讲评分析中的某一个内容块。
你将收到：本次作业的评分标准（Rubric 维度）、全班学生的提交原文，以及需要重新生成的内容块类型。

严格遵守以下规则：
1. 只依据提供的评分标准维度与学生提交原文进行分析，不得编造不存在的学生表现或数据。
2. 面向"班级共性"，不逐个点名学生；如需举例，用匿名方式引用原文片段。
3. 不给学生贴负面标签，用"尚未稳定掌握""需要继续巩固"等建设性表达。
4. 只输出被要求重新生成的那一个内容块，输出必须是严格 JSON，不要任何解释性文字。

若要求重新生成的是【班级总体概览】，输出格式：
{
  "class_summary": "本次作业班级整体表现的 2-4 句概述",
  "strengths": ["班级做得较好的点"],
  "common_issues": ["班级共性问题"],
  "priority_topics": ["建议课堂重点讲评的话题"]
}

若要求重新生成的是【某个维度的分析】，输出格式：
{
  "dimension_name": "该维度名称（保持与输入一致）",
  "score_summary": { "average": 3.2, "low_score_count": 8 },
  "common_problems": ["该维度上的典型问题"],
  "teacher_talking_points": ["讲评该维度时的建议切入点"],
  "example_quotes": ["从学生提交中摘录的匿名代表性片段（可留空数组）"]
}`

// UpdateLectureBlockRequest PATCH 请求体（字段均可选，按需生效）
type UpdateLectureBlockRequest struct {
	Title   *string         `json:"title"`
	Content json.RawMessage `json:"content"`
	Move    string          `json:"move"`    // "up" | "down"
	Confirm *bool           `json:"confirm"` // teacher_confirmed
}

// lectureBlockReport 校验块归属并返回 report_id（防跨作业越权操作）
func (s *AssignmentService) lectureBlockReport(ctx context.Context, assignmentID, blockID string) (string, error) {
	var reportID string
	err := s.db.QueryRowContext(ctx,
		`SELECT b.report_id
		   FROM assignment_report_blocks b
		   JOIN assignment_lecture_reports r ON b.report_id = r.id
		  WHERE b.id = $1 AND r.assignment_id = $2`,
		blockID, assignmentID).Scan(&reportID)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("内容块不存在或不属于该作业")
	}
	return reportID, err
}

// logLecturePrefEvent 教师偏好行为日志（§18 决策8：只记日志；best-effort 不影响主流程）
func (s *AssignmentService) logLecturePrefEvent(teacherID, assignmentID, objectType, objectID, actionType string, before, after interface{}) {
	b, _ := json.Marshal(before)
	a, _ := json.Marshal(after)
	if string(b) == "null" || len(b) == 0 {
		b = []byte("{}")
	}
	if string(a) == "null" || len(a) == 0 {
		a = []byte("{}")
	}
	s.db.Exec(
		`INSERT INTO teacher_preference_events
		   (teacher_id, assignment_id, object_type, object_id, action_type, before_value, after_value)
		 VALUES (NULLIF($1,'')::uuid, $2, $3, NULLIF($4,'')::uuid, $5, $6::jsonb, $7::jsonb)`,
		teacherID, assignmentID, objectType, objectID, actionType, string(b), string(a))
}

// UpdateLectureBlock 更新内容块（标题/内容/排序移动/确认）
func (s *AssignmentService) UpdateLectureBlock(ctx context.Context, assignmentID, blockID, teacherID string, req UpdateLectureBlockRequest) error {
	reportID, err := s.lectureBlockReport(ctx, assignmentID, blockID)
	if err != nil {
		return err
	}

	// 排序移动：与相邻块原子交换 sort_order
	if req.Move == "up" || req.Move == "down" {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()

		var curSort int
		if err := tx.QueryRowContext(ctx,
			`SELECT sort_order FROM assignment_report_blocks WHERE id=$1`, blockID).Scan(&curSort); err != nil {
			return err
		}
		var neighborID string
		var neighborSort int
		var q string
		if req.Move == "up" {
			q = `SELECT id, sort_order FROM assignment_report_blocks
			      WHERE report_id=$1 AND sort_order < $2 ORDER BY sort_order DESC LIMIT 1`
		} else {
			q = `SELECT id, sort_order FROM assignment_report_blocks
			      WHERE report_id=$1 AND sort_order > $2 ORDER BY sort_order ASC LIMIT 1`
		}
		err = tx.QueryRowContext(ctx, q, reportID, curSort).Scan(&neighborID, &neighborSort)
		if err == sql.ErrNoRows {
			return nil // 已在最顶/最底，静默不动
		}
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE assignment_report_blocks SET sort_order=$2, updated_at=NOW() WHERE id=$1`,
			blockID, neighborSort); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE assignment_report_blocks SET sort_order=$2, updated_at=NOW() WHERE id=$1`,
			neighborID, curSort); err != nil {
			return err
		}
		return tx.Commit()
	}

	// 标题/内容/确认：动态拼 SET（参数化，无注入面）
	sets := []string{}
	args := []interface{}{}
	idx := 1
	if req.Title != nil {
		sets = append(sets, fmt.Sprintf("title=$%d", idx))
		args = append(args, strings.TrimSpace(*req.Title))
		idx++
	}
	if len(req.Content) > 0 && json.Valid(req.Content) {
		sets = append(sets, fmt.Sprintf("content=$%d::jsonb", idx))
		args = append(args, string(req.Content))
		idx++
	}
	if req.Confirm != nil {
		sets = append(sets, fmt.Sprintf("teacher_confirmed=$%d", idx))
		args = append(args, *req.Confirm)
		idx++
	}
	if len(sets) == 0 {
		return nil
	}
	sets = append(sets, "updated_at=NOW()")
	args = append(args, blockID)
	if _, err := s.db.ExecContext(ctx,
		fmt.Sprintf("UPDATE assignment_report_blocks SET %s WHERE id=$%d",
			strings.Join(sets, ", "), idx), args...); err != nil {
		return err
	}
	// 内容被编辑 → 报告回到草稿态（需重新确认才能导出）
	if len(req.Content) > 0 || req.Title != nil {
		s.db.ExecContext(ctx,
			`UPDATE assignment_lecture_reports SET status='draft', confirmed_at=NULL, updated_at=NOW()
			  WHERE id=$1 AND status='confirmed'`, reportID)
	}

	action := "edit"
	if req.Confirm != nil && len(req.Content) == 0 && req.Title == nil {
		if *req.Confirm {
			action = "accept"
		} else {
			action = "reject"
		}
	}
	s.logLecturePrefEvent(teacherID, assignmentID, "report_block", blockID, action,
		map[string]interface{}{}, map[string]interface{}{"fields": len(sets) - 1})
	return nil
}

// DeleteLectureBlock 删除内容块
func (s *AssignmentService) DeleteLectureBlock(ctx context.Context, assignmentID, blockID, teacherID string) error {
	reportID, err := s.lectureBlockReport(ctx, assignmentID, blockID)
	if err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM assignment_report_blocks WHERE id=$1`, blockID); err != nil {
		return err
	}
	s.db.ExecContext(ctx,
		`UPDATE assignment_lecture_reports SET status='draft', confirmed_at=NULL, updated_at=NOW()
		  WHERE id=$1 AND status='confirmed'`, reportID)
	s.logLecturePrefEvent(teacherID, assignmentID, "report_block", blockID, "reject",
		map[string]interface{}{}, map[string]interface{}{"deleted": true})
	return nil
}

// ConfirmLectureReport 确认整份报告（全部块置已确认，报告 status→confirmed）
func (s *AssignmentService) ConfirmLectureReport(ctx context.Context, assignmentID, teacherID string) error {
	var reportID, genStatus string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, generation_status FROM assignment_lecture_reports
		  WHERE assignment_id=$1 ORDER BY created_at DESC LIMIT 1`,
		assignmentID).Scan(&reportID, &genStatus)
	if err == sql.ErrNoRows {
		return fmt.Errorf("尚未生成讲评报告")
	}
	if err != nil {
		return err
	}
	if genStatus != "done" {
		return fmt.Errorf("报告尚未生成完成，当前状态：%s", genStatus)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`UPDATE assignment_report_blocks SET teacher_confirmed=TRUE, updated_at=NOW()
		  WHERE report_id=$1`, reportID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE assignment_lecture_reports
		    SET status='confirmed', confirmed_at=NOW(), updated_at=NOW()
		  WHERE id=$1`, reportID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.logLecturePrefEvent(teacherID, assignmentID, "report_block", reportID, "accept",
		map[string]interface{}{}, map[string]interface{}{"scope": "report_confirm"})
	return nil
}

// EnqueueLectureBlockRegen 单块重新生成入队，返回 job_id 供前端轮询
func (s *AssignmentService) EnqueueLectureBlockRegen(ctx context.Context, assignmentID, blockID, teacherID string) (string, error) {
	if _, err := s.lectureBlockReport(ctx, assignmentID, blockID); err != nil {
		return "", err
	}
	var blockType string
	if err := s.db.QueryRowContext(ctx,
		`SELECT block_type FROM assignment_report_blocks WHERE id=$1`, blockID).Scan(&blockType); err != nil {
		return "", err
	}
	if blockType != "overview" && blockType != "dimension_analysis" {
		return "", fmt.Errorf("该类型内容块（%s）暂不支持重新生成", blockType)
	}
	payload, _ := json.Marshal(map[string]string{"block_id": blockID})
	var jobID string
	if err := s.db.QueryRowContext(ctx,
		`INSERT INTO job_queue (task_type, entity_type, entity_id, payload, priority, created_by)
		 VALUES ('assignment_lecture_block_regen', 'assignment', $1, $2::jsonb, 5, $3)
		 RETURNING id`,
		assignmentID, string(payload), teacherID).Scan(&jobID); err != nil {
		return "", fmt.Errorf("enqueue regen job: %w", err)
	}
	s.logLecturePrefEvent(teacherID, assignmentID, "report_block", blockID, "regenerate",
		map[string]interface{}{}, map[string]interface{}{})
	return jobID, nil
}

// GetLectureJobStatus 查询单块重生成任务状态（限定 entity 防越权探测）
func (s *AssignmentService) GetLectureJobStatus(ctx context.Context, assignmentID, jobID string) (string, string, error) {
	var status, lastError string
	err := s.db.QueryRowContext(ctx,
		`SELECT status, COALESCE(last_error,'') FROM job_queue
		  WHERE id=$1 AND entity_id=$2 AND task_type='assignment_lecture_block_regen'`,
		jobID, assignmentID).Scan(&status, &lastError)
	if err == sql.ErrNoRows {
		return "", "", fmt.Errorf("任务不存在")
	}
	return status, lastError, err
}

// loadLectureInputs 加载生成所需输入（与 executeLectureAnalyze 同口径）
func (s *AssignmentService) loadLectureInputs(ctx context.Context, assignmentID string) (title, criteriaJSON, submissionsText string, subCount int, err error) {
	_ = s.db.QueryRowContext(ctx, `SELECT title FROM assignments WHERE id=$1`, assignmentID).Scan(&title)

	_ = s.db.QueryRowContext(ctx,
		`SELECT criteria_json FROM assignment_rubrics
		  WHERE assignment_id=$1 ORDER BY version DESC LIMIT 1`,
		assignmentID).Scan(&criteriaJSON)
	if strings.TrimSpace(criteriaJSON) == "" {
		criteriaJSON = "[]"
	}

	rows, qerr := s.db.QueryContext(ctx,
		`SELECT COALESCE(student_name,''), COALESCE(content_text,'')
		   FROM assignment_submissions WHERE assignment_id=$1
		  ORDER BY submitted_at LIMIT 60`, assignmentID)
	if qerr != nil {
		err = fmt.Errorf("load submissions: %w", qerr)
		return
	}
	defer rows.Close()
	var parts []string
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
		parts = append(parts, fmt.Sprintf("【%s】%s", name, truncateStr(content, 500)))
		subCount++
	}
	submissionsText = strings.Join(parts, "\n\n---\n\n")
	if subCount == 0 {
		err = fmt.Errorf("暂无文字提交可供分析")
	}
	return
}

// executeLectureBlockRegen 由 job worker 调用：只重生成一个内容块
func (s *AssignmentService) executeLectureBlockRegen(ctx context.Context, job jobRecord) error {
	if s.aiSvc == nil || !s.aiSvc.IsConfigured() {
		return fmt.Errorf("ai service not configured")
	}
	var p struct {
		BlockID string `json:"block_id"`
	}
	if err := json.Unmarshal(job.Payload, &p); err != nil || p.BlockID == "" {
		return fmt.Errorf("payload 缺少 block_id")
	}
	assignmentID := job.EntityID

	var blockType, blockTitle, reportID string
	if err := s.db.QueryRowContext(ctx,
		`SELECT block_type, COALESCE(title,''), report_id
		   FROM assignment_report_blocks WHERE id=$1`, p.BlockID).Scan(&blockType, &blockTitle, &reportID); err != nil {
		return fmt.Errorf("load block: %w", err)
	}

	title, criteriaJSON, subsText, subCount, err := s.loadLectureInputs(ctx, assignmentID)
	if err != nil {
		return err
	}

	var target string
	if blockType == "overview" {
		target = "请重新生成【班级总体概览】。"
	} else {
		target = fmt.Sprintf("请重新生成维度【%s】的分析（dimension_name 保持为该维度名）。", blockTitle)
	}
	userPrompt := fmt.Sprintf(
		"作业标题：%s\n\n评分标准（Rubric 维度 JSON）：\n%s\n\n全班提交原文（共 %d 份）：\n%s\n\n%s",
		title, criteriaJSON, subCount, subsText, target)

	ctx2, cancel := context.WithTimeout(WithFastMode(ctx), 120*time.Second)
	defer cancel()
	reply, _, err := s.aiSvc.Analyze(ctx2, AIPromptLectureBlockRegen, userPrompt)
	if err != nil {
		return fmt.Errorf("ai regen: %w", err)
	}
	jsonStr := extractJSON(reply)
	if jsonStr == "" {
		return fmt.Errorf("ai returned no valid json")
	}

	newTitle := blockTitle
	var contentJSON string
	if blockType == "overview" {
		var ov struct {
			ClassSummary   string   `json:"class_summary"`
			Strengths      []string `json:"strengths"`
			CommonIssues   []string `json:"common_issues"`
			PriorityTopics []string `json:"priority_topics"`
		}
		if err := json.Unmarshal([]byte(jsonStr), &ov); err != nil {
			return fmt.Errorf("parse overview: %w", err)
		}
		b, _ := json.Marshal(ov)
		contentJSON = string(b)
	} else {
		var d struct {
			DimensionName string `json:"dimension_name"`
			ScoreSummary  struct {
				Average       float64 `json:"average"`
				LowScoreCount int     `json:"low_score_count"`
			} `json:"score_summary"`
			CommonProblems       []string `json:"common_problems"`
			TeacherTalkingPoints []string `json:"teacher_talking_points"`
			ExampleQuotes        []string `json:"example_quotes"`
		}
		if err := json.Unmarshal([]byte(jsonStr), &d); err != nil {
			return fmt.Errorf("parse dimension: %w", err)
		}
		if strings.TrimSpace(d.DimensionName) != "" {
			newTitle = d.DimensionName
		}
		b, _ := json.Marshal(d)
		contentJSON = string(b)
	}

	if _, err := s.db.ExecContext(ctx,
		`UPDATE assignment_report_blocks
		    SET title=$2, content=$3::jsonb, ai_generated=TRUE, teacher_confirmed=FALSE, updated_at=NOW()
		  WHERE id=$1`, p.BlockID, newTitle, contentJSON); err != nil {
		return fmt.Errorf("update block: %w", err)
	}
	// 块变化 → 报告回草稿态
	s.db.ExecContext(ctx,
		`UPDATE assignment_lecture_reports SET status='draft', confirmed_at=NULL, updated_at=NOW()
		  WHERE id=$1 AND status='confirmed'`, reportID)
	return nil
}
