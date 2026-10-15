// =============================================================
// REQ-066 一期：看板分享 API
// 每个房间一个免登录永久链接 /board/:token，展示指定 HTML 看板组件的最新内容。
// 与「发布分享」（/share/:token，课堂统计/作品墙）并存。
// =============================================================

export interface DashboardShare {
  id: string;
  room_id: string;
  element_id: string | null;
  share_token: string;
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface DashboardCandidate {
  element_id: string;
  title: string;
  updated_at: string;
  byte_size: number;
}

export interface PublicBoard {
  room_title: string;
  title: string;
  html: string;
  updated_at: string;
}

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || '请求失败');
  return data as T;
}

/** 当前链接（可能为 null）+ 房间里可选的看板组件（最近更新在前） */
export function getDashboardShare(roomId: string) {
  return req<{ share: DashboardShare | null; candidates: DashboardCandidate[] }>(
    `/api/rooms/${roomId}/dashboard-share`,
  );
}

/** 生成或更新链接；已有链接时只换展示的组件，链接本身不变 */
export function putDashboardShare(roomId: string, elementId?: string) {
  return req<{ share: DashboardShare }>(`/api/rooms/${roomId}/dashboard-share`, {
    method: 'PUT',
    body: JSON.stringify({ element_id: elementId || '' }),
  });
}

/** 停用链接（旧链接立即失效） */
export function deleteDashboardShare(roomId: string) {
  return req<{ message: string }>(`/api/rooms/${roomId}/dashboard-share`, { method: 'DELETE' });
}

/** 公开页取数（免登录） */
export function getPublicBoard(token: string) {
  return req<PublicBoard>(`/api/board/${token}`);
}

export function boardLink(token: string): string {
  return `${window.location.origin}/board/${token}`;
}
