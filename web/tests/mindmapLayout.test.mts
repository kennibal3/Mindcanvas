// REQ-068 一期：思维导图布局 + 大纲标记解析的自动化测试。运行：node --test web/tests/
// 核心不变量：任意两个节点（含各自挂的说明文字）占位矩形不重叠。
// REQ-058 栽过一次「容器被撑高压到兄弟节点」，这里用大量随机树批量守住它。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutMindmap, shouldBalance, charWidth,
  BALANCE_MIN_BRANCHES, BALANCE_MIN_NODES,
} from '../src/utils/mindmapLayout.ts';
import { extractOutline, markdownToDiagram, parseItemText } from '../src/utils/markdownToDiagram.ts';
import type { DiagramNode } from '../src/utils/diagramBuilder.ts';

// 写死而不从被测模块导入：否则有人把间距常量改成 0，测试会跟着一起变成 0 而漏报
const EXPECT_GAP = 22;

// ── 可复现的伪随机 ──
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const CJK = '光合作用叶绿体能量转化浮力密度压强探究实验方法评价总结导入练习目标重点难点';
const EMOJI = ['🔬', '📌', '💡', '🌱', '✅', '⚠️', '👩‍🏫'];
function randLabel(r: () => number): string {
  const len = 2 + Math.floor(r() * (r() < 0.15 ? 45 : 14));
  let t = '';
  for (let i = 0; i < len; i++) t += CJK[Math.floor(r() * CJK.length)];
  if (r() < 0.3) t = EMOJI[Math.floor(r() * EMOJI.length)] + ' ' + t;
  return t;
}
function randTree(seed: number, size: number, maxKids = 6): DiagramNode[] {
  const r = rng(seed);
  const nodes: DiagramNode[] = [{ id: 'root', label: randLabel(r), parent: '' }];
  const depth = new Map([['root', 0]]);
  while (nodes.length < size) {
    const parent = nodes[Math.floor(r() * nodes.length)];
    const kids = nodes.filter(n => n.parent === parent.id).length;
    if (kids >= maxKids || (depth.get(parent.id) ?? 0) >= 4) continue;
    const id = `n${nodes.length}`;
    const node: DiagramNode = { id, label: randLabel(r), parent: parent.id };
    if (r() < 0.4) node.note = '例：' + randLabel(r) + randLabel(r);
    if (r() < 0.1) node.emphasis = true;
    nodes.push(node);
    depth.set(id, (depth.get(parent.id) ?? 0) + 1);
  }
  return nodes;
}

function assertNoOverlap(layout: NonNullable<ReturnType<typeof layoutMindmap>>, ctx: string) {
  const list = Array.from(layout.boxes.entries());
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [ida, a] = list[i];
      const [idb, b] = list[j];
      const ax2 = a.x + a.w, bx2 = b.x + b.w;
      const ay2 = a.y + a.h + a.noteBlockH, by2 = b.y + b.h + b.noteBlockH;
      const overlap = a.x < bx2 && b.x < ax2 && a.y < by2 && b.y < ay2;
      assert.ok(!overlap, `${ctx}: ${ida} 与 ${idb} 重叠`);
    }
  }
}

test('随机树 × 三种模式：任意两节点（含说明）占位不重叠', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const size = 3 + (seed * 7) % 58;
    const nodes = randTree(seed, size);
    for (const mode of ['tree', 'balanced', 'auto'] as const) {
      const layout = layoutMindmap(nodes, 100, 200, mode);
      assert.ok(layout, `seed=${seed} 应有布局`);
      assert.equal(layout!.boxes.size, nodes.length, `seed=${seed} ${mode}：节点数应全部落位`);
      assertNoOverlap(layout!, `seed=${seed} size=${size} mode=${mode}`);
    }
  }
});

test('平移：包围盒左上角恰好落在 (ox, oy)', () => {
  for (const mode of ['tree', 'balanced'] as const) {
    const layout = layoutMindmap(randTree(7, 30), 321, 654, mode)!;
    const xs = Array.from(layout.boxes.values()).map(b => b.x);
    const ys = Array.from(layout.boxes.values()).map(b => b.y);
    assert.equal(Math.min(...xs), 321);
    assert.equal(Math.min(...ys), 654);
  }
});

test('树模式：所有节点在根右侧，根 side=0', () => {
  const layout = layoutMindmap(randTree(3, 25), 0, 0, 'tree')!;
  assert.equal(layout.balanced, false);
  const root = layout.boxes.get('root')!;
  assert.equal(root.side, 0);
  layout.boxes.forEach((b, id) => {
    if (id !== 'root') {
      assert.equal(b.side, 1);
      assert.ok(b.x >= root.x + root.w, `${id} 应在根右侧`);
    }
  });
});

