// =============================================================
// MindCanvas Phase8-v2 - 作业码服务
// 功能：生成/验证作业码、花名册CRUD、学生身份续接
// =============================================================
package services

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"time"

	"mindcanvas-server/models"
)

// TokenService 作业码服务
type TokenService struct {
	db *sql.DB
}

// NewTokenService 创建作业码服务实例
func NewTokenService(db *sql.DB) *TokenService {
	return &TokenService{db: db}
}

// =============================================================
// 作业码生成
// =============================================================

// GenerateTokens 批量生成作业码
// tokenType=dedicated: 从课堂在线学生生成专属码（需roomID）
// tokenType=universal: 生成指定数量通用码（需count）
func (s *TokenService) GenerateTokens(assignmentID string, req models.GenerateTokensRequest) (*models.GenerateTokensResponse, error) {
	// 默认7天过期
	expireDays := req.ExpireDays
	if expireDays <= 0 {
		expireDays = 7
	}
	expiresAt := time.Now().Add(time.Duration(expireDays) * 24 * time.Hour)

	var tokens []models.AssignmentToken
	var err error

	switch req.TokenType {
	case models.TokenTypeDedicated:
		// 专属码：从课堂在线学生生成
		tokens, err = s.generateDedicatedTokens(assignmentID, req.RoomID, expiresAt)
	case models.TokenTypeUniversal:
		// 通用码：生成指定数量
		count := req.Count
		if count <= 0 {
			count = 30 // 默认30个通用码
		}
		tokens, err = s.generateUniversalTokens(assignmentID, count, expiresAt)
	default:
		return nil, fmt.Errorf("无效的token类型: %s", req.TokenType)
	}

	if err != nil {
		return nil, err
	}

	return &models.GenerateTokensResponse{
		Tokens:     tokens,
		TotalCount: len(tokens),
		TokenType:  req.TokenType,
		ExpiresAt:  expiresAt,
	}, nil
}

// generateDedicatedTokens 从课堂在线学生生成专属码
func (s *TokenService) generateDedicatedTokens(assignmentID, roomID string, expiresAt time.Time) ([]models.AssignmentToken, error) {
	if roomID == "" {
		return nil, fmt.Errorf("专属码模式需要提供房间ID")
	}

	// 查询课堂在线学生（从room_sessions获取，排除教师）
	rows, err := s.db.Query(`
		SELECT DISTINCT rs.student_uuid, rs.nickname
		FROM room_sessions rs
		WHERE rs.room_id = $1
		  AND rs.left_at IS NULL
		  AND NOT EXISTS (
		      SELECT 1 FROM users u WHERE u.id::text = rs.student_uuid
		  )
		ORDER BY rs.nickname
	`, roomID)
	if err != nil {
		return nil, fmt.Errorf("查询课堂学生失败: %v", err)
	}
	defer rows.Close()

	var tokens []models.AssignmentToken
	for rows.Next() {
		var uuid, nickname string
		if err := rows.Scan(&uuid, &nickname); err != nil {
			continue
		}

		// 为每个学生生成专属码
		token, err := s.createToken(assignmentID, uuid, nickname, models.TokenTypeDedicated, expiresAt)
		if err != nil {
			// 跳过已存在的（重复生成时幂等）
			continue
		}
		tokens = append(tokens, *token)
	}

	return tokens, nil
}

// generateUniversalTokens 生成通用作业码
func (s *TokenService) generateUniversalTokens(assignmentID string, count int, expiresAt time.Time) ([]models.AssignmentToken, error) {
	var tokens []models.AssignmentToken
	for i := 0; i < count; i++ {
		token, err := s.createToken(assignmentID, "", "", models.TokenTypeUniversal, expiresAt)
		if err != nil {
			continue
		}
		tokens = append(tokens, *token)
	}
	return tokens, nil
}

