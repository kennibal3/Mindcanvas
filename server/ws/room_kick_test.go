// =============================================================
// ws 包契约回归测试（REQ-054 的一小片）：用真实 WebSocket 连接（httptest + gorilla，无新依赖）
//   BUG-049：踢出/封禁时，学生端必须先收到 ctrl_kick，再收到关闭码 4001 的关闭帧
//            （此前先关连接，学生收不到原因，还会按普通断线自动重连）
//   WritePump：每条消息必须是独立 WebSocket frame（此前批量拼接导致前端只解析到第一条）
// =============================================================

package ws

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// newRoomWithPeer 起一个真实 WS 服务端：服务端侧建 Client 并启动 WritePump，返回房间和「学生浏览器」这一端连接
func newRoomWithPeer(t *testing.T) (*Room, *websocket.Conn) {
	t.Helper()
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	room := NewRoom("room-contract")
	ready := make(chan struct{})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		c := NewClient("guest-1", "小明", "student", 1, conn, room)
		room.mu.Lock()
		room.Clients[c.UUID] = c
		room.mu.Unlock()
		go c.WritePump()
		close(ready)
	}))
	t.Cleanup(srv.Close)

	peer, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatalf("拨号失败: %v", err)
	}
	t.Cleanup(func() { peer.Close() })

	select {
	case <-ready:
	case <-time.After(2 * time.Second):
		t.Fatal("服务端没有完成升级与注册")
	}
	peer.SetReadDeadline(time.Now().Add(5 * time.Second))
	return room, peer
}

func TestKickDeliversCtrlKickThenCloseCode4001(t *testing.T) {
	room, peer := newRoomWithPeer(t)

	room.SendToClient("guest-1", Message{Type: MsgCtrlKick, Payload: map[string]interface{}{"reason": "您已被教师移出房间"}})
	room.RemoveClient("guest-1")

	// 第 1 条：必须是 ctrl_kick（而不是直接断线）
	_, data, err := peer.ReadMessage()
	if err != nil {
		t.Fatalf("BUG-049 回归：学生端没收到 ctrl_kick 就断线了: %v", err)
	}
	var first struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &first); err != nil || first.Type != MsgCtrlKick {
		t.Fatalf("第一条消息应为 ctrl_kick，实际 %s (err=%v)", data, err)
	}

	// 第 2 步：关闭帧必须带 CloseCodeKicked，前端据此不自动重连
	_, _, err = peer.ReadMessage()
	var ce *websocket.CloseError
	if !errors.As(err, &ce) {
		t.Fatalf("ctrl_kick 之后应收到关闭帧，实际错误: %v", err)
	}
	if ce.Code != CloseCodeKicked {
		t.Fatalf("关闭码应为 %d（被踢，不要自动重连），实际 %d", CloseCodeKicked, ce.Code)
	}
	if room.ClientCount() != 0 {
		t.Errorf("被踢客户端应已从房间移除，当前 %d 人", room.ClientCount())
	}
}

func TestBroadcastRawEachMessageIsItsOwnFrame(t *testing.T) {
	room, peer := newRoomWithPeer(t)

	sent := []string{`{"type":"a","n":1}`, `{"type":"b","n":2}`, `{"type":"c","n":3}`}
	for _, m := range sent {
		room.BroadcastRaw([]byte(m))
	}
	for i, want := range sent {
		_, data, err := peer.ReadMessage()
		if err != nil {
			t.Fatalf("读第 %d 条失败: %v", i+1, err)
		}
		if string(data) != want {
			t.Fatalf("第 %d 条应为独立帧 %s，实际 %s（消息被合并或错位）", i+1, want, data)
		}
	}
}
