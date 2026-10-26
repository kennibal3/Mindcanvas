package services

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"unicode/utf8"
)

// ============================================================
// REQ-068 二期：思维导图三阶段流水线（骨架 → 并行展开 → 定向重写）
//
// 本文件只依赖标准库：模型调用被抽象成 MindmapLLM，因此可以用假模型对
// 解析、体检、组装、降级这些纯逻辑做单元测试；真实调用在 mindmap_service.go 里接。
//
// 三条设计原则（均来自本项目踩过的坑）：
//  1. 「体检」由代码做，不让弱模型自评——有没有说明、要点够不够，代码查得出来，
//     模型只负责按明确的缺项去补。
//  2. 重写只在「确实变好」时才采纳（体检问题数严格减少），否则保留原版。
//  3. 失败必须看得见：某个分支展开失败/被截断，要进 Warnings，不能静默吞掉
//     （REQ-050/057 的「上游已报失败、代码不读」是同一类病）。
// ============================================================

const (
	mindmapMaxBranches        = 8  // 骨架阶段最多接受的分支数（提示词要求 4–7，留一点余量）
	mindmapMinBranches        = 2  // 少于它说明骨架没解析对
	mindmapConcurrency        = 4  // 展开/重写阶段的并发上限
	mindmapHardCapItems       = 18 // 单个分支保留的行数硬上限（提示词要求 ≤14）
	mindmapLabelMaxRunes      = 24 // 标签超过它视为过长（提示词要求 ≤18，留余量）
	mindmapNoteMaxRunes       = 60 // 说明超过它视为过长（提示词要求 ≤40）
	mindmapTopicModeMaxRunes  = 40 // 输入少于它视为「只给了主题」
	mindmapMinTotalNodes      = 6  // 整张图少于它视为太单薄，交给降级
	mindmapSkeletonMaxTokens  = 700
	mindmapExpandMaxTokens    = 1500
	mindmapSkeletonTemp       = 0.3
	mindmapExpandTemp         = 0.6
	mindmapRewriteTemp        = 0.5
	mindmapSkeletonAttempts   = 2
	mindmapMaxFailedBranchPct = 50 // 失败分支占比超过它整体判失败
)

// MindmapLLM 一次模型调用。truncated＝输出撞到 max_tokens 被砍断。
type MindmapLLM func(ctx context.Context, system, user string, maxTokens int, temperature float64) (content string, truncated bool, err error)

// MindmapEvent 流水线进度事件（给 SSE 用）
type MindmapEvent struct {
	Stage     string   `json:"stage"` // skeleton | expand | review
	Message   string   `json:"message"`
	Done      int      `json:"done,omitempty"`
	Total     int      `json:"total,omitempty"`
	Framework string   `json:"framework,omitempty"`
	Branches  []string `json:"branches,omitempty"`
}

// MindmapResult 流水线结果
type MindmapResult struct {
	Outline           string // 缩进大纲，前端 markdownToDiagram 直接吃
	Framework         string
	Root              string
	Branches          int
	Nodes             int
	Rewritten         int      // 被定向重写并采纳的分支数
	Flagged           int      // 体检不合格、触发重写的分支数
	SupplementNotes   int      // 以「（补充）」开头的说明条数（AI 补充、非原文）
	TopicMode         bool     // 输入只有主题没有正文：内容全部来自模型常识
	EmphasisDropped   int      // 超出全图 ★ 上限、被去掉的数量
	SupplementDropped int      // 事实类材料里模型违规补充、被代码剔除的条数
	FailedBranches    []string // 展开失败的分支名
	TruncatedBranches []string // 被截断的分支名
	Warnings          []string // 面向老师的人话提示
}

// MindmapError 流水线失败。Stage 指出失败在哪一步；Cause 可能是 *RefineError，
// handler 用 errors.As 取出来映射文案。
type MindmapError struct {
	Stage string // skeleton | expand | thin
	Msg   string
	Cause error
}

func (e *MindmapError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("mindmap %s: %s: %v", e.Stage, e.Msg, e.Cause)
	}
	return fmt.Sprintf("mindmap %s: %s", e.Stage, e.Msg)
}

func (e *MindmapError) Unwrap() error { return e.Cause }

// ────────────────────────────────────────────────────────────
// 骨架解析
// ────────────────────────────────────────────────────────────

