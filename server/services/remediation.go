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
// REQ-039 第三期 3c：学生补救（逐个生成 → 教师审阅/改温和版 → 发送给学生）
// 新文件承载，不覆盖既有 lecture_*.go / recommendation.go / assignment_service.go。
// 表：assignment_student_remediations（迁移 017 新建）
//     assignment_recommended_questions（016 已建，本期写 target_type='student'）
// 前置：讲评报告须已生成完成并「确认」（沿用 3b 的 confirmedLectureReport）
// =============================================================

// AIPromptStudentRemediation 单个学生的补救建议生成 Prompt
const AIPromptStudentRemediation = `你是一位有经验的学科教师，正在为班上某一位学生准备课后补救方案。
你将收到：本次作业的评分标准（Rubric 维度）、教师已确认的班级讲评分析报告、以及这位学生本人的提交原文。

请完成三件事：
1. 教师版诊断：指出这位学生个人最需要补的 1-3 个维度，每个维度写清具体问题与错因，并从他的原文里摘出可作为证据的原句。
2. 温和版反馈：直接写给这位学生本人看的一段话。必须先具体肯定他做到的一点（不能是空泛的"很棒"），再用鼓励的口吻指出 1-2 个可以改进的地方，并给出可操作的下一步建议。语气亲切、不贴标签、不与他人比较、不出现分数与排名，控制在 150-250 字。
3. 补救练习：3-5 道针对这位学生个人薄弱环节的小题，难度从易到难，题面完整、不看原作业也能作答。

严格遵守：
- 所有判断必须有他提交原文中的依据，不得编造他没写过的内容。
- 温和版反馈中不得出现"错误""差""不足""问题很大"这类否定性标签词，改用"可以再……""如果……会更清楚"的表述。
- 输出必须是严格 JSON，不要输出任何解释性文字。

输出严格遵守以下 JSON 格式：
{
  "teacher_summary": "给教师看的一句话小结",
  "diagnosis": {
    "weak_dimensions": [
      {
        "dimension_name": "维度名（须来自评分标准）",
        "issue": "这位学生在该维度的具体问题",
        "error_cause": "错因（如：概念混淆/审题遗漏/方法选择不当/表达不规范/过程缺失/证据不足/计算错误/作图不完整）",
        "evidence": "从他提交原文中摘出的原句"
      }
    ],
    "strengths": ["他确实做到的具体亮点", "..."]
  },
  "gentle_feedback": "写给这位学生本人的温和版反馈（150-250字）",
  "questions": [
    {
      "question_type": "题型（简答/选择/计算/写作/分析 之一）",
      "difficulty": "难度（基础/进阶/挑战 之一）",
      "knowledge_points": ["考查的知识点"],
      "stem": "完整题面",
      "options": ["选择题选项，非选择题填空数组"],
      "answer": "参考答案",
      "explanation": "解析",
      "recommendation_reason": "为什么给这位学生出这道题，引用上面诊断中的具体问题"
    }
  ]
}`

// =============================================================
// 视图与请求结构体
// =============================================================

// RemediationListItem 学生补救列表项（教师侧一屏概览）
type RemediationListItem struct {
	StudentName      string `json:"student_name"`
	StudentUUID      string `json:"student_uuid"`
	HasSubmitted     bool   `json:"has_submitted"`
	SubmissionID     string `json:"submission_id"`
	SubmittedAt      string `json:"submitted_at"`
	ContentType      string `json:"content_type"`
	GenerationStatus string `json:"generation_status"` // 空=尚未生成
	HasRemediation   bool   `json:"has_remediation"`
	Sent             bool   `json:"sent"`
	SentAt           string `json:"sent_at"`
	QuestionCount    int    `json:"question_count"`
	LastError        string `json:"last_error"`
}

