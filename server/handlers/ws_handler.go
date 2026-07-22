// =============================================================
// MindCanvas v4.1 - WebSocket 处理器
// REQ-003修复：handleWidgetSubmit投票/词云提交后从DB重新读取最新payload广播
// REQ-003核心修复(本轮)：isGuestUUID 识别 guest- 前缀，避免学生被误判为教师而拦截
// REQ-004辅助：member_join广播携带avatar_url
// REQ-005修复：room_handler.go的锁定/只读广播改用BroadcastRaw扁平格式
// V4.3：场景大小保护（>2MB告警，>5MB拒绝）
// =============================================================
package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"

	"mindcanvas-server/config"
	"mindcanvas-server/models"
	"mindcanvas-server/services"
	"mindcanvas-server/utils"
	"mindcanvas-server/ws"
)

// WSHandler WebSocket 处理器
type WSHandler struct {
	db             *sql.DB
	rdb            *redis.Client
	hub            *ws.Hub
	widgetService  *services.WidgetService
	sessionService *services.SessionService
	profanity      *services.ProfanityService
}

// NewWSHandler 构造函数
func NewWSHandler(
	db *sql.DB,
	rdb *redis.Client,
	hub *ws.Hub,
	widgetService *services.WidgetService,
	sessionService *services.SessionService,
	profanity *services.ProfanityService,
) *WSHandler {
	return &WSHandler{
		db:             db,
		rdb:            rdb,
		hub:            hub,
		widgetService:  widgetService,
		sessionService: sessionService,
		profanity:      profanity,
	}
}

// mergeSceneElements 合并增量元素到现有场景
func mergeSceneElements(existing []byte, incoming []byte) []byte {
	existingElements := make(map[string]map[string]interface{})
	var existingFiles map[string]interface{}

	if len(existing) > 2 {
		var existingScene map[string]interface{}
		if err := json.Unmarshal(existing, &existingScene); err == nil {
			if elems, ok := existingScene["elements"].([]interface{}); ok {
				for _, e := range elems {
					if elem, ok := e.(map[string]interface{}); ok {
						if id, ok := elem["id"].(string); ok {
							existingElements[id] = elem
						}
					}
				}
			}
			if files, ok := existingScene["files"].(map[string]interface{}); ok {
				existingFiles = files
			}
		}
	}

	var incomingScene map[string]interface{}
	if err := json.Unmarshal(incoming, &incomingScene); err != nil {
		return incoming
	}

	incomingElems, _ := incomingScene["elements"].([]interface{})
	for _, e := range incomingElems {
		elem, ok := e.(map[string]interface{})
		if !ok {
			continue
		}
		id, ok := elem["id"].(string)
		if !ok {
			continue
		}
		existingElem, exists := existingElements[id]
		if !exists {
			existingElements[id] = elem
			continue
		}
		existingVersion, _ := existingElem["version"].(float64)
		incomingVersion, _ := elem["version"].(float64)
		existingDeleted, _ := existingElem["isDeleted"].(bool)
		incomingDeleted, _ := elem["isDeleted"].(bool)

		if incomingVersion > existingVersion {
			existingElements[id] = elem
		} else if existingDeleted && !incomingDeleted {
			// 删除保护
		} else if incomingVersion == existingVersion && incomingDeleted {
			existingElements[id] = elem
		}
	}

	if existingFiles == nil {
		existingFiles = make(map[string]interface{})
	}
	if incomingFiles, ok := incomingScene["files"].(map[string]interface{}); ok {
		for k, v := range incomingFiles {
			existingFiles[k] = v
		}
	}

	mergedList := make([]interface{}, 0, len(existingElements))
	for _, elem := range existingElements {
		mergedList = append(mergedList, elem)
	}
	mergedScene := map[string]interface{}{"elements": mergedList}
	if len(existingFiles) > 0 {
		mergedScene["files"] = existingFiles
	}
	result, err := json.Marshal(mergedScene)
	if err != nil {
		return incoming
	}
	return result
}

func sceneKey(roomID string) string { return "room:scene:" + roomID }