test('平衡模式：两侧都有节点，子孙与所属一级分支同侧，且分居根的两边', () => {
  const nodes = randTree(11, 40);
  const layout = layoutMindmap(nodes, 0, 0, 'balanced')!;
  assert.equal(layout.balanced, true);
  const root = layout.boxes.get('root')!;
  const sideOf = (id: string): number => {
    const n = nodes.find(x => x.id === id)!;
    return n.parent === 'root' ? layout.boxes.get(id)!.side : sideOf(n.parent);
  };
  let left = 0, right = 0;
  layout.boxes.forEach((b, id) => {
    if (id === 'root') return;
    assert.equal(b.side, sideOf(id), `${id} 应与其一级分支同侧`);
    if (b.side === -1) { left++; assert.ok(b.x + b.w <= root.x, `${id} 应在根左侧`); }
    else { right++; assert.ok(b.x >= root.x + root.w, `${id} 应在根右侧`); }
  });
  assert.ok(left > 0 && right > 0, '两侧都应有节点');
});

test('平衡模式：等高的 6 个分支恰好 3/3 分摊', () => {
  const nodes: DiagramNode[] = [{ id: 'root', label: '主题', parent: '' }];
  for (let i = 0; i < 6; i++) nodes.push({ id: `b${i}`, label: `分支${i}`, parent: 'root' });
  const layout = layoutMindmap(nodes, 0, 0, 'auto')!;
  assert.equal(layout.balanced, true);
  const sides = nodes.slice(1).map(n => layout.boxes.get(n.id)!.side);
  assert.equal(sides.filter(s => s === 1).length, 3);
  assert.equal(sides.filter(s => s === -1).length, 3);
});

test('平衡模式：根在垂直方向居中于两侧', () => {
  const nodes: DiagramNode[] = [{ id: 'root', label: '主题', parent: '' }];
  for (let i = 0; i < 6; i++) nodes.push({ id: `b${i}`, label: `分支${i}`, parent: 'root' });
  const layout = layoutMindmap(nodes, 0, 0, 'auto')!;
  const root = layout.boxes.get('root')!;
  const tops = Array.from(layout.boxes.values()).map(b => b.y);
  const bottoms = Array.from(layout.boxes.values()).map(b => b.y + b.h + b.noteBlockH);
  const mid = (Math.min(...tops) + Math.max(...bottoms)) / 2;
  assert.ok(Math.abs(root.y + root.h / 2 - mid) < 1, '根应在整体垂直中线上');
});

test('自动选择阈值', () => {
  assert.equal(shouldBalance(1, 50), false, '单分支无从平衡');
  assert.equal(shouldBalance(BALANCE_MIN_BRANCHES - 1, BALANCE_MIN_NODES - 1), false);
  assert.equal(shouldBalance(BALANCE_MIN_BRANCHES, 6), true, '分支多');
  assert.equal(shouldBalance(3, BALANCE_MIN_NODES), true, '节点多');
});

test('说明文字：占位计入布局，说明行宽不超过节点盒', () => {
  const nodes: DiagramNode[] = [
    { id: 'root', label: '主题', parent: '' },
    { id: 'a', label: '要点甲', parent: 'root', note: '例：' + '很长的补充说明'.repeat(8) },
    { id: 'b', label: '要点乙', parent: 'root' },
  ];
  const layout = layoutMindmap(nodes, 0, 0, 'tree')!;
  const a = layout.boxes.get('a')!;
  const b = layout.boxes.get('b')!;
  assert.ok(a.noteLines.length > 1, '长说明应折成多行');
  assert.ok(a.noteBlockH > 0);
  assert.equal(b.noteBlockH, 0);
  assertNoOverlap(layout, '说明');
});

test('emoji 按宽字符计，且变体选择符/连接符不占宽', () => {
  assert.ok(charWidth('🔬', 14) >= 14 * 1.25, 'emoji 应比汉字（1.12）更宽');
  assert.equal(charWidth('️', 14), 0);
  assert.equal(charWidth('‍', 14), 0);
});

test('没有根节点时返回 null；游离节点不落位', () => {
  assert.equal(layoutMindmap([], 0, 0), null);
  const layout = layoutMindmap([
    { id: 'root', label: 'r', parent: '' },
    { id: 'orphan', label: 'o', parent: 'ghost' },
  ], 0, 0)!;
  assert.ok(layout.boxes.has('root'));
  assert.ok(!layout.boxes.has('orphan'));
});

// ── 大纲标记解析 ─────────────────────────────────────────────

test('parseItemText：说明、重点、两者同时', () => {
  assert.deepEqual(parseItemText('探究浮力 :: 例：改变液体密度'), { text: '探究浮力', note: '例：改变液体密度' });
  assert.deepEqual(parseItemText('★ 核心概念'), { text: '核心概念', emphasis: true });
  assert.deepEqual(parseItemText('核心概念 ★'), { text: '核心概念', emphasis: true });
  assert.deepEqual(
    parseItemText('★ 🔬 探究 :: 例：称重法'),
    { text: '🔬 探究', note: '例：称重法', emphasis: true },
  );
});

