// =============================================================
// MindCanvas v4.1 - 房间管理处理器
// REQ-005修复：LockRoom/SetReadOnly/GatherMembers改用BroadcastRaw
//              扁平JSON格式，与ws_handler.go广播格式统一
// 包含：房间CRUD、场控、导出、总结、分组管理、作品下载
// =============================================================
package handlers

import (
	"archive/zip"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"math/rand"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"mindcanvas-server/middleware"
	"mindcanvas-server/models"
	"mindcanvas-server/services"
	"mindcanvas-server/ws"
)

// RoomHandler 房间管理处理器
type RoomHandler struct {
	roomService    *services.RoomService
	sessionService *services.SessionService
	widgetService  *services.WidgetService
	exportService  *services.ExportService
	hub            *ws.Hub
	rdb            *redis.Client
}

// NewRoomHandler 构造函数
func NewRoomHandler(
	roomService *services.RoomService,
	sessionService *services.SessionService,
	widgetService *services.WidgetService,
	exportService *services.ExportService,
	hub *ws.Hub,
	rdb *redis.Client,
) *RoomHandler {
	return &RoomHandler{
		roomService:    roomService,
		sessionService: sessionService,
		widgetService:  widgetService,
		exportService:  exportService,
		hub:            hub,
		rdb:            rdb,
	}
}

// =============================================================
// 房间基础 CRUD
// =============================================================

// ListRooms GET /api/rooms
func (h *RoomHandler) ListRooms(c *gin.Context) {
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)
	rooms, err := h.roomService.ListRooms(userID, role, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rooms": rooms})
}

// CreateRoom POST /api/rooms
func (h *RoomHandler) CreateRoom(c *gin.Context) {
	userID := middleware.GetUserID(c)
	tenantID := middleware.GetTenantID(c)
	var req models.CreateRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}
	room, err := h.roomService.CreateRoom(userID, tenantID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"room": room})
}

// GetRoom GET /api/rooms/:id
func (h *RoomHandler) GetRoom(c *gin.Context) {
	roomID := c.Param("id")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)
	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	room, err := h.roomService.GetRoom(roomID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "房间不存在"})
		return
	}
	elements, err := h.widgetService.GetElementsByRoom(roomID)
	if err != nil {
		elements = []models.Element{}
	}
	c.JSON(http.StatusOK, gin.H{"room": room, "elements": elements})
}

// UpdateRoom PUT /api/rooms/:id
func (h *RoomHandler) UpdateRoom(c *gin.Context) {
	roomID := c.Param("id")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)
	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	var req models.UpdateRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if err := h.roomService.UpdateRoom(roomID, req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}

// DeleteRoom DELETE /api/rooms/:id
func (h *RoomHandler) DeleteRoom(c *gin.Context) {
	roomID := c.Param("id")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)
	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	if err := h.roomService.DeleteRoom(roomID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	go h.cleanupRoomRedisData(roomID)
	c.JSON(http.StatusOK, gin.H{"message": "房间已删除"})
}

// cleanupRoomRedisData 异步清理房间 Redis 数据
func (h *RoomHandler) cleanupRoomRedisData(roomID string) {
	if h.rdb == nil {
		return
	}
	ctx := context.Background()
	sceneKey := "room:scene:" + roomID
	if result, err := h.rdb.Del(ctx, sceneKey).Result(); err != nil {
		log.Printf("[Redis清理] 删除场景快照失败 room:%s err:%v", roomID, err)
	} else if result > 0 {
		log.Printf("[Redis清理] 已删除场景快照 room:%s", roomID)
	}
	banPattern := "ban:" + roomID + ":*"
	var cursor uint64
	for {
		keys, nextCursor, err := h.rdb.Scan(ctx, cursor, banPattern, 100).Result()
		if err != nil {
			break
		}
		if len(keys) > 0 {
			h.rdb.Del(ctx, keys...)
		}
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}
	log.Printf("[Redis清理] 房间 %s 的Redis数据已清理完毕", roomID)
}

