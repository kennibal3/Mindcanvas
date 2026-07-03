// =============================================================
// MindCanvas WebSocket 压测脚本 - 第三轮：场景同步洪泛
// 目标：50人频繁发送 scene_update，持续10分钟
// 验收：画布数据不倒退、Redis不崩、PG UPSERT正常
// =============================================================
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

const sceneSent = new Counter('scene_update_sent');
const sceneErrors = new Counter('scene_errors');
const connectTime = new Trend('scene_connect_time_ms', true);
const successRate = new Rate('scene_success_rate');

export const options = {
  scenarios: {
    scene_flood: {
      executor: 'constant-vus',
      vus: 50,
      duration: '10m',
    },
  },
  thresholds: {
    'scene_success_rate': ['rate>0.95'],
    'scene_connect_time_ms': ['p(95)<2000'],
  },
};

// 使用test房间（场景小，不会触发5MB拒绝）
const ROOM_ID = '598175d3-1d5a-4d24-a6f0-d989faa2aa62';
const WS_URL = `ws://localhost:8080/ws/room/${ROOM_ID}`;

// 生成一个轻量级测试元素（不使用真实图片，保持场景小）
function makeSceneUpdate(vuId, iteration) {
  return JSON.stringify({
    type: 'scene_update',
    sender_uuid: `30000000-0000-0000-${String(vuId).padStart(4,'0')}-000000000001`,
    room_id: ROOM_ID,
    timestamp: Date.now(),
    payload: {
      elements: [
        {
          id: `test-elem-${vuId}-${iteration % 10}`,
          type: 'rectangle',
          x: (vuId * 50) % 800,
          y: (iteration * 10) % 600,
          width: 100,
          height: 50,
          version: iteration + 1,
          isDeleted: false,
          customData: {
            creatorId: `30000000-0000-0000-${String(vuId).padStart(4,'0')}-000000000001`,
          },
        },
      ],
      files: {},
    },
  });
}

export default function () {
  const vuId = __VU;
  const paddedVu = String(vuId).padStart(4, '0');
  const guestUUID = `30000000-0000-0000-${paddedVu}-000000000001`;
  const url = `${WS_URL}?uuid=${guestUUID}`;

  const start = Date.now();
  let roomSyncReceived = false;
  let iteration = 0;

  const res = ws.connect(url, {
    headers: { 'Origin': 'http://localhost:3000' },
  }, function (socket) {
    connectTime.add(Date.now() - start);

    socket.on('message', function (data) {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'room_sync') {
          roomSyncReceived = true;
        }
      } catch (e) {}
    });

    socket.on('error', function () {
      sceneErrors.add(1);
    });

    // room_sync后开始发送scene_update，每500ms一次
    socket.setTimeout(function sendScene() {
      if (roomSyncReceived) {
        try {
          socket.send(makeSceneUpdate(vuId, iteration));
          sceneSent.add(1);
          iteration++;
        } catch (e) {
          sceneErrors.add(1);
        }
      }
      // 每500ms继续发送
      socket.setTimeout(sendScene, 500);
    }, 1000);

    // 保持连接直到测试结束（55秒关闭，给最后一个迭代留时间）
    socket.setTimeout(function () {
      socket.close();
    }, 55000);
  });

  const success = check(res, {
    'WS连接成功': (r) => r && r.status === 101,
  });
  successRate.add(success);

  sleep(1);
}
