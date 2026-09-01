// =============================================================
// MindCanvas v3.0 - 管理后台处理器
// 功能：租户 CRUD、用户 CRUD（四级角色管理）
// 权限：superadmin 管全部，admin 管本租户
// 新增（需求5）：房间统计接口 GET /api/admin/room-stats
// =============================================================
package handlers

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"mindcanvas-server/middleware"
	"mindcanvas-server/models"
	"mindcanvas-server/utils"
)

// AdminHandler 管理后台处理器
type AdminHandler struct {
	db *sql.DB
}

// NewAdminHandler 创建管理后台处理器
func NewAdminHandler(db *sql.DB) *AdminHandler {
	return &AdminHandler{db: db}
}

// CreateTenant 创建租户
// POST /api/admin/tenants
func (h *AdminHandler) CreateTenant(c *gin.Context) {
	var req models.CreateTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误", "message": "租户名称不能为空"})
		return
	}

	// 默认值
	if req.MaxTeachers <= 0 {
		req.MaxTeachers = 50
	}
	if req.MaxRooms <= 0 {
		req.MaxRooms = 100
	}

	var tenant models.Tenant
	err := h.db.QueryRow(
		`INSERT INTO tenants (name, max_teachers, max_rooms) VALUES ($1, $2, $3)
                 RETURNING id, name, max_teachers, max_rooms, is_active, created_at`,
		req.Name, req.MaxTeachers, req.MaxRooms,
	).Scan(&tenant.ID, &tenant.Name, &tenant.MaxTeachers, &tenant.MaxRooms, &tenant.IsActive, &tenant.CreatedAt)

	if err != nil {
		log.Printf("[管理] 创建租户失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}

	log.Printf("[管理] 租户创建成功 - ID:%s 名称:%s", tenant.ID, tenant.Name)
	c.JSON(http.StatusCreated, gin.H{"tenant": tenant})
}

// ListTenants 租户列表
// GET /api/admin/tenants
func (h *AdminHandler) ListTenants(c *gin.Context) {
	rows, err := h.db.Query(
		`SELECT id, name, max_teachers, max_rooms, is_active, created_at
                 FROM tenants ORDER BY created_at DESC`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	defer rows.Close()

	var tenants []models.Tenant
	for rows.Next() {
		var t models.Tenant
		rows.Scan(&t.ID, &t.Name, &t.MaxTeachers, &t.MaxRooms, &t.IsActive, &t.CreatedAt)
		tenants = append(tenants, t)
	}

	c.JSON(http.StatusOK, gin.H{"tenants": tenants})
}

// UpdateTenant 更新租户
// PUT /api/admin/tenants/:id
func (h *AdminHandler) UpdateTenant(c *gin.Context) {
	tenantID := c.Param("id")
	var req models.UpdateTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	if req.IsActive != nil {
		h.db.Exec("UPDATE tenants SET is_active = $1 WHERE id = $2", *req.IsActive, tenantID)
	}
	if req.Name != nil {
		h.db.Exec("UPDATE tenants SET name = $1 WHERE id = $2", *req.Name, tenantID)
	}
	if req.MaxTeachers != nil {
		h.db.Exec("UPDATE tenants SET max_teachers = $1 WHERE id = $2", *req.MaxTeachers, tenantID)
	}
	if req.MaxRooms != nil {
		h.db.Exec("UPDATE tenants SET max_rooms = $1 WHERE id = $2", *req.MaxRooms, tenantID)
	}

	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}

// CreateUser 创建用户（管理员/教师）
// POST /api/admin/users
func (h *AdminHandler) CreateUser(c *gin.Context) {
	var req models.CreateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误", "message": "用户名、密码和角色为必填"})
		return
	}

	if err := utils.ValidateUsername(req.Username); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "用户名格式错误", "message": err.Error()})
		return
	}

	if err := utils.ValidatePassword(req.Password); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "密码格式错误", "message": err.Error()})
		return
	}

	if err := utils.ValidateRole(req.Role); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "角色错误", "message": err.Error()})
		return
	}

	currentRole := middleware.GetRole(c)
	if currentRole == "admin" && req.Role == "superadmin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "权限不足", "message": "管理员不能创建超级管理员"})
		return
	}

	if currentRole == "admin" && req.Role == "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "权限不足", "message": "管理员不能创建其他管理员"})
		return
	}

	if currentRole == "admin" {
		userTenantID := middleware.GetTenantID(c)
		if req.TenantID != userTenantID {
			c.JSON(http.StatusForbidden, gin.H{"error": "权限不足", "message": "只能在本租户下创建用户"})
			return
		}
	}

	if req.Role != "superadmin" && req.TenantID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误", "message": "非超管角色必须指定租户"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}

	creatorID := middleware.GetUserID(c)
	displayName := req.DisplayName
	if displayName == "" {
		displayName = req.Username
	}

	var userID string
	var tenantIDParam interface{}
	if req.Role == "superadmin" {
		tenantIDParam = nil
	} else {
		tenantIDParam = req.TenantID
	}

	err = h.db.QueryRow(
		`INSERT INTO users (tenant_id, username, password, display_name, role, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id`,
		tenantIDParam, req.Username, string(hashedPassword), displayName, req.Role, creatorID,
	).Scan(&userID)

	if err != nil {
		log.Printf("[管理] 创建用户失败: %v", err)
		c.JSON(http.StatusConflict, gin.H{"error": "创建失败", "message": "用户名可能已存在"})
		return
	}

	log.Printf("[管理] 用户创建成功 - ID:%s 用户名:%s 角色:%s", userID, req.Username, req.Role)
	c.JSON(http.StatusCreated, gin.H{
		"message": "用户创建成功",
		"user": gin.H{
			"id":           userID,
			"username":     req.Username,
			"display_name": displayName,
			"role":         req.Role,
			"tenant_id":    req.TenantID,
		},
	})
}

