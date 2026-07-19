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

// ===== 讲评分析（REQ-039 第二期）=====

export interface LectureReportBlock {
  id: string;
  block_type: 'overview' | 'dimension_analysis' | 'evidence' | 'recommendation' | 'student_summary' | 'custom';
  sort_order: number;
  title: string;
  content: any;
  ai_generated: boolean;
  teacher_confirmed: boolean;
}

export interface LectureReport {
  id: string;
  assignment_id: string;
  status: string;
  title: string;
  summary: string;
  generation_status: 'pending' | 'analyzing' | 'done' | 'failed';
  last_error: string;
  source_snapshot: any;
  blocks: LectureReportBlock[];
  created_at: string;
  updated_at: string;
}

// 发起讲评分析（异步）
export async function startLectureAnalyze(aid: string): Promise<{
  report_id: string; status: string; message?: string;
}> {
  return req(`${BASE}/${aid}/lecture/analyze`, { method: 'POST' });
}

// 获取讲评报告 + 内容块（供轮询/展示）；未生成时 report 为 null
export async function getLectureReport(aid: string): Promise<{ report: LectureReport | null }> {
  return req(`${BASE}/${aid}/lecture/report`);
}

// ===== 报告编辑（REQ-039 第三期 3a）=====

// 更新内容块：字段均可选（title/content/move:'up'|'down'/confirm）
export async function updateLectureBlock(aid: string, bid: string, data: {
  title?: string;
  content?: any;
  move?: 'up' | 'down';
  confirm?: boolean;
}): Promise<{ message: string }> {
  return req(`${BASE}/${aid}/lecture/blocks/${bid}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// 删除内容块
export async function deleteLectureBlock(aid: string, bid: string): Promise<{ message: string }> {
  return req(`${BASE}/${aid}/lecture/blocks/${bid}`, { method: 'DELETE' });
}

// 单块重新生成（异步，返回 job_id 供轮询）
export async function regenerateLectureBlock(aid: string, bid: string): Promise<{
  job_id: string; status: string; message?: string;
}> {
  return req(`${BASE}/${aid}/lecture/blocks/${bid}/regenerate`, { method: 'POST' });
}

// 查询单块重生成任务状态
export async function getLectureJob(aid: string, jid: string): Promise<{
  status: 'queued' | 'running' | 'done' | 'failed'; last_error: string;
}> {
  return req(`${BASE}/${aid}/lecture/jobs/${jid}`);
}

// 确认整份报告（全部块置已确认，报告 status→confirmed）
export async function confirmLectureReport(aid: string): Promise<{ message: string }> {
  return req(`${BASE}/${aid}/lecture/confirm`, { method: 'POST' });
}

// ===== 推荐练习（REQ-039 第三期 3b）=====

export interface RecommendedQuestion {
  id: string;
  assignment_id: string;
  report_id: string;
  source_type: string;
  target_type: string;
  knowledge_points: string[] | null;
  difficulty: string;
  question_type: string;
  content: { stem?: string; options?: string[] } | null;
  answer: { answer?: string } | null;
  explanation: string;
  recommendation_reason: string;
  teacher_action: 'pending' | 'accepted' | 'edited' | 'rejected' | 'saved' | 'published';
  final_content: { stem?: string; options?: string[] } | null;
  created_at: string;
  updated_at: string;
}

export interface PublishRecommendationsResult {
  assignment_id: string;
  title: string;
  question_count: number;
  roster_count: number;
  token_count: number;
}

// 生成推荐题（异步，返回 job_id 供轮询；要求报告已确认）
export async function generateRecommendations(aid: string): Promise<{
  job_id: string; status: string; message?: string;
}> {
  return req(`${BASE}/${aid}/recommendations/generate`, { method: 'POST' });
}

// 查询推荐题生成任务状态
export async function getRecommendationJob(aid: string, jid: string): Promise<{
  status: 'queued' | 'running' | 'done' | 'failed'; last_error: string;
}> {
  return req(`${BASE}/${aid}/recommendations/jobs/${jid}`);
}

// 列出推荐题
export async function listRecommendations(aid: string): Promise<{
  questions: RecommendedQuestion[]; total: number;
}> {
  return req(`${BASE}/${aid}/recommendations`);
}

// 审核推荐题：action=accept|reject|pending，或带 content/answer/explanation 表示修改
export async function updateRecommendation(aid: string, rid: string, data: {
  action?: 'accept' | 'reject' | 'pending';
  content?: any;
  answer?: any;
  explanation?: string;
}): Promise<{ message: string }> {
  return req(`${BASE}/${aid}/recommendations/${rid}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// 发布为新作业（question_ids 为空则发布全部已采用题）
export async function publishRecommendations(aid: string, data?: {
  question_ids?: string[];
  title?: string;
  expire_days?: number;
}): Promise<{ result: PublishRecommendationsResult; message: string }> {
  return req(`${BASE}/${aid}/recommendations/publish`, {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}
