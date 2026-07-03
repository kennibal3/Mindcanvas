// =============================================================
// MindCanvas v4.3 - WebSocket 客户端模型
// 功能：每个 WebSocket 连接的封装，含读/写泵
// 安全：SetReadLimit(10MB) 防内存耗尽，心跳检测
// 修复：WritePump 每条消息独立 WebSocket frame
//       原批量合并（\n拼接）导致前端JSON.parse只解析第一条
// =============================================================
package ws

import (
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 30 * time.Second    // 写入超时
	pongWait       = 120 * time.Second   // 等待 Pong 超时（前端30s心跳，留足余量）
	pingPeriod     = (pongWait * 9) / 10 // 发送 Ping 间隔
	maxMessageSize = 10485760            // 最大消息大小 10MB
)

// Client WebSocket 客户端
type Client struct {
	UUID     string          // 客户端 UUID（教师为 user_id，学生为 guest-xxx）
	Nickname string          // 昵称
	Role     string          // 角色：teacher/student
	AvatarID int             // 头像 ID
	Conn     *websocket.Conn // WebSocket 连接
	Send     chan []byte     // 发送缓冲通道
	Room     *Room           // 所属房间
}

// NewClient 创建客户端实例
func NewClient(uuid, nickname, role string, avatarID int, conn *websocket.Conn, room *Room) *Client {
	return &Client{
		UUID:     uuid,
		Nickname: nickname,
		Role:     role,
		AvatarID: avatarID,
		Conn:     conn,
		Send:     make(chan []byte, 256), // 256 消息缓冲
		Room:     room,
	}
}

// ReadPump 读泵：从 WebSocket 连接读取消息，转发给房间
// 每个客户端启动一个 goroutine 运行
func (c *Client) ReadPump() {
	defer func() {
		c.Room.Unregister <- c
		c.Conn.Close()
	}()

	// 设置读限制（防内存耗尽攻击）
	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, data, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[WS] 读取异常 - UUID:%s 错误:%v", c.UUID, err)
			}
			break
		}

		// 解析消息
		msg, err := DecodeMessage(data)
		if err != nil {
			log.Printf("[WS] 消息解析失败 - UUID:%s 错误:%v", c.UUID, err)
			continue
		}

		// 注入发送者信息
		msg.SenderUUID = c.UUID

		// 转发给房间处理
		c.Room.Incoming <- &ClientMessage{
			Client:  c,
			Message: msg,
			Raw:     data,
		}
	}
}

// WritePump 写泵：从发送通道读取消息，写入 WebSocket 连接
// 关键修复：每条消息独立发送一个 WebSocket frame
// 原来的批量合并（多条消息用 \n 拼接在同一个 writer 中）
// 会导致前端 JSON.parse() 只能解析第一条，后续消息丢失
// 每个客户端启动一个 goroutine 运行
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case data, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// 通道已关闭，发送关闭帧
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// 每条消息独立写入一个 WebSocket frame
			// 不再批量合并，确保前端每次 onmessage 收到完整 JSON
			if err := c.Conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}

			// 继续消费缓冲中的其他消息，但每条都独立发送
			// 减少通道积压，同时保证每条消息独立 frame
			n := len(c.Send)
			for i := 0; i < n; i++ {
				more, ok := <-c.Send
				if !ok {
					return
				}
				c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
				if err := c.Conn.WriteMessage(websocket.TextMessage, more); err != nil {
					return
				}
			}

		case <-ticker.C:
			// 心跳 Ping
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ClientMessage 客户端消息（含客户端引用和原始数据）
type ClientMessage struct {
	Client  *Client
	Message *RawMessage
	Raw     []byte
}
