// =============================================================
// REQ-054 方案 C：后端冒烟（真 Postgres + 真 Redis + 真后端进程 + 两条真 WebSocket）
//
// 走一遍课堂里最核心的一条链路，全部用生产同款接口，不 mock 任何东西：
//   教师登录（cookie）→ 建房间 → 学生凭邀请码入场 → 教师/学生各连一条 WS
//   → 教师建一个「问答」组件 → 学生提交答案 → 教师收到 widget_update
//
// 它补的是现有契约测试补不到的那一层：契约测试用的是「假数据库驱动」，
// 证明的是「代码在假数据下结构对」；这里用真数据库，证明「迁移出来的表结构 + SQL +
// 后端 + WS 在一起真的能跑通」。它不替代真机点击验收（没有浏览器、没有 nginx/HTTPS）。
//
// 依赖：Node >= 22（全局 fetch / WebSocket，且 WebSocket 支持自定义 headers），零 npm 依赖。
// 用法：node scripts/ci/smoke_ws.mjs
// 环境变量（都有默认值）：SMOKE_BASE_URL SMOKE_USER SMOKE_PASS
// =============================================================

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8080';
const WS_BASE = BASE.replace(/^http/, 'ws');
const USER = process.env.SMOKE_USER || 'smoke_teacher';
const PASS = process.env.SMOKE_PASS || 'smoke-pass-123';

const STEP_TIMEOUT_MS = 10_000;
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

