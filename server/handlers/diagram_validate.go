package handlers

import "fmt"

// ============================================================
// REQ-050 一期 · A 防护网
// AI 返回的 {nodes, edges} 在转图前做确定性结构体检 + 自动修复
//
// 为什么必须有这一层（2026-07-25 读 diagramBuilder.ts 真身坐实，
// 与立项文档的抽象描述不同，五类图的失败后果各不相同）：
//   - mindmap / orgchart：`nodes.find(n => !n.parent)` 只认第一个无 parent
//     的节点当根，其余根连同整棵子树在渲染循环里 `if (!pos) continue`
//     —— 静默消失。孤儿（parent 指向不存在的 id）、成环节点同理。
//   - flowchart：不丢反而更糟。getPos 对未知 id 回落 level0/col0，孤儿节点
//     全部叠在「开始」节点上；edges 的 from/to 指向不存在节点时，箭头从画布
//     左上角原点甩出去（幽灵箭头）。
//   - timeline：只有 parent == 标题节点 id 的才上主轴，挂错层的静默丢。
//   - fishbone：level3 及以下静默丢。
// 结论：老师看到的图可能比 AI 生成的少一半，且没有任何提示。本层负责
// 「要么修好、要么说出来」。
//
// 不校验的字段（读码确认是死字段，校验它们等于校验空气）：
//   - side：diagramBuilder 只在 interface 里声明过，鱼骨上下交替实际按
//     数组下标 i%2 排，从未读过该字段。
//   - level：仅在 orgchart 当 role 兜底用（role 为空时按 level 猜），
//     不参与任何布局。
// 层级关系一律以 parent 字段为准。
//
// 放在 handlers 包而非 services：DiagramNode/DiagramEdge 是前端契约结构，
// 定义在本包，搬去 services 会牵动 handler ↔ service 的类型归属，
// 风险大于收益。本文件只依赖 stdlib，纯函数，可独立单测。
// ============================================================

// DiagramRepair 一条自动修复记录（随响应返回前端，透明告知老师）
type DiagramRepair struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
	Count  int    `json:"count"`
}

// DiagramIssue 查出来但「不敢自动修」的问题（自动补会变成造假，只提示）
type DiagramIssue struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
	Count  int    `json:"count"`
}

// diagramCheck 体检结果
type diagramCheck struct {
	Nodes   []DiagramNode
	Edges   []DiagramEdge
	Repairs []DiagramRepair
	Issues  []DiagramIssue
	// Fatal 非空 ＝ 结构烂到修不动，调用方应回 AI 重生成一次
	Fatal string
}

// ── 计数日志（同类问题合并成一条，前端提示才不会刷屏）──────────
type repairLog struct {
	order []string
	m     map[string]*DiagramRepair
}

func newRepairLog() *repairLog { return &repairLog{m: map[string]*DiagramRepair{}} }

func (r *repairLog) add(code, detail string) {
	if it, ok := r.m[code]; ok {
		it.Count++
		return
	}
	r.m[code] = &DiagramRepair{Code: code, Detail: detail, Count: 1}
	r.order = append(r.order, code)
}

func (r *repairLog) list() []DiagramRepair {
	out := make([]DiagramRepair, 0, len(r.order))
	for _, c := range r.order {
		out = append(out, *r.m[c])
	}
	return out
}

type issueLog struct {
	order []string
	m     map[string]*DiagramIssue
}

func newIssueLog() *issueLog { return &issueLog{m: map[string]*DiagramIssue{}} }

func (r *issueLog) add(code, detail string) {
	if it, ok := r.m[code]; ok {
		it.Count++
		return
	}
	r.m[code] = &DiagramIssue{Code: code, Detail: detail, Count: 1}
	r.order = append(r.order, code)
}

func (r *issueLog) list() []DiagramIssue {
	out := make([]DiagramIssue, 0, len(r.order))
	for _, c := range r.order {
		out = append(out, *r.m[c])
	}
	return out
}

// ──────────────────────────────────────────────────────────────
// 主入口
// ──────────────────────────────────────────────────────────────

