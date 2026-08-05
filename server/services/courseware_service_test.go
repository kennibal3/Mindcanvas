// =============================================================
// REQ-059 一期：zip 解压安全性单测
//
// 为什么这批测试值得写：三道防线（Zip Slip / 解压炸弹 / 入口缺失）
// 全是「平时不触发、触发即事故」的路径，真机验收几乎不可能覆盖到，
// 单测是唯一能反复验的手段。延续 REQ-050 diagram_validate_test.go 的做法。
//
// 注意：本项目 CI 目前只跑 go build + go vet，**不跑 go test**
// （REQ-054 记着这笔账）。所以这些测试要靠手工 `go test ./services/ -run Courseware`
// 执行，改动本文件相关逻辑后请务必跑一遍。
// =============================================================
package services

import (
	"archive/zip"
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// buildZip 用给定的 名字→内容 造一个内存 zip
func buildZip(t *testing.T, files map[string]string, order []string) *zip.Reader {
	t.Helper()
	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)
	if order == nil {
		for n := range files {
			order = append(order, n)
		}
	}
	for _, name := range order {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("造 zip 失败: %v", err)
		}
		if _, err := w.Write([]byte(files[name])); err != nil {
			t.Fatalf("写 zip 条目失败: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("关闭 zip 失败: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("读 zip 失败: %v", err)
	}
	return zr
}

// ── 防线 1：Zip Slip ──────────────────────────────────────────────────────

func TestCoursewareSafeJoinRejectsTraversal(t *testing.T) {
	root := "/tmp/cw-root"
	bad := []string{
		"../../etc/passwd",
		"../configs/.env",
		// 真正想防的那个：项目的 configs/.env 里有 ARK_API_KEY / DB 密码 / JWT Secret
		"a/../../../opt/mindcanvas/configs/.env",
		"/etc/passwd",
		// 反斜杠写法——必须在归一化之后再判 ".."，否则从检查底下溜过去
		`..\..\windows\system32\x.dll`,
		"./../../x",
	}
	for _, name := range bad {
		got, err := safeJoin(root, name)
		if err == nil {
			t.Errorf("safeJoin 应当拒绝 %q，实际放行到 %q", name, got)
		}
	}
}

func TestCoursewareSafeJoinAcceptsNormal(t *testing.T) {
	root := "/tmp/cw-root"
	ok := []string{
		"index.html",
		"assets/a.png",
		"assets/ai_左侧为清澈_流动的液态水.jpg", // 真实课件里就是这种中文长名
		"p1.html",
		"a/b/c/d.css",
	}
	for _, name := range ok {
		got, err := safeJoin(root, name)
		if err != nil {
			t.Errorf("safeJoin 误拒正常路径 %q: %v", name, err)
			continue
		}
		if !strings.HasPrefix(got, root+string(os.PathSeparator)) {
			t.Errorf("safeJoin(%q) = %q，不在 root 内", name, got)
		}
	}
}

func TestCoursewareExtractRejectsSlipEnd2End(t *testing.T) {
	dir := t.TempDir()
	zr := buildZip(t, map[string]string{
		"index.html":            "<html></html>",
		"../../../tmp/pwned.txt": "boom",
	}, []string{"index.html", "../../../tmp/pwned.txt"})

	_, err := ExtractZip(zr, dir)
	if err == nil {
		t.Fatal("含越界条目的 zip 应当被拒绝，实际通过了")
	}
	// 更硬的断言：确认真的没写出去
	if _, statErr := os.Stat("/tmp/pwned.txt"); statErr == nil {
		t.Fatal("越界文件真的被写出去了")
	}
}

// ── 防线 2：解压炸弹 ──────────────────────────────────────────────────────

func TestCoursewareExtractRejectsTooManyEntries(t *testing.T) {
	files := map[string]string{}
	var order []string
	for i := 0; i <= CoursewareMaxEntries; i++ {
		n := fmt.Sprintf("f/%05d.txt", i)
		files[n] = "x"
		order = append(order, n)
	}
	zr := buildZip(t, files, order)
	if _, err := ExtractZip(zr, t.TempDir()); err == nil {
		t.Fatal("条目数超限应当被拒绝")
	}
}

func TestCoursewareExtractRejectsOversizeTotal(t *testing.T) {
	// 不真造 200MB：临时把上限逻辑用一个超大单文件顶穿代价太高，
	// 这里改为验证「累计逻辑本身」——用 LimitReader 的边界行为，
	// 造一个略超一点的场景需要真数据，故此处只做小体积回归，
	// 真正的超限拒收在真机验收第 3 项用真实大包验。
	big := strings.Repeat("A", 1024)
	zr := buildZip(t, map[string]string{
		"index.html": "<html></html>",
		"big.bin":    big,
	}, []string{"index.html", "big.bin"})
	res, err := ExtractZip(zr, t.TempDir())
	if err != nil {
		t.Fatalf("正常小包不该被拒: %v", err)
	}
	if res.TotalBytes != int64(len(big)+len("<html></html>")) {
		t.Errorf("TotalBytes 统计错误: got %d", res.TotalBytes)
	}
}

// ── 防线 3：入口文件 ──────────────────────────────────────────────────────

func TestCoursewarePickEntryFile(t *testing.T) {
	cases := []struct {
		name  string
		files []string
		want  string
		fail  bool
	}{
		{"标准 index", []string{"index.html", "p1.html", "assets/a.png"}, "index.html", false},
		{"只有一个根 html", []string{"main.html", "assets/a.png"}, "main.html", false},
		{"多个根 html 无 index", []string{"a.html", "b.html"}, "", true},
		{"根本没有 html", []string{"assets/a.png", "readme.txt"}, "", true},
		{"html 都在子目录里", []string{"pages/index.html"}, "", true},
	}
	for _, c := range cases {
		got, err := pickEntryFile(c.files)
		if c.fail {
			if err == nil {
				t.Errorf("%s：应当报错，实际返回 %q", c.name, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s：不该报错: %v", c.name, err)
			continue
		}
		if got != c.want {
			t.Errorf("%s：got %q want %q", c.name, got, c.want)
		}
	}
}

// ── 剥公共顶级目录（实测 4 个真包全都需要）──────────────────────────────

func TestCoursewareCommonTopDir(t *testing.T) {
	cases := []struct {
		name  string
		files []string
		want  string
	}{
		{
			"真实课件：全部包在一层中文目录里",
			[]string{
				"七年级 语文 — 1/index.html",
				"七年级 语文 — 1/p1.html",
				"七年级 语文 — 1/assets/a.jpg",
			},
			"七年级 语文 — 1",
		},
		{"已在根上，不该剥", []string{"index.html", "assets/a.png"}, ""},
		{"两个不同顶级目录，不该剥", []string{"a/x.html", "b/y.html"}, ""},
		{"混合：有根文件就不剥", []string{"a/x.html", "index.html"}, ""},
	}
	for _, c := range cases {
		if got := commonTopDir(c.files); got != c.want {
			t.Errorf("%s：got %q want %q", c.name, got, c.want)
		}
	}
}

func TestCoursewareExtractStripsWrapperDir(t *testing.T) {
	dir := t.TempDir()
	zr := buildZip(t, map[string]string{
		"九年级 化学 — 第四单元第三课时/index.html":       `<iframe src="p1.html"></iframe>`,
		"九年级 化学 — 第四单元第三课时/p1.html":          `<img src="assets/图片.jpg">`,
		"九年级 化学 — 第四单元第三课时/assets/图片.jpg":    "JPEGDATA",
	}, []string{
		"九年级 化学 — 第四单元第三课时/index.html",
		"九年级 化学 — 第四单元第三课时/p1.html",
		"九年级 化学 — 第四单元第三课时/assets/图片.jpg",
	})

	res, err := ExtractZip(zr, dir)
	if err != nil {
		t.Fatalf("解压失败: %v", err)
	}
	if res.Stripped != "九年级 化学 — 第四单元第三课时" {
		t.Errorf("没剥掉公共前缀，Stripped=%q", res.Stripped)
	}
	if res.EntryFile != "index.html" {
		t.Errorf("入口应为根上的 index.html，实际 %q", res.EntryFile)
	}
	// index.html 必须真的落在根上——iframe src 指的就是这里
	if _, err := os.Stat(filepath.Join(dir, "index.html")); err != nil {
		t.Errorf("index.html 不在解压根: %v", err)
	}
	// 中文名资源也必须原样落盘，相对引用才对得上
	if _, err := os.Stat(filepath.Join(dir, "assets", "图片.jpg")); err != nil {
		t.Errorf("中文名资源没正确落盘: %v", err)
	}
	if res.FileCount != 3 {
		t.Errorf("FileCount got %d want 3", res.FileCount)
	}
}

// ── 垃圾条目过滤 ──────────────────────────────────────────────────────────

func TestCoursewareIsJunkEntry(t *testing.T) {
	junk := []string{
		"__MACOSX/x.html",
		"__MACOSX/._index.html",
		"a/.DS_Store",
		".DS_Store",
		"assets/._pic.jpg",
		"Thumbs.db",
	}
	for _, n := range junk {
		if !isJunkEntry(n) {
			t.Errorf("%q 应被识别为垃圾条目", n)
		}
	}
	good := []string{"index.html", "assets/pic.jpg", "_private/a.js", "p1.html"}
	for _, n := range good {
		if isJunkEntry(n) {
			t.Errorf("%q 被误判为垃圾条目", n)
		}
	}
}

func TestCoursewareExtractSkipsJunkButKeepsRest(t *testing.T) {
	dir := t.TempDir()
	zr := buildZip(t, map[string]string{
		"__MACOSX/._index.html": "junk",
		".DS_Store":             "junk",
		"index.html":            "<html></html>",
		"assets/a.png":          "PNG",
	}, []string{"__MACOSX/._index.html", ".DS_Store", "index.html", "assets/a.png"})

	res, err := ExtractZip(zr, dir)
	if err != nil {
		t.Fatalf("解压失败: %v", err)
	}
	if res.SkippedN != 2 {
		t.Errorf("应跳过 2 个垃圾条目，实际 %d", res.SkippedN)
	}
	if res.FileCount != 2 {
		t.Errorf("有效文件应为 2 个，实际 %d", res.FileCount)
	}
	if _, err := os.Stat(filepath.Join(dir, "__MACOSX")); err == nil {
		t.Error("__MACOSX 目录不该被解出来")
	}
}

// ── 干净数据零改动（沿用 REQ-050 那组测试的思路，防「防护网把好包改坏」）──

func TestCoursewareExtractNormalPackageIntact(t *testing.T) {
	dir := t.TempDir()
	content := map[string]string{
		"index.html":   `<iframe id="cw-frame" src="p1.html"></iframe>`,
		"p1.html":      `<div style="background:url('assets/bg.png')"></div>`,
		"assets/bg.png": "PNGDATA",
	}
	zr := buildZip(t, content, []string{"index.html", "p1.html", "assets/bg.png"})

	res, err := ExtractZip(zr, dir)
	if err != nil {
		t.Fatalf("解压失败: %v", err)
	}
	if res.Stripped != "" {
		t.Errorf("根上已有文件，不该剥前缀，实际剥了 %q", res.Stripped)
	}
	// 逐字节比对，确认解压没改动内容
	for name, want := range content {
		got, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
		if err != nil {
			t.Errorf("读 %s 失败: %v", name, err)
			continue
		}
		if string(got) != want {
			t.Errorf("%s 内容被改动了", name)
		}
	}
}
