// =============================================================
// MindCanvas v3.0 - WebSocket Hub 全局管理器
// 功能：管理所有活跃房间，房间创建/获取/移除
// =============================================================
package ws

import (
	"log"
	"sync"
)

// Hub WebSocket 全局管理器
type Hub struct {
	rooms      map[string]*Room // roomID → Room 映射
	mu         sync.RWMutex     // 读写锁保护 rooms map
	onMessage  func(*Room, *ClientMessage) // 全局消息处理回调
	onEmpty    func(string)                // 房间清空回调（BUG-021②）
}

// NewHub 创建 Hub 实例
func NewHub() *Hub {
	return &Hub{
		rooms: make(map[string]*Room),
	}
}

// SetMessageHandler 设置全局消息处理回调
// 所有房间收到的消息都会回调此函数
func (h *Hub) SetMessageHandler(handler func(*Room, *ClientMessage)) {
	h.onMessage = handler
}

// SetEmptyHandler 设置房间清空回调（BUG-021②：最后一个客户端离开时触发）
func (h *Hub) SetEmptyHandler(handler func(string)) {
	h.onEmpty = handler
}

// GetOrCreateRoom 获取或创建房间
// 如果房间不存在则创建并启动主循环
func (h *Hub) GetOrCreateRoom(roomID string) *Room {
	h.mu.RLock()
	room, exists := h.rooms[roomID]
	h.mu.RUnlock()

	if exists {
		return room
	}

	// 创建新房间
	h.mu.Lock()
	defer h.mu.Unlock()

	// 双重检查（防止并发创建）
	if room, exists = h.rooms[roomID]; exists {
		return room
	}

	room = NewRoom(roomID)
	room.OnMessage = h.onMessage // 注入消息处理回调
	room.OnEmpty = h.onEmpty     // 注入房间清空回调（BUG-021②）
	h.rooms[roomID] = room

	// 启动房间主循环
	go room.Run()

	log.Printf("[Hub] 房间创建 - ID:%s 当前房间数:%d", roomID, len(h.rooms))
	return room
}

// GetRoom 获取房间（不存在返回 nil）
func (h *Hub) GetRoom(roomID string) *Room {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.rooms[roomID]
}

// BroadcastToRoom 向指定房间广播消息
func (h *Hub) BroadcastToRoom(roomID string, msg Message) {
	room := h.GetRoom(roomID)
	if room != nil {
		room.BroadcastAll(msg)
	}
}

// SendToClient 向指定房间的指定客户端发送消息
func (h *Hub) SendToClient(roomID, targetUUID string, msg Message) {
	room := h.GetRoom(roomID)
	if room != nil {
		room.SendToClient(targetUUID, msg)
	}
}

// RemoveClient 从指定房间移除客户端
func (h *Hub) RemoveClient(roomID, uuid string) {
	room := h.GetRoom(roomID)
	if room != nil {
		room.RemoveClient(uuid)
	}
}

// RoomCount 获取当前活跃房间数
func (h *Hub) RoomCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms)
}

// GetRoomClientCount 获取指定房间的在线人数
func (h *Hub) GetRoomClientCount(roomID string) int {
	room := h.GetRoom(roomID)
	if room != nil {
		return room.ClientCount()
	}
	return 0
}

// GetRoomClientList 获取指定房间所有在线成员详情
// ⭐ 返回格式：[]map{"uuid","nickname","role","avatar_id"}
//    含教师（role=teacher）和学生（role=student）
//    用于 InsightService 未提交名单计算（排除教师）
func (h *Hub) GetRoomClientList(roomID string) []map[string]interface{} {
	room := h.GetRoom(roomID)
	if room != nil {
		return room.GetClientList()
	}
	return []map[string]interface{}{}
}