// validateAndRepairDiagram 对 AI 返回的结构做体检并就地修复。
// 返回的 nodes/edges 保证：id 非空且唯一、label 非空、
// 有且只有一个 parent=="" 的根、其余节点的 parent 一定指向存在的节点、
// 无自环、无环、edges 两端一定存在。
func validateAndRepairDiagram(diagramType string, nodes []DiagramNode, edges []DiagramEdge) diagramCheck {
	rep := newRepairLog()
	iss := newIssueLog()

	// ── 1. id 空的丢弃；id 重复的重命名（旧代码 nodeMap 会静默覆盖）──
	seen := map[string]bool{}
	kept := make([]DiagramNode, 0, len(nodes))
	for _, n := range nodes {
		if n.ID == "" {
			rep.add("empty_id_dropped", "AI 返回了没有 id 的节点，已丢弃")
			continue
		}
		if seen[n.ID] {
			newID := ""
			for i := 2; ; i++ {
				cand := fmt.Sprintf("%s_%d", n.ID, i)
				if !seen[cand] {
					newID = cand
					break
				}
			}
			rep.add("duplicate_id_renamed", "AI 给了重复的节点 id（会导致节点互相覆盖丢失），已自动改名")
			n.ID = newID
		}
		seen[n.ID] = true

		// ── 2. label 空 → 占位（空标签在画布上是个空框，老师看不懂）──
		if n.Label == "" {
			rep.add("empty_label_filled", "有节点没有文字，已填「未命名」")
			n.Label = "未命名"
		}
		kept = append(kept, n)
	}
	nodes = kept

	if len(nodes) == 0 {
		return diagramCheck{Nodes: nodes, Edges: []DiagramEdge{}, Repairs: rep.list(), Issues: iss.list(),
			Fatal: "AI 返回了空节点列表"}
	}

	exists := func(id string) bool { return seen[id] }

	// ── 3. parent 自指 / 指向不存在的 id → 先置空，第 5 步统一挂根 ──
	// 这里记原因，方便前端说人话（游离节点 vs 多个根 是两回事）
	rootless := map[string]string{} // id → 原因
	for i := range nodes {
		n := &nodes[i]
		switch {
		case n.Parent == "":
			// 原生的无 parent 节点，第 5 步再定谁是唯一的根
		case n.Parent == n.ID:
			rep.add("self_parent_fixed", "有节点把自己当成自己的上级，已断开")
			n.Parent = ""
			rootless[n.ID] = "self"
		case !exists(n.Parent):
			rep.add("orphan_reattached", "有节点挂在不存在的上级下（旧版会整棵子树静默消失），已挂回主干")
			n.Parent = ""
			rootless[n.ID] = "orphan"
		}
	}

	// ── 4. 断环（成环的节点簇与根不连通 → 旧版整簇消失）──
	// 每个节点只有一个 parent，图是函数图，环一定是与根不相连的独立簇。
	// 用灰/黑染色沿 parent 上溯，遇到当前路径里的灰点即为环入口，断它。
	parentOf := map[string]string{}
	for _, n := range nodes {
		parentOf[n.ID] = n.Parent
	}
	const (
		white = 0
		gray  = 1
		black = 2
	)
	color := map[string]int{}
	for _, n := range nodes {
		if color[n.ID] != white {
			continue
		}
		path := []string{}
		cur := n.ID
		for {
			if color[cur] == gray {
				// 环入口：断开
				rep.add("cycle_broken", "有节点绕成了闭环（旧版会整簇消失），已断开挂回主干")
				parentOf[cur] = ""
				rootless[cur] = "cycle"
				break
			}
			if color[cur] == black {
				break
			}
			color[cur] = gray
			path = append(path, cur)
			p := parentOf[cur]
			if p == "" {
				break
			}
			cur = p
		}
		for _, id := range path {
			color[id] = black
		}
	}
	for i := range nodes {
		nodes[i].Parent = parentOf[nodes[i].ID]
	}

	// ── 5. 唯一根：第一个 parent=="" 的当根，其余全部挂到它 ──
	rootID := ""
	for _, n := range nodes {
		if n.Parent == "" {
			rootID = n.ID
			break
		}
	}
	if rootID == "" {
		// 理论上第 4 步断环后必有无 parent 节点；兜底防御
		rootID = nodes[0].ID
		nodes[0].Parent = ""
		rep.add("root_forced", "找不到根节点，已把第一个节点定为根")
	}
	for i := range nodes {
		n := &nodes[i]
		if n.ID == rootID || n.Parent != "" {
			continue
		}
		if rootless[n.ID] == "" {
			// 不是我们断出来的，是 AI 本来就给了多个根
			rep.add("extra_root_merged", "AI 给了不止一个根节点（旧版只画第一个、其余整棵子树静默消失），已合并到主根下")
		}
		n.Parent = rootID
	}

	// ── 6. 边：两端必须存在 + 去重（幽灵箭头的根源）──
	edges = sanitizeEdges(edges, exists, rep)

	// ── 7. 类型专属 ──
	switch diagramType {
	case "flowchart":
		nodes, edges = repairFlowchart(nodes, edges, rootID, rep, iss)
	case "timeline":
		nodes = flattenToTwoLevels(nodes, rootID, rep,
			"timeline_flattened", "时间轴有节点挂到了第三层（旧版会静默丢掉），已提升挂到所属主轴节点")
		nodes = fillTimelineSequence(nodes, rootID, rep)
	case "fishbone":
		nodes = flattenToTwoLevels(nodes, rootID, rep,
			"fishbone_flattened", "鱼骨图有节点挂到了第四层（旧版会静默丢掉），已提升挂到所属原因大类")
	}

	// ── 8. 致命：修完还是画不出东西 ──
	fatal := ""
	if len(nodes) < 2 {
		fatal = "AI 只返回了一个节点，画不成图"
	}

	if edges == nil {
		edges = []DiagramEdge{}
	}
	return diagramCheck{Nodes: nodes, Edges: edges, Repairs: rep.list(), Issues: iss.list(), Fatal: fatal}
}

