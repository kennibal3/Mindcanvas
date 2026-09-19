// =============================================================
// WebSocket 契约回归测试（REQ-054 的一小片）
// 锁住三次「修好又被改回/一直没生效」的教训，全部纯内存、不依赖真实 PG/Redis/网络：
//   1. BUG-006 / BUG-047：问答提交后广播的 widget_update.payload 必须是完整两层结构
//      {x,y,width,height,payload:{业务字段}}（教师端「N 人已答题」依赖它）
//   2. BUG-038：room_sync 的 room 必须在消息顶层（学生端房间标题依赖它）
//   3. BUG-049 的踢出送达顺序在 ws 包的 room_kick_test.go
// =============================================================

package handlers

import (
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"mindcanvas-server/services"
	"mindcanvas-server/ws"
)

// ---------- 极简假 SQL 驱动（仅标准库）：按 SQL 关键字回放固定数据 ----------

// fakeQAElementPayload 是 room_elements.payload 的真实存储形态：外层几何 + 内层业务 payload
const fakeQAElementPayload = `{"x":100,"y":200,"width":320,"height":260,` +
	`"payload":{"status":"open","question":"1+1等于几？","options":["1","2","3","4"],"correctIdx":1}}`

type fakeDriver struct{}

func (fakeDriver) Open(string) (driver.Conn, error) { return &fakeConn{}, nil }

type fakeConn struct{}

func (c *fakeConn) Prepare(query string) (driver.Stmt, error) { return &fakeStmt{query: query}, nil }
func (c *fakeConn) Close() error                              { return nil }
func (c *fakeConn) Begin() (driver.Tx, error)                 { return nil, fmt.Errorf("fake: 未预期的事务") }

type fakeStmt struct{ query string }

func (s *fakeStmt) Close() error  { return nil }
func (s *fakeStmt) NumInput() int { return -1 }

func (s *fakeStmt) Exec([]driver.Value) (driver.Result, error) {
	if strings.Contains(s.query, "INSERT INTO widget_interactions") ||
		strings.Contains(s.query, "UPDATE room_elements") {
		return driver.RowsAffected(1), nil
	}
	return nil, fmt.Errorf("fake: 未预期的 Exec: %s", s.query)
}

func (s *fakeStmt) Query([]driver.Value) (driver.Rows, error) {
	switch {
	case strings.Contains(s.query, "SELECT payload FROM room_elements"):
		return &fakeRows{cols: []string{"payload"}, data: [][]driver.Value{{[]byte(fakeQAElementPayload)}}}, nil
	case strings.Contains(s.query, "FROM widget_interactions"):
		return &fakeRows{cols: []string{"choice_idx", "cnt"}, data: [][]driver.Value{{"1", int64(1)}}}, nil
	}
	return nil, fmt.Errorf("fake: 未预期的 Query: %s", s.query)
}

type fakeRows struct {
	cols []string
	data [][]driver.Value
	i    int
}

func (r *fakeRows) Columns() []string { return r.cols }
func (r *fakeRows) Close() error      { return nil }
func (r *fakeRows) Next(dest []driver.Value) error {
	if r.i >= len(r.data) {
		return io.EOF
	}
	copy(dest, r.data[r.i])
	r.i++
	return nil
}

func init() { sql.Register("mc_fake_contract", fakeDriver{}) }

// ---------- 契约 1：问答提交 → widget_update 必须是两层结构 ----------

func TestAnswerBroadcastIsTwoLayerPayload(t *testing.T) {
	db, err := sql.Open("mc_fake_contract", "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	h := &WSHandler{db: db, widgetService: services.NewWidgetService(db, nil)}
	room := ws.NewRoom("room-contract")
	student := ws.NewClient("guest-stu-1", "小明", "student", 1, nil, room)
	teacher := ws.NewClient("teacher-1", "老师", "teacher", 0, nil, room)
	room.Clients[student.UUID] = student
	room.Clients[teacher.UUID] = teacher

	h.handleWidgetSubmit(room, student, &ws.RawMessage{
		Type:    ws.MsgWidgetSubmit,
		Payload: json.RawMessage(`{"action_type":"answer","element_id":"el-1","data":{"choice_idx":1}}`),
	})

	var raw []byte
	select {
	case raw = <-teacher.Send:
	case <-time.After(2 * time.Second):
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
			t.Errorf("BUG-006/047 回归：payload 缺少外层几何字段 %q，说明广播的不是完整两层结构: %v", k, p)
		}
	}
	if _, ok := p["payload"].(map[string]interface{}); !ok {
		t.Errorf("BUG-006/047 回归：payload.payload（内层业务对象）缺失: %v", p)
	}
	for _, flat := range []string{"status", "options", "stats", "correctIdx"} {
		if _, exists := p[flat]; exists {
			t.Errorf("BUG-006/047 回归：业务字段 %q 出现在外层，说明广播了 HandleAnswer 的内层返回值而不是整行读库结果", flat)
		}
	}
}

// ---------- 契约 2：room_sync 的 room 在消息顶层，且与前后端共享样例一致 ----------

func jsonKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func TestRoomSyncRoomIsTopLevelAndMatchesSharedFixture(t *testing.T) {
	fixtureBytes, err := os.ReadFile("../../contracts/room_sync.json")
	if err != nil {
		t.Fatalf("读不到共享样例 contracts/room_sync.json: %v", err)
	}
	var fixture map[string]interface{}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatal(err)
	}

	msg := buildRoomSyncMessage(roomSyncInput{
		RoomID: "11111111-2222-3333-4444-555555555555", RoomTitle: "契约样例课堂",
		RoomMode: "whiteboard", CollabMode: "anonymous",
		SenderUUID: "guest-x", SenderName: "小明", SenderRole: "student",
		Members: []map[string]interface{}{},
	})
	encoded, err := json.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(encoded, &out); err != nil {
		t.Fatal(err)
	}

	if out["type"] != "room_sync" {
		t.Fatalf("type 应为 room_sync，实际 %v", out["type"])
	}
	room, ok := out["room"].(map[string]interface{})
	if !ok {
		t.Fatalf("BUG-038 回归：room 必须是消息顶层对象，实际: %v", out["room"])
	}
	if room["title"] != "契约样例课堂" {
		t.Errorf("room.title 应带出房间标题，实际 %v", room["title"])
	}
	if _, nested := out["payload"]; nested {
		t.Errorf("room_sync 不应再有 payload 层（前端契约是顶层字段）")
	}

	// 共享样例里出现的每个顶层字段，服务端都必须真的发出
	for k := range fixture {
		if _, exists := out[k]; !exists {
			t.Errorf("共享样例有字段 %q，但服务端 room_sync 没发", k)
		}
	}
	// room 子字段集合必须与样例完全一致（增删字段要同时改样例，前端测试才会跟着校验）
	fixtureRoom, _ := fixture["room"].(map[string]interface{})
	if got, want := strings.Join(jsonKeys(room), ","), strings.Join(jsonKeys(fixtureRoom), ","); got != want {
		t.Errorf("room 子字段与共享样例不一致\n服务端: %s\n样例:   %s", got, want)
	}
}
