package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"mindcanvas-server/models"
)

// =============================================================
// REQ-039 第三期 3b：推荐练习（AI 生成 → 教师审核 → 一键发布为新作业）
// 新文件承载，不覆盖既有 lecture_*.go / assignment_service.go。
// 表：assignment_recommended_questions（迁移 016 已建，无新迁移）
// =============================================================

// AIPromptRecommendQuestions 推荐题生成 Prompt（输入=已确认讲评报告块 + Rubric）
const AIPromptRecommendQuestions = `你是一位资深的备课组长，正在为一次已完成的作业设计课后巩固练习。
你将收到：本次作业的评分标准（Rubric 维度）、教师已确认的讲评分析报告（班级共性问题与讲评重点）。
请据此设计 3-5 道针对性的练习题，用于帮助学生巩固本次暴露出的薄弱环节。

严格遵守以下规则：
1. 每道题必须明确对应报告中的某个共性问题或某个评分维度，不得凭空出题。
2. 难度分布要有梯度：至少 1 道基础题、1 道进阶题。
3. 题面表述完整清晰，学生不看原作业也能独立作答。
4. 参考答案与解析必须写实、可用于讲评，不得只写"略"。
5. recommendation_reason 用一句话说明"为什么给这个班出这道题"，要引用报告中的具体问题。
6. 输出必须是严格 JSON，不要输出任何解释性文字。

输出严格遵守以下 JSON 格式：
{
  "questions": [
    {
      "question_type": "题型（简答/选择/计算/写作/分析 之一）",
      "difficulty": "难度（基础/进阶/挑战 之一）",
      "knowledge_points": ["考查的知识点", "..."],
      "stem": "完整题面",
      "options": ["选择题选项，非选择题填空数组"],
      "answer": "参考答案",
      "explanation": "解析（讲评时可直接用）",
      "recommendation_reason": "推荐理由，引用报告中的具体共性问题"
    }
  ]
}`

// =============================================================
// 视图与请求结构体
// =============================================================

// RecommendedQuestionView 推荐题（返回前端）
type RecommendedQuestionView struct {
	ID                   string          `json:"id"`
	AssignmentID         string          `json:"assignment_id"`
	ReportID             string          `json:"report_id"`
	SourceType           string          `json:"source_type"`
	TargetType           string          `json:"target_type"`
	KnowledgePoints      json.RawMessage `json:"knowledge_points"`
	Difficulty           string          `json:"difficulty"`
	QuestionType         string          `json:"question_type"`
	Content              json.RawMessage `json:"content"`
	Answer               json.RawMessage `json:"answer"`
	Explanation          string          `json:"explanation"`
	RecommendationReason string          `json:"recommendation_reason"`
	TeacherAction        string          `json:"teacher_action"`
	FinalContent         json.RawMessage `json:"final_content"`
	CreatedAt            string          `json:"created_at"`
	UpdatedAt            string          `json:"updated_at"`
}

// UpdateRecommendationRequest PATCH 请求体（字段均可选）
type UpdateRecommendationRequest struct {
	Action      string          `json:"action"`      // accept | reject | pending
	Content     json.RawMessage `json:"content"`     // 教师改后的题面/选项（写 final_content）
	Answer      json.RawMessage `json:"answer"`      // 教师改后的答案
	Explanation *string         `json:"explanation"` // 教师改后的解析
}

// PublishRecommendationsRequest 发布为新作业
type PublishRecommendationsRequest struct {
	QuestionIDs []string `json:"question_ids"` // 为空则取全部 accepted/edited
	Title       string   `json:"title"`        // 为空则「原标题 · 巩固练习」
	ExpireDays  int      `json:"expire_days"`  // 作业码有效期，默认 7
}

// PublishRecommendationsResult 发布结果
type PublishRecommendationsResult struct {
	AssignmentID  string `json:"assignment_id"`
	Title         string `json:"title"`
	QuestionCount int    `json:"question_count"`
	RosterCount   int    `json:"roster_count"`
	TokenCount    int    `json:"token_count"`
}

// recommendResult 对齐 AIPromptRecommendQuestions 输出
type recommendResult struct {
	Questions []struct {
		QuestionType         string   `json:"question_type"`
		Difficulty           string   `json:"difficulty"`
		KnowledgePoints      []string `json:"knowledge_points"`
		Stem                 string   `json:"stem"`
		Options              []string `json:"options"`
		Answer               string   `json:"answer"`
		Explanation          string   `json:"explanation"`
		RecommendationReason string   `json:"recommendation_reason"`
	} `json:"questions"`
}

// =============================================================
// 生成（异步 job）
// =============================================================