// ──────────────────────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────────────────────

// sanitizeEdges 丢掉两端不存在的边（前端 getPos 对未知 id 回落原点 →
// 箭头从画布左上角甩出来）、丢掉自环、同一对节点的重复边只留第一条。
func sanitizeEdges(edges []DiagramEdge, exists func(string) bool, rep *repairLog) []DiagramEdge {
	out := make([]DiagramEdge, 0, len(edges))
	pairSeen := map[string]bool{}
	for _, e := range edges {
		if e.From == "" || e.To == "" || !exists(e.From) || !exists(e.To) {
			rep.add("dangling_edge_dropped", "有连线指向不存在的节点（旧版会画出一条甩向画布角落的幽灵箭头），已删除")
			continue
		}
		if e.From == e.To {
			rep.add("self_edge_dropped", "有连线自己连自己，已删除")
			continue
		}
		key := e.From + "\x00" + e.To
		if pairSeen[key] {
			rep.add("duplicate_edge_dropped", "同一对节点之间有重复连线，已去重")
			continue
		}
		pairSeen[key] = true
		out = append(out, e)
	}
	return out
}

// depthMap 按 parent 关系算每个节点到根的深度（根＝0）。
// 调用前必须已保证唯一根、无环、parent 都存在。
func depthMap(nodes []DiagramNode, rootID string) map[string]int {
	parentOf := map[string]string{}
	for _, n := range nodes {
		parentOf[n.ID] = n.Parent
	}
	depth := map[string]int{rootID: 0}
	var resolve func(id string) int
	resolve = func(id string) int {
		if d, ok := depth[id]; ok {
			return d
		}
		p := parentOf[id]
		if p == "" {
			depth[id] = 0
			return 0
		}
		d := resolve(p) + 1
		depth[id] = d
		return d
	}
	for _, n := range nodes {
		resolve(n.ID)
	}
	return depth
}

// flattenToTwoLevels 把深度 ≥3 的节点提升成深度 2 —— 即挂到它在**深度 1**
// 的那个祖先上（挂到深度 2 的祖先没用，那样它自己仍是深度 3，照样被丢）。
// timeline / fishbone 的渲染只认「根(0) → 主节点(1) → 子节点(2)」三层，
// 深度 ≥3 的节点在前端既不在 mainNodes 也不会被画出来 → 静默消失。
func flattenToTwoLevels(nodes []DiagramNode, rootID string, rep *repairLog, code, detail string) []DiagramNode {
	depth := depthMap(nodes, rootID)
	parentOf := map[string]string{}
	for _, n := range nodes {
		parentOf[n.ID] = n.Parent
	}
	for i := range nodes {
		n := &nodes[i]
		if depth[n.ID] < 3 {
			continue
		}
		// 沿 parent 上溯到深度 1 的祖先（主节点 / 原因大类），挂过去
		anc := n.Parent
		for anc != "" && depth[anc] > 1 {
			anc = parentOf[anc]
		}
		if anc == "" {
			anc = rootID
		}
		rep.add(code, detail)
		n.Parent = anc
	}
	return nodes
}

// fillTimelineSequence 主轴节点 sequence 全 0 或有重复时，按出现顺序补号。
// 前端 buildTimeline 按 sequence 排序，全 0 时排序结果取决于 sort 稳定性。
func fillTimelineSequence(nodes []DiagramNode, rootID string, rep *repairLog) []DiagramNode {
	idx := []int{}
	for i := range nodes {
		if nodes[i].Parent == rootID {
			idx = append(idx, i)
		}
	}
	if len(idx) < 2 {
		return nodes
	}
	seen := map[int]bool{}
	needFill := false
	for _, i := range idx {
		s := nodes[i].Sequence
		if s == 0 || seen[s] {
			needFill = true
			break
		}
		seen[s] = true
	}
	if !needFill {
		return nodes
	}
	rep.add("timeline_sequence_filled", "时间轴节点的先后顺序号缺失或重复，已按 AI 给出的先后顺序补齐")
	for k, i := range idx {
		nodes[i].Sequence = k + 1
	}
	return nodes
}

