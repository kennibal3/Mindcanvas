// =============================================================
// MindCanvas v4.1 - 教师仪表盘
// 变更：
//   - 移除创建房间时的"房间模式"选择（三种模式差异不大，容易误导）
//   - 新增模板中心入口（Tab 切换：我的房间 / 模板中心）
//   - 房间卡片保留模式图标（只读展示，不影响功能）
//   - 手机端响应式优化
// =============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import {
  Plus, Copy, Trash2, Lock, Users, LogOut, Settings,
  Check, Pencil, Calendar, UserCircle, Eye, EyeOff,
  LayoutTemplate, BookOpen, Globe, Star, MessageSquare,
} from 'lucide-react';
import type { Room, CollabMode } from '@/types/room';
import { ROOM_MODE_LABELS, COLLAB_MODE_OPTIONS } from '@/types/room';

const API_BASE = '/api';

// 模板数据类型
interface RoomTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  is_public: boolean;
  use_count: number;
  created_at: string;
  author_id: string;
}

type DashTab = 'rooms' | 'templates';

const DashboardPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout, checkAuth, isSuperAdmin, isAdmin } = useAuth();

  // ===== 房间状态 =====
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCapacity, setNewCapacity] = useState(50);
  const [newCollabMode, setNewCollabMode] = useState<CollabMode>('anonymous');
  const [createLoading, setCreateLoading] = useState(false);
  const [copied, setCopied] = useState('');
  const [toast, setToast] = useState('');

  // ===== 编辑房间状态 =====
  const [editRoom, setEditRoom] = useState<Room | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCapacity, setEditCapacity] = useState(50);
  const [editExpiresAt, setEditExpiresAt] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  // ===== 个人设置状态 =====
  const [showProfile, setShowProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileOldPwd, setProfileOldPwd] = useState('');
  const [profileNewPwd, setProfileNewPwd] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [showOldPwd, setShowOldPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  // 需求3：教师头像上传状态
  const [profileAvatarURL, setProfileAvatarURL] = useState('');     // 当前头像URL
  const [profileAvatarUploading, setProfileAvatarUploading] = useState(false);
  const [profileAvatarErr, setProfileAvatarErr] = useState('');
  const profileAvatarInputRef = useRef<HTMLInputElement>(null);

  // ===== 模板中心状态 =====
  const [activeTab, setActiveTab] = useState<DashTab>('rooms');
  const [templates, setTemplates] = useState<RoomTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [useTemplateLoading, setUseTemplateLoading] = useState<string | null>(null);
  const [deleteTemplateLoading, setDeleteTemplateLoading] = useState<string | null>(null);

  // ===== 滚动定位 =====
  const roomRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const scrollToRoomId = useRef<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // ===== 获取房间列表 =====
  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/rooms`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setRooms(data.rooms || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  // ===== 获取模板列表 =====
  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/templates`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  useEffect(() => {
    if (activeTab === 'templates' && templates.length === 0) {
      fetchTemplates();
    }
  }, [activeTab, fetchTemplates, templates.length]);

  // 滚动到目标房间
  useEffect(() => {
    if (scrollToRoomId.current && rooms.length > 0) {
      const targetId = scrollToRoomId.current;
      scrollToRoomId.current = null;
      requestAnimationFrame(() => {
        const el = roomRefs.current.get(targetId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-amber-400');
          setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400'), 2000);
        }
      });
    }
  }, [rooms]);

  // ===== 创建房间（不再传 room_mode，后端默认 interactive）=====
  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreateLoading(true);
    try {
      const res = await fetch(`${API_BASE}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: newTitle.trim(),
          max_capacity: newCapacity,
          collab_mode: newCollabMode,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setShowCreate(false);
        setNewTitle('');
        setNewCapacity(50);
        setNewCollabMode('anonymous');
        scrollToRoomId.current = data.room.id;
        fetchRooms();
        showToast(`房间「${data.room.title}」创建成功，邀请码：${data.invite_code}`);
      } else {
        const data = await res.json();
        showToast(data.message || '创建失败');
      }
    } catch {
      showToast('网络错误');
    } finally {
      setCreateLoading(false);
    }
  };

  // ===== 删除房间 =====
  const handleDelete = async (e: React.MouseEvent, roomId: string) => {
    e.stopPropagation();
    if (!confirm(t('room.deleteConfirm'))) return;
    await fetch(`${API_BASE}/rooms/${roomId}`, { method: 'DELETE', credentials: 'include' });
    fetchRooms();
    showToast('房间已删除');
  };

  // ===== 编辑房间 =====
  const openEdit = (e: React.MouseEvent, room: Room) => {
    e.stopPropagation();
    setEditRoom(room);
    setEditTitle(room.title);
    setEditCapacity(room.max_capacity);
    setEditExpiresAt(room.finished_at
      ? new Date(room.finished_at).toISOString().split('T')[0]
      : '');
  };

  const handleEdit = async () => {
    if (!editRoom || !editTitle.trim()) return;
    setEditLoading(true);
    try {
      const res = await fetch(`${API_BASE}/rooms/${editRoom.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: editTitle.trim(),
          max_capacity: editCapacity,
          expires_at: editExpiresAt,
        }),
      });
      if (res.ok) {
        const targetId = editRoom.id;
        setEditRoom(null);
        scrollToRoomId.current = targetId;
        fetchRooms();
        showToast('房间信息已更新');
      } else {
        const data = await res.json();
        showToast(data.error || '更新失败');
      }
    } catch {
      showToast('网络错误');
    } finally {
      setEditLoading(false);
    }
  };

  // ===== 复制邀请码 =====
  const copyCode = (e: React.MouseEvent, code: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(''), 2000);
    });
  };

  // ===== 个人设置 =====
  const handleProfile = async () => {
    if (!profileName.trim() && !profileNewPwd) {
      showToast('请填写要修改的内容');
      return;
    }
    setProfileLoading(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          display_name: profileName.trim(),
          avatar_url: profileAvatarURL || undefined,
          old_password: profileOldPwd,
          new_password: profileNewPwd,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowProfile(false);
        const hadPasswordChange = profileNewPwd !== '';
        setProfileName('');
        setProfileOldPwd('');
        setProfileNewPwd('');
        if (hadPasswordChange) {
          showToast('密码已更新，请重新登录');
          setTimeout(() => { logout(); navigate('/login'); }, 1500);
        } else {
          showToast('显示名称已更新');
          checkAuth();
        }
      } else {
        showToast(data.error || '更新失败');
      }
    } catch {
      showToast('网络错误');
    } finally {
      setProfileLoading(false);
    }
  };

  // ===== 使用模板创建房间 =====
  const handleUseTemplate = async (templateId: string, templateName: string) => {
    setUseTemplateLoading(templateId);
    try {
      const res = await fetch(`${API_BASE}/templates/${templateId}/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: `基于「${templateName}」的新房间` }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast('已根据模板创建新房间');
        setActiveTab('rooms');
        scrollToRoomId.current = data.room?.id || null;
        fetchRooms();
      } else {
        const data = await res.json();
        showToast(data.error || '创建失败');
      }
    } catch {
      showToast('网络错误');
    } finally {
      setUseTemplateLoading(null);
    }
  };

  // ===== 删除模板 =====
  const handleDeleteTemplate = async (e: React.MouseEvent, templateId: string) => {
    e.stopPropagation();
    if (!confirm('确定删除此模板？')) return;
    setDeleteTemplateLoading(templateId);
    try {
      const res = await fetch(`${API_BASE}/templates/${templateId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setTemplates(prev => prev.filter(t => t.id !== templateId));
        showToast('模板已删除');
      } else {
        showToast('删除失败');
      }
    } catch {
      showToast('网络错误');
    } finally {
      setDeleteTemplateLoading(null);
    }
  };

  // 需求3：教师头像 Canvas 裁剪后上传
  const handleProfileAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > 2 * 1024 * 1024) {
      setProfileAvatarErr('图片不能超过 2MB');
      return;
    }
    setProfileAvatarUploading(true);
    setProfileAvatarErr('');
    try {
      const croppedBlob = await new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(url);
          const canvas = document.createElement('canvas');
          canvas.width = 200; canvas.height = 200;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('Canvas 不可用')); return; }
          const size = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width-size)/2, (img.height-size)/2, size, size, 0, 0, 200, 200);
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('处理失败')), 'image/jpeg', 0.85);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
        img.src = url;
      });
      const fd = new FormData();
      fd.append('avatar', croppedBlob, 'avatar.jpg');
      const res = await fetch('/api/upload/avatar', {
        method: 'POST', body: fd, credentials: 'include',
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || '上传失败');
      }
      const d = await res.json();
      setProfileAvatarURL(d.url);
      showToast('头像上传成功');
    } catch (err: unknown) {
      setProfileAvatarErr(err instanceof Error ? err.message : '上传失败');
    } finally {
      setProfileAvatarUploading(false);
    }
  };

  const handleLogout = async () => { await logout(); navigate('/login'); };

  // ===== 辅助函数 =====
  const capLabel = (c: number) =>
    c <= 30 ? '小班' : c <= 60 ? '中班' : c <= 100 ? '大班' : '超大班';

  const modeInfo = (m: string) =>
    ROOM_MODE_LABELS[m as keyof typeof ROOM_MODE_LABELS] || ROOM_MODE_LABELS['interactive'];

  const expiresLabel = (room: Room) => {
    if (!room.finished_at) return null;
    const exp = new Date(room.finished_at);
    const now = new Date();
    const days = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (days < 0) return (
      <span className="text-xs text-red-500 flex items-center gap-0.5">
        <Calendar size={10} />已过期
      </span>
    );
    if (days === 0) return (
      <span className="text-xs text-orange-500 flex items-center gap-0.5">
        <Calendar size={10} />今天到期
      </span>
    );
    return (
      <span className="text-xs text-gray-400 flex items-center gap-0.5">
        <Calendar size={10} />{days}天后到期
      </span>
    );
  };

  // 模板分类颜色
  const categoryColor = (cat: string) => {
    const map: Record<string, string> = {
      '语文': 'bg-red-100 text-red-700',
      '数学': 'bg-amber-100 text-amber-800',
      '英语': 'bg-green-100 text-green-700',
      '科学': 'bg-purple-100 text-purple-700',
      '历史': 'bg-yellow-100 text-yellow-700',
      '通用': 'bg-gray-100 text-gray-700',
    };
    return map[cat] || 'bg-gray-100 text-gray-600';
  };

  // ===== 渲染 =====
  return (
    <div className="min-h-screen">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-amber-700 text-white text-sm px-5 py-2.5 rounded-xl shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* 顶部导航 */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-700 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">MC</span>
            </div>
            <h1 className="text-lg font-semibold hidden sm:block">{t('app.name')}</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {/* ⭐ Phase8：作业评价中心入口 */}
            <button
              onClick={() => navigate('/assignments')}
              className="btn-secondary btn-sm flex items-center gap-1 text-xs sm:text-sm"
            >
              <BookOpen size={14} /> 作业评价
            </button>
            {/* REQ-026：AI对话入口（仅 chat_enabled 用户可见）*/}
            {user?.chat_enabled && (
              <button
                onClick={() => navigate('/chat')}
                className="btn-secondary btn-sm flex items-center gap-1 text-xs sm:text-sm"
              >
                <MessageSquare size={14} /> AI对话
              </button>
            )}
            {(isSuperAdmin || isAdmin) && (
              <button
                onClick={() => navigate('/admin')}
                className="btn-secondary btn-sm flex items-center gap-1 text-xs sm:text-sm"
              >
                <Settings size={14} />
                <span className="hidden sm:inline">管理后台</span>
              </button>
            )}
            <button
              onClick={() => {
                setProfileName(user?.display_name || '');
                setProfileAvatarURL(user?.avatar_url || '');
                setProfileAvatarErr('');
                setShowProfile(true);
              }}
              className="text-sm text-gray-500 hover:text-amber-700 flex items-center gap-1 transition-colors"
              title="个人设置"
            >
              <UserCircle size={16} />
              <span className="hidden sm:inline max-w-[120px] truncate">{user?.display_name}</span>
            </button>
            <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full hidden sm:block">
              {user?.role === 'superadmin' ? '超管' : user?.role === 'admin' ? '管理员' : '教师'}
            </span>
            <button onClick={handleLogout} className="text-gray-400 hover:text-gray-600">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Tab 切换：我的房间 / 模板中心 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex gap-1 bg-amber-50 rounded-xl p-1">
            <button
              onClick={() => setActiveTab('rooms')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'rooms'
                  ? 'bg-white text-amber-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <BookOpen size={15} />
              我的房间
              {rooms.length > 0 && (
                <span className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full">
                  {rooms.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('templates')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'templates'
                  ? 'bg-white text-amber-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <LayoutTemplate size={15} />
              模板中心
            </button>
          </div>

          {/* 右侧操作按钮 */}
          {activeTab === 'rooms' && (
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <Plus size={16} />
              <span>{t('room.create')}</span>
            </button>
          )}
        </div>

        {/* ===== 我的房间 Tab ===== */}
        {activeTab === 'rooms' && (
          <>
            {roomsLoading ? (
              <div className="flex justify-center py-20">
                <div className="spinner" />
              </div>
            ) : rooms.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <Users size={48} className="mx-auto mb-4 opacity-30" />
                <p className="text-lg">{t('room.noRooms')}</p>
                <p className="text-sm mt-2">点击「创建房间」开始你的第一堂课</p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="btn-primary mt-6 inline-flex items-center gap-2"
                >
                  <Plus size={16} /> 创建第一个房间
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {rooms.map(room => (
                  <div
                    key={room.id}
                    ref={el => { roomRefs.current.set(room.id, el); }}
                    className="card hover:shadow-md transition-all cursor-pointer group"
                    onClick={() => navigate(`/room/${room.id}`)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-lg flex-shrink-0">{modeInfo(room.room_mode).icon}</span>
                          <h3 className="font-semibold text-gray-900 group-hover:text-amber-800 transition-colors truncate">
                            {room.title}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            room.status === 'active'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}>
                            {room.status === 'active' ? t('room.active') : t('room.finished')}
                          </span>
                          {room.is_locked && (
                            <span className="text-xs text-orange-500 flex items-center gap-0.5">
                              <Lock size={12} />{t('room.locked')}
                            </span>
                          )}
                          <span className="text-xs text-gray-400">最多{room.max_capacity}人</span>
                          {expiresLabel(room)}
                        </div>
                      </div>
                      {/* 操作按钮（hover 显示） */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
                        <button
                          onClick={e => openEdit(e, room)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-amber-700 hover:bg-amber-50 transition-colors"
                          title="编辑房间"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={e => handleDelete(e, room.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="删除房间"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* 邀请码 */}
                    <div className="mt-4 flex items-center justify-between bg-amber-50 rounded-lg px-3 py-2">
                      <div>
                        <span className="text-xs text-gray-400">{t('room.inviteCode')}</span>
                        <div className="text-lg font-mono font-bold text-amber-800 tracking-widest">
                          {room.invite_code}
                        </div>
                      </div>
                      <button
                        onClick={e => copyCode(e, room.invite_code)}
                        className={`transition-colors ${
                          copied === room.invite_code
                            ? 'text-green-500'
                            : 'text-gray-400 hover:text-amber-700'
                        }`}
                      >
                        {copied === room.invite_code ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                    </div>
                    <div className="mt-3 text-xs text-gray-400">
                      创建于 {new Date(room.created_at).toLocaleString('zh-CN')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ===== 模板中心 Tab ===== */}
        {activeTab === 'templates' && (
          <>
            {templatesLoading ? (
              <div className="flex justify-center py-20">
                <div className="spinner" />
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <LayoutTemplate size={48} className="mx-auto mb-4 opacity-30" />
                <p className="text-lg">暂无模板</p>
                <p className="text-sm mt-2">
                  在房间内的「导出」区块可以将当前课堂保存为模板
                </p>
                <div className="mt-6 bg-amber-50 rounded-xl p-4 max-w-sm mx-auto text-left">
                  <p className="text-sm font-medium text-amber-800 mb-2">💡 如何创建模板</p>
                  <ol className="text-xs text-amber-800 space-y-1 list-decimal list-inside">
                    <li>进入任意房间</li>
                    <li>在右侧场控面板找到「保存模板」</li>
                    <li>填写模板名称和分类后保存</li>
                    <li>下次可在此处一键复用</li>
                  </ol>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 分我的模板 / 公开模板 两组 */}
                {['mine', 'public'].map(group => {
                  const groupTemplates = templates.filter(t =>
                    group === 'mine'
                      ? t.author_id === user?.id
                      : t.is_public && t.author_id !== user?.id
                  );
                  if (groupTemplates.length === 0) return null;
                  return (
                    <div key={group}>
                      <div className="flex items-center gap-2 mb-3">
                        {group === 'mine'
                          ? <Star size={15} className="text-yellow-500" />
                          : <Globe size={15} className="text-amber-600" />}
                        <h3 className="text-sm font-semibold text-gray-600">
                          {group === 'mine' ? '我的模板' : '公开模板'}
                        </h3>
                        <span className="text-xs text-gray-400">{groupTemplates.length}个</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {groupTemplates.map(tmpl => (
                          <div
                            key={tmpl.id}
                            className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-all"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1 min-w-0">
                                <h4 className="font-semibold text-gray-800 truncate">{tmpl.name}</h4>
                                {tmpl.description && (
                                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">
                                    {tmpl.description}
                                  </p>
                                )}
                              </div>
                              {group === 'mine' && (
                                <button
                                  onClick={e => handleDeleteTemplate(e, tmpl.id)}
                                  disabled={deleteTemplateLoading === tmpl.id}
                                  className="ml-2 p-1 rounded text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0"
                                  title="删除模板"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {tmpl.category && (
                                <span className={`text-xs px-2 py-0.5 rounded-full ${categoryColor(tmpl.category)}`}>
                                  {tmpl.category}
                                </span>
                              )}
                              {tmpl.tags?.slice(0, 2).map(tag => (
                                <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                                  {tag}
                                </span>
                              ))}
                              {tmpl.is_public && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 flex items-center gap-0.5">
                                  <Globe size={10} />公开
                                </span>
                              )}
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-gray-400">
                                使用 {tmpl.use_count} 次
                              </span>
                              <button
                                onClick={() => handleUseTemplate(tmpl.id, tmpl.name)}
                                disabled={useTemplateLoading === tmpl.id}
                                className="text-xs bg-amber-700 hover:bg-amber-800 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {useTemplateLoading === tmpl.id ? '创建中...' : '使用模板'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      {/* ===== 创建房间弹窗（已移除模式选择）===== */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-4">{t('room.create')}</h3>
            <div className="space-y-5">
              {/* 房间名称 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('room.title')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="input"
                  placeholder="例如：数学第一课、团队工作坊"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && newTitle.trim() && handleCreate()}
                />
              </div>
              {/* 人数容量 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('room.capacity')}
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    value={newCapacity}
                    onChange={e => setNewCapacity(Number(e.target.value))}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-amber-700"
                    min={10}
                    max={150}
                    step={10}
                  />
                  <div className="text-right min-w-[80px]">
                    <span className="text-2xl font-bold text-amber-800">{newCapacity}</span>
                    <span className="text-sm text-gray-400 ml-1">人</span>
                  </div>
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1 px-1">
                  <span>10人</span>
                  <span className="text-amber-700 font-medium">{capLabel(newCapacity)}</span>
                  <span>150人</span>
                </div>
              </div>
              {/* REQ-046 房间协作形态（身份/权限维度） */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  房间形态
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {COLLAB_MODE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setNewCollabMode(opt.value)}
                      className={`text-left rounded-xl border-2 px-4 py-3 transition-all ${
                        newCollabMode === opt.value
                          ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-100'
                          : 'border-gray-200 hover:border-amber-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-medium text-gray-800">
                        <span className="text-lg">{opt.icon}</span>
                        {opt.label}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 pl-7">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
              {/* 提示文案：模式可在进入房间后切换 */}
              <div className="bg-amber-50 rounded-xl px-4 py-3 text-xs text-amber-800">
                💡 所有房间支持白板、卡片、投票、词云、问答等全部功能，进入后可随时切换使用
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowCreate(false)} className="btn-secondary">
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreate}
                className="btn-primary"
                disabled={createLoading || !newTitle.trim()}
              >
                {createLoading ? '创建中...' : t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 编辑房间弹窗 ===== */}
      {editRoom && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-4">编辑房间</h3>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  房间名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="input"
                  placeholder="房间名称"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">最大容量</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    value={editCapacity}
                    onChange={e => setEditCapacity(Number(e.target.value))}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-amber-700"
                    min={10}
                    max={150}
                    step={10}
                  />
                  <div className="text-right min-w-[80px]">
                    <span className="text-2xl font-bold text-amber-800">{editCapacity}</span>
                    <span className="text-sm text-gray-400 ml-1">人</span>
                  </div>
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1 px-1">
                  <span>10人</span>
                  <span className="text-amber-700 font-medium">{capLabel(editCapacity)}</span>
                  <span>150人</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  有效期{' '}
                  <span className="text-gray-400 font-normal text-xs">（不设置则永久有效）</span>
                </label>
                <input
                  type="date"
                  value={editExpiresAt}
                  onChange={e => setEditExpiresAt(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="input"
                />
                {editExpiresAt && (
                  <button
                    onClick={() => setEditExpiresAt('')}
                    className="text-xs text-red-400 hover:text-red-600 mt-1"
                  >
                    清除有效期（设为永久）
                  </button>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setEditRoom(null)} className="btn-secondary">
                {t('common.cancel')}
              </button>
              <button
                onClick={handleEdit}
                className="btn-primary"
                disabled={editLoading || !editTitle.trim()}
              >
                {editLoading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 个人设置弹窗 ===== */}
      {showProfile && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-4">个人设置</h3>
            <div className="space-y-4">
              {/* 需求3：教师头像上传区域 */}
              <div className="flex items-center gap-4">
                <div className="relative flex-shrink-0">
                  {profileAvatarURL ? (
                    <img src={profileAvatarURL} alt="头像" className="w-16 h-16 rounded-full object-cover border-2 border-gray-200" />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center border-2 border-gray-200">
                      <UserCircle size={36} className="text-amber-600" />
                    </div>
                  )}
                  {profileAvatarUploading && (
                    <div className="absolute inset-0 rounded-full bg-black/30 flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 mb-1">头像</p>
                  <button
                    type="button"
                    onClick={() => profileAvatarInputRef.current?.click()}
                    disabled={profileAvatarUploading}
                    className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {profileAvatarUploading ? '上传中...' : '更换头像'}
                  </button>
                  <p className="text-xs text-gray-400 mt-1">JPG/PNG/WebP，最大 2MB</p>
                  {profileAvatarErr && <p className="text-xs text-red-500 mt-0.5">{profileAvatarErr}</p>}
                </div>
                <input
                  ref={profileAvatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleProfileAvatarChange}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">显示名称</label>
                <input
                  type="text"
                  value={profileName}
                  onChange={e => setProfileName(e.target.value)}
                  className="input"
                  placeholder="你的显示名称"
                />
              </div>
              <div className="border-t pt-4">
                <p className="text-sm font-medium text-gray-700 mb-3">
                  修改密码（不修改可留空）
                </p>
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      type={showOldPwd ? 'text' : 'password'}
                      value={profileOldPwd}
                      onChange={e => setProfileOldPwd(e.target.value)}
                      className="input pr-10"
                      placeholder="当前密码"
                    />
                    <button
                      type="button"
                      onClick={() => setShowOldPwd(!showOldPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showOldPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showNewPwd ? 'text' : 'password'}
                      value={profileNewPwd}
                      onChange={e => setProfileNewPwd(e.target.value)}
                      className="input pr-10"
                      placeholder="新密码"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPwd(!showNewPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showNewPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2">⚠️ 修改密码后需要重新登录</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowProfile(false);
                  setProfileOldPwd('');
                  setProfileNewPwd('');
                  setProfileAvatarErr('');
                }}
                className="btn-secondary"
              >
                取消
              </button>
              <button
                onClick={handleProfile}
                className="btn-primary"
                disabled={profileLoading}
              >
                {profileLoading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
