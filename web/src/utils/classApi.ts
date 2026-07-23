// =============================================================
// MindCanvas REQ-045 P2 Slice-3 - 班级 / 花名册 API 工具函数
// 后端契约见 handlers/class_handler.go（认证组，教师私有）：
//   POST   /api/classes                       建班 -> { data: Class }
//   GET    /api/classes                       列班（含 student_count） -> { data: Class[] }
//   DELETE /api/classes/:cid                  删班
//   GET    /api/classes/:cid/students         花名册 -> { data: ClassStudent[] }
//   POST   /api/classes/:cid/students         单个添加 -> { data: ClassStudent }
//   POST   /api/classes/:cid/students/import  粘名批量导入 -> { inserted, skipped }
//   DELETE /api/classes/:cid/students/:sid    删学生
// 归属由后端 SQL WHERE 保证，前端无需再筛。
// =============================================================

// 班级实体（列表接口带 student_count；详情接口可为 0）
export interface Class {
  id: string;
  teacher_id: string;
  tenant_id: string;
  name: string;
  created_at: string;
  student_count: number;
}

// 花名册成员（id ＝稳定 student_id）
export interface ClassStudent {
  id: string;
  class_id: string;
  student_name: string;
  disambig: string; // 重名消歧：学号后两位/老师备注
  created_at: string;
}

// ===== 通用请求 =====
async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || '请求失败');
  return data as T;
}

// ===== 班级 =====

export async function listClasses(): Promise<Class[]> {
  const data = await req<{ data: Class[] }>('/api/classes');
  return data.data || [];
}

export async function createClass(name: string): Promise<Class> {
  const data = await req<{ data: Class }>('/api/classes', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return data.data;
}

export async function deleteClass(cid: string): Promise<void> {
  await req(`/api/classes/${cid}`, { method: 'DELETE' });
}

// ===== 花名册 =====

export async function listStudents(cid: string): Promise<ClassStudent[]> {
  const data = await req<{ data: ClassStudent[] }>(`/api/classes/${cid}/students`);
  return data.data || [];
}

export async function addStudent(
  cid: string,
  studentName: string,
  disambig: string,
): Promise<ClassStudent> {
  const data = await req<{ data: ClassStudent }>(`/api/classes/${cid}/students`, {
    method: 'POST',
    body: JSON.stringify({ student_name: studentName, disambig }),
  });
  return data.data;
}

// 粘一列名字批量导入。每项一个名字，可写 "名字|消歧"/"名字,消歧" 单行带消歧。
export async function importStudents(
  cid: string,
  names: string[],
): Promise<{ inserted: number; skipped: number }> {
  return req(`/api/classes/${cid}/students/import`, {
    method: 'POST',
    body: JSON.stringify({ names }),
  });
}

export async function deleteStudent(cid: string, sid: string): Promise<void> {
  await req(`/api/classes/${cid}/students/${sid}`, { method: 'DELETE' });
}