// StudentRemediationView 教师侧详情（含诊断，学生看不到）
type StudentRemediationView struct {
	ID               string                    `json:"id"`
	AssignmentID     string                    `json:"assignment_id"`
	StudentUUID      string                    `json:"student_uuid"`
	StudentName      string                    `json:"student_name"`
	SubmissionID     string                    `json:"submission_id"`
	SubmissionText   string                    `json:"submission_text"`
	GenerationStatus string                    `json:"generation_status"`
	Diagnosis        json.RawMessage           `json:"diagnosis"`
	TeacherSummary   string                    `json:"teacher_summary"`
	TeacherNote      string                    `json:"teacher_note"`
	GentleFeedback   string                    `json:"gentle_feedback"`
	Sent             bool                      `json:"sent"`
	SentAt           string                    `json:"sent_at"`
	LastError        string                    `json:"last_error"`
	Questions        []RecommendedQuestionView `json:"questions"`
	CreatedAt        string                    `json:"created_at"`
	UpdatedAt        string                    `json:"updated_at"`
}

// UpdateRemediationRequest 教师编辑温和版/备注（字段均可选）
type UpdateRemediationRequest struct {
	GentleFeedback *string `json:"gentle_feedback"`
	TeacherNote    *string `json:"teacher_note"`
}

// StudentRemediationPublic 学生侧可见内容（无诊断、无答案解析）
type StudentRemediationPublic struct {
	StudentName    string                   `json:"student_name"`
	GentleFeedback string                   `json:"gentle_feedback"`
	SentAt         string                   `json:"sent_at"`
	Questions      []StudentPracticeQuestion `json:"questions"`
}

// StudentPracticeQuestion 学生侧练习题（只给题面，不给答案）
type StudentPracticeQuestion struct {
	QuestionType string   `json:"question_type"`
	Difficulty   string   `json:"difficulty"`
	Stem         string   `json:"stem"`
	Options      []string `json:"options"`
}

