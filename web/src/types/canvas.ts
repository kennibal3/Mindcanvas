// =============================================================
// MindCanvas v3.0 - 画布相关类型定义
// 包含画布变换、Excalidraw 元素、视口信息等
// =============================================================

/**
 * 画布变换信息
 * 用于 DOM 覆盖层跟随 Excalidraw 画布同步缩放平移
 */
export interface CanvasTransform {
  /** 水平滚动偏移 */
  scrollX: number;
  /** 垂直滚动偏移 */
  scrollY: number;
  /** 缩放级别 */
  zoom: number;
}

/**
 * 画布元素（来自数据库 room_elements）
 * 在画布 DOM 覆盖层中渲染的元素
 */
export interface CanvasElement {
  /** 元素唯一 ID */
  id: string;
  /** 所属房间 ID */
  room_id: string;
  /** 创建者 UUID */
  creator_uuid: string;
  /** 创建者名称 */
  creator_name: string;
  /** 元素类型：text_card / image_card / video_card / file_card / polling_widget / wordcloud_widget / qa_widget */
  type: string;
  /** JSONB 灵活数据（包含 x, y, width, height 等定位信息） */
  payload: Record<string, any>;
  /** 软删除标记 */
  is_deleted: boolean;
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
}

/**
 * Excalidraw 应用状态（用于获取视口信息）
 * 从 Excalidraw onChange 回调中提取
 */
export interface ExcalidrawAppState {
  /** 水平滚动偏移 */
  scrollX: number;
  /** 垂直滚动偏移 */
  scrollY: number;
  /** 缩放对象 */
  zoom: {
    value: number;
  };
  /** 当前选中工具 */
  activeTool: {
    type: string;
  };
  /** 当前选中元素 ID 列表 */
  selectedElementIds: Record<string, boolean>;
  /** 画布宽度 */
  width: number;
  /** 画布高度 */
  height: number;
}