type mindmapSkeleton struct {
	Framework string
	Root      string
	Branches  []string
}

var (
	reSkelFramework = regexp.MustCompile(`^\s*框架\s*[:：]\s*(.+?)\s*$`)
	reSkelH1        = regexp.MustCompile(`^\s*#\s+(.+?)\s*#*\s*$`)
	reSkelH2        = regexp.MustCompile(`^\s*##\s+(.+?)\s*#*\s*$`)
	reSkelList      = regexp.MustCompile(`^\s*(?:[-*+]|\d+[.)、])\s+(.+?)\s*$`)
	reFenceLine     = regexp.MustCompile("^\\s*(```|~~~)")
)

// cleanLabel 去掉模型偶尔带上的行内 Markdown 标记与首尾空白。
func cleanLabel(s string) string {
	s = strings.ReplaceAll(s, "**", "")
	s = strings.ReplaceAll(s, "__", "")
	s = strings.ReplaceAll(s, "`", "")
	return strings.TrimSpace(s)
}

// labelKey 用于去重比较：忽略空白、大小写与常见标点。
func labelKey(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r == ' ' || r == '\t' || r == '　':
		case strings.ContainsRune("，。、；：！？,.;:!?（）()「」『』“”\"'·-—", r):
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// parseMindmapSkeleton 从骨架阶段的回复里取出框架、中心主题和主分支。
// 宽容两种常见的偏差：多带代码围栏；用列表项代替「## 」。
func parseMindmapSkeleton(raw string) (mindmapSkeleton, error) {
	var sk mindmapSkeleton
	var h2s, lists []string
	for _, line := range strings.Split(raw, "\n") {
		if reFenceLine.MatchString(line) {
			continue
		}
		if m := reSkelFramework.FindStringSubmatch(line); m != nil && sk.Framework == "" {
			sk.Framework = cleanLabel(m[1])
			continue
		}
		if m := reSkelH2.FindStringSubmatch(line); m != nil {
			h2s = append(h2s, cleanLabel(m[1]))
			continue
		}
		if m := reSkelH1.FindStringSubmatch(line); m != nil {
			if sk.Root == "" {
				sk.Root = cleanLabel(m[1])
			}
			continue
		}
		if m := reSkelList.FindStringSubmatch(line); m != nil {
			lists = append(lists, cleanLabel(m[1]))
		}
	}
	branches := h2s
	if len(branches) == 0 {
		branches = lists
	}
	seen := map[string]bool{}
	for _, b := range branches {
		k := labelKey(b)
		if b == "" || k == "" || seen[k] {
			continue
		}
		seen[k] = true
		sk.Branches = append(sk.Branches, b)
		if len(sk.Branches) >= mindmapMaxBranches {
			break
		}
	}
	if sk.Root == "" {
		return sk, errors.New("没有找到「# 中心主题」那一行")
	}
	if len(sk.Branches) < mindmapMinBranches {
		return sk, fmt.Errorf("只解析出 %d 个主分支（需要用「## 分支名」逐行列出）", len(sk.Branches))
	}
	return sk, nil
}

// ────────────────────────────────────────────────────────────
// 分支条目解析 / 规范化输出
// ────────────────────────────────────────────────────────────

type mmItem struct {
	Level    int // 2＝二级要点，3＝三级要点
	Label    string
	Note     string
	Emphasis bool
}

var (
	reItemLine = regexp.MustCompile(`^(\s*)(?:[-*+]|\d+[.)、])\s+(.*)$`)
	// 模型常把 " :: " 写成 "::"、"：：" 或只在一侧留空格，统一归一
	reNoteSep = regexp.MustCompile(`\s*(?:::|：：)\s*`)
)

// parseMindmapItemText 解析一行里的 [★ ]标签[ :: 说明]。与前端 parseItemText 的约定一致：
// ★ 在行首或行尾都认；说明以首个 :: 为界。
func parseMindmapItemText(text string) (label, note string, emphasis bool) {
	s := strings.TrimSpace(text)
	s = strings.ReplaceAll(s, "**", "")
	s = strings.ReplaceAll(s, "`", "")
	if strings.HasPrefix(s, "★") {
		emphasis = true
		s = strings.TrimSpace(strings.TrimPrefix(s, "★"))
	} else if strings.HasSuffix(s, "★") {
		emphasis = true
		s = strings.TrimSpace(strings.TrimSuffix(s, "★"))
	}
	if loc := reNoteSep.FindStringIndex(s); loc != nil {
		note = strings.TrimSpace(s[loc[1]:])
		s = s[:loc[0]]
	}
	label = strings.TrimSpace(s)
	// 模型偶尔把「（补充）」写进标签里（如「💡 （补充）难点预判」）：挪到说明开头，标签保持干净
	if strings.Contains(label, MindmapSupplementMark) {
		label = strings.Join(strings.Fields(strings.Replace(label, MindmapSupplementMark, "", 1)), " ")
		if note != "" && !strings.HasPrefix(note, MindmapSupplementMark) {
			note = MindmapSupplementMark + note
		}
	}
	return
}

// parseMindmapBranch 把分支展开阶段的回复解析成条目。
// 只认列表行，其余（模型的客套话、标题）一律忽略；缩进按「相对首条」判层级，
// 不假设是 2 空格还是 4 空格。第一条就是三级时提升为二级。超过硬上限的行丢弃并计数。
func parseMindmapBranch(raw string) (items []mmItem, dropped int) {
	baseIndent := -1
	for _, line := range strings.Split(raw, "\n") {
		if reFenceLine.MatchString(line) {
			continue
		}
		line = strings.ReplaceAll(strings.TrimRight(line, " \t\r"), "\t", "  ")
		m := reItemLine.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		label, note, emph := parseMindmapItemText(m[2])
		if label == "" {
			continue
		}
		indent := len(m[1])
		if baseIndent < 0 {
			baseIndent = indent
		}
		level := 2
		if indent >= baseIndent+2 {
			level = 3
		}
		if level == 3 && len(items) == 0 {
			level = 2
		}
		if len(items) >= mindmapHardCapItems {
			dropped++
			continue
		}
		items = append(items, mmItem{Level: level, Label: label, Note: note, Emphasis: emph})
	}
	return
}

// formatMindmapItems 输出规范化的大纲行（二级顶格、三级缩进两格）。
func formatMindmapItems(items []mmItem) string {
	var b strings.Builder
	for _, it := range items {
		if it.Level >= 3 {
			b.WriteString("  ")
		}
		b.WriteString("- ")
		if it.Emphasis {
			b.WriteString("★ ")
		}
		b.WriteString(it.Label)
		if it.Note != "" {
			b.WriteString(" :: ")
			b.WriteString(it.Note)
		}
		b.WriteString("\n")
	}
	return b.String()
}

// ────────────────────────────────────────────────────────────
// 体检：代码查得出来的缺项（不让模型自评）
// ────────────────────────────────────────────────────────────

// assessMindmapBranch 返回面向模型的缺项说明（中文，可直接放进重写提示词）。
// 空表示合格。条数越少越好——重写是否采纳就看条数是否严格减少。
func assessMindmapBranch(items []mmItem) []string {
	var issues []string
	l2, l2WithNote := 0, 0
	var longLabels, longNotes, dups []string
	seen := map[string]bool{}
	for _, it := range items {
		if it.Level == 2 {
			l2++
			if it.Note != "" {
				l2WithNote++
			}
		}
		if utf8.RuneCountInString(it.Label) > mindmapLabelMaxRunes {
			longLabels = append(longLabels, it.Label)
		}
		if utf8.RuneCountInString(it.Note) > mindmapNoteMaxRunes {
			longNotes = append(longNotes, it.Label)
		}
		k := labelKey(it.Label)
		if seen[k] {
			dups = append(dups, it.Label)
		}
		seen[k] = true
	}
	if l2 < 2 {
		issues = append(issues, fmt.Sprintf("二级要点太少（目前 %d 个），请给出 3 到 5 个", l2))
	} else if l2WithNote*2 < l2 {
		issues = append(issues, fmt.Sprintf("带说明的二级要点不足一半（%d/%d），请至少给一半的要点补上例子、数据或做法", l2WithNote, l2))
	}
	if len(longLabels) > 0 {
		issues = append(issues, "这些标签太长："+quoteFirst(longLabels, 3)+"，请改成不超过 18 个字的名词短语，细节挪进「 :: 」后面的说明")
	}
	if len(longNotes) > 0 {
		issues = append(issues, "这些要点的说明太长："+quoteFirst(longNotes, 3)+"，请压缩到 40 个字以内")
	}
	if len(dups) > 0 {
		issues = append(issues, "有重复的要点："+quoteFirst(dups, 3)+"，请合并或换成不同的内容")
	}
	return issues
}

func quoteFirst(ss []string, n int) string {
	if len(ss) > n {
		ss = ss[:n]
	}
	parts := make([]string, len(ss))
	for i, s := range ss {
		parts[i] = "「" + s + "」"
	}
	return strings.Join(parts, "")
}

// ────────────────────────────────────────────────────────────
// 提示词用户消息
// ────────────────────────────────────────────────────────────

func buildExpandUser(material string, sk mindmapSkeleton, branch string, topicMode bool, issues []string, prev []mmItem) string {
	var b strings.Builder
	b.WriteString("【材料】\n")
	b.WriteString(material)
	b.WriteString("\n\n【整张导图的骨架】\n中心：")
	b.WriteString(sk.Root)
	if sk.Framework != "" {
		b.WriteString("\n框架：")
		b.WriteString(sk.Framework)
	}
	b.WriteString("\n分支：\n")
	for i, br := range sk.Branches {
		fmt.Fprintf(&b, "%d. %s\n", i+1, br)
	}
	b.WriteString("\n【本次要展开的分支】\n")
	b.WriteString(branch)
	if topicMode {
		b.WriteString("\n\n")
		b.WriteString(mindmapTopicModeNote)
	}
	if len(issues) > 0 {
		b.WriteString("\n\n【上一版存在的问题，请在这次修正】\n")
		for _, is := range issues {
			b.WriteString("- ")
			b.WriteString(is)
			b.WriteString("\n")
		}
		if len(prev) > 0 {
			b.WriteString("\n【上一版内容，仅供参考；请按上面的问题修正后，重新给出完整的一版】\n")
			b.WriteString(formatMindmapItems(prev))
		}
	}
	return b.String()
}

// ────────────────────────────────────────────────────────────
// 并发工具
// ────────────────────────────────────────────────────────────

// runLimited 以不超过 limit 的并发度对 0..n-1 各调用一次 fn，全部结束后返回。
func runLimited(n, limit int, fn func(i int)) {
	if limit < 1 {
		limit = 1
	}
	sem := make(chan struct{}, limit)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			fn(i)
		}(i)
	}
	wg.Wait()
}

