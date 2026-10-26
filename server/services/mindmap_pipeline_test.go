package services

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
)

// ── 假模型 ──────────────────────────────────────────────────

type fakeCall struct {
	system string
	user   string
	temp   float64
}

type fakeLLM struct {
	mu    sync.Mutex
	calls []fakeCall
	// skeleton 依次返回的回复（用完后重复最后一个）
	skeletons []string
	// expand(branchName, attempt) 返回 (回复, 是否截断, 错误)；attempt 从 0 起，按分支名计数
	expand   func(branch string, attempt int) (string, bool, error)
	attempts map[string]int
	skelIdx  int
}

func branchOfUser(user string) string {
	const marker = "【本次要展开的分支】\n"
	i := strings.Index(user, marker)
	if i < 0 {
		return ""
	}
	rest := user[i+len(marker):]
	if j := strings.Index(rest, "\n"); j >= 0 {
		rest = rest[:j]
	}
	return strings.TrimSpace(rest)
}

func (f *fakeLLM) call(ctx context.Context, system, user string, maxTokens int, temp float64) (string, bool, error) {
	f.mu.Lock()
	f.calls = append(f.calls, fakeCall{system, user, temp})
	if f.attempts == nil {
		f.attempts = map[string]int{}
	}
	if system == mindmapSkeletonPrompt {
		idx := f.skelIdx
		if idx >= len(f.skeletons) {
			idx = len(f.skeletons) - 1
		}
		f.skelIdx++
		raw := f.skeletons[idx]
		f.mu.Unlock()
		return raw, false, nil
	}
	b := branchOfUser(user)
	at := f.attempts[b]
	f.attempts[b]++
	f.mu.Unlock()
	return f.expand(b, at)
}

func (f *fakeLLM) expandCalls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.calls {
		if c.system == mindmapExpandPrompt {
			n++
		}
	}
	return n
}

const skel3 = `框架：问题解决
# ♻️ 社区垃圾分类推进方案
## 📊 现状
## ⚠️ 主要问题
## 🛠 对策措施`

// 一个合格分支：3 个二级要点、过半有说明
func goodBranch(tag string) string {
	return "- ★ 🅰 要点" + tag + "一 :: 材料里的原话\n" +
		"  - 子要点" + tag + " :: 细节\n" +
		"- 要点" + tag + "二 :: （补充）一个例子\n" +
		"- 要点" + tag + "三\n"
}

// 一个不合格分支：只有 1 个二级要点
const thinBranch = "- 唯一的要点\n"

func okExpand(branch string, attempt int) (string, bool, error) {
	return goodBranch(branch[len([]rune(branch))-2:]), false, nil
}

// ── 骨架解析 ────────────────────────────────────────────────

func TestParseSkeleton(t *testing.T) {
	cases := []struct {
		name      string
		raw       string
		framework string
		root      string
		branches  []string
		wantErr   bool
	}{
		{"标准", skel3, "问题解决", "♻️ 社区垃圾分类推进方案", []string{"📊 现状", "⚠️ 主要问题", "🛠 对策措施"}, false},
		{"带代码围栏", "```\n" + skel3 + "\n```", "问题解决", "♻️ 社区垃圾分类推进方案", []string{"📊 现状", "⚠️ 主要问题", "🛠 对策措施"}, false},
		{"全角冒号", "框架：时间脉络\n# 计划\n## 一\n## 二", "时间脉络", "计划", []string{"一", "二"}, false},
		{"没写框架行不致命", "# 主题\n## 甲\n## 乙", "", "主题", []string{"甲", "乙"}, false},
		{"用列表代替二级标题", "框架：自然主题\n# 主题\n- 甲\n- 乙\n- 丙", "自然主题", "主题", []string{"甲", "乙", "丙"}, false},
		{"去重（忽略空白与标点）", "# 主题\n## 现状\n## 现 状\n## 对策，", "", "主题", []string{"现状", "对策，"}, false},
		{"粗体标记被清掉", "# **主题**\n## **甲**\n## 乙", "", "主题", []string{"甲", "乙"}, false},
		{"三级标题不当分支", "# 主题\n## 甲\n### 子\n## 乙", "", "主题", []string{"甲", "乙"}, false},
		{"没有中心主题", "## 甲\n## 乙", "", "", nil, true},
		{"分支不足", "# 主题\n## 甲", "", "", nil, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			sk, err := parseMindmapSkeleton(c.raw)
			if c.wantErr {
				if err == nil {
					t.Fatalf("应报错，实际 %+v", sk)
				}
				return
			}
			if err != nil {
				t.Fatalf("不应报错: %v", err)
			}
			if sk.Framework != c.framework || sk.Root != c.root {
				t.Errorf("framework/root = %q/%q，期望 %q/%q", sk.Framework, sk.Root, c.framework, c.root)
			}
			if strings.Join(sk.Branches, "|") != strings.Join(c.branches, "|") {
				t.Errorf("branches = %v，期望 %v", sk.Branches, c.branches)
			}
		})
	}
}

