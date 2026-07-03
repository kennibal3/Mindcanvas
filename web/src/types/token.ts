// =============================================================
// MindCanvas Phase8-v2 - 作业码与花名册类型定义
// =============================================================

// ===== 作业码 =====
export interface AssignmentToken {
  id: string;
  assignment_id: string;
  student_uuid?: string;
  student_name?: string;
  token: string;
  token_type: 'dedicated' | 'universal';
  expires_at: string;
  used_at?: string;
  submission_id?: string;
  created_at: string;
}

// ===== 花名册条目 =====
export interface AssignmentRoster {
  id: string;
  assignment_id: string;
  student_name: string;
  student_uuid?: string;
  token_id?: string;
  source: 'classroom' | 'manual' | 'import';
  expected: boolean;
  created_at: string;
}

// ===== 花名册+提交状态（老师视图）=====
export interface RosterWithStatus extends AssignmentRoster {
  token?: string;
  token_type?: string;
  token_expires_at?: string;
  has_submitted: boolean;
  submission_id?: string;
  submitted_at?: string;
  content_type?: string;
  assess_status?: string;
}

// ===== 花名册汇总 =====
export interface RosterSummary {
  total_expected: number;
  total_submitted: number;
  total_pending: number;
  submit_rate: number;
  roster: RosterWithStatus[];
}

// ===== 作业码验证结果 =====
export interface TokenVerifyResult {
  valid: boolean;
  token: string;
  token_type: 'dedicated' | 'universal';
  student_uuid?: string;
  student_name?: string;
  assignment_id: string;
  assignment_title: string;
  assignment_description: string;
  assignment_status: string;
  due_at?: string;
  allow_resubmit: boolean;
  existing_submission?: {
    id: string;
    content_type: string;
    content_text?: string;
    submitted_at: string;
    version: number;
  };
  error?: string;
}

// ===== 生成作业码请求 =====
export interface GenerateTokensRequest {
  token_type: 'dedicated' | 'universal';
  room_id?: string;       // 专属码时需要
  count?: number;         // 通用码时需要
  expire_days?: number;   // 默认7天
}

// ===== 生成作业码响应 =====
export interface GenerateTokensResponse {
  tokens: AssignmentToken[];
  total_count: number;
  token_type: string;
  expires_at: string;
  message: string;
}

// ===== 凭作业码提交请求 =====
export interface SubmitByTokenRequest {
  token: string;
  student_name?: string;  // 通用码时必填
  content_type?: string;
  content_text?: string;
}

// ===== 评价结果（学生视角）=====
export interface StudentAssessmentResult {
  id: string;
  submission_id: string;
  rubric_id: string;
  ai_score?: number;
  ai_dimension_scores?: Record<string, number>;
  ai_feedback?: string;
  ai_highlights?: string;
  ai_issues?: string;
  ai_suggestions?: string;
  final_score?: number;
  final_dimension_scores?: Record<string, number>;
  final_feedback?: string;
  review_status: string;
  published_at?: string;
}

// ===== 提交页面状态机 =====
export type SubmitPageStep =
  | 'input_token'      // 输入作业码
  | 'verifying'        // 验证中
  | 'fill_name'        // 通用码填写姓名
  | 'write_content'    // 填写作业内容
  | 'submitting'       // 提交中
  | 'success'          // 提交成功
  | 'view_result'      // 查看评价结果
  | 'error';           // 错误状态
