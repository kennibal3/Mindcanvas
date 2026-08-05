// =============================================================
// MindCanvas v4.3 - 互动组件工具栏
// REQ-011修复：新建Widget时自动避开已有Widget位置，防止重叠
//   - 查询当前已有Widget的x坐标，新Widget创建在最右侧+间距
//   - 超出视口宽度时换行（y坐标偏移）
// =============================================================
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WidgetRegistry } from '@/registry/WidgetRegistry';
import { useCanvasStore } from '@/store/canvasStore';
import { useRoomStore } from '@/store/roomStore';
import PollingCreateModal, { type PollingConfig } from '@/components/widgets/PollingCreateModal';
import WordCloudCreateModal, { type WordCloudConfig } from '@/components/widgets/WordCloudCreateModal';
import QACreateModal, { type QAInitPayload } from '@/components/widgets/QACreateModal';
import { DropZoneCreateModal } from '@/components/widgets/DropZoneCreateModal';
import { ShelfCreateModal } from '@/components/widgets/ShelfCreateModal';
import HtmlCreateModal from '@/components/widgets/HtmlCreateModal';
import type { DropzonePayload } from '@/types/widget';

// Widget类型集合，用于过滤现有Widget
const WIDGET_TYPES = new Set([
  'polling_widget', 'wordcloud_widget', 'qa_widget', 'dropzone_widget', 'shelf_widget',
  'html_widget',
]);

// Widget默认尺寸
const WIDGET_SIZES: Record<string, { w: number; h: number }> = {
  polling_widget:   { w: 380, h: 420 },
  wordcloud_widget: { w: 360, h: 380 },
  qa_widget:        { w: 360, h: 400 },
  dropzone_widget:  { w: 420, h: 500 },
  html_widget:      { w: 480, h: 360 },
};

// Widget之间的最小间距（画布坐标单位）
const WIDGET_GAP = 30;

interface WidgetToolbarProps {
  roomId: string;
  sendMessage: (type: string, payload: Record<string, unknown>) => void;
  isLocked: boolean;
  isReadOnly: boolean;
}

