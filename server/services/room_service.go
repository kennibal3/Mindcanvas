// =============================================================
// MindCanvas v4.1 - 房间业务服务
// 功能：房间 CRUD、邀请码生成、状态管理、租户隔离
// 变更：创建房间默认 room_mode 改为 interactive（移除前端模式选择后统一默认值）
// =============================================================
package services

import (
	"database/sql"
	"fmt"
	"log"

	"mindcanvas-server/models"
	"mindcanvas-server/utils"
)

// RoomService 房间业务服务
type RoomService struct {
	db *sql.DB
}

// NewRoomService 创建房间服务实例
func NewRoomService(db *sql.DB) *RoomService {
	return &RoomService{db: db}
}

// DB 返回底层数据库连接（供 handler 层直接执行分组等扩展查询）
func (s *RoomService) DB() *sql.DB {
	return s.db
}

// roomSelectFields 统一的 SELECT 字段列表（含 room_mode）
const roomSelectFields = `id, teacher_id, tenant_id, title, invite_code, is_locked, is_readonly,
	max_capacity, status, room_mode, created_at, updated_at, finished_at`

// scanRoom 统一的行扫描方法
func scanRoom(scanner interface{ Scan(...interface{}) error }) (*models.Room, error) {
	room := &models.Room{}
	err := scanner.Scan(
		&room.ID, &room.TeacherID, &room.TenantID, &room.Title,
		&room.InviteCode, &room.IsLocked, &room.IsReadOnly,
		&room.MaxCapacity, &room.Status, &room.RoomMode,
		&room.CreatedAt, &room.UpdatedAt, &room.FinishedAt,
	)
	return room, err
}

// CreateRoom 创建房间（供 handler 调用，接收 CreateRoomRequest）
func (s *RoomService) CreateRoom(teacherID, tenantID string, req models.CreateRoomRequest) (*models.Room, error) {
	// 容量校验和默认值
	maxCapacity := req.MaxCapacity
	if maxCapacity <= 0 {
		maxCapacity = 50
	}
	if maxCapacity > 200 {
		maxCapacity = 200
	}

	// ⭐ 默认模式改为 interactive（前端不再强制选择模式，统一全功能）
	roomMode := req.RoomMode
	if roomMode == "" {
		roomMode = models.RoomModeInteractive
	}
	switch roomMode {
	case models.RoomModeWhiteboard, models.RoomModeCards, models.RoomModeInteractive:
		// 合法值，保持不变
	default:
		// 非法值时默认 interactive
		roomMode = models.RoomModeInteractive
	}

	// 查询租户的最大房间数限制
	var maxRooms int
	err := s.db.QueryRow(
		"SELECT max_rooms FROM tenants WHERE id = $1 AND is_active = TRUE",
		tenantID,
	).Scan(&maxRooms)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("租户不存在或已被禁用")
	}
	if err != nil {
		return nil, fmt.Errorf("查询租户信息失败: %w", err)
	}

	// 查询当前活跃房间数
	var currentCount int
	if err = s.db.QueryRow(
		"SELECT COUNT(*) FROM rooms WHERE tenant_id = $1 AND status = 'active'",
		tenantID,
	).Scan(&currentCount); err != nil {
		return nil, fmt.Errorf("查询房间数量失败: %w", err)
	}
	if currentCount >= maxRooms {
		return nil, fmt.Errorf("该租户活跃房间数已达上限(%d/%d)", currentCount, maxRooms)
	}

	// 生成唯一邀请码（最多尝试5次）
	var inviteCode string
	for i := 0; i < 5; i++ {
		inviteCode = utils.GenerateInviteCode()
		var exists bool
		if err := s.db.QueryRow(
			"SELECT EXISTS(SELECT 1 FROM rooms WHERE invite_code = $1)", inviteCode,
		).Scan(&exists); err != nil {
			return nil, fmt.Errorf("检查邀请码失败: %w", err)
		}
		if !exists {
			break
		}
		if i == 4 {
			return nil, fmt.Errorf("邀请码生成失败，请重试")
		}
	}

	// 插入房间记录
	room, err := scanRoom(s.db.QueryRow(
		`INSERT INTO rooms (teacher_id, tenant_id, title, invite_code, max_capacity, room_mode)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING `+roomSelectFields,
		teacherID, tenantID, req.Title, inviteCode, maxCapacity, roomMode,
	))
	if err != nil {
		return nil, fmt.Errorf("创建房间失败: %w", err)
	}

	log.Printf("[房间] 创建成功 - ID:%s 标题:%s 模式:%s 邀请码:%s (%d/%d)",
		room.ID, room.Title, room.RoomMode, room.InviteCode, currentCount+1, maxRooms)
	return room, nil
}

// GetRoom 根据 ID 获取房间（handler 层调用名称）
func (s *RoomService) GetRoom(roomID string) (*models.Room, error) {
	return s.GetRoomByID(roomID)
}

// GetRoomByID 根据 ID 获取房间（内部调用）
func (s *RoomService) GetRoomByID(roomID string) (*models.Room, error) {
	room, err := scanRoom(s.db.QueryRow(
		`SELECT `+roomSelectFields+` FROM rooms WHERE id = $1`, roomID,
	))
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("房间不存在")
	}
	if err != nil {
		return nil, fmt.Errorf("查询房间失败: %w", err)
	}
	return room, nil
}

