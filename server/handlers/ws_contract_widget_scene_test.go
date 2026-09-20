// =============================================================
// WebSocket 契约回归测试（REQ-054 第二片）
// 在 ws_contract_test.go 的基础上补两类契约，同样纯内存、不依赖真实 PG/Redis/网络：
//   1. widget_submit 的各分支（vote / add_word / html_event / 失败 / 越权）
//      - 投票、词云的 widget_update 与问答同为完整两层结构（BUG-006/047 同类）
//      - 失败只回给提交者本人（widget_error），不向教师广播
//      - html_event 只落库、不广播；非学生与未知 action_type 静默丢弃
//   2. scene_update 的删除权限（validateDeletePermissions / filterIllegalDeletes）
//      - 身份靠连接角色而不是 UUID 形状（BUG-017 / REQ-045 / REQ-046）
// =============================================================

package handlers

import (
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"mindcanvas-server/services"
	"mindcanvas-server/ws"
)

// ---------- 公共夹具 ----------

func setFakeElementPayload(t *testing.T, payload string) {
	t.Helper()
	old := fakeElementPayload
	fakeElementPayload = payload
	t.Cleanup(func() { fakeElementPayload = old })
}

func newWidgetContractFixture(t *testing.T) (h *WSHandler, room *ws.Room, student, teacher *ws.Client) {
	t.Helper()
	db, err := sql.Open("mc_fake_contract", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	h = &WSHandler{db: db, widgetService: services.NewWidgetService(db, services.NewProfanityService(""))}
	room = ws.NewRoom("room-contract")
	student = ws.NewClient("guest-stu-1", "小明", "student", 1, nil, room)
	teacher = ws.NewClient("teacher-1", "老师", "teacher", 0, nil, room)
	room.Clients[student.UUID] = student
	room.Clients[teacher.UUID] = teacher
	return h, room, student, teacher
}

func recvWithin(ch <-chan []byte, d time.Duration) ([]byte, bool) {
	select {
	case raw := <-ch:
		return raw, true
	case <-time.After(d):
		return nil, false
	}
}

func submitMsg(actionType, elementID, dataJSON string) *ws.RawMessage {
	return &ws.RawMessage{
		Type:    ws.MsgWidgetSubmit,
		Payload: json.RawMessage(`{"action_type":"` + actionType + `","element_id":"` + elementID + `","data":` + dataJSON + `}`),
	}
}

// ---------- 契约 3：投票 / 词云的 widget_update 与问答同为两层结构 ----------

func TestVoteAndWordCloudBroadcastIsTwoLayerPayload(t *testing.T) {
	cases := []struct {
		name       string
		action     string
		stored     string
		data       string
		flatFields []string // 这些业务字段绝不能出现在广播的外层
	}{
		{
			name:   "vote",
			action: "vote",
			stored: `{"x":10,"y":20,"width":300,"height":200,` +
				`"payload":{"status":"open","mode":"single","options":["A","B"],"allowChange":true}}`,
			data:       `{"option":"A"}`,
			flatFields: []string{"status", "options", "votes", "total_voters"},
		},
		{
			name:   "add_word",
			action: "add_word",
			stored: `{"x":10,"y":20,"width":300,"height":200,` +
				`"payload":{"status":"open","max_words_per_student":5}}`,
			data:       `{"word":"合作"}`,
			flatFields: []string{"status", "words", "max_words_per_student"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setFakeElementPayload(t, tc.stored)
			h, room, student, teacher := newWidgetContractFixture(t)

			h.handleWidgetSubmit(room, student, submitMsg(tc.action, "el-1", tc.data))

			raw, ok := recvWithin(teacher.Send, 2*time.Second)
			if !ok {
				t.Fatal("教师端没有收到 widget_update 广播")
			}
			var out map[string]interface{}
			if err := json.Unmarshal(raw, &out); err != nil {
				t.Fatalf("广播不是合法 JSON: %v", err)
			}
			if out["type"] != ws.MsgWidgetUpdate || out["element_id"] != "el-1" || out["from"] != "guest-stu-1" {
				t.Fatalf("广播头不对（type/element_id/from）: %v", out)
			}
			p, ok := out["payload"].(map[string]interface{})
			if !ok {
				t.Fatalf("payload 不是对象: %v", out["payload"])
			}
			for _, k := range []string{"x", "y", "width", "height"} {
				if _, ok := p[k].(float64); !ok {
					t.Errorf("payload 缺少外层几何字段 %q，广播的不是完整两层结构: %v", k, p)
				}
			}
			if _, ok := p["payload"].(map[string]interface{}); !ok {
				t.Errorf("payload.payload（内层业务对象）缺失: %v", p)
			}
			for _, flat := range tc.flatFields {
				if _, exists := p[flat]; exists {
					t.Errorf("业务字段 %q 出现在外层，前端按两层结构浅合并会把它摊平", flat)
				}
			}
		})
	}
}

// ---------- 契约 4：失败只回提交者，不向教师广播 ----------

func TestWidgetSubmitFailureGoesOnlyToSubmitter(t *testing.T) {
	// 投票未开放（draft）：HandleVote 返回错误
	setFakeElementPayload(t, `{"x":1,"y":2,"width":300,"height":200,`+
		`"payload":{"status":"draft","mode":"single","options":["A","B"]}}`)
	h, room, student, teacher := newWidgetContractFixture(t)

	h.handleWidgetSubmit(room, student, submitMsg("vote", "el-1", `{"option":"A"}`))

	raw, ok := recvWithin(student.Send, 2*time.Second)
	if !ok {
		t.Fatal("提交失败时提交者应收到 widget_error")
	}
	var out map[string]interface{}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	if out["type"] != "widget_error" {
		t.Errorf("失败消息 type 应为 widget_error，实际 %v", out["type"])
	}
	if msg, _ := out["error"].(string); msg == "" {
		t.Errorf("widget_error 必须带非空 error 文案（前端直接展示给学生）: %v", out)
	}
	if _, got := recvWithin(teacher.Send, 200*time.Millisecond); got {
		t.Error("提交失败不应向教师端广播任何消息")
	}
}

// ---------- 契约 5：只落库不广播 / 静默丢弃的分支 ----------

func TestWidgetSubmitSilentBranchesBroadcastNothing(t *testing.T) {
	t.Run("html_event 只落库、不广播", func(t *testing.T) {
		h, room, student, teacher := newWidgetContractFixture(t)
		h.handleWidgetSubmit(room, student, submitMsg("html_event", "el-h", `{"event":"answer","questionId":"q1","response":"B"}`))
		if raw, got := recvWithin(teacher.Send, 200*time.Millisecond); got {
			t.Errorf("html_event 不应向教师广播: %s", raw)
		}
		if raw, got := recvWithin(student.Send, 200*time.Millisecond); got {
			t.Errorf("html_event 成功时提交者也不应收到消息（收到的多半是 widget_error）: %s", raw)
		}
	})

	t.Run("非学生提交被拦截", func(t *testing.T) {
		h, room, student, teacher := newWidgetContractFixture(t)
		h.handleWidgetSubmit(room, teacher, submitMsg("answer", "el-1", `{"choice_idx":1}`))
		if raw, got := recvWithin(student.Send, 200*time.Millisecond); got {
			t.Errorf("教师提交不应产生任何广播: %s", raw)
		}
		if raw, got := recvWithin(teacher.Send, 200*time.Millisecond); got {
			t.Errorf("教师提交不应产生任何回包: %s", raw)
		}
	})

	t.Run("未知 action_type 静默丢弃", func(t *testing.T) {
		h, room, student, teacher := newWidgetContractFixture(t)
		h.handleWidgetSubmit(room, student, submitMsg("no_such_action", "el-1", `{}`))
		if raw, got := recvWithin(teacher.Send, 200*time.Millisecond); got {
			t.Errorf("未知 action_type 不应广播: %s", raw)
		}
		if raw, got := recvWithin(student.Send, 200*time.Millisecond); got {
			t.Errorf("未知 action_type 不应回包: %s", raw)
		}
	})
}

// ---------- 契约 6：scene_update 删除权限，身份靠连接角色而不是 UUID 形状 ----------

func sceneElem(id, creator string, deleted bool) map[string]interface{} {
	return map[string]interface{}{
		"id":         id,
		"isDeleted":  deleted,
		"customData": map[string]interface{}{"creatorId": creator},
	}
}

func scenePayload(elems ...map[string]interface{}) map[string]interface{} {
	arr := make([]interface{}, len(elems))
	for i, e := range elems {
		arr[i] = e
	}
	return map[string]interface{}{"elements": arr}
}

func TestValidateDeletePermissions(t *testing.T) {
	const (
		rosterStudent = "0b6c1d52-8a41-4c3e-9f57-2d8e6a1b3c47" // REQ-045：实名学生是裸 36 位稳定 UUID
		rosterOther   = "9e2f7a10-5b3c-4d68-a1e4-7c0d2b9f8e35"
		teacherBare   = "5a7d3e91-2c4b-4f06-b8a3-1e9c6d0f7b24" // 教师 UUID 同样是裸 36 位
	)

	cases := []struct {
		name      string
		sender    string
		isStudent bool
		payload   map[string]interface{}
		want      []string
	}{
		{"教师删任何人的元素不拦", "teacher-x", false,
			scenePayload(sceneElem("a", "guest-stu-1", true)), nil},
		{"教师 UUID 是裸 36 位也不能被当成学生（BUG-017）", teacherBare, false,
			scenePayload(sceneElem("a", "guest-stu-1", true)), nil},
		{"学生删自己的元素放行", "guest-stu-1", true,
			scenePayload(sceneElem("a", "guest-stu-1", true)), nil},
		{"学生删别人的元素被标为越权", "guest-stu-1", true,
			scenePayload(sceneElem("a", "guest-stu-2", true)), []string{"a"}},
		{"实名学生（裸 UUID）删自己的元素放行（REQ-045）", rosterStudent, true,
			scenePayload(sceneElem("a", rosterStudent, true)), nil},
		{"实名学生（裸 UUID）删同学元素被拦（REQ-045）", rosterStudent, true,
			scenePayload(sceneElem("a", rosterOther, true)), []string{"a"}},
		{"实名学生删教师（裸 UUID）的元素被拦，不因 UUID 形状像 guest 而放过", rosterStudent, true,
			scenePayload(sceneElem("a", teacherBare, true)), []string{"a"}},
		{"没被删除的他人元素不算越权", "guest-stu-1", true,
			scenePayload(sceneElem("a", "guest-stu-2", false)), nil},
		{"混合：只标出越权的那一个", "guest-stu-1", true,
			scenePayload(
				sceneElem("own", "guest-stu-1", true),
				sceneElem("other", "guest-stu-2", true),
				sceneElem("alive", "guest-stu-2", false)),
			[]string{"other"}},
		{"没有 elements 字段不 panic", "guest-stu-1", true, map[string]interface{}{}, nil},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := validateDeletePermissions(tc.sender, tc.isStudent, tc.payload)
			if len(got) != len(tc.want) {
				t.Fatalf("越权列表 = %v，期望 %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("越权列表 = %v，期望 %v", got, tc.want)
				}
			}
		})
	}
}