// ListUsers 用户列表
// GET /api/admin/users
func (h *AdminHandler) ListUsers(c *gin.Context) {
	currentRole := middleware.GetRole(c)
	currentTenantID := middleware.GetTenantID(c)

	var rows *sql.Rows
	var err error

	if currentRole == "superadmin" {
		rows, err = h.db.Query(
			`SELECT u.id, u.tenant_id, u.username, u.display_name, u.role, u.is_active, u.created_at,
                                COALESCE(t.name, '') as tenant_name, COALESCE(u.chat_enabled, false) as chat_enabled, COALESCE(u.agent_enabled, false) as agent_enabled
                         FROM users u LEFT JOIN tenants t ON u.tenant_id = t.id
                         ORDER BY u.created_at DESC`,
		)
	} else {
		rows, err = h.db.Query(
			`SELECT u.id, u.tenant_id, u.username, u.display_name, u.role, u.is_active, u.created_at,
                                COALESCE(t.name, '') as tenant_name, COALESCE(u.chat_enabled, false) as chat_enabled, COALESCE(u.agent_enabled, false) as agent_enabled
                         FROM users u LEFT JOIN tenants t ON u.tenant_id = t.id
                         WHERE u.tenant_id = $1
                         ORDER BY u.created_at DESC`,
			currentTenantID,
		)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	defer rows.Close()

	type UserWithTenant struct {
		models.User
		TenantName string `json:"tenant_name"`
                ChatEnabled bool   `json:"chat_enabled"`
		AgentEnabled bool  `json:"agent_enabled"`
	}

	var users []UserWithTenant
	for rows.Next() {
		var u UserWithTenant
		var tenantID sql.NullString
		rows.Scan(&u.ID, &tenantID, &u.Username, &u.DisplayName, &u.Role, &u.IsActive, &u.CreatedAt, &u.TenantName, &u.ChatEnabled, &u.AgentEnabled)
		if tenantID.Valid {
			u.TenantID = &tenantID.String
		}
		users = append(users, u)
	}

	c.JSON(http.StatusOK, gin.H{"users": users})
}

// UpdateUserStatus 启用/禁用用户
// PUT /api/admin/users/:id/status
func (h *AdminHandler) UpdateUserStatus(c *gin.Context) {
	userID := c.Param("id")
	var req models.UpdateUserStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	currentRole := middleware.GetRole(c)
	if currentRole == "admin" {
		var targetRole string
		h.db.QueryRow("SELECT role FROM users WHERE id = $1", userID).Scan(&targetRole)
		if targetRole == "superadmin" || targetRole == "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "权限不足"})
			return
		}
	}

	_, err := h.db.Exec(
		"UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2",
		req.IsActive, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "状态更新成功"})
}


