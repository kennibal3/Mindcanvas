package services

import "testing"

// ============================================================
// REQ-050 一期B 修正 · 存活判定阈值单测
// 存活统计本体是 SQL（需要库），这里只锁纯函数的分档边界，
// 防止将来调阈值时把「留了一半」误判成「弃用」。
// 跑法：cd /opt/mindcanvas/server && go test ./services/ -run Survival -v
// ============================================================

func TestClassifySurvival(t *testing.T) {
	cases := []struct {
		name     string
		survived int
		total    int
		want     string
	}{
		{"全在＝老师认了", 100, 100, SurvivalKept},
		{"刚好 80% 算 kept", 80, 100, SurvivalKept},
		{"79% 落到部分保留", 79, 100, SurvivalPartiallyKept},
		{"留一半＝在此基础上改", 50, 100, SurvivalPartiallyKept},
		{"刚好 20% 仍算部分保留", 20, 100, SurvivalPartiallyKept},
		{"19% 判弃用", 19, 100, SurvivalDiscarded},
		{"一个都不剩＝插进去看了一眼就删", 0, 100, SurvivalDiscarded},
		{"分母为 0 无法判定", 0, 0, SurvivalUnknown},
		{"分母为负无法判定", 3, -1, SurvivalUnknown},
		{"小图全在", 3, 3, SurvivalKept},
	}
	for _, c := range cases {
		if got := ClassifySurvival(c.survived, c.total); got != c.want {
			t.Errorf("%s：%d/%d 得 %s，期望 %s", c.name, c.survived, c.total, got, c.want)
		}
	}
}
