/**
 * mindmapLayout.ts
 * REQ-068 一期：思维导图的纯布局模块（不依赖 Excalidraw，可直接用 node --test 测）
 *
 * ── 为什么从 diagramBuilder.ts 里拆出来 ─────────────────────────
 * 布局的核心不变量是「任意两个节点（含它挂的说明文字）不重叠」。
 * REQ-058 已经栽过一次：Excalidraw 会把装不下文字的容器撑高，撑高后压到
 * 下方兄弟节点。要守住这个不变量，必须能脱离浏览器、对大量随机树批量验证
 * ——而 diagramBuilder.ts 一 import 就拉进整个 @excalidraw/excalidraw。
 * 所以：度量 + 坐标分配放这里（纯函数），元素生成留在 diagramBuilder.ts。
 *
 * ── 两种布局（自动选）──────────────────────────────────────────
 * tree     根在最左，所有分支往右展开（原有行为，分支少时最清楚）
 * balanced 根在中间，一级分支左右分摊（分支多/节点多时更紧凑、不会又长又偏）
 * 触发：一级分支 ≥5 个，或节点总数 >20。分摊按「子树高度」贪心找最均衡的
 * 切分点；顺序按顺时针阅读——右侧自上而下，接着左侧自下而上。
 *
 * ── 说明文字（note）──────────────────────────────────────────
 * 节点可挂一句补充说明/例子，渲染为节点下方的灰色小字。它占的高度必须
 * 计入布局（否则会压到下一个兄弟），所以每个节点的「占位」＝盒高 + 说明高。
 */

import type { DiagramNode } from "./diagramBuilder";

// ── 尺寸常量 ───────────────────────────────────────────────────
export const MM_NODE_W = 180;      // 节点最小宽度
export const MM_NODE_W_MAX = 300;  // 节点最大宽度
export const MM_NODE_H = 52;       // 节点最小高度
export const MM_H_GAP = 80;        // 水平间距
export const MM_V_GAP = 22;        // 垂直间距
export const MM_TEXT_PAD = 5;      // Excalidraw 绑定文字左右内边距
export const MM_LINE_HEIGHT = 1.25;
export const MM_TARGET_LINES = 3;  // 加宽的目标：让文字尽量不超过 3 行

export const MM_NOTE_FONT = 12;    // 说明文字字号
export const MM_NOTE_GAP = 4;      // 节点盒与说明之间的间距

/** 触发左右平衡布局的阈值 */
export const BALANCE_MIN_BRANCHES = 5;
export const BALANCE_MIN_NODES = 21;

// ── 文本度量 ───────────────────────────────────────────────────
// 刻意往宽的一边估：估窄了 Excalidraw 会把容器撑高、压到兄弟节点；
// 估宽了只是盒子里多一点留白。两种错法代价不对称。
const RE_PICTO = /\p{Extended_Pictographic}/u;

export function charWidth(ch: string, fontSize: number): number {
  // 变体选择符 / 零宽连接符本身不占宽（emoji 序列里会出现）
  if (ch === "️" || ch === "‍") return 0;
  // emoji 实际约 1.2 个字号宽；原先落进 1.12 的汉字档，略低估，这里单列 1.3
  if (RE_PICTO.test(ch)) return fontSize * 1.3;
  return fontSize * (/[⺀-￿]/.test(ch) ? 1.12 : 0.66);
}

/** 逐字累加模拟折行，返回每行文字（用于给说明文字预折行） */
export function wrapText(text: string, fontSize: number, boxW: number): string[] {
  const inner = Math.max(1, boxW - MM_TEXT_PAD * 2);
  const lines: string[] = [];
  let cur = "";
  let curW = 0;
  for (const ch of text) {
    if (ch === "\n") { lines.push(cur); cur = ""; curW = 0; continue; }
    const w = charWidth(ch, fontSize);
    if (curW + w > inner && cur !== "") { lines.push(cur); cur = ch; curW = w; }
    else { cur += ch; curW += w; }
  }
  lines.push(cur);
  return lines;
}

/**
 * 标签折行数。必须逐字累加而不是「总宽 ÷ 行宽」（REQ-058 实测会漏算行尾余量）。
 * 含空格的西文按词折行可能更早换行，留一行余量——此处与原实现逐字等价。
 */
export function wrapLineCount(text: string, fontSize: number, boxW: number): number {
  const inner = Math.max(1, boxW - MM_TEXT_PAD * 2);
  let lines = 1;
  let cur = 0;
  for (const ch of text) {
    if (ch === "\n") { lines++; cur = 0; continue; }
    const w = charWidth(ch, fontSize);
    if (cur + w > inner) { lines++; cur = w; } else { cur += w; }
  }
  if (lines > 1 && /\s/.test(text)) lines += 1;
  return lines;
}

