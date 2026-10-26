// REQ-068 第二步：Go 流水线产出的大纲 ↔ 前端 markdownToDiagram 的共享样例契约。
// 服务端 TestOutlineContract 保证流水线真实输出 === 样例；这里保证前端能原样吃下样例。
// 任何一端改了大纲语法（::、★、层级），另一端的测试就红。运行：node --test tests/*.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { markdownToDiagram } from '../src/utils/markdownToDiagram.ts';

const fx = JSON.parse(
  readFileSync(new URL('../../contracts/mindmap_outline.json', import.meta.url), 'utf8'),
) as {
  outline: string;
  expect: { nodes: number; emphasis: string[]; notes: Record<string, string> };
};

test('REQ-068：流水线大纲能被 markdownToDiagram 无损直转', () => {
  const r = markdownToDiagram(fx.outline, 'mindmap');
  assert.ok(r, '样例大纲应可直转');
  assert.equal(r.data.nodes.length, fx.expect.nodes);
  assert.equal(r.syntheticRoot, false, '样例以 # 开头，不应合成根');

  const byLabel = new Map(r.data.nodes.map((n) => [n.label, n]));
  for (const [label, note] of Object.entries(fx.expect.notes)) {
    assert.equal(byLabel.get(label)?.note, note, `「${label}」的说明`);
  }
  const emph = r.data.nodes.filter((n) => n.emphasis).map((n) => n.label).sort();
  assert.deepEqual(emph, [...fx.expect.emphasis].sort());
  // 标签里不应残留标记符
  for (const n of r.data.nodes) {
    assert.ok(!n.label.includes('::') && !n.label.includes('★'), `标签残留标记: ${n.label}`);
  }
});