// createToken 创建单个作业码记录
func (s *TokenService) createToken(assignmentID, studentUUID, studentName, tokenType string, expiresAt time.Time) (*models.AssignmentToken, error) {
	// 生成8位大写字母数字码
	tokenStr, err := generateTokenString(8)
	if err != nil {
		return nil, err
	}

	var token models.AssignmentToken
	var uuid, name sql.NullString

	err = s.db.QueryRow(`
		INSERT INTO assignment_tokens
		    (assignment_id, student_uuid, student_name, token, token_type, expires_at)
		VALUES ($1, NULLIF($2,''), NULLIF($3,''), $4, $5, $6)
		ON CONFLICT (token) DO NOTHING
		RETURNING id, assignment_id,
		          COALESCE(student_uuid,'') as student_uuid,
		          COALESCE(student_name,'') as student_name,
		          token, token_type, expires_at, created_at
	`, assignmentID, studentUUID, studentName, tokenStr, tokenType, expiresAt).Scan(
		&token.ID, &token.AssignmentID,
		&uuid, &name,
		&token.Token, &token.TokenType,
		&token.ExpiresAt, &token.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	token.StudentUUID = uuid.String
	token.StudentName = name.String
	return &token, nil
}

// generateTokenString 生成N位大写字母数字随机码
func generateTokenString(n int) (string, error) {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // 去掉易混淆字符 0OI1
	result := make([]byte, n)
	for i := range result {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			return "", err
		}
		result[i] = chars[idx.Int64()]
	}
	return string(result), nil
}

// =============================================================
// 作业码验证（学生提交入口）
// =============================================================

// VerifyToken 验证作业码，返回作业信息和学生身份
func (s *TokenService) VerifyToken(tokenStr string) (*models.TokenVerifyResult, error) {
	tokenStr = strings.ToUpper(strings.TrimSpace(tokenStr))
	if tokenStr == "" {
		return nil, fmt.Errorf("作业码不能为空")
	}

	// 查询token + 作业基本信息
	var t models.AssignmentToken
	var result models.TokenVerifyResult
	var uuid, name sql.NullString
	var usedAt sql.NullTime
	var subID sql.NullString

	err := s.db.QueryRow(`
		SELECT
		    at.id, at.assignment_id,
		    COALESCE(at.student_uuid,'') as student_uuid,
		    COALESCE(at.student_name,'') as student_name,
		    at.token, at.token_type, at.expires_at,
		    at.used_at, at.submission_id,
		    a.title, a.description, a.status,
		    a.due_at, a.allow_resubmit
		FROM assignment_tokens at
		JOIN assignments a ON a.id = at.assignment_id
		WHERE at.token = $1
	`, tokenStr).Scan(
		&t.ID, &t.AssignmentID,
		&uuid, &name,
		&t.Token, &t.TokenType, &t.ExpiresAt,
		&usedAt, &subID,
		&result.AssignmentTitle,
		&result.AssignmentDescription,
		&result.AssignmentStatus,
		&result.DueAt,
		&result.AllowResubmit,
	)
	if err == sql.ErrNoRows {
		return &models.TokenVerifyResult{Valid: false}, fmt.Errorf("作业码不存在或已失效")
	}
	if err != nil {
		return nil, fmt.Errorf("验证作业码失败: %v", err)
	}

	t.StudentUUID = uuid.String
	t.StudentName = name.String
	if usedAt.Valid {
		t.UsedAt = &usedAt.Time
	}
	if subID.Valid {
		t.SubmissionID = &subID.String
	}

	// 检查是否过期
	if time.Now().After(t.ExpiresAt) {
		return &models.TokenVerifyResult{Valid: false}, fmt.Errorf("作业码已过期")
	}

	// 检查作业状态（collecting才能提交）
	if result.AssignmentStatus != "collecting" && result.AssignmentStatus != "reviewing" {
		return &models.TokenVerifyResult{Valid: false}, fmt.Errorf("该作业当前不接受提交（状态：%s）", result.AssignmentStatus)
	}

	// 构建验证结果
	result.Valid = true
	result.Token = t.Token
	result.TokenType = t.TokenType
	result.AssignmentID = t.AssignmentID
	result.StudentUUID = t.StudentUUID
	result.StudentName = t.StudentName

	// 如果已提交，返回已有提交信息（用于allow_resubmit场景）
	if t.SubmissionID != nil {
		sub, err := s.getSubmissionByID(*t.SubmissionID)
		if err == nil {
			result.ExistingSubmission = sub
		}
	}

	return &result, nil
}

