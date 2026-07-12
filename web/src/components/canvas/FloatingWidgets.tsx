// =============================================================
// MindCanvas v4.3 - 浮动 Widget 层
//
// 缩放方案：
//   容器宽度固定为画布原始尺寸（width px，不乘 zoom）
//   通过 transform: scale(zoom) + transform-origin: top left 等比缩放
//   这样 Widget 内部所有字体、间距、按钮都等比缩小，不会变成长条形
//
// 定位公式（Excalidraw 官方）：
//   viewportX = (sceneX + scrollX) * zoom
//   viewportY = (sceneY + scrollY) * zoom
//
// 挂载方式：position:fixed 脱离父容器 overflow:hidden 裁剪
//   顶部偏移 HEADER_HEIGHT = 44px（顶部导航栏）
//
// V4.3-STABLE：handleElementUpdate 阻断三层嵌套
// =============================================================
import React, { useMemo, useCallback, useRef, useState } from 'react';
import { WidgetRegistry } from '@/registry/WidgetRegistry';
import FallbackWidget from '@/components/widgets/FallbackWidget';
import ShelfWidget from '@/components/widgets/ShelfWidget';
import { useRoomStore } from '@/store/roomStore';
import { useCanvasStore } from '@/store/canvasStore';
import type { CanvasElement } from '@/types/canvas';
import { ELEMENT_TYPES } from '@/utils/constants';

interface FloatingWidgetsProps {
  roomId: string;
  elements: CanvasElement[];
  sendMessage: (type: string, payload: Record<string, any>) => void;
  isTeacher: boolean;
  isLocked: boolean;
  isReadOnly: boolean;
}

const OVERLAY_TYPES: ReadonlySet<string> = new Set<string>([
  ELEMENT_TYPES.POLLING_WIDGET,
  ELEMENT_TYPES.WORDCLOUD_WIDGET,
  ELEMENT_TYPES.QA_WIDGET,
  ELEMENT_TYPES.DROPZONE,
  ELEMENT_TYPES.DROPZONE_WIDGET,
  // BUG-007 修复（2026-07-10，commit fe2aaf8）：渲染白名单必须包含 'shelf_widget'，
  // 否则协作墙元素能正常建库/广播，却在这一步被过滤掉、永远进不了浮层渲染循环。
  // 本条是在 REQ-035-a 里踩回的坑——用来编辑的本地文件副本是 BUG-004 诊断阶段拉取的
  // 旧版本，没跟上 BUG-007 之后的修复，直接改完推回服务器等于把这行白名单条目覆盖没了。
  'shelf_widget',
  // REQ-041：HTML 展示组件也走浮层渲染，加入白名单后自动继承 035-c 缩放（scale 容器 + 右下角把手）
  ELEMENT_TYPES.HTML_WIDGET,
]);

// 顶部导航栏高度（px），与 RoomPage main.top 一致
const HEADER_HEIGHT = 44;

// REQ-035-c：缩放尺寸边界（画布坐标单位，不随 zoom 变化）
// 最小值兜底各 Widget 的 minHeight（词云 260），协作墙默认 900x640 内容密度高、下限单独放宽
const RESIZE_MIN_DEFAULT = { w: 260, h: 260 };
const RESIZE_MIN_SHELF   = { w: 480, h: 360 };
const RESIZE_MAX         = { w: 1600, h: 1200 };

