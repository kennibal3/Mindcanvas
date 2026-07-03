// =============================================================
// MindCanvas v3.0 - Teaching Module 注册中心
// 管理独立的教学功能模块（侧边栏 / 独立页面）
// 
// 与 WidgetRegistry 的区别：
// - WidgetRegistry：画布内的互动组件（跟随画布缩放平移）
// - ModuleRegistry：独立的教学功能模块（侧边栏/面板/全屏页面）
// 
// 扩展方式：
// 1. 创建模块组件
// 2. 调用 ModuleRegistry.register() 注册
// 3. Go 后端新增 /api/modules/{id} 路由组
// 4. 不改任何现有路由和组件
// =============================================================
import type { TeachingModuleConfig, MinRole } from '@/types/widget';

/**
 * 角色等级映射（用于权限比较）
 */
const ROLE_LEVEL: Record<string, number> = {
  teacher: 1,
  admin: 2,
  superadmin: 3,
};

/**
 * Teaching Module 注册中心
 */
class ModuleRegistryClass {
  /** 模块映射表：id → TeachingModuleConfig */
  private modules = new Map<string, TeachingModuleConfig>();

  /**
   * 注册一个教学模块
   * @param config 模块配置
   */
  register(config: TeachingModuleConfig): void {
    this.modules.set(config.id, config);
    console.log(`[ModuleRegistry] 注册模块: ${config.id} (${config.name})`);
  }

  /**
   * 获取指定角色可见的模块列表
   * @param role 当前用户角色
   * @returns 可用模块配置列表
   */
  getByRole(role: string): TeachingModuleConfig[] {
    const currentLevel = ROLE_LEVEL[role] || 0;
    return Array.from(this.modules.values()).filter(
      (m) => currentLevel >= (ROLE_LEVEL[m.minRole] || 0)
    );
  }

  /**
   * 按挂载点和角色过滤模块
   * @param mountPoint 挂载位置
   * @param role 当前用户角色
   * @returns 过滤后的模块列表
   */
  getByMountPoint(mountPoint: string, role: string): TeachingModuleConfig[] {
    return this.getByRole(role).filter((m) => m.mountPoint === mountPoint);
  }

  /**
   * 根据 ID 获取模块配置
   * @param id 模块 ID
   * @returns 模块配置或 undefined
   */
  getById(id: string): TeachingModuleConfig | undefined {
    return this.modules.get(id);
  }

  /**
   * 获取所有已注册模块
   * @returns 所有模块配置列表
   */
  getAll(): TeachingModuleConfig[] {
    return Array.from(this.modules.values());
  }

  /**
   * 获取已注册模块数量
   */
  get size(): number {
    return this.modules.size;
  }
}

/**
 * 全局唯一的 Module 注册中心实例
 */
export const ModuleRegistry = new ModuleRegistryClass();
