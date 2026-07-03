// =============================================================
// MindCanvas v4.1 Phase7 - 公开分享页业务服务
// 功能：发布分享、查询分享数据、密码验证、访问计数、模板管理
// 修复：GetShareByToken Scan 顺序错误（password_hash 字段处理）
// =============================================================
package services

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"mindcanvas-server/models"
)

// Redis key 前缀常量
const (
	shareDataKeyPrefix = "share:data:" // share:data:{token} → 分享数据 JSON 缓存，TTL 5分钟
	shareMetaKeyPrefix = "share:meta:" // share:meta:{token} → 元数据缓存，TTL 10分钟
)

// ShareService 公开分享页业务服务
type ShareService struct {
	db        *sql.DB
	rdb       *redis.Client
	exportSvc *ExportService
}

// NewShareService 创建分享服务实例
func NewShareService(db *sql.DB, rdb *redis.Client, exportSvc *ExportService) *ShareService {
	return &ShareService{
		db:        db,
		rdb:       rdb,
		exportSvc: exportSvc,
	}
}

// =============================================================
// 分享发布与管理
// =============================================================

// PublishShare 发布或更新公开分享页
// 同一房间可多次发布，每次覆盖已有分享记录（一个房间最多一个分享）
func (s *ShareService) PublishShare(roomID, userID string, req models.CreateShareRequest) (*models.RoomShare, error) {
	// 1. 校验参数
	if req.Visibility == "" {
		req.Visibility = "public"
	}
	if req.Visibility != "public" && req.Visibility != "password" {
		return nil, fmt.Errorf("visibility 只能是 public 或 password")
	}
	if req.Visibility == "password" && req.Password == "" {
		return nil, fmt.Errorf("密码保护模式必须设置密码")
	}

	// 2. 处理密码散列
	var passwordHash string
	if req.Visibility == "password" && req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return nil, fmt.Errorf("密码加密失败: %w", err)
		}
		passwordHash = string(hash)
	}

	// 3. 处理过期时间
	var expiresAt *time.Time
	if req.ExpiresAt != "" {
		t, err := time.Parse("2006-01-02", req.ExpiresAt)
		if err != nil {
			// 尝试 ISO8601 格式
			t, err = time.Parse(time.RFC3339, req.ExpiresAt)
			if err != nil {
				return nil, fmt.Errorf("过期时间格式不正确，请使用 YYYY-MM-DD 或 ISO8601")
			}
		}
		// 设置为当天结束时间
		end := time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 0, time.Local)
		expiresAt = &end
	}

	// 4. 查询是否已有分享记录
	var existingID, existingToken string
	err := s.db.QueryRow(
		`SELECT id, share_token FROM room_shares WHERE room_id = $1`, roomID,
	).Scan(&existingID, &existingToken)

	if err == sql.ErrNoRows {
		// 5a. 新建分享记录
		token, err := generateShareToken()
		if err != nil {
			return nil, fmt.Errorf("生成分享 token 失败: %w", err)
		}

		// 获取房间标题作为默认分享标题
		title := req.Title
		if title == "" {
			s.db.QueryRow(`SELECT title FROM rooms WHERE id = $1`, roomID).Scan(&title)
		}

		share := &models.RoomShare{}
		err = s.db.QueryRow(`
			INSERT INTO room_shares
				(room_id, share_token, title, description, visibility, password_hash,
				 hide_names, show_stats, show_canvas, show_dropzone, expires_at, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
			RETURNING id, room_id, share_token, COALESCE(title,''), COALESCE(description,''),
				visibility, hide_names, show_stats, show_canvas, show_dropzone,
				expires_at, view_count, COALESCE(created_by::text,''), created_at, updated_at`,
			roomID, token, title, req.Description, req.Visibility, passwordHash,
			req.HideNames, req.ShowStats, req.ShowCanvas, req.ShowDropzone, expiresAt, userID,
		).Scan(
			&share.ID, &share.RoomID, &share.ShareToken, &share.Title, &share.Description,
			&share.Visibility, &share.HideNames, &share.ShowStats, &share.ShowCanvas, &share.ShowDropzone,
			&share.ExpiresAt, &share.ViewCount, &share.CreatedBy, &share.CreatedAt, &share.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("创建分享记录失败: %w", err)
		}
		log.Printf("[分享] 新建分享 token:%s room:%s", token, roomID)
		s.invalidateShareCache(token)
		return share, nil
	}

	if err != nil {
		return nil, fmt.Errorf("查询分享记录失败: %w", err)
	}

	// 5b. 更新已有分享记录
	// 如果新密码为空且是密码模式，保留原密码（不覆盖）
	if req.Visibility == "password" && req.Password == "" {
		// 读取原密码散列保持不变
		var origHash string
		s.db.QueryRow(
			`SELECT COALESCE(password_hash,'') FROM room_shares WHERE id = $1`, existingID,
		).Scan(&origHash)
		passwordHash = origHash
	}

	title := req.Title
	if title == "" {
		s.db.QueryRow(`SELECT title FROM rooms WHERE id = $1`, roomID).Scan(&title)
	}

	share := &models.RoomShare{}
	updateErr := s.db.QueryRow(`
		UPDATE room_shares SET
			title=$1, description=$2, visibility=$3, password_hash=$4,
			hide_names=$5, show_stats=$6, show_canvas=$7, show_dropzone=$8,
			expires_at=$9, updated_at=NOW()
		WHERE id=$10
		RETURNING id, room_id, share_token, COALESCE(title,''), COALESCE(description,''),
			visibility, hide_names, show_stats, show_canvas, show_dropzone,
			expires_at, view_count, COALESCE(created_by::text,''), created_at, updated_at`,
		title, req.Description, req.Visibility, passwordHash,
		req.HideNames, req.ShowStats, req.ShowCanvas, req.ShowDropzone,
		expiresAt, existingID,
	).Scan(
		&share.ID, &share.RoomID, &share.ShareToken, &share.Title, &share.Description,
		&share.Visibility, &share.HideNames, &share.ShowStats, &share.ShowCanvas, &share.ShowDropzone,
		&share.ExpiresAt, &share.ViewCount, &share.CreatedBy, &share.CreatedAt, &share.UpdatedAt,
	)
	if updateErr != nil {
		return nil, fmt.Errorf("更新分享记录失败: %w", updateErr)
	}
	// 清除缓存，强制下次重新聚合
	s.invalidateShareCache(existingToken)
	log.Printf("[分享] 更新分享 token:%s room:%s", existingToken, roomID)
	return share, nil
}

