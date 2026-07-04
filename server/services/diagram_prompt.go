package services

// ============================================================
// AI 图形生成 — 系统提示词集合
// 每种图形类型独立提示，统一输出 { "nodes": [...], "edges": [...] }
// ============================================================

// DiagramType 枚举
const (
	DiagramTypeMindmap  = "mindmap"
	DiagramTypeFlowchart = "flowchart"
	DiagramTypeTimeline  = "timeline"
	DiagramTypeOrgchart  = "orgchart"
	DiagramTypeFishbone  = "fishbone"
)

// ── 共用约束（注入每个 prompt 末尾）─────────────────────────
const diagramCommonConstraints = `
输出格式约束（必须严格遵守）：
1. 只输出一个合法 JSON 对象，不加任何解释、代码围栏或额外文字。
2. 根节点 parent 字段必须为空字符串 ""。
3. label 字段为短词组（≤18 字），不得含换行符。
4. id 字段由字母数字下划线组成，全局唯一。
5. 内容必须忠于原文，不编造。
`

// ── 1. 思维导图 ──────────────────────────────────────────────
// 用于知识梳理、课件大纲、概念网络
const AIPromptMindmap = `你是一个思维导图生成助手。
请将用户提供的 Markdown 文本分析为「中心放射式思维导图」结构。

输出一个 JSON 对象，格式如下：
{
  "diagram_type": "mindmap",
  "nodes": [
    { "id": "root",   "label": "主题",   "parent": "",     "level": 0 },
    { "id": "n1",     "label": "分支一", "parent": "root", "level": 1 },
    { "id": "n1_1",   "label": "要点",   "parent": "n1",   "level": 2 }
  ],
  "edges": []
}

规则：
- 有且只有一个 parent="" 的根节点（level=0）
- level 1 为主分支（建议 3–7 个），level 2 为子要点，最多 level 3
- 节点总数 8–30 个
- edges 数组留空（连线由布局算法自动生成）
` + diagramCommonConstraints

// ── 2. 流程图 ─────────────────────────────────────────────────
// 用于步骤流程、算法、操作规程
const AIPromptFlowchart = `你是一个流程图生成助手。
请将用户提供的 Markdown 文本分析为「标准流程图」结构。

输出一个 JSON 对象，格式如下：
{
  "diagram_type": "flowchart",
  "nodes": [
    { "id": "start",  "label": "开始",       "node_type": "start",    "parent": "" },
    { "id": "step1",  "label": "第一步",     "node_type": "process",  "parent": "start" },
    { "id": "dec1",   "label": "是否满足条件?","node_type": "decision", "parent": "step1" },
    { "id": "step2a", "label": "满足：执行A", "node_type": "process",  "parent": "dec1" },
    { "id": "step2b", "label": "不满足：执行B","node_type": "process", "parent": "dec1" },
    { "id": "end",    "label": "结束",       "node_type": "end",      "parent": "step2a" }
  ],
  "edges": [
    { "from": "dec1", "to": "step2a", "label": "是" },
    { "from": "dec1", "to": "step2b", "label": "否" },
    { "from": "step2b","to": "end",   "label": "" }
  ]
}

node_type 枚举：
- "start"    → 圆角矩形（流程起点，只有1个）
- "end"      → 圆角矩形（流程终点，只有1个）
- "process"  → 矩形（普通步骤）
- "decision" → 菱形（判断节点，必须在 edges 里写出两条分支含 label "是"/"否"）

规则：
- parent 字段表示"主路径"上的上一节点（判断节点的两条分支在 edges 里写）
- 节点总数 5–20 个
- edges 只需记录非 parent 关系的额外连线（主要是 decision 的分支、回环等）
` + diagramCommonConstraints