const WidgetToolbar: React.FC<WidgetToolbarProps> = ({
  roomId, sendMessage, isLocked, isReadOnly,
}) => {
  const { t } = useTranslation();
  const transform  = useCanvasStore((s) => s.transform);
  const elements   = useRoomStore((s) => s.elements);

  const [showPollingModal, setShowPollingModal]     = useState(false);
  const [showWordCloudModal, setShowWordCloudModal] = useState(false);
  const [showQAModal, setShowQAModal]               = useState(false);
  const [showDropzoneModal, setShowDropzoneModal]   = useState(false);
  const [showShelfModal, setShowShelfModal]         = useState(false);
  const [showHtmlModal, setShowHtmlModal]           = useState(false);

  // REQ-041：只显示可插入的组件（dropzone_widget 已设 insertable:false，被 HTML 展示组件替代）
  const widgetMetas = WidgetRegistry.getAllMetas().filter(m => m.insertable !== false);

  // 计算画布中心坐标（屏幕中心 → 画布坐标）
  const getCanvasCenter = useCallback(() => {
    const cx = -transform.scrollX + (window.innerWidth / 2 - 150) / transform.zoom;
    const cy = -transform.scrollY + (window.innerHeight / 2) / transform.zoom;
    return { cx, cy };
  }, [transform]);

  // REQ-011：计算新Widget的非重叠位置
  // 策略：找到现有所有Widget中x+width最大值，在其右侧+gap放置
  // 若超出当前视口右边界，则换行（y+=height+gap，x回到最左侧Widget的x）
  const calcNonOverlapPosition = useCallback((
    widgetType: string,
  ): { x: number; y: number } => {
    const { cx, cy } = getCanvasCenter();
    const { w: newW, h: newH } = WIDGET_SIZES[widgetType] || { w: 380, h: 420 };

    // 过滤现有未删除的Widget
    const existingWidgets = elements.filter(
      (el) => !el.is_deleted && WIDGET_TYPES.has(el.type)
    );

    if (existingWidgets.length === 0) {
      // 没有已有Widget，放在画布中心
      return { x: cx - newW / 2, y: cy - newH / 2 };
    }

    // 找到最右侧Widget的右边界（x + width）
    let maxRight = -Infinity;
    let baseY    = cy - newH / 2;

    for (const el of existingWidgets) {
      const p   = el.payload as any;
      const elX = typeof p?.x === 'number' ? p.x : 0;
      const elW = typeof p?.width === 'number' ? p.width : 380;
      const elY = typeof p?.y === 'number' ? p.y : 0;
      const elH = typeof p?.height === 'number' ? p.height : 420;
      const right = elX + elW;
      if (right > maxRight) {
        maxRight = right;
        baseY    = elY; // 与最右侧Widget同行
      }
    }

    // 新Widget放在最右侧右边+gap
    const newX = maxRight + WIDGET_GAP;
    const newY = baseY;

    // 判断是否超出当前视口右边界（画布坐标）
    const viewportRightInCanvas = -transform.scrollX + window.innerWidth / transform.zoom;
    if (newX + newW > viewportRightInCanvas) {
      // 超出视口，换行：找Y方向最底部，在下方创建
      let maxBottom = -Infinity;
      let leftmostX = Infinity;
      for (const el of existingWidgets) {
        const p    = el.payload as any;
        const elX  = typeof p?.x === 'number' ? p.x : 0;
        const elY  = typeof p?.y === 'number' ? p.y : 0;
        const elH  = typeof p?.height === 'number' ? p.height : 420;
        const bottom = elY + elH;
        if (bottom > maxBottom) maxBottom = bottom;
        if (elX < leftmostX) leftmostX = elX;
      }
      return {
        x: leftmostX,
        y: maxBottom + WIDGET_GAP,
      };
    }

    return { x: newX, y: newY };
  }, [elements, getCanvasCenter, transform]);

  // 通用：发送 element_create 消息
  const createWidget = useCallback((
    type: string,
    payload: Record<string, unknown>,
    width?: number,
    height?: number,
  ) => {
    const sizes = WIDGET_SIZES[type] || { w: width || 380, h: height || 420 };
    const w = width  || sizes.w;
    const h = height || sizes.h;
    const { x, y } = calcNonOverlapPosition(type);

    sendMessage('element_create', {
      type,
      x,
      y,
      width:  w,
      height: h,
      payload,
    });
  }, [calcNonOverlapPosition, sendMessage]);

  // 工具栏按钮点击 → 打开对应弹窗
  const handleClickWidget = useCallback((type: string) => {
    if (type === 'polling_widget')   { setShowPollingModal(true);   return; }
    if (type === 'wordcloud_widget') { setShowWordCloudModal(true); return; }
    if (type === 'qa_widget')        { setShowQAModal(true);        return; }
    if (type === 'dropzone_widget')  { setShowDropzoneModal(true);  return; }
    if (type === 'shelf_widget')     { setShowShelfModal(true);     return; }
    if (type === 'html_widget')      { setShowHtmlModal(true);      return; }
  }, []);

  // REQ-041：HTML 展示组件不走 element_create（源码不能进 payload），
  // 改为 POST /html-widget：后端建元素 + 存源码 + 广播 element_create，组件随广播出现在画布。
  const handleCreateHtml = useCallback(async (title: string, html: string) => {
    const { w, h } = WIDGET_SIZES.html_widget;
    const { x, y } = calcNonOverlapPosition('html_widget');
    try {
      const res = await fetch(`/api/rooms/${roomId}/html-widget`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, html, x, y, width: w, height: h }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error || '创建失败');
      }
      setShowHtmlModal(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : '创建 HTML 组件失败');
    }
  }, [roomId, calcNonOverlapPosition]);

  // REQ-059：zip 课件导入。走 multipart 到 /courseware，后端解压 + 建元素 + 挂接 + 广播，
  // 与 handleCreateHtml 是同一套「后端建元素再广播」的模式，只是载荷从 JSON 换成文件。
  //
  // 刻意**不在这里 catch**：错误要抛回弹窗，由它就地显示后端给的具体原因
  // （没有 index.html / 含越界条目 / 超限）。用 alert 弹一句「导入失败」
  // 等于把后端辛苦区分出来的原因全丢掉。
  const handleCreateHtmlZip = useCallback(async (title: string, file: File) => {
    const { w, h } = WIDGET_SIZES.html_widget;
    const { x, y } = calcNonOverlapPosition('html_widget');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', title);
    fd.append('x', String(x));
    fd.append('y', String(y));
    // 课件多为整页 16:9，比粘贴源码的默认尺寸给大一些，省得老师每次手动拉
    fd.append('width', String(Math.max(w, 720)));
    fd.append('height', String(Math.max(h, 460)));

    const res = await fetch(`/api/rooms/${roomId}/courseware`, {
      method: 'POST',
      credentials: 'include',
      body: fd, // 不要手写 Content-Type，浏览器要自己带 multipart boundary
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error((e as { error?: string }).error || '导入失败');
    }
    setShowHtmlModal(false);
  }, [roomId, calcNonOverlapPosition]);

  const handleCreatePolling = useCallback((config: PollingConfig) => {
    createWidget('polling_widget', {
      question:     config.question,
      options:      config.options,
      mode:         config.mode,
      chart_type:   config.chart_type ?? 'bar',
      anonymous:    config.anonymous ?? false,
      showResult:   true,
      show_result:  true,
      allowChange:  false,
      status:       'draft',
      votes:        {},
      total_voters: 0,
      deadline:     config.deadline,
    });
    setShowPollingModal(false);
  }, [createWidget]);

  const handleCreateWordCloud = useCallback((config: WordCloudConfig) => {
    createWidget('wordcloud_widget', {
      prompt:                config.prompt,
      max_words_per_student: config.max_words_per_student,
      anonymous:             config.is_anonymous,
      is_anonymous:          config.is_anonymous,
      words:                 {},
      status:                'draft',
    });
    setShowWordCloudModal(false);
  }, [createWidget]);

  const handleCreateQA = useCallback((payload: QAInitPayload) => {
    createWidget('qa_widget', {
      question:        payload.question,
      options:         payload.options,
      correctIdx:      payload.correctIdx,
      explanation:     payload.explanation ?? '',
      status:          'draft',
      showResult:      false,
      showExplanation: false,
      stats:           {},
    });
    setShowQAModal(false);
  }, [createWidget]);

  const handleCreateShelf = useCallback((config: {
    title: string; status: 'open';
    topic_text: string;
    topic_image_url?: string;
    topic_link_url?: string;
    topic_link_title?: string;
    allow_types: ('text' | 'image' | 'link')[];
  }) => {
    // REQ-036：协作墙改为"主题+回复"模式，创建时把主题内容一并写入 payload；
    // 默认尺寸从 500x420 放大到 900x640——一个主题+多条回复留言流，
    // 比其他互动组件需要的展示空间大不少。
    createWidget('shelf_widget', {
      title:            config.title,
      status:           config.status,
      topic_text:       config.topic_text,
      topic_image_url:  config.topic_image_url,
      topic_link_url:   config.topic_link_url,
      topic_link_title: config.topic_link_title,
      allow_types:      config.allow_types,
    }, 900, 640);
    setShowShelfModal(false);
  }, [createWidget]);

  const handleCreateDropzone = useCallback((dzPayload: DropzonePayload) => {
    createWidget('dropzone_widget', dzPayload as unknown as Record<string, unknown>);
    setShowDropzoneModal(false);
  }, [createWidget]);

  if (isLocked || isReadOnly) return null;

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        {widgetMetas.map(meta => (
          <button
            key={meta.type}
            onClick={() => handleClickWidget(meta.type)}
            title={meta.description}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                       bg-white border border-gray-200 text-gray-700
                       hover:bg-amber-50 hover:border-amber-300 hover:text-amber-800
                       transition-colors shadow-sm"
          >
            <span>{meta.icon}</span>
            <span>{meta.label}</span>
          </button>
        ))}
      </div>

      {showPollingModal && (
        <PollingCreateModal
          onCreate={handleCreatePolling}
          onClose={() => setShowPollingModal(false)}
        />
      )}

      {showWordCloudModal && (
        <WordCloudCreateModal
          onCreate={handleCreateWordCloud}
          onClose={() => setShowWordCloudModal(false)}
        />
      )}

      {showQAModal && (
        <QACreateModal
          onConfirm={handleCreateQA}
          onClose={() => setShowQAModal(false)}
        />
      )}

      {showShelfModal && (
        <ShelfCreateModal
          onCreate={handleCreateShelf}
          onClose={() => setShowShelfModal(false)}
        />
      )}
      {showDropzoneModal && (
        <DropZoneCreateModal
          onConfirm={handleCreateDropzone}
          onClose={() => setShowDropzoneModal(false)}
        />
      )}
      {showHtmlModal && (
        <HtmlCreateModal
          onConfirm={handleCreateHtml}
          onConfirmZip={handleCreateHtmlZip}
          onClose={() => setShowHtmlModal(false)}
        />
      )}
    </>
  );
};

export default WidgetToolbar;