func TestFilterIllegalDeletesRestoresOnlyIllegalOnes(t *testing.T) {
	payload := scenePayload(
		sceneElem("own", "guest-stu-1", true),
		sceneElem("other", "guest-stu-2", true),
	)

	out := filterIllegalDeletes(payload, []string{"other"})

	elems, ok := out["elements"].([]interface{})
	if !ok || len(elems) != 2 {
		t.Fatalf("恢复后 elements 应仍为 2 个: %v", out["elements"])
	}
	deletedOf := func(id string) bool {
		for _, e := range elems {
			m := e.(map[string]interface{})
			if m["id"] == id {
				d, _ := m["isDeleted"].(bool)
				return d
			}
		}
		t.Fatalf("结果里找不到元素 %q", id)
		return false
	}
	if deletedOf("other") {
		t.Error("越权删除的元素必须被恢复（isDeleted=false），否则学生能删他人元素")
	}
	if !deletedOf("own") {
		t.Error("合法删除不能被误恢复，否则学生删不掉自己的元素")
	}

	// 空列表原样返回，不改动
	same := filterIllegalDeletes(scenePayload(sceneElem("x", "guest-stu-1", true)), nil)
	if d, _ := same["elements"].([]interface{})[0].(map[string]interface{})["isDeleted"].(bool); !d {
		t.Error("没有越权项时不应改动任何元素")
	}
}
