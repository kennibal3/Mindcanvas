// =============================================================
// MindCanvas v4.1 - Phase 5 课堂流程API封装
// =============================================================
import type {
  TeachingFlow, CreateFlowRequest, AdvanceFlowRequest, FlowProgress
} from '@/types/flow';

const API_BASE = '/api';

/** 统一请求封装 */
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data as T;
}

/** 获取房间当前流程（教师端） */
export async function getFlow(roomId: string): Promise<{ flow: TeachingFlow | null; has_flow: boolean }> {
  return request(`/rooms/${roomId}/flow`);
}

/** 获取房间所有流程历史 */
export async function listFlows(roomId: string): Promise<{ flows: TeachingFlow[]; total: number }> {
  return request(`/rooms/${roomId}/flows`);
}

/** 创建课堂流程 */
export async function createFlow(roomId: string, req: CreateFlowRequest): Promise<{ flow: TeachingFlow }> {
  return request(`/rooms/${roomId}/flow`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

/** 更新课堂流程（全量覆盖） */
export async function updateFlow(
  roomId: string,
  flowId: string,
  req: Partial<CreateFlowRequest>
): Promise<{ flow: TeachingFlow }> {
  return request(`/rooms/${roomId}/flow/${flowId}`, {
    method: 'PUT',
    body: JSON.stringify(req),
  });
}

/** 删除课堂流程 */
export async function deleteFlow(roomId: string, flowId: string): Promise<void> {
  return request(`/rooms/${roomId}/flow/${flowId}`, { method: 'DELETE' });
}

/** 开始上课（draft → active） */
export async function activateFlow(roomId: string, flowId: string): Promise<{ flow: TeachingFlow }> {
  return request(`/rooms/${roomId}/flow/${flowId}/activate`, { method: 'POST' });
}

/** 推进节点 */
export async function advanceFlow(
  roomId: string,
  flowId: string,
  req: AdvanceFlowRequest
): Promise<{ flow: TeachingFlow; current_node_index: number }> {
  return request(`/rooms/${roomId}/flow/${flowId}/advance`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

/** 结束流程 */
export async function finishFlow(roomId: string, flowId: string): Promise<{ flow: TeachingFlow }> {
  return request(`/rooms/${roomId}/flow/${flowId}/finish`, { method: 'POST' });
}

/** 切换学生进度显示 */
export async function updateShowProgress(
  roomId: string,
  flowId: string,
  show: boolean
): Promise<void> {
  return request(`/rooms/${roomId}/flow/${flowId}/progress-visibility`, {
    method: 'PATCH',
    body: JSON.stringify({ show }),
  });
}

/** 学生端获取进度（公开接口，无需登录） */
export async function getStudentProgress(
  roomId: string
): Promise<{ progress: FlowProgress | null; visible: boolean }> {
  return request(`/rooms/${roomId}/flow/progress`);
}