// =============================================================
// 场控接口
// REQ-005修复说明：
//   原来使用 hub.BroadcastToRoom(roomID, ws.Message{...}) 发送
//   Message结构序列化后格式为：
//     {"type":"ctrl_lockdown","payload":{"is_locked":false},...}
//   前端useWebSocket读取：msg.is_locked ?? msg.payload?.is_locked
//   当msg.payload是嵌套object时，msg.payload?.is_locked能读到
//   但BroadcastRaw的扁平格式更直接且与ws_handler.go一致
//   修复：改用BroadcastRaw发扁平格式：
//     {"type":"ctrl_lockdown","is_locked":false}
// =============================================================

// LockRoom PUT /api/rooms/:id/lock
// REQ-005修复：改用BroadcastRaw发扁平JSON，锁定和解锁均正确广播
func (h *RoomHandler) LockRoom(c *gin.Context) {
	roomID := c.Param("id")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)
	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	var req models.LockRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if err := h.roomService.SetLocked(roomID, req.IsLocked); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// REQ-005：扁平格式，前端直接读msg.is_locked
	msgBytes, _ := json.Marshal(map[string]interface{}{
		"type":      "ctrl_lockdown",
		"is_locked": req.IsLocked,
	})
	if room := h.hub.GetRoom(roomID); room != nil {
		room.BroadcastRaw(msgBytes)
	}
	c.JSON(http.StatusOK, gin.H{"message": "操作成功", "is_locked": req.IsLocked})
}

// SetReadOnly PUT /api/rooms/:id/readonly
// REQ-005修复：改用BroadcastRaw扁平格式
func (h *RoomHandler) SetReadOnly(c *gin.Context) {
	roomID := c.Param("id")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)
	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	var req models.ReadOnlyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if err := h.roomService.SetReadOnly(roomID, req.IsReadOnly); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// REQ-005：扁平格式
	msgBytes, _ := json.Marshal(map[string]interface{}{
		"type":        "ctrl_readonly",
		"is_readonly": req.IsReadOnly,
	})
	if room := h.hub.GetRoom(roomID); room != nil {
		room.BroadcastRaw(msgBytes)
	}
	c.JSON(http.StatusOK, gin.H{"message": "操作成功", "is_readonly": req.IsReadOnly})
}

// KickMember POST /api/rooms/:id/kick
func (h *RoomHandler) KickMember(c *gin.Context) {
	roomID := c.Param("id")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)
	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	var req models.KickRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if err := h.sessionService.BanStudent(roomID, req.TargetUUID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	reason := req.Reason
	if reason == "" {
		reason = "您已被教师移出房间"
	}
	h.hub.SendToClient(roomID, req.TargetUUID, ws.Message{
		Type:    "ctrl_kick",
		Payload: map[string]interface{}{"reason": reason},
	})
	h.hub.RemoveClient(roomID, req.TargetUUID)
	log.Printf("[场控] 踢出学生 - 房间:%s 学生:%s", roomID, req.TargetUUID)
	c.JSON(http.StatusOK, gin.H{"message": "已踢出"})
}

// GatherMembers POST /api/rooms/:id/gather
// REQ-005修复：改用BroadcastRaw扁平格式，与useWebSocket处理逻辑一致
func (h *RoomHandler) GatherMembers(c *gin.Context) {
	roomID := c.Param("id")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)
	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	var req models.GatherRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	// 扁平格式广播
	msgBytes, _ := json.Marshal(map[string]interface{}{
		"type": "ctrl_gather",
		"payload": map[string]interface{}{
			"viewport_x": req.ViewportX,
			"viewport_y": req.ViewportY,
			"zoom":       req.Zoom,
		},
	})
	if room := h.hub.GetRoom(roomID); room != nil {
		room.BroadcastRaw(msgBytes)
	}
	c.JSON(http.StatusOK, gin.H{"message": "召集指令已发送"})
}

// ListMembers GET /api/rooms/:id/members
func (h *RoomHandler) ListMembers(c *gin.Context) {
	roomID := c.Param("id")
	sessions, err := h.sessionService.GetSessionsByRoom(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"members": sessions})
}

// =============================================================
// 导出与总结接口
// =============================================================

