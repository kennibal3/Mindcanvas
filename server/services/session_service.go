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
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"mindcanvas-server/models"
	"mindcanvas-server/utils"
)

// SessionService 学生会话服务
type SessionService struct {
	db        *sql.DB           // 数据库连接
	rdb       *redis.Client     // Redis 客户端
	profanity *ProfanityService // 敏感词服务
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
// 按房间协作形态分流：
//
//	roster            实名上课：真名匹配 class_students，session 绑稳定 student_id；
//	                  重名返候选让学生二选一（不入场）；不在册硬拒。
//	anonymous / team  保持现状：自由昵称 + guest- 临时 UUID + 防冒充后缀。
func (s *SessionService) JoinRoom(req *models.JoinRoomRequest, ipAddress string) (*models.JoinRoomResponse, error) {
	ctx := context.Background()

	// 1. 校验昵称
	if err := utils.ValidateNickname(req.Nickname); err != nil {
		return nil, err
	}

	// 2. 根据邀请码查找房间（含协作形态与绑定班级）
	var roomID, roomStatus, collabMode string
	var classID sql.NullString
	err := s.db.QueryRow(
		"SELECT id, status, collab_mode, class_id FROM rooms WHERE invite_code = $1",
		req.RoomCode,
	).Scan(&roomID, &roomStatus, &collabMode, &classID)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("房间不存在或邀请码无效")
	}
	if err != nil {
		return nil, fmt.Errorf("查询房间失败: %w", err)
	}
	if roomStatus != "active" {
		return nil, fmt.Errorf("房间已结束，无法加入")
	}

	// 3. 默认头像
	avatarID := req.AvatarID
	if avatarID < 1 || avatarID > 8 {
		avatarID = 1
	}

	// 4. 按协作形态决定 student_uuid / 昵称 / 后缀
	var studentUUID, displayNickname, suffix string

	if collabMode == models.CollabModeRoster {
		// —— 实名上课：真名匹配花名册，session 绑稳定 student_id ——
		if !classID.Valid || classID.String == "" {
			return nil, fmt.Errorf("该房间未绑定班级，请联系老师")
		}

		if req.StudentID != "" {
			// 二次提交：学生已从重名候选里选定 student_id
			var name, disambig string
			e := s.db.QueryRow(
				`SELECT student_name, disambig FROM class_students WHERE id=$1 AND class_id=$2`,
				req.StudentID, classID.String,
			).Scan(&name, &disambig)
			if e == sql.ErrNoRows {
				return nil, fmt.Errorf("所选学生不在本班花名册")
			}
			if e != nil {
				return nil, fmt.Errorf("查询花名册失败: %w", e)
			}
			studentUUID, displayNickname, suffix = req.StudentID, name, disambig
		} else {
			// 按真名匹配
			realName := strings.TrimSpace(req.Nickname)
			rows, e := s.db.Query(
				`SELECT id, student_name, disambig FROM class_students
				 WHERE class_id=$1 AND student_name=$2 ORDER BY disambig`,
				classID.String, realName,
			)
			if e != nil {
				return nil, fmt.Errorf("查询花名册失败: %w", e)
			}
			var cands []models.RosterCandidate
			for rows.Next() {
				var c models.RosterCandidate
				if e := rows.Scan(&c.StudentID, &c.StudentName, &c.Disambig); e != nil {
					rows.Close()
					return nil, fmt.Errorf("扫描花名册失败: %w", e)
				}
				cands = append(cands, c)
			}
			rows.Close()

			switch len(cands) {
			case 0:
				return nil, fmt.Errorf("「%s」不在花名册，请联系老师核对姓名", realName)
			case 1:
				studentUUID, displayNickname, suffix = cands[0].StudentID, cands[0].StudentName, cands[0].Disambig
			default:
				// 重名：不入场，返回候选让学生二选一
				return &models.JoinRoomResponse{
					RoomID:       roomID,
					NeedDisambig: true,
					Candidates:   cands,
				}, nil
			}
		}
	} else {
		// —— 匿名培训 / 团队协作：保持现状 ——
		displayNickname = s.profanity.Filter(req.Nickname)
		suffix = utils.GenerateSuffix()
		studentUUID = utils.GenerateGuestUUID()
	}

	// BUG-019 修复：建会话前查封禁名单，命中直接拒绝下发会话
	if s.IsStudentBanned(roomID, studentUUID) {
		return nil, fmt.Errorf("您已被移出该房间")
	}

	// 5. 写入 room_sessions 表
	_, err = s.db.Exec(
		`INSERT INTO room_sessions (room_id, student_uuid, nickname, suffix, avatar_id, ip_address)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		roomID, studentUUID, displayNickname, suffix, avatarID, ipAddress,
	)
	if err != nil {
		return nil, fmt.Errorf("创建会话失败: %w", err)
	}

	// 6. 写入 Redis 会话缓存
	sessionData := fmt.Sprintf(`{"room_id":"%s","nickname":"%s","suffix":"%s"}`, roomID, displayNickname, suffix)
	s.rdb.Set(ctx, fmt.Sprintf("session:%s", studentUUID), sessionData, 24*time.Hour)

	// 7. 展示昵称：有后缀/消歧才拼 #
	shown := displayNickname
	if suffix != "" {
		shown = displayNickname + "#" + suffix
	}
	log.Printf("[会话] 学生入场 - 形态:%s UUID:%s 昵称:%s 房间:%s", collabMode, studentUUID, shown, roomID)

	return &models.JoinRoomResponse{
		UUID:     studentUUID,
		Nickname: shown,
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

// BUG-044：踢出（可重连）与封禁（不可重连，除非老师解封）产品语义拍板后拆分——
// 此前 KickMember 无条件调用本函数，导致"踢出"与"封禁"在后端是同一个动作。
// 现在本函数只服务于"封禁"路径（BanMember），"踢出"改走 MarkStudentLeft（见 room_handler.go）。

// BanStudent 封禁学生（拒绝重连，除非老师调用 UnbanStudent 解封）
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

	// 2. 写入 Redis 黑名单（BUG-044：改为永不过期——"封禁"应持续到老师主动解封为止，
	//    此前 24 小时 TTL 会导致学生在老师不知情的情况下自动被解封，与产品语义冲突）
	banKey := fmt.Sprintf("ban:%s:%s", roomID, studentUUID)
	s.rdb.Set(ctx, banKey, "1", 0)

	// 3. 清除 Redis 会话
	s.rdb.Del(ctx, fmt.Sprintf("session:%s", studentUUID))

	log.Printf("[封禁] 学生被封禁(拒绝重连) - UUID:%s 房间:%s", studentUUID, roomID)
	return nil
}

// UnbanStudent 解封学生（老师从黑名单放出来，允许重新加入房间）
func (s *SessionService) UnbanStudent(roomID, studentUUID string) error {
	ctx := context.Background()

	_, err := s.db.Exec(
		`UPDATE room_sessions SET is_banned = FALSE
		 WHERE room_id = $1 AND student_uuid = $2`,
		roomID, studentUUID,
	)
	if err != nil {
		return fmt.Errorf("解封学生失败: %w", err)
	}

	banKey := fmt.Sprintf("ban:%s:%s", roomID, studentUUID)
	s.rdb.Del(ctx, banKey)

	log.Printf("[解封] 学生被老师解封 - UUID:%s 房间:%s", studentUUID, roomID)
	return nil
}

// GetBannedSessionsByRoom 查询某房间当前被封禁（黑名单）的学生列表，供老师端管理解封
func (s *SessionService) GetBannedSessionsByRoom(roomID string) ([]models.Session, error) {
	// DISTINCT ON + 按 student_uuid 去重：同一学生可能因多次入场/被踢产生多条历史行，
	// 被封禁时 BanStudent 会把该学生名下所有历史行的 is_banned 都置 TRUE，
	// 这里只取每个学生最新的一行，避免黑名单里同一个人出现好几条。
	rows, err := s.db.Query(
		`SELECT id, room_id, student_uuid, nickname, suffix, avatar_id, ip_address, is_banned, joined_at, left_at
		 FROM (
		     SELECT DISTINCT ON (student_uuid)
		            id, room_id, student_uuid, nickname, suffix, avatar_id, ip_address, is_banned, joined_at, left_at
		     FROM room_sessions
		     WHERE room_id = $1 AND is_banned = TRUE
		     ORDER BY student_uuid, joined_at DESC
		 ) dedup
		 ORDER BY left_at DESC NULLS LAST, joined_at DESC`,
		roomID,
	)
	if err != nil {
		return nil, fmt.Errorf("查询封禁名单失败: %w", err)
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
			return nil, fmt.Errorf("扫描封禁会话数据失败: %w", err)
		}
		sessions = append(sessions, sess)
	}
	return sessions, nil
}

// IsStudentBanned 检查学生是否被封禁
// BUG-044：此前只查 Redis，一旦 Redis 因重启等原因丢键，DB 里 is_banned=TRUE 的学生会被
// 静默放行，与"封禁需老师主动解封"的语义相悖。现在 Redis 未命中时回退查库，并在库里确认
// 封禁时自愈写回 Redis 键，兼顾性能与正确性。
func (s *SessionService) IsStudentBanned(roomID, studentUUID string) bool {
	ctx := context.Background()
	banKey := fmt.Sprintf("ban:%s:%s", roomID, studentUUID)
	result, err := s.rdb.Get(ctx, banKey).Result()
	if err == nil {
		return result == "1"
	}

	var isBanned bool
	dbErr := s.db.QueryRow(
		`SELECT is_banned FROM room_sessions WHERE room_id = $1 AND student_uuid = $2
		 ORDER BY joined_at DESC LIMIT 1`,
		roomID, studentUUID,
	).Scan(&isBanned)
	if dbErr != nil {
		return false
	}
	if isBanned {
		s.rdb.Set(ctx, banKey, "1", 0)
	}
	return isBanned
}

// UpdateStudentProfile 学生中途修改昵称/头像（BUG-045）
// 此前 web/src/pages/RoomPage.tsx 的 EditProfileModal.handleSave 只写 localStorage，
// 服务端 room_sessions 与其他成员看到的都还是入场时的旧值。现在真正落库，
// 配合 ws_handler.go 新增的 update_profile/member_profile_updated 消息实时广播。
func (s *SessionService) UpdateStudentProfile(roomID, studentUUID, nickname string, avatarID int, avatarURL string) error {
	nickname = s.profanity.Filter(nickname)
	if nickname == "" {
		return fmt.Errorf("昵称不能为空")
	}
	if avatarID <= 0 {
		avatarID = 1
	}
	_, err := s.db.Exec(
		`UPDATE room_sessions SET nickname = $1, avatar_id = $2, avatar_url = $3
		 WHERE room_id = $4 AND student_uuid = $5`,
		nickname, avatarID, avatarURL, roomID, studentUUID,
	)
	if err != nil {
		return fmt.Errorf("更新学生资料失败: %w", err)
	}
	log.Printf("[资料] 学生更新昵称/头像 - UUID:%s 房间:%s 新昵称:%s", studentUUID, roomID, nickname)
	return nil
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