func TestParseSkeleton_BranchCap(t *testing.T) {
	var b strings.Builder
	b.WriteString("# 主题\n")
	for i := 0; i < 12; i++ {
		b.WriteString("## 分支" + string(rune('A'+i)) + "\n")
	}
	sk, err := parseMindmapSkeleton(b.String())
	if err != nil {
		t.Fatal(err)
	}
	if len(sk.Branches) != mindmapMaxBranches {
		t.Fatalf("分支数 %d，期望封顶 %d", len(sk.Branches), mindmapMaxBranches)
	}
}

// ── 条目解析 ────────────────────────────────────────────────

func TestParseItemText(t *testing.T) {
	cases := []struct {
		in    string
		label string
		note  string
		emph  bool
	}{
		{"要点 :: 说明", "要点", "说明", false},
		{"要点::说明", "要点", "说明", false},
		{"要点：：说明", "要点", "说明", false},
		{"要点  ::  说明", "要点", "说明", false},
		{"★ 重点 :: 说明", "重点", "说明", true},
		{"重点 ★", "重点", "", true},
		{"🌱 带图标 :: 例", "🌱 带图标", "例", false},
		{"**粗体**标签", "粗体标签", "", false},
		{"说明里有 :: 两个 :: 分隔", "说明里有", "两个 :: 分隔", false},
		{"没有说明", "没有说明", "", false},
	}
	for _, c := range cases {
		l, n, e := parseMindmapItemText(c.in)
		if l != c.label || n != c.note || e != c.emph {
			t.Errorf("%q → (%q,%q,%v)，期望 (%q,%q,%v)", c.in, l, n, e, c.label, c.note, c.emph)
		}
	}
}

func TestParseBranch(t *testing.T) {
	t.Run("相对缩进判层级：4 空格也算三级", func(t *testing.T) {
		items, _ := parseMindmapBranch("- 甲\n    - 甲一\n- 乙")
		if len(items) != 3 || items[0].Level != 2 || items[1].Level != 3 || items[2].Level != 2 {
			t.Fatalf("%+v", items)
		}
	})
	t.Run("整体缩进也能识别：首条缩进当基准", func(t *testing.T) {
		items, _ := parseMindmapBranch("  - 甲\n    - 甲一\n  - 乙")
		if len(items) != 3 || items[0].Level != 2 || items[1].Level != 3 {
			t.Fatalf("%+v", items)
		}
	})
	t.Run("编号列表与客套话", func(t *testing.T) {
		items, _ := parseMindmapBranch("好的，下面是内容：\n1. 甲 :: 说明\n2. 乙\n以上。")
		if len(items) != 2 || items[0].Note != "说明" {
			t.Fatalf("%+v", items)
		}
	})
	t.Run("代码围栏被忽略", func(t *testing.T) {
		items, _ := parseMindmapBranch("```markdown\n- 甲\n- 乙\n```")
		if len(items) != 2 {
			t.Fatalf("%+v", items)
		}
	})
	t.Run("首条是三级则提升为二级", func(t *testing.T) {
		items, _ := parseMindmapBranch("    - 甲\n- 乙")
		if items[0].Level != 2 {
			t.Fatalf("%+v", items)
		}
	})
	t.Run("硬上限与丢弃计数", func(t *testing.T) {
		var b strings.Builder
		for i := 0; i < mindmapHardCapItems+5; i++ {
			b.WriteString("- 要点" + string(rune('a'+i%26)) + string(rune('A'+i/26)) + "\n")
		}
		items, dropped := parseMindmapBranch(b.String())
		if len(items) != mindmapHardCapItems || dropped != 5 {
			t.Fatalf("len=%d dropped=%d", len(items), dropped)
		}
	})
	t.Run("空标签被跳过", func(t *testing.T) {
		items, _ := parseMindmapBranch("- :: 只有说明\n- 甲")
		if len(items) != 1 || items[0].Label != "甲" {
			t.Fatalf("%+v", items)
		}
	})
}