// ExportData GET /api/rooms/:id/export
func (h *RoomHandler) ExportData(c *gin.Context) {
	roomID := c.Param("id")
	exportType := c.DefaultQuery("type", "all")
	elementID := c.DefaultQuery("element_id", "")
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=mindcanvas_export.csv")
	if err := h.exportService.ExportInteractions(c.Writer, roomID, exportType, elementID); err != nil {
		log.Printf("[导出] 失败: %v", err)
	}
}

// ExportContributions GET /api/rooms/:id/export/contributions
func (h *RoomHandler) ExportContributions(c *gin.Context) {
	roomID := c.Param("id")
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=contributions.csv")
	if err := h.exportService.ExportContributions(c.Writer, roomID); err != nil {
		log.Printf("[导出贡献] 失败: %v", err)
	}
}

// ExportTextContent GET /api/rooms/:id/export/text
func (h *RoomHandler) ExportTextContent(c *gin.Context) {
	roomID := c.Param("id")
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=text_content.csv")
	if err := h.exportService.ExportTextContent(c.Writer, roomID); err != nil {
		log.Printf("[导出文字] 失败: %v", err)
	}
}

// GetSummary GET /api/rooms/:id/summary
func (h *RoomHandler) GetSummary(c *gin.Context) {
	roomID := c.Param("id")
	summary, err := h.exportService.GetSummary(roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, summary)
}