var upgrader = websocket.Upgrader{
	CheckOrigin:     func(r *http.Request) bool { return true },
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

const (
	sceneSizeWarnBytes   = 2 * 1024 * 1024
	sceneSizeRejectBytes = 5 * 1024 * 1024
)

func (h *WSHandler) persistSceneDB(roomID string, sceneJSON []byte, savedBy string) {
	if h.db == nil || len(sceneJSON) == 0 {
		return
	}
	_, err := h.db.Exec(`
		INSERT INTO room_scenes (room_id, scene_data, data_size, version, saved_by, updated_at)
		VALUES ($1, $2::JSONB, $3, 1, $4, NOW())
		ON CONFLICT (room_id) DO UPDATE SET
			scene_data = EXCLUDED.scene_data,
			data_size  = EXCLUDED.data_size,
			version    = room_scenes.version + 1,
			saved_by   = EXCLUDED.saved_by,
			updated_at = NOW()
	`, roomID, string(sceneJSON), len(sceneJSON), savedBy)
	if err != nil {
		log.Printf("[场景持久化] DB写入失败 room:%s err:%v", roomID, err)
	}
}

func (h *WSHandler) loadSceneFromDB(roomID string) ([]byte, error) {
	var sceneData []byte
	err := h.db.QueryRow(`
		SELECT scene_data FROM room_scenes
		WHERE room_id = $1 AND data_size > 10
		ORDER BY updated_at DESC LIMIT 1
	`, roomID).Scan(&sceneData)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return sceneData, err
}

func resolveTeacherFromCookie(c *gin.Context) (userID string, displayName string, ok bool) {
	cfg := config.Get()
	tokenString, err := c.Cookie(cfg.JWT.CookieName)
	if err != nil || tokenString == "" {
		log.Printf("[WS鉴权] 未找到 Cookie(%s): %v", cfg.JWT.CookieName, err)
		return "", "", false
	}
	claims, err := utils.ParseToken(tokenString, cfg.JWT.Secret)
	if err != nil {
		log.Printf("[WS鉴权] JWT解析失败: %v", err)
		return "", "", false
	}
	log.Printf("[WS鉴权] 教师身份验证成功: userID=%s role=%s", claims.UserID, claims.Role)
	return claims.UserID, claims.DisplayName, true
}

// HandleWebSocket WebSocket 入口
func (h *WSHandler) HandleWebSocket(c *gin.Context) {
	roomID := c.Param("id")

	var senderUUID, senderName, senderRole string
	var avatarID int
	var avatarURL string
	urlUUID := c.Query("uuid")

	if urlUUID != "" {
		// 学生身份
		senderUUID = urlUUID
		senderRole = "student"
		avatarID = 1

		if h.rdb != nil {
			ctx := context.Background()
			if banned, _ := h.rdb.Exists(ctx, "ban:"+roomID+":"+senderUUID).Result(); banned > 0 {
				c.JSON(http.StatusForbidden, gin.H{"error": "您已被移出该房间"})
				return
			}
		}

		// 从Redis读取会话信息含avatar_url
		if h.rdb != nil {
			ctx := context.Background()
			if sessionJSON, err := h.rdb.Get(ctx, "session:"+senderUUID).Result(); err == nil {
				var sd struct {
					Nickname  string `json:"nickname"`
					Suffix    string `json:"suffix"`
					AvatarID  int    `json:"avatar_id"`
					AvatarURL string `json:"avatar_url"`
				}
				if json.Unmarshal([]byte(sessionJSON), &sd) == nil {
					senderName = sd.Nickname
					if sd.Suffix != "" {
						senderName = sd.Nickname + "#" + sd.Suffix
					}
					if sd.AvatarID > 0 {
						avatarID = sd.AvatarID
					}
					avatarURL = sd.AvatarURL
				}
			}
		}

		// REQ-004：Redis无avatar_url时从DB补读
		if avatarURL == "" && h.db != nil {
			h.db.QueryRow(
				`SELECT COALESCE(avatar_url,'') FROM room_sessions
				 WHERE student_uuid=$1 AND room_id=$2 ORDER BY joined_at DESC LIMIT 1`,
				senderUUID, roomID,
			).Scan(&avatarURL)
		}

	} else {
		// 教师身份
		userID, displayName, ok := resolveTeacherFromCookie(c)
		if !ok {
			log.Printf("[WS] 教师身份验证失败 room:%s ip:%s", roomID, c.ClientIP())
			c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录", "message": "请先登录后再操作"})
			return
		}
		senderUUID = userID
		senderRole = "teacher"
		avatarID = 0
		if displayName != "" {
			senderName = displayName
		} else {
			h.db.QueryRow("SELECT display_name FROM users WHERE id=$1", userID).Scan(&senderName)
		}
		h.db.QueryRow("SELECT COALESCE(avatar_url,'') FROM users WHERE id=$1", userID).Scan(&avatarURL)
	}

	var roomStatus string
	var isLocked, isReadOnly bool
	if err := h.db.QueryRow(
		"SELECT status, is_locked, is_readonly FROM rooms WHERE id=$1", roomID,
	).Scan(&roomStatus, &isLocked, &isReadOnly); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "房间不存在"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[WS] 升级失败 room:%s err:%v", roomID, err)
		return
	}

	room := h.hub.GetOrCreateRoom(roomID)
	client := ws.NewClient(senderUUID, senderName, senderRole, avatarID, conn, room)
	room.Register <- client

	log.Printf("[WS] 客户端连接 room:%s uuid:%s role:%s name:%s",
		roomID, senderUUID, senderRole, senderName)

	// 发送room_sync（含场景恢复）
	go func() {
		time.Sleep(800 * time.Millisecond)
		var sceneData interface{}
		sceneLoaded := false
		// REQ-029：记录场景字节数，入场时随 room_sync 一起带给前端，
		// 不用等到下一次编辑触发 scene_update 才第一次看到容量
		sceneSizeBytes := 0

		if h.rdb != nil {
			ctx := context.Background()
			if sceneJSON, err := h.rdb.Get(ctx, sceneKey(roomID)).Result(); err == nil && len(sceneJSON) > 10 {
				if json.Unmarshal([]byte(sceneJSON), &sceneData) == nil {
					sceneLoaded = true
					sceneSizeBytes = len(sceneJSON)
					log.Printf("[场景恢复] Redis命中 room:%s size:%d", roomID, len(sceneJSON))
				}
			}
		}
		if !sceneLoaded {
			if sceneBytes, err := h.loadSceneFromDB(roomID); err == nil && len(sceneBytes) > 10 {
				if json.Unmarshal(sceneBytes, &sceneData) == nil {
					sceneLoaded = true
					sceneSizeBytes = len(sceneBytes)
					log.Printf("[场景恢复] PostgreSQL兜底 room:%s size:%d", roomID, len(sceneBytes))
					if h.rdb != nil {
						ctx := context.Background()
						h.rdb.Set(ctx, sceneKey(roomID), string(sceneBytes), 7*24*time.Hour)
					}
				}
			}
		}
		if !sceneLoaded {
			log.Printf("[场景恢复] 无历史场景 room:%s（新房间）", roomID)
		}

		elements, _ := h.widgetService.GetElementsByRoom(roomID)

		// BUG-008：崩溃/断线重连时，把该学生在本房间已提交过互动的组件ID列表一并带回，
		// 供前端 widgetStore 补齐"我是否已提交"状态（教师不投票，跳过查询）。
		var mySubmissions []string
		// BUG-009：词云要恢复的是"具体提交过哪些词"这份内容本身（而非布尔标记），
		// 按 element_id 分组带回，供前端 WordCloudWidget 初始化 myWords。
		var myWordSubmissions map[string][]string
		if senderRole != "teacher" {
			mySubmissions, _ = h.widgetService.GetStudentSubmittedElements(roomID, senderUUID)
			myWordSubmissions, _ = h.widgetService.GetStudentWordCloudSubmissions(roomID, senderUUID)
		}

		syncBytes, _ := json.Marshal(map[string]interface{}{
			"type":             ws.MsgRoomSync,
			"room_id":          roomID,
			"excalidraw_scene": sceneData,
			"elements":         elements,
			"is_locked":        isLocked,
			"is_readonly":      isReadOnly,
			"sender_uuid":      senderUUID,
			"sender_name":      senderName,
			"sender_role":      senderRole,
			// REQ-029：场景容量三件套，前端场控面板据此渲染进度条
			"scene_size":        sceneSizeBytes,
			"scene_size_warn":   sceneSizeWarnBytes,
			"scene_size_reject": sceneSizeRejectBytes,
			// BUG-008：本学生已提交过的组件ID列表
			"my_submissions": mySubmissions,
			// BUG-009：本学生在各词云组件下已提交过的具体词语（{element_id: [word,...]}）
			"my_word_submissions": myWordSubmissions,
		})
		client.Send <- syncBytes
	}()

	// REQ-004：广播member_join携带avatar_url
	joinBytes, _ := json.Marshal(map[string]interface{}{
		"type":       ws.MsgMemberJoin,
		"uuid":       senderUUID,
		"name":       senderName,
		"role":       senderRole,
		"avatar_id":  avatarID,
		"avatar_url": avatarURL,
		"joined_at":  time.Now().Format(time.RFC3339),
	})
	room.BroadcastRawToOthers(senderUUID, joinBytes)

	go client.WritePump()
	client.ReadPump()

	leaveBytes, _ := json.Marshal(map[string]interface{}{
		"type": ws.MsgMemberLeave,
		"uuid": senderUUID,
		"name": senderName,
	})
	room.BroadcastRawToOthers(senderUUID, leaveBytes)
	log.Printf("[WS] 客户端断开 room:%s uuid:%s", roomID, senderUUID)
}

