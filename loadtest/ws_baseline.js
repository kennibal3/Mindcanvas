// =============================================================
// MindCanvas WebSocket 压测脚本 - 第一轮：并发基线测试
// 目标：测试50/100/200个WebSocket同时建连，测量内存和延迟
// 场景：学生身份连接 test 房间（场景小，10KB）
// =============================================================
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

// 自定义指标
const wsConnectTime = new Trend('ws_connect_time_ms', true);   // 连接建立时间
const wsFirstMsgTime = new Trend('ws_first_msg_time_ms', true); // 收到第一条消息时间
const wsErrors = new Counter('ws_errors');                       // 错误数
const wsSuccessRate = new Rate('ws_success_rate');               // 成功率
const pingPongTime = new Trend('ping_pong_time_ms', true);      // Ping-Pong往返延迟

// 压测配置：分三个阶段逐步加压
export const options = {
  scenarios: {
    // 阶段1：50并发，持续30秒
    ramp_50: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30s',
      startTime: '0s',
      tags: { stage: '50_vus' },
    },
    // 阶段2：100并发，持续30秒
    ramp_100: {
      executor: 'constant-vus',
      vus: 100,
      duration: '30s',
      startTime: '35s',  // 等待阶段1结束+5秒缓冲
      tags: { stage: '100_vus' },
    },
    // 阶段3：200并发，持续30秒
    ramp_200: {
      executor: 'constant-vus',
      vus: 200,
      duration: '30s',
      startTime: '70s',  // 等待阶段2结束+5秒缓冲
      tags: { stage: '200_vus' },
    },
  },
  thresholds: {
    // 成功率必须高于95%
    'ws_success_rate': ['rate>0.95'],
    // 连接建立时间P95 < 2000ms
    'ws_connect_time_ms': ['p(95)<2000'],
    // Ping-Pong P95 < 500ms
    'ping_pong_time_ms': ['p(95)<500'],
  },
};

// 目标房间（test房间，场景小）
const ROOM_ID = '598175d3-1d5a-4d24-a6f0-d989faa2aa62';
const WS_URL = `ws://localhost:8080/ws/room/${ROOM_ID}`;

export default function () {
  // 每个VU生成唯一的guest UUID
  const vuId = __VU;
  const iterNum = __ITER;
  // 生成标准36位UUID格式（使用VU编号和迭代号构造）
  const paddedVu = String(vuId).padStart(4, '0');
  const paddedIter = String(iterNum % 9999).padStart(4, '0');
  const guestUUID = `10000000-0000-0000-${paddedVu}-${paddedIter}000001`;

  const url = `${WS_URL}?uuid=${guestUUID}`;

  const connectStart = Date.now();
  let firstMsgReceived = false;
  let firstMsgTime = 0;
  let pingStartTime = 0;
  let connected = false;

  const res = ws.connect(url, {
    headers: {
      'Origin': 'http://localhost:3000',
    },
  }, function (socket) {
    connected = true;
    const connectTime = Date.now() - connectStart;
    wsConnectTime.add(connectTime);

    socket.on('open', function () {
      // 连接建立成功
    });

    socket.on('message', function (data) {
      try {
        const msg = JSON.parse(data);

        // 记录收到第一条消息的时间（room_sync）
        if (!firstMsgReceived && msg.type === 'room_sync') {
          firstMsgReceived = true;
          firstMsgTime = Date.now() - connectStart;
          wsFirstMsgTime.add(firstMsgTime);
        }

        // 处理 Pong 响应
        if (msg.type === 'pong' && pingStartTime > 0) {
          const rtt = Date.now() - pingStartTime;
          pingPongTime.add(rtt);
          pingStartTime = 0;
        }
      } catch (e) {
        // 忽略解析错误
      }
    });

    socket.on('error', function (e) {
      wsErrors.add(1);
    });

    // 等待room_sync，然后每5秒发一次Ping
    socket.setTimeout(function () {
      // 发送Ping测量往返延迟
      pingStartTime = Date.now();
      socket.send(JSON.stringify({ type: 'ping' }));
    }, 2000);

    socket.setTimeout(function () {
      pingStartTime = Date.now();
      socket.send(JSON.stringify({ type: 'ping' }));
    }, 7000);

    socket.setTimeout(function () {
      pingStartTime = Date.now();
      socket.send(JSON.stringify({ type: 'ping' }));
    }, 12000);

    // 保持连接20秒后断开
    socket.setTimeout(function () {
      socket.close();
    }, 20000);

    socket.on('close', function () {
      // 连接关闭
    });
  });

  // 检查连接是否成功
  const success = check(res, {
    'WebSocket连接成功(101)': (r) => r && r.status === 101,
    '收到room_sync': () => firstMsgReceived,
  });

  wsSuccessRate.add(success);

  // 每个VU迭代之间随机等待，避免同时重连造成突刺
  sleep(Math.random() * 2 + 1);
}
