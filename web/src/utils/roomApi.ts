// =============================================================
// MindCanvas - 房间（课堂）API
// REQ-048：作业关联课堂需要一个「当前教师的房间列表」下拉数据源。
// 后端 GET /api/rooms 对 teacher 角色已按 teacher_id 过滤，
// 所以这里拿到的天然就是自己名下的房间，无需前端再筛。
// =============================================================
import type { Room } from '@/types/room';

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || '请求失败');
  return data as T;
}

// 列出当前教师可见的课堂房间
export async function listRooms(): Promise<Room[]> {
  const data = await req<{ rooms: Room[] }>('/api/rooms');
  return data.rooms || [];
}
