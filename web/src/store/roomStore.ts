// =============================================================
// MindCanvas v3.0 - 房间状态管理
// 使用 Zustand 管理房间信息、元素列表、成员列表、锁定状态
// =============================================================
import { create } from 'zustand';
import type { Room, RoomMember } from '@/types/room';
import type { CanvasElement } from '@/types/canvas';

/**
 * 房间状态接口
 */
interface RoomState {
  /** 当前房间信息 */
  currentRoom: Room | null;
  /** 房间内所有元素（卡片 + 组件） */
  elements: CanvasElement[];
  /** 在线成员列表 */
  members: RoomMember[];
  /** 画布是否锁定 */
  isLocked: boolean;
  /** 画布是否只读 */
  isReadOnly: boolean;
  /** 当前用户是否为教师 */
  isTeacher: boolean;
  /** 当前用户 UUID（学生）或 user_id（教师） */
  currentUserUUID: string;
  /** WebSocket 连接状态 */
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';

  // === REQ-021：多用户光标状态 ===
  /** 其他用户的实时光标位置 { uuid -> {x,y,nickname} } */
  cursors: Record<string, { x: number; y: number; nickname: string; updatedAt: number }>;
  /** 当前房间是否开启了多用户光标模式 */
  cursorModeEnabled: boolean;
  /** 更新某用户光标位置 */
  updateCursor: (uuid: string, x: number, y: number, nickname: string) => void;
  /** 移除某用户光标（离开时） */
  removeCursor: (uuid: string) => void;
  /** 设置光标模式开关 */
  setCursorModeEnabled: (enabled: boolean) => void;

  // === 房间操作 ===

  /** 设置当前房间 */
  setCurrentRoom: (room: Room | null) => void;
  /** 设置锁定状态 */
  setIsLocked: (locked: boolean) => void;
  /** 设置只读状态 */
  setIsReadOnly: (readonly: boolean) => void;
  /** 设置是否为教师 */
  setIsTeacher: (isTeacher: boolean) => void;
  /** 设置当前用户 UUID */
  setCurrentUserUUID: (uuid: string) => void;
  /** 设置连接状态 */
  setConnectionStatus: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;

  // === 元素操作 ===

  /** 批量设置元素（room_sync 时使用） */
  setElements: (elements: CanvasElement[]) => void;
  /** 添加元素 */
  addElement: (element: CanvasElement) => void;
  /** 更新元素（按 ID 更新 payload） */
  updateElement: (id: string, payload: Record<string, any>) => void;
  /** 软删除元素 */
  removeElement: (id: string) => void;
  /** 根据 ID 获取元素 */
  getElementById: (id: string) => CanvasElement | undefined;

  // === 成员操作 ===

  /** 批量设置成员 */
  setMembers: (members: RoomMember[]) => void;
  /** 添加成员 */
  addMember: (member: RoomMember) => void;
  /** 移除成员 */
  removeMember: (uuid: string) => void;

  // === 重置 ===

  /** 重置所有房间状态 */
  resetRoom: () => void;
}

/**
 * 房间状态管理 Store
 */
export const useRoomStore = create<RoomState>((set, get) => ({
  // === 初始状态 ===
  currentRoom: null,
  elements: [],
  members: [],
  isLocked: false,
  isReadOnly: false,
  isTeacher: false,
  currentUserUUID: '',
  connectionStatus: 'disconnected',

  // === 房间操作 ===

  setCurrentRoom: (room) => set({
    currentRoom: room,
    isLocked: room?.is_locked ?? false,
    isReadOnly: room?.is_readonly ?? false,
  }),

  setIsLocked: (locked) => set({ isLocked: locked }),
  setIsReadOnly: (readonly) => set({ isReadOnly: readonly }),
  setIsTeacher: (isTeacher) => set({ isTeacher }),
  setCurrentUserUUID: (uuid) => set({ currentUserUUID: uuid }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  // === REQ-021：光标状态初始值 ===
  cursors: {},
  cursorModeEnabled: false,

  updateCursor: (uuid, x, y, nickname) => set((state) => ({
    cursors: { ...state.cursors, [uuid]: { x, y, nickname, updatedAt: Date.now() } },
  })),

  removeCursor: (uuid) => set((state) => {
    const next = { ...state.cursors };
    delete next[uuid];
    return { cursors: next };
  }),

  setCursorModeEnabled: (enabled) => set({ cursorModeEnabled: enabled }),

  // === 元素操作 ===

  /** 批量设置元素（首次同步时覆盖） */
  setElements: (elements) => set({ elements }),

  /** 添加元素到列表 */
  addElement: (element) => set((state) => {
    // 去重：如果已存在相同 ID 的元素，先移除再添加
    const filtered = state.elements.filter((e) => e.id !== element.id);
    return { elements: [...filtered, element] };
  }),

  /** 更新元素的 payload */
  updateElement: (id, payload) => set((state) => ({
    elements: state.elements.map((e) =>
      e.id === id
        ? { ...e, payload: { ...e.payload, ...payload }, updated_at: new Date().toISOString() }
        : e
    ),
  })),

  /** 软删除元素 */
  removeElement: (id) => set((state) => ({
    elements: state.elements.filter((e) => e.id !== id),
  })),

  /** 根据 ID 获取元素 */
  getElementById: (id) => get().elements.find((e) => e.id === id),

  // === 成员操作 ===

  /** 批量设置成员（room_sync 时覆盖） */
  setMembers: (members) => set({ members }),

  /** 添加成员（去重） */
  addMember: (member) => set((state) => {
    const filtered = state.members.filter((m) => m.uuid !== member.uuid);
    return { members: [...filtered, member] };
  }),

  /** 移除成员 */
  removeMember: (uuid) => set((state) => ({
    members: state.members.filter((m) => m.uuid !== uuid),
  })),

  // === 重置 ===

  resetRoom: () => set({
    cursors: {},
    cursorModeEnabled: false,
    currentRoom: null,
    elements: [],
    members: [],
    isLocked: false,
    isReadOnly: false,
    isTeacher: false,
    currentUserUUID: '',
    connectionStatus: 'disconnected',
  }),
}));
