// =============================================================
// MindCanvas v3.0 - WebSocket 房间模型
// REQ-004修复：移除Register分支中的重复member_join广播
//   原问题：ws_handler.go已用BroadcastRawToOthers发扁平格式member_join
//           room.go的Run()里Register分支又用BroadcastToOthers发旧Message格式
//           前端useWebSocket只能识别扁平格式，旧格式被忽略但不会造成问题
//           真正问题是双重广播导致时序混乱，以及旧格式member_join无法被正确解析
//   修复：移除room.go Register分支中的BroadcastToOthers调用
//         member_join完全由ws_handler.go负责广播（扁平格式）
// REQ-004修复：member_leave同样改用BroadcastRaw扁平格式
//   原问题：BroadcastAll(Message{})发嵌套格式，前端读msg.uuid才能获取
// 并发安全：broadcastToOthers分离读写锁，防panic
// =============================================================
package ws

import (
	"encoding/json"
	"log"
	"sync"
	"time"
)

// Room WebSocket 房间
type Room struct {
	ID         string
	Clients    map[string]*Client
	Register   chan *Client
	Unregister chan *Client
	Incoming   chan *ClientMessage
	mu         sync.RWMutex
	OnMessage  func(*Room, *ClientMessage)
	OnEmpty    func(roomID string) // BUG-021②：最后一个客户端离开时触发
}

// NewRoom 创建房间实例
func NewRoom(id string) *Room {
	return &Room{
		ID:         id,
		Clients:    make(map[string]*Client),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Incoming:   make(chan *ClientMessage, 256),
	}
}

// Run 房间主循环（每个房间一个 goroutine）
func (r *Room) Run() {
	snapshotTicker := time.NewTicker(30 * time.Second)
	defer snapshotTicker.Stop()

	for {
		select {
		case client := <-r.Register:
			// 新客户端加入：只注册，不广播member_join
			// REQ-004修复：member_join由ws_handler.go负责广播（扁平格式）
			// 原来这里用BroadcastToOthers发旧Message格式，与ws_handler.go重复且格式不一致
			r.mu.Lock()
			r.Clients[client.UUID] = client
			clientCount := len(r.Clients)
			r.mu.Unlock()

			log.Printf("[房间 %s] 成员注册: %s (%s) 当前人数: %d",
				r.ID, client.Nickname, client.UUID, clientCount)

		case client := <-r.Unregister:
			// 客户端离开
			r.mu.Lock()
			if _, ok := r.Clients[client.UUID]; ok {
				close(client.Send)
				delete(r.Clients, client.UUID)
			}
			clientCount := len(r.Clients)
			r.mu.Unlock()

			log.Printf("[房间 %s] 成员注销: %s 当前人数: %d",
				r.ID, client.UUID, clientCount)

			// REQ-004修复：member_leave改用BroadcastRaw扁平格式
			// 与ws_handler.go中其他广播格式保持一致
			// 前端useWebSocket中 member_leave handler: msg.uuid || msg.payload?.uuid
			leaveBytes, _ := json.Marshal(map[string]interface{}{
				"type": MsgMemberLeave,
				"uuid": client.UUID,
				"name": client.Nickname,
			})
			r.BroadcastRaw(leaveBytes)

			// BUG-021②：最后一个客户端离开时强制落库一次，不等 30 秒节流窗口。
			// 这是"最后一次编辑可能永不落库"的收口点——教师下课离开前的那次编辑，
			// 此刻被无条件补写，不依赖之后是否还有人再编辑触发节流窗口到期。
			if clientCount == 0 && r.OnEmpty != nil {
				go r.OnEmpty(r.ID)
			}

		case clientMsg := <-r.Incoming:
			if r.OnMessage != nil {
				r.OnMessage(r, clientMsg)
			}

		case <-snapshotTicker.C:
			// 定时快照（预留）
		}
	}
}

