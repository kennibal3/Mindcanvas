// =============================================================
// MindCanvas - room_sync 消息构造（从 HandleWebSocket 抽出的纯函数）
// 目的：把「room_sync 长什么样」变成可被单测锁住的契约，而不是埋在
//       800ms 延迟协程里的一大段 map 字面量。
// 契约（前端 utils/wsContracts.ts 的 extractSyncedRoom 与 contracts/room_sync.json 同源）：
//   room 对象必须在消息顶层，与 elements/members 同级，不能放进 payload 层。
//   BUG-038 曾因前端读 msg.payload.room 而学生端标题恒为「课堂」。
// 抽取为纯搬运，字段名、字段值与原内联字面量完全一致。
// =============================================================

package handlers

import "mindcanvas-server/ws"

// roomSyncInput 构造 room_sync 所需的全部输入
type roomSyncInput struct {
	RoomID     string
	RoomTitle  string
	RoomMode   string
	CollabMode string
	IsLocked   bool
	IsReadOnly bool

	SceneData interface{} // 已解析的 excalidraw 场景（无历史场景时为 nil）
	Elements  interface{} // 房间内结构化组件元素

	SenderUUID string
	SenderName string
	SenderRole string

	SceneSize int // 场景字节数

	MySubmissions       []string
	MyWordSubmissions   map[string][]string
	MyAnswerSubmissions map[string]map[string]interface{}
	Members             []map[string]interface{}
}

// buildRoomSyncMessage 构造入场/重连时下发的 room_sync 消息体
func buildRoomSyncMessage(in roomSyncInput) map[string]interface{} {
	return map[string]interface{}{
		"type":    ws.MsgRoomSync,
		"room_id": in.RoomID,
		// BUG-038：房间信息（标题/模式）放在消息顶层，前端读 msg.room。
		// 曾经前端读 msg.payload.room（服务端从未发过），学生端标题恒为「课堂」。
		"room": map[string]interface{}{
			"id":          in.RoomID,
			"title":       in.RoomTitle,
			"is_locked":   in.IsLocked,
			"is_readonly": in.IsReadOnly,
			"room_mode":   in.RoomMode,
			"collab_mode": in.CollabMode,
		},
		"excalidraw_scene": in.SceneData,
		"elements":         in.Elements,
		"is_locked":        in.IsLocked,
		"is_readonly":      in.IsReadOnly,
		"sender_uuid":      in.SenderUUID,
		"sender_name":      in.SenderName,
		"sender_role":      in.SenderRole,
		// REQ-029：场景容量三件套，前端场控面板据此渲染进度条
		"scene_size":        in.SceneSize,
		"scene_size_warn":   sceneSizeWarnBytes,
		"scene_size_reject": sceneSizeRejectBytes,
		// BUG-008：本学生已提交过的组件ID列表
		"my_submissions": in.MySubmissions,
		// BUG-009：本学生在各词云组件下已提交过的具体词语（{element_id: [word,...]}）
		"my_word_submissions": in.MyWordSubmissions,
		// BUG-046：本学生在各问答组件下已提交的具体选项与当时是否正确
		// （{element_id: {choice_idx, is_correct}}）
		"my_answer_submissions": in.MyAnswerSubmissions,
		"members":               in.Members,
	}
}
