// =============================================================
// MindCanvas Phase8-v2 - 作业码与花名册API工具函数
// =============================================================
import type {
  AssignmentToken,
  GenerateTokensRequest,
  GenerateTokensResponse,
  RosterSummary,
  AssignmentRoster,
  TokenVerifyResult,
  SubmitByTokenRequest,
  StudentAssessmentResult,
  StudentRemediationPublic,
} from '@/types/token';

// 通用请求封装
async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data as T;
}

// =============================================================
// 教师端：作业码管理
// =============================================================

/** 生成作业码（专属码或通用码）*/
export async function generateTokens(
  aid: string,
  request: GenerateTokensRequest
): Promise<GenerateTokensResponse> {
  return req<GenerateTokensResponse>(
    `/api/assignments/${aid}/tokens/generate`,
    { method: 'POST', body: JSON.stringify(request) }
  );
}

/** 查询作业的所有作业码 */
export async function listTokens(
  aid: string
): Promise<{ tokens: AssignmentToken[]; total: number }> {
  return req(`/api/assignments/${aid}/tokens`);
}

/** 导出作业码CSV（直接触发下载）*/
export function exportTokensCSV(aid: string): void {
  window.open(`/api/assignments/${aid}/tokens/export`, '_blank');
}

// =============================================================
// 教师端：花名册管理
// =============================================================

/** 获取花名册+提交状态 */
export async function getRoster(aid: string): Promise<RosterSummary> {
  return req<RosterSummary>(`/api/assignments/${aid}/roster`);
}

/** 手动添加花名册条目 */
export async function addRosterEntry(
  aid: string,
  studentName: string,
  studentUUID?: string
): Promise<{ roster_entry: AssignmentRoster }> {
  return req(`/api/assignments/${aid}/roster`, {
    method: 'POST',
    body: JSON.stringify({ student_name: studentName, student_uuid: studentUUID }),
  });
}

/** JSON格式批量导入花名册 */
export async function importRosterJSON(
  aid: string,
  names: string[]
): Promise<{ imported: number; message: string }> {
  return req(`/api/assignments/${aid}/roster/import`, {
    method: 'POST',
    body: JSON.stringify({ names }),
  });
}

/** CSV文件上传导入花名册 */
export async function importRosterCSVFile(
  aid: string,
  file: File
): Promise<{ imported: number; message: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`/api/assignments/${aid}/roster/import`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '导入失败');
  return data;
}

/** 从课堂在线人数同步花名册 */
export async function syncRosterFromClassroom(
  aid: string,
  roomId: string
): Promise<{ synced: number; message: string }> {
  return req(`/api/assignments/${aid}/roster/sync`, {
    method: 'POST',
    body: JSON.stringify({ room_id: roomId }),
  });
}

/** 删除花名册条目 */
export async function deleteRosterEntry(
  aid: string,
  rid: string
): Promise<void> {
  await req(`/api/assignments/${aid}/roster/${rid}`, { method: 'DELETE' });
}

// =============================================================
// 公开端：学生凭作业码提交
// =============================================================

/** 验证作业码（第一步：获取作业信息）*/
export async function verifyToken(token: string): Promise<TokenVerifyResult> {
  const res = await fetch('/api/submit/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const data = await res.json();
  // 验证失败时返回 valid:false 而非抛出异常
  if (!res.ok) return { ...data, valid: false };
  return data as TokenVerifyResult;
}

/** 凭作业码提交作业 */
export async function submitByToken(
  request: SubmitByTokenRequest
): Promise<{ submission_id: string; student_uuid: string; message: string }> {
  const res = await fetch('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '提交失败');
  return data;
}

/** 学生查看自己的评价结果 */
export async function getStudentResult(
  aid: string,
  studentUUID: string
): Promise<{ assessment: StudentAssessmentResult }> {
  const res = await fetch(`/api/submit/${aid}/result?uuid=${encodeURIComponent(studentUUID)}`, {
    headers: { 'X-Student-UUID': studentUUID },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '暂无评价结果');
  return data;
}

/**
 * 学生查看老师的反馈（REQ-039 3c）
 * 凭「作业码 + 自己的 uuid」双证；老师未发送时返回 404，由调用方按"暂无"处理。
 */
export async function getStudentRemediation(
  aid: string,
  token: string,
  studentUUID: string
): Promise<{ remediation: StudentRemediationPublic }> {
  const res = await fetch(
    `/api/submit/${aid}/remediation?token=${encodeURIComponent(token)}&uuid=${encodeURIComponent(studentUUID)}`,
    { headers: { 'X-Student-UUID': studentUUID } },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '老师还没有发布你的反馈');
  return data;
}
