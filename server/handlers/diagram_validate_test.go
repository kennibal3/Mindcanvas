package handlers

import "testing"

// ============================================================
// REQ-050 一期 A 防护网 · 结构体检单测
// 用「脏数据」直接压 validateAndRepairDiagram，坐实两件事：
//   ① 修复后结构一定是良构的（唯一根 / 无孤儿 / 无环 / 边两端都在）
//   ② 该保留的节点一个都没少（旧版是静默丢，这正是本条要治的病）
// 跑法：cd /opt/mindcanvas/server && go test ./handlers/ -run Diagram -v
// ============================================================

// assertWellFormed 校验「前端渲染前必须成立」的不变量，返回根 id
func assertWellFormed(t *testing.T, ns []DiagramNode) string {
	t.Helper()
	m := map[string]DiagramNode{}
	roots, rootID := 0, ""
	for _, n := range ns {
		if n.ID == "" {
			t.Fatalf("出现空 id 节点")
		}
		if _, dup := m[n.ID]; dup {
			t.Fatalf("出现重复 id：%s", n.ID)
		}
		if n.Label == "" {
			t.Fatalf("节点 %s 的 label 为空", n.ID)
		}
		m[n.ID] = n
		if n.Parent == "" {
			roots++
			rootID = n.ID
		}
	}
	if roots != 1 {
		t.Fatalf("根节点数 = %d，期望恰好 1（多根会导致除第一棵外全部静默消失）", roots)
	}
	for _, n := range ns {
		cur, steps := n.ID, 0
		for m[cur].Parent != "" {
			p := m[cur].Parent
			if _, ok := m[p]; !ok {
				t.Fatalf("节点 %s 的 parent %s 不存在（孤儿，会静默消失）", cur, p)
			}
			cur = p
			if steps++; steps > len(ns) {
				t.Fatalf("节点 %s 沿 parent 上溯成环", n.ID)
			}
		}
		if cur != rootID {
			t.Fatalf("节点 %s 上溯没能到达根 %s", n.ID, rootID)
		}
	}
	return rootID
}

func hasRepair(reps []DiagramRepair, code string) bool {
	for _, r := range reps {
		if r.Code == code {
			return true
		}
	}
	return false
}

func hasIssue(iss []DiagramIssue, code string) bool {
	for _, r := range iss {
		if r.Code == code {
			return true
		}
	}
	return false
}

// ── 1. mindmap：多根 + 孤儿 + 自环 + 闭环 + 重复 id 一锅端 ──────
// 旧版行为：只画 root 那一棵，b/b1/ghost/c1/c2 共 5 个节点静默消失（7 → 2）
func TestDiagramRepair_MindmapDirty(t *testing.T) {
	nodes := []DiagramNode{
		{ID: "root", Label: "主题", Parent: ""},
		{ID: "a", Label: "分支A", Parent: "root"},
		{ID: "b", Label: "第二个根", Parent: ""},       // 多根
		{ID: "b1", Label: "第二个根的孩子", Parent: "b"},
		{ID: "ghost", Label: "游离节点", Parent: "nope"}, // 孤儿
		{ID: "self", Label: "自己当自己爹", Parent: "self"}, // 自环
		{ID: "c1", Label: "环上一", Parent: "c2"},       // 闭环
		{ID: "c2", Label: "环上二", Parent: "c1"},
		{ID: "a", Label: "重复 id", Parent: "root"}, // 重复 id（旧版 nodeMap 直接覆盖）
	}

	got := validateAndRepairDiagram("mindmap", nodes, nil)
	if got.Fatal != "" {
		t.Fatalf("不该 fatal：%s", got.Fatal)
	}
	if len(got.Nodes) != len(nodes) {
		t.Fatalf("节点数 %d，期望一个都不丢 %d", len(got.Nodes), len(nodes))
	}
	root := assertWellFormed(t, got.Nodes)
	if root != "root" {
		t.Fatalf("根应为 root，实为 %s", root)
	}
	for _, code := range []string{"extra_root_merged", "orphan_reattached", "self_parent_fixed", "cycle_broken", "duplicate_id_renamed"} {
		if !hasRepair(got.Repairs, code) {
			t.Errorf("缺少修复记录 %s", code)
		}
	}
}

