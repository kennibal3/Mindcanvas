// 前端侧 widget_update / widget_error 契约测试（REQ-054 第三片）。运行：node --test "web/tests/*.test.mts"
// 与服务端共享样例 contracts/widget_update.json（服务端 ws_contract_widget_fixture_test.go 保证真实广播与它字段一致）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { interpretWidgetUpdate, buildWidgetErrorDetail } from '../src/utils/wsContracts.ts';

const fixture = JSON.parse(
  readFileSync(new URL('../../contracts/widget_update.json', import.meta.url), 'utf8'),
);

test('样例本身：payload 是两层结构（外层几何 + 内层业务），业务字段不在外层', () => {
  for (const k of ['x', 'y', 'width', 'height']) {
    assert.equal(typeof fixture.payload[k], 'number', `外层缺少几何字段 ${k}`);
  }
  assert.equal(typeof fixture.payload.payload, 'object');
  for (const flat of ['status', 'options', 'stats', 'correctIdx', 'question']) {
    assert.equal(fixture.payload[flat], undefined, `业务字段 ${flat} 不应摊平在外层`);
  }
});

test('BUG-004/047：payload 原样交给 store（同一个对象，不再包一层）', () => {
  const fx = interpretWidgetUpdate(fixture, 'someone-else');
  assert.equal(fx.applyToStore, true);
  assert.equal(fx.elementId, fixture.element_id);
  assert.strictEqual(fx.payload, fixture.payload, '被包了一层或被改写，会变成三层嵌套导致业务字段丢失');
});

test('只有 from 等于本人才确认提交（一人投票不能让全房间被标记已提交）', () => {
  assert.equal(interpretWidgetUpdate(fixture, fixture.from).confirmToSubmitter, true);
  assert.equal(interpretWidgetUpdate(fixture, 'guest-another-student').confirmToSubmitter, false);
});

test('没有 from、或本人 uuid 未知时一律不确认', () => {
  const { from: _drop, ...noFrom } = fixture;
  assert.equal(interpretWidgetUpdate(noFrom, fixture.from).confirmToSubmitter, false);
  assert.equal(interpretWidgetUpdate(fixture, undefined).confirmToSubmitter, false);
  assert.equal(interpretWidgetUpdate(fixture, '').confirmToSubmitter, false);
});

test('兼容：from 缺失时读 sender_uuid；element_id 缺失时读 payload.element_id', () => {
  const { from: _drop, ...noFrom } = fixture;
  const viaSender = interpretWidgetUpdate({ ...noFrom, sender_uuid: 'me' }, 'me');
  assert.equal(viaSender.confirmToSubmitter, true);

  const { element_id: _e, ...noElem } = fixture;
  const viaPayload = interpretWidgetUpdate(
    { ...noElem, payload: { ...fixture.payload, element_id: 'el-inner' } },
    fixture.from,
  );
  assert.equal(viaPayload.elementId, 'el-inner');
});

test('没有 element_id 或没有 payload 时不更新 store', () => {
  assert.equal(interpretWidgetUpdate({ type: 'widget_update', payload: fixture.payload }, 'x').applyToStore, false);
  assert.equal(interpretWidgetUpdate({ type: 'widget_update', element_id: 'el-1' }, 'x').applyToStore, false);
  assert.equal(interpretWidgetUpdate(null, 'x').applyToStore, false);
});

test('widget_error：confirmed 为 false 且带错误文案，缺省文案为「提交失败」', () => {
  assert.deepEqual(buildWidgetErrorDetail({ type: 'widget_error', element_id: 'el-1', error: '已提交过' }), {
    element_id: 'el-1',
    confirmed: false,
    error: '已提交过',
  });
  const dflt = buildWidgetErrorDetail({ type: 'widget_error' });
  assert.equal(dflt.error, '提交失败');
  assert.equal(dflt.confirmed, false);
  assert.equal(dflt.element_id, '');
});