// ────────────────────────────────────────────────────────────
// 主流程
// ────────────────────────────────────────────────────────────

// mindmapEmphasisCap 全图 ★ 上限：约一半分支数，至少 3 个
func mindmapEmphasisCap(branches int) int {
	c := (branches + 1) / 2
	if c < 3 {
		c = 3
	}
	return c
}

// capMindmapEmphasis 按出现顺序保留前 max 个 ★，其余去掉；返回去掉的数量。
// 失败的分支不参与计数（它们不会出现在图上）。
func capMindmapEmphasis(results []branchResult, max int) int {
	kept, dropped := 0, 0
	for i := range results {
		if results[i].err != nil {
			continue
		}
		for j := range results[i].items {
			if !results[i].items[j].Emphasis {
				continue
			}
			if kept < max {
				kept++
			} else {
				results[i].items[j].Emphasis = false
				dropped++
			}
		}
	}
	return dropped
}

// mindmapSupplementAllowed 只有教学类框架允许模型补充例子；会议纪要、汇报、计划等事实类材料
// 必须忠实整理。提示词里已写明，但 2026-10-26 实测豆包仍会在纪要里编「从试点校中选取」，
// 所以这里在代码里兜底，不依赖模型自觉。主题模式（无正文）整体都是模型知识，不适用此规则。
func mindmapSupplementAllowed(framework string, topicMode bool) bool {
	if topicMode {
		return true
	}
	return strings.Contains(framework, "教学环节") || strings.Contains(framework, "知识体系")
}

