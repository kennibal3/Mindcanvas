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

export interface DiagramData {
  diagram_type: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
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
// 配色方案
// ────────────────────────────────────────────────────────────────
const PALETTE = {
  // mindmap 配色已改为按分支上色（REQ-031），见下方 MM_BRANCH_PALETTE / MM_ROOT_COLOR，
  // 不再使用固定深度调色板。
  flowchart: {
    start:    { bg: "#d5e8d4", stroke: "#82b366", text: "#1a3a1a" },
    end:      { bg: "#f8cecc", stroke: "#b85450", text: "#3a1a1a" },
    process:  { bg: "#dae8fc", stroke: "#6c8ebf", text: "#1a2a3a" },
    decision: { bg: "#fff2cc", stroke: "#d6b656", text: "#3a2a00" },
  },
  timeline: {
    title:  { bg: "#BA7517", stroke: "#8a5511", text: "#ffffff" },
    main:   { bg: "#FBE8C3", stroke: "#BA7517", text: "#5a3a00" },
    sub:    { bg: "#FFF4E0", stroke: "#d4a44c", text: "#5a3a00" },
  },
  orgchart: {
    lead:   { bg: "#BA7517", stroke: "#8a5511", text: "#ffffff" },
    dept:   { bg: "#FBE8C3", stroke: "#BA7517", text: "#5a3a00" },
    member: { bg: "#FFF4E0", stroke: "#d4a44c", text: "#5a3a00" },
  },
  fishbone: {
    effect: { bg: "#f8cecc", stroke: "#b85450", text: "#3a1a1a" },
    cause:  { bg: "#FBE8C3", stroke: "#BA7517", text: "#5a3a00" },
    sub:    { bg: "#FFF4E0", stroke: "#d4a44c", text: "#5a3a00" },
  },
};

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

const MM_BRANCH_PALETTE: { bg: string; stroke: string; text: string }[] = [
  { bg: "#f7ded7", stroke: "#c95138", text: "#6b2213" }, // 橙红
  { bg: "#dfe6e1", stroke: "#536b59", text: "#28362d" }, // 灰绿
  { bg: "#ede2d0", stroke: "#8b6b45", text: "#4a3823" }, // 土黄
  { bg: "#d8e8ec", stroke: "#2d7185", text: "#173c46" }, // 靛蓝
  { bg: "#ece0ea", stroke: "#87637f", text: "#453040" }, // 藕紫
];
const MM_ROOT_COLOR = { bg: "#BA7517", stroke: "#8a5511", text: "#ffffff" };

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
  branchColorOf.set(root.id, MM_ROOT_COLOR);
  const rootChildren = children.get(root.id) ?? [];
  rootChildren.forEach((childId, idx) => {
    const branchColor = MM_BRANCH_PALETTE[idx % MM_BRANCH_PALETTE.length];
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
    const branchColor = branchColorOf.get(n.id) ?? MM_BRANCH_PALETTE[0];
    // 分支节点本身（depth1）用基础色，越往下的子孙节点背景色越浅，色相不变
    const lightenAmt = isRoot ? 0 : Math.min(0.55, Math.max(0, depth - 1) * 0.22);
    const color = isRoot
      ? MM_ROOT_COLOR
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
      const edgeColor = branchColorOf.get(n.id) ?? MM_BRANCH_PALETTE[0];
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
const FC_H_GAP = 60;
const FC_V_GAP = 60;

function buildFlowchart(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  ox: number,
  oy: number
): ExcalidrawElement[] {
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
    const color = PALETTE.flowchart[nt as keyof typeof PALETTE.flowchart] ?? PALETTE.flowchart.process;

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
const TL_OFFSET = 100; // 主轴到节点的垂直偏移

function buildTimeline(nodes: DiagramNode[], ox: number, oy: number): ExcalidrawElement[] {
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
  const axisY = oy + 150; // 主轴 Y 坐标
  const startX = ox + 80;
  const endX = startX + Math.max(1, mainNodes.length - 1) * TL_H_STEP + 80;

  // 主轴线
  skeletons.push({
    type: "arrow",
    id: "tl_axis",
    x: startX - 20,
    y: axisY + TL_NODE_H / 2,
    width: endX - startX + 40,
    height: 0,
    strokeColor: "#BA7517",
    strokeWidth: 2.5,
    endArrowhead: "arrow",
    startArrowhead: null,
  } as any);

  // 标题节点（在主轴左上方）
  if (titleNode) {
    const color = PALETTE.timeline.title;
    skeletons.push({
      type: "rectangle",
      id: `tl_node_${titleNode.id}`,
      x: ox,
      y: oy + 50,
      width: TL_NODE_W + 20,
      height: TL_NODE_H,
      backgroundColor: color.bg,
      strokeColor: color.stroke,
      strokeWidth: 2,
      roundness: { type: 3 },
      label: { text: titleNode.label, fontSize: 15, fontFamily: 2, color: color.text },
    } as any);
  }

  // 主轴节点
  mainNodes.forEach((n, i) => {
    const x = startX + i * TL_H_STEP;
    const isTop = i % 2 === 0;
    const nodeY = isTop ? axisY - TL_OFFSET - TL_NODE_H : axisY + TL_OFFSET;
    const color = PALETTE.timeline.main;

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

    // 竖线连接主轴
    skeletons.push({
      type: "line",
      id: `tl_stem_${n.id}`,
      x,
      y: isTop ? nodeY + TL_NODE_H : axisY + TL_NODE_H / 2,
      width: 0,
      height: isTop ? axisY + TL_NODE_H / 2 - nodeY - TL_NODE_H : nodeY - axisY - TL_NODE_H / 2,
      strokeColor: "#BA7517",
      strokeWidth: 1.5,
    } as any);

    // 圆点在主轴上
    skeletons.push({
      type: "ellipse",
      id: `tl_dot_${n.id}`,
      x: x - 6,
      y: axisY + TL_NODE_H / 2 - 6,
      width: 12,
      height: 12,
      backgroundColor: "#BA7517",
      strokeColor: "#8a5511",
      strokeWidth: 1,
    } as any);

    // 子节点
    (subOf.get(n.id) ?? []).forEach((sub, si) => {
      const subColor = PALETTE.timeline.sub;
      const subX = isTop ? x - TL_SUB_W / 2 : x - TL_SUB_W / 2;
      const subY = isTop
        ? nodeY - (si + 1) * (TL_SUB_H + 10) - 10
        : nodeY + TL_NODE_H + (si + 1) * (TL_SUB_H + 10) - TL_SUB_H;
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
      skeletons.push(geoArrow(
        `tl_sub_edge_${sub.id}`,
        x, isTop ? nodeY : nodeY + TL_NODE_H,
        x, isTop ? subY + TL_SUB_H : subY,
        { strokeColor: "#d4a44c", strokeWidth: 1 }
      ));
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
    const color = PALETTE.orgchart[role as keyof typeof PALETTE.orgchart] ?? PALETTE.orgchart.member;

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
          { strokeColor: "#BA7517", strokeWidth: 1.5 }
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
  const effectNode = nodes.find(n => !n.parent);
  if (!effectNode) return [];

  const causeNodes = nodes.filter(n => n.parent === effectNode.id);
  const topCauses = causeNodes.filter(n => n.side === "top" || causeNodes.indexOf(n) % 2 === 0);
  const botCauses = causeNodes.filter(n => n.side === "bottom" || causeNodes.indexOf(n) % 2 !== 0);

  const subOf = new Map<string, DiagramNode[]>();
  for (const n of nodes) {
    if (n.parent && n.parent !== effectNode.id) {
      const arr = subOf.get(n.parent) ?? [];
      arr.push(n);
      subOf.set(n.parent, arr);
    }
  }

  const skeletons: NonNullable<Parameters<typeof convertToExcalidrawElements>[0]> = [];
  const centerY = oy + 200;
  const spineStartX = ox + 60;
  const spineEndX = spineStartX + FB_SPINE_LEN;
  const ang = (FB_BONE_ANGLE * Math.PI) / 180;

  // 主脊
  skeletons.push({
    type: "arrow",
    id: "fb_spine",
    x: spineStartX,
    y: centerY,
    width: FB_SPINE_LEN,
    height: 0,
    strokeColor: "#BA7517",
    strokeWidth: 3,
    endArrowhead: "arrow",
    startArrowhead: null,
  } as any);

  // 鱼头（结果节点）
  const effColor = PALETTE.fishbone.effect;
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

  const allCauses = causeNodes;
  const topArr = allCauses.filter((_, i) => i % 2 === 0);
  const botArr = allCauses.filter((_, i) => i % 2 !== 0);
  const maxSide = Math.max(topArr.length, botArr.length);
  const spacing = maxSide > 0 ? Math.min(140, (FB_SPINE_LEN - 100) / maxSide) : 140;

  function drawCause(cause: DiagramNode, boneX: number, isTop: boolean) {
    const causeColor = PALETTE.fishbone.cause;
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
      strokeColor: "#BA7517",
      strokeWidth: 2,
    } as any);

    // 大骨标签
    const causeW = 140;
    const causeH = 46;
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

    // 子骨（小鱼刺）
    (subOf.get(cause.id) ?? []).forEach((sub, si) => {
      const subColor = PALETTE.fishbone.sub;
      const t = (si + 1) / ((subOf.get(cause.id)?.length ?? 1) + 1);
      const subAttachX = boneX + t * (boneEndX - boneX);
      const subAttachY = centerY + t * (boneEndY - centerY);
      const subEndX = subAttachX - FB_SUB_LEN * 0.7 * (isTop ? -1 : 1) * Math.sin(ang);
      const subEndY = subAttachY + dy * FB_SUB_LEN * Math.cos(ang) * 0.6;

      skeletons.push({
        type: "line",
        id: `fb_sub_line_${sub.id}`,
        x: subAttachX,
        y: subAttachY,
        width: subEndX - subAttachX,
        height: subEndY - subAttachY,
        strokeColor: "#d4a44c",
        strokeWidth: 1.5,
      } as any);

      skeletons.push({
        type: "rectangle",
        id: `fb_sub_${sub.id}`,
        x: subEndX - 60,
        y: subEndY - 20,
        width: 120,
        height: 38,
        backgroundColor: subColor.bg,
        strokeColor: subColor.stroke,
        strokeWidth: 1,
        roundness: { type: 3 },
        label: { text: sub.label, fontSize: 12, fontFamily: 2, color: subColor.text },
      } as any);
    });
  }

  topArr.forEach((cause, i) => {
    const boneX = spineStartX + 80 + i * spacing;
    drawCause(cause, boneX, true);
  });
  botArr.forEach((cause, i) => {
    const boneX = spineStartX + 80 + i * spacing;
    drawCause(cause, boneX, false);
  });

  wrapInFrame(skeletons, "fb", effectNode.label ? `AI 鱼骨图 · ${effectNode.label}` : "AI 鱼骨图");
  return convertToExcalidrawElements(skeletons) as ExcalidrawElement[];
}