// UpdateUserChat 开启/关闭用户 AI 对话权限
// PATCH /api/admin/users/:id/chat
func (h *AdminHandler) UpdateUserChat(c *gin.Context) {
	userID := c.Param("id")
	var req struct {
		ChatEnabled bool `json:"chat_enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	_, err := h.db.Exec(
		"UPDATE users SET chat_enabled = $1, updated_at = NOW() WHERE id = $2",
		req.ChatEnabled, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Chat权限更新成功"})
}

// UpdateUserAgent 开启/关闭用户的智能体权限（REQ-062）
// PATCH /api/admin/users/:id/agent
//
// 刻意与 UpdateUserChat 分开：chat_enabled 挂的是「养成类对话 Victoria Chat」，
// 与本功能是两件事。合成一个开关等于「开助手顺带开了养成对话」，
// 而且以后没法分别停用其中一个。
func (h *AdminHandler) UpdateUserAgent(c *gin.Context) {
	userID := c.Param("id")
	var req struct {
		AgentEnabled bool `json:"agent_enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	_, err := h.db.Exec(
		"UPDATE users SET agent_enabled = $1, updated_at = NOW() WHERE id = $2",
		req.AgentEnabled, userID,
	)
	if err != nil {
		log.Printf("[管理] 智能体权限更新失败 user:%s err:%v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	log.Printf("[管理] 智能体权限更新 user:%s enabled:%v", userID, req.AgentEnabled)
	c.JSON(http.StatusOK, gin.H{"message": "智能体权限更新成功"})
}
// =============================================================
// 需求5：房间统计接口
// =============================================================

// TeacherRoomStat 单个教师的房间统计
type TeacherRoomStat struct {
	TeacherID      string     `json:"teacher_id"`
	Username       string     `json:"username"`
	DisplayName    string     `json:"display_name"`
	TenantName     string     `json:"tenant_name"`
	TotalRooms     int        `json:"total_rooms"`
	ActiveRooms    int        `json:"active_rooms"`
	LastActiveAt   *time.Time `json:"last_active_at"`
	LastActiveStr  string     `json:"last_active_str"`
}

// GetRoomStats 获取所有教师的房间统计
// GET /api/admin/room-stats
// 权限：superadmin 看全部，admin 看本租户
func (h *AdminHandler) GetRoomStats(c *gin.Context) {
	currentRole := middleware.GetRole(c)
	currentTenantID := middleware.GetTenantID(c)

	// 按学校筛选（可选 query param）
	filterTenantID := c.Query("tenant_id")

	// 构建查询
	var query string
	var args []interface{}

	baseQuery := `
		SELECT
			u.id                              AS teacher_id,
			u.username,
			u.display_name,
			COALESCE(t.name, '无机构')         AS tenant_name,
			COUNT(r.id)                       AS total_rooms,
			COUNT(CASE WHEN r.status = 'active' THEN 1 END) AS active_rooms,
			MAX(r.updated_at)                 AS last_active_at
		FROM users u
		LEFT JOIN tenants t  ON u.tenant_id = t.id
		LEFT JOIN rooms r    ON r.teacher_id = u.id
		WHERE u.role = 'teacher' AND u.is_active = TRUE
	`

	if currentRole == "superadmin" {
		if filterTenantID != "" {
			query = baseQuery + " AND u.tenant_id = $1 GROUP BY u.id, t.name ORDER BY total_rooms DESC"
			args = []interface{}{filterTenantID}
		} else {
			query = baseQuery + " GROUP BY u.id, t.name ORDER BY total_rooms DESC"
		}
	} else {
		// admin 只看本租户
		query = baseQuery + " AND u.tenant_id = $1 GROUP BY u.id, t.name ORDER BY total_rooms DESC"
		args = []interface{}{currentTenantID}
	}

	rows, err := h.db.QueryContext(c.Request.Context(), query, args...)
	if err != nil {
		log.Printf("[管理] 查询房间统计失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	defer rows.Close()

	var stats []TeacherRoomStat
	for rows.Next() {
		var s TeacherRoomStat
		var lastActive sql.NullTime
		if err := rows.Scan(
			&s.TeacherID, &s.Username, &s.DisplayName, &s.TenantName,
			&s.TotalRooms, &s.ActiveRooms, &lastActive,
		); err != nil {
			log.Printf("[管理] 扫描房间统计行失败: %v", err)
			continue
		}
		if lastActive.Valid {
			t := lastActive.Time
			s.LastActiveAt = &t
			s.LastActiveStr = t.Format("2006-01-02 15:04")
		} else {
			s.LastActiveStr = "暂无活动"
		}
		stats = append(stats, s)
	}

	if stats == nil {
		stats = []TeacherRoomStat{}
	}

	c.JSON(http.StatusOK, gin.H{
		"stats": stats,
		"total": len(stats),
	})
}

// GetTeacherRooms 获取指定教师的房间列表
// GET /api/admin/room-stats/:teacher_id/rooms
func (h *AdminHandler) GetTeacherRooms(c *gin.Context) {
	teacherID := c.Param("teacher_id")
	currentRole := middleware.GetRole(c)
	currentTenantID := middleware.GetTenantID(c)

	// admin 只能查本租户教师
	if currentRole == "admin" {
		var teacherTenantID string
		err := h.db.QueryRowContext(
			c.Request.Context(),
			"SELECT COALESCE(tenant_id::text, '') FROM users WHERE id = $1",
			teacherID,
		).Scan(&teacherTenantID)
		if err != nil || teacherTenantID != currentTenantID {
			c.JSON(http.StatusForbidden, gin.H{"error": "无权查看该教师信息"})
			return
		}
	}

	rows, err := h.db.QueryContext(
		c.Request.Context(),
		`SELECT id, title, invite_code, status, is_locked, max_capacity, created_at, updated_at
		 FROM rooms WHERE teacher_id = $1 ORDER BY updated_at DESC`,
		teacherID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	defer rows.Close()

	type RoomRow struct {
		ID          string    `json:"id"`
		Title       string    `json:"title"`
		InviteCode  string    `json:"invite_code"`
		Status      string    `json:"status"`
		IsLocked    bool      `json:"is_locked"`
		MaxCapacity int       `json:"max_capacity"`
		CreatedAt   time.Time `json:"created_at"`
		UpdatedAt   time.Time `json:"updated_at"`
	}

	var rooms []RoomRow
	for rows.Next() {
		var r RoomRow
		if err := rows.Scan(
			&r.ID, &r.Title, &r.InviteCode, &r.Status, &r.IsLocked, &r.MaxCapacity,
			&r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			continue
		}
		rooms = append(rooms, r)
	}
	if rooms == nil {
		rooms = []RoomRow{}
	}

	c.JSON(http.StatusOK, gin.H{"rooms": rooms, "total": len(rooms)})
}

// ExportRoomStatsCSV 导出房间统计为 CSV
// GET /api/admin/room-stats/export
func (h *AdminHandler) ExportRoomStatsCSV(c *gin.Context) {
	currentRole := middleware.GetRole(c)
	currentTenantID := middleware.GetTenantID(c)

	var query string
	var args []interface{}

	baseQuery := `
		SELECT
			u.username,
			u.display_name,
			COALESCE(t.name, '无机构') AS tenant_name,
			COUNT(r.id)              AS total_rooms,
			COUNT(CASE WHEN r.status = 'active' THEN 1 END) AS active_rooms,
			COALESCE(MAX(r.updated_at)::text, '暂无活动') AS last_active_at
		FROM users u
		LEFT JOIN tenants t ON u.tenant_id = t.id
		LEFT JOIN rooms r   ON r.teacher_id = u.id
		WHERE u.role = 'teacher' AND u.is_active = TRUE
	`

	if currentRole == "superadmin" {
		query = baseQuery + " GROUP BY u.id, t.name ORDER BY total_rooms DESC"
	} else {
		query = baseQuery + " AND u.tenant_id = $1 GROUP BY u.id, t.name ORDER BY total_rooms DESC"
		args = []interface{}{currentTenantID}
	}

	rows, err := h.db.QueryContext(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	defer rows.Close()

	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf(
		`attachment; filename="room_stats_%s.csv"`,
		time.Now().Format("20060102_1504"),
	))

	// UTF-8 BOM，兼容 Excel
	c.Writer.Write([]byte{0xEF, 0xBB, 0xBF})

	w := csv.NewWriter(c.Writer)
	defer w.Flush()

	// 表头
	w.Write([]string{"用户名", "显示名称", "所属机构", "房间总数", "活跃房间数", "最近活跃时间"})

	for rows.Next() {
		var username, displayName, tenantName, lastActive string
		var total, active int
		rows.Scan(&username, &displayName, &tenantName, &total, &active, &lastActive)
		w.Write([]string{
			username,
			displayName,
			tenantName,
			fmt.Sprintf("%d", total),
			fmt.Sprintf("%d", active),
			lastActive,
		})
	}
}