// GetRoomByInviteCode 根据邀请码获取房间
func (s *RoomService) GetRoomByInviteCode(code string) (*models.Room, error) {
	room, err := scanRoom(s.db.QueryRow(
		`SELECT `+roomSelectFields+` FROM rooms WHERE invite_code = $1`, code,
	))
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("房间不存在或邀请码无效")
	}
	if err != nil {
		return nil, fmt.Errorf("查询房间失败: %w", err)
	}
	return room, nil
}

// listRoomsQuery 通用列表查询（内部）
func (s *RoomService) listRoomsQuery(where string, args ...interface{}) ([]models.Room, error) {
	query := `SELECT ` + roomSelectFields + ` FROM rooms WHERE ` + where + ` ORDER BY created_at DESC`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("查询房间列表失败: %w", err)
	}
	defer rows.Close()

	var rooms []models.Room
	for rows.Next() {
		room, err := scanRoom(rows)
		if err != nil {
			return nil, fmt.Errorf("扫描房间数据失败: %w", err)
		}
		rooms = append(rooms, *room)
	}
	return rooms, nil
}

// ListRooms 获取房间列表（根据角色区分权限）
func (s *RoomService) ListRooms(userID, role, tenantID string) ([]models.Room, error) {
	switch role {
	case "superadmin":
		return s.listRoomsQuery("1=1")
	case "admin":
		return s.listRoomsQuery("tenant_id = $1", tenantID)
	default: // teacher
		return s.listRoomsQuery("teacher_id = $1", userID)
	}
}

// ListRoomsByTeacher 获取教师的房间列表（兼容旧调用）
func (s *RoomService) ListRoomsByTeacher(teacherID string) ([]models.Room, error) {
	return s.listRoomsQuery("teacher_id = $1", teacherID)
}

// ListRoomsByTenant 获取租户下所有房间（兼容旧调用）
func (s *RoomService) ListRoomsByTenant(tenantID string) ([]models.Room, error) {
	return s.listRoomsQuery("tenant_id = $1", tenantID)
}

// UpdateRoom 更新房间信息（接收 UpdateRoomRequest 值类型）
func (s *RoomService) UpdateRoom(roomID string, req models.UpdateRoomRequest) error {
	room, err := s.GetRoomByID(roomID)
	if err != nil {
		return err
	}

	if req.Title != nil {
		room.Title = *req.Title
	}
	if req.MaxCapacity != nil {
		room.MaxCapacity = *req.MaxCapacity
	}

	if req.ExpiresAt != nil && *req.ExpiresAt != "" {
		_, err = s.db.Exec(
			`UPDATE rooms SET title=$1, max_capacity=$2, finished_at=$3, updated_at=NOW() WHERE id=$4`,
			room.Title, room.MaxCapacity, *req.ExpiresAt, roomID,
		)
	} else if req.ExpiresAt != nil && *req.ExpiresAt == "" {
		_, err = s.db.Exec(
			`UPDATE rooms SET title=$1, max_capacity=$2, finished_at=NULL, updated_at=NOW() WHERE id=$3`,
			room.Title, room.MaxCapacity, roomID,
		)
	} else {
		_, err = s.db.Exec(
			`UPDATE rooms SET title=$1, max_capacity=$2, updated_at=NOW() WHERE id=$3`,
			room.Title, room.MaxCapacity, roomID,
		)
	}
	return err
}

// DeleteRoom 删除房间
func (s *RoomService) DeleteRoom(roomID string) error {
	result, err := s.db.Exec("DELETE FROM rooms WHERE id = $1", roomID)
	if err != nil {
		return fmt.Errorf("删除房间失败: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("房间不存在")
	}
	log.Printf("[房间] 已删除 - ID:%s", roomID)
	return nil
}

// SetLocked 设置锁定状态
func (s *RoomService) SetLocked(roomID string, isLocked bool) error {
	_, err := s.db.Exec(
		"UPDATE rooms SET is_locked = $1, updated_at = NOW() WHERE id = $2",
		isLocked, roomID,
	)
	return err
}

// SetReadOnly 设置只读状态
// 恢复编辑（isReadOnly=false）时同时清除 finished_at
func (s *RoomService) SetReadOnly(roomID string, isReadOnly bool) error {
	if isReadOnly {
		_, err := s.db.Exec(
			`UPDATE rooms SET is_readonly = $1, updated_at = NOW() WHERE id = $2`,
			isReadOnly, roomID,
		)
		return err
	}
	// 恢复编辑：清除 finished_at
	_, err := s.db.Exec(
		`UPDATE rooms SET is_readonly = FALSE, finished_at = NULL, updated_at = NOW() WHERE id = $1`,
		roomID,
	)
	return err
}

// CheckRoomOwnership 检查操作权限（角色隔离）
func (s *RoomService) CheckRoomOwnership(roomID, userID, role, tenantID string) error {
	room, err := s.GetRoomByID(roomID)
	if err != nil {
		return err
	}
	switch role {
	case "superadmin":
		return nil
	case "admin":
		if room.TenantID != tenantID {
			return fmt.Errorf("无权操作其他租户的房间")
		}
		return nil
	case "teacher":
		if room.TeacherID != userID {
			return fmt.Errorf("无权操作其他教师的房间")
		}
		return nil
	default:
		return fmt.Errorf("未知角色")
	}
}
