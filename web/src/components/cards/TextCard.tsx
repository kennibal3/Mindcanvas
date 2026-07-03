// =============================================================
// MindCanvas v3.0 - 文本卡片组件
// 功能：
// - 可编辑文本内容（双击进入编辑，失焦保存）
// - 点赞按钮
// - 创建者信息（悬停显示）
// - 教师可删除
// - 背景色选择
// =============================================================
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ThumbsUp, Trash2, User, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CanvasElement } from '@/types/canvas';
import { CARD_COLORS } from '@/utils/constants';

/**
 * TextCard Props
 */
interface TextCardProps {
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
 * 文本卡片组件
 */
const TextCard: React.FC<TextCardProps> = ({
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
  /** 是否处于编辑模式 */
  const [isEditing, setIsEditing] = useState(false);
  /** 本地编辑内容（编辑时暂存，失焦时提交） */
  const [localContent, setLocalContent] = useState(payload.content || '');
  /** 是否显示颜色选择器 */
  const [showColorPicker, setShowColorPicker] = useState(false);
  /** 文本输入框引用 */
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 当 payload.content 从外部更新时，同步本地内容
  useEffect(() => {
    if (!isEditing) {
      setLocalContent(payload.content || '');
    }
  }, [payload.content, isEditing]);

  /**
   * 进入编辑模式
   */
  const handleStartEdit = useCallback(() => {
    if (isLocked) return;
    setIsEditing(true);
    // 下一帧聚焦输入框
    setTimeout(() => {
      textareaRef.current?.focus();
      // 光标移到末尾
      textareaRef.current?.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
    }, 0);
  }, [isLocked]);

  /**
   * 失焦时保存内容
   */
  const handleBlur = useCallback(() => {
    setIsEditing(false);
    const trimmed = localContent.trim();
    if (trimmed !== (payload.content || '').trim()) {
      onUpdate({ content: trimmed });
    }
  }, [localContent, payload.content, onUpdate]);

  /**
   * 按键处理（Escape 退出编辑）
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsEditing(false);
        setLocalContent(payload.content || '');
      }
      // 阻止事件冒泡，避免触发 Excalidraw 的快捷键
      e.stopPropagation();
    },
    [payload.content]
  );

  /**
   * 选择背景色
   */
  const handleColorSelect = useCallback(
    (color: string) => {
      onUpdate({ bg_color: color });
      setShowColorPicker(false);
    },
    [onUpdate]
  );

  return (
    <div className="text-card" style={{ padding: '12px', position: 'relative' }}>
      {/* ===== 文本内容区域 ===== */}
      {isEditing ? (
        /* 编辑模式：显示 textarea */
        <textarea
          ref={textareaRef}
          value={localContent}
          onChange={(e) => setLocalContent(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="w-full resize-none border-none outline-none bg-transparent"
          style={{
            fontSize: `${payload.font_size || 14}px`,
            minHeight: '80px',
            lineHeight: '1.5',
          }}
          placeholder={t('card.placeholder')}
          maxLength={2000}
        />
      ) : (
        /* 查看模式：显示文本 */
        <div
          onDoubleClick={handleStartEdit}
          className="min-h-[80px] cursor-text whitespace-pre-wrap break-words"
          style={{
            fontSize: `${payload.font_size || 14}px`,
            lineHeight: '1.5',
            color: payload.content ? '#1F2937' : '#9CA3AF',
          }}
        >
          {payload.content || t('card.placeholder')}
        </div>
      )}

      {/* ===== 底部操作栏 ===== */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-black/5">
        {/* 左侧：创建者信息 */}
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <User size={12} />
          <span className="max-w-[100px] truncate">
            {element.creator_name || '匿名'}
          </span>
        </div>

        {/* 右侧：操作按钮 */}
        <div className="flex items-center gap-1">
          {/* 颜色选择按钮 */}
          {!isLocked && (
            <div className="relative">
              <button
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="p-1 rounded hover:bg-black/5 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                title="更换颜色"
              >
                <Palette size={14} />
              </button>

              {/* 颜色选择器弹窗 */}
              {showColorPicker && (
                <div
                  className="absolute bottom-8 right-0 bg-white rounded-lg shadow-lg border p-2 z-50 grid grid-cols-4 gap-1"
                  style={{ width: '120px' }}
                >
                  {CARD_COLORS.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => handleColorSelect(c.value)}
                      className="w-6 h-6 rounded-full border border-gray-200 hover:scale-110 transition-transform"
                      style={{ backgroundColor: c.value }}
                      title={c.label}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 点赞按钮 */}
          <button
            onClick={onLike}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-black/5 text-gray-400 hover:text-amber-700 transition-colors text-xs"
            title={t('card.likes')}
          >
            <ThumbsUp size={12} />
            {(payload.likes || 0) > 0 && (
              <span>{payload.likes}</span>
            )}
          </button>

          {/* 删除按钮（教师可见） */}
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
    </div>
  );
};

export default TextCard;
