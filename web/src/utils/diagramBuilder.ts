/**
 * diagramBuilder.ts
 * AI 图形生成 — 统一布局引擎
 * 将后端返回的 { nodes, edges } 转换为合法的 Excalidraw elements
 *
 * 支持5种图形类型：
 *   mindmap   — 左→右放射式思维导图
 *   flowchart — 上→下标准流程图（含菱形决策节点）
 *   timeline  — 水平时间轴（主轴 + 交错上下事件）
 *   orgchart  — 上→下组织架构图
 *   fishbone  — 鱼骨因果图
 */

import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
// 从函数签名反推元素类型，避免依赖特定版本的内部类型路径
type ExcalidrawElement = NonNullable<ReturnType<typeof convertToExcalidrawElements>>[number];

// ────────────────────────────────────────────────────────────────
// 数据类型（与后端 DiagramResponse 对齐）
// ────────────────────────────────────────────────────────────────
export interface DiagramNode {
  id: string;
  label: string;
  parent: string;
  level?: number;
  node_type?: "start" | "end" | "process" | "decision" | "normal";
  role?: "lead" | "dept" | "member";
  side?: "top" | "bottom";
  sequence?: number;
  time?: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

// REQ-050 一期：后端结构体检的回执
// repairs＝已自动修好的（老师只需知情），issues＝不敢自动修、需要人判断的
export interface DiagramRepair {
  code: string;
  detail: string;
  count: number;
}
export type DiagramIssue = DiagramRepair;

export interface DiagramData {
  diagram_type: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  repairs?: DiagramRepair[];
  issues?: DiagramIssue[];
  regenerated?: boolean;
}

// ────────────────────────────────────────────────────────────────
// 统一入口
// ────────────────────────────────────────────────────────────────
export function buildDiagramElements(
  data: DiagramData,
  originX = 0,
  originY = 0
): ExcalidrawElement[] {
  switch (data.diagram_type) {
    case "mindmap":   return buildMindmap(data.nodes, originX, originY);
    case "flowchart": return buildFlowchart(data.nodes, data.edges, originX, originY);
    case "timeline":  return buildTimeline(data.nodes, originX, originY);
    case "orgchart":  return buildOrgchart(data.nodes, originX, originY);
    case "fishbone":  return buildFishbone(data.nodes, originX, originY);
    default:          return buildMindmap(data.nodes, originX, originY);
  }
}

// ────────────────────────────────────────────────────────────────
// 配色主题（REQ-049）
// 六套可选风格：马卡龙(默认)/活泼卡通/暖木/牛油果森林绿/莫兰迪/黛蓝北欧风。
// 颜色全在前端，切换存 localStorage(mc_diagram_theme)，后端不参与。
// 每套：anchor(根/标题/负责人) + branch[5](按分支/类别循环取色)
//       + flow4(开始/处理/判断/结束) + fishHead(鱼头) + 提亮参数(lightenStep/Cap)。
// 派生规则（与预览 临时_配色风格预览_可切换.html 一致）：
//   timeline 主节点取 branch[1]、说明取其提亮版；
//   orgchart 部门取 branch[2]、成员取其提亮版；
//   fishbone 原因按序号循环取 branch、子刺取其提亮版；鱼头用 fishHead。
// ────────────────────────────────────────────────────────────────
type Triad = { bg: string; stroke: string; text: string };
export interface DiagramTheme {
  anchor: Triad;
  branch: Triad[];
  flow: { start: Triad; process: Triad; decision: Triad; end: Triad };
  fishHead: Triad;
  lightenStep: number;
  lightenCap: number;
}

const DIAGRAM_THEME_TABLE: Record<string, { label: string; theme: DiagramTheme }> = {
  macaron: { label: "马卡龙", theme: {
    anchor: { bg: "#F7A98F", stroke: "#E06B4E", text: "#5E2416" },
    branch: [
      { bg: "#FBD3DE", stroke: "#E8788F", text: "#8A2E44" },
      { bg: "#CDEFDD", stroke: "#4FC08A", text: "#1E6B47" },
      { bg: "#CFE6FB", stroke: "#5AA6E8", text: "#1E4E7A" },
      { bg: "#E2D6F7", stroke: "#9B7BE0", text: "#4A337A" },
      { bg: "#FCEEC0", stroke: "#E8C24F", text: "#7A5E14" }],
    flow: {
      start:    { bg: "#CDEFDD", stroke: "#4FC08A", text: "#1E6B47" },
      process:  { bg: "#CFE6FB", stroke: "#5AA6E8", text: "#1E4E7A" },
      decision: { bg: "#FCEEC0", stroke: "#E8C24F", text: "#7A5E14" },
      end:      { bg: "#FBD3DE", stroke: "#E8788F", text: "#8A2E44" } },
    fishHead: { bg: "#FCC9BE", stroke: "#E8674A", text: "#6B241A" },
    lightenStep: 0.10, lightenCap: 0.24 } },
  cartoon: { label: "活泼卡通", theme: {
    anchor: { bg: "#FF9A3D", stroke: "#E9741A", text: "#ffffff" },
    branch: [
      { bg: "#FFB3B3", stroke: "#F0554F", text: "#8A2020" },
      { bg: "#B6E8A6", stroke: "#4CA82F", text: "#206016" },
      { bg: "#A9D8F5", stroke: "#2E90D9", text: "#14507E" },
      { bg: "#FFE39A", stroke: "#F0B41E", text: "#7A5400" },
      { bg: "#D9BEF0", stroke: "#9B54D9", text: "#4E207E" }],
    flow: {
      start:    { bg: "#B6E8A6", stroke: "#4CA82F", text: "#206016" },
      process:  { bg: "#A9D8F5", stroke: "#2E90D9", text: "#14507E" },
      decision: { bg: "#FFE39A", stroke: "#F0B41E", text: "#7A5400" },
      end:      { bg: "#FFB3B3", stroke: "#F0554F", text: "#8A2020" } },
    fishHead: { bg: "#FFB8B0", stroke: "#F0554F", text: "#8A2020" },
    lightenStep: 0.10, lightenCap: 0.24 } },
  warm: { label: "暖木", theme: {
    anchor: { bg: "#BA7517", stroke: "#7A4D0E", text: "#ffffff" },
    branch: [
      { bg: "#F6C9B8", stroke: "#C0502E", text: "#6B2213" },
      { bg: "#B8DDD6", stroke: "#2E7D6B", text: "#1C4A40" },
      { bg: "#BAD4E8", stroke: "#2C6B9E", text: "#17395C" },
      { bg: "#DFC9DD", stroke: "#8A4F82", text: "#4A2A44" },
      { bg: "#EAD69A", stroke: "#A67C1E", text: "#5A4310" }],
    flow: {
      start:    { bg: "#CDE9D6", stroke: "#2E8B57", text: "#1A3A2A" },
      process:  { bg: "#D6E4F0", stroke: "#3A6EA5", text: "#1A2E4A" },
      decision: { bg: "#FAE3B0", stroke: "#C08A1E", text: "#5A3E00" },
      end:      { bg: "#F5CDCB", stroke: "#B0433E", text: "#4A1613" } },
    fishHead: { bg: "#F1C9C6", stroke: "#A32D2D", text: "#4A1613" },
    lightenStep: 0.12, lightenCap: 0.28 } },
  forest: { label: "牛油果森林绿", theme: {
    anchor: { bg: "#4E7A47", stroke: "#35592F", text: "#ffffff" },
    branch: [
      { bg: "#CFE0B4", stroke: "#6E9A47", text: "#38541F" },
      { bg: "#C0D3BC", stroke: "#5E8062", text: "#2E4632" },
      { bg: "#E3D3B8", stroke: "#A6844E", text: "#574126" },
      { bg: "#B7D8D0", stroke: "#3E8577", text: "#1E4A40" },
      { bg: "#E6D69A", stroke: "#A98A2E", text: "#574414" }],
    flow: {
      start:    { bg: "#CFE0B4", stroke: "#6E9A47", text: "#38541F" },
      process:  { bg: "#B7D8D0", stroke: "#3E8577", text: "#1E4A40" },
      decision: { bg: "#E6D69A", stroke: "#A98A2E", text: "#574414" },
      end:      { bg: "#E1C2AE", stroke: "#A65E3E", text: "#5A2E1A" } },
    fishHead: { bg: "#E0BDB0", stroke: "#A15238", text: "#4E2418" },
    lightenStep: 0.11, lightenCap: 0.27 } },
  morandi: { label: "莫兰迪", theme: {
    anchor: { bg: "#9C8574", stroke: "#6B5B4C", text: "#ffffff" },
    branch: [
      { bg: "#D9C2BE", stroke: "#93685F", text: "#4A332E" },
      { bg: "#C3CDBE", stroke: "#6E7B62", text: "#38402F" },
      { bg: "#BFCBD1", stroke: "#647680", text: "#33414A" },
      { bg: "#CDC3CB", stroke: "#7C6C79", text: "#423A41" },
      { bg: "#D6CBB4", stroke: "#8A7A57", text: "#47402C" }],
    flow: {
      start:    { bg: "#C3CDBE", stroke: "#6E7B62", text: "#38402F" },
      process:  { bg: "#BFCBD1", stroke: "#647680", text: "#33414A" },
      decision: { bg: "#D6CBB4", stroke: "#8A7A57", text: "#47402C" },
      end:      { bg: "#D9C2BE", stroke: "#93685F", text: "#4A332E" } },
    fishHead: { bg: "#CDB4AE", stroke: "#8A5B52", text: "#4A332E" },
    lightenStep: 0.12, lightenCap: 0.26 } },
  nordic: { label: "黛蓝北欧风", theme: {
    anchor: { bg: "#33506E", stroke: "#22384F", text: "#ffffff" },
    branch: [
      { bg: "#C3D3E2", stroke: "#4E729A", text: "#21384F" },
      { bg: "#BFD4D2", stroke: "#4E7E7A", text: "#23403E" },
      { bg: "#CBCEE0", stroke: "#6E729E", text: "#313452" },
      { bg: "#CBD5C8", stroke: "#6C8168", text: "#2F3E2C" },
      { bg: "#E4D8C3", stroke: "#A6875A", text: "#4E3D22" }],
    flow: {
      start:    { bg: "#BFD4D2", stroke: "#4E7E7A", text: "#23403E" },
      process:  { bg: "#C3D3E2", stroke: "#4E729A", text: "#21384F" },
      decision: { bg: "#E4D8C3", stroke: "#A6875A", text: "#4E3D22" },
      end:      { bg: "#DCC6C6", stroke: "#9A5E5E", text: "#43242A" } },
    fishHead: { bg: "#D9BEC0", stroke: "#96505A", text: "#43242A" },
    lightenStep: 0.11, lightenCap: 0.26 } },
};

const DEFAULT_THEME_KEY = "macaron";
const THEME_STORAGE_KEY = "mc_diagram_theme";

// 给 UI 下拉用：[{key,label}, ...]
export const DIAGRAM_THEMES = Object.entries(DIAGRAM_THEME_TABLE).map(
  ([key, v]) => ({ key, label: v.label })
);

export function getDiagramThemeKey(): string {
  try {
    if (typeof localStorage !== "undefined") {
      const k = localStorage.getItem(THEME_STORAGE_KEY);
      if (k && DIAGRAM_THEME_TABLE[k]) return k;
    }
  } catch { /* localStorage 不可用时回落默认 */ }
  return DEFAULT_THEME_KEY;
}

export function setDiagramThemeKey(key: string): void {
  try {
    if (DIAGRAM_THEME_TABLE[key] && typeof localStorage !== "undefined") {
      localStorage.setItem(THEME_STORAGE_KEY, key);
    }
  } catch { /* 忽略写入失败 */ }
}

function getActiveTheme(): DiagramTheme {
  return DIAGRAM_THEME_TABLE[getDiagramThemeKey()].theme;
}

// 把某档颜色按深度提亮（bg 向白混合，stroke/text 不变），用于同分支/同类的浅色层级
function themeLighten(c: Triad, amt: number): Triad {
  return { bg: lightenHex(c.bg, amt), stroke: c.stroke, text: c.text };
}

// ────────────────────────────────────────────────────────────────
// 几何箭头工具（REQ-027 崩溃修复）
// 绑定式箭头（start/end 指向元素 id）在 Excalidraw v0.18 插入场景后
// 重算绑定会产生 NaN 坐标 → 渲染崩溃 + 持久化损坏（x/y 变 null）。
// 节点布局本来就是我们显式计算的，箭头直接给定几何坐标即可，不需要绑定。
// ────────────────────────────────────────────────────────────────
function geoArrow(
  id: string,
  x1: number, y1: number,
  x2: number, y2: number,
  opts: { strokeColor?: string; strokeWidth?: number; label?: string } = {}
) {
  let dx = x2 - x1;
  let dy = y2 - y1;
  // 防零长度箭头（roughjs 对退化路径可能异常）
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) dx = 1;
  return {
    type: "arrow",
    id,
    x: x1,
    y: y1,
    width: Math.abs(dx),
    height: Math.abs(dy),
    points: [[0, 0], [dx, dy]],
    strokeColor: opts.strokeColor ?? "#555",
    strokeWidth: opts.strokeWidth ?? 1.5,
    endArrowhead: "arrow",
    ...(opts.label ? { label: { text: opts.label, fontSize: 12 } } : {}),
  } as any;
}

