// =============================================================
// MindCanvas v3.0 - 画布 DOM 覆盖层（3A-1：支持__delete标记）
// REQ-003修复：widget_submit 字段名 action → action_type，与后端 handleWidgetSubmit 对齐
//   - 旧代码发送 {action} 字段，后端期望 {action_type}，导致投票/词云/问答提交
//     在后端 switch 中匹配 default 分支被丢弃，教师端始终 0 票
//   - 修复后与 FloatingWidgets.tsx 保持一致
// =============================================================
import React, { useMemo, useCallback, useRef, useState } from 'react';
import CardRenderer from '@/components/cards/CardRenderer';
import { WidgetRegistry } from '@/registry/WidgetRegistry';
import FallbackWidget from '@/components/widgets/FallbackWidget';
import { useRoomStore } from '@/store/roomStore';
import { useCanvasStore } from '@/store/canvasStore';
import type { CanvasElement } from '@/types/canvas';
import { ELEMENT_TYPES } from '@/utils/constants';

interface CanvasOverlayProps {
  elements: CanvasElement[];
  overlayStyle: React.CSSProperties;
  sendMessage: (type: string, payload: Record<string, any>) => void;
  isTeacher: boolean;
  isLocked: boolean;
  isReadOnly: boolean;
}

const CARD_TYPES: Set<string> = new Set([ELEMENT_TYPES.TEXT_CARD, ELEMENT_TYPES.IMAGE_CARD, ELEMENT_TYPES.VIDEO_CARD, ELEMENT_TYPES.FILE_CARD]);
const WIDGET_TYPES: Set<string> = new Set([ELEMENT_TYPES.POLLING_WIDGET, ELEMENT_TYPES.WORDCLOUD_WIDGET, ELEMENT_TYPES.QA_WIDGET]);
const SKIP_TYPES: Set<string> = new Set([ELEMENT_TYPES.EXCALIDRAW_STROKE]);

const CanvasOverlay: React.FC<CanvasOverlayProps> = ({ elements, overlayStyle, sendMessage, isTeacher, isLocked, isReadOnly }) => {
  const updateElement = useRoomStore((s) => s.updateElement);
  const removeElement = useRoomStore((s) => s.removeElement);
  const zoom = useCanvasStore((s) => s.transform.zoom);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; elemX: number; elemY: number } | null>(null);

  const visibleElements = useMemo(() => elements.filter((el) => !el.is_deleted && !SKIP_TYPES.has(el.type)), [elements]);

  // ⭐ 更新元素：处理__delete标记
  const handleElementUpdate = useCallback((elementId: string, payload: Record<string, any>) => {
    if (payload?.__delete) {
      removeElement(elementId);
      sendMessage('element_delete', { id: elementId });
      return;
    }
    updateElement(elementId, payload);
    sendMessage('element_update', { id: elementId, payload });
  }, [updateElement, removeElement, sendMessage]);

  const handleElementDelete = useCallback((elementId: string) => {
    removeElement(elementId); sendMessage('element_delete', { id: elementId });
  }, [removeElement, sendMessage]);

  // REQ-003修复：字段名 action → action_type，与后端 handleWidgetSubmit 解析的 json:"action_type" 对齐
  const handleWidgetSubmit = useCallback((elementId: string, action: string, data: Record<string, any>) => {
    sendMessage('widget_submit', { element_id: elementId, action_type: action, data });
  }, [sendMessage]);

  const handleCardLike = useCallback((elementId: string) => { sendMessage('card_like', { element_id: elementId }); }, [sendMessage]);

  // 拖拽
  const handleDragStart = useCallback((e: React.MouseEvent, elementId: string, elemX: number, elemY: number) => {
    if (isLocked || isReadOnly) return;
    e.preventDefault(); e.stopPropagation();
    setDragging(elementId);
    dragStartRef.current = { x: e.clientX, y: e.clientY, elemX, elemY };
    const handleMove = (me: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = (me.clientX - dragStartRef.current.x) / zoom;
      const dy = (me.clientY - dragStartRef.current.y) / zoom;
      updateElement(elementId, { x: Math.round(dragStartRef.current.elemX + dx), y: Math.round(dragStartRef.current.elemY + dy) });
    };
    const handleUp = (me: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = (me.clientX - dragStartRef.current.x) / zoom;
      const dy = (me.clientY - dragStartRef.current.y) / zoom;
      const newX = Math.round(dragStartRef.current.elemX + dx);
      const newY = Math.round(dragStartRef.current.elemY + dy);
      const el = elements.find(e => e.id === elementId);
      if (el) sendMessage('element_update', { id: elementId, payload: { ...el.payload, x: newX, y: newY } });
      setDragging(null); dragStartRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [isLocked, isReadOnly, zoom, elements, sendMessage, updateElement]);

  return (
    <div style={overlayStyle}>
      {visibleElements.map((element) => {
        const { x = 0, y = 0, width = 300 } = element.payload || {};
        return (
          <div key={element.id} data-card-id={element.id} style={{ position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${width}px`, minHeight: '50px', pointerEvents: 'auto', cursor: dragging === element.id ? 'grabbing' : 'default' }}>
            {/* 拖拽把手 */}
            {isTeacher && !isLocked && !isReadOnly && (
              <div onMouseDown={(e) => handleDragStart(e, element.id, x, y)}
                style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', width: 48, height: 14, cursor: 'grab', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                className="opacity-0 hover:opacity-100 transition-opacity">
                <div className="w-10 h-1.5 bg-gray-400 rounded-full" />
              </div>
            )}
            {CARD_TYPES.has(element.type) ? (
              <CardRenderer element={element} isTeacher={isTeacher} isLocked={isLocked || isReadOnly}
                onUpdate={(p) => handleElementUpdate(element.id, p)} onDelete={() => handleElementDelete(element.id)} onLike={() => handleCardLike(element.id)} />
            ) : WIDGET_TYPES.has(element.type) || WidgetRegistry.isRegistered(element.type) ? (
              (() => {
                const W = WidgetRegistry.getComponent(element.type);
                return W ? <W id={element.id} payload={element.payload} isTeacher={isTeacher} isLocked={isLocked || isReadOnly} onUpdate={(p) => handleElementUpdate(element.id, p)} onSubmit={(a, d) => handleWidgetSubmit(element.id, a, d)} />
                  : <FallbackWidget id={element.id} payload={element.payload} isTeacher={isTeacher} isLocked={isLocked || isReadOnly} onUpdate={(p) => handleElementUpdate(element.id, p)} />;
              })()
            ) : (
              <FallbackWidget id={element.id} payload={element.payload} isTeacher={isTeacher} isLocked={isLocked || isReadOnly} onUpdate={(p) => handleElementUpdate(element.id, p)} />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default CanvasOverlay;
