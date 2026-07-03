// =============================================================
// MindCanvas WebSocket 压测脚本 - 第二轮：投票并发写入
// 目标：100个学生同时提交投票，验证唯一约束并发可靠性
// 关键：option字段传选项文字，不传索引
// =============================================================
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

const voteSuccess = new Counter('vote_success');
const voteFailed = new Counter('vote_failed');
const voteTime = new Trend('vote_time_ms', true);
const wsErrors = new Counter('ws_errors');
const successRate = new Rate('vote_success_rate');

export const options = {
  scenarios: {
    concurrent_vote: {
      executor: 'constant-vus',
      vus: 100,
      duration: '60s',
    },
  },
  thresholds: {
    'vote_success_rate': ['rate>0.95'],
    'vote_time_ms': ['p(95)<3000'],
  },
};

const ROOM_ID = '598175d3-1d5a-4d24-a6f0-d989faa2aa62';
const ELEMENT_ID = '28ab50da-7111-4904-893a-1feaa71145fd';
const WS_URL = `ws://localhost:8080/ws/room/${ROOM_ID}`;

// 选项文字（必须和DB中payload.options完全匹配）
const OPTIONS = ['互动讨论', '视频讲解', '实践练习'];

export default function () {
  const vuId = __VU;
  const paddedVu = String(vuId).padStart(4, '0');
  // 每个VU固定UUID：同一学生只能投一次，测唯一约束
  const guestUUID = `20000000-0000-0000-${paddedVu}-000000000001`;
  const url = `${WS_URL}?uuid=${guestUUID}`;

  // 选项文字（VU分散到3个选项）
  const selectedOption = OPTIONS[vuId % OPTIONS.length];

  let roomSyncReceived = false;
  let voteResponseReceived = false;
  let voteSentTime = 0;

  const res = ws.connect(url, {
    headers: { 'Origin': 'http://localhost:3000' },
  }, function (socket) {

    socket.on('message', function (data) {
      try {
        const msg = JSON.parse(data);

        // 等room_sync后发投票
        if (msg.type === 'room_sync' && !roomSyncReceived) {
          roomSyncReceived = true;
          socket.setTimeout(function () {
            voteSentTime = Date.now();
            socket.send(JSON.stringify({
              type: 'widget_submit',
              sender_uuid: guestUUID,
              room_id: ROOM_ID,
              timestamp: Date.now(),
              payload: {
                action_type: 'vote',
                element_id: ELEMENT_ID,
                data: {
                  option: selectedOption,       // ← 正确字段：选项文字
                  student_name: `压测学生${vuId}`,
                },
              },
            }));
          }, 200);
        }

        // 监听响应
        if ((msg.type === 'widget_update' || msg.type === 'widget_error') && !voteResponseReceived) {
          voteResponseReceived = true;
          const elapsed = Date.now() - voteSentTime;
          voteTime.add(elapsed);

          if (msg.type === 'widget_update') {
            voteSuccess.add(1);
            successRate.add(true);
          } else {
            const errMsg = msg.error || '';
            // 已投票 = 唯一约束正常工作 = 视为成功
            if (errMsg.includes('已经投过票') || errMsg.includes('duplicate') || errMsg.includes('已投')) {
              voteSuccess.add(1);
              successRate.add(true);
            } else {
              voteFailed.add(1);
              successRate.add(false);
            }
          }
        }
      } catch (e) {
        wsErrors.add(1);
      }
    });

    socket.on('error', function () {
      wsErrors.add(1);
      successRate.add(false);
    });

    socket.setTimeout(function () {
      socket.close();
    }, 12000);
  });

  check(res, {
    'WS连接成功': (r) => r && r.status === 101,
  });

  sleep(1);
}
