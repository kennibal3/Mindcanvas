package handlers

import "testing"

func TestSceneContentUpdatedMs(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want int64
	}{
		{"取最大值", `{"elements":[{"id":"a","updated":1000},{"id":"b","updated":3000},{"id":"c","updated":2000}]}`, 3000},
		{"已删除元素也算（删除即修改）", `{"elements":[{"id":"a","updated":1000},{"id":"b","updated":5000,"isDeleted":true}]}`, 5000},
		{"缺 updated 的元素忽略", `{"elements":[{"id":"a"},{"id":"b","updated":42}]}`, 42},
		{"小数时间戳截断", `{"elements":[{"id":"a","updated":1760000000123.9}]}`, 1760000000123},
		{"空元素", `{"elements":[]}`, 0},
		{"没有 elements 字段", `{"appState":{}}`, 0},
		{"非法 JSON", `{"elements":[`, 0},
		{"空输入", ``, 0},
	}
	for _, c := range cases {
		if got := sceneContentUpdatedMs([]byte(c.in)); got != c.want {
			t.Errorf("%s: got %d want %d", c.name, got, c.want)
		}
	}
}

// 关键语义：内容不变时，重复计算结果不变——房间清空强制落库不会刷新「最近修改」。
func TestSceneContentUpdatedMs_StableOnSameContent(t *testing.T) {
	s := []byte(`{"elements":[{"id":"a","updated":1700000000000}],"appState":{"scrollX":1}}`)
	s2 := []byte(`{"elements":[{"id":"a","updated":1700000000000}],"appState":{"scrollX":999}}`)
	if sceneContentUpdatedMs(s) != sceneContentUpdatedMs(s2) {
		t.Fatal("只有 appState 不同时，内容修改时间不应变化")
	}
}
