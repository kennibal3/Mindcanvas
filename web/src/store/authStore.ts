// =============================================================
// MindCanvas v3.0 - 认证状态管理
// Zustand store，管理登录状态和用户信息
// Cookie 自动携带（HttpOnly），前端不存储 Token
// =============================================================
import { create } from 'zustand';
import type { AuthUser } from '@/types/user';

interface AuthState {
  /** 当前用户信息 */
  user: AuthUser | null;
  /** 是否已认证 */
  isAuthenticated: boolean;
  /** 是否正在加载 */
  loading: boolean;

  /** 设置用户信息（登录成功后调用） */
  setUser: (user: AuthUser) => void;
  /** 清除用户信息（退出登录） */
  clearUser: () => void;
  /** 设置加载状态 */
  setLoading: (loading: boolean) => void;

  /** 角色判断辅助方法 */
  isSuperAdmin: () => boolean;
  isAdmin: () => boolean;
  isTeacher: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  loading: true,

  setUser: (user) => set({ user, isAuthenticated: true, loading: false }),
  clearUser: () => set({ user: null, isAuthenticated: false, loading: false }),
  setLoading: (loading) => set({ loading }),

  isSuperAdmin: () => get().user?.role === 'superadmin',
  isAdmin: () => get().user?.role === 'admin',
  isTeacher: () => get().user?.role === 'teacher',
}));
