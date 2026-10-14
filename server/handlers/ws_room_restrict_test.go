package handlers

import (
	"testing"

	"mindcanvas-server/ws"
)

func TestStudentWriteBlocked(t *testing.T) {
	yes := func() bool { return true }
	no := func() bool { return false }
	cases := []struct {
		name    string
		role    string
		msgType string
		restr   func() bool
		want    bool
	}{
		{"只读房：学生改画布 → 拦", "student", ws.MsgSceneUpdate, yes, true},
		{"只读房：学生建组件 → 拦", "student", ws.MsgElementCreate, yes, true},
		{"只读房：学生交作品 → 拦", "student", ws.MsgDropzoneSubmit, yes, true},
		{"只读房：学生点赞 → 拦", "student", ws.MsgCardLike, yes, true},
		{"只读房：老师改画布 → 放行（BUG-056 核心）", "teacher", ws.MsgSceneUpdate, yes, false},
		{"只读房：学生移动光标 → 放行", "student", ws.MsgCursorMove, yes, false},
		{"只读房：学生心跳 → 放行", "student", ws.MsgPing, yes, false},
		{"正常房：学生改画布 → 放行", "student", ws.MsgSceneUpdate, no, false},
	}
	for _, c := range cases {
		if got := studentWriteBlocked(c.role, c.msgType, c.restr); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}

// 老师和非修改类消息不应触发查库（惰性求值）。
func TestStudentWriteBlocked_NoLookupWhenUnneeded(t *testing.T) {
	called := false
	probe := func() bool { called = true; return true }
	studentWriteBlocked("teacher", ws.MsgSceneUpdate, probe)
	studentWriteBlocked("student", ws.MsgCursorMove, probe)
	if called {
		t.Fatal("老师消息或光标消息不应查询房间状态")
	}
}

func TestWidgetActionBlocked(t *testing.T) {
	yes := func() bool { return true }
	no := func() bool { return false }
	if !widgetActionBlocked("student", "vote", yes) {
		t.Error("只读房学生投票应被拦")
	}
	if !widgetActionBlocked("student", "answer", yes) {
		t.Error("只读房学生答题应被拦")
	}
	if widgetActionBlocked("student", "html_event", yes) {
		t.Error("HTML 课件内部事件只是记录，应放行")
	}
	if widgetActionBlocked("student", "vote", no) {
		t.Error("正常房学生投票应放行")
	}
	if widgetActionBlocked("teacher", "vote", yes) {
		t.Error("老师不受限")
	}
}
