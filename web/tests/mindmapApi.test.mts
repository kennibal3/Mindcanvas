// REQ-068 第二步：SSE 帧解析（纯函数）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSseFrames } from '../src/utils/mindmapApi.ts';

test('完整帧被切出，未完成的尾巴留在缓冲里', () => {
  const buf = 'event: progress\ndata: {"stage":"skeleton","message":"a"}\n\nevent: result\ndata: {"outline":"# x';
  const [frames, rest] = parseSseFrames(buf);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, 'progress');
  assert.deepEqual(frames[0].data, { stage: 'skeleton', message: 'a' });
  assert.ok(rest.startsWith('event: result'));
});

test('分两批到达也能拼回完整帧', () => {
  const [f1, r1] = parseSseFrames('event: result\ndata: {"outline":"# 标');
  assert.equal(f1.length, 0);
  const [f2, r2] = parseSseFrames(r1 + '题"}\n\n');
  assert.equal(f2.length, 1);
  assert.equal(r2, '');
  assert.deepEqual(f2[0].data, { outline: '# 标题' });
});

test('畸形 JSON 帧与空数据帧被跳过，后续帧不受影响', () => {
  const [frames] = parseSseFrames('event: progress\ndata: {oops\n\n: keepalive\n\nevent: error\ndata: {"error":"x"}\n\n');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, 'error');
});
