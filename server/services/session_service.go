// =============================================================
// MindCanvas v3.0 - 学生会话服务
// 功能：学生入场、UUID 生成、Redis 会话、跨设备认领
// =============================================================
package services

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"

	"mindcanvas-server/models"
	"mindcanvas-server/utils"
)

// SessionService 学生会话服务
type SessionService struct {
	db        *sql.DB            // 数据库连接
	rdb       *redis.Client      // Redis 客户端
	profanity *ProfanityService  // 敏感词服务
}

// NewSessionService 创建会话服务实例
func NewSessionService(db *sql.DB, rdb *redis.Client, profanity *ProfanityService) *SessionService {
	return &SessionService{
		db:        db,
		rdb:       rdb,
		profanity: profanity,
	}
}

// JoinRoom 学生入场
// 生成 UUID，敏感词过滤昵称，追加防冒充后缀
func (s *SessionService) JoinRoom(req *models.JoinRoomRequest, ipAddress string) (*models.JoinRoomResponse, error) {
	ctx := context.Background()

	// 1. 校验昵称
	if err := utils.ValidateNickname(req.Nickname); err != nil {
		return nil, err
	}

	// 2. 敏感词过滤昵称
	filteredNickname := s.profanity.Filter(req.Nickname)

	// 3. 生成学生 UUID
	studentUUID := utils.GenerateGuestUUID()

	// 4. 生成防冒充后缀
	suffix := utils.GenerateSuffix()

	// 5. 默认头像
	avatarID := req.AvatarID
	if avatarID < 1 || avatarID > 8 {
		avatarID = 1
	}

	// 6. 根据邀请码查找房间
	var roomID string
	var roomStatus string
	err := s.db.QueryRow(
		"SELECT id, status FROM rooms WHERE invite_code = $1",
		req.RoomCode,
	).Scan(&roomID, &roomStatus)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("房间不存在或邀请码无效")
	}
	if err != nil {
		return nil, fmt.Errorf("查询房间失败: %w", err)
	}

	// 7. 检查房间状态
	if roomStatus != "active" {
		return nil, fmt.Errorf("房间已结束，无法加入")
	}

	// 8. 写入 room_sessions 表
	_, err = s.db.Exec(
		`INSERT INTO room_sessions (room_id, student_uuid, nickname, suffix, avatar_id, ip_address)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		roomID, studentUUID, filteredNickname, suffix, avatarID, ipAddress,
	)
	if err != nil {
		return nil, fmt.Errorf("创建会话失败: %w", err)
	}

	// 9. 写入 Redis 会话缓存
	sessionData := fmt.Sprintf(`{"room_id":"%s","nickname":"%s","suffix":"%s"}`, roomID, filteredNickname, suffix)
	s.rdb.Set(ctx, fmt.Sprintf("session:%s", studentUUID), sessionData, 24*time.Hour)

	log.Printf("[会话] 学生入场 - UUID:%s 昵称:%s#%s 房间:%s", studentUUID, filteredNickname, suffix, roomID)

	return &models.JoinRoomResponse{
		UUID:     studentUUID,
		Nickname: fmt.Sprintf("%s#%s", filteredNickname, suffix),
		RoomID:   roomID,
		AvatarID: avatarID,
	}, nil
}

// GenerateReclaimCode 生成跨设备认领码
func (s *SessionService) GenerateReclaimCode(studentUUID string) (*models.ReclaimGenerateResponse, error) {
	ctx := context.Background()

	// 生成 4 位认领码
	code := utils.GenerateReclaimCode()

	// 存入 Redis，120秒过期
	key := fmt.Sprintf("reclaim:%s", code)
	err := s.rdb.Set(ctx, key, studentUUID, 120*time.Second).Err()
	if err != nil {
		return nil, fmt.Errorf("生成认领码失败: %w", err)
	}

	log.Printf("[认领] 生成认领码 - 码:%s UUID:%s", code, studentUUID)

	return &models.ReclaimGenerateResponse{
		Code:      code,
		ExpiresIn: 120,
	}, nil
}

// VerifyReclaimCode 验证认领码
func (s *SessionService) VerifyReclaimCode(code string) (string, error) {
	ctx := context.Background()

	key := fmt.Sprintf("reclaim:%s", code)
	studentUUID, err := s.rdb.Get(ctx, key).Result()
	if err == redis.Nil {
		return "", fmt.Errorf("认领码无效或已过期")
	}
	if err != nil {
		return "", fmt.Errorf("验证认领码失败: %w", err)
	}

	// 验证成功后删除认领码（一次性使用）
	s.rdb.Del(ctx, key)

	log.Printf("[认领] 认领成功 - 码:%s UUID:%s", code, studentUUID)
	return studentUUID, nil
}

// GetSessionsByRoom 获取房间内所有会话（在线成员列表）
func (s *SessionService) GetSessionsByRoom(roomID string) ([]models.Session, error) {
	rows, err := s.db.Query(
		`SELECT id, room_id, student_uuid, nickname, suffix, avatar_id, ip_address, is_banned, joined_at, left_at
		 FROM room_sessions
		 WHERE room_id = $1 AND left_at IS NULL AND is_banned = FALSE
		 ORDER BY joined_at ASC`,
		roomID,
	)
	if err != nil {
		return nil, fmt.Errorf("查询会话列表失败: %w", err)
	}
	defer rows.Close()

	var sessions []models.Session
	for rows.Next() {
		var sess models.Session
		if err := rows.Scan(
			&sess.ID, &sess.RoomID, &sess.StudentUUID, &sess.Nickname,
			&sess.Suffix, &sess.AvatarID, &sess.IPAddress, &sess.IsBanned,
			&sess.JoinedAt, &sess.LeftAt,
		); err != nil {
			return nil, fmt.Errorf("扫描会话数据失败: %w", err)
		}
		sessions = append(sessions, sess)
	}

	return sessions, nil
}

// BanStudent 封禁学生（踢出）
func (s *SessionService) BanStudent(roomID, studentUUID string) error {
	ctx := context.Background()

	// 1. 更新数据库
	_, err := s.db.Exec(
		`UPDATE room_sessions SET is_banned = TRUE, left_at = NOW()
		 WHERE room_id = $1 AND student_uuid = $2`,
		roomID, studentUUID,
	)
	if err != nil {
		return fmt.Errorf("封禁学生失败: %w", err)
	}

	// 2. 写入 Redis 黑名单（24小时）
	banKey := fmt.Sprintf("ban:%s:%s", roomID, studentUUID)
	s.rdb.Set(ctx, banKey, "1", 24*time.Hour)

	// 3. 清除 Redis 会话
	s.rdb.Del(ctx, fmt.Sprintf("session:%s", studentUUID))

	log.Printf("[封禁] 学生被踢出 - UUID:%s 房间:%s", studentUUID, roomID)
	return nil
}

// IsStudentBanned 检查学生是否被封禁
func (s *SessionService) IsStudentBanned(roomID, studentUUID string) bool {
	ctx := context.Background()
	banKey := fmt.Sprintf("ban:%s:%s", roomID, studentUUID)
	result, err := s.rdb.Get(ctx, banKey).Result()
	if err != nil {
		return false
	}
	return result == "1"
}

// MarkStudentLeft 标记学生离场
func (s *SessionService) MarkStudentLeft(roomID, studentUUID string) error {
	_, err := s.db.Exec(
		`UPDATE room_sessions SET left_at = NOW()
		 WHERE room_id = $1 AND student_uuid = $2 AND left_at IS NULL`,
		roomID, studentUUID,
	)
	return err
}
