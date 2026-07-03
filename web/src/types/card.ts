// =============================================================
// MindCanvas v3.0 - 卡片类型定义
// 定义文本卡片、图片卡片、视频卡片、文件卡片的结构
// =============================================================

/**
 * 卡片类型枚举
 */
export type CardType = 'text_card' | 'image_card' | 'video_card' | 'file_card';

/**
 * 卡片节点基础结构
 * 存储在 room_elements 的 payload JSONB 中
 */
export interface CardNode {
  /** 元素 ID（对应 room_elements.id） */
  id: string;
  /** 卡片类型 */
  type: CardType;
  /** 画布 x 坐标 */
  x: number;
  /** 画布 y 坐标 */
  y: number;
  /** 卡片宽度 */
  width: number;
  /** 卡片高度 */
  height: number;
  /** 创建者 UUID */
  creator_uuid: string;
  /** 创建者名称 */
  creator_name: string;
  /** 卡片数据（不同类型有不同字段） */
  payload: Record<string, any>;
}

/**
 * 文本卡片 payload
 */
export interface TextCardPayload {
  /** 画布 x 坐标 */
  x: number;
  /** 画布 y 坐标 */
  y: number;
  /** 卡片宽度 */
  width: number;
  /** 卡片高度 */
  height: number;
  /** 文本内容 */
  content: string;
  /** 字体大小 */
  font_size: number;
  /** 背景色 */
  bg_color: string;
  /** 点赞数 */
  likes: number;
  /** 表情反应 */
  reactions: Record<string, number>;
}

/**
 * 图片卡片 payload
 */
export interface ImageCardPayload {
  /** 画布 x 坐标 */
  x: number;
  /** 画布 y 坐标 */
  y: number;
  /** 卡片宽度 */
  width: number;
  /** 卡片高度 */
  height: number;
  /** 图片 URL */
  url: string;
  /** 图片说明 */
  caption: string;
  /** 点赞数 */
  likes: number;
}

/**
 * 视频卡片 payload
 */
export interface VideoCardPayload {
  /** 画布 x 坐标 */
  x: number;
  /** 画布 y 坐标 */
  y: number;
  /** 卡片宽度 */
  width: number;
  /** 卡片高度 */
  height: number;
  /** 视频平台 */
  platform: 'youtube' | 'bilibili' | 'unknown';
  /** 原始 URL */
  original_url: string;
  /** 嵌入 URL */
  embed_url: string;
  /** 缩略图 URL */
  thumbnail_url: string;
}

/**
 * 文件卡片 payload
 */
export interface FileCardPayload {
  /** 画布 x 坐标 */
  x: number;
  /** 画布 y 坐标 */
  y: number;
  /** 卡片宽度 */
  width: number;
  /** 卡片高度 */
  height: number;
  /** 文件名 */
  file_name: string;
  /** 文件大小（字节） */
  file_size: number;
  /** 文件 MIME 类型 */
  file_type: string;
  /** 下载 URL */
  url: string;
}

/**
 * 卡片默认尺寸配置
 */
export const CARD_DEFAULTS: Record<CardType, { width: number; height: number }> = {
  text_card:  { width: 240, height: 160 },
  image_card: { width: 280, height: 220 },
  video_card: { width: 320, height: 240 },
  file_card:  { width: 240, height: 120 },
};

/**
 * 文本卡片可选背景色
 */
export const TEXT_CARD_COLORS = [
  '#FEF3C7', // 黄色
  '#DBEAFE', // 蓝色
  '#D1FAE5', // 绿色
  '#FCE7F3', // 粉色
  '#EDE9FE', // 紫色
  '#FEE2E2', // 红色
  '#F3F4F6', // 灰色
  '#FFFFFF', // 白色
];
