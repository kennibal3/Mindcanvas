// =============================================================
// MindCanvas v3.0 - 卡片统一渲染器
// 根据卡片类型分发到对应的卡片组件
// 提供统一的卡片容器样式（阴影、圆角、悬停效果）
// =============================================================
import React from 'react';
import TextCard from './TextCard';
import ImageCard from './ImageCard';
import type { CanvasElement } from '@/types/canvas';
import { ELEMENT_TYPES } from '@/utils/constants';

/**
 * CardRenderer Props
 */
interface CardRendererProps {
  /** 元素数据 */
  element: CanvasElement;
  /** 当前用户是否为教师 */
  isTeacher: boolean;
  /** 画布是否锁定/只读 */
  isLocked: boolean;
  /** 更新卡片 payload 的回调 */
  onUpdate: (payload: Record<string, any>) => void;
  /** 删除卡片的回调 */
  onDelete: () => void;
  /** 点赞回调 */
  onLike: () => void;
}

/**
 * 卡片统一渲染器
 * 提供统一外壳 + 根据类型渲染内部组件
 */
const CardRenderer: React.FC<CardRendererProps> = ({
  element,
  isTeacher,
  isLocked,
  onUpdate,
  onDelete,
  onLike,
}) => {
  /**
   * 根据类型渲染对应卡片组件
   */
  const renderCard = () => {
    switch (element.type) {
      case ELEMENT_TYPES.TEXT_CARD:
        return (
          <TextCard
            element={element}
            isTeacher={isTeacher}
            isLocked={isLocked}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onLike={onLike}
          />
        );

      case ELEMENT_TYPES.IMAGE_CARD:
        return (
          <ImageCard
            element={element}
            isTeacher={isTeacher}
            isLocked={isLocked}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onLike={onLike}
          />
        );

      case ELEMENT_TYPES.VIDEO_CARD:
        // Phase 3 实现
        return (
          <div className="p-3 text-center text-gray-400 text-sm">
            🎬 视频卡片（开发中）
          </div>
        );

      case ELEMENT_TYPES.FILE_CARD:
        // Phase 3 实现
        return (
          <div className="p-3 text-center text-gray-400 text-sm">
            📄 文件卡片（开发中）
          </div>
        );

      default:
        return (
          <div className="p-3 text-center text-gray-400 text-sm">
            未知卡片类型: {element.type}
          </div>
        );
    }
  };

  return (
    <div
      className="card-container group"
      style={{
        background: element.payload?.bg_color || '#FFFFFF',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        border: '1px solid rgba(0,0,0,0.06)',
        overflow: 'hidden',
        transition: 'box-shadow 0.2s, transform 0.1s',
        cursor: isLocked ? 'default' : 'grab',
        width: '100%',
        minHeight: '100%',
      }}
    >
      {renderCard()}
    </div>
  );
};

export default CardRenderer;