/** 该标签希望的盒宽：让文字不超过 MM_TARGET_LINES 行的最小宽度，夹在 [180, 300] */
export function preferredWidth(text: string, fontSize: number): number {
  for (let w = MM_NODE_W; w < MM_NODE_W_MAX; w += 8) {
    if (wrapLineCount(text, fontSize, w) <= MM_TARGET_LINES) return w;
  }
  return MM_NODE_W_MAX;
}

/** 标签在宽 w 的盒子里实际需要的高度 */
export function labelBoxHeight(text: string, fontSize: number, w: number): number {
  const lines = wrapLineCount(text, fontSize, w);
  return Math.max(MM_NODE_H, Math.ceil(lines * fontSize * MM_LINE_HEIGHT) + MM_TEXT_PAD * 2);
}

// ── 布局结果 ───────────────────────────────────────────────────
export interface MindmapBox {
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  /** 1＝在根右侧，-1＝在根左侧，0＝根本身 */
  side: 1 | -1 | 0;
  /** 已预折行的说明文字；无说明为空数组 */
  noteLines: string[];
  /** 说明文字占的高度（含与盒之间的间距）；无说明为 0 */
  noteBlockH: number;
}

export interface MindmapLayout {
  boxes: Map<string, MindmapBox>;
  rootId: string;
  balanced: boolean;
  fontOf: (id: string) => number;
}

export type MindmapLayoutMode = "auto" | "tree" | "balanced";

export function shouldBalance(branchCount: number, nodeCount: number): boolean {
  return branchCount >= 2 && (branchCount >= BALANCE_MIN_BRANCHES || nodeCount >= BALANCE_MIN_NODES);
}

/**
 * 计算思维导图所有节点的位置与尺寸。
 * 找不到根节点时返回 null（调用方应输出空数组）。
 * 只给能从根走到的节点分配位置，游离节点不出现在 boxes 里（与原行为一致）。
 */
