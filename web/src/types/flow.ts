// =============================================================
// MindCanvas v4.1 - Phase 5 课堂流程控制器类型定义
// =============================================================

/** 节点类型 */
export type FlowNodeType =
  | 'lecture'      // 讲授
  | 'discussion'   // 讨论
  | 'interaction'  // 互动（绑定Widget）
  | 'break'        // 休息
  | 'review';      // 复习/总结

/** 进入节点时画布模式 */
export type FlowNodeEntryMode = 'free' | 'readonly' | 'follow';

/** 节点类型元数据 */
export const FLOW_NODE_TYPES: Record<FlowNodeType, { label: string; icon: string; color: string; desc: string }> = {
  lecture:     { label: '讲授',   icon: '📖', color: 'amber',   desc: '教师讲解，可选开启跟随模式' },
  discussion:  { label: '讨论',   icon: '💬', color: 'green',  desc: '学生自由协作，画布开放' },
  interaction: { label: '互动',   icon: '🎯', color: 'purple', desc: '绑定Widget进行形成性评价' },
  break:       { label: '休息',   icon: '☕', color: 'orange', desc: '课间休息' },
  review:      { label: '总结',   icon: '📝', color: 'gray',   desc: '课堂总结与回顾' },
};

/** 进入模式元数据 */
export const ENTRY_MODES: Record<FlowNodeEntryMode, { label: string; desc: string }> = {
  free:     { label: '自由模式',   desc: '学生可自由操作画布' },
  readonly: { label: '只读模式',   desc: '学生只能查看，不能编辑' },
  follow:   { label: '跟随模式',   desc: '学生视口跟随教师' },
};

/** 课堂流程节点 */
export interface FlowNode {
  id: string;               // 节点唯一ID（前端生成UUID）
  type: FlowNodeType;       // 节点类型
  title: string;            // 节点标题
  duration: number;         // 预计时长（分钟）
  notes: string;            // 教师备注（不对学生展示）
  widgetElementId: string;  // 绑定的Widget元素ID（interaction类型）
  autoOpenWidget: boolean;  // 进入节点时提示开启Widget
  showToStudents: boolean;  // 是否对学生展示此节点标题
  entryMode: FlowNodeEntryMode; // 进入时画布模式
}

/** 课堂流程主体 */
export interface TeachingFlow {
  id: string;
  room_id: string;
  title: string;
  nodes: FlowNode[];
  current_node_index: number;
  status: 'draft' | 'active' | 'finished';
  show_progress_to_students: boolean;
  started_at?: string;
  finished_at?: string;
  created_at: string;
  updated_at: string;
}

/** 学生端可见的节点信息（已脱敏） */
export interface FlowNodePublic {
  id: string;
  type: FlowNodeType;
  title: string;           // 仅showToStudents=true时有值
  duration: number;
  show_to_students: boolean;
}

/** 学生端进度信息 */
export interface FlowProgress {
  flow_id: string;
  flow_title: string;
  current_node_index: number;
  total_nodes: number;
  current_node?: FlowNodePublic;
  nodes: FlowNodePublic[];
}

/** 创建/更新流程请求 */
export interface CreateFlowRequest {
  title: string;
  nodes: FlowNode[];
  show_progress_to_students: boolean;
}

/** 推进节点请求 */
export interface AdvanceFlowRequest {
  direction: 'next' | 'prev' | 'jump';
  target_index?: number;
}

/** 生成默认节点 */
export function createDefaultNode(type: FlowNodeType = 'lecture'): FlowNode {
  return {
    id: crypto.randomUUID(),
    type,
    title: FLOW_NODE_TYPES[type].label,
    duration: type === 'break' ? 5 : type === 'interaction' ? 8 : 10,
    notes: '',
    widgetElementId: '',
    autoOpenWidget: true,
    showToStudents: true,
    entryMode: type === 'interaction' ? 'readonly' : type === 'lecture' ? 'free' : 'free',
  };
}
