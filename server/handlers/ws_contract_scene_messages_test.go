// =============================================================
// scene_update / scene_restore 契约回归测试（REQ-054 第三片）
// 锁定 ws_scene_messages.go 里抽出的三个纯函数，纯内存、不依赖 PG/Redis/网络：
//   1. scene_restore：{type, data:{illegal_ids}}，越权 ID 保持原顺序
//   2. scene_update ：{type, data, from}，data 是过滤后的 payload
//   3. resolveSceneDeleteGuard：非团队房恢复并回弹、团队房放行不回弹（REQ-046）、
//      无越权时不查库（isTeamRoom 不被调用）
// =============================================================

package handlers

import (
	"encoding/json"
	"reflect"
	"testing"
)

// toWire 把消息 map 按真正发出去的样子（JSON）往返一遍，测的是线上形状而不是 Go 类型
func toWire(t *testing.T, msg map[string]interface{}) map[string]interface{} {
	t.Helper()
	raw, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("消息无法序列化: %v", err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("消息不是合法 JSON 对象: %v", err)
	}
	return out
}

// elemDeleted 读取 payload 里某元素当前的 isDeleted
func elemDeleted(t *testing.T, payload map[string]interface{}, id string) bool {
	t.Helper()
	elems, ok := payload["elements"].([]interface{})
	if !ok {
		t.Fatalf("payload 里没有 elements: %v", payload)
	}
	for _, e := range elems {
		m := e.(map[string]interface{})
		if m["id"] == id {
			d, _ := m["isDeleted"].(bool)
			return d
		}
	}
	t.Fatalf("payload 里找不到元素 %q", id)
	return false
}

// ---------- 契约：scene_restore ----------

func TestSceneRestoreMessageShapeAndOrder(t *testing.T) {
	// 故意用非字典序，证明顺序被原样保留而不是被排序
	wire := toWire(t, buildSceneRestoreMessage([]string{"z", "a", "m"}))

	if wire["type"] != "scene_restore" {
		t.Fatalf("type = %v，期望 scene_restore（前端 case 'scene_restore' 靠它分发）", wire["type"])
	}
	data, ok := wire["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("data 必须是对象（前端读 msg.data.illegal_ids）: %v", wire["data"])
	}
	got, ok := data["illegal_ids"].([]interface{})
	if !ok {
		t.Fatalf("data.illegal_ids 必须是数组: %v", data)
	}
	want := []interface{}{"z", "a", "m"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("illegal_ids = %v，期望原顺序 %v", got, want)
	}
	if _, flat := wire["illegal_ids"]; flat {
		t.Error("illegal_ids 不能出现在消息顶层，前端只读 data 层")
	}
}

// ---------- 契约：scene_update ----------

func TestSceneUpdateMessageShape(t *testing.T) {
	payload := scenePayload(sceneElem("a", "guest-stu-1", false))
	wire := toWire(t, buildSceneUpdateMessage(payload, "guest-stu-1"))

	if wire["type"] != "scene_update" {
		t.Fatalf("type = %v，期望 scene_update", wire["type"])
	}
	if wire["from"] != "guest-stu-1" {
		t.Errorf("from = %v，期望发送者 UUID（前端据此区分是否本人发出）", wire["from"])
	}
	data, ok := wire["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("data 必须是场景 payload 对象: %v", wire["data"])
	}
	elems, ok := data["elements"].([]interface{})
	if !ok || len(elems) != 1 {
		t.Errorf("data.elements 应原样携带 1 个元素: %v", data["elements"])
	}
}

