// =============================================================
// MindCanvas v4.3 - WebSocket 消息协议定义
// Phase 5新增：课堂流程控制器消息类型
// REQ-021新增：多用户光标模式消息类型
// =============================================================
package ws

import "encoding/json"

// 消息类型常量
const (
	// 房间同步
	MsgRoomSync    = "room_sync"
	MsgMemberJoin  = "member_join"
	MsgMemberLeave = "member_leave"

	// 元素操作
	MsgElementCreate = "element_create"
	MsgElementUpdate = "element_update"
	MsgElementDelete = "element_delete"

	// Excalidraw 场景同步
	MsgSceneUpdate = "scene_update"

	// 画笔与光标
	MsgDrawStroke = "draw_stroke"
	MsgCursorMove = "cursor_move"

	// REQ-021：多用户光标模式控制
	// ctrl_cursor_mode: 教师开启/关闭多用户光标模式，广播给所有人
	MsgCtrlCursorMode = "ctrl_cursor_mode"

	// 互动组件
	MsgWidgetSubmit = "widget_submit"
	MsgWidgetUpdate = "widget_update"

	// 点赞/反应
	MsgCardLike     = "card_like"
	MsgCardReaction = "card_reaction"

	// 场控指令
	MsgCtrlGather   = "ctrl_gather"
	MsgCtrlLockdown = "ctrl_lockdown"
	MsgCtrlKick     = "ctrl_kick"
	MsgCtrlReadOnly = "ctrl_readonly"

	// 跟随模式
	MsgCtrlFollowMode = "ctrl_follow_mode"
	MsgCtrlFollowSync = "ctrl_follow_sync"

	// DropZone 作品墙
	MsgDropzoneSubmit = "dropzone_submit"
	MsgDropzoneAction = "dropzone_action"
	MsgDropzoneUpdate = "dropzone_update"
	MsgDropzoneError  = "dropzone_error"

	// 分组
	MsgGroupUpdate = "group_update"
	MsgGroupAssign = "group_assign"

	// Phase 5 课堂流程控制器
	// MsgCtrlFlowUpdate: 广播给房间所有成员（含学生），携带进度信息
	// 学生端根据 show_progress_to_students 字段决定是否展示进度条
	MsgCtrlFlowUpdate = "ctrl_flow_update"

	// MsgCtrlFlowWidgetHint: 仅广播给教师端，提示有Widget需要手动开启
	MsgCtrlFlowWidgetHint = "ctrl_flow_widget_hint"

	// 心跳
	MsgPing = "ping"
	MsgPong = "pong"

	// 协作墙
	MsgShelfCardCreate = "shelf_card_create"
	MsgShelfCardDelete = "shelf_card_delete"
	MsgShelfVisibility = "shelf_visibility"
)

// Message WebSocket 消息结构
type Message struct {
	Type       string                 `json:"type"`
	SenderUUID string                 `json:"sender_uuid"`
	RoomID     string                 `json:"room_id"`
	Timestamp  int64                  `json:"timestamp"`
	Payload    map[string]interface{} `json:"payload"`
}

// RawMessage 原始消息（用于解析客户端消息）
type RawMessage struct {
	Type       string          `json:"type"`
	SenderUUID string          `json:"sender_uuid"`
	RoomID     string          `json:"room_id"`
	Timestamp  int64           `json:"timestamp"`
	Payload    json.RawMessage `json:"payload"`
}

// Encode 序列化消息
func (m *Message) Encode() ([]byte, error) {
	return json.Marshal(m)
}

// DecodeMessage 反序列化原始消息
func DecodeMessage(data []byte) (*RawMessage, error) {
	var msg RawMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}
