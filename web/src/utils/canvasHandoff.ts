// =============================================================
// MindCanvas REQ-039 第三期 3d — 「插入画布」跨页面交接
// 作业详情页点「插入画布」→ 暂存待插内容 → 跳转房间 →
// 房间页画布就绪后取出并插入（复用 REQ-027 前端插入链路，
// 不碰服务端 room_scenes 持久化，插入后走既有场景同步自然落库）。
//
// 用 sessionStorage 而非 URL 参数：内容可能较长且含换行/引号，
// 放 URL 既难看又有长度风险；sessionStorage 同标签页内有效，
// 跳转后即用即删，不留垃圾。
// =============================================================

const KEY = 'mc_pending_canvas_insert';
const MAX_AGE_MS = 5 * 60 * 1000; // 5 分钟内有效，防陈旧内容意外插入

export interface PendingCanvasInsert {
  roomId: string;
  title: string;
  items: string[];
  quotes?: string[];
  ts: number;
}

export function stashCanvasInsert(payload: Omit<PendingCanvasInsert, 'ts'>) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...payload, ts: Date.now() }));
  } catch {
    // 隐私模式等场景下 sessionStorage 可能不可用，调用方据返回值提示
    return false;
  }
  return true;
}

// 取出并立即清除（只消费一次，避免刷新房间页重复插入）
export function takeCanvasInsert(roomId: string): PendingCanvasInsert | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as PendingCanvasInsert;
    if (!data || data.roomId !== roomId) return null;       // 不是这个房间的，留着不动
    sessionStorage.removeItem(KEY);
    if (!data.ts || Date.now() - data.ts > MAX_AGE_MS) return null;
    if (!Array.isArray(data.items) || data.items.length === 0) return null;
    return data;
  } catch {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    return null;
  }
}
