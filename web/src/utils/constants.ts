// =============================================================
// MindCanvas v3.0 - 前端常量定义
// 包含 API 地址、头像、WebSocket 参数、文件限制等
// 功能11：用户颜色常量
// =============================================================

/** API 基础路径 */
export const API_BASE = '/api';

/** WebSocket 基础路径 */
export const WS_BASE = '/ws';

/** 头像列表 */
export const AVATARS = [
  { id: 1, emoji: '😀' },
  { id: 2, emoji: '😎' },
  { id: 3, emoji: '🤓' },
  { id: 4, emoji: '🦊' },
  { id: 5, emoji: '🐱' },
  { id: 6, emoji: '🐰' },
  { id: 7, emoji: '🦄' },
  { id: 8, emoji: '🐼' },
];

/** 表情反应列表 */
export const REACTIONS = [
  { emoji: '👍', label: '赞' },
  { emoji: '❤️', label: '爱心' },
  { emoji: '😂', label: '笑' },
  { emoji: '🤔', label: '思考' },
  { emoji: '👏', label: '鼓掌' },
];

/** WebSocket 重连参数 */
export const WS_CONFIG = {
  MAX_RETRY: 5,
  RETRY_INTERVAL: 2000,
  HEARTBEAT_INTERVAL: 30000,
  HEARTBEAT_TIMEOUT: 10000,
};

/** 文件上传限制 */
export const FILE_LIMITS = {
  IMAGE_MAX_SIZE: 5 * 1024 * 1024,
  DOC_MAX_SIZE: 20 * 1024 * 1024,
};

/** 图片 MIME 白名单 */
export const IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

/** 文档 MIME 白名单 */
export const DOC_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-powerpoint',
];

/** 画布配置 */
export const CANVAS_CONFIG = {
  MIN_ZOOM: 0.1,
  MAX_ZOOM: 5,
  DEFAULT_ZOOM: 1,
  NEW_CARD_OFFSET: { x: 100, y: 100 },
};

/** 场控相关常量 */
export const CONTROL_CONFIG = {
  SMALL_CLASS_MAX: 50,
  MEDIUM_CLASS_MAX: 100,
  CURSOR_THROTTLE: 500,
  /** 功能9：跟随模式广播间隔（毫秒） */
  FOLLOW_BROADCAST_INTERVAL: 500,
};

/** 卡片颜色选项 */
export const CARD_COLORS = [
  { value: '#FEF3C7', label: '黄色' },
  { value: '#DBEAFE', label: '蓝色' },
  { value: '#D1FAE5', label: '绿色' },
  { value: '#FCE7F3', label: '粉色' },
  { value: '#EDE9FE', label: '紫色' },
  { value: '#FEE2E2', label: '红色' },
  { value: '#F3F4F6', label: '灰色' },
  { value: '#FFFFFF', label: '白色' },
];

/** 元素类型常量 */
export const ELEMENT_TYPES = {
  TEXT_CARD: 'text_card',
  IMAGE_CARD: 'image_card',
  VIDEO_CARD: 'video_card',
  FILE_CARD: 'file_card',
  POLLING_WIDGET: 'polling_widget',
  WORDCLOUD_WIDGET: 'wordcloud_widget',
  QA_WIDGET: 'qa_widget',
  EXCALIDRAW_STROKE: 'excalidraw_stroke',
  DROPZONE: 'dropzone',
  DROPZONE_WIDGET: 'dropzone_widget',
} as const;
