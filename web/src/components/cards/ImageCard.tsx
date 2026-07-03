// =============================================================
// MindCanvas v3.0 - 图片卡片组件
// 功能：
// - 显示图片（支持缩放预览）
// - 图片说明文字（可编辑）
// - 点赞按钮
// - 创建者信息
// - 教师可删除
// - 拖拽/粘贴上传（Phase 2 完善）
// =============================================================
import React, { useState, useCallback } from 'react';
import { ThumbsUp, Trash2, User, Maximize2, Image } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CanvasElement } from '@/types/canvas';

/**
 * ImageCard Props
 */
interface ImageCardProps {
  /** 元素数据 */
  element: CanvasElement;
  /** 当前用户是否为教师 */
  isTeacher: boolean;
  /** 画布是否锁定 */
  isLocked: boolean;
  /** 更新 payload 回调 */
  onUpdate: (payload: Record<string, any>) => void;
  /** 删除回调 */
  onDelete: () => void;
  /** 点赞回调 */
  onLike: () => void;
}

/**
 * 图片卡片组件
 */
const ImageCard: React.FC<ImageCardProps> = ({
  element,
  isTeacher,
  isLocked,
  onUpdate,
  onDelete,
  onLike,
}) => {
  const { t } = useTranslation();
  const payload = element.payload || {};

  // === 本地状态 ===
  /** 图片是否加载完成 */
  const [imageLoaded, setImageLoaded] = useState(false);
  /** 图片是否加载失败 */
  const [imageError, setImageError] = useState(false);
  /** 是否显示全屏预览 */
  const [showPreview, setShowPreview] = useState(false);
  /** 是否正在编辑说明 */
  const [editingCaption, setEditingCaption] = useState(false);
  /** 本地说明文字 */
  const [localCaption, setLocalCaption] = useState(payload.caption || '');

  /**
   * 保存图片说明
   */
  const handleCaptionSave = useCallback(() => {
    setEditingCaption(false);
    if (localCaption.trim() !== (payload.caption || '').trim()) {
      onUpdate({ caption: localCaption.trim() });
    }
  }, [localCaption, payload.caption, onUpdate]);

  return (
    <div className="image-card" style={{ position: 'relative' }}>
      {/* ===== 图片区域 ===== */}
      <div className="relative overflow-hidden" style={{ borderRadius: '12px 12px 0 0' }}>
        {payload.url ? (
          <>
            {/* 图片加载中的骨架屏 */}
            {!imageLoaded && !imageError && (
              <div className="w-full h-[140px] bg-gray-100 animate-pulse flex items-center justify-center">
                <Image size={24} className="text-gray-300" />
              </div>
            )}

            {/* 图片加载失败 */}
            {imageError && (
              <div className="w-full h-[140px] bg-gray-100 flex items-center justify-center">
                <div className="text-center text-gray-400 text-sm">
                  <Image size={24} className="mx-auto mb-1" />
                  <span>图片加载失败</span>
                </div>
              </div>
            )}

            {/* 实际图片 */}
            <img
              src={payload.url}
              alt={payload.caption || '图片'}
              className={`w-full object-cover transition-opacity ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ maxHeight: '200px', display: imageError ? 'none' : 'block' }}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />

            {/* 全屏预览按钮 */}
            {imageLoaded && (
              <button
                onClick={() => setShowPreview(true)}
                className="absolute top-2 right-2 p-1 bg-black/30 rounded-md text-white hover:bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                title="全屏预览"
              >
                <Maximize2 size={14} />
              </button>
            )}
          </>
        ) : (
          /* 无图片占位 */
          <div className="w-full h-[140px] bg-gray-50 flex flex-col items-center justify-center gap-2">
            <Image size={32} className="text-gray-300" />
            <span className="text-xs text-gray-400">{t('card.dragOrPaste')}</span>
          </div>
        )}
      </div>

      {/* ===== 图片说明 ===== */}
      <div className="px-3 py-2">
        {editingCaption ? (
          <input
            value={localCaption}
            onChange={(e) => setLocalCaption(e.target.value)}
            onBlur={handleCaptionSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCaptionSave();
              if (e.key === 'Escape') {
                setEditingCaption(false);
                setLocalCaption(payload.caption || '');
              }
              e.stopPropagation();
            }}
            className="w-full text-xs border-none outline-none bg-transparent text-gray-600"
            placeholder={t('card.caption')}
            maxLength={200}
            autoFocus
          />
        ) : (
          <div
            onDoubleClick={() => !isLocked && setEditingCaption(true)}
            className="text-xs text-gray-500 cursor-text truncate"
          >
            {payload.caption || (isLocked ? '' : t('card.caption'))}
          </div>
        )}
      </div>

      {/* ===== 底部操作栏 ===== */}
      <div className="flex items-center justify-between px-3 pb-2">
        {/* 左侧：创建者 */}
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <User size={12} />
          <span className="max-w-[80px] truncate">
            {element.creator_name || '匿名'}
          </span>
        </div>

        {/* 右侧：操作按钮 */}
        <div className="flex items-center gap-1">
          {/* 点赞 */}
          <button
            onClick={onLike}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-black/5 text-gray-400 hover:text-amber-700 transition-colors text-xs"
            title={t('card.likes')}
          >
            <ThumbsUp size={12} />
            {(payload.likes || 0) > 0 && <span>{payload.likes}</span>}
          </button>

          {/* 删除（教师） */}
          {isTeacher && !isLocked && (
            <button
              onClick={onDelete}
              className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
              title={t('card.delete')}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* ===== 全屏预览遮罩 ===== */}
      {showPreview && payload.url && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] cursor-pointer"
          onClick={() => setShowPreview(false)}
          style={{ pointerEvents: 'auto' }}
        >
          <img
            src={payload.url}
            alt={payload.caption || '图片预览'}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setShowPreview(false)}
            className="absolute top-4 right-4 text-white text-xl bg-black/40 rounded-full w-10 h-10 flex items-center justify-center hover:bg-black/60"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};

export default ImageCard;