func TestFormatRoundTrip(t *testing.T) {
	in := "- ★ 🅰 甲 :: 说明\n  - 子 :: 细节\n- 乙\n"
	items, _ := parseMindmapBranch(in)
	if got := formatMindmapItems(items); got != in {
		t.Fatalf("往返不一致:\n%q\n%q", got, in)
	}
}

// ── 体检 ────────────────────────────────────────────────────

func TestAssessBranch(t *testing.T) {
	good, _ := parseMindmapBranch(goodBranch("甲"))
	if is := assessMindmapBranch(good); len(is) != 0 {
		t.Fatalf("合格分支不应有问题: %v", is)
	}
	thin, _ := parseMindmapBranch(thinBranch)
	if is := assessMindmapBranch(thin); len(is) == 0 || !strings.Contains(is[0], "太少") {
		t.Fatalf("单要点应报「太少」: %v", is)
	}
	noNote, _ := parseMindmapBranch("- 甲\n- 乙\n- 丙")
	if is := assessMindmapBranch(noNote); len(is) != 1 || !strings.Contains(is[0], "说明") {
		t.Fatalf("无说明应报一条: %v", is)
	}
	long, _ := parseMindmapBranch("- " + strings.Repeat("长", 30) + " :: x\n- 乙 :: y")
	if is := assessMindmapBranch(long); len(is) != 1 || !strings.Contains(is[0], "标签太长") {
		t.Fatalf("长标签: %v", is)
	}
	longNote, _ := parseMindmapBranch("- 甲 :: " + strings.Repeat("说", 70) + "\n- 乙 :: y")
	if is := assessMindmapBranch(longNote); len(is) != 1 || !strings.Contains(is[0], "说明太长") {
		t.Fatalf("长说明: %v", is)
	}
	dup, _ := parseMindmapBranch("- 甲 :: x\n- 甲 :: y\n- 乙 :: z")
	if is := assessMindmapBranch(dup); len(is) != 1 || !strings.Contains(is[0], "重复") {
		t.Fatalf("重复: %v", is)
	}
}

// ── 流水线 ──────────────────────────────────────────────────