export function layoutMindmap(
  nodes: DiagramNode[],
  ox: number,
  oy: number,
  mode: MindmapLayoutMode = "auto"
): MindmapLayout | null {
  const children = new Map<string, string[]>();
  const byId = new Map<string, DiagramNode>();
  for (const n of nodes) {
    byId.set(n.id, n);
    if (!children.has(n.id)) children.set(n.id, []);
    if (n.parent) {
      const arr = children.get(n.parent) ?? [];
      arr.push(n.id);
      children.set(n.parent, arr);
    }
  }
  const root = nodes.find(n => !n.parent);
  if (!root) return null;

  // 真实树深度（不依赖 AI 返回的 level；顺带防环）
  const depthOf = new Map<string, number>();
  (function walk(id: string, d: number) {
    if (depthOf.has(id)) return;
    depthOf.set(id, d);
    for (const kid of children.get(id) ?? []) walk(kid, d + 1);
  })(root.id, 0);

  const fontOf = (id: string) => (id === root.id ? 16 : 14);

  // 每列宽度 ＝ 该列最长标签所需宽度（列内统一，保持纵向对齐）
  const colW: number[] = [];
  for (const n of nodes) {
    const d = depthOf.get(n.id);
    if (d === undefined) continue;
    const w = preferredWidth(n.label, fontOf(n.id)) + (n.id === root.id ? 20 : 0);
    colW[d] = Math.max(colW[d] ?? MM_NODE_W, w);
  }
  const widthOf = (id: string) => colW[depthOf.get(id) ?? 0] ?? MM_NODE_W;

  // 每个节点的盒高、说明、占位高度
  const heightOf = new Map<string, number>();
  const noteLinesOf = new Map<string, string[]>();
  const noteBlockOf = new Map<string, number>();
  const slotOf = new Map<string, number>();
  for (const n of nodes) {
    if (!depthOf.has(n.id)) continue;
    const w = widthOf(n.id);
    const h = labelBoxHeight(n.label, fontOf(n.id), w);
    heightOf.set(n.id, h);
    const note = n.note?.trim();
    const lines = note ? wrapText(note, MM_NOTE_FONT, w) : [];
    noteLinesOf.set(n.id, lines);
    const nb = lines.length > 0 ? MM_NOTE_GAP + Math.ceil(lines.length * MM_NOTE_FONT * MM_LINE_HEIGHT) : 0;
    noteBlockOf.set(n.id, nb);
    slotOf.set(n.id, h + nb);
  }

  // 子树占高：max(自己占位, 全部子树占高之和 + 间距)
  const subH = new Map<string, number>();
  const kidsSum = (id: string): number => {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) return 0;
    return kids.reduce((s, k) => s + (subH.get(k) ?? 0), 0) + (kids.length - 1) * MM_V_GAP;
  };
  (function calc(id: string) {
    for (const kid of children.get(id) ?? []) calc(kid);
    subH.set(id, Math.max(slotOf.get(id) ?? MM_NODE_H, kidsSum(id)));
  })(root.id);

  const rootKids = children.get(root.id) ?? [];
  const balanced =
    mode === "balanced" ? rootKids.length >= 2
    : mode === "tree" ? false
    : shouldBalance(rootKids.length, depthOf.size);

  // 列的 x（根在 x=0）：右侧向右累加；左侧向左累加
  const maxDepth = Math.max(...Array.from(depthOf.values()));
  const xRight: number[] = [0];
  for (let d = 1; d <= maxDepth; d++) {
    xRight[d] = d === 1 ? colW[0] + MM_H_GAP : xRight[d - 1] + colW[d - 1] + MM_H_GAP;
  }
  const xLeft: number[] = [0];
  let edge = -MM_H_GAP; // 第 1 列的右边缘
  for (let d = 1; d <= maxDepth; d++) {
    xLeft[d] = edge - colW[d];
    edge = xLeft[d] - MM_H_GAP;
  }

  const boxes = new Map<string, MindmapBox>();
  const put = (id: string, x: number, y: number, side: 1 | -1 | 0) => {
    boxes.set(id, {
      x, y,
      w: widthOf(id),
      h: heightOf.get(id) ?? MM_NODE_H,
      depth: depthOf.get(id) ?? 0,
      side,
      noteLines: noteLinesOf.get(id) ?? [],
      noteBlockH: noteBlockOf.get(id) ?? 0,
    });
  };

  // 在 [topY, topY+subH] 的区间里放下 id 及其整棵子树。
  // 占位在区间内居中；子树整体也在区间内居中。
  const place = (id: string, topY: number, side: 1 | -1) => {
    const d = depthOf.get(id) ?? 0;
    const H = subH.get(id) ?? MM_NODE_H;
    const slot = slotOf.get(id) ?? MM_NODE_H;
    put(id, side === 1 ? xRight[d] : xLeft[d], topY + (H - slot) / 2, side);
    let cursor = topY + (H - kidsSum(id)) / 2;
    for (const kid of children.get(id) ?? []) {
      place(kid, cursor, side);
      cursor += (subH.get(kid) ?? MM_NODE_H) + MM_V_GAP;
    }
  };

  const rootSlot = slotOf.get(root.id) ?? MM_NODE_H;

  if (!balanced) {
    place(root.id, 0, 1);
    // place 把根也放在了 xRight[0]=0、side=1，改回 side=0
    const rb = boxes.get(root.id)!;
    rb.side = 0;
  } else {
    // 找最均衡的切分点（保证两侧都非空）
    const sums = rootKids.map(k => subH.get(k) ?? 0);
    const sumOf = (a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += sums[i];
      return s + Math.max(0, b - a - 1) * MM_V_GAP;
    };
    let bestK = 1;
    let bestDiff = Infinity;
    for (let k = 1; k < rootKids.length; k++) {
      const diff = Math.abs(sumOf(0, k) - sumOf(k, rootKids.length));
      if (diff < bestDiff) { bestDiff = diff; bestK = k; }
    }
    const rightKids = rootKids.slice(0, bestK);
    // 顺时针阅读：左侧自下而上，所以画面上自上而下是原顺序的倒序
    const leftKids = rootKids.slice(bestK).reverse();
    const hR = sumOf(0, bestK);
    const hL = sumOf(bestK, rootKids.length);
    const total = Math.max(hR, hL, rootSlot);

    put(root.id, 0, (total - rootSlot) / 2, 0);

    let cursor = (total - hR) / 2;
    for (const kid of rightKids) {
      place(kid, cursor, 1);
      cursor += (subH.get(kid) ?? MM_NODE_H) + MM_V_GAP;
    }
    cursor = (total - hL) / 2;
    for (const kid of leftKids) {
      place(kid, cursor, -1);
      cursor += (subH.get(kid) ?? MM_NODE_H) + MM_V_GAP;
    }
  }

  // 平移到 (ox, oy)：所有盒子的左上角包围盒从 (ox, oy) 起
  let minX = Infinity;
  let minY = Infinity;
  boxes.forEach(b => {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
  });
  boxes.forEach(b => {
    b.x += ox - minX;
    b.y += oy - minY;
  });

  return { boxes, rootId: root.id, balanced, fontOf };
}
