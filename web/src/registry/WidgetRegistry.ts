// =============================================================
// MindCanvas v3.0 - Widget 插件注册中心
// 管理画布内的互动组件（投票、词云、问答等）
// 
// 扩展方式：
// 1. 编写 React 组件（实现 WidgetProps 接口）
// 2. 调用 WidgetRegistry.register() 注册
// 3. Go 后端无需改动（通用 UpdateElementPayload）
// 4. 数据库无需建新表（复用 room_elements + widget_interactions）
// =============================================================
import React from 'react';
import type { WidgetProps, WidgetMeta } from '@/types/widget';

/**
 * Widget 插件注册中心
 * 
 * 设计原则：
 * - 所有 Widget 组件通过注册中心统一管理
 * - 新增组件只需 register 一步，不改任何现有代码
 * - 未注册的类型自动降级到 FallbackWidget
 * - 支持运行时动态注册
 */
class WidgetRegistryClass {
  /** 组件映射表：type → React Component */
  private components = new Map<string, React.ComponentType<WidgetProps>>();
  /** 元数据映射表：type → WidgetMeta */
  private metas = new Map<string, WidgetMeta>();

  /**
   * 注册一个 Widget 组件
   * @param type 组件类型标识（如 'polling_widget'）
   * @param component React 组件
   * @param meta 组件元数据（标签、图标、默认 payload）
   */
  register(
    type: string,
    component: React.ComponentType<WidgetProps>,
    meta: WidgetMeta
  ): void {
    this.components.set(type, component);
    this.metas.set(type, meta);
    console.log(`[WidgetRegistry] 注册组件: ${type} (${meta.label})`);
  }

  /**
   * 获取组件（未注册返回 null，由调用方处理降级）
   * @param type 组件类型
   * @returns React 组件或 null
   */
  getComponent(type: string): React.ComponentType<WidgetProps> | null {
    return this.components.get(type) || null;
  }

  /**
   * 获取组件元数据
   * @param type 组件类型
   * @returns 元数据或 undefined
   */
  getMeta(type: string): WidgetMeta | undefined {
    return this.metas.get(type);
  }

  /**
   * 获取所有已注册组件的元数据列表
   * 用于教师工具栏显示可添加的组件列表
   * @returns WidgetMeta 数组
   */
  getAllMetas(): WidgetMeta[] {
    return Array.from(this.metas.values());
  }

  /**
   * 获取组件的默认 payload
   * 创建新组件时使用
   * @param type 组件类型
   * @returns 默认 payload 对象
   */
  getDefaultPayload(type: string): Record<string, any> {
    return this.metas.get(type)?.defaultPayload || {};
  }

  /**
   * 检查类型是否已注册
   * @param type 组件类型
   * @returns 是否已注册
   */
  isRegistered(type: string): boolean {
    return this.components.has(type);
  }

  /**
   * 获取已注册的组件数量
   * @returns 组件数量
   */
  get size(): number {
    return this.components.size;
  }
}

/**
 * 全局唯一的 Widget 注册中心实例
 */
export const WidgetRegistry = new WidgetRegistryClass();