// GetShareByToken 根据 token 查询分享记录（不含 password_hash，内部使用）
// 修复：原版 Scan 顺序错误，password_hash 被错误写入 CreatedBy 字段
func (s *ShareService) GetShareByToken(token string) (*models.RoomShare, error) {
	share := &models.RoomShare{}
	// 注意：SQL 不返回 password_hash，避免敏感字段泄漏
	err := s.db.QueryRow(`
		SELECT id, room_id, share_token,
			COALESCE(title,''), COALESCE(description,''),
			visibility, hide_names, show_stats, show_canvas, show_dropzone,
			expires_at, view_count,
			COALESCE(created_by::text,''), created_at, updated_at
		FROM room_shares WHERE share_token = $1`, token,
	).Scan(
		&share.ID, &share.RoomID, &share.ShareToken,
		&share.Title, &share.Description,
		&share.Visibility, &share.HideNames, &share.ShowStats,
		&share.ShowCanvas, &share.ShowDropzone,
		&share.ExpiresAt, &share.ViewCount,
		&share.CreatedBy, &share.CreatedAt, &share.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("分享链接不存在或已失效")
	}
	if err != nil {
		return nil, fmt.Errorf("查询分享记录失败: %w", err)
	}
	return share, nil
}

// GetShareMetaByToken 获取分享页元数据（不含敏感字段，用于前端渲染头部）
func (s *ShareService) GetShareMetaByToken(token string) (*models.ShareMetaResponse, error) {
	// 1. 先查 Redis 缓存
	ctx := context.Background()
	if s.rdb != nil {
		cached, err := s.rdb.Get(ctx, shareMetaKeyPrefix+token).Result()
		if err == nil {
			var meta models.ShareMetaResponse
			if json.Unmarshal([]byte(cached), &meta) == nil {
				return &meta, nil
			}
		}
	}

	// 2. 数据库查询（password_hash 仅用于内部判断，不写入响应结构）
	meta := &models.ShareMetaResponse{}
	var expiresAt *time.Time
	var passwordHash string
	err := s.db.QueryRow(`
		SELECT
			rs.share_token,
			COALESCE(rs.title, r.title, ''),
			COALESCE(rs.description,''),
			rs.visibility,
			COALESCE(rs.password_hash,''),
			rs.hide_names, rs.show_stats, rs.show_canvas, rs.show_dropzone,
			rs.expires_at, rs.view_count, rs.created_at,
			r.title as room_title,
			COALESCE(u.display_name, u.username, '') as teacher_name
		FROM room_shares rs
		JOIN rooms r ON r.id = rs.room_id
		LEFT JOIN users u ON u.id = rs.created_by
		WHERE rs.share_token = $1`, token,
	).Scan(
		&meta.ShareToken, &meta.Title, &meta.Description,
		&meta.Visibility, &passwordHash,
		&meta.HideNames, &meta.ShowStats, &meta.ShowCanvas, &meta.ShowDropzone,
		&expiresAt, &meta.ViewCount, &meta.CreatedAt,
		&meta.RoomTitle, &meta.TeacherName,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("分享链接不存在")
	}
	if err != nil {
		return nil, fmt.Errorf("查询分享元数据失败: %w", err)
	}

	// 3. 校验过期
	if expiresAt != nil && time.Now().After(*expiresAt) {
		return nil, fmt.Errorf("分享链接已过期")
	}
	meta.ExpiresAt = expiresAt

	// 4. 写入缓存（10分钟）
	if s.rdb != nil {
		if b, err := json.Marshal(meta); err == nil {
			s.rdb.Set(ctx, shareMetaKeyPrefix+token, string(b), 10*time.Minute)
		}
	}
	return meta, nil
}