func TestPipeline_Happy(t *testing.T) {
	f := &fakeLLM{skeletons: []string{skel3}, expand: okExpand}
	var events []MindmapEvent
	res, err := RunMindmapPipeline(context.Background(), f.call, strings.Repeat("社区垃圾分类材料。", 20), func(e MindmapEvent) {
		events = append(events, e)
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Branches != 3 || res.Framework != "问题解决" || res.Flagged != 0 || res.Rewritten != 0 {
		t.Fatalf("%+v", res)
	}
	if f.expandCalls() != 3 {
		t.Fatalf("展开调用 %d 次，期望 3（无需重写）", f.expandCalls())
	}
	if !strings.HasPrefix(res.Outline, "# ♻️ 社区垃圾分类推进方案\n\n## 📊 现状\n- ★ ") {
		t.Fatalf("大纲开头不对:\n%s", res.Outline)
	}
	if res.SupplementNotes != 3 {
		t.Fatalf("补充说明数 %d，期望 3", res.SupplementNotes)
	}
	// 节点数 = 1 根 + 3 分支 + 每分支 4 条
	if res.Nodes != 1+3+3*4 {
		t.Fatalf("节点数 %d", res.Nodes)
	}
	// 进度事件：skeleton 两条（开始/完成）、expand 三条且 Done 严格递增
	var doneSeq []int
	for _, e := range events {
		if e.Stage == "expand" {
			doneSeq = append(doneSeq, e.Done)
		}
	}
	if len(doneSeq) != 3 || doneSeq[0] != 1 || doneSeq[1] != 2 || doneSeq[2] != 3 {
		t.Fatalf("expand 进度应为 1,2,3: %v", doneSeq)
	}
	if events[0].Stage != "skeleton" || events[1].Framework != "问题解决" || len(events[1].Branches) != 3 {
		t.Fatalf("skeleton 事件不对: %+v", events[:2])
	}
}

func TestPipeline_TemperaturesDiffer(t *testing.T) {
	f := &fakeLLM{skeletons: []string{skel3}, expand: okExpand}
	if _, err := RunMindmapPipeline(context.Background(), f.call, strings.Repeat("材料", 30), nil); err != nil {
		t.Fatal(err)
	}
	for _, c := range f.calls {
		if c.system == mindmapSkeletonPrompt && c.temp != mindmapSkeletonTemp {
			t.Errorf("骨架温度 %v", c.temp)
		}
		if c.system == mindmapExpandPrompt && c.temp != mindmapExpandTemp {
			t.Errorf("展开温度 %v", c.temp)
		}
	}
}

func TestPipeline_RewriteAdopted(t *testing.T) {
	f := &fakeLLM{skeletons: []string{skel3}}
	f.expand = func(branch string, attempt int) (string, bool, error) {
		if strings.Contains(branch, "现状") {
			if attempt == 0 {
				return thinBranch, false, nil // 首版不合格
			}
			return goodBranch("现"), false, nil // 重写后合格
		}
		return okExpand(branch, attempt)
	}
	res, err := RunMindmapPipeline(context.Background(), f.call, strings.Repeat("材料", 30), nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Flagged != 1 || res.Rewritten != 1 {
		t.Fatalf("flagged=%d rewritten=%d", res.Flagged, res.Rewritten)
	}
	if strings.Contains(res.Outline, "唯一的要点") {
		t.Fatalf("应采纳重写版:\n%s", res.Outline)
	}
	// 重写调用必须带上缺项说明与上一版
	var rewrite *fakeCall
	for i, c := range f.calls {
		if c.system == mindmapExpandPrompt && strings.Contains(c.user, "【上一版存在的问题") {
			rewrite = &f.calls[i]
		}
	}
	if rewrite == nil || !strings.Contains(rewrite.user, "二级要点太少") || !strings.Contains(rewrite.user, "唯一的要点") {
		t.Fatalf("重写提示缺少缺项或上一版: %+v", rewrite)
	}
	if rewrite.temp != mindmapRewriteTemp {
		t.Errorf("重写温度 %v", rewrite.temp)
	}
}

func TestPipeline_RewriteNotAdoptedWhenNotBetter(t *testing.T) {
	f := &fakeLLM{skeletons: []string{skel3}}
	f.expand = func(branch string, attempt int) (string, bool, error) {
		if strings.Contains(branch, "现状") {
			if attempt == 0 {
				return thinBranch, false, nil
			}
			return "- 另一个单要点\n", false, nil // 重写后仍然只有 1 个：没变好
		}
		return okExpand(branch, attempt)
	}
	res, err := RunMindmapPipeline(context.Background(), f.call, strings.Repeat("材料", 30), nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Flagged != 1 || res.Rewritten != 0 {
		t.Fatalf("flagged=%d rewritten=%d", res.Flagged, res.Rewritten)
	}
	if !strings.Contains(res.Outline, "唯一的要点") || strings.Contains(res.Outline, "另一个单要点") {
		t.Fatalf("没变好应保留原版:\n%s", res.Outline)
	}
}

func TestPipeline_RewriteFailureKeepsOriginal(t *testing.T) {
	f := &fakeLLM{skeletons: []string{skel3}}
	f.expand = func(branch string, attempt int) (string, bool, error) {
		if strings.Contains(branch, "现状") {
			if attempt == 0 {
				return thinBranch, false, nil
			}
			return "", false, errors.New("上游 500")
		}
		return okExpand(branch, attempt)
	}
	res, err := RunMindmapPipeline(context.Background(), f.call, strings.Repeat("材料", 30), nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Rewritten != 0 || !strings.Contains(res.Outline, "唯一的要点") {
		t.Fatalf("重写失败应保留原版:\n%s", res.Outline)
	}
}

func TestPipeline_SomeBranchesFail(t *testing.T) {
	f := &fakeLLM{skeletons: []string{"# 主题\n## 甲甲\n## 乙乙\n## 丙丙\n## 丁丁"}}
	f.expand = func(branch string, attempt int) (string, bool, error) {
		if strings.Contains(branch, "乙乙") {
			return "", false, errors.New("上游超时")
		}
		return okExpand(branch, attempt)
	}
	res, err := RunMindmapPipeline(context.Background(), f.call, strings.Repeat("材料", 30), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.FailedBranches) != 1 || res.FailedBranches[0] != "乙乙" {
		t.Fatalf("%+v", res.FailedBranches)
	}
	if !strings.Contains(res.Outline, "## 乙乙\n\n## 丙丙") {
		t.Fatalf("失败分支应只留标题:\n%s", res.Outline)
	}
	found := false
	for _, w := range res.Warnings {
		if strings.Contains(w, "乙乙") && strings.Contains(w, "失败") {
			found = true
		}
	}
	if !found {
		t.Fatalf("失败必须进 Warnings（不能静默）: %v", res.Warnings)
	}
}

func TestPipeline_MostBranchesFailIsError(t *testing.T) {
	f := &fakeLLM{skeletons: []string{skel3}}
	f.expand = func(branch string, attempt int) (string, bool, error) {
		if strings.Contains(branch, "现状") {
			return goodBranch("现"), false, nil
		}
		return "", false, errors.New("429")
	}
	_, err := RunMindmapPipeline(context.Background(), f.call, strings.Repeat("材料", 30), nil)
	var me *MindmapError
	if !errors.As(err, &me) || me.Stage != "expand" {
		t.Fatalf("多数分支失败应返回 expand 阶段错误: %v", err)
	}
}

func TestPipeline_TruncationDropsLastLineAndWarns(t *testing.T) {
	f := &fakeLLM{skeletons: []string{skel3}}
	f.expand = func(branch string, attempt int) (string, bool, error) {
		if strings.Contains(branch, "现状") {
			return "- 完整一 :: 说明\n- 完整二 :: 说明\n- 完整三 :: 说明\n- 写到一半的要点 :: 这句话没写完就", true, nil
		}
		return okExpand(branch, attempt)
	}
	res, err := RunMindmapPipeline(context.Background(), f.call, strings.Repeat("材料", 30), nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(res.Outline, "写到一半") {
		t.Fatalf("被截断的最后一行应丢弃:\n%s", res.Outline)
	}
	if len(res.TruncatedBranches) != 1 {
		t.Fatalf("%+v", res.TruncatedBranches)
	}
	found := false
	for _, w := range res.Warnings {
		if strings.Contains(w, "截断") {
			found = true
		}
	}
	if !found {
		t.Fatalf("截断必须进 Warnings: %v", res.Warnings)
	}
}

func TestPipeline_SkeletonRetryThenOK(t *testing.T) {
	f := &fakeLLM{skeletons: []string{"我觉得可以这样分：甲、乙、丙", skel3}, expand: okExpand}
	res, err := RunMindmapPipeline(context.Background(), f.call, strings.Repeat("材料", 30), nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Branches != 3 {
		t.Fatalf("%+v", res)
	}
	var second string
	n := 0
	for _, c := range f.calls {
		if c.system == mindmapSkeletonPrompt {
			n++
			second = c.user
		}
	}
	if n != 2 || !strings.Contains(second, "上一次的输出格式不对") {
		t.Fatalf("骨架应重试一次并带上原因: n=%d user=%q", n, second)
	}
}

func TestPipeline_SkeletonAlwaysBad(t *testing.T) {
	f := &fakeLLM{skeletons: []string{"不是约定的格式"}, expand: okExpand}
	_, err := RunMindmapPipeline(context.Background(), f.call, strings.Repeat("材料", 30), nil)
	var me *MindmapError
	if !errors.As(err, &me) || me.Stage != "skeleton" {
		t.Fatalf("%v", err)
	}
	if f.expandCalls() != 0 {
		t.Fatal("骨架失败后不应继续展开")
	}
}

type customErr struct{}

func (customErr) Error() string { return "上游错误" }

func TestPipeline_LLMErrorKeepsCause(t *testing.T) {
	llm := func(ctx context.Context, s, u string, m int, tp float64) (string, bool, error) {
		return "", false, customErr{}
	}
	_, err := RunMindmapPipeline(context.Background(), llm, strings.Repeat("材料", 30), nil)
	var ce customErr
	if !errors.As(err, &ce) {
		t.Fatalf("应能用 errors.As 取回原始错误（handler 据此映射文案）: %v", err)
	}
}

func TestPipeline_TooThin(t *testing.T) {
	f := &fakeLLM{skeletons: []string{"# 主题\n## 甲\n## 乙"}}
	f.expand = func(branch string, attempt int) (string, bool, error) { return "- 一\n", false, nil }
	_, err := RunMindmapPipeline(context.Background(), f.call, strings.Repeat("材料", 30), nil)
	var me *MindmapError
	if !errors.As(err, &me) || me.Stage != "thin" {
		t.Fatalf("节点过少应判 thin: %v", err)
	}
}

func TestPipeline_TopicMode(t *testing.T) {
	f := &fakeLLM{skeletons: []string{skel3}, expand: okExpand}
	if _, err := RunMindmapPipeline(context.Background(), f.call, "光合作用", nil); err != nil {
		t.Fatal(err)
	}
	for _, c := range f.calls {
		if !strings.Contains(c.user, "【主题模式】") {
			t.Fatalf("短输入应带主题模式提示: %q", c.user)
		}
	}
	f2 := &fakeLLM{skeletons: []string{skel3}, expand: okExpand}
	if _, err := RunMindmapPipeline(context.Background(), f2.call, strings.Repeat("长材料。", 30), nil); err != nil {
		t.Fatal(err)
	}
	for _, c := range f2.calls {
		if strings.Contains(c.user, "【主题模式】") {
			t.Fatalf("长输入不应带主题模式提示")
		}
	}
}

func TestPipeline_ExpandUserCarriesSkeleton(t *testing.T) {
	f := &fakeLLM{skeletons: []string{skel3}, expand: okExpand}
	if _, err := RunMindmapPipeline(context.Background(), f.call, strings.Repeat("材料正文。", 20), nil); err != nil {
		t.Fatal(err)
	}
	for _, c := range f.calls {
		if c.system != mindmapExpandPrompt {
			continue
		}
		for _, want := range []string{"材料正文。", "中心：♻️ 社区垃圾分类推进方案", "框架：问题解决", "1. 📊 现状", "3. 🛠 对策措施"} {
			if !strings.Contains(c.user, want) {
				t.Fatalf("展开消息缺少 %q:\n%s", want, c.user)
			}
		}
	}
}

func TestPipeline_Cancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	f := &fakeLLM{skeletons: []string{skel3}}
	f.expand = func(branch string, attempt int) (string, bool, error) {
		cancel()
		return okExpand(branch, attempt)
	}
	_, err := RunMindmapPipeline(ctx, f.call, strings.Repeat("材料", 30), nil)
	if err == nil {
		t.Fatal("取消后应返回错误")
	}
}

func TestPipeline_EmptyMaterial(t *testing.T) {
	f := &fakeLLM{skeletons: []string{skel3}, expand: okExpand}
	if _, err := RunMindmapPipeline(context.Background(), f.call, "   \n ", nil); err == nil {
		t.Fatal("空材料应报错")
	}
	if len(f.calls) != 0 {
		t.Fatal("空材料不应调用模型")
	}
}

// ── 前后端共享样例 ──────────────────────────────────────────

// contracts/mindmap_outline.json：Go 流水线产出的大纲，前端 markdownToDiagram 必须能原样吃下。
// 两端各有一个测试读同一份文件——大纲语法（::、★、层级）任何一端改了，另一端的测试就红。
type outlineContract struct {
	Outline string `json:"outline"`
	Expect  struct {
		Nodes    int               `json:"nodes"`
		Emphasis []string          `json:"emphasis"`
		Notes    map[string]string `json:"notes"`
	} `json:"expect"`
}

func contractPath(t *testing.T) string {
	for _, p := range []string{"../../contracts/mindmap_outline.json", "../contracts/mindmap_outline.json"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	t.Fatal("找不到 contracts/mindmap_outline.json")
	return ""
}

func TestOutlineContract(t *testing.T) {
	raw, err := os.ReadFile(contractPath(t))
	if err != nil {
		t.Fatal(err)
	}
	var fx outlineContract
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	f := &fakeLLM{skeletons: []string{"框架：问题解决\n# 🔬 样例主题\n## 🌱 甲\n## 💡 乙"}}
	f.expand = func(branch string, attempt int) (string, bool, error) {
		if strings.Contains(branch, "甲") {
			return "- ★ 🅰 核心概念 :: 材料里的原话\n  - 细分一 :: 例：一个具体例子\n- 🅱 方法 :: （补充）建议的做法\n- 其他要点\n", false, nil
		}
		return "- 🔁 流程 :: 先做甲再做乙\n- ★ 🎯 目标 :: 数字：3 个月内完成\n- 📌 注意事项\n", false, nil
	}
	res, err := RunMindmapPipeline(context.Background(), f.call, strings.Repeat("材料。", 30), nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Outline != fx.Outline {
		t.Fatalf("流水线输出与共享样例不一致（改了大纲语法？须同步前端并更新样例）:\n--- 实际 ---\n%s\n--- 样例 ---\n%s", res.Outline, fx.Outline)
	}
	if res.Nodes != fx.Expect.Nodes {
		t.Fatalf("节点数 %d，样例声明 %d", res.Nodes, fx.Expect.Nodes)
	}
}

// ── ★ 总量上限 ──────────────────────────────────────────────

func TestCapEmphasis(t *testing.T) {
	mk := func(flags ...bool) branchResult {
		var r branchResult
		for _, f := range flags {
			r.items = append(r.items, mmItem{Level: 2, Label: "x", Emphasis: f})
		}
		return r
	}
	rs := []branchResult{mk(true, false, true), mk(true, true), {err: errors.New("失败"), items: []mmItem{{Emphasis: true}}}, mk(true)}
	dropped := capMindmapEmphasis(rs, 3)
	if dropped != 2 {
		t.Fatalf("应去掉 2 个，实际 %d", dropped)
	}
	// 按出现顺序保留前 3 个：分支0 的两个 + 分支1 的第一个
	if !rs[0].items[0].Emphasis || !rs[0].items[2].Emphasis || !rs[1].items[0].Emphasis {
		t.Fatal("前 3 个应保留")
	}
	if rs[1].items[1].Emphasis || rs[3].items[0].Emphasis {
		t.Fatal("超出的应去掉")
	}
	if !rs[2].items[0].Emphasis {
		t.Fatal("失败分支不参与计数、不被修改")
	}
}

func TestEmphasisCapValue(t *testing.T) {
	for in, want := range map[int]int{2: 3, 4: 3, 5: 3, 6: 3, 7: 4, 8: 4} {
		if got := mindmapEmphasisCap(in); got != want {
			t.Errorf("cap(%d)=%d 期望 %d", in, got, want)
		}
	}
}

func TestPipeline_EmphasisCappedAndTopicModeFlag(t *testing.T) {
	// goodBranch 每个分支带 1 个 ★；8 个分支 → 上限 4
	var sk strings.Builder
	sk.WriteString("# 主题\n")
	for i := 0; i < 8; i++ {
		sk.WriteString("## 分支" + string(rune('甲'+i)) + string(rune('甲'+i)) + "\n")
	}
	f := &fakeLLM{skeletons: []string{sk.String()}, expand: okExpand}
	res, err := RunMindmapPipeline(context.Background(), f.call, strings.Repeat("长材料。", 30), nil)
	if err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(res.Outline, "★"); n != 4 {
		t.Fatalf("★ 应封顶 4 个，实际 %d", n)
	}
	if res.EmphasisDropped != 4 || res.TopicMode {
		t.Fatalf("%+v", res)
	}
	res2, err := RunMindmapPipeline(context.Background(), (&fakeLLM{skeletons: []string{skel3}, expand: okExpand}).call, "光合作用", nil)
	if err != nil || !res2.TopicMode {
		t.Fatalf("短输入应标记 TopicMode: %v %+v", err, res2)
	}
}