// confirmedLectureReport 取该作业最新报告，并要求已确认（3a 的 confirm 是本期前置）
func (s *AssignmentService) confirmedLectureReport(ctx context.Context, assignmentID string) (reportID string, err error) {
	var status, genStatus string
	err = s.db.QueryRowContext(ctx,
		`SELECT id, status, generation_status FROM assignment_lecture_reports
		  WHERE assignment_id=$1 ORDER BY created_at DESC LIMIT 1`,
		assignmentID).Scan(&reportID, &status, &genStatus)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("尚未生成讲评报告，请先在「班级分析」页签生成")
	}
	if err != nil {
		return "", err
	}
	if genStatus != "done" {
		return "", fmt.Errorf("讲评报告尚未生成完成，当前状态：%s", genStatus)
	}
	if status != "confirmed" {
		return "", fmt.Errorf("请先在「报告编辑」页签确认整份报告，再生成推荐练习")
	}
	return reportID, nil
}

// EnqueueRecommendationGenerate 推荐题生成入队，返回 job_id 供前端轮询
func (s *AssignmentService) EnqueueRecommendationGenerate(ctx context.Context, assignmentID, teacherID string) (string, error) {
	if _, err := s.confirmedLectureReport(ctx, assignmentID); err != nil {
		return "", err
	}
	var jobID string
	if err := s.db.QueryRowContext(ctx,
		`INSERT INTO job_queue (task_type, entity_type, entity_id, payload, priority, created_by)
		 VALUES ('assignment_recommendation_generate', 'assignment', $1, '{}'::jsonb, 5, $2)
		 RETURNING id`,
		assignmentID, teacherID).Scan(&jobID); err != nil {
		return "", fmt.Errorf("enqueue recommendation job: %w", err)
	}
	s.logLecturePrefEvent(teacherID, assignmentID, "recommended_question", "", "regenerate",
		map[string]interface{}{}, map[string]interface{}{"scope": "generate"})
	return jobID, nil
}

// GetRecommendationJobStatus 查询生成任务状态（限定 entity 防越权探测）
func (s *AssignmentService) GetRecommendationJobStatus(ctx context.Context, assignmentID, jobID string) (string, string, error) {
	var status, lastError string
	err := s.db.QueryRowContext(ctx,
		`SELECT status, COALESCE(last_error,'') FROM job_queue
		  WHERE id=$1 AND entity_id=$2 AND task_type='assignment_recommendation_generate'`,
		jobID, assignmentID).Scan(&status, &lastError)
	if err == sql.ErrNoRows {
		return "", "", fmt.Errorf("任务不存在")
	}
	return status, lastError, err
}