// ────────────────────────────────────────────────────────────────
// Frame 容器化（REQ-030）
// 把一次生成的全部元素包进一个 Excalidraw Frame：有边框 + 标题栏，
// 拖动 Frame 时内部元素整体跟随（Excalidraw 原生行为，不用手动维护）。
// 技术依据（2026-07-09 用 @excalidraw/excalidraw@0.18.1 实际源码核实，
// 非猜测）：convertToExcalidrawElements 内部会对 type:"frame" 的 skeleton
// 做二次处理——按 children 里给的（转换前）id，通过内部 oldToNewElementIdMap
// 换算成转换后的真实 id，再把 frameId 反向写回每个子元素；边界框也会按
// children 实际坐标自动算好（+10px padding），不用自己算。
// 这跟 REQ-027 PR#6 禁掉的"箭头 start/end 绑定"是两套完全不同的机制——
// 箭头绑定会触发坐标重算产生 NaN，Frame 的 children 只是做 id 归属登记，
// 不涉及坐标重算，翻源码确认过没有同类风险，不违反"禁绑定"铁律。
// ────────────────────────────────────────────────────────────────
let frameSeq = 0;
function wrapInFrame(
  skeletons: NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>,
  namePrefix: string,
  name: string
) {
  const children = (skeletons as any[]).map(s => s.id).filter(Boolean);
  if (children.length === 0) return;
  frameSeq++;
  skeletons.push({
    type: "frame",
    id: `frame_${namePrefix}_${Date.now().toString(36)}_${frameSeq}`,
    name: name || undefined,
    children,
  } as any);
}