func TestSceneUpdateCarriesFilteredPayload(t *testing.T) {
	// 端到端串一遍：越权删除先被恢复，广播出去的必须是恢复后的版本，
	// 否则其他人的画布会把不该删的元素删掉
	payload := scenePayload(
		sceneElem("own", "guest-stu-1", true),
		sceneElem("other", "guest-stu-2", true),
	)
	filtered, _, outcome := resolveSceneDeleteGuard("guest-stu-1", true, payload, func() bool { return false })
	if outcome != guardRestored {
		t.Fatalf("outcome = %v，期望 guardRestored", outcome)
	}
	wire := toWire(t, buildSceneUpdateMessage(filtered, "guest-stu-1"))
	data := wire["data"].(map[string]interface{})
	if elemDeleted(t, data, "other") {
		t.Error("广播出去的 data 里越权删除的元素仍是已删除，其他人会看到它消失")
	}
	if !elemDeleted(t, data, "own") {
		t.Error("广播出去的 data 里合法删除被误恢复")
	}
}

// ---------- 契约：resolveSceneDeleteGuard ----------

func TestResolveSceneDeleteGuardNonTeamRestoresAndReportsIDsInOrder(t *testing.T) {
	payload := scenePayload(
		sceneElem("z", "guest-stu-2", true),
		sceneElem("own", "guest-stu-1", true),
		sceneElem("a", "guest-stu-2", true),
		sceneElem("m", "guest-stu-3", true),
	)
	teamCalls := 0
	out, ids, outcome := resolveSceneDeleteGuard("guest-stu-1", true, payload, func() bool {
		teamCalls++
		return false
	})

	if outcome != guardRestored {
		t.Fatalf("outcome = %v，非团队房越权删除应为 guardRestored", outcome)
	}
	if want := []string{"z", "a", "m"}; !reflect.DeepEqual(ids, want) {
		t.Errorf("illegalIDs = %v，期望按 payload 顺序 %v（scene_restore 的 illegal_ids 来源）", ids, want)
	}
	for _, id := range []string{"z", "a", "m"} {
		if elemDeleted(t, out, id) {
			t.Errorf("越权删除的元素 %q 必须被恢复", id)
		}
	}
	if !elemDeleted(t, out, "own") {
		t.Error("合法删除自己的元素不能被误恢复")
	}
	if teamCalls != 1 {
		t.Errorf("确有越权删除时应恰好查一次房间形态，实际 %d 次", teamCalls)
	}
}

func TestResolveSceneDeleteGuardTeamRoomAllowsAndDoesNotRestore(t *testing.T) {
	payload := scenePayload(sceneElem("other", "guest-stu-2", true))
	out, ids, outcome := resolveSceneDeleteGuard("guest-stu-1", true, payload, func() bool { return true })

	if outcome != guardTeamAllowed {
		t.Fatalf("outcome = %v，团队房应为 guardTeamAllowed（REQ-046：人人可删他人元素）", outcome)
	}
	if !elemDeleted(t, out, "other") {
		t.Error("团队房里跨人删除必须放行：元素应保持已删除，不能被恢复")
	}
	if len(ids) != 1 || ids[0] != "other" {
		t.Errorf("illegalIDs = %v，团队房仍应如实上报（供日志），期望 [other]", ids)
	}
}

func TestResolveSceneDeleteGuardDoesNotQueryRoomWhenNothingIllegal(t *testing.T) {
	cases := []struct {
		name      string
		sender    string
		isStudent bool
		payload   map[string]interface{}
	}{
		{"教师删任何人", "teacher-1", false, scenePayload(sceneElem("a", "guest-stu-1", true))},
		{"学生只删自己的", "guest-stu-1", true, scenePayload(sceneElem("a", "guest-stu-1", true))},
		{"学生没删任何东西", "guest-stu-1", true, scenePayload(sceneElem("a", "guest-stu-2", false))},
		{"没有 elements 字段", "guest-stu-1", true, map[string]interface{}{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			_, ids, outcome := resolveSceneDeleteGuard(tc.sender, tc.isStudent, tc.payload, func() bool {
				calls++
				return false
			})
			if outcome != guardNoIllegal {
				t.Errorf("outcome = %v，期望 guardNoIllegal", outcome)
			}
			if len(ids) != 0 {
				t.Errorf("illegalIDs = %v，期望为空", ids)
			}
			if calls != 0 {
				t.Errorf("无越权删除时不该查房间形态（每条 scene_update 都会走这里），实际查了 %d 次", calls)
			}
		})
	}
}