// ── 2. flowchart：悬空边（幽灵箭头）/ 重复边 / 缺 start / 缺 end / 判断单分支 ──
func TestDiagramRepair_FlowchartDirty(t *testing.T) {
	nodes := []DiagramNode{
		{ID: "s1", Label: "第一步", Parent: "", NodeType: "process"}, // 没有 start
		{ID: "d1", Label: "是否达标?", Parent: "s1", NodeType: "decision"},
		{ID: "a", Label: "达标：归档", Parent: "d1", NodeType: "process"},
		{ID: "x", Label: "野节点", Parent: "missing", NodeType: "weird"}, // 孤儿 + 非法类型
	}
	edges := []DiagramEdge{
		{From: "d1", To: "a", Label: "是"},
		{From: "d1", To: "a", Label: "是"},      // 重复边
		{From: "d1", To: "nope", Label: "否"},   // 悬空边 → 旧版画出甩向画布角落的幽灵箭头
		{From: "zzz", To: "a", Label: ""},      // 两端都不在
	}

	got := validateAndRepairDiagram("flowchart", nodes, edges)
	if got.Fatal != "" {
		t.Fatalf("不该 fatal：%s", got.Fatal)
	}
	assertWellFormed(t, got.Nodes)

	if len(got.Edges) != 1 {
		t.Fatalf("边数 %d，期望只剩 1 条（悬空 2 条 + 重复 1 条应被清掉）", len(got.Edges))
	}
	ids := map[string]DiagramNode{}
	for _, n := range got.Nodes {
		ids[n.ID] = n
	}
	if ids["s1"].NodeType != "start" {
		t.Errorf("缺 start 时应把根标为 start，实为 %q", ids["s1"].NodeType)
	}
	// 非法 node_type 先被归一成 process；x 出度为 0，随后又在「补 end」阶段
	// 被标成 end —— 两步叠加是对的（末端步骤本就该是结束），故这里只断言
	// 「不再是非法值」+ 修复记录在案，不锁死最终类型。
	if ids["x"].NodeType == "weird" {
		t.Errorf("非法 node_type 未被归一，实为 %q", ids["x"].NodeType)
	}
	if !hasRepair(got.Repairs, "node_type_normalized") {
		t.Errorf("缺少 node_type_normalized 修复记录")
	}
	if ids["a"].NodeType != "end" && ids["x"].NodeType != "end" {
		t.Errorf("缺 end 时应把末端标为 end")
	}
	if !hasRepair(got.Repairs, "dangling_edge_dropped") {
		t.Errorf("缺少 dangling_edge_dropped")
	}
	if !hasRepair(got.Repairs, "duplicate_edge_dropped") {
		t.Errorf("缺少 duplicate_edge_dropped")
	}
	// 判断节点两条分支里有一条指向不存在节点 → 清掉后只剩一条出路，
	// 这是「不敢自动补、只能提示」的典型：自动编一条分支就是造假
	if !hasIssue(got.Issues, "decision_single_branch") {
		t.Errorf("判断节点只剩一条出路时应报 decision_single_branch")
	}
}

// ── 3. flowchart：两条空标签分支 → 自动补「是 / 否」 ──
func TestDiagramRepair_FlowchartBranchLabel(t *testing.T) {
	nodes := []DiagramNode{
		{ID: "s", Label: "开始", Parent: "", NodeType: "start"},
		{ID: "d", Label: "是否通过?", Parent: "s", NodeType: "decision"},
		{ID: "y", Label: "通过", Parent: "d", NodeType: "process"},
		{ID: "n", Label: "不通过", Parent: "d", NodeType: "process"},
		{ID: "e", Label: "结束", Parent: "y", NodeType: "end"},
	}
	edges := []DiagramEdge{
		{From: "d", To: "y", Label: ""},
		{From: "d", To: "n", Label: ""},
	}
	got := validateAndRepairDiagram("flowchart", nodes, edges)
	assertWellFormed(t, got.Nodes)
	if got.Edges[0].Label != "是" || got.Edges[1].Label != "否" {
		t.Fatalf("两条空标签分支应补成 是/否，实为 %q/%q", got.Edges[0].Label, got.Edges[1].Label)
	}
	if !hasRepair(got.Repairs, "branch_label_filled") {
		t.Errorf("缺少 branch_label_filled")
	}
}

