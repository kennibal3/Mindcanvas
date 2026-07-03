// =============================================================
// MindCanvas Phase8 - 作业评价中心类型定义
// =============================================================

// 作业状态
export type AssignmentStatus = 'draft' | 'collecting' | 'reviewing' | 'closed';

// 材料角色
export type MaterialRole =
  | 'instruction'   // 任务说明
  | 'rubric_source' // 评分标准原文
  | 'reference'     // 参考资料
  | 'example'       // 优秀样例
  | 'submission';   // 学生提交

// 解析状态
export type ParseStatus = 'pending' | 'parsing' | 'done' | 'failed' | 'skipped';

// 评审状态
export type ReviewStatus = 'pending' | 'ai_done' | 'teacher_confirmed' | 'published';

// 作业任务
export interface Assignment {
  id: string;
  room_id?: string;
  created_by: string;
  title: string;
  description: string;
  status: AssignmentStatus;
  allow_resubmit: boolean;
  due_at?: string;
  created_at: string;
  updated_at: string;
  // 统计字段（详情页）
  material_count?: number;
  submission_count?: number;
  assessed_count?: number;
  published_count?: number;
  latest_rubric?: AssignmentRubric;
}

// 作业材料
export interface AssignmentMaterial {
  id: string;
  assignment_id: string;
  uploader_id: string;
  uploader_role: 'teacher' | 'student';
  material_role: MaterialRole;
  original_name: string;
  file_path?: string;
  file_url?: string;
  file_type?: string;
  file_size: number;
  content_text?: string;
  parsed_markdown?: string;
  parse_status: ParseStatus;
  parse_error?: string;
  word_count: number;
  char_count: number;
  parse_elapsed_ms: number;
  parsed_at?: string;
  created_at: string;
}

// 评分等级
export interface RubricLevel {
  score: number;
  label: string; // 优秀/良好/待改进
  desc: string;
}

// 评分维度
export interface RubricCriterion {
  name: string;
  weight: number;
  levels: RubricLevel[];
}

// 评分标准版本
export interface AssignmentRubric {
  id: string;
  assignment_id: string;
  version: number;
  source: 'extracted' | 'generated' | 'manual';
  criteria_json: string; // 原始JSON字符串
  criteria?: RubricCriterion[]; // 解析后
  total_score: number;
  teacher_confirmed: boolean;
  confirmed_at?: string;
  created_at: string;
}

// 学生提交
export interface AssignmentSubmission {
  id: string;
  assignment_id: string;
  student_uuid: string;
  student_name: string;
  group_id?: string;
  version: number;
  content_type: 'text' | 'file' | 'link' | 'mixed';
  content_text?: string;
  material_ids?: string[];
  submitted_at: string;
  updated_at: string;
}

// 请求类型
export interface CreateAssignmentRequest {
  room_id?: string;
  title: string;
  description?: string;
  allow_resubmit?: boolean;
  due_at?: string;
}

export interface ConfirmRubricRequest {
  criteria: RubricCriterion[];
  total_score: number;
}

// 状态标签配置
export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, {
  label: string; color: string; bg: string;
}> = {
  draft:      { label: '草稿',   color: 'text-gray-600',  bg: 'bg-gray-100'   },
  collecting: { label: '收集中', color: 'text-amber-700',  bg: 'bg-amber-100'   },
  reviewing:  { label: '评审中', color: 'text-orange-600',bg: 'bg-orange-100' },
  closed:     { label: '已关闭', color: 'text-red-600',   bg: 'bg-red-100'    },
};

// 材料角色标签
export const MATERIAL_ROLE_LABELS: Record<MaterialRole, { label: string; icon: string }> = {
  instruction:   { label: '任务说明',   icon: '📋' },
  rubric_source: { label: '评分标准',   icon: '📊' },
  reference:     { label: '参考资料',   icon: '📚' },
  example:       { label: '优秀样例',   icon: '⭐' },
  submission:    { label: '学生提交',   icon: '📝' },
};

// 解析状态标签
export const PARSE_STATUS_LABELS: Record<ParseStatus, { label: string; color: string }> = {
  pending:  { label: '待解析', color: 'text-gray-500'  },
  parsing:  { label: '解析中', color: 'text-amber-600'  },
  done:     { label: '已完成', color: 'text-green-600' },
  failed:   { label: '失败',   color: 'text-red-500'   },
  skipped:  { label: '已跳过', color: 'text-gray-400'  },
};
