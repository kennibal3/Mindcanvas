// =============================================================
// MindCanvas v4.1 - 房间类型定义
// 变更：移除创建时的模式选择（白板/卡片/互动差异不大容易误导）
//       room_mode 保留字段兼容后端，但前端统一不在创建时展示
// =============================================================

export type RoomMode = 'whiteboard' | 'cards' | 'interactive';

// 保留供房间卡片显示用（不在创建弹窗中展示）
export const ROOM_MODE_LABELS: Record<RoomMode, { icon: string; label: string }> = {
  whiteboard:   { icon: '🎨', label: '白板' },
  cards:        { icon: '📝', label: '卡片' },
  interactive:  { icon: '📊', label: '互动' },
};

// REQ-046 房间协作形态（身份/权限维度，与 room_mode 正交）
export type CollabMode = 'roster' | 'anonymous' | 'team';

// 创建弹窗中可选的形态（一期只暴露 匿名/团队；roster 待 REQ-045 P2）
export const COLLAB_MODE_OPTIONS: { value: CollabMode; icon: string; label: string; desc: string }[] = [
  { value: 'anonymous', icon: '🙂', label: '匿名培训', desc: '自由昵称入场，学生只能删除自己的内容' },
  { value: 'team',      icon: '🤝', label: '团队协作', desc: '成员可互相编辑、删除彼此的内容（头脑风暴/协作）' },
];

export interface Room {
  id: string;
  teacher_id: string;
  tenant_id: string;
  title: string;
  invite_code: string;
  is_locked: boolean;
  is_readonly: boolean;
  max_capacity: number;
  status: string;
  room_mode: RoomMode;
  collab_mode: CollabMode;
  created_at: string;
  updated_at: string;
  finished_at?: string;
}

export interface CreateRoomRequest {
  title: string;
  max_capacity?: number;
  collab_mode?: CollabMode; // 空则后端默认 anonymous
  // room_mode 统一由后端默认为 interactive，前端不再传递
}

export interface RoomMember {
  id: string;
  uuid: string;
  student_uuid?: string;
  nickname: string;
  suffix: string;
  avatar_id: number;
  avatar_url?: string;  // 需求3：自定义上传头像URL，优先级高于 avatar_id
  is_banned: boolean;
  joined_at: string;
  left_at?: string;
  /** 角色：teacher / student（来自 WebSocket GetClientList） */
  role?: string;
}