// remediationResult 对齐 AIPromptStudentRemediation 输出
type remediationResult struct {
	TeacherSummary string `json:"teacher_summary"`
	Diagnosis      struct {
		WeakDimensions []struct {
			DimensionName string `json:"dimension_name"`
			Issue         string `json:"issue"`
			ErrorCause    string `json:"error_cause"`
			Evidence      string `json:"evidence"`
		} `json:"weak_dimensions"`
		Strengths []string `json:"strengths"`
	} `json:"diagnosis"`
	GentleFeedback string `json:"gentle_feedback"`
	Questions      []struct {
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
// 生成（异步 job，按学生逐个触发，控 AI 成本）
// =============================================================

// remediationSubmission 取该生在本作业下的最新提交
func (s *AssignmentService) remediationSubmission(ctx context.Context, assignmentID, studentUUID string) (subID, studentName, contentText string, err error) {
	err = s.db.QueryRowContext(ctx,
		`SELECT id, COALESCE(student_name,''), COALESCE(content_text,'')
		   FROM assignment_submissions
		  WHERE assignment_id=$1 AND student_uuid=$2
		  ORDER BY updated_at DESC LIMIT 1`,
		assignmentID, studentUUID).Scan(&subID, &studentName, &contentText)
	if err == sql.ErrNoRows {
		return "", "", "", fmt.Errorf("该学生尚未提交作业，无法生成补救建议")
	}
	if err != nil {
		return "", "", "", err
	}
	if strings.TrimSpace(contentText) == "" {
		return "", "", "", fmt.Errorf("该学生的提交没有可分析的文字内容")
	}
	return subID, studentName, contentText, nil
}

// EnqueueStudentRemediation 单个学生的补救生成入队，返回 job_id 供前端轮询
func (s *AssignmentService) EnqueueStudentRemediation(ctx context.Context, assignmentID, studentUUID, teacherID string) (string, error) {
	studentUUID = strings.TrimSpace(studentUUID)
	if studentUUID == "" {
		return "", fmt.Errorf("缺少学生标识")
	}
	reportID, err := s.confirmedLectureReport(ctx, assignmentID)
	if err != nil {
		return "", err
	}
	subID, studentName, _, err := s.remediationSubmission(ctx, assignmentID, studentUUID)
	if err != nil {
		return "", err
	}

	// upsert 补救行，置 generating（重生成时保留教师已改的温和版，由 execute 决定是否覆盖）
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO assignment_student_remediations
		   (assignment_id, report_id, submission_id, student_uuid, student_name, generation_status)
		 VALUES ($1,$2,$3,$4,$5,'generating')
		 ON CONFLICT (assignment_id, student_uuid) DO UPDATE
		   SET report_id=EXCLUDED.report_id,
		       submission_id=EXCLUDED.submission_id,
		       student_name=EXCLUDED.student_name,
		       generation_status='generating',
		       last_error='',
		       updated_at=NOW()`,
		assignmentID, reportID, subID, studentUUID, studentName); err != nil {
		return "", fmt.Errorf("upsert remediation: %w", err)
	}

	payload, _ := json.Marshal(map[string]string{"student_uuid": studentUUID})
	var jobID string
	if err := s.db.QueryRowContext(ctx,
		`INSERT INTO job_queue (task_type, entity_type, entity_id, payload, priority, created_by)
		 VALUES ('assignment_student_remediation', 'assignment', $1, $2::jsonb, 5, $3)
		 RETURNING id`,
		assignmentID, string(payload), teacherID).Scan(&jobID); err != nil {
		return "", fmt.Errorf("enqueue remediation job: %w", err)
	}

	s.logLecturePrefEvent(teacherID, assignmentID, "student_remediation", "", "regenerate",
		map[string]interface{}{}, map[string]interface{}{"student_uuid": studentUUID})
	return jobID, nil
}

// GetRemediationJobStatus 查询补救生成任务状态（限定 entity 防越权探测）
func (s *AssignmentService) GetRemediationJobStatus(ctx context.Context, assignmentID, jobID string) (string, string, error) {
	var status, lastError string
	err := s.db.QueryRowContext(ctx,
		`SELECT status, COALESCE(last_error,'') FROM job_queue
		  WHERE id=$1 AND entity_id=$2 AND task_type='assignment_student_remediation'`,
		jobID, assignmentID).Scan(&status, &lastError)
	if err == sql.ErrNoRows {
		return "", "", fmt.Errorf("任务不存在")
	}
	return status, lastError, err
}

// executeStudentRemediation 由 job worker 调用：该生提交 + Rubric + 已确认报告 → AI → 落库
func (s *AssignmentService) executeStudentRemediation(ctx context.Context, job jobRecord) (retErr error) {
	if s.aiSvc == nil || !s.aiSvc.IsConfigured() {
		return fmt.Errorf("ai service not configured")
	}
	var p struct {
		StudentUUID string `json:"student_uuid"`
	}
	if err := json.Unmarshal(job.Payload, &p); err != nil || strings.TrimSpace(p.StudentUUID) == "" {
		return fmt.Errorf("payload 缺少 student_uuid")
	}
	assignmentID := job.EntityID
	studentUUID := p.StudentUUID

	// 失败时把该生补救行标记 failed（保留上一轮内容便于重试）
	defer func() {
		if retErr != nil {
			s.db.ExecContext(context.Background(),
				`UPDATE assignment_student_remediations
				   SET generation_status='failed', last_error=$3, updated_at=NOW()
				 WHERE assignment_id=$1 AND student_uuid=$2`,
				assignmentID, studentUUID, retErr.Error())
		}
	}()

	reportID, err := s.confirmedLectureReport(ctx, assignmentID)
	if err != nil {
		return err
	}
	blocksText, err := s.loadConfirmedBlocksText(ctx, reportID)
	if err != nil {
		return err
	}
	subID, studentName, contentText, err := s.remediationSubmission(ctx, assignmentID, studentUUID)
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

	displayName := studentName
	if strings.TrimSpace(displayName) == "" {
		displayName = "这位学生"
	}
	userPrompt := fmt.Sprintf(
		"作业标题：%s\n\n评分标准（Rubric 维度 JSON）：\n%s\n\n教师已确认的班级讲评分析报告：\n%s\n\n"+
			"这位学生的姓名：%s\n这位学生的提交原文：\n%s\n\n请为这位学生生成补救方案。",
		title, criteriaJSON, blocksText, displayName, truncateStr(contentText, 3000))

	ctx2, cancel := context.WithTimeout(WithFastMode(ctx), 150*time.Second)
	defer cancel()
	reply, _, err := s.aiSvc.Analyze(ctx2, AIPromptStudentRemediation, userPrompt)
	if err != nil {
		return fmt.Errorf("ai remediation: %w", err)
	}
	jsonStr := extractJSON(reply)
	if jsonStr == "" {
		return fmt.Errorf("ai returned no valid json")
	}
	var result remediationResult
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		return fmt.Errorf("parse remediation result: %w", err)
	}
	if strings.TrimSpace(result.GentleFeedback) == "" {
		return fmt.Errorf("ai 未生成温和版反馈")
	}

	diagnosisJSON, _ := json.Marshal(result.Diagnosis)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		if retErr != nil {
			tx.Rollback()
		}
	}()

	// 重新生成会覆盖温和版：已发送过的保留 sent_at，教师需重新点发送才算新一版送达
	if _, err := tx.ExecContext(ctx,
		`UPDATE assignment_student_remediations
		   SET report_id=$3, submission_id=$4, student_name=$5,
		       generation_status='done', last_error='',
		       diagnosis=$6::jsonb, teacher_summary=$7, gentle_feedback=$8,
		       updated_at=NOW()
		 WHERE assignment_id=$1 AND student_uuid=$2`,
		assignmentID, studentUUID, reportID, subID, studentName,
		string(diagnosisJSON), strings.TrimSpace(result.TeacherSummary),
		strings.TrimSpace(result.GentleFeedback)); err != nil {
		return fmt.Errorf("update remediation: %w", err)
	}

	// 该生的补救题整批替换（个人题只属于本轮诊断，不存在教师跨轮审核的历史包袱）
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM assignment_recommended_questions
		  WHERE assignment_id=$1 AND target_type='student' AND target_ref=$2`,
		assignmentID, studentUUID); err != nil {
		return fmt.Errorf("clear student questions: %w", err)
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
			   (assignment_id, report_id, source_type, target_type, target_ref, knowledge_points,
			    difficulty, question_type, content, answer, explanation,
			    recommendation_reason, teacher_action)
			 VALUES ($1,$2,'ai_generated','student',$3,$4::jsonb,$5,$6,$7::jsonb,$8::jsonb,$9,$10,'pending')`,
			assignmentID, reportID, studentUUID, string(kp), q.Difficulty, q.QuestionType,
			string(content), string(answer), q.Explanation, q.RecommendationReason); err != nil {
			return fmt.Errorf("insert student question: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// =============================================================
// 读取 / 编辑 / 发送（教师侧）
// =============================================================

// ListRemediations 教师侧列表：花名册 ∪ 提交记录，左连补救状态
func (s *AssignmentService) ListRemediations(ctx context.Context, assignmentID string) ([]RemediationListItem, error) {
	items := []RemediationListItem{}
	idx := map[string]int{} // key = student_uuid（无 uuid 的花名册条目用 name: 前缀占位）

	// 1) 先铺提交记录（能生成补救的只有这些人）
	rows, err := s.db.QueryContext(ctx,
		`SELECT s.id, s.student_uuid, COALESCE(s.student_name,''),
		        COALESCE(s.content_type,''), COALESCE(s.submitted_at::text,''),
		        COALESCE(r.generation_status,''), COALESCE(r.sent_at::text,''),
		        COALESCE(r.last_error,''),
		        (r.id IS NOT NULL) AS has_rem,
		        (SELECT COUNT(*) FROM assignment_recommended_questions q
		          WHERE q.assignment_id=s.assignment_id
		            AND q.target_type='student' AND q.target_ref=s.student_uuid) AS qcount
		   FROM assignment_submissions s
		   LEFT JOIN assignment_student_remediations r
		          ON r.assignment_id = s.assignment_id AND r.student_uuid = s.student_uuid
		  WHERE s.assignment_id=$1
		  ORDER BY s.submitted_at`, assignmentID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var it RemediationListItem
		var hasRem bool
		if err := rows.Scan(&it.SubmissionID, &it.StudentUUID, &it.StudentName,
			&it.ContentType, &it.SubmittedAt, &it.GenerationStatus, &it.SentAt,
			&it.LastError, &hasRem, &it.QuestionCount); err != nil {
			continue
		}
		it.HasSubmitted = true
		it.HasRemediation = hasRem
		it.Sent = strings.TrimSpace(it.SentAt) != ""
		idx[it.StudentUUID] = len(items)
		items = append(items, it)
	}
	rows.Close()

	// 2) 再补花名册里没提交的人（列表要能看出谁还缺）
	rrows, err := s.db.QueryContext(ctx,
		`SELECT COALESCE(student_name,''), COALESCE(student_uuid,'')
		   FROM assignment_rosters WHERE assignment_id=$1 ORDER BY student_name`, assignmentID)
	if err != nil {
		return items, nil // 花名册读失败不影响主列表
	}
	defer rrows.Close()
	seenName := map[string]bool{}
	for _, it := range items {
		if it.StudentName != "" {
			seenName[it.StudentName] = true
		}
	}
	for rrows.Next() {
		var name, uuid string
		if err := rrows.Scan(&name, &uuid); err != nil {
			continue
		}
		if uuid != "" {
			if _, ok := idx[uuid]; ok {
				continue
			}
		}
		if name != "" && seenName[name] {
			continue
		}
		items = append(items, RemediationListItem{
			StudentName:  name,
			StudentUUID:  uuid,
			HasSubmitted: false,
		})
	}
	return items, nil
}

// GetStudentRemediation 教师侧详情（含诊断与补救题全文）
func (s *AssignmentService) GetStudentRemediation(ctx context.Context, assignmentID, studentUUID string) (*StudentRemediationView, error) {
	var v StudentRemediationView
	var diagnosis, subID, sentAt sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT id, assignment_id, student_uuid, COALESCE(student_name,''),
		        submission_id::text, generation_status, diagnosis::text,
		        COALESCE(teacher_summary,''), COALESCE(teacher_note,''),
		        COALESCE(gentle_feedback,''), sent_at::text, COALESCE(last_error,''),
		        created_at::text, updated_at::text
		   FROM assignment_student_remediations
		  WHERE assignment_id=$1 AND student_uuid=$2`,
		assignmentID, studentUUID).Scan(
		&v.ID, &v.AssignmentID, &v.StudentUUID, &v.StudentName,
		&subID, &v.GenerationStatus, &diagnosis,
		&v.TeacherSummary, &v.TeacherNote, &v.GentleFeedback, &sentAt, &v.LastError,
		&v.CreatedAt, &v.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("该学生尚未生成补救建议")
	}
	if err != nil {
		return nil, err
	}
	v.SubmissionID = subID.String
	v.SentAt = sentAt.String
	v.Sent = strings.TrimSpace(v.SentAt) != ""
	v.Diagnosis = recRawOr(diagnosis.String, "{}")

	// 提交原文（教师对照着看，截断防超长）
	var content string
	_ = s.db.QueryRowContext(ctx,
		`SELECT COALESCE(content_text,'') FROM assignment_submissions
		  WHERE assignment_id=$1 AND student_uuid=$2 ORDER BY updated_at DESC LIMIT 1`,
		assignmentID, studentUUID).Scan(&content)
	v.SubmissionText = truncateStr(content, 4000)

	qs, err := s.listStudentQuestions(ctx, assignmentID, studentUUID)
	if err != nil {
		return nil, err
	}
	v.Questions = qs
	return &v, nil
}

// listStudentQuestions 该生的补救题（复用 3b 的视图结构）
func (s *AssignmentService) listStudentQuestions(ctx context.Context, assignmentID, studentUUID string) ([]RecommendedQuestionView, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, assignment_id, COALESCE(report_id::text,''), source_type, target_type,
		        knowledge_points::text, COALESCE(difficulty,''), COALESCE(question_type,''),
		        content::text, answer::text, COALESCE(explanation,''),
		        COALESCE(recommendation_reason,''), teacher_action, final_content::text,
		        created_at::text, updated_at::text
		   FROM assignment_recommended_questions
		  WHERE assignment_id=$1 AND target_type='student' AND target_ref=$2
		  ORDER BY created_at`, assignmentID, studentUUID)
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

// UpdateStudentRemediation 教师编辑温和版反馈 / 备注
func (s *AssignmentService) UpdateStudentRemediation(ctx context.Context, assignmentID, studentUUID, teacherID string, req UpdateRemediationRequest) error {
	var id, cur string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, COALESCE(gentle_feedback,'') FROM assignment_student_remediations
		  WHERE assignment_id=$1 AND student_uuid=$2`, assignmentID, studentUUID).Scan(&id, &cur)
	if err == sql.ErrNoRows {
		return fmt.Errorf("该学生尚未生成补救建议")
	}
	if err != nil {
		return err
	}

	sets := []string{}
	args := []interface{}{}
	idx := 1
	if req.GentleFeedback != nil {
		gf := strings.TrimSpace(*req.GentleFeedback)
		if gf == "" {
			return fmt.Errorf("温和版反馈不能清空")
		}
		sets = append(sets, fmt.Sprintf("gentle_feedback=$%d", idx))
		args = append(args, gf)
		idx++
	}
	if req.TeacherNote != nil {
		sets = append(sets, fmt.Sprintf("teacher_note=$%d", idx))
		args = append(args, strings.TrimSpace(*req.TeacherNote))
		idx++
	}
	if len(sets) == 0 {
		return nil
	}
	sets = append(sets, "updated_at=NOW()")
	args = append(args, id)
	if _, err := s.db.ExecContext(ctx,
		fmt.Sprintf("UPDATE assignment_student_remediations SET %s WHERE id=$%d",
			strings.Join(sets, ", "), idx), args...); err != nil {
		return err
	}

	s.logLecturePrefEvent(teacherID, assignmentID, "student_remediation", id, "edit",
		map[string]interface{}{"gentle_feedback": truncateStr(cur, 500)},
		map[string]interface{}{"student_uuid": studentUUID})
	return nil
}

