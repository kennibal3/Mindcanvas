// =============================================================
// MindCanvas v3.0 - 用户类型定义
// =============================================================

/** 有账号用户角色 */
export type UserRole = 'superadmin' | 'admin' | 'teacher';

/** 认证用户信息（从JWT解析） */
export interface AuthUser {
  id: string;             // 用户 UUID
  username: string;       // 登录用户名
  role: UserRole;         // 角色
  tenant_id: string;      // 租户 ID（superadmin 为空字符串）
  display_name: string;   // 显示名称
  permissions?: string[]; // 权限列表
  avatar_url?: string;
  chat_enabled?: boolean; // Chat功能开关    // 需求3：自定义头像URL
}

/** 登录请求 */
export interface LoginRequest {
  username: string;
  password: string;
}

/** 登录响应 */
export interface LoginResponse {
  message: string;
  user: AuthUser;
}