// VerifySharePassword 验证分享页密码
func (s *ShareService) VerifySharePassword(token, password string) error {
	var passwordHash string
	err := s.db.QueryRow(
		`SELECT COALESCE(password_hash,'') FROM room_shares WHERE share_token = $1`, token,
	).Scan(&passwordHash)
	if err == sql.ErrNoRows {
		return fmt.Errorf("分享链接不存在")
	}
	if err != nil {
		return fmt.Errorf("查询失败: %w", err)
	}
	if passwordHash == "" {
		return nil // 无密码保护，直接通过
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		return fmt.Errorf("密码错误")
	}
	return nil
}

// GetShareData 获取分享页完整数据（画布快照 + 统计 + 作品墙）
// 使用 Redis 缓存 5 分钟，降低数据库压力
func (s *ShareService) GetShareData(token string) (map[string]interface{}, error) {
	// 1. 先查缓存
	ctx := context.Background()
	cacheKey := shareDataKeyPrefix + token
	if s.rdb != nil {
		cached, err := s.rdb.Get(ctx, cacheKey).Result()
		if err == nil {
			var data map[string]interface{}
			if json.Unmarshal([]byte(cached), &data) == nil {
				return data, nil
			}
		}
	}

	// 2. 查询分享配置（含过期校验）
	share, err := s.GetShareByToken(token)
	if err != nil {
		return nil, err
	}

	// 3. 校验过期
	if share.ExpiresAt != nil && time.Now().After(*share.ExpiresAt) {
		return nil, fmt.Errorf("分享链接已过期")
	}

	// 4. 聚合总结数据
	summary, err := s.exportSvc.GetSummary(share.RoomID)
	if err != nil {
		return nil, fmt.Errorf("聚合数据失败: %w", err)
	}

	// 5. 如果隐藏姓名，对 DropZone 提交做脱敏处理
	if share.HideNames {
		for i := range summary.DropZones {
			for j := range summary.DropZones[i].Submissions {
				summary.DropZones[i].Submissions[j].StudentName = s.anonymizeName(
					summary.DropZones[i].Submissions[j].StudentName, j+1,
				)
			}
		}
	}

	// 6. 获取画布快照（Redis room:scene:{roomId}）
	var canvasSnapshot interface{}
	if share.ShowCanvas && s.rdb != nil {
		sceneData, redisErr := s.rdb.Get(ctx, "room:scene:"+share.RoomID).Result()
		if redisErr == nil {
			var scene interface{}
			if json.Unmarshal([]byte(sceneData), &scene) == nil {
				canvasSnapshot = scene
			}
		}
	}

	// 7. 组装响应
	data := map[string]interface{}{
		"share_token":   token,
		"title":         share.Title,
		"description":   share.Description,
		"hide_names":    share.HideNames,
		"show_stats":    share.ShowStats,
		"show_canvas":   share.ShowCanvas,
		"show_dropzone": share.ShowDropzone,
		"view_count":    share.ViewCount,
		"created_at":    share.CreatedAt,
		"expires_at":    share.ExpiresAt,
		"summary":       summary,
	}
	if canvasSnapshot != nil {
		data["canvas_snapshot"] = canvasSnapshot
	}

	// 8. 写入缓存（5分钟）
	if s.rdb != nil {
		if b, jsonErr := json.Marshal(data); jsonErr == nil {
			s.rdb.Set(ctx, cacheKey, string(b), 5*time.Minute)
		}
	}

	// 9. 异步递增访问计数（不阻塞响应）
	go func() {
		s.db.Exec(
			`UPDATE room_shares SET view_count = view_count + 1 WHERE share_token = $1`, token,
		)
	}()

	return data, nil
}

