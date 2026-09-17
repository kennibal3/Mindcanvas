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
