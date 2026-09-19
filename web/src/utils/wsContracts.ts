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