// getSubmissionByID 查询单个提交
func (s *TokenService) getSubmissionByID(subID string) (*models.AssignmentSubmission, error) {
	var sub models.AssignmentSubmission
	var groupID sql.NullString
	err := s.db.QueryRow(`
		SELECT id, assignment_id, student_uuid, student_name,
		       group_id, version, content_type,
		       COALESCE(content_text,'') as content_text,
		       submitted_at, updated_at
		FROM assignment_submissions
		WHERE id = $1
	`, subID).Scan(
		&sub.ID, &sub.AssignmentID, &sub.StudentUUID, &sub.StudentName,
		&groupID, &sub.Version, &sub.ContentType,
		&sub.ContentText, &sub.SubmittedAt, &sub.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if groupID.Valid {
		sub.GroupID = &groupID.String
	}
	return &sub, nil
}

// BindTokenToSubmission 提交成功后将token与提交关联
func (s *TokenService) BindTokenToSubmission(tokenStr, submissionID string) error {
	now := time.Now()
	_, err := s.db.Exec(`
		UPDATE assignment_tokens
		SET submission_id = $1,
		    used_at = CASE WHEN used_at IS NULL THEN $2 ELSE used_at END
		WHERE token = $3
	`, submissionID, now, tokenStr)
	return err
}

// =============================================================
// 花名册管理
// =============================================================

// GetRosterWithStatus 获取花名册+提交状态（老师视图）
func (s *TokenService) GetRosterWithStatus(assignmentID string) (*models.RosterSummary, error) {
	rows, err := s.db.Query(`
		SELECT
		    r.id, r.assignment_id, r.student_name,
		    COALESCE(r.student_uuid,'') as student_uuid,
		    r.source, r.expected, r.created_at,
		    COALESCE(at.id::text,'')    as token_id,
		    COALESCE(at.token,'')       as token,
		    COALESCE(at.token_type,'')  as token_type,
		    at.expires_at,
		    -- 提交状态：通过token关联或student_uuid关联
		    CASE WHEN sub.id IS NOT NULL THEN true ELSE false END as has_submitted,
		    sub.id           as submission_id,
		    sub.submitted_at,
		    COALESCE(sub.content_type,'') as content_type,
		    COALESCE(aa.review_status,'') as assess_status
		FROM assignment_rosters r
		LEFT JOIN assignment_tokens at ON at.id = r.token_id
		LEFT JOIN assignment_submissions sub ON (
		    sub.assignment_id = r.assignment_id
		    AND (
		        -- 专属码：通过student_uuid匹配
		        (r.student_uuid != '' AND sub.student_uuid = r.student_uuid)
		        OR
		        -- 通用码：通过token绑定的submission_id匹配
		        (at.submission_id IS NOT NULL AND sub.id = at.submission_id)
		        OR
		        -- 姓名匹配兜底（通用码学生填了相同姓名）
		        (r.student_uuid = '' AND sub.student_name = r.student_name)
		    )
		)
		LEFT JOIN assignment_assessments aa ON aa.submission_id = sub.id
		WHERE r.assignment_id = $1 AND r.expected = true
		ORDER BY r.student_name
	`, assignmentID)
	if err != nil {
		return nil, fmt.Errorf("查询花名册失败: %v", err)
	}
	defer rows.Close()

	var roster []models.RosterWithStatus
	for rows.Next() {
		var item models.RosterWithStatus
		var tokenID, token, tokenType string
		var tokenExpiresAt sql.NullTime
		var subID sql.NullString
		var submittedAt sql.NullTime
		var tokenIDNull sql.NullString

		err := rows.Scan(
			&item.ID, &item.AssignmentID, &item.StudentName,
			&item.StudentUUID, &item.Source, &item.Expected, &item.CreatedAt,
			&tokenIDNull, &token, &tokenType,
			&tokenExpiresAt,
			&item.HasSubmitted,
			&subID, &submittedAt, &item.ContentType, &item.AssessStatus,
		)
		if err != nil {
			continue
		}
		_ = tokenID
		if tokenIDNull.Valid {
			item.TokenID = &tokenIDNull.String
		}
		item.Token = token
		item.TokenType = tokenType
		if tokenExpiresAt.Valid {
			item.TokenExpiresAt = &tokenExpiresAt.Time
		}
		if subID.Valid {
			item.SubmissionID = &subID.String
		}
		if submittedAt.Valid {
			item.SubmittedAt = &submittedAt.Time
		}
		roster = append(roster, item)
	}

	// 计算统计数据
	submitted := 0
	for _, r := range roster {
		if r.HasSubmitted {
			submitted++
		}
	}
	total := len(roster)
	pending := total - submitted
	rate := 0.0
	if total > 0 {
		rate = float64(submitted) / float64(total) * 100
	}

	return &models.RosterSummary{
		TotalExpected:  total,
		TotalSubmitted: submitted,
		TotalPending:   pending,
		SubmitRate:     rate,
		Roster:         roster,
	}, nil
}

// AddRosterEntry 手动添加花名册条目
func (s *TokenService) AddRosterEntry(assignmentID string, req models.AddRosterRequest) (*models.AssignmentRoster, error) {
	var entry models.AssignmentRoster
	var uuid sql.NullString
	var tokenID sql.NullString

	err := s.db.QueryRow(`
		INSERT INTO assignment_rosters
		    (assignment_id, student_name, student_uuid, source, expected)
		VALUES ($1, $2, NULLIF($3,''), 'manual', true)
		ON CONFLICT (assignment_id, student_name) DO UPDATE
		    SET student_uuid = EXCLUDED.student_uuid,
		        expected = true
		RETURNING id, assignment_id, student_name,
		          COALESCE(student_uuid,'') as student_uuid,
		          token_id, source, expected, created_at
	`, assignmentID, req.StudentName, req.StudentUUID).Scan(
		&entry.ID, &entry.AssignmentID, &entry.StudentName,
		&uuid, &tokenID, &entry.Source, &entry.Expected, &entry.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("添加花名册失败: %v", err)
	}
	entry.StudentUUID = uuid.String
	if tokenID.Valid {
		entry.TokenID = &tokenID.String
	}
	return &entry, nil
}

// ImportRosterFromCSV 批量导入花名册（CSV格式）
func (s *TokenService) ImportRosterFromCSV(assignmentID string, names []string) (int, error) {
	count := 0
	for _, line := range names {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// 支持 "姓名" 或 "姓名,UUID" 两种格式
		parts := strings.SplitN(line, ",", 2)
		name := strings.TrimSpace(parts[0])
		uuid := ""
		if len(parts) == 2 {
			uuid = strings.TrimSpace(parts[1])
		}
		if name == "" {
			continue
		}
		_, err := s.db.Exec(`
			INSERT INTO assignment_rosters
			    (assignment_id, student_name, student_uuid, source, expected)
			VALUES ($1, $2, NULLIF($3,''), 'import', true)
			ON CONFLICT (assignment_id, student_name) DO UPDATE
			    SET student_uuid = CASE
			        WHEN EXCLUDED.student_uuid IS NOT NULL THEN EXCLUDED.student_uuid
			        ELSE assignment_rosters.student_uuid
			    END,
			    expected = true
		`, assignmentID, name, uuid)
		if err == nil {
			count++
		}
	}
	return count, nil
}

// SyncFromClassroom 从课堂在线人数同步花名册
// 查询指定房间当前在线的学生，批量写入花名册
func (s *TokenService) SyncFromClassroom(assignmentID, roomID string) (int, error) {
	// 查询房间当前在线学生（排除教师）
	rows, err := s.db.Query(`
		SELECT DISTINCT rs.student_uuid, rs.nickname
		FROM room_sessions rs
		WHERE rs.room_id = $1
		  AND rs.left_at IS NULL
		  AND NOT EXISTS (
		      SELECT 1 FROM users u WHERE u.id::text = rs.student_uuid
		  )
		ORDER BY rs.nickname
	`, roomID)
	if err != nil {
		return 0, fmt.Errorf("查询课堂学生失败: %v", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var uuid, nickname string
		if err := rows.Scan(&uuid, &nickname); err != nil {
			continue
		}
		_, err := s.db.Exec(`
			INSERT INTO assignment_rosters
			    (assignment_id, student_name, student_uuid, source, expected)
			VALUES ($1, $2, $3, 'classroom', true)
			ON CONFLICT (assignment_id, student_name) DO UPDATE
			    SET student_uuid = EXCLUDED.student_uuid,
			        source = 'classroom',
			        expected = true
		`, assignmentID, nickname, uuid)
		if err == nil {
			count++
		}
	}

	// 更新作业的roster_source和expected_count
	s.db.Exec(`
		UPDATE assignments
		SET roster_source = 'classroom',
		    expected_count = (
		        SELECT COUNT(*) FROM assignment_rosters
		        WHERE assignment_id = $1 AND expected = true
		    )
		WHERE id = $1
	`, assignmentID)

	return count, nil
}

// DeleteRosterEntry 删除花名册条目
func (s *TokenService) DeleteRosterEntry(assignmentID, rosterID string) error {
	_, err := s.db.Exec(`
		DELETE FROM assignment_rosters
		WHERE id = $1 AND assignment_id = $2
	`, rosterID, assignmentID)
	return err
}

// =============================================================
// 作业码查询与导出
// =============================================================

// ListTokens 查询作业的所有作业码
func (s *TokenService) ListTokens(assignmentID string) ([]models.AssignmentToken, error) {
	rows, err := s.db.Query(`
		SELECT id, assignment_id,
		       COALESCE(student_uuid,'') as student_uuid,
		       COALESCE(student_name,'') as student_name,
		       token, token_type, expires_at,
		       used_at, submission_id, created_at
		FROM assignment_tokens
		WHERE assignment_id = $1
		ORDER BY created_at DESC
	`, assignmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tokens []models.AssignmentToken
	for rows.Next() {
		var t models.AssignmentToken
		var usedAt sql.NullTime
		var subID sql.NullString
		err := rows.Scan(
			&t.ID, &t.AssignmentID,
			&t.StudentUUID, &t.StudentName,
			&t.Token, &t.TokenType, &t.ExpiresAt,
			&usedAt, &subID, &t.CreatedAt,
		)
		if err != nil {
			continue
		}
		if usedAt.Valid {
			t.UsedAt = &usedAt.Time
		}
		if subID.Valid {
			t.SubmissionID = &subID.String
		}
		tokens = append(tokens, t)
	}
	return tokens, nil
}

// ExportTokensCSV 导出作业码为CSV格式（UTF-8 BOM兼容Excel中文）
func (s *TokenService) ExportTokensCSV(assignmentID string) ([]byte, error) {
	tokens, err := s.ListTokens(assignmentID)
	if err != nil {
		return nil, err
	}

	var sb strings.Builder
	// UTF-8 BOM
	sb.WriteString("\xEF\xBB\xBF")
	sb.WriteString("姓名,作业码,类型,过期时间,是否已使用\n")

	for _, t := range tokens {
		name := t.StudentName
		if name == "" {
			name = "（通用码）"
		}
		typLabel := "通用码"
		if t.TokenType == models.TokenTypeDedicated {
			typLabel = "专属码"
		}
		used := "未使用"
		if t.UsedAt != nil {
			used = "已使用"
		}
		sb.WriteString(fmt.Sprintf("%s,%s,%s,%s,%s\n",
			name, t.Token, typLabel,
			t.ExpiresAt.Format("2006-01-02"),
			used,
		))
	}
	return []byte(sb.String()), nil
}

// =============================================================
// 凭作业码提交（学生独立提交页核心逻辑）
// =============================================================

// SubmitByToken 学生凭作业码提交作业
// 返回：submissionID, studentUUID, error
func (s *TokenService) SubmitByToken(req models.SubmitByTokenRequest) (string, string, error) {
	// 1. 验证作业码
	verifyResult, err := s.VerifyToken(req.Token)
	if err != nil {
		return "", "", err
	}
	if !verifyResult.Valid {
		return "", "", fmt.Errorf("作业码验证失败")
	}

	assignmentID := verifyResult.AssignmentID
	studentUUID := verifyResult.StudentUUID
	studentName := verifyResult.StudentName

	// 通用码：使用学生自填姓名
	if verifyResult.TokenType == models.TokenTypeUniversal {
		if req.StudentName == "" {
			return "", "", fmt.Errorf("通用码提交需要填写姓名")
		}
		studentName = req.StudentName
		// 通用码没有预设uuid，生成一个基于作业码+姓名的稳定uuid
		studentUUID = fmt.Sprintf("token-%s-%s", req.Token, req.StudentName)
	}

	// 2. 检查是否已提交（不允许重复提交时）
	if verifyResult.ExistingSubmission != nil && !verifyResult.AllowResubmit {
		return "", "", fmt.Errorf("已提交过，该作业不允许重新提交")
	}

	// 自动推断内容类型
	contentType := req.ContentType
	if contentType == "" {
		if req.FileURL != "" {
			contentType = "file"
		} else if req.LinkURL != "" {
			contentType = "link"
		} else {
			contentType = "text"
		}
	}

	// 组合content_text：文件提交存"文件名|URL"，链接提交存URL，文字提交存原文
	contentText := req.ContentText
	if contentType == "file" && req.FileURL != "" {
		if req.FileName != "" {
			contentText = req.FileName + "|" + req.FileURL
		} else {
			contentText = req.FileURL
		}
	} else if contentType == "link" && req.LinkURL != "" {
		contentText = req.LinkURL
	}

	// 3. 写入提交记录
	var subID string
	if verifyResult.ExistingSubmission != nil && verifyResult.AllowResubmit {
		// 更新已有提交，版本+1
		err = s.db.QueryRow(`
			UPDATE assignment_submissions
			SET content_type = $1,
			    content_text = $2,
			    version = version + 1,
			    updated_at = NOW()
			WHERE id = $3
			RETURNING id
		`, contentType, contentText, verifyResult.ExistingSubmission.ID).Scan(&subID)
	} else {
		// 新建提交
		err = s.db.QueryRow(`
			INSERT INTO assignment_submissions
			    (assignment_id, student_uuid, student_name,
			     content_type, content_text, version)
			VALUES ($1, $2, $3, $4, $5, 1)
			RETURNING id
		`, assignmentID, studentUUID, studentName,
			contentType, contentText).Scan(&subID)
	}
	if err != nil {
		return "", "", fmt.Errorf("提交失败: %v", err)
	}

	// 4. 绑定token与提交
	if err := s.BindTokenToSubmission(req.Token, subID); err != nil {
		// 不影响主流程，只记录日志
		fmt.Printf("[TokenService] 绑定token失败: %v\n", err)
	}

	// 5. 将提交信息序列化到花名册（通用码：更新姓名匹配的花名册条目）
	if verifyResult.TokenType == models.TokenTypeUniversal {
		s.db.Exec(`
			UPDATE assignment_rosters
			SET student_uuid = $1
			WHERE assignment_id = $2
			  AND student_name = $3
			  AND student_uuid = ''
		`, studentUUID, assignmentID, studentName)
	}

	return subID, studentUUID, nil
}

// GetAssignmentPublicInfo 获取作业公开信息（学生查看用，不含评分标准详情）
func (s *TokenService) GetAssignmentPublicInfo(assignmentID string) (map[string]interface{}, error) {
	var title, description, status string
	var dueAt sql.NullTime
	var allowResubmit bool

	err := s.db.QueryRow(`
		SELECT title, description, status, due_at, allow_resubmit
		FROM assignments WHERE id = $1
	`, assignmentID).Scan(&title, &description, &status, &dueAt, &allowResubmit)
	if err != nil {
		return nil, err
	}

	result := map[string]interface{}{
		"title":          title,
		"description":    description,
		"status":         status,
		"allow_resubmit": allowResubmit,
	}
	if dueAt.Valid {
		result["due_at"] = dueAt.Time
	}
	return result, nil
}

// GetStudentAssessment 学生查看自己的评价结果（仅published状态）
func (s *TokenService) GetStudentAssessment(assignmentID, studentUUID string) (*models.AssignmentAssessment, error) {
	var assessment models.AssignmentAssessment
	var reviewedBy sql.NullString
	var reviewedAt, publishedAt, aiAssessedAt sql.NullTime
	var aiScore, finalScore sql.NullFloat64

	err := s.db.QueryRow(`
		SELECT aa.id, aa.submission_id, aa.rubric_id,
		       aa.ai_score, aa.ai_dimension_scores,
		       aa.ai_feedback, aa.ai_highlights, aa.ai_issues, aa.ai_suggestions,
		       aa.ai_assessed_at,
		       aa.final_score, aa.final_dimension_scores, aa.final_feedback,
		       aa.review_status, aa.reviewed_by, aa.reviewed_at, aa.published_at,
		       aa.created_at, aa.updated_at
		FROM assignment_assessments aa
		JOIN assignment_submissions sub ON sub.id = aa.submission_id
		WHERE sub.assignment_id = $1
		  AND sub.student_uuid = $2
		  AND aa.review_status = 'published'
		ORDER BY aa.updated_at DESC
		LIMIT 1
	`, assignmentID, studentUUID).Scan(
		&assessment.ID, &assessment.SubmissionID, &assessment.RubricID,
		&aiScore, &assessment.AIDimensionScores,
		&assessment.AIFeedback, &assessment.AIHighlights,
		&assessment.AIIssues, &assessment.AISuggestions,
		&aiAssessedAt,
		&finalScore, &assessment.FinalDimensionScores, &assessment.FinalFeedback,
		&assessment.ReviewStatus, &reviewedBy, &reviewedAt, &publishedAt,
		&assessment.CreatedAt, &assessment.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("暂无已发布的评价结果")
	}
	if err != nil {
		return nil, err
	}

	if aiScore.Valid {
		assessment.AIScore = &aiScore.Float64
	}
	if finalScore.Valid {
		assessment.FinalScore = &finalScore.Float64
	}
	if aiAssessedAt.Valid {
		assessment.AIAssessedAt = &aiAssessedAt.Time
	}
	if reviewedBy.Valid {
		assessment.ReviewedBy = &reviewedBy.String
	}
	if reviewedAt.Valid {
		assessment.ReviewedAt = &reviewedAt.Time
	}
	if publishedAt.Valid {
		assessment.PublishedAt = &publishedAt.Time
	}
	return &assessment, nil
}

// MarshalJSON helper - 将map序列化为JSON字符串备用
func marshalToJSON(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}
