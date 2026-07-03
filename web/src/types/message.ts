// =============================================================
// MindCanvas v4.1 - WebSocket 消息类型定义
// Phase 5新增：课堂流程控制器消息类型
// =============================================================

/** WebSocket 消息结构 */
export interface WSMessage {
  type: string;
  sender_uuid?: string;
  room_id?: string;
  timestamp?: number;
  payload?: Record<string, any>;
  // DropZone 广播字段（扁平结构）
  element_id?: string;
  new_submission?: Record<string, any>;
  updated_submission?: Record<string, any>;
  error?: string;
  from?: string;
}

/** 消息类型常量 */
export const MessageTypes = {
  ROOM_SYNC:    'room_sync',
  MEMBER_JOIN:  'member_join',
  MEMBER_LEAVE: 'member_leave',
  ELEMENT_CREATE: 'element_create',
  ELEMENT_UPDATE: 'element_update',
  ELEMENT_DELETE: 'element_delete',
  DRAW_STROKE:  'draw_stroke',
  CURSOR_MOVE:  'cursor_move',
  WIDGET_SUBMIT: 'widget_submit',
  WIDGET_UPDATE: 'widget_update',
  CARD_LIKE:    'card_like',
  CARD_REACTION: 'card_reaction',
  CTRL_GATHER:   'ctrl_gather',
  CTRL_LOCKDOWN: 'ctrl_lockdown',
  CTRL_KICK:     'ctrl_kick',
  CTRL_READONLY: 'ctrl_readonly',
  // DropZone
  DROPZONE_SUBMIT: 'dropzone_submit',
  DROPZONE_ACTION: 'dropzone_action',
  DROPZONE_UPDATE: 'dropzone_update',
  DROPZONE_ERROR:  'dropzone_error',
  // 分组
  GROUP_UPDATE: 'group_update',
  // ⭐ Phase 5 课堂流程
  // ctrl_flow_update: 广播给所有人，含进度信息（学生端据此更新进度条）
  CTRL_FLOW_UPDATE: 'ctrl_flow_update',
  // ctrl_flow_widget_hint: 仅教师端收到，提示有Widget需要手动开启
  CTRL_FLOW_WIDGET_HINT: 'ctrl_flow_widget_hint',
  PING: 'ping',
  PONG: 'pong',
  ERROR: 'error',
} as const;