// stripMindmapSupplements 事实类材料里：三级要点带补充说明的整条删除，二级要点只清掉说明。
// 失败分支不处理。返回剔除条数。
func stripMindmapSupplements(results []branchResult) int {
	n := 0
	for i := range results {
		if results[i].err != nil {
			continue
		}
		kept := results[i].items[:0]
		for _, it := range results[i].items {
			if strings.HasPrefix(it.Note, MindmapSupplementMark) {
				n++
				if it.Level >= 3 {
					continue
				}
				it.Note = ""
			}
			kept = append(kept, it)
		}
		results[i].items = kept
	}
	return n
}

type branchResult struct {
	items     []mmItem
	truncated bool
	dropped   int
	err       error
}

// RunMindmapPipeline 跑完整的三阶段流程，返回缩进大纲。
// emit 可为 nil；内部已对 emit 加锁，调用方不必保证并发安全。
func RunMindmapPipeline(ctx context.Context, llm MindmapLLM, material string, emit func(MindmapEvent)) (*MindmapResult, error) {
	material = strings.TrimSpace(material)
	if material == "" {
		return nil, &MindmapError{Stage: "skeleton", Msg: "材料为空"}
	}
	topicMode := utf8.RuneCountInString(material) < mindmapTopicModeMaxRunes

	var emitMu sync.Mutex
	send := func(ev MindmapEvent) {
		if emit == nil {
			return
		}
		emitMu.Lock()
		defer emitMu.Unlock()
		emit(ev)
	}

	// ── ① 骨架 ──
	send(MindmapEvent{Stage: "skeleton", Message: "正在通读材料、选组织框架、搭骨架…"})
	skUser := material
	if topicMode {
		skUser += "\n\n" + mindmapTopicModeNote
	}
	var sk mindmapSkeleton
	var parseErr error
	for attempt := 0; attempt < mindmapSkeletonAttempts; attempt++ {
		raw, _, err := llm(ctx, mindmapSkeletonPrompt, skUser, mindmapSkeletonMaxTokens, mindmapSkeletonTemp)
		if err != nil {
			return nil, &MindmapError{Stage: "skeleton", Msg: "骨架生成调用失败", Cause: err}
		}
		sk, parseErr = parseMindmapSkeleton(raw)
		if parseErr == nil {
			break
		}
		skUser = material + "\n\n【上一次的输出格式不对：" + parseErr.Error() + "。请严格按要求的格式重新输出。】"
		if topicMode {
			skUser += "\n\n" + mindmapTopicModeNote
		}
	}
	if parseErr != nil {
		return nil, &MindmapError{Stage: "skeleton", Msg: "骨架格式始终不符合要求：" + parseErr.Error()}
	}
	send(MindmapEvent{
		Stage:     "skeleton",
		Message:   fmt.Sprintf("已选框架「%s」，共 %d 个主分支", sk.Framework, len(sk.Branches)),
		Framework: sk.Framework,
		Branches:  sk.Branches,
	})
	if err := ctx.Err(); err != nil {
		return nil, &MindmapError{Stage: "skeleton", Msg: "已取消", Cause: err}
	}

	// ── ② 并行展开 ──
	total := len(sk.Branches)
	results := make([]branchResult, total)
	expandOne := func(i int, issues []string, prev []mmItem, temp float64) branchResult {
		if err := ctx.Err(); err != nil {
			return branchResult{err: err}
		}
		user := buildExpandUser(material, sk, sk.Branches[i], topicMode, issues, prev)
		raw, truncated, err := llm(ctx, mindmapExpandPrompt, user, mindmapExpandMaxTokens, temp)
		if err != nil {
			return branchResult{err: err}
		}
		items, dropped := parseMindmapBranch(raw)
		if truncated && len(items) > 1 {
			items = items[:len(items)-1] // 最后一行可能写到一半
		}
		return branchResult{items: items, truncated: truncated, dropped: dropped}
	}

	// 计数与发送必须在同一把锁里：否则两个分支几乎同时完成时，
	// 进度会先发 2 再发 1，前端进度条倒退。
	done := 0
	runLimited(total, mindmapConcurrency, func(i int) {
		r := expandOne(i, nil, nil, mindmapExpandTemp)
		results[i] = r
		emitMu.Lock()
		defer emitMu.Unlock()
		done++
		if emit != nil {
			emit(MindmapEvent{
				Stage:   "expand",
				Message: fmt.Sprintf("已展开「%s」", sk.Branches[i]),
				Done:    done,
				Total:   total,
			})
		}
	})
	if err := ctx.Err(); err != nil {
		return nil, &MindmapError{Stage: "expand", Msg: "已取消", Cause: err}
	}

	failed := 0
	var firstErr error
	for _, r := range results {
		if r.err != nil || len(r.items) == 0 {
			failed++
			if firstErr == nil {
				firstErr = r.err
			}
		}
	}
	if failed*100 > total*mindmapMaxFailedBranchPct {
		return nil, &MindmapError{
			Stage: "expand",
			Msg:   fmt.Sprintf("%d 个分支中有 %d 个没能生成", total, failed),
			Cause: firstErr,
		}
	}

	// ── ③ 体检 + ④ 定向重写 ──
	res := &MindmapResult{Framework: sk.Framework, Root: sk.Root, Branches: total}
	type flag struct {
		idx    int
		issues []string
	}
	var flags []flag
	for i, r := range results {
		if r.err != nil || len(r.items) == 0 {
			continue
		}
		if is := assessMindmapBranch(r.items); len(is) > 0 {
			flags = append(flags, flag{i, is})
		}
	}
	res.Flagged = len(flags)
	if len(flags) > 0 {
		send(MindmapEvent{
			Stage:   "review",
			Message: fmt.Sprintf("体检发现 %d 个分支需要改进，正在定向重写…", len(flags)),
			Total:   len(flags),
		})
		rewrites := make([]*branchResult, len(flags))
		runLimited(len(flags), mindmapConcurrency, func(k int) {
			f := flags[k]
			r := expandOne(f.idx, f.issues, results[f.idx].items, mindmapRewriteTemp)
			rewrites[k] = &r
		})
		for k, f := range flags {
			r := rewrites[k]
			if r == nil || r.err != nil || len(r.items) == 0 {
				continue
			}
			// 只在确实变好时才采纳：体检问题数严格减少
			if len(assessMindmapBranch(r.items)) < len(f.issues) {
				results[f.idx] = *r
				res.Rewritten++
			}
		}
		send(MindmapEvent{
			Stage:   "review",
			Message: fmt.Sprintf("重写完成，采纳了 %d 个", res.Rewritten),
			Done:    len(flags),
			Total:   len(flags),
		})
	}

	if !mindmapSupplementAllowed(sk.Framework, topicMode) {
		res.SupplementDropped = stripMindmapSupplements(results)
	}

	// ── ★ 总量上限：模型爱给每个分支的头条都加 ★，满图都是重点就等于没有重点 ──
	res.EmphasisDropped = capMindmapEmphasis(results, mindmapEmphasisCap(total))
	res.TopicMode = topicMode

	// ── 组装 ──
	var out strings.Builder
	out.WriteString("# ")
	out.WriteString(sk.Root)
	out.WriteString("\n")
	nodes := 1 + total
	for i, br := range sk.Branches {
		r := results[i]
		out.WriteString("\n## ")
		out.WriteString(br)
		out.WriteString("\n")
		if r.err != nil || len(r.items) == 0 {
			res.FailedBranches = append(res.FailedBranches, br)
			continue
		}
		out.WriteString(formatMindmapItems(r.items))
		nodes += len(r.items)
		for _, it := range r.items {
			if strings.HasPrefix(it.Note, MindmapSupplementMark) {
				res.SupplementNotes++
			}
		}
		if r.truncated {
			res.TruncatedBranches = append(res.TruncatedBranches, br)
		}
		if r.dropped > 0 {
			res.Warnings = append(res.Warnings, fmt.Sprintf("「%s」要点过多，已保留前 %d 条", br, mindmapHardCapItems))
		}
	}
	if nodes < mindmapMinTotalNodes {
		return nil, &MindmapError{Stage: "thin", Msg: fmt.Sprintf("生成的节点只有 %d 个，内容太单薄", nodes)}
	}
	for _, br := range res.FailedBranches {
		res.Warnings = append(res.Warnings, fmt.Sprintf("「%s」展开失败，图上只有分支名，可稍后重新生成", br))
	}
	for _, br := range res.TruncatedBranches {
		res.Warnings = append(res.Warnings, fmt.Sprintf("「%s」内容较多被截断，已保留完整的部分", br))
	}
	res.Outline = out.String()
	res.Nodes = nodes
	return res, nil
}
