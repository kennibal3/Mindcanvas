import type { Group, AutoGroupResponse } from '@/types/group'

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${url}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function listGroups(roomId: string): Promise<Group[]> {
  const data = await apiFetch<{ groups: Group[] }>(`/rooms/${roomId}/groups`)
  return data.groups ?? []
}

export async function createGroup(
  roomId: string,
  name: string,
  color: string,
  members: string[] = [],
  leaderUUID = '',
): Promise<{ group_id: string }> {
  return apiFetch(`/rooms/${roomId}/groups`, {
    method: 'POST',
    body: JSON.stringify({ name, color, members, leader_uuid: leaderUUID }),
  })
}

export async function updateGroup(
  roomId: string,
  groupId: string,
  patch: { name?: string; color?: string; members?: string[]; leader_uuid?: string },
): Promise<void> {
  await apiFetch(`/rooms/${roomId}/groups/${groupId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function deleteGroup(roomId: string, groupId: string): Promise<void> {
  await apiFetch(`/rooms/${roomId}/groups/${groupId}`, { method: 'DELETE' })
}

export async function autoGroup(
  roomId: string,
  mode: 'by_groups' | 'by_count',
  n: number,
): Promise<AutoGroupResponse> {
  return apiFetch(`/rooms/${roomId}/groups/auto`, {
    method: 'POST',
    body: JSON.stringify({ mode, n }),
  })
}