function clampSize(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ===== 坐标与 payload 工具函数 =====

function extractPosition(p: Record<string, any>): {
  x: number; y: number; width: number; height: number;
} {
  return {
    x:      typeof p.x      === 'number' ? p.x      : 0,
    y:      typeof p.y      === 'number' ? p.y      : 0,
    width:  typeof p.width  === 'number' ? p.width  : 360,
    height: typeof p.height === 'number' ? p.height : 380,
  };
}

function extractBusinessFields(p: Record<string, any>): Record<string, any> {
  const inner = p?.payload;
  if (
    inner !== null && inner !== undefined &&
    typeof inner === 'object' && !Array.isArray(inner)
  ) {
    const { x: _x, y: _y, width: _w, height: _h, id: _id, type: _t, payload: _p, ...business } = inner as any;
    return business;
  }
  const { x: _x, y: _y, width: _w, height: _h, id: _id, type: _t, payload: _p, ...business } = p as any;
  return business;
}

/**
 * 将外层 payload 与 patch 合并为标准两层结构：
 *   外层：{ x, y, width, height }
 *   内层：{ payload: { ...业务字段 } }
 * 阻断三层嵌套。
 */
function buildStandardPayload(
  currentOuterPayload: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const pos             = extractPosition(currentOuterPayload);
  const currentBusiness = extractBusinessFields(currentOuterPayload);

  let patchBusiness: Record<string, any>;
  const patchInner = patch?.payload;
  if (
    patchInner !== null && patchInner !== undefined &&
    typeof patchInner === 'object' && !Array.isArray(patchInner)
  ) {
    const { x: _x, y: _y, width: _w, height: _h, id: _id, type: _t, payload: _p, ...patchOther } = patch as any;
    const { x: __x, y: __y, width: __w, height: __h, id: __id, type: __t, ...innerBusiness } = patchInner as any;
    patchBusiness = { ...patchOther, ...innerBusiness };
  } else {
    const { x: _x, y: _y, width: _w, height: _h, id: _id, type: _t, payload: _p, ...patchOther } = patch as any;
    patchBusiness = patchOther;
  }

  return {
    ...pos,
    payload: { ...currentBusiness, ...patchBusiness },
  };
}

// ===== 主组件 =====
const FloatingWidgets: React.FC<FloatingWidgetsProps> = ({
  elements, sendMessage, isTeacher, isLocked, isReadOnly, roomId,
}) => {
  const updateElement = useRoomStore((s) => s.updateElement);
  const removeElement = useRoomStore((s) => s.removeElement);
  const transform     = useCanvasStore((s) => s.transform);

  const [dragging, setDragging] = useState<string | null>(null);
  const dragStartRef = useRef<{
    mouseX: number; mouseY: number; elemX: number; elemY: number;
  } | null>(null);

  // REQ-035-c：右下角缩放把手状态
  const [resizing, setResizing] = useState<string | null>(null);
  const resizeStartRef = useRef<{
    mouseX: number; mouseY: number; elemW: number; elemH: number;
  } | null>(null);

  // 只渲染 Widget 类型的元素，排除已删除
  const floatingElements = useMemo(
    () => elements.filter(el => !el.is_deleted && OVERLAY_TYPES.has(el.type)),
    [elements],
  );

  /**
   * 处理 Widget 内部发出的 payload 更新。
   * 维持标准两层结构，阻断三层嵌套。
   */
  const handleElementUpdate = useCallback((elementId: string, patch: Record<string, any>) => {
    if (patch?.__delete) {
      removeElement(elementId);
      sendMessage('element_delete', { id: elementId });
      return;
    }
    const currentEl     = useRoomStore.getState().elements.find(el => el.id === elementId);
    const mergedPayload = buildStandardPayload(currentEl?.payload ?? {}, patch);
    updateElement(elementId, mergedPayload);
    sendMessage('element_update', { id: elementId, type: currentEl?.type ?? '', payload: mergedPayload });
  }, [updateElement, removeElement, sendMessage]);

  /**
   * 处理 Widget 内部的互动提交（投票/词云/问答/作品墙）。
   */
  const handleWidgetSubmit = useCallback((elementId: string, action: string, data: Record<string, any>) => {
    if (action === 'dropzone_submit') {
      sendMessage('dropzone_submit', { element_id: elementId, ...data });
      return;
    }
    if (action === 'dropzone_action') {
      sendMessage('dropzone_action', { element_id: elementId, ...data });
      return;
    }
    sendMessage('widget_submit', { element_id: elementId, action_type: action, data });
  }, [sendMessage]);

  /**
   * 拖拽把手：鼠标按下记录起始位置，移动时更新画布坐标，
   * 抬起时广播 element_update。
   * 屏幕位移转画布坐标需除以 zoom。
   */
  const handleDragStart = useCallback((
    e: React.MouseEvent, elementId: string, elemX: number, elemY: number,
  ) => {
    if (isLocked || isReadOnly) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(elementId);
    dragStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, elemX, elemY };
    // 拖拽开始时快照 zoom，避免拖拽过程中 zoom 变化导致偏移错误
    const z = useCanvasStore.getState().transform.zoom;

    const handleMove = (me: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = (me.clientX - dragStartRef.current.mouseX) / z;
      const dy = (me.clientY - dragStartRef.current.mouseY) / z;
      // 拖拽过程中只更新本地 store，不广播（减少网络消息）
      updateElement(elementId, {
        x: Math.round(dragStartRef.current.elemX + dx),
        y: Math.round(dragStartRef.current.elemY + dy),
      });
    };

    const handleUp = (me: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = (me.clientX - dragStartRef.current.mouseX) / z;
      const dy = (me.clientY - dragStartRef.current.mouseY) / z;
      const newX = Math.round(dragStartRef.current.elemX + dx);
      const newY = Math.round(dragStartRef.current.elemY + dy);
      const currentEl = useRoomStore.getState().elements.find(el => el.id === elementId);
      if (currentEl) {
        // 抬起时才广播最终位置
        const newPayload = {
          ...extractPosition(currentEl.payload ?? {}),
          x: newX,
          y: newY,
          payload: extractBusinessFields(currentEl.payload ?? {}),
        };
        updateElement(elementId, newPayload);
        sendMessage('element_update', { id: elementId, payload: newPayload });
      }
      setDragging(null);
      dragStartRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [isLocked, isReadOnly, sendMessage, updateElement]);

  /**
   * REQ-035-c：右下角缩放把手。交互模式与移动把手完全一致——
   * 按下快照 zoom 与起始宽高；拖动中屏幕位移除以 zoom 得画布尺寸增量，
   * 只更新本地 store 即时预览；抬起时按标准两层结构广播 element_update。
   * 尺寸夹在 RESIZE_MIN/MAX 之间（协作墙下限单独放宽）。
   */
  const handleResizeStart = useCallback((
    e: React.MouseEvent, elementId: string, elemType: string, elemW: number, elemH: number,
  ) => {
    if (isLocked || isReadOnly) return;
    e.preventDefault();
    e.stopPropagation();
    setResizing(elementId);
    resizeStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, elemW, elemH };
    // 快照 zoom，避免缩放过程中画布 zoom 变化导致尺寸跳变
    const z = useCanvasStore.getState().transform.zoom;
    const min = elemType === 'shelf_widget' ? RESIZE_MIN_SHELF : RESIZE_MIN_DEFAULT;

    const calcSize = (me: MouseEvent) => {
      const dw = (me.clientX - resizeStartRef.current!.mouseX) / z;
      const dh = (me.clientY - resizeStartRef.current!.mouseY) / z;
      return {
        w: Math.round(clampSize(resizeStartRef.current!.elemW + dw, min.w, RESIZE_MAX.w)),
        h: Math.round(clampSize(resizeStartRef.current!.elemH + dh, min.h, RESIZE_MAX.h)),
      };
    };

    const handleMove = (me: MouseEvent) => {
      if (!resizeStartRef.current) return;
      const { w, h } = calcSize(me);
      // 拖动过程中只更新本地 store，不广播（与移动把手同策略）
      updateElement(elementId, { width: w, height: h });
    };

    const handleUp = (me: MouseEvent) => {
      if (!resizeStartRef.current) return;
      const { w, h } = calcSize(me);
      const currentEl = useRoomStore.getState().elements.find(el => el.id === elementId);
      if (currentEl) {
        // 抬起时才广播最终尺寸（标准两层结构，同移动把手的 handleUp）
        const newPayload = {
          ...extractPosition(currentEl.payload ?? {}),
          width: w,
          height: h,
          payload: extractBusinessFields(currentEl.payload ?? {}),
        };
        updateElement(elementId, newPayload);
        sendMessage('element_update', { id: elementId, payload: newPayload });
      }
      setResizing(null);
      resizeStartRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [isLocked, isReadOnly, sendMessage, updateElement]);

  if (floatingElements.length === 0) return null;

  const { scrollX, scrollY, zoom } = transform;

  return (
    <>
      {/* REQ-041：拖拽/缩放时铺一层透明护罩，防止 html_widget 的 iframe 吞掉 mousemove
          导致拖动/缩放卡顿（iframe 会截获鼠标事件，父页面 document 监听收不到）。
          z-index 25 在 Widget 容器(20)之上、把手(30)之下——把手的监听已挂 document，不受影响。 */}
      {(dragging || resizing) && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 25,
            cursor: resizing ? 'nwse-resize' : 'grabbing',
          }}
        />
      )}
      {floatingElements.map(element => {
        const outerPayload = element.payload || {};

        // 画布坐标（原始尺寸，不乘 zoom）
        const x      = typeof outerPayload.x      === 'number' ? outerPayload.x      : 0;
        const y      = typeof outerPayload.y      === 'number' ? outerPayload.y      : 0;
        const width  = typeof outerPayload.width  === 'number' ? outerPayload.width  : 360;
        const height = typeof outerPayload.height === 'number' ? outerPayload.height : 380;

        // 屏幕坐标：Excalidraw 官方公式 viewportCoord = (sceneCoord + scroll) * zoom
        // position:fixed 相对于视口，需加上顶部导航栏高度
        const screenX = (x + scrollX) * zoom;
        const screenY = (y + scrollY) * zoom + HEADER_HEIGHT;

        // 缩放后的屏幕占位尺寸（用于外层容器占位，防止布局错误）
        const screenW = width  * zoom;
        const screenH = height * zoom;

        return (
          <div
            key={element.id}
            style={{
              // 外层容器：占据缩放后的屏幕空间
              position:      'fixed',
              left:          `${screenX}px`,
              top:           `${screenY}px`,
              width:         `${screenW}px`,
              height:        `${screenH}px`,
              zIndex:        20,
              pointerEvents: 'none',       // 外层不捕获事件，由内层 scale 容器处理
              overflow:      'visible',
              userSelect:    dragging === element.id || resizing === element.id ? 'none' : undefined,
            }}
          >
            {/* 拖拽把手：放在 scale 容器外层，避免把手本身也被缩放 */}
            {isTeacher && !isLocked && !isReadOnly && (
              <div
                onMouseDown={(e) => handleDragStart(e, element.id, x, y)}
                style={{
                  position:       'absolute',
                  top:            -24,
                  left:           '50%',
                  transform:      'translateX(-50%)',
                  width:          90,
                  height:         24,
                  cursor:         dragging === element.id ? 'grabbing' : 'grab',
                  zIndex:         30,
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  pointerEvents:  'auto',  // 把手需要捕获鼠标事件
                }}
                className="opacity-50 hover:opacity-100 transition-opacity"
              >
                <div className="w-16 h-2 bg-gray-400 rounded-full" />
              </div>
            )}

            {/* REQ-035-c：右下角缩放把手（教师专属，放 scale 容器外不被缩放，
                定位用 screenW/screenH 跟随缩放后的实际角点） */}
            {isTeacher && !isLocked && !isReadOnly && (
              <div
                onMouseDown={(e) => handleResizeStart(e, element.id, element.type, width, height)}
                style={{
                  position:       'absolute',
                  left:           `${screenW - 8}px`,
                  top:            `${screenH - 8}px`,
                  width:          20,
                  height:         20,
                  cursor:         'nwse-resize',
                  zIndex:         30,
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  pointerEvents:  'auto',
                }}
                className="opacity-50 hover:opacity-100 transition-opacity"
              >
                <div className="w-3 h-3 border-r-2 border-b-2 border-gray-400 rounded-br-md" />
              </div>
            )}

            {/*
              缩放容器：
              - 保持原始画布尺寸（width x height px）
              - 通过 CSS transform scale(zoom) 等比缩放整个 Widget
              - transform-origin: top left 确保缩放基准与定位左上角一致
              - 缩放后视觉尺寸 = width*zoom x height*zoom，与外层容器一致
            */}
            <div
              style={{
                position:        'absolute',
                top:             0,
                left:            0,
                width:           `${width}px`,
                height:          `${height}px`,
                transform:       `scale(${zoom})`,
                transformOrigin: 'top left',
                pointerEvents:   'auto',   // 内层捕获所有交互事件
              }}
            >
              {(() => {
                if (element.type === 'shelf_widget') {
                  const currentUserUUID = useRoomStore.getState().currentUserUUID;
                  const innerPayload = element.payload?.payload && typeof element.payload.payload === 'object'
                    ? element.payload.payload
                    : element.payload;
                  return (
                    <ShelfWidget
                      elementId={element.id}
                      roomId={roomId}
                      payload={innerPayload}
                      isTeacher={isTeacher}
                      studentUUID={isTeacher ? undefined : currentUserUUID}
                      onUpdate={(p) => handleElementUpdate(element.id, { payload: p })}
                      // REQ-035-a：单独传 onDelete 而不是让 ShelfWidget 复用 onUpdate({__delete:true})——
                      // 上面这个 onUpdate 会把参数包进 { payload: p }，__delete 标记会被包在 payload 里，
                      // 对不上 handleElementUpdate 检查 patch?.__delete 的顶层位置，直接复用会导致删除不生效。
                      onDelete={() => handleElementUpdate(element.id, { __delete: true })}
                    />
                  );
                }
                const W = WidgetRegistry.getComponent(element.type);
                if (W) {
                  return (
                    <W
                      id={element.id}
                      payload={element.payload}
                      isTeacher={isTeacher}
                      isLocked={isLocked || isReadOnly}
                      onUpdate={(p) => handleElementUpdate(element.id, p)}
                      onSubmit={(a, d) => handleWidgetSubmit(element.id, a, d)}
                    />
                  );
                }
                return (
                  <FallbackWidget
                    id={element.id}
                    payload={element.payload}
                    isTeacher={isTeacher}
                    isLocked={isLocked || isReadOnly}
                    onUpdate={(p) => handleElementUpdate(element.id, p)}
                  />
                );
              })()}
            </div>
          </div>
        );
      })}
    </>
  );
};

export default FloatingWidgets;