// BroadcastAll 广播消息给房间内所有人（旧Message格式，保留兼容）
func (r *Room) BroadcastAll(msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[房间 %s] 消息编码失败: %v", r.ID, err)
		return
	}
	var toRemove []string
	r.mu.RLock()
	for uuid, client := range r.Clients {
		select {
		case client.Send <- data:
		default:
			toRemove = append(toRemove, uuid)
		}
	}
	r.mu.RUnlock()
	if len(toRemove) > 0 {
		r.mu.Lock()
		for _, uuid := range toRemove {
			if c, ok := r.Clients[uuid]; ok {
				close(c.Send)
				delete(r.Clients, uuid)
			}
		}
		r.mu.Unlock()
	}
}

// BroadcastToOthers 广播消息给除发送者外的所有人（旧Message格式，保留兼容）
func (r *Room) BroadcastToOthers(senderUUID string, msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	var toRemove []string
	r.mu.RLock()
	for uuid, client := range r.Clients {
		if uuid == senderUUID {
			continue
		}
		select {
		case client.Send <- data:
		default:
			toRemove = append(toRemove, uuid)
		}
	}
	r.mu.RUnlock()
	if len(toRemove) > 0 {
		r.mu.Lock()
		for _, uuid := range toRemove {
			if c, ok := r.Clients[uuid]; ok {
				close(c.Send)
				delete(r.Clients, uuid)
			}
		}
		r.mu.Unlock()
	}
}

// SendToClient 发送消息给指定客户端
func (r *Room) SendToClient(targetUUID string, msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	r.mu.RLock()
	client, ok := r.Clients[targetUUID]
	r.mu.RUnlock()
	if ok {
		select {
		case client.Send <- data:
		default:
		}
	}
}

// ClientCount 获取当前房间在线人数
func (r *Room) ClientCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.Clients)
}

// GetClientList 获取当前房间所有客户端简要信息
func (r *Room) GetClientList() []map[string]interface{} {
	r.mu.RLock()
	defer r.mu.RUnlock()
	list := make([]map[string]interface{}, 0, len(r.Clients))
	for _, client := range r.Clients {
		list = append(list, map[string]interface{}{
			"uuid":      client.UUID,
			"nickname":  client.Nickname,
			"avatar_id": client.AvatarID,
			"role":      client.Role,
		})
	}
	return list
}

// ShouldThrottleCursor 根据房间人数判断光标节流策略
func (r *Room) ShouldThrottleCursor() string {
	count := r.ClientCount()
	if count <= 50 {
		return "full"
	} else if count <= 100 {
		return "throttle"
	}
	return "disabled"
}

// RemoveClient 强制移除客户端（踢人用）
func (r *Room) RemoveClient(uuid string) {
	r.mu.Lock()
	if c, ok := r.Clients[uuid]; ok {
		close(c.Send)
		delete(r.Clients, uuid)
		c.Conn.Close()
	}
	r.mu.Unlock()
}

// BroadcastRaw 广播原始字节给所有客户端
func (r *Room) BroadcastRaw(data []byte) {
	var toRemove []string
	r.mu.RLock()
	for uuid, client := range r.Clients {
		select {
		case client.Send <- data:
		default:
			toRemove = append(toRemove, uuid)
		}
	}
	r.mu.RUnlock()
	if len(toRemove) > 0 {
		r.mu.Lock()
		for _, uuid := range toRemove {
			if c, ok := r.Clients[uuid]; ok {
				close(c.Send)
				delete(r.Clients, uuid)
			}
		}
		r.mu.Unlock()
	}
}

// BroadcastRawToOthers 广播原始字节给除发送者外的所有客户端
func (r *Room) BroadcastRawToOthers(senderUUID string, data []byte) {
	var toRemove []string
	r.mu.RLock()
	for uuid, client := range r.Clients {
		if uuid == senderUUID {
			continue
		}
		select {
		case client.Send <- data:
		default:
			toRemove = append(toRemove, uuid)
		}
	}
	r.mu.RUnlock()
	if len(toRemove) > 0 {
		r.mu.Lock()
		for _, uuid := range toRemove {
			if c, ok := r.Clients[uuid]; ok {
				close(c.Send)
				delete(r.Clients, uuid)
			}
		}
		r.mu.Unlock()
	}
}