test('parseItemText：无标记时与原行为一致（emoji 留在标题里；:: 两侧无空白不拆；⭐ 不算重点）', () => {
  assert.deepEqual(parseItemText('📌 要点'), { text: '📌 要点' });
  assert.deepEqual(parseItemText('std::vector 的用法'), { text: 'std::vector 的用法' });
  assert.deepEqual(parseItemText('⭐ 星标图标'), { text: '⭐ 星标图标' });
  assert.deepEqual(parseItemText('**加粗**标题'), { text: '加粗标题' });
});

test('markdownToDiagram：带标记的大纲 → 节点带 note/emphasis，数量与要点数一致', () => {
  const md = [
    '# 光合作用',
    '## 🌱 概念 :: 植物把光能转成化学能',
    '- ★ 场所：叶绿体 :: 类囊体与基质',
    '- 条件：光、叶绿素',
    '## 💡 应用',
    '- 大棚补光',
  ].join('\n');
  const r = markdownToDiagram(md, 'mindmap')!;
  assert.ok(r);
  assert.equal(r.data.nodes.length, 6);
  assert.equal(r.sourceItemCount, 6);
  const place = r.data.nodes.find(n => n.label.startsWith('场所'))!;
  assert.equal(place.emphasis, true);
  assert.equal(place.note, '类囊体与基质');
  const concept = r.data.nodes.find(n => n.label.includes('概念'))!;
  assert.equal(concept.note, '植物把光能转成化学能');
  assert.equal(concept.label, '🌱 概念');
});

test('markdownToDiagram：不带标记的输入，节点上不出现 note/emphasis 字段（回归）', () => {
  const md = '# 主题\n## 甲\n- 一\n- 二\n## 乙\n- 三';
  const r = markdownToDiagram(md, 'mindmap')!;
  for (const n of r.data.nodes) {
    assert.ok(!('note' in n) && !('emphasis' in n), `${n.id} 不应带多余字段`);
  }
  assert.equal(extractOutline(md).length, 6);
});

test('端到端：直转结果 → 布局，不重叠', () => {
  const lines = ['# 课程总览'];
  for (let i = 1; i <= 7; i++) {
    lines.push(`## 🔬 单元${i} :: 本单元的核心任务与产出`);
    for (let j = 1; j <= 3; j++) lines.push(`- 课时${j}：探究活动 :: 例：分组实验并记录数据`);
  }
  const r = markdownToDiagram(lines.join('\n'), 'mindmap')!;
  const layout = layoutMindmap(r.data.nodes, 0, 0)!;
  assert.equal(layout.balanced, true);
  assertNoOverlap(layout, '端到端');
});

test('同一父节点的相邻兄弟：占位之间至少隔 MM_V_GAP', () => {
  for (const mode of ['tree', 'balanced'] as const) {
    for (let seed = 1; seed <= 20; seed++) {
      const nodes = randTree(seed, 30);
      const layout = layoutMindmap(nodes, 0, 0, mode)!;
      // 平衡模式下根的子节点分在左右两侧，是并排而非上下叠放，所以按「父节点 + 所在侧」分组
      const byParent = new Map<string, string[]>();
      for (const n of nodes) {
        if (!n.parent) continue;
        const key = `${n.parent}|${layout.boxes.get(n.id)!.side}`;
        byParent.set(key, [...(byParent.get(key) ?? []), n.id]);
      }
      byParent.forEach(kids => {
        const rects = kids.map(id => layout.boxes.get(id)!).sort((a, b) => a.y - b.y);
        for (let i = 1; i < rects.length; i++) {
          const gap = rects[i].y - (rects[i - 1].y + rects[i - 1].h + rects[i - 1].noteBlockH);
          assert.ok(gap >= EXPECT_GAP - 0.001, `seed=${seed} ${mode}：兄弟间距 ${gap} < ${EXPECT_GAP}`);
        }
      });
    }
  }
});

test('平衡模式按顺时针阅读：右侧自上而下是原顺序，左侧自上而下是倒序', () => {
  const nodes: DiagramNode[] = [{ id: 'root', label: '主题', parent: '' }];
  for (let i = 0; i < 6; i++) nodes.push({ id: `b${i}`, label: `分支${i}`, parent: 'root' });
  const layout = layoutMindmap(nodes, 0, 0, 'balanced')!;
  const kids = nodes.slice(1).map(n => ({ id: n.id, ...layout.boxes.get(n.id)! }));
  const right = kids.filter(k => k.side === 1).sort((a, b) => a.y - b.y).map(k => k.id);
  const left = kids.filter(k => k.side === -1).sort((a, b) => a.y - b.y).map(k => k.id);
  assert.deepEqual(right, ['b0', 'b1', 'b2']);
  assert.deepEqual(left, ['b5', 'b4', 'b3']);
});
