// REQ-064 进房定位的纯函数测试。运行：node --experimental-strip-types --test "web/tests/*.test.mts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMostRecentElement, centerViewportOn, loadEnterViewMode, ENTER_VIEW_ZOOM } from '../src/utils/enterView.ts';

const el = (id: string, updated: number | undefined, extra: Record<string, unknown> = {}) =>
  ({ id, x: 0, y: 0, width: 10, height: 10, updated, ...extra });

test('取 updated 最大的元素', () => {
  const r = findMostRecentElement([el('a', 100), el('b', 300), el('c', 200)]);
  assert.equal(r?.id, 'b');
});

test('已删除元素不参与（看不见的东西不能当定位点）', () => {
  const r = findMostRecentElement([el('a', 100), el('b', 999, { isDeleted: true })]);
  assert.equal(r?.id, 'a');
});

test('时间相同取靠后的（图层更靠上）', () => {
  assert.equal(findMostRecentElement([el('a', 5), el('b', 5)])?.id, 'b');
});

test('缺 updated 的元素仍可兜底被选中', () => {
  assert.equal(findMostRecentElement([el('a', undefined)])?.id, 'a');
});

test('空数组 / 全删除返回 null', () => {
  assert.equal(findMostRecentElement([]), null);
  assert.equal(findMostRecentElement([el('a', 1, { isDeleted: true })]), null);
});

test('坐标非法的元素跳过', () => {
  assert.equal(findMostRecentElement([el('a', 1), el('b', 9, { x: NaN })])?.id, 'a');
});

test('居中换算：屏幕中心对应元素中心（scene = 屏幕/zoom - scroll）', () => {
  const target = { x: 1000, y: 2000, width: 200, height: 100 };
  const W = 1200, H = 800, z = ENTER_VIEW_ZOOM;
  const { scrollX, scrollY } = centerViewportOn(target, W, H, z);
  assert.equal(W / 2 / z - scrollX, 1100);
  assert.equal(H / 2 / z - scrollY, 2050);
});

test('缩放比例按用户拍板为 50%', () => {
  assert.equal(ENTER_VIEW_ZOOM, 0.5);
});

test('没有 localStorage 时默认「最近修改」', () => {
  assert.equal(loadEnterViewMode(), 'recent');
});
