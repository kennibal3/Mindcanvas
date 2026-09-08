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
	"os"
	"path/filepath"

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
	max_capacity, status, room_mode, collab_mode, created_at, updated_at, finished_at, class_id`

// scanRoom 统一的行扫描方法
func scanRoom(scanner interface{ Scan(...interface{}) error }) (*models.Room, error) {
	room := &models.Room{}
	err := scanner.Scan(
		&room.ID, &room.TeacherID, &room.TenantID, &room.Title,
		&room.InviteCode, &room.IsLocked, &room.IsReadOnly,
		&room.MaxCapacity, &room.Status, &room.RoomMode, &room.CollabMode,
		&room.CreatedAt, &room.UpdatedAt, &room.FinishedAt, &room.ClassID,
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

	// 协作形态（身份/权限维度）：空或非法值默认 anonymous（＝保持现状）
	collabMode := req.CollabMode
	switch collabMode {
	case models.CollabModeRoster, models.CollabModeAnonymous, models.CollabModeTeam:
		// 合法值，保持不变
	default:
		collabMode = models.CollabModeAnonymous
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

	// REQ-045：仅 roster 形态绑定班级，且班级须归当前教师所有
	var classIDArg interface{} = nil
	if collabMode == models.CollabModeRoster && req.ClassID != "" {
		var owner string
		e := s.db.QueryRow(`SELECT teacher_id FROM classes WHERE id=$1`, req.ClassID).Scan(&owner)
		if e == sql.ErrNoRows {
			return nil, fmt.Errorf("绑定的班级不存在")
		}
		if e != nil {
			return nil, fmt.Errorf("查询班级失败: %w", e)
		}
		if owner != teacherID {
			return nil, fmt.Errorf("无权绑定他人班级")
		}
		classIDArg = req.ClassID
	}

	// 插入房间记录
	room, err := scanRoom(s.db.QueryRow(
		`INSERT INTO rooms (teacher_id, tenant_id, title, invite_code, max_capacity, room_mode, collab_mode, class_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING `+roomSelectFields,
		teacherID, tenantID, req.Title, inviteCode, maxCapacity, roomMode, collabMode, classIDArg,
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

// =============================================================
// BUG-025（2026-09-08）：删除房间的影响面预检与安全删除
//
// 【为什么需要这一整段】
// 原实现是裸的 `DELETE FROM rooms WHERE id = $1`，把一切交给数据库 CASCADE。
// 但 CASCADE 有两件事做不到：
//   ① 它跑不了应用逻辑——courseware_packages 的行被级联删掉了，
//      /opt/mindcanvas/courseware/<包id>/ 目录却永远留在磁盘上，无人引用无从回收；
//   ② 它分不清「这个房间自己的数据」和「另一个功能域的资产」——
//      assignments 挂在 rooms 上也是 CASCADE，其下又有 10 张 CASCADE 表，
//      于是老师点一下垃圾桶，关联作业 + 每个学生的提交 + 讲评报告 + 个性化补救
//      会一起消失，而确认文案只说了一句「所有数据将被清除」。
//
// 【外键从 007 就在，为什么现在才炸】
// REQ-048（2026-07-21）之前 assignments.room_id 恒为空（全站没有入口能绑），
// 那个下拉做出来的那一刻这条链才活。**新增「把 A 绑到 B 上」的入口时，
// 必须回头看 A→B 那条外键的 ON DELETE 是什么**——这颗雷是我们自己埋的。
// =============================================================

// RoomDeletionImpact 删除房间会波及到的、**不属于「房间自己的数据」**的资产。
// A 类（room_elements/room_scenes/room_shares/shelf_cards/html_widget_contents 等
// 九张）随房间消失是老师预期内的，不在这里统计，也不需要额外确认。
type RoomDeletionImpact struct {
	Assignments     int   `json:"assignments"`      // 关联作业数（将被解绑保留，不删）
	Courseware      int   `json:"courseware"`       // 课件包数（将被连库带盘删除）
	CoursewareBytes int64 `json:"courseware_bytes"` // 课件包解压后总字节

	coursewareIDs []string // 内部用：磁盘目录名＝包 id，删库后就查不到了，必须先取
}

// NeedsConfirm 是否需要老师明确确认。
// **默认安全**（吸取 BUG-015）：判定放在服务端，不指望前端记得先问；
// 任何未来的调用方（脚本、别的前端）不带 confirm 都会被拦。
func (i *RoomDeletionImpact) NeedsConfirm() bool {
	return i.Assignments > 0 || i.Courseware > 0
}

// GetRoomDeletionImpact 查询删除该房间会波及的跨域资产。
// 只读，不改任何东西；handler 用它决定要不要返 409。
func (s *RoomService) GetRoomDeletionImpact(roomID string) (*RoomDeletionImpact, error) {
	impact := &RoomDeletionImpact{}

	if err := s.db.QueryRow(
		`SELECT count(*) FROM assignments WHERE room_id = $1`, roomID,
	).Scan(&impact.Assignments); err != nil {
		return nil, fmt.Errorf("统计关联作业失败: %w", err)
	}

	rows, err := s.db.Query(
		`SELECT id, total_bytes FROM courseware_packages WHERE room_id = $1`, roomID)
	if err != nil {
		return nil, fmt.Errorf("统计关联课件包失败: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var bytes int64
		if err := rows.Scan(&id, &bytes); err != nil {
			return nil, fmt.Errorf("读取课件包失败: %w", err)
		}
		impact.coursewareIDs = append(impact.coursewareIDs, id)
		impact.CoursewareBytes += bytes
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历课件包失败: %w", err)
	}
	impact.Courseware = len(impact.coursewareIDs)

	return impact, nil
}

// DeleteRoom 删除房间。
//
// 顺序是本函数的全部要点，不要调换：
//  1. 先取课件包 id 列表——删完库就查不到了，磁盘目录名就此失联；
//  2. 事务内「解绑作业 + 删房间」，DB 层原子；
//  3. **提交成功之后**才删磁盘，失败只记 WARN。
//
// 这样最坏情况是「库删了、盘还在」（＝一个可以事后对账清掉的孤儿目录），
// 而绝不会出现「盘删了、库没删」——后者才是真丢数据。与 BUG-020「先留档再删」同源。
func (s *RoomService) DeleteRoom(roomID string) error {
	impact, err := s.GetRoomDeletionImpact(roomID)
	if err != nil {
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("删除房间失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }() // 已 Commit 后再 Rollback 是 no-op

	// 作业解绑保留：room_id 本就可空，置 NULL 即保住作业与全部学生提交。
	// **刻意不提供「连作业一起删」的选项**——不把一个不可逆的危险动作
	// 摆在删房间的路上（BUG-023 / 8-11 事故反复教训的那类设计）。
	// 老师真要删作业，作业列表里本就有入口。
	res, err := tx.Exec(
		`UPDATE assignments SET room_id = NULL, updated_at = NOW() WHERE room_id = $1`, roomID)
	if err != nil {
		return fmt.Errorf("解绑关联作业失败: %w", err)
	}
	unbound, _ := res.RowsAffected()

	result, err := tx.Exec("DELETE FROM rooms WHERE id = $1", roomID)
	if err != nil {
		return fmt.Errorf("删除房间失败: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("房间不存在")
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("删除房间提交失败: %w", err)
	}

	log.Printf("[房间] 已删除 - ID:%s 解绑作业:%d 待清课件包:%d",
		roomID, unbound, impact.Courseware)

	// 磁盘清理放在提交之后，尽力而为。courseware_packages 的行已随 CASCADE 消失，
	// 这里只补 CASCADE 做不到的那一半。删不掉只留 WARN，不让它把已成功的删除变成报错。
	for _, id := range impact.coursewareIDs {
		dir := filepath.Join(CoursewareRoot, id)
		if err := os.RemoveAll(dir); err != nil {
			log.Printf("[房间] ⚠️ 课件包目录删除失败（已成孤儿，需事后对账清理）%s: %v", dir, err)
			continue
		}
		log.Printf("[房间] 已清课件包目录 %s", dir)
	}

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
