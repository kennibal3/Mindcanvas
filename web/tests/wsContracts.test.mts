// 前端侧 WebSocket 契约测试（REQ-054 的一小片）。运行：node --test web/tests/
// 用 Node 内置测试运行器，零依赖、不需要 npm ci。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractSyncedRoom } from '../src/utils/wsContracts.ts';

// 与服务端共享的 room_sync 样例（服务端 ws_contract_test.go 保证真实消息与它一致）
const fixture = JSON.parse(
  readFileSync(new URL('../../contracts/room_sync.json', import.meta.url), 'utf8'),
);

test('样例本身：room 在消息顶层，且没有 payload 层', () => {
  assert.equal(typeof fixture.room, 'object');
  assert.equal(fixture.payload, undefined);
});

test('BUG-038：能从服务端 room_sync 顶层读出房间标题', () => {
  const room = extractSyncedRoom(fixture);
  assert.ok(room, '读不到 room：学生端标题会恒为「课堂」');
  assert.equal(room.title, fixture.room.title);
  assert.equal(room.collab_mode, fixture.room.collab_mode);
});

test('兼容旧位置 payload.room', () => {
  const room = extractSyncedRoom({ type: 'room_sync', payload: { room: { title: '旧位置' } } });
  assert.equal(room.title, '旧位置');
});

test('顶层 room 优先于 payload.room', () => {
  const room = extractSyncedRoom({
    type: 'room_sync',
    room: { title: '顶层' },
    payload: { room: { title: '旧位置' } },
  });
  assert.equal(room.title, '顶层');
});

test('非 room_sync 消息、空消息、没有 room 的 room_sync 都返回 undefined', () => {
  assert.equal(extractSyncedRoom({ type: 'member_join', room: { title: 'x' } }), undefined);
  assert.equal(extractSyncedRoom(null), undefined);
  assert.equal(extractSyncedRoom({ type: 'room_sync' }), undefined);
});
