/**
 * markdownToDiagram.ts
 * REQ-058：结构化 Markdown → 图形结构「确定性直转」通道
 *
 * ── 为什么要有这一层（2026-07-30 读码坐实）──────────────────────
 * 原先只有一条路：任何输入都丢给 AI「分析成」结构。而 diagram_prompt.go
 * 给思维导图定了三个硬上限：节点总数 8–30（:54）、最多 level 3（:53）、
 * label ≤18 字（:22）。当老师交进来的本身已经是**精炼过、层级完整的
 * Markdown** 时，这三条就从「防止 AI 啰嗦」变成了「强制二次摘要」：
 *
 *   实测一份 41 节点 / 深度 4 / 18 条标签超 18 字的会议纪要，
 *   出图 29 个节点（正好贴着 30 的上限）——一半内容没了，
 *   而且是**静默**没的：两条相邻要点被揉成一句（改变了事实），
 *   「月投入约 100 万 / 年约 1000 万」这类决策关键数字整条消失。
 *
 * 关键判断：**输入已经有层级时，这一步应该是无损转换，不是摘要。**
 * Markdown 的 #/##/- 缩进本身就是一棵树，解析它不需要语言模型；
 * 让 LLM 重新「理解」一遍，只会引入压缩、改写和幻觉。
 *
 * 所以本文件是纯函数解析器：结构化输入走这里（无损、同步、零 token、
 * 零幻觉），散文/无结构输入仍走 AI。
 *
 * ── 只对纯树形图开放（刻意收窄）───────────────────────────────
 * mindmap / orgchart：diagramBuilder 只需要 parent（orgchart 的 role
 * 在缺省时按 level 兜底），Markdown 的树可以原样映射，无损。
 * 另外三种**故意不做**，因为直转会丢或会错：
 *   - flowchart：需要 node_type 与 decision 的两条带 label 出边，
 *     「哪句是判断」是语义活儿，规则判不出来。
 *   - timeline：builder 只把 parent == 标题节点 的节点放上主轴，
 *     且每个主轴点最多 2 个子节点（深层结构会丢），还要抽 time 字段。
 *   - fishbone：builder 对 level3 及以下静默丢（见 diagram_validate.go:18），
 *     深 Markdown 直转反而制造新的静默丢失。
 * 这三种保持走 AI —— 宁可让 AI 摘要，也不要换一种方式丢东西。
 *
 * ── 输出保证（下游因此可以不做防护）──────────────────────────
 * 1. 有且只有一个 parent === "" 的根节点
 * 2. 每个非根节点的 parent 一定是本次输出里存在的 id
 * 3. 不可能成环（父节点在栈里一定先于子节点产生）
 * 4. id 全局唯一
 * 即 diagram_validate.go 那套体检的全部致命项，本解析器结构上不可能违反。
 */

import type { DiagramData, DiagramNode } from "./diagramBuilder";

// ────────────────────────────────────────────────────────────────
// 可直转的图型
// ────────────────────────────────────────────────────────────────
export type DirectConvertibleType = "mindmap" | "orgchart";

export const DIRECT_CONVERTIBLE_TYPES: readonly DirectConvertibleType[] = ["mindmap", "orgchart"];

export function isDirectConvertibleType(t: string): t is DirectConvertibleType {
  return (DIRECT_CONVERTIBLE_TYPES as readonly string[]).includes(t);
}

// ────────────────────────────────────────────────────────────────
// 大纲条目：解析的中间产物
// ────────────────────────────────────────────────────────────────
export interface OutlineItem {
  /** 1 起的层级，1 ＝ 最外层 */
  depth: number;
  text: string;
  /** 来源行号（1 起），仅用于排查 */
  line: number;
}

export interface MarkdownAnalysis {
  items: OutlineItem[];
  /** 直转后会得到的节点总数（含可能补出来的合成根） */
  nodeCount: number;
  /** 树的最大深度，根算 0 */
  maxDepth: number;
  /** 是否够得上「已经结构化」——够则值得直转，不够就交给 AI */
  structured: boolean;
  /** 最长标签字数，UI 可据此提示节点会比较宽 */
  longestLabel: number;
}

