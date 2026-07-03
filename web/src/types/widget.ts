// =============================================================
// MindCanvas v4.1 - Widget 类型定义
// 新增：DropzonePayload、Submission 类型
// =============================================================

// Widget 组件类型联合
export type WidgetType =
  | 'polling_widget'
  | 'wordcloud_widget'
  | 'qa_widget'
  | 'dropzone_widget'
  | 'dropzone'; // 兼容旧值

// Widget 组件 Props（注册中心标准接口）
export interface WidgetProps {
  id: string;
  payload: Record<string, unknown>;
  isTeacher: boolean;
  isLocked?: boolean;
  onUpdate: (payload: Record<string, unknown>) => void;
  onSubmit?: (action: string, data: Record<string, unknown>) => void;
}

// Widget 注册元数据
export interface WidgetMeta {
  type: string;
  label: string;
  icon: string;
  description?: string;
  category?: string;
  defaultPayload: Record<string, unknown>;
}

// ===== 投票 =====
export interface PollingPayload {
  question: string;
  options: string[];
  mode: 'single' | 'multiple';
  anonymous: boolean;
  showResult: boolean;
  allowChange: boolean;
  status: 'draft' | 'open' | 'paused' | 'closed';
  votes: Record<string, number>;
  chart_type?: 'bar' | 'pie' | 'horizontal';
  correctIdx?: number;
  openedAt?: string;
  closedAt?: string;
}

// ===== 词云 =====
export interface WordCloudPayload {
  prompt: string;
  words: Record<string, number>;
  status: 'draft' | 'open' | 'paused' | 'closed';
  max_words_per_student: number;
  anonymous: boolean;
}

// ===== 问答 =====
export interface QAPayload {
  question: string;
  options: string[];
  correctIdx: number;
  explanation?: string;
  status: 'draft' | 'open' | 'closed';
  showResult: boolean;
  showExplanation: boolean;
  stats: Record<string, number>;
}

// ===== DropZone 作品墙 =====

/** 单条作品（来自 widget_interactions.action_data） */
export interface Submission {
  id: string;
  student_uuid: string;
  student_name: string;
  group_id?: string;
  content_type: 'text' | 'image' | 'file' | 'link';
  content: string;         // 文本内容或文件 URL
  thumbnail?: string;      // 图片缩略图 URL
  likes: number;
  tags: string[];
  pinned: boolean;
  hidden: boolean;
  deleted?: boolean;
  submitted_at: string;    // ISO 时间字符串
}

/** DropZone 组件 Payload（存储在 room_elements.payload） */
export interface DropzonePayload {
  title: string;
  prompt: string;
  // 接受的内容类型
  acceptTypes: Array<'text' | 'image' | 'file' | 'link'>;
  // 精细文件扩展名控制（可选），如 ['.pdf', '.docx']
  allowedExtensions?: string[];
  // 单文件大小上限（MB）
  maxFileSizeMB: number;
  // 提交规则
  status: 'draft' | 'open' | 'paused' | 'closed';
  deadline?: string;                                    // ISO 时间，支持课后提交
  submissionUnit: 'individual' | 'group';               // 个人/小组提交
  maxPerStudent: number;
  requireDescription: boolean;
  // 展示配置
  layout: 'grid' | 'waterfall' | 'list' | 'spotlight';
  hideNames: boolean;
  // 评价配置
  enableLike: boolean;
  // 缓存（来自后端）
  submissionOrder: string[];
  submissionCount: number;
}

// ===== WebSocket 消息类型 =====

/** 学生提交作品消息 */
export interface DropzoneSubmitMessage {
  type: 'dropzone_submit';
  element_id: string;
  content_type: 'text' | 'image' | 'file' | 'link';
  content: string;
  thumbnail?: string;
  group_id?: string;
}

/** 教师操作作品消息 */
export interface DropzoneActionMessage {
  type: 'dropzone_action';
  element_id: string;
  submission_id: string;
  action_type: 'like' | 'pin' | 'tag' | 'hide' | 'delete_submission';
  tags?: string[];
}

// ===== Teaching Module =====
export type MountPoint = 'sidebar' | 'panel' | 'fullpage';
export type MinRole = 'teacher' | 'admin' | 'superadmin';

export interface ModuleProps {
  roomId: string;
  isTeacher: boolean;
}

export interface TeachingModuleConfig {
  name?: string;  // 兼容 ModuleRegistry 旧调用
  id: string;
  label: string;
  icon: string;
  mountPoint: MountPoint;
  minRole: MinRole;
  component: React.ComponentType<ModuleProps>;
}