// SetupMessageHandler 设置消息处理回调
func (h *WSHandler) SetupMessageHandler() {
	h.hub.SetMessageHandler(func(room *ws.Room, clientMsg *ws.ClientMessage) {
		client := clientMsg.Client
		msg := clientMsg.Message
		roomID := room.ID
		senderUUID := client.UUID

		switch msg.Type {

		case ws.MsgSceneUpdate:
			var payload map[string]interface{}
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				return
			}
			if illegalIDs := validateDeletePermissions(senderUUID, payload); len(illegalIDs) > 0 {
				// REQ-046 团队协作形态：人人可删他人元素，跳过恢复。
				// 仅在确有越权删除时才查库（罕见），避免每次 scene_update 都查房间形态。
				if !h.isTeamRoom(roomID) {
					payload = filterIllegalDeletes(payload, illegalIDs)
				}
			}
			broadcastBytes, _ := json.Marshal(map[string]interface{}{
				"type": ws.MsgSceneUpdate,
				"data": payload,
				"from": senderUUID,
			})
			room.BroadcastRawToOthers(senderUUID, broadcastBytes)

			sceneBytes, _ := json.Marshal(payload)
			go func(scene []byte, saver string, rid string) {
				if h.rdb == nil {
					return
				}
				ctx := context.Background()
				existing, _ := h.rdb.Get(ctx, sceneKey(rid)).Bytes()
				merged := mergeSceneElements(existing, scene)
				mergedSize := len(merged)

				// REQ-029：不管接受/告警/拒绝，都把当前容量广播给房间所有人。
				// 拒绝时也必须广播，否则前端只看到"编辑没生效"却不知道是容量超限，
				// 就是 REQ-029 立项那次 1.4MB 房间恶性循环的根源。
				status := "ok"
				if mergedSize >= sceneSizeRejectBytes {
					status = "reject"
				} else if mergedSize >= sceneSizeWarnBytes {
					status = "warn"
				}
				sizeBytes, _ := json.Marshal(map[string]interface{}{
					"type":         ws.MsgSceneSizeUpdate,
					"size":         mergedSize,
					"warn_bytes":   sceneSizeWarnBytes,
					"reject_bytes": sceneSizeRejectBytes,
					"status":       status,
				})
				room.BroadcastRaw(sizeBytes)

				if mergedSize >= sceneSizeRejectBytes {
					log.Printf("[场景大小] ⛔ 拒绝写入 room:%s size:%.2fMB", rid, float64(mergedSize)/1024/1024)
					return
				}
				if mergedSize >= sceneSizeWarnBytes {
					log.Printf("[场景大小] ⚠️ 告警 room:%s size:%.2fMB", rid, float64(mergedSize)/1024/1024)
				}
				h.rdb.Set(ctx, sceneKey(rid), string(merged), 7*24*time.Hour)
				h.throttledPersistSceneDB(rid, merged, saver)
			}(sceneBytes, senderUUID, roomID)

		case ws.MsgElementCreate:
			result := h.persistElementCreate(roomID, client, msg)
			if result == nil {
				return
			}
			var elemData map[string]interface{}
			json.Unmarshal(msg.Payload, &elemData)
			elemData["id"] = result.ID
			broadcastBytes, _ := json.Marshal(map[string]interface{}{
				"type": ws.MsgElementCreate,
				"data": elemData,
				"from": senderUUID,
			})
			room.BroadcastRaw(broadcastBytes)

		case ws.MsgElementUpdate, ws.MsgElementDelete:
			var elemData map[string]interface{}
			json.Unmarshal(msg.Payload, &elemData)
			broadcastBytes, _ := json.Marshal(map[string]interface{}{
				"type": msg.Type,
				"data": elemData,
				"from": senderUUID,
			})
			room.BroadcastRawToOthers(senderUUID, broadcastBytes)
			go h.persistElementOperation(msg.Type, msg.Payload)

		case ws.MsgDrawStroke:
			var strokeData map[string]interface{}
			json.Unmarshal(msg.Payload, &strokeData)
			broadcastBytes, _ := json.Marshal(map[string]interface{}{
				"type": ws.MsgDrawStroke,
				"data": strokeData,
				"from": senderUUID,
			})
			room.BroadcastRawToOthers(senderUUID, broadcastBytes)
			if isFinal, _ := strokeData["is_final"].(bool); isFinal {
				go h.persistStroke(roomID, client, msg.Payload)
			}

		case ws.MsgCursorMove:
			// REQ-021：仅在光标模式开启且房间人数<=10时透传光标位置
			cursorModeOn := false
			if h.rdb != nil {
				ctx := context.Background()
				cmVal, cmErr := h.rdb.Get(ctx, "cursor_mode:"+roomID).Result()
				if cmErr == nil && cmVal == "1" {
					cursorModeOn = true
				}
			}
			if cursorModeOn && room.ClientCount() <= 10 {
				var cursorData map[string]interface{}
				json.Unmarshal(msg.Payload, &cursorData)
				// 附加发送者昵称，前端渲染光标标签用
				cursorBroadcast, _ := json.Marshal(map[string]interface{}{
					"type":     ws.MsgCursorMove,
					"data":     cursorData,
					"from":     senderUUID,
					"nickname": client.Nickname,
				})
				room.BroadcastRawToOthers(senderUUID, cursorBroadcast)
			}

		case ws.MsgWidgetSubmit:
			// REQ-003修复入口
			h.handleWidgetSubmit(room, client, msg)

		case ws.MsgDropzoneSubmit:
			if !isGuestUUID(senderUUID) {
				return
			}
			var req services.DropzoneSubmitRequest
			if err := json.Unmarshal(msg.Payload, &req); err != nil {
				errBytes, _ := json.Marshal(map[string]interface{}{"type": ws.MsgDropzoneError, "error": "数据格式错误"})
				client.Send <- errBytes
				return
			}
			req.StudentUUID = senderUUID
			req.StudentName = client.Nickname
			elementID, _ := jsonGetString(msg.Payload, "element_id")
			updatedPayload, submissionID, err := h.widgetService.HandleDropzoneSubmit(roomID, elementID, req)
			if err != nil {
				errBytes, _ := json.Marshal(map[string]interface{}{"type": ws.MsgDropzoneError, "error": err.Error()})
				client.Send <- errBytes
				return
			}
			newSubmission := map[string]interface{}{
				"id": submissionID, "student_uuid": req.StudentUUID, "student_name": req.StudentName,
				"content_type": req.ContentType, "content": req.Content, "thumbnail": req.Thumbnail,
				"likes": 0, "tags": []string{}, "pinned": false, "hidden": false,
				"submitted_at": time.Now().Format(time.RFC3339),
			}
			if req.GroupID != "" {
				newSubmission["group_id"] = req.GroupID
			}
			broadcastBytes, _ := json.Marshal(map[string]interface{}{
				"type": ws.MsgDropzoneUpdate, "element_id": elementID,
				"payload": updatedPayload, "new_submission": newSubmission,
			})
			room.BroadcastRaw(broadcastBytes)

		case ws.MsgDropzoneAction:
			if isGuestUUID(senderUUID) {
				return
			}
			var req services.DropzoneActionRequest
			if err := json.Unmarshal(msg.Payload, &req); err != nil {
				return
			}
			elementID, _ := jsonGetString(msg.Payload, "element_id")
			updatedPayload, err := h.widgetService.HandleDropzoneAction(roomID, elementID, req, senderUUID)
			if err != nil {
				errBytes, _ := json.Marshal(map[string]interface{}{"type": ws.MsgDropzoneError, "error": err.Error()})
				client.Send <- errBytes
				return
			}
			updatedSubmission := map[string]interface{}{"id": req.SubmissionID, "deleted": req.ActionType == "delete_submission"}
			var rawData []byte
			h.db.QueryRow(`SELECT action_data FROM widget_interactions WHERE id=$1`, req.SubmissionID).Scan(&rawData)
			if rawData != nil {
				var actionData map[string]interface{}
				if json.Unmarshal(rawData, &actionData) == nil {
					for k, v := range actionData {
						updatedSubmission[k] = v
					}
					updatedSubmission["id"] = req.SubmissionID
				}
			}
			broadcastBytes, _ := json.Marshal(map[string]interface{}{
				"type": ws.MsgDropzoneUpdate, "element_id": elementID,
				"payload": updatedPayload, "updated_submission": updatedSubmission,
			})
			room.BroadcastRaw(broadcastBytes)

		case ws.MsgCardLike, ws.MsgCardReaction:
			var data map[string]interface{}
			json.Unmarshal(msg.Payload, &data)
			broadcastBytes, _ := json.Marshal(map[string]interface{}{"type": msg.Type, "data": data, "from": senderUUID})
			room.BroadcastRaw(broadcastBytes)

		case ws.MsgCtrlFollowMode, ws.MsgCtrlFollowSync:
			var data map[string]interface{}
			json.Unmarshal(msg.Payload, &data)
			broadcastBytes, _ := json.Marshal(map[string]interface{}{"type": msg.Type, "data": data, "from": senderUUID})
			room.BroadcastRawToOthers(senderUUID, broadcastBytes)

		// REQ-021：多用户光标模式控制
		// 教师发送 ctrl_cursor_mode{enabled:true/false}，广播给房间所有人
		// 后端同时用 Redis 记录光标模式状态，供 cursor_move 透传判断
		case ws.MsgCtrlCursorMode:
			var modeData map[string]interface{}
			json.Unmarshal(msg.Payload, &modeData)
			modeEnabled, _ := modeData["enabled"].(bool)
			if h.rdb != nil {
				ctx := context.Background()
				modeVal := "0"
				if modeEnabled {
					modeVal = "1"
				}
				h.rdb.Set(ctx, "cursor_mode:"+roomID, modeVal, 24*time.Hour)
			}
			modeBroadcast, _ := json.Marshal(map[string]interface{}{
				"type":    ws.MsgCtrlCursorMode,
				"enabled": modeEnabled,
				"from":    senderUUID,
			})
			room.BroadcastRaw(modeBroadcast)

		case ws.MsgPing:
			pongBytes, _ := json.Marshal(map[string]string{"type": ws.MsgPong})
			client.Send <- pongBytes
		}
	})
}