// ExportSummaryMarkdown GET /api/rooms/:id/summary/export
func (h *RoomHandler) ExportSummaryMarkdown(c *gin.Context) {
	roomID := c.Param("id")
	c.Header("Content-Type", "text/markdown; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=summary.md")
	if err := h.exportService.ExportSummaryMarkdown(c.Writer, roomID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// =============================================================
// 分组管理接口
// =============================================================

// ListGroups GET /api/rooms/:id/groups
func (h *RoomHandler) ListGroups(c *gin.Context) {
	roomID := c.Param("id")
	rows, err := h.roomService.DB().QueryContext(
		c.Request.Context(),
		`SELECT id, room_id, name, color, members,
                 COALESCE(leader_uuid,''), COALESCE(sort_order,0),
                 zone_element_id, created_at, updated_at
                 FROM room_groups WHERE room_id=$1 ORDER BY sort_order ASC, created_at ASC`,
		roomID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询分组失败"})
		return
	}
	defer rows.Close()

	type GroupResp struct {
		ID            string    `json:"id"`
		RoomID        string    `json:"room_id"`
		Name          string    `json:"name"`
		Color         string    `json:"color"`
		Members       []string  `json:"members"`
		LeaderUUID    string    `json:"leader_uuid"`
		SortOrder     int       `json:"sort_order"`
		ZoneElementID *string   `json:"zone_element_id,omitempty"`
		CreatedAt     time.Time `json:"created_at"`
		UpdatedAt     time.Time `json:"updated_at"`
	}

	var groups []GroupResp
	for rows.Next() {
		var g GroupResp
		var membersArr []string
		var zoneID *string
		if err := rows.Scan(
			&g.ID, &g.RoomID, &g.Name, &g.Color,
			postgresArray(&membersArr), &g.LeaderUUID, &g.SortOrder, &zoneID, &g.CreatedAt, &g.UpdatedAt,
		); err != nil {
			log.Printf("[分组] 扫描行失败: %v", err)
			continue
		}
		g.Members = membersArr
		if g.Members == nil {
			g.Members = []string{}
		}
		g.ZoneElementID = zoneID
		groups = append(groups, g)
	}
	if groups == nil {
		groups = []GroupResp{}
	}
	c.JSON(http.StatusOK, gin.H{"groups": groups})
}

// CreateGroup POST /api/rooms/:id/groups
func (h *RoomHandler) CreateGroup(c *gin.Context) {
	roomID := c.Param("id")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)
	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	var req struct {
		Name       string   `json:"name" binding:"required"`
		Color      string   `json:"color"`
		Members    []string `json:"members"`
		LeaderUUID string   `json:"leader_uuid"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: name 必填"})
		return
	}
	if req.Color == "" {
		req.Color = "#4472C4"
	}
	if req.Members == nil {
		req.Members = []string{}
	}
	var groupID string
	if err := h.roomService.DB().QueryRowContext(
		c.Request.Context(),
		`INSERT INTO room_groups (room_id, name, color, members, leader_uuid, sort_order)
		 VALUES ($1,$2,$3,$4,$5, (SELECT COALESCE(MAX(sort_order),-1)+1 FROM room_groups WHERE room_id=$1))
		 RETURNING id`,
		roomID, req.Name, req.Color, postgresArray(req.Members), req.LeaderUUID,
	).Scan(&groupID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建分组失败: " + err.Error()})
		return
	}
	msgBytes, _ := json.Marshal(map[string]interface{}{
		"type": "group_update",
		"payload": map[string]interface{}{
			"action": "created", "group_id": groupID,
			"name": req.Name, "color": req.Color, "members": req.Members,
		},
	})
	if room := h.hub.GetRoom(roomID); room != nil {
		room.BroadcastRaw(msgBytes)
	}
	c.JSON(http.StatusCreated, gin.H{"group_id": groupID, "message": "分组创建成功"})
}

// UpdateGroup PATCH /api/rooms/:id/groups/:gid
func (h *RoomHandler) UpdateGroup(c *gin.Context) {
	roomID := c.Param("id")
	groupID := c.Param("gid")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)
	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	var req struct {
		Name       *string  `json:"name"`
		Color      *string  `json:"color"`
		Members    []string `json:"members"`
		LeaderUUID *string  `json:"leader_uuid"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	setClauses := []string{"updated_at = NOW()"}
	args := []interface{}{}
	argIdx := 1
	if req.Name != nil {
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", argIdx))
		args = append(args, *req.Name)
		argIdx++
	}
	if req.Color != nil {
		setClauses = append(setClauses, fmt.Sprintf("color = $%d", argIdx))
		args = append(args, *req.Color)
		argIdx++
	}
	if req.Members != nil {
		setClauses = append(setClauses, fmt.Sprintf("members = $%d", argIdx))
		args = append(args, postgresArray(req.Members))
		argIdx++
	}
	if req.LeaderUUID != nil {
		setClauses = append(setClauses, fmt.Sprintf("leader_uuid = $%d", argIdx))
		args = append(args, *req.LeaderUUID)
		argIdx++
	}
	args = append(args, groupID, roomID)
	query := fmt.Sprintf(
		"UPDATE room_groups SET %s WHERE id=$%d AND room_id=$%d",
		strings.Join(setClauses, ", "), argIdx, argIdx+1,
	)
	if _, err := h.roomService.DB().ExecContext(c.Request.Context(), query, args...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新分组失败: " + err.Error()})
		return
	}
	msgBytes, _ := json.Marshal(map[string]interface{}{
		"type":    "group_update",
		"payload": map[string]interface{}{"action": "updated", "group_id": groupID},
	})
	if room := h.hub.GetRoom(roomID); room != nil {
		room.BroadcastRaw(msgBytes)
	}
	c.JSON(http.StatusOK, gin.H{"message": "分组更新成功"})
}

// DeleteGroup DELETE /api/rooms/:id/groups/:gid
func (h *RoomHandler) DeleteGroup(c *gin.Context) {
	roomID := c.Param("id")
	groupID := c.Param("gid")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)
	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	if _, err := h.roomService.DB().ExecContext(
		c.Request.Context(),
		"DELETE FROM room_groups WHERE id=$1 AND room_id=$2", groupID, roomID,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除分组失败"})
		return
	}
	msgBytes, _ := json.Marshal(map[string]interface{}{
		"type":    "group_update",
		"payload": map[string]interface{}{"action": "deleted", "group_id": groupID},
	})
	if room := h.hub.GetRoom(roomID); room != nil {
		room.BroadcastRaw(msgBytes)
	}
	c.JSON(http.StatusOK, gin.H{"message": "分组已删除"})
}

// AutoGroup POST /api/rooms/:id/groups/auto
// Body: { "mode": "by_groups"|"by_count", "n": int }
func (h *RoomHandler) AutoGroup(c *gin.Context) {
	roomID := c.Param("id")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)
	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	var req struct {
		Mode string `json:"mode"`
		N    int    `json:"n"`
	}
	if err := c.ShouldBindJSON(&req); err != nil ||
		(req.Mode != "by_groups" && req.Mode != "by_count") || req.N < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "mode 须为 by_groups 或 by_count，n 须为正整数"})
		return
	}

	// BUG-002 修复(2026-07-04): 原实现每组单独一次 INSERT...RETURNING 往返数据库，
	// 组数多或数据库瞬时抖动时前端长时间无响应；现改为一个事务+一次批量INSERT，
	// 并加5秒超时，超时快速报错而不是无限挂起。
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	type student struct{ UUID, Name string }
	rows, err := h.roomService.DB().QueryContext(ctx, `
		SELECT DISTINCT ON (student_uuid) student_uuid,
		       CONCAT(nickname, suffix) AS display_name
		FROM room_sessions
		WHERE room_id = $1 AND is_banned = false
		ORDER BY student_uuid, joined_at DESC
	`, roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询学生列表失败: " + err.Error()})
		return
	}
	var students []student
	for rows.Next() {
		var s student
		if rows.Scan(&s.UUID, &s.Name) == nil {
			students = append(students, s)
		}
	}
	rows.Close()
	if len(students) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "房间内暂无学生记录，请先让学生加入房间"})
		return
	}

	rand.Shuffle(len(students), func(i, j int) {
		students[i], students[j] = students[j], students[i]
	})

	groupCount := req.N
	if req.Mode == "by_count" {
		groupCount = (len(students) + req.N - 1) / req.N
	}
	if groupCount > len(students) {
		groupCount = len(students)
	}

	groupColors := []string{
		"#E74C3C", "#3498DB", "#2ECC71", "#F39C12",
		"#9B59B6", "#1ABC9C", "#E67E22", "#34495E",
	}
	chineseNums := []string{"一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五"}
	type groupResult struct {
		ID        string   `json:"id"`
		Name      string   `json:"name"`
		Color     string   `json:"color"`
		Members   []string `json:"members"`
		SortOrder int      `json:"sort_order"`
	}
	newGroups := make([]groupResult, 0, groupCount)

	tx, err := h.roomService.DB().BeginTx(ctx, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "开启事务失败: " + err.Error()})
		return
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, "DELETE FROM room_groups WHERE room_id=$1", roomID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "清除旧分组失败: " + err.Error()})
		return
	}

	valueStrs := make([]string, 0, groupCount)
	args := make([]interface{}, 0, groupCount*5)
	for i := 0; i < groupCount; i++ {
		start := i * len(students) / groupCount
		end := (i + 1) * len(students) / groupCount
		if i == groupCount-1 {
			end = len(students)
		}
		memberUUIDs := make([]string, 0, end-start)
		for _, s := range students[start:end] {
			memberUUIDs = append(memberUUIDs, s.UUID)
		}
		num := i + 1
		name := fmt.Sprintf("第%d组", num)
		if num-1 < len(chineseNums) {
			name = fmt.Sprintf("第%s组", chineseNums[num-1])
		}
		color := groupColors[i%len(groupColors)]

		base := len(args)
		valueStrs = append(valueStrs, fmt.Sprintf("($%d,$%d,$%d,$%d,'',$%d)", base+1, base+2, base+3, base+4, base+5))
		args = append(args, roomID, name, color, postgresArray(memberUUIDs), i)

		newGroups = append(newGroups, groupResult{Name: name, Color: color, Members: memberUUIDs, SortOrder: i})
	}

	insertSQL := fmt.Sprintf(
		`INSERT INTO room_groups (room_id, name, color, members, leader_uuid, sort_order) VALUES %s`,
		strings.Join(valueStrs, ","),
	)
	if _, err := tx.ExecContext(ctx, insertSQL, args...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "批量创建分组失败: " + err.Error()})
		return
	}

	idRows, err := tx.QueryContext(ctx,
		"SELECT id, sort_order FROM room_groups WHERE room_id=$1 ORDER BY sort_order", roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取分组ID失败: " + err.Error()})
		return
	}
	for idRows.Next() {
		var id string
		var so int
		if idRows.Scan(&id, &so) == nil && so >= 0 && so < len(newGroups) {
			newGroups[so].ID = id
		}
	}
	idRows.Close()

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "提交事务失败: " + err.Error()})
		return
	}

	msgBytes, _ := json.Marshal(map[string]interface{}{
		"type": "group_update",
		"payload": map[string]interface{}{
			"action": "auto_assigned",
			"groups": newGroups,
		},
	})
	if room := h.hub.GetRoom(roomID); room != nil {
		room.BroadcastRaw(msgBytes)
	}
	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("已自动创建 %d 个小组，共 %d 名学生", groupCount, len(students)),
		"groups":  newGroups,
	})
}