// GetSharesByRoom 获取指定房间的所有分享记录（教师查看）
func (s *ShareService) GetSharesByRoom(roomID string) ([]models.RoomShare, error) {
	rows, err := s.db.Query(`
		SELECT id, room_id, share_token,
			COALESCE(title,''), COALESCE(description,''),
			visibility, hide_names, show_stats, show_canvas, show_dropzone,
			expires_at, view_count,
			COALESCE(created_by::text,''), created_at, updated_at
		FROM room_shares WHERE room_id = $1 ORDER BY created_at DESC`, roomID,
	)
	if err != nil {
		return nil, fmt.Errorf("查询分享列表失败: %w", err)
	}
	defer rows.Close()

	var shares []models.RoomShare
	for rows.Next() {
		var share models.RoomShare
		if err := rows.Scan(
			&share.ID, &share.RoomID, &share.ShareToken,
			&share.Title, &share.Description,
			&share.Visibility, &share.HideNames, &share.ShowStats,
			&share.ShowCanvas, &share.ShowDropzone,
			&share.ExpiresAt, &share.ViewCount,
			&share.CreatedBy, &share.CreatedAt, &share.UpdatedAt,
		); err != nil {
			log.Printf("[分享] 扫描分享记录失败: %v", err)
			continue
		}
		shares = append(shares, share)
	}
	return shares, nil
}