// ────────────────────────────────────────────────────────────────
// 行级正则
// ────────────────────────────────────────────────────────────────
const RE_FENCE = /^\s{0,3}(```|~~~)/;
const RE_HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const RE_LIST = /^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/;
const RE_HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const RE_TABLE = /^\s*\|/;
const RE_QUOTE = /^\s{0,3}>\s?/;

/** 去掉行内 Markdown 标记，只留人看的文字 */
export function stripInlineMarkdown(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    // 斜体：刻意不用后行断言 (?<!…)。Safari 16.4 以下不支持 lookbehind，
    // 且是**解析期**报错——整个 bundle 会直接挂掉，而教室里的旧 iPad 正是
    // 这种环境。这里改用捕获前一个字符来达到同样效果。
    .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?![\w*])/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ────────────────────────────────────────────────────────────────
// 第一步：抽大纲
//
// 层级怎么算：标题给绝对层级（# ＝1，## ＝2 …）；列表项挂在「当前标题」
// 之下，自己的深浅用**缩进栈**决定（不假设缩进是 2 空格还是 4 空格，
// 只看相对关系，因此手写 3 空格、混用 2/4 空格都能正确分层）。
// ────────────────────────────────────────────────────────────────
export function extractOutline(md: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let inFence = false;
  let headingDepth = 0; // 当前标题层级；0 ＝ 还没遇到任何标题
  let indentStack: number[] = []; // 列表缩进栈，长度即列表嵌套层数

  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\t/g, "  ");
    if (RE_FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!raw.trim()) continue;
    if (RE_HR.test(raw)) continue;
    if (RE_TABLE.test(raw)) continue; // 表格直转成节点只会是垃圾，跳过

    const line = raw.replace(RE_QUOTE, "");

    const h = RE_HEADING.exec(line);
    if (h) {
      const text = stripInlineMarkdown(h[2]);
      if (!text) continue;
      headingDepth = h[1].length;
      indentStack = []; // 新标题重开一段列表上下文
      items.push({ depth: headingDepth, text, line: i + 1 });
      continue;
    }

    const li = RE_LIST.exec(line);
    if (li) {
      const indent = li[1].length;
      while (indentStack.length > 0 && indentStack[indentStack.length - 1] > indent) {
        indentStack.pop();
      }
      if (indentStack.length === 0 || indentStack[indentStack.length - 1] < indent) {
        indentStack.push(indent);
      }
      const text = stripInlineMarkdown(li[2]);
      if (!text) continue;
      items.push({ depth: headingDepth + indentStack.length, text, line: i + 1 });
      continue;
    }

    // 普通段落：挂在当前标题下一层。
    // 不跳过它——「跳过就是丢内容」正是本次要修的毛病。
    const text = stripInlineMarkdown(line);
    if (!text) continue;
    indentStack = [];
    items.push({ depth: headingDepth + 1, text, line: i + 1 });
  }

  return items;
}

// ────────────────────────────────────────────────────────────────
// 第二步：大纲 → 节点树
// ────────────────────────────────────────────────────────────────
export interface OutlineToNodesResult {
  nodes: DiagramNode[];
  /** 是否补了一个合成根（原文有多个平级顶层条目时） */
  syntheticRoot: boolean;
  maxDepth: number;
}

export function outlineToNodes(
  items: OutlineItem[],
  fallbackTitle = "总览"
): OutlineToNodesResult {
  const nodes: DiagramNode[] = [];
  const stack: { depth: number; id: string }[] = [];
  let seq = 0;

  for (const item of items) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= item.depth) {
      stack.pop();
    }
    const parent = stack.length > 0 ? stack[stack.length - 1].id : "";
    const id = `md${++seq}`;
    nodes.push({ id, label: item.text, parent });
    stack.push({ depth: item.depth, id });
  }

  // 单根收束：原文若有多个平级顶层条目（例如没写 # 标题、直接一串 ##），
  // 补一个合成根把它们收进来。绝不能让第二个根出现——mindmap/orgchart 的
  // 渲染只认第一个无 parent 的节点，其余整棵子树会静默消失。
  const topLevel = nodes.filter(n => !n.parent);
  let syntheticRoot = false;
  if (topLevel.length !== 1) {
    const rootId = "mdroot";
    for (const n of topLevel) n.parent = rootId;
    nodes.unshift({ id: rootId, label: fallbackTitle, parent: "" });
    syntheticRoot = true;
  }

  // 回填 level（＝真实树深度）。mindmap 布局不读它，但 orgchart 用它给
  // role 兜底（diagramBuilder.ts:858），所以必须是真实深度而不是猜的。
  const byId = new Map(nodes.map(n => [n.id, n]));
  const depthCache = new Map<string, number>();
  const depthOf = (id: string): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    const n = byId.get(id);
    const d = !n || !n.parent ? 0 : depthOf(n.parent) + 1;
    depthCache.set(id, d);
    return d;
  };
  let maxDepth = 0;
  for (const n of nodes) {
    n.level = depthOf(n.id);
    if (n.level > maxDepth) maxDepth = n.level;
  }

  return { nodes, syntheticRoot, maxDepth };
}

// ────────────────────────────────────────────────────────────────
// 第三步：判定 + 对外入口
// ────────────────────────────────────────────────────────────────

/**
 * analyzeMarkdown
 * 看这段输入是否「已经结构化」，顺带算出直转后的规模，供 UI 提示。
 *
 * 判据：至少 3 个条目，且至少出现 2 个不同层级。
 * 一整段散文会全部落在同一层 → 不算结构化 → 交给 AI 去提炼，
 * 这正是 AI 该干的事。
 */
export function analyzeMarkdown(md: string): MarkdownAnalysis {
  const items = extractOutline(md);
  const depths = new Set(items.map(i => i.depth));
  const structured = items.length >= 3 && depths.size >= 2;
  const topLevel = items.filter(i => i.depth === Math.min(...items.map(x => x.depth)));
  const nodeCount = items.length + (items.length > 0 && topLevel.length !== 1 ? 1 : 0);
  const longestLabel = items.reduce((m, i) => Math.max(m, i.text.length), 0);
  return {
    items,
    nodeCount,
    maxDepth: depths.size > 0 ? Math.max(...depths) - Math.min(...depths) + (topLevel.length !== 1 ? 1 : 0) : 0,
    structured,
    longestLabel,
  };
}

export interface DirectConvertResult {
  data: DiagramData;
  /** 源文档条目数 ＝ 应该出现在图上的要点数（不含合成根） */
  sourceItemCount: number;
  syntheticRoot: boolean;
  maxDepth: number;
}

/**
 * markdownToDiagram
 * 结构化 Markdown → DiagramData，无损。
 * 输入不够结构化、或图型不在直转白名单里，返回 null（调用方转走 AI）。
 */
export function markdownToDiagram(
  md: string,
  diagramType: string,
  fallbackTitle = "总览"
): DirectConvertResult | null {
  if (!isDirectConvertibleType(diagramType)) return null;

  const analysis = analyzeMarkdown(md);
  if (!analysis.structured) return null;

  const { nodes, syntheticRoot, maxDepth } = outlineToNodes(analysis.items, fallbackTitle);
  if (nodes.length < 2) return null; // 只解析出一个节点，画不成图，让 AI 试试

  return {
    data: {
      diagram_type: diagramType,
      nodes,
      edges: [], // 树形图的连线由布局算法按 parent 生成，这里必须留空
      source: "direct",
    },
    sourceItemCount: analysis.items.length,
    syntheticRoot,
    maxDepth,
  };
}
