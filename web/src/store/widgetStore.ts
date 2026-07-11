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
  /**
   * BUG-009：各词云组件下，本人已提交过的具体词语列表（{element_id: [word,...]}）。
   * 词云要恢复的是内容本身而非布尔标记，submittedWidgets（Set）装不下，单独开一个字段。
   * 存进全局 store（而非 CustomEvent）是为了避免"事件先于组件挂载触发导致监听器错过"的时序问题——
   * Zustand selector 在组件任意时刻渲染都能读到当前值，不依赖谁先谁后。
   */
  myWordSubmissions: Record<string, string[]>;

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
  /** BUG-009：批量写入本人词云提交记录（room_sync 到达时调用） */
  setMyWordSubmissions: (submissions: Record<string, string[]>) => void;
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
  myWordSubmissions: {},

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

  /** BUG-009：批量写入本人词云提交记录（合并而非覆盖，避免多次 room_sync 时丢掉旧数据） */
  setMyWordSubmissions: (submissions) => set((state) => ({
    myWordSubmissions: { ...state.myWordSubmissions, ...submissions },
  })),

  /** 重置组件状态 */
  resetWidgets: () => set({
    creatingType: null,
    submittedWidgets: new Set<string>(),
    selectedWidgetId: null,
    editingWidgetId: null,
    myWordSubmissions: {},
  }),
}));