// ── 4. timeline：第三层节点（旧版静默丢）+ sequence 全 0 ──
func TestDiagramRepair_TimelineDeep(t *testing.T) {
	nodes := []DiagramNode{
		{ID: "t0", Label: "课程进度", Parent: ""},
		{ID: "t1", Label: "第一周", Parent: "t0"},
		{ID: "t2", Label: "第二周", Parent: "t0"},
		{ID: "t1s", Label: "第一周说明", Parent: "t1"},
		{ID: "t1ss", Label: "说明的说明", Parent: "t1s"}, // 深度 3，旧版静默丢
	}
	got := validateAndRepairDiagram("timeline", nodes, nil)
	assertWellFormed(t, got.Nodes)

	m := map[string]DiagramNode{}
	for _, n := range got.Nodes {
		m[n.ID] = n
	}
	// 必须提升到深度 1 的祖先（t1）下，成为深度 2；挂到 t1s 下等于没救
	if m["t1ss"].Parent != "t1" {
		t.Fatalf("深度 3 的节点应提升挂到主轴节点 t1，实为 %s", m["t1ss"].Parent)
	}
	if !hasRepair(got.Repairs, "timeline_flattened") {
		t.Errorf("缺少 timeline_flattened")
	}
	if m["t1"].Sequence == 0 || m["t1"].Sequence == m["t2"].Sequence {
		t.Errorf("sequence 应被补成不重复的顺序号，实为 t1=%d t2=%d", m["t1"].Sequence, m["t2"].Sequence)
	}
}

// ── 5. fishbone：第四层节点（旧版静默丢）──
func TestDiagramRepair_FishboneDeep(t *testing.T) {
	nodes := []DiagramNode{
		{ID: "eff", Label: "成绩下滑", Parent: ""},
		{ID: "c1", Label: "学习习惯", Parent: "eff"},
		{ID: "s1", Label: "作业拖延", Parent: "c1"},
		{ID: "s1a", Label: "睡前才写", Parent: "s1"}, // 深度 3，旧版静默丢
	}
	got := validateAndRepairDiagram("fishbone", nodes, nil)
	assertWellFormed(t, got.Nodes)
	m := map[string]DiagramNode{}
	for _, n := range got.Nodes {
		m[n.ID] = n
	}
	if m["s1a"].Parent != "c1" {
		t.Fatalf("深度 3 的子原因应提升挂到原因大类 c1，实为 %s", m["s1a"].Parent)
	}
	if !hasRepair(got.Repairs, "fishbone_flattened") {
		t.Errorf("缺少 fishbone_flattened")
	}
}

// ── 6. 干净数据必须零改动（防护网不能反过来把好图改坏）──
func TestDiagramRepair_CleanUntouched(t *testing.T) {
	nodes := []DiagramNode{
		{ID: "root", Label: "光合作用", Parent: ""},
		{ID: "n1", Label: "光反应", Parent: "root"},
		{ID: "n2", Label: "暗反应", Parent: "root"},
		{ID: "n11", Label: "水的光解", Parent: "n1"},
	}
	got := validateAndRepairDiagram("mindmap", nodes, nil)
	if len(got.Repairs) != 0 || len(got.Issues) != 0 {
		t.Fatalf("干净数据不应产生任何修复/提示，实得 repairs=%v issues=%v", got.Repairs, got.Issues)
	}
	if len(got.Nodes) != 4 {
		t.Fatalf("节点数被改动：%d", len(got.Nodes))
	}
	for i := range nodes {
		if got.Nodes[i] != nodes[i] {
			t.Fatalf("干净节点被改写：%+v → %+v", nodes[i], got.Nodes[i])
		}
	}
}

// ── 7. 只有一个节点 → fatal（调用方据此回 AI 重生成一次）──
func TestDiagramRepair_FatalTooFewNodes(t *testing.T) {
	got := validateAndRepairDiagram("mindmap", []DiagramNode{{ID: "only", Label: "孤零零", Parent: ""}}, nil)
	if got.Fatal == "" {
		t.Fatalf("单节点应判 fatal 触发重生成")
	}
}