// throttledPersistSceneDB 节流写入DB（30秒最多写一次）
func (h *WSHandler) throttledPersistSceneDB(roomID string, sceneJSON []byte, savedBy string) {
	if len(sceneJSON) >= sceneSizeRejectBytes {
		return
	}
	if h.rdb == nil {
		h.persistSceneDB(roomID, sceneJSON, savedBy)
		return
	}
	ctx := context.Background()
	throttleKey := "scene:throttle:" + roomID
	set, err := h.rdb.SetNX(ctx, throttleKey, "1", 30*time.Second).Result()
	if err != nil || !set {
		return
	}
	h.persistSceneDB(roomID, sceneJSON, savedBy)
	log.Printf("[场景持久化] DB写入成功 room:%s size:%d savedBy:%s", roomID, len(sceneJSON), savedBy)
}

// =============================================================
// handleWidgetSubmit 处理投票/词云/问答提交
// REQ-003核心修复：
//   - 投票/词云：HandleVote/HandleWordCloud返回nil payload
//   - 修复方案：提交成功后统一从DB重新读取最新payload广播
//   - 确保教师端widget_update消息携带有效payload
// =============================================================
func (h *WSHandler) handleWidgetSubmit(room *ws.Room, client *ws.Client, msg *ws.RawMessage) {
	if !isGuestUUID(client.UUID) {
		log.Printf("[Widget] 教师 %s 尝试提交互动，已拦截", client.UUID)
		return
	}

	var submitData struct {
		ActionType string          `json:"action_type"`
		ElementID  string          `json:"element_id"`
		Data       json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(msg.Payload, &submitData); err != nil {
		return
	}

	var updatedPayload map[string]interface{}
	var submitErr error

	switch submitData.ActionType {
	case "vote":
		submitErr = h.widgetService.HandleVote(
			submitData.ElementID, room.ID, client.UUID, client.Nickname, submitData.Data,
		)
		if submitErr == nil {
			// REQ-003修复：投票HandleVote返回nil，从DB读取最新payload
			updatedPayload = h.readElementPayload(submitData.ElementID)
		}

	case "add_word":
		submitErr = h.widgetService.HandleWordCloud(
			submitData.ElementID, room.ID, client.UUID, client.Nickname, submitData.Data,
		)
		if submitErr == nil {
			// REQ-003修复：词云HandleWordCloud返回nil，从DB读取最新payload
			updatedPayload = h.readElementPayload(submitData.ElementID)
		}

	case "answer":
		updatedPayload, submitErr = h.widgetService.HandleAnswer(
			submitData.ElementID, room.ID, client.UUID, client.Nickname, submitData.Data,
		)
		// 问答HandleAnswer已返回updatedPayload，但也做兜底
		if submitErr == nil && updatedPayload == nil {
			updatedPayload = h.readElementPayload(submitData.ElementID)
		}

	default:
		log.Printf("[Widget] 未知 action_type: %s", submitData.ActionType)
		return
	}

	if submitErr != nil {
		errBytes, _ := json.Marshal(map[string]interface{}{
			"type": "widget_error", "error": submitErr.Error(),
		})
		client.Send <- errBytes
		return
	}

	// REQ-003修复：只有payload非nil才广播，确保教师端能收到有效数据
	if updatedPayload == nil {
		log.Printf("[Widget] ⚠️ 提交成功但payload为nil element:%s action:%s，跳过广播",
			submitData.ElementID, submitData.ActionType)
		return
	}

	broadcastBytes, _ := json.Marshal(map[string]interface{}{
		"type":       ws.MsgWidgetUpdate,
		"element_id": submitData.ElementID,
		"payload":    updatedPayload,
		"from":       client.UUID,
	})
	room.BroadcastRaw(broadcastBytes)
	log.Printf("[Widget] ✅ 广播更新 element:%s action:%s", submitData.ElementID, submitData.ActionType)
}

// readElementPayload 从DB读取元素的最新payload
// REQ-003：投票/词云提交后用于获取聚合后的最新数据
func (h *WSHandler) readElementPayload(elementID string) map[string]interface{} {
	if h.db == nil {
		return nil
	}
	var rawPayload []byte
	err := h.db.QueryRow(
		`SELECT payload FROM room_elements WHERE id=$1 AND is_deleted=FALSE`,
		elementID,
	).Scan(&rawPayload)
	if err != nil {
		log.Printf("[Widget] readElementPayload失败 element:%s err:%v", elementID, err)
		return nil
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		return nil
	}
	return payload
}

// persistElementCreate 创建元素并写入DB
func (h *WSHandler) persistElementCreate(roomID string, client *ws.Client, msg *ws.RawMessage) *struct{ ID string } {
	var elemData map[string]interface{}
	if err := json.Unmarshal(msg.Payload, &elemData); err != nil {
		return nil
	}
	elemType, _ := elemData["type"].(string)
	payloadJSON, _ := json.Marshal(elemData)
	elem, err := h.widgetService.CreateElement(roomID, client.UUID, client.Nickname, elemType, payloadJSON)
	if err != nil {
		log.Printf("[WS] 创建元素失败: %v", err)
		return nil
	}
	return &struct{ ID string }{ID: elem.ID}
}

// persistElementOperation 更新/删除元素
func (h *WSHandler) persistElementOperation(msgType string, payload json.RawMessage) {
	var elemData map[string]interface{}
	if err := json.Unmarshal(payload, &elemData); err != nil {
		return
	}
	elemID, _ := elemData["id"].(string)
	if elemID == "" {
		return
	}
	switch msgType {
	case ws.MsgElementUpdate:
		payloadJSON, _ := json.Marshal(elemData)
		// 写库前展平三层嵌套，防止前端旧数据覆盖聚合结果
		elemType2, _ := elemData["type"].(string)
		if elemType2 == "" {
			// BUG-012：旧版前端拖拽/缩放消息不带 type，按元素 ID 反查，
			// 保证 FlattenWidgetPayload 一定能整形（否则新坐标会陷进内层丢失）
			elemType2 = h.widgetService.GetElementType(elemID)
		}
		payloadJSON = services.FlattenWidgetPayload(elemType2, payloadJSON)
		h.widgetService.UpdateElementPayload(elemID, payloadJSON)
	case ws.MsgElementDelete:
		h.widgetService.SoftDeleteElement(elemID)
	}
}

// persistStroke 持久化画笔轨迹
func (h *WSHandler) persistStroke(roomID string, client *ws.Client, payload json.RawMessage) {
	var strokeData map[string]interface{}
	if err := json.Unmarshal(payload, &strokeData); err != nil {
		return
	}
	payloadJSON, _ := json.Marshal(strokeData)
	h.widgetService.CreateElement(roomID, client.UUID, client.Nickname, "excalidraw_stroke", payloadJSON)
}

// isTeamRoom 查询房间是否为团队协作形态（REQ-046）。
// 仅在检测到学生越权删除时调用，频率低；查询失败时保守返回 false（＝保持删除保护）。
func (h *WSHandler) isTeamRoom(roomID string) bool {
	var collabMode string
	if err := h.db.QueryRow(
		"SELECT collab_mode FROM rooms WHERE id=$1", roomID,
	).Scan(&collabMode); err != nil {
		return false
	}
	return collabMode == models.CollabModeTeam
}

// validateDeletePermissions 检查学生是否尝试删除他人元素
func validateDeletePermissions(senderUUID string, payload map[string]interface{}) []string {
	if !isGuestUUID(senderUUID) {
		return nil
	}
	elements, ok := payload["elements"].([]interface{})
	if !ok {
		return nil
	}
	var illegalIDs []string
	for _, elem := range elements {
		elemMap, ok := elem.(map[string]interface{})
		if !ok {
			continue
		}
		if isDeleted, _ := elemMap["isDeleted"].(bool); !isDeleted {
			continue
		}
		customData, _ := elemMap["customData"].(map[string]interface{})
		if customData == nil {
			continue
		}
		if creatorID, _ := customData["creatorId"].(string); creatorID != senderUUID {
			if elemID, _ := elemMap["id"].(string); elemID != "" {
				illegalIDs = append(illegalIDs, elemID)
			}
		}
	}
	return illegalIDs
}

// filterIllegalDeletes 恢复被非法删除的元素
func filterIllegalDeletes(payload map[string]interface{}, illegalIDs []string) map[string]interface{} {
	if len(illegalIDs) == 0 {
		return payload
	}
	illegalSet := make(map[string]bool, len(illegalIDs))
	for _, id := range illegalIDs {
		illegalSet[id] = true
	}
	elements, ok := payload["elements"].([]interface{})
	if !ok {
		return payload
	}
	for _, elem := range elements {
		if elemMap, ok := elem.(map[string]interface{}); ok {
			if elemID, _ := elemMap["id"].(string); illegalSet[elemID] {
				elemMap["isDeleted"] = false
			}
		}
	}
	payload["elements"] = elements
	return payload
}

// isGuestUUID 判断是否为学生UUID
// REQ-003核心修复：学生实际UUID格式为 "guest-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
//   - 带 guest- 前缀，长度42位、含5个连字符
//   - 旧逻辑仅判断"36位+4连字符"，导致学生被误判为教师而拦截投票/词云/作品提交
//   - 新逻辑：优先识别 guest- 前缀；同时兼容裸标准36位UUID（向后兼容历史数据）
func isGuestUUID(uuid string) bool {
	// 学生UUID统一带 guest- 前缀，这是判断学生身份的首要依据
	if strings.HasPrefix(uuid, "guest-") {
		return true
	}
	// 向后兼容：裸标准36位UUID（历史会话可能无前缀）
	return len(uuid) == 36 && strings.Count(uuid, "-") == 4
}

// jsonGetString 从 json.RawMessage 安全提取字符串字段
func jsonGetString(raw json.RawMessage, key string) (string, bool) {
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return "", false
	}
	v, ok := m[key].(string)
	return v, ok
}