// DeleteShare 删除分享记录
func (s *ShareService) DeleteShare(shareID, userID string) error {
	// 先查 token（用于清缓存）
	var token string
	s.db.QueryRow(
		`SELECT share_token FROM room_shares WHERE id = $1`, shareID,
	).Scan(&token)

	result, err := s.db.Exec(
		`DELETE FROM room_shares WHERE id = $1`, shareID,
	)
	if err != nil {
		return fmt.Errorf("删除分享失败: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("分享记录不存在")
	}
	if token != "" {
		s.invalidateShareCache(token)
	}
	return nil
}

// =============================================================
// 模板管理
// =============================================================

// SaveTemplate 从当前房间保存模板
func (s *ShareService) SaveTemplate(roomID, userID string, req models.CreateTemplateRequest) (*models.RoomTemplate, error) {
	// 1. 查询房间的课堂流程节点
	var stepsJSON []byte
	if err := s.db.QueryRow(
		`SELECT nodes FROM teaching_flows WHERE room_id = $1 ORDER BY created_at DESC LIMIT 1`, roomID,
	).Scan(&stepsJSON); err != nil {
		stepsJSON = []byte("[]")
	}

	// 2. 查询房间的 Widget 元素配置
	// 只保存 Widget，不保存文本卡片和手绘内容
	widgetRows, err := s.db.Query(`
		SELECT id, type, payload FROM room_elements
		WHERE room_id = $1 AND is_deleted = FALSE
		  AND type IN ('polling_widget','wordcloud_widget','qa_widget','dropzone_widget')
		ORDER BY created_at ASC`, roomID,
	)
	var elementsJSON []byte
	if err == nil {
		defer widgetRows.Close()
		var elements []map[string]interface{}
		for widgetRows.Next() {
			var id, elemType string
			var payload []byte
			if widgetRows.Scan(&id, &elemType, &payload) != nil {
				continue
			}
			var p interface{}
			json.Unmarshal(payload, &p)
			elements = append(elements, map[string]interface{}{
				"type":    elemType,
				"payload": p,
			})
		}
		elementsJSON, _ = json.Marshal(elements)
	}
	if elementsJSON == nil {
		elementsJSON = []byte("[]")
	}

	// 3. 插入模板记录
	tmpl := &models.RoomTemplate{}
	var stepsRaw, elementsRaw json.RawMessage
	insertErr := s.db.QueryRow(`
		INSERT INTO room_templates
			(name, description, category, source_room, steps_json, elements_json, is_public, author_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id, name, COALESCE(description,''), COALESCE(category,''),
			steps_json, elements_json, is_public,
			COALESCE(author_id::text,''), use_count, created_at, updated_at`,
		req.Name, req.Description, req.Category, roomID,
		stepsJSON, elementsJSON, req.IsPublic, userID,
	).Scan(
		&tmpl.ID, &tmpl.Name, &tmpl.Description, &tmpl.Category,
		&stepsRaw, &elementsRaw, &tmpl.IsPublic,
		&tmpl.AuthorID, &tmpl.UseCount, &tmpl.CreatedAt, &tmpl.UpdatedAt,
	)
	if insertErr != nil {
		return nil, fmt.Errorf("保存模板失败: %w", insertErr)
	}
	tmpl.StepsJSON = stepsRaw
	tmpl.ElementsJSON = elementsRaw
	tmpl.SourceRoom = roomID
	log.Printf("[模板] 保存模板 id:%s name:%s room:%s", tmpl.ID, tmpl.Name, roomID)
	return tmpl, nil
}

// ListTemplates 获取模板列表（包括自己的 + 公开的）
func (s *ShareService) ListTemplates(userID string) ([]models.RoomTemplate, error) {
	rows, err := s.db.Query(`
		SELECT t.id, t.name, COALESCE(t.description,''), COALESCE(t.category,''),
			t.is_public, COALESCE(t.author_id::text,''),
			COALESCE(u.display_name, u.username,'') as author_name,
			t.use_count, t.created_at, t.updated_at
		FROM room_templates t
		LEFT JOIN users u ON u.id = t.author_id
		WHERE t.author_id::text = $1 OR t.is_public = TRUE
		ORDER BY t.created_at DESC`, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("查询模板列表失败: %w", err)
	}
	defer rows.Close()

	var templates []models.RoomTemplate
	for rows.Next() {
		var tmpl models.RoomTemplate
		if err := rows.Scan(
			&tmpl.ID, &tmpl.Name, &tmpl.Description, &tmpl.Category,
			&tmpl.IsPublic, &tmpl.AuthorID, &tmpl.AuthorName,
			&tmpl.UseCount, &tmpl.CreatedAt, &tmpl.UpdatedAt,
		); err != nil {
			log.Printf("[模板] 扫描模板失败: %v", err)
			continue
		}
		templates = append(templates, tmpl)
	}
	return templates, nil
}

// GetTemplate 获取模板详情（含 steps_json 和 elements_json）
func (s *ShareService) GetTemplate(templateID string) (*models.RoomTemplate, error) {
	tmpl := &models.RoomTemplate{}
	var stepsRaw, elementsRaw json.RawMessage
	err := s.db.QueryRow(`
		SELECT t.id, t.name, COALESCE(t.description,''), COALESCE(t.category,''),
			t.steps_json, t.elements_json, t.is_public,
			COALESCE(t.author_id::text,''),
			COALESCE(u.display_name, u.username,'') as author_name,
			t.use_count, t.created_at, t.updated_at
		FROM room_templates t
		LEFT JOIN users u ON u.id = t.author_id
		WHERE t.id = $1`, templateID,
	).Scan(
		&tmpl.ID, &tmpl.Name, &tmpl.Description, &tmpl.Category,
		&stepsRaw, &elementsRaw, &tmpl.IsPublic,
		&tmpl.AuthorID, &tmpl.AuthorName,
		&tmpl.UseCount, &tmpl.CreatedAt, &tmpl.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("模板不存在")
	}
	if err != nil {
		return nil, fmt.Errorf("查询模板失败: %w", err)
	}
	tmpl.StepsJSON = stepsRaw
	tmpl.ElementsJSON = elementsRaw
	return tmpl, nil
}

// DeleteTemplate 删除模板（只能删除自己的）
func (s *ShareService) DeleteTemplate(templateID, userID string) error {
	result, err := s.db.Exec(
		`DELETE FROM room_templates WHERE id = $1 AND author_id::text = $2`,
		templateID, userID,
	)
	if err != nil {
		return fmt.Errorf("删除模板失败: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("模板不存在或无权限删除")
	}
	return nil
}

// =============================================================
// 内部辅助函数
// =============================================================

// generateShareToken 生成 12 字节随机 hex token（24字符）
func generateShareToken() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// invalidateShareCache 清除分享相关 Redis 缓存
func (s *ShareService) invalidateShareCache(token string) {
	if s.rdb == nil {
		return
	}
	ctx := context.Background()
	s.rdb.Del(ctx, shareDataKeyPrefix+token)
	s.rdb.Del(ctx, shareMetaKeyPrefix+token)
}

// anonymizeName 脱敏学生姓名（用于 hideNames 模式）
// 保留首字，其余替换为 *
func (s *ShareService) anonymizeName(name string, index int) string {
	if name == "" {
		return fmt.Sprintf("匿名学生%d", index)
	}
	runes := []rune(name)
	if len(runes) <= 1 {
		return "匿名"
	}
	masked := string(runes[0])
	for i := 1; i < len(runes); i++ {
		masked += "*"
	}
	return masked
}

// UseTemplate 使用模板创建新房间（递增 use_count，返回模板数据供调用方创建房间）
// 注意：实际创建房间由 handler 层调用 RoomService 完成，此处只返回模板内容并更新计数
func (s *ShareService) UseTemplate(templateID, userID string) (*models.RoomTemplate, error) {
	tmpl, err := s.GetTemplate(templateID)
	if err != nil {
		return nil, err
	}

	// 递增使用次数（异步，不影响主流程）
	go func() {
		s.db.Exec(
			`UPDATE room_templates SET use_count = use_count + 1 WHERE id = $1`,
			templateID,
		)
	}()

	return tmpl, nil
}
