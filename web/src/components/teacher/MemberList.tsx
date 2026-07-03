// =============================================================
// MindCanvas v4.3 - 在线成员列表
// REQ-012修复：踢人/封禁操作改为「⋯」常驻菜单，不依赖hover
//   - 每个学生成员右侧始终显示「⋯」按钮
//   - 点击展开：召集此学生视角 / 踢出课堂 / 封禁（拒绝重连）
// 需求3：优先使用上传头像URL，没有则用预设emoji
// =============================================================
import React, { useState, useRef, useEffect } from 'react';
import {
  Users, ChevronDown, ChevronUp,
  MoreHorizontal, Navigation, UserX, ShieldOff,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AVATARS } from '@/utils/constants';
import type { RoomMember } from '@/types/room';

interface MemberListProps {
  members: RoomMember[];
  onKick: (uuid: string, nickname: string) => void;
  kickLoading: string | null;
  onGatherOne?: (uuid: string) => void;
  onBan?: (uuid: string, nickname: string) => void;
}

// ===== 单个成员操作菜单 =====
interface MemberMenuProps {
  uuid: string;
  nickname: string;
  isKicking: boolean;
  onKick: () => void;
  onGatherOne?: () => void;
  onBan?: () => void;
}

const MemberMenu: React.FC<MemberMenuProps> = ({
  uuid, nickname, isKicking, onKick, onGatherOne, onBan,
}) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={menuRef} className="relative flex-shrink-0">
      {/* ⋯ 按钮：始终可见，不依赖hover，触屏/键盘均可用 */}
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        disabled={isKicking}
        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
        title="成员操作"
        aria-label={`操作 ${nickname}`}
      >
        {isKicking
          ? <div className="w-3.5 h-3.5 border border-gray-400 border-t-transparent rounded-full animate-spin" />
          : <MoreHorizontal size={14} />}
      </button>

      {/* 下拉操作菜单 */}
      {open && (
        <div
          className="absolute right-0 top-8 bg-white border border-gray-200 rounded-xl shadow-xl py-1 min-w-[168px] animate-fade-in"
          style={{ zIndex: 2147483647 }}
        >
          {/* 召集此学生视角 */}
          {onGatherOne && (
            <button
              onClick={() => { onGatherOne(); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50 hover:text-amber-800 transition-colors"
            >
              <Navigation size={14} className="text-amber-600 flex-shrink-0" />
              <span>召集此学生视角</span>
            </button>
          )}

          <div className="h-px bg-gray-100 mx-2 my-0.5" />

          {/* 踢出课堂 */}
          <button
            onClick={() => { onKick(); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <UserX size={14} className="text-red-400 flex-shrink-0" />
            <span>踢出课堂</span>
          </button>

          {/* 封禁（拒绝重连） */}
          {onBan && (
            <button
              onClick={() => { onBan(); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-600 transition-colors"
            >
              <ShieldOff size={14} className="text-orange-400 flex-shrink-0" />
              <span>封禁（拒绝重连）</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ===== 主组件 =====
const MemberList: React.FC<MemberListProps> = ({
  members, onKick, kickLoading, onGatherOne, onBan,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  // 需求3：优先使用上传的自定义头像，没有则用预设emoji
  const getAvatar = (member: RoomMember): { type: 'url' | 'emoji'; value: string } => {
    if (member.avatar_url) return { type: 'url', value: member.avatar_url };
    const emoji = AVATARS.find((a) => a.id === member.avatar_id)?.emoji || '👤';
    return { type: 'emoji', value: emoji };
  };

  const activeMembers = members.filter((m) => !m.is_banned);

  // 判断是否为教师（UUID不以guest-开头 或 role===teacher）
  const isMemberTeacher = (m: RoomMember) =>
    m.role === 'teacher' || (m.uuid && !m.uuid.startsWith('guest-'));

  return (
    <div>
      {/* 展开/收起标题栏 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 hover:text-gray-600 transition-colors"
      >
        <div className="flex items-center gap-1">
          <Users size={12} />
          <span>{t('room.members')} ({activeMembers.length})</span>
        </div>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {expanded && (
        <div className="space-y-0.5 max-h-[240px] overflow-y-auto">
          {activeMembers.length === 0 ? (
            <div className="text-center text-xs text-gray-400 py-4">暂无成员在线</div>
          ) : (
            activeMembers.map((member) => {
              const uuid       = member.uuid || member.student_uuid || '';
              const isKicking  = kickLoading === `kick-${uuid}`;
              const isThisTeacher = isMemberTeacher(member);
              const nickname   = `${member.nickname}${member.suffix ? '#' + member.suffix : ''}`;

              return (
                <div
                  key={member.id || uuid}
                  className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  {/* 左侧：头像 + 昵称 + 角色标签 */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {(() => {
                      const av = getAvatar(member);
                      return av.type === 'url'
                        ? <img
                            src={av.value}
                            alt="头像"
                            className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                          />
                        : <span className="text-base flex-shrink-0">{av.value}</span>;
                    })()}

                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-700 truncate">
                        {member.nickname}
                        {member.suffix && (
                          <span className="text-gray-400">#{member.suffix}</span>
                        )}
                      </div>
                    </div>

                    {isThisTeacher ? (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        教师
                      </span>
                    ) : (
                      <span className="text-xs bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        学生
                      </span>
                    )}
                  </div>

                  {/* 右侧：⋯ 操作菜单（只对学生显示） */}
                  {!isThisTeacher && (
                    <MemberMenu
                      uuid={uuid}
                      nickname={nickname}
                      isKicking={isKicking}
                      onKick={() => onKick(uuid, nickname)}
                      onGatherOne={onGatherOne ? () => onGatherOne(uuid) : undefined}
                      onBan={onBan ? () => onBan(uuid, nickname) : undefined}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default MemberList;
