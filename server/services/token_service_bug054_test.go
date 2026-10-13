package services

import "testing"

// BUG-054：通用码学生 uuid 的派生必须与作业码大小写、姓名首尾空格无关，
// 否则 SubmitByToken 落库的 uuid 与 VerifyToken 反查的 uuid 对不上，
// 学生再次进入时被当成新学生、看不到自己的历史提交。
func TestUniversalStudentUUIDNormalizes(t *testing.T) {
	want := "token-AB3XK9PQ-张三"
	cases := []struct{ token, name string }{
		{"AB3XK9PQ", "张三"},
		{"ab3xk9pq", "张三"},
		{"Ab3xK9pQ", "张三"},
		{" AB3XK9PQ ", "张三"},
		{"AB3XK9PQ", " 张三 "},
		{"ab3xk9pq\n", "张三\t"},
	}
	for _, c := range cases {
		if got := universalStudentUUID(c.token, c.name); got != want {
			t.Errorf("universalStudentUUID(%q, %q) = %q, want %q", c.token, c.name, got, want)
		}
	}
	// 不同姓名仍然必须是不同身份（BUG-053 的隔离不能被规范化抹掉）
	if universalStudentUUID("AB3XK9PQ", "张三") == universalStudentUUID("AB3XK9PQ", "李四") {
		t.Error("不同姓名派生出了相同 uuid")
	}
}
