// =============================================================
// MindCanvas v3.0 - 画布状态管理
// 使用 Zustand 管理画布变换、工具、主题、跟随模式
// 功能10：主题风格 | 功能9：跟随模式
// =============================================================
import { create } from 'zustand';
import type { CanvasTransform } from '@/types/canvas';

/** 主题类型 */
export type ThemeMode = 'light';

/** 背景色预设 */
export const BACKGROUND_COLORS = [
  { value: '#FFFFFF', label: '白色' },
  { value: '#F8FAFC', label: '浅灰' },
  { value: '#1E293B', label: '深蓝' },
  { value: '#FEF3C7', label: '暖黄' },
  { value: '#ECFDF5', label: '薄荷' },
  { value: '#EFF6FF', label: '天蓝' },
  { value: '#FDF2F8', label: '粉红' },
  { value: '#F5F3FF', label: '淡紫' },
];

/**
 * 画布状态接口
 */
interface CanvasState {
  /** 当前画布变换（scrollX, scrollY, zoom） */
  transform: CanvasTransform;
  /** 当前激活的工具类型 */
  activeTool: string;
  /** Excalidraw API 引用 */
  excalidrawAPI: any | null;
  /** 是否显示小地图 */
  showMinimap: boolean;
  /** 画布是否就绪 */
  isReady: boolean;
  /** 功能10：主题模式 */
  theme: ThemeMode;
  /** 功能10：画布背景色 */
  backgroundColor: string;
  /** 功能9：是否处于跟随模式（教师端：正在广播；学生端：正在跟随） */
  isFollowMode: boolean;

  // === 操作方法 ===
  setTransform: (transform: CanvasTransform) => void;
  setActiveTool: (tool: string) => void;
  setExcalidrawAPI: (api: any) => void;
  toggleMinimap: () => void;
  setReady: (ready: boolean) => void;
  /** 功能10：设置主题 */
  setTheme: (theme: ThemeMode) => void;
  /** 功能10：设置背景色 */
  setBackgroundColor: (color: string) => void;
  /** 功能9：切换跟随模式 */
  setFollowMode: (enabled: boolean) => void;
  resetCanvas: () => void;
}

const initialTransform: CanvasTransform = {
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
};

export const useCanvasStore = create<CanvasState>((set) => ({
  // === 初始状态 ===
  transform: initialTransform,
  activeTool: 'selection',
  excalidrawAPI: null,
  showMinimap: false,
  isReady: false,
  theme: 'light',
  backgroundColor: '#FFFFFF',
  isFollowMode: false,

  // === 操作方法 ===
  setTransform: (transform) => set({ transform }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setExcalidrawAPI: (api) => set({ excalidrawAPI: api, isReady: true }),
  toggleMinimap: () => set((state) => ({ showMinimap: !state.showMinimap })),
  setReady: (ready) => set({ isReady: ready }),
  setTheme: (theme) => set({ theme }),
  setBackgroundColor: (color) => set({ backgroundColor: color }),
  setFollowMode: (enabled) => set({ isFollowMode: enabled }),
  resetCanvas: () => set({
    transform: initialTransform,
    activeTool: 'selection',
    excalidrawAPI: null,
    showMinimap: false,
    isReady: false,
    theme: 'light',
    backgroundColor: '#FFFFFF',
    isFollowMode: false,
  }),
}));