// repairFlowchart 流程图专属体检。
// 注意：decision 分支缺失一律只提示不自动补——自动编一条「否」分支就是造假，
// 老师拿去讲课比缺一条更糟。
func repairFlowchart(
	nodes []DiagramNode,
	edges []DiagramEdge,
	rootID string,
	rep *repairLog,
	iss *issueLog,
) ([]DiagramNode, []DiagramEdge) {
	// node_type 非法值归一
	valid := map[string]bool{"start": true, "end": true, "process": true, "decision": true}
	for i := range nodes {
		if nodes[i].NodeType == "" {
			nodes[i].NodeType = "process"
			continue
		}
		if !valid[nodes[i].NodeType] {
			rep.add("node_type_normalized", "有节点的类型不是 start/end/process/decision，已按普通步骤处理")
			nodes[i].NodeType = "process"
		}
	}

	// start 必须恰好一个，且应当是根（前端从根做 BFS 排版）
	startCount := 0
	for i := range nodes {
		if nodes[i].NodeType == "start" {
			startCount++
			if nodes[i].ID != rootID {
				rep.add("extra_start_demoted", "流程图有不止一个「开始」，多余的已改为普通步骤")
				nodes[i].NodeType = "process"
				startCount--
			}
		}
	}
	if startCount == 0 {
		for i := range nodes {
			if nodes[i].ID == rootID {
				rep.add("start_marked", "流程图没有「开始」节点，已把起点标为开始")
				nodes[i].NodeType = "start"
				break
			}
		}
	}

	// 出度统计（parent 关系 + 显式 edges，与前端画箭头的口径一致）
	outDeg := map[string]int{}
	branchLabels := map[string][]string{}
	for _, n := range nodes {
		if n.Parent != "" {
			outDeg[n.Parent]++
		}
	}
	for _, e := range edges {
		// 前端对「已由显式 edge 表达的 parent 关系」会跳过重复画线，
		// 这里同口径去重，避免把一条关系数成两条出边。
		dup := false
		for _, n := range nodes {
			if n.ID == e.To && n.Parent == e.From {
				dup = true
				break
			}
		}
		if !dup {
			outDeg[e.From]++
		}
		branchLabels[e.From] = append(branchLabels[e.From], e.Label)
	}

	// end：一个都没有就把所有出度为 0 的叶子标成 end
	hasEnd := false
	for _, n := range nodes {
		if n.NodeType == "end" {
			hasEnd = true
			break
		}
	}
	if !hasEnd {
		marked := false
		for i := range nodes {
			if outDeg[nodes[i].ID] == 0 && nodes[i].NodeType != "start" {
				nodes[i].NodeType = "end"
				marked = true
			}
		}
		if marked {
			rep.add("end_marked", "流程图没有「结束」节点，已把没有后续步骤的末端标为结束")
		} else {
			iss.add("no_end", "流程图没有结束节点，且每一步都还有后续——流程可能没走完")
		}
	}

	// decision 必须至少两条出边、分支标签不能空/重复
	for _, n := range nodes {
		if n.NodeType != "decision" {
			continue
		}
		if outDeg[n.ID] < 2 {
			iss.add("decision_single_branch", "判断节点只有一条出路（缺了「否」的那一支），建议重新生成或手动补")
			continue
		}
		labels := branchLabels[n.ID]
		empty, dupLabel := 0, false
		lseen := map[string]bool{}
		for _, l := range labels {
			if l == "" {
				empty++
				continue
			}
			if lseen[l] {
				dupLabel = true
			}
			lseen[l] = true
		}
		if len(labels) == 2 && empty == 2 {
			// 恰好两条且都没标签：补「是 / 否」是安全的确定性修复
			cnt := 0
			for i := range edges {
				if edges[i].From == n.ID && edges[i].Label == "" {
					if cnt == 0 {
						edges[i].Label = "是"
					} else {
						edges[i].Label = "否"
					}
					cnt++
				}
			}
			rep.add("branch_label_filled", "判断节点的两条分支没写「是 / 否」，已补上")
		} else if empty > 0 || dupLabel {
			iss.add("branch_label_bad", "判断节点的分支标签有空缺或重复，画出来分不清走哪条")
		}
	}

	return nodes, edges
}
