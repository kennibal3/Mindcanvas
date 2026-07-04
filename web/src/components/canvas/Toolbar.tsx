// =============================================================
// MindCanvas v4.1 - 画布自定义工具栏
// 悬浮在画布底部中央，提供快捷操作
// 包含：文本卡片、图片上传、缩放控制、导入 .excalidraw 文件
// 新增（需求7）：导入 .excalidraw 文件，解析后合并到当前画布
// 新增（REQ-027）：AI 图形生成按钮 + DiagramModal
// =============================================================
import React, { useCallback, useRef, useState } from 'react';
import {
  Type, ImagePlus, ZoomIn, ZoomOut, Maximize,
  Lock, BookOpen, FolderOpen, Check, Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCanvasStore } from '@/store/canvasStore';
import { useRoomStore } from '@/store/roomStore';
import { CANVAS_CONFIG, IMAGE_MIMES, FILE_LIMITS } from '@/utils/constants';
import DiagramModal from './DiagramModal';

/**
 * Toolbar Props
 */
interface ToolbarProps {
  /** 发送 WebSocket 消息 */
  sendMessage: (type: string, payload: Record<string, any>) => void;
}

/**
 * 画布底部工具栏
 */
const Toolbar: React.FC<ToolbarProps> = ({ sendMessage }) => {
  const { t } = useTranslation();

  // === Store 状态 ===
  const transform     = useCanvasStore((s) => s.transform);
  const excalidrawAPI = useCanvasStore((s) => s.excalidrawAPI);
  const isLocked      = useRoomStore((s) => s.isLocked);
  const isReadOnly    = useRoomStore((s) => s.isReadOnly);

  // 文件选择输入框引用（图片）
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 文件选择输入框引用（.excalidraw 导入）
  const excalidrawInputRef = useRef<HTMLInputElement>(null);

  // 导入成功短暂提示
  const [importSuccess, setImportSuccess] = useState(false);
  // 导入错误提示
  const [importError, setImportError] = useState('');
  // AI 图形生成弹窗（REQ-027）
  const [showDiagramModal, setShowDiagramModal] = useState(false);

  /** 是否处于不可编辑状态 */
  const isDisabled = isLocked || isReadOnly;

  /**
   * 在画布视口中心创建文本卡片
   */
  const handleCreateTextCard = useCallback(() => {
    if (isDisabled) return;

    const centerX = -transform.scrollX + (window.innerWidth / 2) / transform.zoom;
    const centerY = -transform.scrollY + (window.innerHeight / 2) / transform.zoom;

    sendMessage('element_create', {
      type: 'text_card',
      payload: {
        x: Math.round(centerX - 120),
        y: Math.round(centerY - 80),
        width: 240,
        height: 160,
        content: '',
        font_size: 14,
        bg_color: '#FEF3C7',
        likes: 0,
        reactions: {},
      },
    });
  }, [isDisabled, transform, sendMessage]);

  /**
   * 触发图片选择
   */
  const handleImageUpload = useCallback(() => {
    if (isDisabled) return;
    fileInputRef.current?.click();
  }, [isDisabled]);

  /**
   * 处理图片文件选择
   */
  const handleFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // MIME 检查
      if (!IMAGE_MIMES.includes(file.type)) {
        alert('不支持的图片格式，请选择 JPG/PNG/GIF/WebP');
        return;
      }

      // 大小检查
      if (file.size > FILE_LIMITS.IMAGE_MAX_SIZE) {
        alert('图片大小不能超过 5MB');
        return;
      }

      const localUrl = URL.createObjectURL(file);
      const centerX = -transform.scrollX + (window.innerWidth / 2) / transform.zoom;
      const centerY = -transform.scrollY + (window.innerHeight / 2) / transform.zoom;

      sendMessage('element_create', {
        type: 'image_card',
        payload: {
          x: Math.round(centerX - 140),
          y: Math.round(centerY - 110),
          width: 280,
          height: 220,
          url: localUrl,
          caption: file.name,
          likes: 0,
        },
      });

      e.target.value = '';
    },
    [transform, sendMessage]
  );

  /**
   * 触发 .excalidraw 文件选择
   */
  const handleImportExcalidraw = useCallback(() => {
    if (isDisabled) return;
    setImportError('');
    excalidrawInputRef.current?.click();
  }, [isDisabled]);

  /**
   * 处理 .excalidraw 文件导入
   * .excalidraw 文件本质是 JSON，包含 elements、appState、files 字段
   * 解析后调用 excalidrawAPI.updateScene 合并到当前画布
   */
  const handleExcalidrawFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // 文件类型检查：允许 .excalidraw 和 .json
      const name = file.name.toLowerCase();
      if (!name.endsWith('.excalidraw') && !name.endsWith('.json')) {
        setImportError('请选择 .excalidraw 格式文件');
        e.target.value = '';
        return;
      }

      // 文件大小限制（10MB）
      if (file.size > 10 * 1024 * 1024) {
        setImportError('文件不能超过 10MB');
        e.target.value = '';
        return;
      }

      try {
        const text = await file.text();
        const parsed = JSON.parse(text);

        // 验证基本结构：必须有 elements 数组
        if (!parsed || !Array.isArray(parsed.elements)) {
          setImportError('文件格式不正确，缺少 elements 字段');
          e.target.value = '';
          return;
        }

        if (!excalidrawAPI) {
          setImportError('画布尚未初始化，请稍后重试');
          e.target.value = '';
          return;
        }

        // 获取当前画布元素
        const currentElements = excalidrawAPI.getSceneElements?.() || [];

        // 为导入的元素生成新 ID，避免与现有元素冲突
        const idMap = new Map<string, string>();
        const importedElements = parsed.elements
          .filter((el: any) => el && !el.isDeleted) // 过滤已删除的元素
          .map((el: any) => {
            const newId = `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            idMap.set(el.id, newId);
            return {
              ...el,
              id: newId,
              // 轻微偏移，避免完全重叠在现有内容上
              x: (el.x || 0) + 20,
              y: (el.y || 0) + 20,
            };
          });

        if (importedElements.length === 0) {
          setImportError('文件中没有可导入的元素');
          e.target.value = '';
          return;
        }

        // 合并现有元素和导入元素，调用 excalidrawAPI 更新场景
        excalidrawAPI.updateScene({
          elements: [...currentElements, ...importedElements],
        });

        // 显示成功提示
        setImportSuccess(true);
        setTimeout(() => setImportSuccess(false), 2500);

      } catch (err) {
        console.error('[导入] 解析失败:', err);
        setImportError('文件解析失败，请确认是有效的 .excalidraw 文件');
      } finally {
        e.target.value = '';
        // 3秒后清除错误
        setTimeout(() => setImportError(''), 3000);
      }
    },
    [excalidrawAPI]
  );

  /**
   * 缩放控制
   */
  const handleZoom = useCallback(
    (direction: 'in' | 'out' | 'reset') => {
      if (!excalidrawAPI) return;

      let newZoom: number;
      if (direction === 'reset') {
        newZoom = 1;
      } else if (direction === 'in') {
        newZoom = Math.min(transform.zoom * 1.2, CANVAS_CONFIG.MAX_ZOOM);
      } else {
        newZoom = Math.max(transform.zoom / 1.2, CANVAS_CONFIG.MIN_ZOOM);
      }

      try {
        excalidrawAPI.updateScene({
          appState: {
            zoom: { value: newZoom },
          },
        });
      } catch (err) {
        console.warn('[Toolbar] 缩放失败:', err);
      }
    },
    [excalidrawAPI, transform.zoom]
  );

  return (
    <>
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40"
        style={{ pointerEvents: 'auto' }}
      >
        {/* 错误提示浮层 */}
        {importError && (
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2
                          bg-red-500 text-white text-xs px-3 py-1.5 rounded-lg
                          whitespace-nowrap shadow-lg animate-fade-in">
            ⚠️ {importError}
          </div>
        )}

        <div className="flex items-center gap-1 bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200 px-2 py-1.5">

          {/* ===== 锁定/只读状态提示 ===== */}
          {isDisabled && (
            <div className="flex items-center gap-1 px-2 py-1 text-xs text-orange-600 bg-orange-50 rounded-lg mr-1">
              {isReadOnly ? (
                <>
                  <BookOpen size={12} />
                  <span>只读</span>
                </>
              ) : (
                <>
                  <Lock size={12} />
                  <span>已锁定</span>
                </>
              )}
            </div>
          )}

          {/* ===== 文本卡片按钮 ===== */}
          <button
            onClick={handleCreateTextCard}
            disabled={isDisabled}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium
                       hover:bg-amber-50 hover:text-amber-700 text-gray-600 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('canvas.textCard')}
          >
            <Type size={16} />
            <span className="hidden sm:inline">{t('canvas.textCard')}</span>
          </button>

          {/* ===== 图片上传按钮 ===== */}
          <button
            onClick={handleImageUpload}
            disabled={isDisabled}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium
                       hover:bg-green-50 hover:text-green-600 text-gray-600 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('canvas.imageCard')}
          >
            <ImagePlus size={16} />
            <span className="hidden sm:inline">{t('canvas.imageCard')}</span>
          </button>

          {/* ===== 导入 .excalidraw 文件（需求7）===== */}
          <button
            onClick={handleImportExcalidraw}
            disabled={isDisabled}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed
                       ${importSuccess
                         ? 'bg-green-50 text-green-600'
                         : 'hover:bg-purple-50 hover:text-purple-600 text-gray-600'
                       }`}
            title="导入 .excalidraw 文件"
          >
            {importSuccess ? (
              <>
                <Check size={16} className="text-green-500" />
                <span className="hidden sm:inline text-green-600">导入成功</span>
              </>
            ) : (
              <>
                <FolderOpen size={16} />
                <span className="hidden sm:inline">导入</span>
              </>
            )}
          </button>

          {/* ===== AI 图形生成（REQ-027）===== */}
          <button
            onClick={() => setShowDiagramModal(true)}
            disabled={isDisabled}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium
                       hover:bg-amber-50 hover:text-amber-600 text-gray-600 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
            title="AI 图形生成（思维导图/流程图等）"
          >
            <Sparkles size={16} />
            <span className="hidden sm:inline">AI图形</span>
          </button>

          {/* 隐藏的文件输入（图片）*/}
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_MIMES.join(',')}
            onChange={handleFileSelected}
            className="hidden"
          />

          {/* 隐藏的文件输入（.excalidraw 导入）*/}
          <input
            ref={excalidrawInputRef}
            type="file"
            accept=".excalidraw,.json"
            onChange={handleExcalidrawFileSelected}
            className="hidden"
          />

          {/* ===== 分隔线 ===== */}
          <div className="w-px h-6 bg-gray-200 mx-1" />

          {/* ===== 缩放控制 ===== */}
          <button
            onClick={() => handleZoom('out')}
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors"
            title="缩小"
          >
            <ZoomOut size={16} />
          </button>

          <button
            onClick={() => handleZoom('reset')}
            className="px-2 py-1 rounded-lg text-xs font-mono text-gray-500 hover:bg-gray-100 transition-colors min-w-[48px] text-center"
            title="重置缩放"
          >
            {Math.round(transform.zoom * 100)}%
          </button>

          <button
            onClick={() => handleZoom('in')}
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors"
            title="放大"
          >
            <ZoomIn size={16} />
          </button>
        </div>
      </div>

      {/* AI 图形生成弹窗（REQ-027）*/}
      {showDiagramModal && (
        <DiagramModal onClose={() => setShowDiagramModal(false)} />
      )}
    </>
  );
};

export default Toolbar;
