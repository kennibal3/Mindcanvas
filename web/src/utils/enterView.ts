// REQ-064：进房定位——进房间时把视角移到「最近修改处」或「全景」。
//
// 背景：画布内容是进房后由 room_sync 推过来的，此前视角一直停在原点，
// 内容不在原点附近时老师看到一片空白，得手动点「滚动回到内容」。
//
// 纯函数放这里，便于 node --test 直接测（web/tests/enterView.test.mts）；
// 调用点在 CanvasEngine.tsx。

export type EnterViewMode = 'recent' | 'overview';

/** 跳到最近修改处时的缩放比例：50% 能看到所在区域的大致全貌（2026-10-14 用户拍板）。 */
export const ENTER_VIEW_ZOOM = 0.5;

const STORAGE_KEY = 'mc:enterViewMode';

/** 读取上次选的定位方式（按浏览器记忆）；默认「最近修改」。存储不可用时也返回默认值。 */
export function loadEnterViewMode(): EnterViewMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'overview' ? 'overview' : 'recent';
  } catch {
    return 'recent';
  }
}

export function saveEnterViewMode(mode: EnterViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* 隐私模式等存储不可用：不记忆，不影响功能 */
  }
}

export interface PositionedElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  updated?: number;
  isDeleted?: boolean;
}

/**
 * 找最后被修改的那个（未删除的）元素。
 * Excalidraw 每次修改元素都会刷新它的 `updated`（毫秒时间戳），取最大即可。
 * 时间相同时取数组里靠后的（图层更靠上、通常是后画的）。
 */
export function findMostRecentElement<T extends PositionedElement>(elements: readonly T[]): T | null {
  let best: T | null = null;
  let bestTs = -Infinity;
  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    if (!Number.isFinite(el.x) || !Number.isFinite(el.y)) continue;
    const ts = Number.isFinite(el.updated) ? (el.updated as number) : 0;
    if (ts >= bestTs) {
      bestTs = ts;
      best = el;
    }
  }
  return best;
}

/**
 * 计算让某元素中心落在屏幕中央所需的 scrollX/scrollY。
 * Excalidraw 坐标换算：sceneX = 屏幕px / zoom - scrollX（scrollX 不除 zoom，见 CLAUDE.md 坑清单）。
 * 令屏幕中心 (viewW/2, viewH/2) 对应元素中心 (cx, cy) 即得下式。
 */
export function centerViewportOn(
  el: Pick<PositionedElement, 'x' | 'y' | 'width' | 'height'>,
  viewW: number,
  viewH: number,
  zoom: number,
): { scrollX: number; scrollY: number } {
  const cx = el.x + (Number.isFinite(el.width) ? el.width : 0) / 2;
  const cy = el.y + (Number.isFinite(el.height) ? el.height : 0) / 2;
  return {
    scrollX: viewW / 2 / zoom - cx,
    scrollY: viewH / 2 / zoom - cy,
  };
}