// =============================================================
// 作品墙接口
// =============================================================

// GetDropzoneSubmissions GET /api/rooms/:id/elements/:eid/submissions
func (h *RoomHandler) GetDropzoneSubmissions(c *gin.Context) {
	roomID := c.Param("id")
	elementID := c.Param("eid")
	var count int
	if err := h.roomService.DB().QueryRowContext(
		c.Request.Context(),
		`SELECT COUNT(*) FROM room_elements WHERE id=$1 AND room_id=$2 AND is_deleted=FALSE`,
		elementID, roomID,
	).Scan(&count); err != nil || count == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "作品收集区不存在"})
		return
	}
	submissions, err := h.widgetService.GetDropzoneSubmissions(elementID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if submissions == nil {
		submissions = []map[string]interface{}{}
	}
	c.JSON(http.StatusOK, gin.H{"submissions": submissions, "total": len(submissions)})
}

// DownloadDropzoneZip GET /api/rooms/:id/elements/:eid/download
func (h *RoomHandler) DownloadDropzoneZip(c *gin.Context) {
	roomID := c.Param("id")
	elementID := c.Param("eid")
	groupBy := c.DefaultQuery("group_by", "student")
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	tenantID := middleware.GetTenantID(c)
	if err := h.roomService.CheckRoomOwnership(roomID, userID, role, tenantID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	submissions, err := h.widgetService.GetDropzoneSubmissions(elementID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取作品列表失败"})
		return
	}
	if len(submissions) == 0 {
		c.JSON(http.StatusOK, gin.H{"message": "暂无作品可下载"})
		return
	}
	roomTitle := "作品"
	h.roomService.DB().QueryRowContext(
		c.Request.Context(), "SELECT title FROM rooms WHERE id=$1", roomID,
	).Scan(&roomTitle)

	zipFileName := fmt.Sprintf("作品_%s_%s.zip",
		sanitizeFileName(roomTitle), time.Now().Format("20060102_1504"))
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition",
		fmt.Sprintf(`attachment; filename*=UTF-8''%s`, url.PathEscape(zipFileName)))

	zipWriter := zip.NewWriter(c.Writer)
	defer zipWriter.Close()

	csvRows := [][]string{
		{"序号", "学生姓名", "分组ID", "内容类型", "文件名/内容摘要", "提交时间", "点赞数", "标签", "是否置顶"},
	}
	fileNameCount := make(map[string]int)

	for idx, sub := range submissions {
		studentName := fmt.Sprintf("%v", getMapVal(sub, "student_name", "匿名"))
		groupID := fmt.Sprintf("%v", getMapVal(sub, "group_id", ""))
		contentType := fmt.Sprintf("%v", getMapVal(sub, "content_type", "text"))
		content := fmt.Sprintf("%v", getMapVal(sub, "content", ""))
		submittedAt := fmt.Sprintf("%v", getMapVal(sub, "submitted_at", ""))
		likes := fmt.Sprintf("%v", getMapVal(sub, "likes", 0))
		pinned := fmt.Sprintf("%v", getMapVal(sub, "pinned", false))

		tagsStr := ""
		if tags, ok := sub["tags"].([]interface{}); ok {
			tagStrs := make([]string, 0, len(tags))
			for _, t := range tags {
				tagStrs = append(tagStrs, fmt.Sprintf("%v", t))
			}
			tagsStr = strings.Join(tagStrs, "|")
		}

		var dirPath string
		switch groupBy {
		case "group":
			groupName := "未分组"
			if groupID != "" && groupID != "<nil>" {
				h.roomService.DB().QueryRowContext(
					c.Request.Context(),
					"SELECT name FROM room_groups WHERE id=$1", groupID,
				).Scan(&groupName)
			}
			dirPath = sanitizeFileName(groupName) + "/" + sanitizeFileName(studentName)
		default:
			dirPath = sanitizeFileName(studentName)
		}

		var fileName string
		var fileContent []byte
		var isLocalFile bool
		var localPath string

		switch contentType {
		case "text":
			fileName = fmt.Sprintf("%02d_文字作品.txt", idx+1)
			fileContent = []byte(content)
		case "image", "document", "spreadsheet", "presentation", "archive", "audio", "code", "file":
			localPath = urlToLocalPath(content)
			if localPath != "" {
				isLocalFile = true
				origName := ""
				h.roomService.DB().QueryRowContext(
					c.Request.Context(),
					"SELECT original_name FROM room_files WHERE url=$1 LIMIT 1", content,
				).Scan(&origName)
				if origName != "" {
					fileName = fmt.Sprintf("%02d_%s", idx+1, origName)
				} else {
					fileName = fmt.Sprintf("%02d_%s", idx+1, filepath.Base(localPath))
				}
			}
		case "link":
			fileName = fmt.Sprintf("%02d_链接.txt", idx+1)
			fileContent = []byte(fmt.Sprintf("链接：%s\n提交者：%s\n时间：%s",
				content, studentName, submittedAt))
		}

		if fileName != "" {
			zipPath := dirPath + "/" + deduplicateFileName(fileNameCount, dirPath+"/"+fileName)
			if isLocalFile && localPath != "" {
				f, openErr := os.Open(localPath)
				if openErr != nil {
					csvRows = append(csvRows, []string{
						fmt.Sprintf("%d", idx+1), studentName, groupID, contentType,
						"[文件丢失]", submittedAt, likes, tagsStr, pinned,
					})
					continue
				}
				if ze, err := zipWriter.Create(zipPath); err == nil {
					io.Copy(ze, f)
				}
				f.Close()
			} else if fileContent != nil {
				if ze, err := zipWriter.Create(zipPath); err == nil {
					ze.Write(fileContent)
				}
			}
		}

		displayContent := content
		if len([]rune(displayContent)) > 80 {
			runes := []rune(displayContent)
			displayContent = string(runes[:80]) + "..."
		}
		csvRows = append(csvRows, []string{
			fmt.Sprintf("%d", idx+1), studentName, groupID, contentType,
			displayContent, submittedAt, likes, tagsStr, pinned,
		})
	}

	if csvEntry, err := zipWriter.Create("index.csv"); err == nil {
		csvEntry.Write([]byte{0xEF, 0xBB, 0xBF})
		csvWriter := csv.NewWriter(csvEntry)
		csvWriter.WriteAll(csvRows)
		csvWriter.Flush()
	}
	log.Printf("[ZIP下载] 完成 room:%s element:%s 作品数:%d", roomID, elementID, len(submissions))
}

// =============================================================
// 工具函数
// =============================================================

func sanitizeFileName(name string) string {
	r := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_", "*", "_",
		"?", "_", "\"", "_", "<", "_", ">", "_",
		"|", "_", " ", "_",
	)
	result := r.Replace(name)
	if result == "" {
		result = "未命名"
	}
	runes := []rune(result)
	if len(runes) > 50 {
		result = string(runes[:50])
	}
	return result
}

func urlToLocalPath(accessURL string) string {
	if !strings.HasPrefix(accessURL, "/uploads/") {
		return ""
	}
	return "/opt/mindcanvas" + accessURL
}

func deduplicateFileName(counter map[string]int, fullPath string) string {
	base := filepath.Base(fullPath)
	counter[fullPath]++
	if counter[fullPath] == 1 {
		return base
	}
	ext := filepath.Ext(base)
	name := strings.TrimSuffix(base, ext)
	return fmt.Sprintf("%s_%d%s", name, counter[fullPath]-1, ext)
}

func getMapVal(m map[string]interface{}, key string, defaultVal interface{}) interface{} {
	if v, ok := m[key]; ok && v != nil {
		return v
	}
	return defaultVal
}