function fail(msg) {
  throw new Error(msg);
}
function assert(cond, msg) {
  if (!cond) fail(`断言失败：${msg}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 一条 WebSocket 连接：把收到的所有消息存起来，按条件等待 ----------
class Peer {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.waiters = [];
    this.closed = null;
    this.ws = null;
  }

  open(url, headers) {
    return new Promise((resolve, reject) => {
      const ws = headers ? new WebSocket(url, { headers }) : new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error(`${this.name} WS 连接超时：${url}`)), STEP_TIMEOUT_MS);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`${this.name} WS 连接出错（服务端可能拒绝了握手，比如未登录返回 401）：${url}`));
      };
      ws.onclose = (e) => {
        this.closed = { code: e.code, reason: e.reason };
      };
      ws.onmessage = (e) => {
        const raw = typeof e.data === 'string' ? e.data : null;
        if (raw === null) return; // 后端只发文本帧，遇到二进制帧直接忽略
        let m;
        try {
          m = JSON.parse(raw);
        } catch {
          return;
        }
        this.msgs.push(m);
        this.waiters = this.waiters.filter((w) => {
          if (w.pred(m)) {
            clearTimeout(w.timer);
            w.resolve(m);
            return false;
          }
          return true;
        });
      };
    });
  }

  // 等一条满足条件的消息；已经收到过的也算（避免「消息先到、才开始等」的竞态）
  waitFor(label, pred, ms = STEP_TIMEOUT_MS) {
    const hit = this.msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve, timer: null };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        const seen = this.msgs.map((m) => m.type).join(',') || '（一条都没收到）';
        reject(new Error(`${this.name} 等待「${label}」超时（${ms}ms）。已收到的消息类型：${seen}`));
      }, ms);
      this.waiters.push(w);
    });
  }

  count(pred) {
    return this.msgs.filter(pred).length;
  }

  send(type, payload, roomId, uuid) {
    this.ws.send(
      JSON.stringify({ type, payload, sender_uuid: uuid || '', room_id: roomId, timestamp: Date.now() }),
    );
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

// ---------- HTTP 小工具 ----------
async function http(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应，json 保持 null */
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function main() {
  // 1. 健康检查
  const health = await http('GET', '/health');
  assert(health.status === 200, `/health 应返回 200，实际 ${health.status}：${health.text.slice(0, 200)}`);
  assert(health.json?.status === 'ok', `/health 的 status 应为 ok，实际 ${JSON.stringify(health.json)}`);
  log('✔ /health 200');

  // 2. 教师登录 → 拿 cookie
  const login = await http('POST', '/api/auth/login', { body: { username: USER, password: PASS } });
  assert(login.status === 200, `教师登录应返回 200，实际 ${login.status}：${login.text.slice(0, 300)}`);
  const setCookies = login.headers.getSetCookie ? login.headers.getSetCookie() : [];
  assert(setCookies.length > 0, '登录响应没有 Set-Cookie');
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  log(`✔ 教师登录成功（cookie: ${cookie.split('=')[0]}）`);

  // 3. 建房间
  const title = `CI冒烟房间-${Date.now()}`;
  const roomRes = await http('POST', '/api/rooms', { body: { title }, cookie });
  assert(roomRes.status === 201, `建房间应返回 201，实际 ${roomRes.status}：${roomRes.text.slice(0, 300)}`);
  const room = roomRes.json?.room;
  assert(room?.id && room?.invite_code, `建房间响应缺 id/invite_code：${roomRes.text.slice(0, 300)}`);
  log(`✔ 房间已创建 id=${room.id} 邀请码=${room.invite_code}`);

  // 4. 学生凭邀请码入场
  const join = await http('POST', '/api/guest/join', {
    body: { room_code: room.invite_code, nickname: 'CI学生' },
  });
  assert(join.status === 200, `学生入场应返回 200，实际 ${join.status}：${join.text.slice(0, 300)}`);
  const studentUuid = join.json?.data?.uuid;
  assert(studentUuid, `入场响应缺 data.uuid：${join.text.slice(0, 300)}`);
  log(`✔ 学生入场 uuid=${studentUuid}`);

  // 5. 两条 WebSocket：教师走 Cookie，学生走 ?uuid=
  const teacher = new Peer('教师');
  const student = new Peer('学生');
  try {
    await teacher.open(`${WS_BASE}/ws/room/${room.id}`, { Cookie: cookie });
    await student.open(`${WS_BASE}/ws/room/${room.id}?uuid=${encodeURIComponent(studentUuid)}`);
    // room_sync 在连接后约 0.8 秒发出
    const tSync = await teacher.waitFor('room_sync', (m) => m.type === 'room_sync');
    const sSync = await student.waitFor('room_sync', (m) => m.type === 'room_sync');
    assert(tSync.sender_role === 'teacher', `教师 room_sync.sender_role 应为 teacher，实际 ${tSync.sender_role}`);
    assert(sSync.sender_role === 'student', `学生 room_sync.sender_role 应为 student，实际 ${sSync.sender_role}`);
    // BUG-038 的契约：room 在消息顶层，学生端房间标题依赖它
    assert(sSync.room?.title === title, `学生 room_sync.room.title 应为「${title}」，实际 ${JSON.stringify(sSync.room)}`);
    log('✔ 两端都收到 room_sync（学生端房间标题在顶层 room 里）');

    // 6. 教师建一个已开放的问答组件（结构与前端 WidgetToolbar 的 qa_widget 一致，直接置为 open 省去一步开题）
    const question = '1+1 等于几？';
    teacher.send(
      'element_create',
      {
        type: 'qa_widget',
        x: 100,
        y: 100,
        width: 360,
        height: 400,
        payload: {
          question,
          options: ['1', '2', '3', '4'],
          correctIdx: 1,
          explanation: '',
          status: 'open',
          showResult: false,
          showExplanation: false,
          stats: {},
        },
      },
      room.id,
      tSync.sender_uuid,
    );
    const created = await student.waitFor(
      'element_create（学生端）',
      (m) => m.type === 'element_create' && m.data?.type === 'qa_widget',
    );
    const elementId = created.data.id;
    assert(elementId, `element_create 广播缺 data.id：${JSON.stringify(created).slice(0, 300)}`);
    await teacher.waitFor('element_create（教师端）', (m) => m.type === 'element_create' && m.data?.id === elementId);
    log(`✔ 问答组件已创建并广播给两端 element=${elementId}`);

    // 7. 学生提交答案（选第 2 项，即 choice_idx=1，正确）
    student.send('widget_submit', { action_type: 'answer', element_id: elementId, data: { choice_idx: 1 } }, room.id, studentUuid);
    const update = await teacher.waitFor(
      'widget_update（教师端）',
      (m) => m.type === 'widget_update' && m.element_id === elementId,
    );
    // BUG-006 / BUG-047 的契约：payload 必须是完整两层结构，教师端「N 人已答题」读 payload.payload.stats
    assert(update.from === studentUuid, `widget_update.from 应为学生 uuid，实际 ${update.from}`);
    assert(typeof update.payload?.x === 'number', `widget_update.payload 应带外层几何字段 x，实际 ${JSON.stringify(update.payload).slice(0, 300)}`);
    assert(update.payload?.payload?.question === question, `widget_update.payload.payload.question 应保持原题，实际 ${JSON.stringify(update.payload).slice(0, 300)}`);
    assert(
      update.payload?.payload?.stats?.['1'] === 1,
      `widget_update.payload.payload.stats["1"] 应为 1，实际 ${JSON.stringify(update.payload?.payload?.stats)}`,
    );
    log('✔ 教师收到 widget_update，两层结构完整，统计 stats["1"]=1');

    // 8. 重复提交应被拒绝：学生收到 widget_error，教师不会再收到第二条 widget_update
    student.send('widget_submit', { action_type: 'answer', element_id: elementId, data: { choice_idx: 0 } }, room.id, studentUuid);
    await student.waitFor('widget_error（重复提交）', (m) => m.type === 'widget_error');
    await sleep(1000);
    const updates = teacher.count((m) => m.type === 'widget_update' && m.element_id === elementId);
    assert(updates === 1, `重复提交后教师收到的 widget_update 应仍为 1 条，实际 ${updates} 条`);
    log('✔ 重复提交被拒绝（学生收到 widget_error，教师未收到多余广播）');

    // 9. 没有连接被服务端意外关闭
    assert(!teacher.closed, `教师连接被意外关闭：${JSON.stringify(teacher.closed)}`);
    assert(!student.closed, `学生连接被意外关闭：${JSON.stringify(student.closed)}`);
  } finally {
    teacher.close();
    student.close();
  }
}

const guard = setTimeout(() => {
  console.error('❌ 冒烟整体超过 60 秒仍未完成，强制结束');
  process.exit(1);
}, 60_000);

main()
  .then(() => {
    clearTimeout(guard);
    log('✅ 冒烟全部通过');
    process.exit(0);
  })
  .catch((e) => {
    clearTimeout(guard);
    console.error(`❌ 冒烟失败：${e.message}`);
    process.exit(1);
  });