// ────────────────────────────────────────────────────────────────
// 1. 思维导图（左→右树形）
// REQ-031（2026-07-09）：配色从「按深度统一」改为「按一级分支上色」——
// 每条从根节点出发的一级分支各分配一个颜色，其全部后代节点与连线继承
// 同一色相，深度越深背景色越浅（保留层级感，色相不变）。
// 调色板取自用户 markdown-mindmap 项目 MindmapPreview.tsx 的暖色 5 色组，
// 比参考图的高饱和彩虹色更贴近 MindCanvas 暖木教育主题。
// 连线改用 mindmapEdge()：三点几何路径 + roundness 制造有机曲线感，
// 仍是显式坐标、不涉及绑定，遵守 REQ-027 PR#6 定下的「严禁 skeleton
// start/end:{id} 绑定式箭头」铁律。
// ────────────────────────────────────────────────────────────────
const MM_NODE_W = 180;
const MM_NODE_H = 52;
const MM_H_GAP = 80;   // 水平间距
const MM_V_GAP = 22;   // 垂直间距

// REQ-049：分支/根配色改由当前主题提供（见 DIAGRAM_THEME_TABLE）。
// 原固定的 MM_BRANCH_PALETTE / MM_ROOT_COLOR 已并入主题表，按 branch / anchor 取。

