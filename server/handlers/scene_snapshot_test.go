// =============================================================
// BUG-020 一期单测
//
// 只测三个纯函数（计数与阈值判定）。snapshotScene / pruneSnapshots 要 DB，
// 留给真机验收——本项目 CI 至 2026-08-05 才开始跑测试，不引入需要
// 数据库的测试依赖，否则 CI 会从「有测试」退回「测试跑不起来」。
//
// 重点覆盖两类容易写错的：
//
//	⒜ 边界——刚好等于阈值、刚好等于比例，都必须触发（用 >= 不是 >）。
//	⒝ 脏数据——elements 缺失、类型不对、isDeleted 是字符串而非布尔。
//	   场景 JSON 来自浏览器，不能假设它一定规整。
//
// =============================================================
package handlers

import "testing"

func TestCountDeletedElements(t *testing.T) {
	cases := []struct {
		name    string
		payload map[string]interface{}
		want    int
	}{
		{
			name:    "空 payload",
			payload: map[string]interface{}{},
			want:    0,
		},
		{
			name:    "elements 不是数组",
			payload: map[string]interface{}{"elements": "oops"},
			want:    0,
		},
		{
			name: "全是活的",
			payload: map[string]interface{}{"elements": []interface{}{
				map[string]interface{}{"id": "a"},
				map[string]interface{}{"id": "b", "isDeleted": false},
			}},
			want: 0,
		},
		{
			name: "混合",
			payload: map[string]interface{}{"elements": []interface{}{
				map[string]interface{}{"id": "a", "isDeleted": true},
				map[string]interface{}{"id": "b", "isDeleted": false},
				map[string]interface{}{"id": "c", "isDeleted": true},
			}},
			want: 2,
		},
		{
			name: "isDeleted 是字符串不是布尔——不算删除，也不许 panic",
			payload: map[string]interface{}{"elements": []interface{}{
				map[string]interface{}{"id": "a", "isDeleted": "true"},
			}},
			want: 0,
		},
		{
			name: "数组里混了非对象",
			payload: map[string]interface{}{"elements": []interface{}{
				"garbage",
				nil,
				map[string]interface{}{"id": "a", "isDeleted": true},
			}},
			want: 1,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := countDeletedElements(c.payload); got != c.want {
				t.Errorf("countDeletedElements() = %d, want %d", got, c.want)
			}
		})
	}
}

func TestCountLiveElements(t *testing.T) {
	cases := []struct {
		name  string
		scene string
		want  int
	}{
		{name: "空字节", scene: "", want: 0},
		{name: "非法 JSON", scene: "{not json", want: 0},
		{name: "没有 elements 键", scene: `{"files":{}}`, want: 0},
		{name: "空数组", scene: `{"elements":[]}`, want: 0},
		{
			name:  "两活一死",
			scene: `{"elements":[{"id":"a"},{"id":"b","isDeleted":false},{"id":"c","isDeleted":true}]}`,
			want:  2,
		},
		{
			// 事故当天 Redis 那份就是这个形态：元素都在，但全被标了删除。
			// 「元素数不为 0」和「还有东西能看」是两回事，这条守住这个区分。
			name:  "全被标删除——存活为 0",
			scene: `{"elements":[{"id":"a","isDeleted":true},{"id":"b","isDeleted":true}]}`,
			want:  0,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := countLiveElements([]byte(c.scene)); got != c.want {
				t.Errorf("countLiveElements() = %d, want %d", got, c.want)
			}
		})
	}
}

func TestShouldSnapshot(t *testing.T) {
	cases := []struct {
		name       string
		delCount   int
		liveBefore int
		want       bool
	}{
		{name: "没有删除", delCount: 0, liveBefore: 100, want: false},
		{name: "删除数为负（防御）", delCount: -1, liveBefore: 100, want: false},
		{
			name:     "日常删几个，大画布——不留档",
			delCount: 3, liveBefore: 286, want: false,
		},
		{
			name:     "刚好达到绝对阈值——必须留档（>= 不是 >）",
			delCount: snapshotDeleteThreshold, liveBefore: 1000, want: true,
		},
		{
			name:     "差一个到阈值、比例也不够——不留档",
			delCount: snapshotDeleteThreshold - 1, liveBefore: 1000, want: false,
		},
		{
			// 本条是「比例判定」存在的理由：小画布被清空，绝对数远不到 20，
			// 但对老师来说损失是 100%。只看绝对数会整个漏掉这一类。
			name:     "小画布 8 个全删——绝对数不够但比例够",
			delCount: 8, liveBefore: 8, want: true,
		},
		{
			name:     "刚好等于半数——必须留档",
			delCount: 5, liveBefore: 10, want: true,
		},
		{
			name:     "差一点到半数——不留档",
			delCount: 4, liveBefore: 10, want: false,
		},
		{
			// 事故当天的真实数字。
			name:     "事故现场：286 个存活全删",
			delCount: 286, liveBefore: 286, want: true,
		},
		{
			// Redis 冷启动时 liveBefore 会是 0，此时比例判定除不下去，
			// 只能靠绝对阈值兜。这条确保那种情况不会误判成 true。
			name:     "合并前存活为 0 且删除数小——不留档",
			delCount: 1, liveBefore: 0, want: false,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := shouldSnapshot(c.delCount, c.liveBefore); got != c.want {
				t.Errorf("shouldSnapshot(%d, %d) = %v, want %v", c.delCount, c.liveBefore, got, c.want)
			}
		})
	}
}
