// =============================================================
// MindCanvas v3.0 - 认证 Hook
// 封装登录/登出/检查认证状态
// =============================================================
import { useCallback } from 'react';
import { useAuthStore } from '@/store/authStore';
import type { LoginRequest } from '@/types/user';

/** API 基础路径 */
const API_BASE = '/api';

export const useAuth = () => {
  const { user, isAuthenticated, loading, setUser, clearUser, setLoading } =
    useAuthStore();

  /** 登录 */
  const login = useCallback(async (data: LoginRequest) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // 携带 Cookie
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || '登录失败');
    }

    const result = await res.json();
    setUser(result.user);
    return result.user;
  }, [setUser]);

  /** 登出 */
  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      clearUser();
    }
  }, [clearUser]);

  /** 检查当前认证状态（页面刷新后恢复） */
  const checkAuth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        clearUser();
      }
    } catch {
      clearUser();
    }
  }, [setUser, clearUser, setLoading]);

  return {
    user,
    isAuthenticated,
    loading,
    login,
    logout,
    checkAuth,
    isSuperAdmin: user?.role === 'superadmin',
    isAdmin: user?.role === 'admin',
    isTeacher: user?.role === 'teacher',
  };
};
