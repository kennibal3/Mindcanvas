// =============================================================
// widget_update 共享样例契约测试（REQ-054 第三片）
// 与前端 web/tests/wsWidgetContracts.test.mts 共用 contracts/widget_update.json：
//   服务端保证「真实广播的字段集合 == 样例」，前端保证「能正确处理样例」。
//   任何一侧改字段而不同步样例，两边的测试至少有一侧会变红。
// 只比较外两层（消息顶层、payload 的几何层）；内层业务字段随组件类型而异，不在此锁定。
// =============================================================

package handlers

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestWidgetUpdateBroadcastMatchesSharedFixture(t *testing.T) {
	fixtureBytes, err := os.ReadFile("../../contracts/widget_update.json")
	if err != nil {
		t.Fatalf("读不到共享样例 contracts/widget_update.json: %v", err)
	}
	var fixture map[string]interface{}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatal(err)
	}

	h, room, student, teacher := newWidgetContractFixture(t)
	h.handleWidgetSubmit(room, student, submitMsg("answer", "el-1", `{"choice_idx":1}`))

	raw, ok := recvWithin(teacher.Send, 2*time.Second)
	if !ok {
		t.Fatal("教师端没有收到 widget_update 广播")
	}
	var out map[string]interface{}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("广播不是合法 JSON: %v", err)
	}

	if got, want := strings.Join(jsonKeys(out), ","), strings.Join(jsonKeys(fixture), ","); got != want {
		t.Errorf("widget_update 顶层字段与共享样例不一致\n服务端: %s\n样例:   %s", got, want)
	}
	outPayload, ok := out["payload"].(map[string]interface{})
	if !ok {
		t.Fatalf("payload 不是对象: %v", out["payload"])
	}
	fixturePayload, _ := fixture["payload"].(map[string]interface{})
	if got, want := strings.Join(jsonKeys(outPayload), ","), strings.Join(jsonKeys(fixturePayload), ","); got != want {
		t.Errorf("payload 的两层结构与共享样例不一致（几何层 + 内层 payload）\n服务端: %s\n样例:   %s", got, want)
	}
	if out["type"] != fixture["type"] {
		t.Errorf("type = %v，样例为 %v", out["type"], fixture["type"])
	}
}