// SendStudentRemediation 发送给学生＝打 sent_at 标记（学生端凭作业码即可看到温和版）
func (s *AssignmentService) SendStudentRemediation(ctx context.Context, assignmentID, studentUUID, teacherID string) (string, error) {
	var id, genStatus, gentle string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, generation_status, COALESCE(gentle_feedback,'')
		   FROM assignment_student_remediations
		  WHERE assignment_id=$1 AND student_uuid=$2`,
		assignmentID, studentUUID).Scan(&id, &genStatus, &gentle)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("该学生尚未生成补救建议")
	}
	if err != nil {
		return "", err
	}
	if genStatus != "done" {
		return "", fmt.Errorf("补救建议尚未生成完成，当前状态：%s", genStatus)
	}
	if strings.TrimSpace(gentle) == "" {
		return "", fmt.Errorf("温和版反馈为空，请先补写再发送")
	}

	var sentAt string
	if err := s.db.QueryRowContext(ctx,
		`UPDATE assignment_student_remediations
		    SET sent_at=NOW(), updated_at=NOW()
		  WHERE id=$1 RETURNING sent_at::text`, id).Scan(&sentAt); err != nil {
		return "", fmt.Errorf("标记发送失败: %w", err)
	}

	s.logLecturePrefEvent(teacherID, assignmentID, "student_remediation", id, "send",
		map[string]interface{}{}, map[string]interface{}{"student_uuid": studentUUID})
	return sentAt, nil
}

// =============================================================
// 学生侧公开读取（token + uuid 双证，只给温和版与题面）
// =============================================================

// GetStudentRemediationPublic 学生凭作业码 + 自己的 uuid 查看老师的反馈
func (s *AssignmentService) GetStudentRemediationPublic(ctx context.Context, assignmentID, tokenStr, studentUUID string) (*StudentRemediationPublic, error) {
	tokenStr = strings.ToUpper(strings.TrimSpace(tokenStr))
	studentUUID = strings.TrimSpace(studentUUID)
	if tokenStr == "" || studentUUID == "" {
		return nil, fmt.Errorf("缺少作业码或学生身份")
	}

	ts := NewTokenService(s.db)
	vr, err := ts.VerifyToken(tokenStr)
	if err != nil || vr == nil || !vr.Valid {
		return nil, fmt.Errorf("作业码无效或已过期")
	}
	if vr.AssignmentID != assignmentID {
		return nil, fmt.Errorf("作业码与该作业不匹配")
	}
	// 专属码：uuid 必须与作业码绑定的学生一致
	// 通用码：uuid 由 SubmitByToken 按 token-<作业码>-<姓名> 规则生成，前缀必须对上
	if vr.TokenType == models.TokenTypeUniversal {
		if !strings.HasPrefix(studentUUID, "token-"+tokenStr+"-") {
			return nil, fmt.Errorf("身份校验失败")
		}
	} else if vr.StudentUUID == "" || vr.StudentUUID != studentUUID {
		return nil, fmt.Errorf("身份校验失败")
	}

	var out StudentRemediationPublic
	var sentAt sql.NullString
	err = s.db.QueryRowContext(ctx,
		`SELECT COALESCE(student_name,''), COALESCE(gentle_feedback,''), sent_at::text
		   FROM assignment_student_remediations
		  WHERE assignment_id=$1 AND student_uuid=$2 AND sent_at IS NOT NULL`,
		assignmentID, studentUUID).Scan(&out.StudentName, &out.GentleFeedback, &sentAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("老师还没有发布你的反馈")
	}
	if err != nil {
		return nil, err
	}
	out.SentAt = sentAt.String

	// 只下发题面与选项，不下发答案与解析（要让学生先自己做）
	out.Questions = []StudentPracticeQuestion{}
	rows, qerr := s.db.QueryContext(ctx,
		`SELECT COALESCE(question_type,''), COALESCE(difficulty,''), content::text, final_content::text
		   FROM assignment_recommended_questions
		  WHERE assignment_id=$1 AND target_type='student' AND target_ref=$2
		  ORDER BY created_at`, assignmentID, studentUUID)
	if qerr == nil {
		defer rows.Close()
		for rows.Next() {
			var qt, diff, content, final string
			if err := rows.Scan(&qt, &diff, &content, &final); err != nil {
				continue
			}
			stem, options := recQuestionText(recRawOr(content, "{}"), recRawOr(final, "{}"))
			if strings.TrimSpace(stem) == "" {
				continue
			}
			out.Questions = append(out.Questions, StudentPracticeQuestion{
				QuestionType: qt,
				Difficulty:   diff,
				Stem:         stem,
				Options:      recNonNilStrings(options),
			})
		}
	}
	return &out, nil
}
