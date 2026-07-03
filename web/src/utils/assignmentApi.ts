// =============================================================
// MindCanvas Phase8 - 作业评价中心 API 工具函数
// =============================================================
import type {
  Assignment, AssignmentMaterial, AssignmentRubric,
  AssignmentSubmission, CreateAssignmentRequest, ConfirmRubricRequest,
} from '@/types/assignment';

const BASE = '/api/assignments';

// ===== 通用请求 =====
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

// ===== 作业 CRUD =====

export async function listAssignments(roomId?: string): Promise<{
  assignments: Assignment[]; total: number;
}> {
  const url = roomId ? `${BASE}?room_id=${roomId}` : BASE;
  return req(url);
}

export async function createAssignment(data: CreateAssignmentRequest): Promise<{
  assignment: Assignment;
}> {
  return req(BASE, { method: 'POST', body: JSON.stringify(data) });
}

export async function getAssignment(aid: string): Promise<{ assignment: Assignment }> {
  return req(`${BASE}/${aid}`);
}

export async function updateAssignmentStatus(aid: string, status: string): Promise<{
  message: string; status: string;
}> {
  return req(`${BASE}/${aid}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function deleteAssignment(aid: string): Promise<{ message: string }> {
  return req(`${BASE}/${aid}`, { method: 'DELETE' });
}

// ===== 材料管理 =====

export async function listMaterials(aid: string): Promise<{
  materials: AssignmentMaterial[]; total: number;
}> {
  return req(`${BASE}/${aid}/materials`);
}

export async function addTextMaterial(aid: string, data: {
  material_role: string;
  content_text: string;
  original_name?: string;
}): Promise<{ material: AssignmentMaterial }> {
  return req(`${BASE}/${aid}/materials/text`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteMaterial(aid: string, mid: string): Promise<{ message: string }> {
  return req(`${BASE}/${aid}/materials/${mid}`, { method: 'DELETE' });
}

export async function reparseMaterial(aid: string, mid: string): Promise<{ message: string }> {
  return req(`${BASE}/${aid}/materials/${mid}/parse`, { method: 'POST' });
}

// 文件上传（multipart，不走通用req）
export async function uploadMaterialFile(
  aid: string,
  file: File,
  materialRole: string,
  onProgress?: (pct: number) => void,
): Promise<{ material: AssignmentMaterial; message: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('material_role', materialRole);

  const res = await fetch(`${BASE}/${aid}/materials`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '上传失败');
  return data;
}

// ===== Rubric 评分标准 =====

export async function generateRubric(aid: string): Promise<{
  rubric: AssignmentRubric; message: string;
}> {
  return req(`${BASE}/${aid}/rubric/generate`, { method: 'POST' });
}

export async function getRubric(aid: string): Promise<{ rubric: AssignmentRubric }> {
  return req(`${BASE}/${aid}/rubric`);
}

export async function confirmRubric(
  aid: string,
  data: ConfirmRubricRequest,
): Promise<{ rubric: AssignmentRubric; message: string }> {
  return req(`${BASE}/${aid}/rubric`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ===== 提交管理 =====

export async function listSubmissions(aid: string): Promise<{
  submissions: AssignmentSubmission[]; total: number;
}> {
  return req(`${BASE}/${aid}/submissions`);
}

// ===== 解析服务状态 =====

export async function checkParserHealth(): Promise<{
  status: string; parser_url: string;
}> {
  return req(`${BASE}/parser/health`);
}