// 把颜色往白色方向混合 amt（0~1），用于同一分支内按深度做浅色过渡
function lightenHex(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  return `#${[mix(r), mix(g), mix(b)]
    .map(v => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

// 分支曲线连线：显式三点路径（起点→中段水平探出→终点）+ roundness 平滑，
// 全程几何坐标，不使用绑定机制。
function mindmapEdge(
  id: string,
  x1: number, y1: number,
  x2: number, y2: number,
  opts: { strokeColor?: string; strokeWidth?: number } = {}
) {
  let dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) dx = 1;
  const midX = dx * 0.55;
  const midY = dy * 0.12;
  return {
    type: "arrow",
    id,
    x: x1,
    y: y1,
    width: Math.abs(dx) || 1,
    height: Math.abs(dy) || 1,
    points: [[0, 0], [midX, midY], [dx, dy]],
    roundness: { type: 2 },
    strokeColor: opts.strokeColor ?? "#555",
    strokeWidth: opts.strokeWidth ?? 2,
    endArrowhead: null,
    startArrowhead: null,
  } as any;
}

function buildMindmap(nodes: DiagramNode[], ox: number, oy: number): ExcalidrawElement[] {
  const T = getActiveTheme();
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // 构建子节点列表
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (!children.has(n.id)) children.set(n.id, []);
    if (n.parent) {
      const arr = children.get(n.parent) ?? [];
      arr.push(n.id);
      children.set(n.parent, arr);
    }
  }

  const root = nodes.find(n => !n.parent);
  if (!root) return [];

  // 计算每个节点的子树高度（单位：行）
  const treeHeight = new Map<string, number>();
  function calcHeight(id: string): number {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) { treeHeight.set(id, 1); return 1; }
    const h = kids.reduce((sum, kid) => sum + calcHeight(kid), 0);
    treeHeight.set(id, h);
    return h;
  }
  calcHeight(root.id);

  // 分配坐标（同时记录真实树深度，不依赖 AI 返回的 level 字段是否可靠）
  const coords = new Map<string, { x: number; y: number }>();
  const depthOf = new Map<string, number>();
  function layout(id: string, depth: number, topY: number) {
    const h = treeHeight.get(id) ?? 1;
    const centerY = topY + (h * (MM_NODE_H + MM_V_GAP)) / 2 - MM_NODE_H / 2;
    coords.set(id, { x: ox + depth * (MM_NODE_W + MM_H_GAP), y: oy + centerY });
    depthOf.set(id, depth);
    let cursor = topY;
    for (const kid of children.get(id) ?? []) {
      const kidH = treeHeight.get(kid) ?? 1;
      layout(kid, depth + 1, cursor);
      cursor += kidH * (MM_NODE_H + MM_V_GAP);
    }
  }
  layout(root.id, 0, 0);

  // REQ-031：按一级分支分配颜色，向下传给该分支全部后代（不再按深度统一配色）
  const branchColorOf = new Map<string, { bg: string; stroke: string; text: string }>();
  branchColorOf.set(root.id, T.anchor);
  const rootChildren = children.get(root.id) ?? [];
  rootChildren.forEach((childId, idx) => {
    const branchColor = T.branch[idx % T.branch.length];
    const assign = (id: string) => {
      branchColorOf.set(id, branchColor);
      for (const kid of children.get(id) ?? []) assign(kid);
    };
    assign(childId);
  });

  // 生成 Excalidraw skeleton
  const skeletons: NonNullable<Parameters<typeof convertToExcalidrawElements>[0]> = [];
  const nodeElemId = (id: string) => `mm_node_${id}`;
  const edgeElemId = (pid: string, cid: string) => `mm_edge_${pid}_${cid}`;

  for (const n of nodes) {
    const pos = coords.get(n.id);
    if (!pos) continue;
    const isRoot = !n.parent;
    const depth = depthOf.get(n.id) ?? 0;
    const branchColor = branchColorOf.get(n.id) ?? T.branch[0];
    // 分支节点本身（depth1）用基础色，越往下的子孙节点背景色越浅，色相不变
    // REQ-049：提亮步长/封顶改由主题控制（收窄后深层不再发白）
    const lightenAmt = isRoot ? 0 : Math.min(T.lightenCap, Math.max(0, depth - 1) * T.lightenStep);
    const color = isRoot
      ? T.anchor
      : {
          bg: lightenHex(branchColor.bg, lightenAmt),
          stroke: branchColor.stroke,
          text: branchColor.text,
        };

    skeletons.push({
      type: "rectangle",
      id: nodeElemId(n.id),
      x: pos.x,
      y: pos.y,
      width: isRoot ? MM_NODE_W + 20 : MM_NODE_W,
      height: MM_NODE_H,
      backgroundColor: color.bg,
      strokeColor: color.stroke,
      strokeWidth: isRoot ? 2 : 1.5,
      roundness: { type: 3 },
      label: {
        text: n.label,
        fontSize: isRoot ? 16 : 14,
        fontFamily: 2,
        color: color.text,
      },
    } as any);

    // 连线（从父右边缘中点 → 子左边缘中点，几何式三点曲线）
    // 取子节点自己所属分支的颜色，这样从根部辐射出去的第一段就已经是分支色，
    // 与参考图「每条主干一个颜色贯穿到底」的效果一致。
    if (n.parent && coords.has(n.parent)) {
      const pPos = coords.get(n.parent)!;
      const pNode = nodeMap.get(n.parent);
      const pW = pNode && !pNode.parent ? MM_NODE_W + 20 : MM_NODE_W;
      const edgeColor = branchColorOf.get(n.id) ?? T.branch[0];
      skeletons.push(mindmapEdge(
        edgeElemId(n.parent, n.id),
        pPos.x + pW, pPos.y + MM_NODE_H / 2,
        pos.x, pos.y + MM_NODE_H / 2,
        { strokeColor: edgeColor.stroke, strokeWidth: depth <= 1 ? 2.5 : 1.5 }
      ));
    }
  }

  wrapInFrame(skeletons, "mm", root.label ? `AI 思维导图 · ${root.label}` : "AI 思维导图");
  return convertToExcalidrawElements(skeletons) as ExcalidrawElement[];
}

// ────────────────────────────────────────────────────────────────
// 2. 流程图（上→下）
// ────────────────────────────────────────────────────────────────
const FC_NODE_W = 180;
const FC_NODE_H = 56;
const FC_DIAM_W = 160; // 菱形宽
const FC_DIAM_H = 72;  // 菱形高
const FC_H_GAP = 70;
const FC_V_GAP = 78;

function buildFlowchart(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  ox: number,
  oy: number
): ExcalidrawElement[] {
  const T = getActiveTheme();
  // 用 BFS 按 parent 关系分配层级和列
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parent && !edges.some(e => e.from === n.parent && e.to === n.id)) {
      const arr = children.get(n.parent) ?? [];
      arr.push(n.id);
      children.set(n.parent, arr);
    }
  }

  const levelOf = new Map<string, number>();
  const colOf = new Map<string, number>();
  const root = nodes.find(n => !n.parent);
  if (!root) return [];

  // BFS 确定层级
  const queue = [{ id: root.id, level: 0 }];
  const levelGroups: string[][] = [];
  while (queue.length) {
    const { id, level } = queue.shift()!;
    if (levelOf.has(id)) continue;
    levelOf.set(id, level);
    if (!levelGroups[level]) levelGroups[level] = [];
    levelGroups[level].push(id);
    for (const kid of children.get(id) ?? []) {
      queue.push({ id: kid, level: level + 1 });
    }
  }
  // 补充 edges 中额外的节点（decision 分支等）
  for (const e of edges) {
    if (!levelOf.has(e.to)) {
      const fromLevel = levelOf.get(e.from) ?? 0;
      const newLevel = fromLevel + 1;
      levelOf.set(e.to, newLevel);
      if (!levelGroups[newLevel]) levelGroups[newLevel] = [];
      levelGroups[newLevel].push(e.to);
    }
  }

  // 确定每层的列位置（居中）
  for (const group of levelGroups) {
    const total = group.length;
    group.forEach((id, idx) => colOf.set(id, idx - (total - 1) / 2));
  }

  const nodeWidth = (id: string) =>
    nodeMap.get(id)?.node_type === "decision" ? FC_DIAM_W : FC_NODE_W;
  const nodeHeight = (id: string) =>
    nodeMap.get(id)?.node_type === "decision" ? FC_DIAM_H : FC_NODE_H;

  const getPos = (id: string) => {
    const level = levelOf.get(id) ?? 0;
    const col = colOf.get(id) ?? 0;
    return {
      x: ox + col * (FC_NODE_W + FC_H_GAP),
      y: oy + level * (Math.max(FC_NODE_H, FC_DIAM_H) + FC_V_GAP),
    };
  };

  const skeletons: NonNullable<Parameters<typeof convertToExcalidrawElements>[0]> = [];
  const nodeElemId = (id: string) => `fc_node_${id}`;
  const edgeElemId = (f: string, t: string, idx: number) => `fc_edge_${f}_${t}_${idx}`;

  // 渲染节点
  for (const n of nodes) {
    const pos = getPos(n.id);
    const nt = n.node_type ?? "process";
    const color = T.flow[nt as keyof typeof T.flow] ?? T.flow.process;

    if (nt === "decision") {
      skeletons.push({
        type: "diamond",
        id: nodeElemId(n.id),
        x: pos.x - FC_DIAM_W / 2,
        y: pos.y,
        width: FC_DIAM_W,
        height: FC_DIAM_H,
        backgroundColor: color.bg,
        strokeColor: color.stroke,
        strokeWidth: 1.5,
        label: { text: n.label, fontSize: 13, fontFamily: 2, color: color.text },
      } as any);
    } else {
      const isRounded = nt === "start" || nt === "end";
      skeletons.push({
        type: "rectangle",
        id: nodeElemId(n.id),
        x: pos.x - FC_NODE_W / 2,
        y: pos.y,
        width: FC_NODE_W,
        height: FC_NODE_H,
        backgroundColor: color.bg,
        strokeColor: color.stroke,
        strokeWidth: 1.5,
        roundness: isRounded ? { type: 3 } : null,
        label: { text: n.label, fontSize: 14, fontFamily: 2, color: color.text },
      } as any);
    }
  }

  // parent 关系连线（父底部中点 → 子顶部中点，几何式；getPos 的 x 是中心、y 是顶部）
  for (const n of nodes) {
    if (!n.parent) continue;
    // BUG-016：若该 parent→子 关系已由显式 edge 表达（如 decision 分支），这里不再重复画箭头，
    // 否则同一对节点会出现两条箭头 → "箭头乱标记" + 交叉。
    if (edges.some(e => e.from === n.parent && e.to === n.id)) continue;
    const from = getPos(n.parent);
    const to = getPos(n.id);
    skeletons.push(geoArrow(
      edgeElemId(n.parent, n.id, 0),
      from.x, from.y + nodeHeight(n.parent),
      to.x, to.y
    ));
  }

  // 额外 edges（decision 分支、回环等，几何式，按相对方位选边缘连接点）
  edges.forEach((e, idx) => {
    const f = getPos(e.from);
    const t = getPos(e.to);
    const fh = nodeHeight(e.from);
    const fw = nodeWidth(e.from);
    const th = nodeHeight(e.to);
    const tw = nodeWidth(e.to);
    let x1: number, y1: number, x2: number, y2: number;
    if (t.y > f.y + fh / 2) {
      // 向下：父底部 → 子顶部
      x1 = f.x; y1 = f.y + fh; x2 = t.x; y2 = t.y;
    } else if (t.y + th / 2 < f.y) {
      // 回环向上：父顶部 → 子底部
      x1 = f.x; y1 = f.y; x2 = t.x; y2 = t.y + th;
    } else if (t.x >= f.x) {
      // 同层向右：父右侧 → 子左侧
      x1 = f.x + fw / 2; y1 = f.y + fh / 2; x2 = t.x - tw / 2; y2 = t.y + th / 2;
    } else {
      // 同层向左：父左侧 → 子右侧
      x1 = f.x - fw / 2; y1 = f.y + fh / 2; x2 = t.x + tw / 2; y2 = t.y + th / 2;
    }
    skeletons.push(geoArrow(
      edgeElemId(e.from, e.to, idx + 100),
      x1, y1, x2, y2,
      { label: e.label || undefined }
    ));
  });

  wrapInFrame(skeletons, "fc", root.label ? `AI 流程图 · ${root.label}` : "AI 流程图");
  return convertToExcalidrawElements(skeletons) as ExcalidrawElement[];
}

// ────────────────────────────────────────────────────────────────
// 3. 时间轴（水平，交错上下）
// ────────────────────────────────────────────────────────────────
const TL_NODE_W = 160;
const TL_NODE_H = 52;
const TL_SUB_W = 140;
const TL_SUB_H = 42;
const TL_H_STEP = 200; // 主轴节点水平间距

function buildTimeline(nodes: DiagramNode[], ox: number, oy: number): ExcalidrawElement[] {
  const T = getActiveTheme();
  const tlMain = T.branch[1];                 // 主轴节点色
  const tlSub = themeLighten(tlMain, 0.5);    // 说明卡：主色提亮
  const titleNode = nodes.find(n => !n.parent);
  const mainNodes = nodes
    .filter(n => n.parent === titleNode?.id)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const subOf = new Map<string, DiagramNode[]>();
  for (const n of nodes) {
    if (n.parent && n.parent !== titleNode?.id) {
      const arr = subOf.get(n.parent) ?? [];
      arr.push(n);
      subOf.set(n.parent, arr);
    }
  }

  const skeletons: NonNullable<Parameters<typeof convertToExcalidrawElements>[0]> = [];

  // BUG-016：先按「每个主节点的子说明数」做纵向预算，标题独占顶部一行、主轴位置动态下移，
  // 保证「标题 / 主节点 / 子节点」三层互不重叠；子节点箭头改为逐个接力（不再全从主节点出发穿卡片）。
  const TL_TITLE_H = 46;
  const TL_TITLE_GAP = 34;   // 标题与最顶层内容的间隙
  const TL_SUB_GAP = 10;     // 子节点之间/与主节点的间隙
  const TL_STEM_GAP = 46;    // 主节点靠轴一边到主轴的竖线长度
  const topNodes = mainNodes.filter((_, i) => i % 2 === 0);
  const botNodes = mainNodes.filter((_, i) => i % 2 !== 0);
  const maxSubsTop = topNodes.reduce((m, n) => Math.max(m, subOf.get(n.id)?.length ?? 0), 0);
  const topBudget = TL_STEM_GAP + TL_NODE_H + maxSubsTop * (TL_SUB_H + TL_SUB_GAP) + TL_SUB_GAP;

  const axisY = oy + TL_TITLE_H + TL_TITLE_GAP + topBudget; // 主轴 Y（随上方内容动态下移）
  const startX = ox + 80;
  const endX = startX + Math.max(1, mainNodes.length - 1) * TL_H_STEP + 80;

  // 标题：顶部独占一行（居左），不与任何节点同列重叠
  if (titleNode) {
    const color = T.anchor;
    skeletons.push({
      type: "rectangle",
      id: `tl_node_${titleNode.id}`,
      x: ox,
      y: oy,
      width: TL_NODE_W + 40,
      height: TL_TITLE_H,
      backgroundColor: color.bg,
      strokeColor: color.stroke,
      strokeWidth: 2,
      roundness: { type: 3 },
      label: { text: titleNode.label, fontSize: 15, fontFamily: 2, color: color.text },
    } as any);
  }

  // 主轴线
  skeletons.push({
    type: "arrow",
    id: "tl_axis",
    x: startX - 20,
    y: axisY,
    width: endX - startX + 40,
    height: 0,
    strokeColor: tlMain.stroke,
    strokeWidth: 2.5,
    roughness: 0,          // BUG-016 二轮：关手绘抖动，长轴线不再"波浪"，与圆点精确对齐
    endArrowhead: "arrow",
    startArrowhead: null,
  } as any);

  // 主轴节点
  mainNodes.forEach((n, i) => {
    const x = startX + i * TL_H_STEP;
    const isTop = i % 2 === 0;
    const nodeY = isTop ? axisY - TL_STEM_GAP - TL_NODE_H : axisY + TL_STEM_GAP;
    const color = tlMain;

    // 节点框
    skeletons.push({
      type: "rectangle",
      id: `tl_node_${n.id}`,
      x: x - TL_NODE_W / 2,
      y: nodeY,
      width: TL_NODE_W,
      height: TL_NODE_H,
      backgroundColor: color.bg,
      strokeColor: color.stroke,
      strokeWidth: 1.5,
      roundness: { type: 3 },
      label: {
        text: n.time ? `${n.time}\n${n.label}` : n.label,
        fontSize: 13,
        fontFamily: 2,
        color: color.text,
      },
    } as any);

    // 竖线：主节点靠轴的一边 → 主轴（不穿卡片）
    const stemTop = isTop ? nodeY + TL_NODE_H : axisY;
    const stemBot = isTop ? axisY : nodeY;
    skeletons.push({
      type: "line",
      id: `tl_stem_${n.id}`,
      x,
      y: stemTop,
      width: 0,
      height: stemBot - stemTop,
      strokeColor: tlMain.stroke,
      strokeWidth: 1.5,
      roughness: 0,
    } as any);

    // 圆点在主轴上
    skeletons.push({
      type: "ellipse",
      id: `tl_dot_${n.id}`,
      x: x - 6,
      y: axisY - 6,
      width: 12,
      height: 12,
      backgroundColor: tlMain.stroke,
      strokeColor: tlMain.stroke,
      strokeWidth: 1,
      roughness: 0,
      fillStyle: "solid",
    } as any);

    // 子节点：从主节点「远离轴」的一边逐个向外堆叠，箭头链式接力（上一框 → 下一框，不穿卡片）
    const subs = subOf.get(n.id) ?? [];
    let prevEdgeY = isTop ? nodeY : nodeY + TL_NODE_H; // 主节点远轴边
    subs.forEach((sub, si) => {
      const subColor = tlSub;
      const subX = x - TL_SUB_W / 2;
      const subY = isTop
        ? nodeY - (si + 1) * (TL_SUB_H + TL_SUB_GAP)
        : nodeY + TL_NODE_H + si * (TL_SUB_H + TL_SUB_GAP) + TL_SUB_GAP;
      skeletons.push({
        type: "rectangle",
        id: `tl_sub_${sub.id}`,
        x: subX,
        y: subY,
        width: TL_SUB_W,
        height: TL_SUB_H,
        backgroundColor: subColor.bg,
        strokeColor: subColor.stroke,
        strokeWidth: 1,
        roundness: { type: 3 },
        label: { text: sub.label, fontSize: 12, fontFamily: 2, color: subColor.text },
      } as any);
      const curNearY = isTop ? subY + TL_SUB_H : subY;   // 子框靠主节点的一边
      skeletons.push(geoArrow(
        `tl_sub_edge_${sub.id}`,
        x, prevEdgeY,
        x, curNearY,
        { strokeColor: tlMain.stroke, strokeWidth: 1 }
      ));
      prevEdgeY = isTop ? subY : subY + TL_SUB_H;        // 下一段从本子框外沿接力
    });
  });

  wrapInFrame(skeletons, "tl", titleNode?.label ? `AI 时间轴 · ${titleNode.label}` : "AI 时间轴");
  return convertToExcalidrawElements(skeletons) as ExcalidrawElement[];
}

// ────────────────────────────────────────────────────────────────
// 4. 组织架构图（上→下树形，居中）
// ────────────────────────────────────────────────────────────────
const ORG_NODE_W = 150;
const ORG_NODE_H = 50;
const ORG_H_GAP = 30;
const ORG_V_GAP = 60;

function buildOrgchart(nodes: DiagramNode[], ox: number, oy: number): ExcalidrawElement[] {
  const T = getActiveTheme();
  const orgDept = T.branch[2];                  // 部门层
  const orgMember = themeLighten(orgDept, 0.5); // 成员层：部门色提亮
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (!children.has(n.id)) children.set(n.id, []);
    if (n.parent) {
      const arr = children.get(n.parent) ?? [];
      arr.push(n.id);
      children.set(n.parent, arr);
    }
  }
  const root = nodes.find(n => !n.parent);
  if (!root) return [];

  // 计算叶子节点数（用于宽度分配）
  const leafCount = new Map<string, number>();
  function calcLeaves(id: string): number {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) { leafCount.set(id, 1); return 1; }
    const c = kids.reduce((s, k) => s + calcLeaves(k), 0);
    leafCount.set(id, c);
    return c;
  }
  calcLeaves(root.id);

  const coords = new Map<string, { x: number; y: number }>();
  function layout(id: string, depth: number, leftX: number) {
    const w = (leafCount.get(id) ?? 1) * (ORG_NODE_W + ORG_H_GAP);
    const cx = leftX + w / 2 - ORG_NODE_W / 2;
    coords.set(id, { x: ox + cx, y: oy + depth * (ORG_NODE_H + ORG_V_GAP) });
    let cursor = leftX;
    for (const kid of children.get(id) ?? []) {
      const kidW = (leafCount.get(kid) ?? 1) * (ORG_NODE_W + ORG_H_GAP);
      layout(kid, depth + 1, cursor);
      cursor += kidW;
    }
  }
  layout(root.id, 0, 0);

  const skeletons: NonNullable<Parameters<typeof convertToExcalidrawElements>[0]> = [];
  const nodeElemId = (id: string) => `org_node_${id}`;

  for (const n of nodes) {
    const pos = coords.get(n.id);
    if (!pos) continue;
    const role = n.role ?? (n.level === 0 ? "lead" : n.level === 1 ? "dept" : "member");
    const color = role === "lead" ? T.anchor : role === "dept" ? orgDept : orgMember;

    skeletons.push({
      type: "rectangle",
      id: nodeElemId(n.id),
      x: pos.x,
      y: pos.y,
      width: ORG_NODE_W,
      height: ORG_NODE_H,
      backgroundColor: color.bg,
      strokeColor: color.stroke,
      strokeWidth: role === "lead" ? 2 : 1.5,
      roundness: { type: 3 },
      label: { text: n.label, fontSize: role === "lead" ? 15 : 13, fontFamily: 2, color: color.text },
    } as any);

    if (n.parent) {
      const p = coords.get(n.parent);
      if (p) {
        skeletons.push(geoArrow(
          `org_edge_${n.parent}_${n.id}`,
          p.x + ORG_NODE_W / 2, p.y + ORG_NODE_H,
          pos.x + ORG_NODE_W / 2, pos.y,
          { strokeColor: orgDept.stroke, strokeWidth: 1.5 }
        ));
      }
    }
  }

  wrapInFrame(skeletons, "org", root.label ? `AI 组织架构图 · ${root.label}` : "AI 组织架构图");
  return convertToExcalidrawElements(skeletons) as ExcalidrawElement[];
}

// ────────────────────────────────────────────────────────────────
// 5. 鱼骨图（因果图）
// ────────────────────────────────────────────────────────────────
const FB_SPINE_LEN = 600;  // 主脊长度
const FB_BONE_LEN = 160;   // 大骨斜线投影长度
const FB_SUB_LEN = 110;    // 小骨长度
const FB_BONE_ANGLE = 35;  // 大骨角度（度）

function buildFishbone(nodes: DiagramNode[], ox: number, oy: number): ExcalidrawElement[] {
  const T = getActiveTheme();
  const effectNode = nodes.find(n => !n.parent);
  if (!effectNode) return [];

  const causeNodes = nodes.filter(n => n.parent === effectNode.id);

  const subOf = new Map<string, DiagramNode[]>();
  for (const n of nodes) {
    if (n.parent && n.parent !== effectNode.id) {
      const arr = subOf.get(n.parent) ?? [];
      arr.push(n);
      subOf.set(n.parent, arr);
    }
  }

  const skeletons: NonNullable<Parameters<typeof convertToExcalidrawElements>[0]> = [];
  const centerY = oy + 240;
  const spineStartX = ox + 60;
  const ang = (FB_BONE_ANGLE * Math.PI) / 180;

  // BUG-016：先按原因数算主脊长度——保证同侧相邻原因卡片「槽距 ≥ 卡片宽+间距」，
  // 原因多时把主脊拉长，而不是缩小间距把卡片挤成一坨（旧代码 spacing 会 < 卡片宽 → 重叠）。
  const allCauses = causeNodes;
  const topArr = allCauses.filter((_, i) => i % 2 === 0);
  const botArr = allCauses.filter((_, i) => i % 2 !== 0);
  const maxSide = Math.max(topArr.length, botArr.length);
  const causeW = 150;
  const causeH = 48;
  const slot = causeW + 64;          // 同侧相邻大骨的水平槽距（> 卡片宽，杜绝重叠）
  const firstBone = 120;             // 第一根大骨距鱼尾偏移
  const spineLen = Math.max(FB_SPINE_LEN, firstBone + Math.max(0, maxSide - 1) * slot + 180);
  const spineEndX = spineStartX + spineLen;

  // 主脊
  skeletons.push({
    type: "arrow",
    id: "fb_spine",
    x: spineStartX,
    y: centerY,
    width: spineLen,
    height: 0,
    strokeColor: T.fishHead.stroke,
    strokeWidth: 3,
    endArrowhead: "arrow",
    startArrowhead: null,
  } as any);

  // 鱼头（结果节点）
  const effColor = T.fishHead;
  const effectW = 160;
  const effectH = 60;
  skeletons.push({
    type: "rectangle",
    id: `fb_node_${effectNode.id}`,
    x: spineEndX + 10,
    y: centerY - effectH / 2,
    width: effectW,
    height: effectH,
    backgroundColor: effColor.bg,
    strokeColor: effColor.stroke,
    strokeWidth: 2,
    roundness: { type: 3 },
    label: { text: effectNode.label, fontSize: 14, fontFamily: 2, color: effColor.text },
  } as any);

  function drawCause(cause: DiagramNode, boneX: number, isTop: boolean) {
    // REQ-049：各原因分支按其在原因列表中的序号循环取主题分支色（与思维导图同思路）
    const gi = causeNodes.indexOf(cause);
    const causeColor = T.branch[(gi < 0 ? 0 : gi) % T.branch.length];
    const dy = isTop ? -1 : 1;
    const boneEndX = boneX - FB_BONE_LEN * Math.cos(ang);
    const boneEndY = centerY + dy * FB_BONE_LEN * Math.sin(ang);

    // 大骨斜线
    skeletons.push({
      type: "line",
      id: `fb_bone_${cause.id}`,
      x: boneX,
      y: centerY,
      width: boneEndX - boneX,
      height: boneEndY - centerY,
      strokeColor: causeColor.stroke,
      strokeWidth: 2,
    } as any);

    // 大骨标签（causeW/causeH 用外层定义，与主脊长度计算同源）
    skeletons.push({
      type: "rectangle",
      id: `fb_node_${cause.id}`,
      x: boneEndX - causeW / 2,
      y: boneEndY + (isTop ? -causeH - 8 : 8),
      width: causeW,
      height: causeH,
      backgroundColor: causeColor.bg,
      strokeColor: causeColor.stroke,
      strokeWidth: 1.5,
      roundness: { type: 3 },
      label: { text: cause.label, fontSize: 13, fontFamily: 2, color: causeColor.text },
    } as any);

    // 子原因（小鱼刺）：BUG-016 改为在原因卡「外侧」竖直堆叠 + 链式短线连接，
    // 与原因卡同列（宽度更窄），杜绝子刺之间/与邻近原因卡重叠（旧代码沿斜骨摆放会撞）。
    // BUG-016 二轮：子卡片同色紧挨竖排即可表达从属，卡片间的连接线是冗余噪声（"多余线段"）→ 去掉。
    const subs = subOf.get(cause.id) ?? [];
    const subW = 130;
    const subH = 36;
    const subGap = 8;
    const causeBoxTop = boneEndY + (isTop ? -causeH - 8 : 8);
    const causeBoxBot = causeBoxTop + causeH;
    subs.forEach((sub, si) => {
      const subColor = themeLighten(causeColor, 0.5);
      const subY = isTop
        ? causeBoxTop - (si + 1) * (subH + subGap)
        : causeBoxBot + si * (subH + subGap) + subGap;
      const subX = boneEndX - subW / 2;
      skeletons.push({
        type: "rectangle",
        id: `fb_sub_${sub.id}`,
        x: subX,
        y: subY,
        width: subW,
        height: subH,
        backgroundColor: subColor.bg,
        strokeColor: subColor.stroke,
        strokeWidth: 1,
        roundness: { type: 3 },
        label: { text: sub.label, fontSize: 12, fontFamily: 2, color: subColor.text },
      } as any);
    });
  }

  topArr.forEach((cause, i) => {
    const boneX = spineStartX + firstBone + i * slot;
    drawCause(cause, boneX, true);
  });
  botArr.forEach((cause, i) => {
    const boneX = spineStartX + firstBone + i * slot;
    drawCause(cause, boneX, false);
  });

  wrapInFrame(skeletons, "fb", effectNode.label ? `AI 鱼骨图 · ${effectNode.label}` : "AI 鱼骨图");
  return convertToExcalidrawElements(skeletons) as ExcalidrawElement[];
}

// ────────────────────────────────────────────────────────────────
// 6. 讲评要点卡片（REQ-039 第三期 3d：典型错误插入画布）
// 把讲评报告内容块的要点列表转成画布上的一列卡片：
//   顶部标题条 + 逐条要点卡（可选「学生原话」浅色引用卡）
// 纯垂直堆叠、显式坐标、无任何连线 —— 天然不触碰 REQ-027 的
// 「严禁 skeleton 绑定式箭头」铁律（这里根本不产生 arrow 元素）。
// 卡片高度按文字长度估算，避免长句子溢出容器。
// ────────────────────────────────────────────────────────────────
export interface LectureCardsInput {
  title: string;                 // 标题条文字，如「典型问题 · 浮力概念」
  items: string[];               // 要点列表，每条一张卡
  quotes?: string[];             // 可选：学生原话样例，浅色卡追加在后面
}

const LC_W = 340;               // 卡片宽度
const LC_GAP = 14;              // 卡片间距
const LC_FONT = 14;
const LC_CHARS_PER_LINE = 20;   // 中文按 14px 字号在 340px 宽内的保守估计

const LC_COLOR = {
  title: { bg: "#BA7517", stroke: "#8a5511", text: "#ffffff" },
  item:  { bg: "#FBE8C3", stroke: "#BA7517", text: "#5a3a00" },
  quote: { bg: "#F5F5F4", stroke: "#bdbdbd", text: "#555555" },
};

// 按字数估算卡片高度（中文/英文混排取保守值）
function lcHeight(text: string): number {
  const len = [...String(text ?? "")].length;
  const lines = Math.max(1, Math.ceil(len / LC_CHARS_PER_LINE));
  return Math.max(52, lines * 22 + 26);
}

export function buildLectureCards(
  input: LectureCardsInput,
  originX = 0,
  originY = 0
): ExcalidrawElement[] {
  const items = (input.items ?? []).filter(t => String(t ?? "").trim());
  const quotes = (input.quotes ?? []).filter(t => String(t ?? "").trim());
  const skeletons: NonNullable<Parameters<typeof convertToExcalidrawElements>[0]> = [];
  const seq = Date.now().toString(36);
  let y = originY;

  // 标题条
  const titleText = String(input.title ?? "讲评要点").trim() || "讲评要点";
  const titleH = Math.max(48, lcHeight(titleText) - 8);
  skeletons.push({
    type: "rectangle",
    id: `lc_title_${seq}`,
    x: originX,
    y,
    width: LC_W,
    height: titleH,
    backgroundColor: LC_COLOR.title.bg,
    strokeColor: LC_COLOR.title.stroke,
    strokeWidth: 2,
    roundness: { type: 3 },
    label: { text: titleText, fontSize: 16, fontFamily: 2, color: LC_COLOR.title.text },
  } as any);
  y += titleH + LC_GAP;

  // 要点卡（前面加序号，方便课堂上口头指认「第 2 条」）
  items.forEach((text, i) => {
    const label = `${i + 1}. ${String(text).trim()}`;
    const h = lcHeight(label);
    skeletons.push({
      type: "rectangle",
      id: `lc_item_${seq}_${i}`,
      x: originX,
      y,
      width: LC_W,
      height: h,
      backgroundColor: LC_COLOR.item.bg,
      strokeColor: LC_COLOR.item.stroke,
      strokeWidth: 1.5,
      roundness: { type: 3 },
      label: { text: label, fontSize: LC_FONT, fontFamily: 2, color: LC_COLOR.item.text },
    } as any);
    y += h + LC_GAP;
  });

  // 学生原话样例（浅灰卡，与要点区分）
  quotes.forEach((text, i) => {
    const label = `“${String(text).trim()}”`;
    const h = lcHeight(label);
    skeletons.push({
      type: "rectangle",
      id: `lc_quote_${seq}_${i}`,
      x: originX,
      y,
      width: LC_W,
      height: h,
      backgroundColor: LC_COLOR.quote.bg,
      strokeColor: LC_COLOR.quote.stroke,
      strokeWidth: 1,
      roundness: { type: 3 },
      label: { text: label, fontSize: 13, fontFamily: 2, color: LC_COLOR.quote.text },
    } as any);
    y += h + LC_GAP;
  });

  if (skeletons.length === 0) return [];
  wrapInFrame(skeletons, "lc", `讲评 · ${titleText}`);
  return convertToExcalidrawElements(skeletons) as ExcalidrawElement[];
}
