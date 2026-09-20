// =============================================================
// BroadcastRawToOthers 契约回归测试（REQ-054 第三片）
// scene_update 靠它广播：发送者自己不能收到（否则画布回声，Excalidraw 会把自己的更新当远端更新再套一遍），
// 其余每个人各收到恰好一份。纯内存，不建真实连接。
// =============================================================

package ws

import (
	"testing"
	"time"
)

func TestBroadcastRawToOthersExcludesSenderAndReachesEveryoneElse(t *testing.T) {
	room := NewRoom("room-contract")
	sender := NewClient("guest-1", "小明", "student", 1, nil, room)
	peer := NewClient("guest-2", "小红", "student", 1, nil, room)
	teacher := NewClient("teacher-1", "老师", "teacher", 0, nil, room)
	room.mu.Lock()
	for _, c := range []*Client{sender, peer, teacher} {
		room.Clients[c.UUID] = c
	}
	room.mu.Unlock()

	msg := []byte(`{"type":"scene_update","from":"guest-1"}`)
	room.BroadcastRawToOthers("guest-1", msg)

	for _, c := range []*Client{peer, teacher} {
		select {
		case got := <-c.Send:
			if string(got) != string(msg) {
				t.Errorf("%s 收到的内容被改动: %s", c.UUID, got)
			}
		case <-time.After(time.Second):
			t.Fatalf("%s 没有收到广播", c.UUID)
		}
		select {
		case extra := <-c.Send:
			t.Errorf("%s 收到了多余的第二条: %s", c.UUID, extra)
		default:
		}
	}

	select {
	case echo := <-sender.Send:
		t.Errorf("发送者不应收到自己的广播（画布回声），却收到: %s", echo)
	default:
	}
}
