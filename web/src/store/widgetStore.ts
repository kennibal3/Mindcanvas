// =============================================================
// MindCanvas v3.0 - 互动组件状态管理
// 使用 Zustand 管理 Widget 组件的交互状态
// =============================================================
import { create } from 'zustand';

/**
 * 互动组件状态接口
 */
interface WidgetState {
  /** 当前正在创建的组件类型（null 表示没有在创建） */
  creatingType: string | null;
  /** 已提交过的组件 ID 集合（防止重复提交） */
  submittedWidgets: Set<string>;
  /** 当前选中的组件 ID */
  selectedWidgetId: string | null;
  /** 教师正在编辑的组件 ID */
  editingWidgetId: string | null;

  // === 操作方法 ===

  /** 设置正在创建的组件类型 */
  setCreatingType: (type: string | null) => void;
  /** 标记组件为已提交 */
  markSubmitted: (elementId: string) => void;
  /** 检查组件是否已提交 */
  isSubmitted: (elementId: string) => boolean;
  /** 设置选中的组件 */
  setSelectedWidget: (id: string | null) => void;
  /** 设置正在编辑的组件 */
  setEditingWidget: (id: string | null) => void;
  /** 重置组件状态 */
  resetWidgets: () => void;
}

/**
 * 互动组件状态管理 Store
 */
export const useWidgetStore = create<WidgetState>((set, get) => ({
  // === 初始状态 ===
  creatingType: null,
  submittedWidgets: new Set<string>(),
  selectedWidgetId: null,
  editingWidgetId: null,

  // === 操作方法 ===

  /** 设置正在创建的组件类型 */
  setCreatingType: (type) => set({ creatingType: type }),

  /** 标记组件为已提交（如已投票、已答题） */
  markSubmitted: (elementId) => set((state) => {
    const newSet = new Set(state.submittedWidgets);
    newSet.add(elementId);
    return { submittedWidgets: newSet };
  }),

  /** 检查组件是否已提交 */
  isSubmitted: (elementId) => get().submittedWidgets.has(elementId),

  /** 设置选中的组件 */
  setSelectedWidget: (id) => set({ selectedWidgetId: id }),

  /** 设置正在编辑的组件 */
  setEditingWidget: (id) => set({ editingWidgetId: id }),

  /** 重置组件状态 */
  resetWidgets: () => set({
    creatingType: null,
    submittedWidgets: new Set<string>(),
    selectedWidgetId: null,
    editingWidgetId: null,
  }),
}));