// loadConfirmedBlocksText 把已确认报告块拼成 AI 输入文本
func (s *AssignmentService) loadConfirmedBlocksText(ctx context.Context, reportID string) (string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT block_type, COALESCE(title,''), content::text
		   FROM assignment_report_blocks
		  WHERE report_id=$1 AND teacher_confirmed=TRUE
		  ORDER BY sort_order`, reportID)
	if err != nil {
		return "", fmt.Errorf("load blocks: %w", err)
	}
	defer rows.Close()
	var parts []string
	for rows.Next() {
		var bt, title, content string
		if err := rows.Scan(&bt, &title, &content); err != nil {
			continue
		}
		if strings.TrimSpace(content) == "" {
			content = "{}"
		}
		parts = append(parts, fmt.Sprintf("【%s·%s】\n%s", bt, title, truncateStr(content, 1500)))
	}
	if len(parts) == 0 {
		return "", fmt.Errorf("报告中没有已确认的内容块")
	}
	return strings.Join(parts, "\n\n"), nil
}

// executeRecommendationGenerate 由 job worker 调用：报告块+Rubric → AI → 落库推荐题
func (s *AssignmentService) executeRecommendationGenerate(ctx context.Context, job jobRecord) error {
	if s.aiSvc == nil || !s.aiSvc.IsConfigured() {
		return fmt.Errorf("ai service not configured")
	}
	assignmentID := job.EntityID

	reportID, err := s.confirmedLectureReport(ctx, assignmentID)
	if err != nil {
		return err
	}
	blocksText, err := s.loadConfirmedBlocksText(ctx, reportID)
	if err != nil {
		return err
	}

	var title string
	_ = s.db.QueryRowContext(ctx, `SELECT title FROM assignments WHERE id=$1`, assignmentID).Scan(&title)

	var criteriaJSON string
	_ = s.db.QueryRowContext(ctx,
		`SELECT criteria_json FROM assignment_rubrics
		  WHERE assignment_id=$1 ORDER BY version DESC LIMIT 1`,
		assignmentID).Scan(&criteriaJSON)
	if strings.TrimSpace(criteriaJSON) == "" {
		criteriaJSON = "[]"
	}

	userPrompt := fmt.Sprintf(
		"作业标题：%s\n\n评分标准（Rubric 维度 JSON）：\n%s\n\n教师已确认的讲评分析报告：\n%s\n\n请据此设计 3-5 道巩固练习题。",
		title, criteriaJSON, blocksText)

	ctx2, cancel := context.WithTimeout(WithFastMode(ctx), 150*time.Second)
	defer cancel()
	reply, _, err := s.aiSvc.Analyze(ctx2, AIPromptRecommendQuestions, userPrompt)
	if err != nil {
		return fmt.Errorf("ai recommend: %w", err)
	}
	jsonStr := extractJSON(reply)
	if jsonStr == "" {
		return fmt.Errorf("ai returned no valid json")
	}
	var result recommendResult
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		return fmt.Errorf("parse recommend result: %w", err)
	}
	if len(result.Questions) == 0 {
		return fmt.Errorf("ai 未生成任何推荐题")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	// 只清掉上一轮还没被教师处理的题（保留 accepted/edited/published，不覆盖教师劳动）
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM assignment_recommended_questions
		  WHERE assignment_id=$1 AND teacher_action='pending'`, assignmentID); err != nil {
		return fmt.Errorf("clear pending questions: %w", err)
	}

	for _, q := range result.Questions {
		if strings.TrimSpace(q.Stem) == "" {
			continue
		}
		kp, _ := json.Marshal(recNonNilStrings(q.KnowledgePoints))
		content, _ := json.Marshal(map[string]interface{}{
			"stem":    q.Stem,
			"options": recNonNilStrings(q.Options),
		})
		answer, _ := json.Marshal(map[string]interface{}{"answer": q.Answer})
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO assignment_recommended_questions
			   (assignment_id, report_id, source_type, target_type, knowledge_points,
			    difficulty, question_type, content, answer, explanation,
			    recommendation_reason, teacher_action)
			 VALUES ($1,$2,'ai_generated','class',$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8,$9,'pending')`,
			assignmentID, reportID, string(kp), q.Difficulty, q.QuestionType,
			string(content), string(answer), q.Explanation, q.RecommendationReason); err != nil {
			return fmt.Errorf("insert question: %w", err)
		}
	}
	return tx.Commit()
}

// recNonNilStrings 保证 JSON 里是 [] 而不是 null（前端 .map 防崩，BUG-011 同款坑）
func recNonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

// =============================================================
// 读取 / 审核
// =============================================================

// ListRecommendations 列出该作业的推荐题
func (s *AssignmentService) ListRecommendations(ctx context.Context, assignmentID string) ([]RecommendedQuestionView, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, assignment_id, COALESCE(report_id::text,''), source_type, target_type,
		        knowledge_points::text, COALESCE(difficulty,''), COALESCE(question_type,''),
		        content::text, answer::text, COALESCE(explanation,''),
		        COALESCE(recommendation_reason,''), teacher_action, final_content::text,
		        created_at::text, updated_at::text
		   FROM assignment_recommended_questions
		  WHERE assignment_id=$1 ORDER BY created_at`, assignmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []RecommendedQuestionView{}
	for rows.Next() {
		var v RecommendedQuestionView
		var kp, content, answer, final string
		if err := rows.Scan(&v.ID, &v.AssignmentID, &v.ReportID, &v.SourceType, &v.TargetType,
			&kp, &v.Difficulty, &v.QuestionType, &content, &answer, &v.Explanation,
			&v.RecommendationReason, &v.TeacherAction, &final,
			&v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		v.KnowledgePoints = recRawOr(kp, "[]")
		v.Content = recRawOr(content, "{}")
		v.Answer = recRawOr(answer, "{}")
		v.FinalContent = recRawOr(final, "{}")
		out = append(out, v)
	}
	return out, nil
}

func recRawOr(s, def string) json.RawMessage {
	if strings.TrimSpace(s) == "" {
		return json.RawMessage(def)
	}
	return json.RawMessage(s)
}

// UpdateRecommendation 教师审核：采用/拒绝/修改
func (s *AssignmentService) UpdateRecommendation(ctx context.Context, assignmentID, qid, teacherID string, req UpdateRecommendationRequest) error {
	var cur string
	err := s.db.QueryRowContext(ctx,
		`SELECT teacher_action FROM assignment_recommended_questions
		  WHERE id=$1 AND assignment_id=$2`, qid, assignmentID).Scan(&cur)
	if err == sql.ErrNoRows {
		return fmt.Errorf("推荐题不存在或不属于该作业")
	}
	if err != nil {
		return err
	}
	if cur == "published" {
		return fmt.Errorf("该题已发布为作业，不能再修改")
	}

	sets := []string{}
	args := []interface{}{}
	idx := 1
	edited := false

	if len(req.Content) > 0 && json.Valid(req.Content) {
		sets = append(sets, fmt.Sprintf("final_content=$%d::jsonb", idx))
		args = append(args, string(req.Content))
		idx++
		edited = true
	}
	if len(req.Answer) > 0 && json.Valid(req.Answer) {
		sets = append(sets, fmt.Sprintf("answer=$%d::jsonb", idx))
		args = append(args, string(req.Answer))
		idx++
		edited = true
	}
	if req.Explanation != nil {
		sets = append(sets, fmt.Sprintf("explanation=$%d", idx))
		args = append(args, strings.TrimSpace(*req.Explanation))
		idx++
		edited = true
	}

	action := ""
	switch req.Action {
	case "accept":
		action = "accepted"
	case "reject":
		action = "rejected"
	case "pending":
		action = "pending"
	case "":
		if edited {
			action = "edited"
		}
	default:
		return fmt.Errorf("无效的 action：%s", req.Action)
	}
	// 编辑 + 采用同时到达时以 edited 记录（edited 同样可发布）
	if edited && (action == "accepted" || action == "") {
		action = "edited"
	}
	if action != "" {
		sets = append(sets, fmt.Sprintf("teacher_action=$%d", idx))
		args = append(args, action)
		idx++
	}
	if len(sets) == 0 {
		return nil
	}
	sets = append(sets, "updated_at=NOW()")
	args = append(args, qid)
	if _, err := s.db.ExecContext(ctx,
		fmt.Sprintf("UPDATE assignment_recommended_questions SET %s WHERE id=$%d",
			strings.Join(sets, ", "), idx), args...); err != nil {
		return err
	}

	logAction := "edit"
	switch action {
	case "accepted":
		logAction = "accept"
	case "rejected":
		logAction = "reject"
	}
	s.logLecturePrefEvent(teacherID, assignmentID, "recommended_question", qid, logAction,
		map[string]interface{}{"from": cur}, map[string]interface{}{"to": action})
	return nil
}

// =============================================================
// 发布为新作业
// =============================================================

// recQuestionText 取教师改后的 final_content，没有则用 AI 原始 content
func recQuestionText(content, final json.RawMessage) (stem string, options []string) {
	pick := content
	var probe struct {
		Stem string `json:"stem"`
	}
	if len(final) > 0 {
		if err := json.Unmarshal(final, &probe); err == nil && strings.TrimSpace(probe.Stem) != "" {
			pick = final
		}
	}
	var c struct {
		Stem    string   `json:"stem"`
		Options []string `json:"options"`
	}
	_ = json.Unmarshal(pick, &c)
	return c.Stem, c.Options
}

// PublishRecommendations 把选中的推荐题发布为一份新作业：
//
//	新建 assignment（草稿态）→ 题目写入任务说明材料 → 复制花名册 → 按花名册每人发一个专属码
func (s *AssignmentService) PublishRecommendations(ctx context.Context, assignmentID, teacherID string, req PublishRecommendationsRequest) (*PublishRecommendationsResult, error) {
	all, err := s.ListRecommendations(ctx, assignmentID)
	if err != nil {
		return nil, err
	}

	want := map[string]bool{}
	for _, id := range req.QuestionIDs {
		want[id] = true
	}
	picked := []RecommendedQuestionView{}
	for _, q := range all {
		if q.TeacherAction != "accepted" && q.TeacherAction != "edited" {
			continue
		}
		if len(want) > 0 && !want[q.ID] {
			continue
		}
		picked = append(picked, q)
	}
	if len(picked) == 0 {
		return nil, fmt.Errorf("没有可发布的题目，请先「采用」至少一道推荐题")
	}

	// 原作业信息
	var srcTitle string
	var roomID *string
	var allowResubmit bool
	if err := s.db.QueryRowContext(ctx,
		`SELECT title, room_id, allow_resubmit FROM assignments WHERE id=$1`,
		assignmentID).Scan(&srcTitle, &roomID, &allowResubmit); err != nil {
		return nil, fmt.Errorf("读取原作业失败: %w", err)
	}

	newTitle := strings.TrimSpace(req.Title)
	if newTitle == "" {
		newTitle = srcTitle + " · 巩固练习"
	}

	// 题面拼成任务说明
	var sb strings.Builder
	sb.WriteString("本练习根据上次作业的讲评分析自动生成，用于巩固薄弱环节。\n\n")
	for i, q := range picked {
		stem, options := recQuestionText(q.Content, q.FinalContent)
		sb.WriteString(fmt.Sprintf("## 第 %d 题（%s·%s）\n\n%s\n\n", i+1, q.QuestionType, q.Difficulty, stem))
		for j, opt := range options {
			if strings.TrimSpace(opt) == "" {
				continue
			}
			sb.WriteString(fmt.Sprintf("%c. %s\n", 'A'+rune(j), opt))
		}
		if len(options) > 0 {
			sb.WriteString("\n")
		}
	}
	description := sb.String()

	// 1) 建新作业（草稿态，教师确认后再开放提交）
	newA, err := s.CreateAssignment(teacherID, models.CreateAssignmentRequest{
		RoomID:        roomID,
		Title:         newTitle,
		Description:   truncateStr(description, 4000),
		AllowResubmit: allowResubmit,
	})
	if err != nil {
		return nil, err
	}

	// 2) 题目全文写入任务说明材料（供后续 Rubric 生成 / 学生查看）
	if _, err := s.SaveMaterial(newA.ID, teacherID, "teacher", models.UploadMaterialRequest{
		MaterialRole: models.MaterialRoleInstruction,
		OriginalName: newTitle + "_题目.md",
		ContentText:  description,
	}); err != nil {
		// 材料写失败不阻断发布，作业本体已建成
		fmt.Printf("[推荐题发布] 写任务说明材料失败: %v\n", err)
	}

	// 3) 复制花名册（UNIQUE(assignment_id, student_name) 天然幂等）
	var rosterCount int
	_ = s.db.QueryRowContext(ctx,
		`WITH ins AS (
		   INSERT INTO assignment_rosters (assignment_id, student_name, student_uuid, source, expected)
		   SELECT $1, student_name, student_uuid, source, expected
		     FROM assignment_rosters WHERE assignment_id=$2
		   ON CONFLICT (assignment_id, student_name) DO NOTHING
		   RETURNING 1
		 ) SELECT COUNT(*) FROM ins`, newA.ID, assignmentID).Scan(&rosterCount)

	// 4) 按花名册每人一个专属码（同 package 复用 TokenService，无需改服务装配）
	expireDays := req.ExpireDays
	if expireDays <= 0 {
		expireDays = 7
	}
	expiresAt := time.Now().Add(time.Duration(expireDays) * 24 * time.Hour)
	ts := NewTokenService(s.db)

	tokenCount := 0
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, student_name, COALESCE(student_uuid,'')
		   FROM assignment_rosters WHERE assignment_id=$1`, newA.ID)
	if err == nil {
		type rosterRow struct{ id, name, uuid string }
		list := []rosterRow{}
		for rows.Next() {
			var r rosterRow
			if err := rows.Scan(&r.id, &r.name, &r.uuid); err == nil {
				list = append(list, r)
			}
		}
		rows.Close()
		for _, r := range list {
			tk, terr := ts.createToken(newA.ID, r.uuid, r.name, models.TokenTypeDedicated, expiresAt)
			if terr != nil || tk == nil {
				continue
			}
			s.db.ExecContext(ctx,
				`UPDATE assignment_rosters SET token_id=$2 WHERE id=$1`, r.id, tk.ID)
			tokenCount++
		}
	}

	// 5) 标记已发布
	ids := make([]string, 0, len(picked))
	for _, q := range picked {
		ids = append(ids, q.ID)
	}
	idsJSON, _ := json.Marshal(ids)
	if _, err := s.db.ExecContext(ctx,
		`UPDATE assignment_recommended_questions
		    SET teacher_action='published', updated_at=NOW()
		  WHERE assignment_id=$1 AND id::text = ANY(
		        SELECT jsonb_array_elements_text($2::jsonb))`,
		assignmentID, string(idsJSON)); err != nil {
		return nil, fmt.Errorf("标记发布状态失败: %w", err)
	}

	s.logLecturePrefEvent(teacherID, assignmentID, "recommended_question", "", "publish",
		map[string]interface{}{}, map[string]interface{}{
			"new_assignment_id": newA.ID,
			"question_count":    len(picked),
			"token_count":       tokenCount,
		})

	return &PublishRecommendationsResult{
		AssignmentID:  newA.ID,
		Title:         newTitle,
		QuestionCount: len(picked),
		RosterCount:   rosterCount,
		TokenCount:    tokenCount,
	}, nil
}
