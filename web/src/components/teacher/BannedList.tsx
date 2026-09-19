// =============================================================
// MindCanvas - 已封禁名单（BUG-044）
// 踢出（可重连）与封禁（拒绝重连）拆分后，被封禁学生不再出现在
// 常规在线成员列表（后端 GetSessionsByRoom 直接 WHERE is_banned = FALSE），
// 需要独立入口查看黑名单并支持老师解封。
// 自包含组件：只依赖 roomId，自己发请求、自己管 loading/error，
// 遵循 InsightPanel/SummaryPanel 已有的自取数据模式。
// =============================================================
import React, { useState, useEffect, useCallback } from 'react';
import { ShieldOff, ChevronDown, ChevronUp, Unlock, RefreshCw } from 'lucide-react';

const API_BASE = '/api';

interface BannedMember {
  student_uuid: string;
  nickname: string;
  suffix: string;
}

interface BannedListProps {
  roomId: string;
  /** 父组件每次封禁/解封成功后自增，驱动本组件重新拉取（若已展开） */
  refreshSignal?: number;
}

const BannedList: React.FC<BannedListProps> = ({ roomId, refreshSignal }) => {
  const [expanded, setExpanded] = useState(false);
  const [members, setMembers] = useState<BannedMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [unbanningUuid, setUnbanningUuid] = useState<string | null>(null);
  // BUG-051：改用内联二次确认，取代阻塞式 window.confirm（自动化浏览器里恒返回 false，点击无反应）
  const [confirmingUuid, setConfirmingUuid] = useState<string | null>(null);

  const fetchBanned = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/rooms/${roomId}/banned-members`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('加载失败');
      const data = await res.json();
      setMembers(data.banned_members || []);
    } catch {
      setError('黑名单加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  // 展开时拉取一次；已展开时若外部信号变化（新封禁/解封）也重新拉取
  useEffect(() => {
    if (expanded) fetchBanned();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, refreshSignal]);

  const handleUnban = async (uuid: string, nickname: string) => {
    setConfirmingUuid(null);
    setUnbanningUuid(uuid);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/rooms/${roomId}/unban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ target_uuid: uuid }),
      });
      if (!res.ok) throw new Error('解封失败');
      setMembers((prev) => prev.filter((m) => m.student_uuid !== uuid));
    } catch {
      setError(`解封「${nickname}」失败，请重试`);
    } finally {
      setUnbanningUuid(null);
    }
  };

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-sm font-medium text-gray-500 hover:text-gray-700 py-1 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <ShieldOff size={13} className="text-orange-400 flex-shrink-0" />
          已封禁名单{members.length > 0 ? `（${members.length}）` : ''}
        </span>
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {expanded && (
        <div className="mt-1.5 space-y-1">
          {loading && (
            <div className="text-xs text-gray-400 flex items-center gap-1 px-1 py-1">
              <RefreshCw size={11} className="animate-spin" />
              加载中...
            </div>
          )}
          {!loading && error && (
            <div className="text-xs text-red-500 px-1 py-1 flex items-center justify-between">
              <span>{error}</span>
              <button onClick={fetchBanned} className="underline hover:text-red-600 flex-shrink-0 ml-2">
                重试
              </button>
            </div>
          )}
          {!loading && !error && members.length === 0 && (
            <div className="text-xs text-gray-400 px-1 py-1">暂无被封禁的学生</div>
          )}
          {!loading &&
            members.map((m) => (
              <div
                key={m.student_uuid}
                className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-orange-50/70 text-sm"
              >
                <span className="text-gray-700 truncate">
                  {m.nickname}
                  {m.suffix ? `#${m.suffix}` : ''}
                </span>
                {confirmingUuid === m.student_uuid ? (
                  <span className="flex items-center gap-2 text-xs flex-shrink-0 ml-2">
                    <button
                      onClick={() => handleUnban(m.student_uuid, m.nickname)}
                      className="text-red-600 hover:text-red-800 font-medium"
                      title="解封后该学生可以重新加入本课堂"
                    >
                      确认解封？
                    </button>
                    <button
                      onClick={() => setConfirmingUuid(null)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      取消
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmingUuid(m.student_uuid)}
                    disabled={unbanningUuid === m.student_uuid}
                    className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-800 disabled:opacity-50 flex-shrink-0 ml-2"
                  >
                    <Unlock size={12} />
                    {unbanningUuid === m.student_uuid ? '解封中...' : '解封'}
                  </button>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default BannedList;
