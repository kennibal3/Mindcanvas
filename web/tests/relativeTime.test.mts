// REQ-065 房间列表「最近修改」相对时间显示。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeTime } from '../src/utils/relativeTime.ts';

const now = Date.parse('2026-10-14T12:00:00+08:00');
const ago = (ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

test('分档', () => {
  assert.equal(formatRelativeTime(ago(10_000), now), '刚刚');
  assert.equal(formatRelativeTime(ago(5 * MIN), now), '5 分钟前');
  assert.equal(formatRelativeTime(ago(3 * HOUR), now), '3 小时前');
  assert.equal(formatRelativeTime(ago(3 * DAY), now), '3 天前');
  assert.equal(formatRelativeTime(ago(29 * DAY), now), '29 天前');
});

test('超过 30 天显示日期', () => {
  assert.match(formatRelativeTime(ago(40 * DAY), now), /^\d{4}-\d{2}-\d{2}$/);
});

test('未来时间（设备时钟偏快）按刚刚', () => {
  assert.equal(formatRelativeTime(new Date(now + 5 * MIN).toISOString(), now), '刚刚');
});

test('无效输入返回空串', () => {
  assert.equal(formatRelativeTime(undefined, now), '');
  assert.equal(formatRelativeTime('not-a-date', now), '');
});
