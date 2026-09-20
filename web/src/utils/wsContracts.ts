// =============================================================
// WebSocket 消息契约的纯函数（零依赖，便于 node --test 直接跑，见 web/tests/）
// 契约样例与服务端共享：仓库根目录 contracts/room_sync.json
//   （服务端 server/handlers/ws_contract_test.go 校验发出的消息与样例一致，
//     web/tests/wsContracts.test.mts 校验这里能从样例里读出房间信息）
// =============================================================

/**
 * 从 room_sync 消息里取出房间信息（标题、模式等）。
 * 服务端把 room 放在消息顶层（与 elements/members 同级）；同时兼容旧的 payload.room 位置。
 * BUG-038 曾因只读 msg.payload?.room（服务端从不发），学生端房间标题恒为「课堂」。
 * 非 room_sync 消息一律返回 undefined。
 */
export function extractSyncedRoom(msg: any): any {
  if (!msg || msg.type !== 'room_sync') return undefined;
  return msg.room ?? msg.payload?.room ?? undefined;
}

/**
 * widget_update（投票/词云/问答提交后服务端广播给全房间）应如何处理。
 * 契约样例与服务端共享：仓库根目录 contracts/widget_update.json
 *   （server/handlers/ws_contract_widget_fixture_test.go 校验真实广播的字段集合与样例一致）。
 *
 * 两条历史教训都锁在这里：
 *   1. BUG-004/047：msg.payload 已是完整两层结构 {x,y,width,height,payload:{业务字段}}，
 *      必须原样交给 store.updateElement，不能再包一层；服务端若把业务字段摊平到外层，
 *      组件读嵌套层就永远是旧值（教师端「N 人已答题」不刷新）。
 *   2. 2026-09-17：广播是给全房间的，只有 from 等于本人 uuid 才向本人派发「提交已确认」，
 *      否则任意一人投票会让全房间学生的投票/问答组件一起被标记已提交。
 */
export interface WidgetUpdateEffect {
  elementId: string;
  payload: any;
  applyToStore: boolean;
  confirmToSubmitter: boolean;
}

export function interpretWidgetUpdate(msg: any, selfUuid?: string): WidgetUpdateEffect {
  const elementId: string = msg?.element_id || msg?.payload?.element_id || '';
  const payload = msg?.payload;
  const fromUuid: string = msg?.from || msg?.sender_uuid || '';
  return {
    elementId,
    payload,
    applyToStore: !!(elementId && payload),
    confirmToSubmitter: !!(elementId && fromUuid && fromUuid === selfUuid),
  };
}

/** widget_error（提交失败，只回给提交者本人）对应的 ws_widget_vote_result 事件 detail */
export function buildWidgetErrorDetail(msg: any): { element_id: string; confirmed: false; error: string } {
  return {
    element_id: msg?.element_id || '',
    confirmed: false,
    error: msg?.error || '提交失败',
  };
}