// ── 3. 时间轴 ─────────────────────────────────────────────────
// 用于历史事件、项目里程碑、课程进度
const AIPromptTimeline = `你是一个时间轴生成助手。
请将用户提供的 Markdown 文本分析为「线性时间轴」结构。

输出一个 JSON 对象，格式如下：
{
  "diagram_type": "timeline",
  "nodes": [
    { "id": "t0", "label": "时间轴主题",   "parent": "",  "sequence": 0, "time": "" },
    { "id": "t1", "label": "第一个事件",   "parent": "t0","sequence": 1, "time": "2020年" },
    { "id": "t2", "label": "第二个事件",   "parent": "t0","sequence": 2, "time": "2021年" },
    { "id": "t1s","label": "子事件说明",   "parent": "t1","sequence": 0, "time": "" }
  ],
  "edges": []
}

规则：
- 第一个节点（sequence=0，parent=""）为时间轴标题节点
- 主轴节点：parent = 标题节点 id，sequence 按时间升序
- 子节点（注释/细节）：parent = 所属主轴节点 id
- time 字段填写时间标注（如"2020年""Q3"），无时间标注则留空
- 主轴节点 5–12 个，每个主轴节点最多 2 个子节点
- edges 数组留空
` + diagramCommonConstraints

// ── 4. 组织架构图 ─────────────────────────────────────────────
// 用于组织结构、层级关系、职责分工
const AIPromptOrgchart = `你是一个组织架构图生成助手。
请将用户提供的 Markdown 文本分析为「层级组织架构」结构。

输出一个 JSON 对象，格式如下：
{
  "diagram_type": "orgchart",
  "nodes": [
    { "id": "ceo",  "label": "总负责人", "parent": "",    "level": 0, "role": "lead" },
    { "id": "dep1", "label": "部门A",    "parent": "ceo", "level": 1, "role": "dept" },
    { "id": "mem1", "label": "成员甲",   "parent": "dep1","level": 2, "role": "member" }
  ],
  "edges": []
}

role 枚举：
- "lead"   → 顶层（深色背景）
- "dept"   → 部门/分组（中色背景）
- "member" → 成员/叶子（浅色背景）

规则：
- 有且只有一个 parent="" 的顶层节点
- 层级 2–4 层，节点总数 6–25 个
- edges 数组留空
` + diagramCommonConstraints

// ── 5. 鱼骨图（因果图）────────────────────────────────────────
// 用于问题分析、原因归类、课堂讨论
const AIPromptFishbone = `你是一个鱼骨图（因果图/石川图）生成助手。
请将用户提供的 Markdown 文本分析为「鱼骨图」结构。

输出一个 JSON 对象，格式如下：
{
  "diagram_type": "fishbone",
  "nodes": [
    { "id": "effect",  "label": "核心问题/结果", "parent": "",       "level": 0 },
    { "id": "cause1",  "label": "原因类别一",     "parent": "effect", "level": 1, "side": "top" },
    { "id": "cause2",  "label": "原因类别二",     "parent": "effect", "level": 1, "side": "bottom" },
    { "id": "c1_sub1", "label": "子原因",         "parent": "cause1", "level": 2 },
    { "id": "c1_sub2", "label": "子原因",         "parent": "cause1", "level": 2 }
  ],
  "edges": []
}

规则：
- level=0：鱼头（核心问题/结果），只有1个
- level=1：主鱼骨（原因大类），建议 4–6 个，side 字段交替填 "top"/"bottom"
- level=2：子鱼刺（具体原因），每个大类 1–4 个
- edges 数组留空
` + diagramCommonConstraints

// GetDiagramPrompt 根据图形类型返回对应系统提示词
func GetDiagramPrompt(diagramType string) string {
	switch diagramType {
	case DiagramTypeMindmap:
		return AIPromptMindmap
	case DiagramTypeFlowchart:
		return AIPromptFlowchart
	case DiagramTypeTimeline:
		return AIPromptTimeline
	case DiagramTypeOrgchart:
		return AIPromptOrgchart
	case DiagramTypeFishbone:
		return AIPromptFishbone
	default:
		return AIPromptMindmap
	}
}
