// =============================================================
// MindCanvas v3.0 - 画布变换同步 Hook
// 从 Excalidraw 的 onChange 回调中提取变换信息，
// 驱动 DOM 覆盖层同步缩放和平移
// =============================================================
import { useCallback, useRef } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import type { CanvasTransform, ExcalidrawAppState } from '@/types/canvas';

/**
 * 画布变换同步 Hook
 * 
 * 核心功能：
 * 1. 从 Excalidraw 的 appState 提取 scrollX/scrollY/zoom
 * 2. 使用 requestAnimationFrame 节流，避免高频重渲染
 * 3. 提供当前变换信息和 CSS transform 计算方法
 * 
 * @returns {object} transform 当前变换, onCanvasChange 回调函数, getOverlayStyle 计算覆盖层样式
 */
export const useCanvasTransform = () => {
  const { transform, setTransform } = useCanvasStore();
  /** RAF 请求 ID，用于取消未执行的帧 */
  const rafRef = useRef<number | null>(null);
  /** 上一次的变换值，用于比较是否真的发生了变化 */
  const lastTransformRef = useRef<CanvasTransform>(transform);

  /**
   * Excalidraw onChange 回调
   * 提取 appState 中的 scrollX/scrollY/zoom 并更新 store
   * 使用 RAF 节流，每帧最多更新一次
   */
  const onCanvasChange = useCallback(
    (_elements: readonly any[], appState: ExcalidrawAppState) => {
      const newTransform: CanvasTransform = {
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom.value,
      };

      // 比较是否有变化，避免无效更新
      const last = lastTransformRef.current;
      if (
        last.scrollX === newTransform.scrollX &&
        last.scrollY === newTransform.scrollY &&
        last.zoom === newTransform.zoom
      ) {
        return;
      }

      lastTransformRef.current = newTransform;

      // 使用 RAF 节流：取消上一帧未执行的更新，合并到下一帧
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        setTransform(newTransform);
        rafRef.current = null;
      });
    },
    [setTransform]
  );

  /**
   * 计算 DOM 覆盖层的 CSS transform 样式
   * 使元素跟随 Excalidraw 画布的缩放和平移
   * 
   * 原理：Excalidraw 的坐标系中，(0,0) 是画布初始中心
   * scrollX/scrollY 表示画布平移量，zoom 表示缩放级别
   * DOM 覆盖层需要应用相同的 transform 才能对齐
   */
  const getOverlayStyle = useCallback((): React.CSSProperties => {
    return {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',  // 默认不拦截鼠标事件，由子元素自行启用
      transformOrigin: '0 0',
      transform: `translate(${transform.scrollX}px, ${transform.scrollY}px) scale(${transform.zoom})`,
    };
  }, [transform]);

  /**
   * 将画布坐标转换为屏幕坐标
   * @param canvasX 画布 x 坐标
   * @param canvasY 画布 y 坐标
   * @returns 屏幕坐标 { screenX, screenY }
   */
  const canvasToScreen = useCallback(
    (canvasX: number, canvasY: number) => {
      return {
        screenX: (canvasX + transform.scrollX) * transform.zoom,
        screenY: (canvasY + transform.scrollY) * transform.zoom,
      };
    },
    [transform]
  );

  /**
   * 将屏幕坐标转换为画布坐标
   * @param screenX 屏幕 x 坐标
   * @param screenY 屏幕 y 坐标
   * @returns 画布坐标 { canvasX, canvasY }
   */
  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => {
      return {
        canvasX: screenX / transform.zoom - transform.scrollX,
        canvasY: screenY / transform.zoom - transform.scrollY,
      };
    },
    [transform]
  );

  return {
    transform,
    onCanvasChange,
    getOverlayStyle,
    canvasToScreen,
    screenToCanvas,
  };
};
