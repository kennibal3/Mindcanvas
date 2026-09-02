// =============================================================
// MindCanvas v3.0 - 管理后台页面
// 超管/管理员：租户管理、用户管理
// 新增（需求5）：房间统计 Tab，展示每位教师的房间数量和使用情况
//   - 支持按机构筛选（超管）
//   - 支持按房间数排序
//   - 支持导出 CSV
//   - 点击展开查看该教师的房间列表
// =============================================================
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  ArrowLeft, Building, Users, Shield, Plus, UserPlus,
  ToggleLeft, ToggleRight, X, BarChart2, ChevronDown,
  ChevronUp, Download, RefreshCw, BookOpen,
} from 'lucide-react';

const API_BASE = '/api';

// ===== 类型定义 =====
interface TeacherRoomStat {
  teacher_id: string;
  username: string;
  display_name: string;
  tenant_name: string;
  total_rooms: number;
  active_rooms: number;
  last_active_str: string;
}

interface RoomRow {
  id: string;
  title: string;
  invite_code: string;
  status: string;
  is_locked: boolean;
  max_capacity: number;
  created_at: string;
  updated_at: string;
}

// Tab 类型
type AdminTab = 'tenants' | 'users' | 'room-stats';

const AdminPage = () => {
  const navigate = useNavigate();
  const { user, isSuperAdmin, isAdmin } = useAuth();
  const [tab, setTab] = useState<AdminTab>(isSuperAdmin ? 'tenants' : 'users');

  // ========== 租户状态 ==========
  const [tenants, setTenants] = useState<any[]>([]);
  const [showCreateTenant, setShowCreateTenant] = useState(false);
  const [tenantForm, setTenantForm] = useState({
    name: '',
    max_teachers: 50,
    max_rooms: 100,
  });
  const [tenantError, setTenantError] = useState('');
  const [tenantLoading, setTenantLoading] = useState(false);

  // ========== 用户状态 ==========
  const [users, setUsers] = useState<any[]>([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    display_name: '',
    role: 'teacher' as string,
    tenant_id: '',
  });
  const [userError, setUserError] = useState('');
  const [userLoading, setUserLoading] = useState(false);

  // ========== 房间统计状态 ==========
  const [roomStats, setRoomStats] = useState<TeacherRoomStat[]>([]);
  const [roomStatsLoading, setRoomStatsLoading] = useState(false);
  const [filterTenantId, setFilterTenantId] = useState('');
  const [sortField, setSortField] = useState<'total_rooms' | 'active_rooms'>('total_rooms');
  // 展开某个教师的房间详情
  const [expandedTeacherId, setExpandedTeacherId] = useState<string | null>(null);
  const [teacherRooms, setTeacherRooms] = useState<Record<string, RoomRow[]>>({});
  const [teacherRoomsLoading, setTeacherRoomsLoading] = useState<string | null>(null);

  // ========== 通用提示 ==========
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // ========== 数据获取 ==========
  const fetchTenants = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/tenants`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTenants(data.tenants || []);
      }
    } catch (err) {
      console.error('获取租户列表失败:', err);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/users`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error('获取用户列表失败:', err);
    }
  }, []);

  // 获取房间统计
  const fetchRoomStats = useCallback(async () => {
    setRoomStatsLoading(true);
    try {
      let url = `${API_BASE}/admin/room-stats`;
      if (filterTenantId) url += `?tenant_id=${filterTenantId}`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setRoomStats(data.stats || []);
      }
    } catch (err) {
      console.error('获取房间统计失败:', err);
    } finally {
      setRoomStatsLoading(false);
    }
  }, [filterTenantId]);

  // 展开/收起某教师的房间列表
  const toggleTeacherRooms = useCallback(async (teacherId: string) => {
    if (expandedTeacherId === teacherId) {
      // 收起
      setExpandedTeacherId(null);
      return;
    }
    setExpandedTeacherId(teacherId);
    // 已加载则不重复请求
    if (teacherRooms[teacherId]) return;

    setTeacherRoomsLoading(teacherId);
    try {
      const res = await fetch(
        `${API_BASE}/admin/room-stats/${teacherId}/rooms`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setTeacherRooms(prev => ({ ...prev, [teacherId]: data.rooms || [] }));
      }
    } catch (err) {
      console.error('获取教师房间列表失败:', err);
    } finally {
      setTeacherRoomsLoading(null);
    }
  }, [expandedTeacherId, teacherRooms]);

  // 导出房间统计 CSV
  const exportRoomStatsCSV = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/room-stats/export`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('导出失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `房间统计_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('导出成功');
    } catch {
      showToast('导出失败，请重试');
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) fetchTenants();
    fetchUsers();
  }, [isSuperAdmin, fetchTenants, fetchUsers]);

  // 切换到房间统计 Tab 时自动加载
  useEffect(() => {
    if (tab === 'room-stats') {
      fetchRoomStats();
    }
  }, [tab, fetchRoomStats]);

  // ========== 创建租户 ==========
  const handleCreateTenant = async () => {
    if (!tenantForm.name.trim()) {
      setTenantError('请输入租户名称');
      return;
    }
    setTenantLoading(true);
    setTenantError('');
    try {
      const res = await fetch(`${API_BASE}/admin/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(tenantForm),
      });
      const data = await res.json();
      if (res.ok) {
        setShowCreateTenant(false);
        setTenantForm({ name: '', max_teachers: 50, max_rooms: 100 });
        fetchTenants();
        showToast(`租户「${data.tenant.name}」创建成功`);
      } else {
        setTenantError(data.message || data.error || '创建失败');
      }
    } catch {
      setTenantError('网络错误，请重试');
    } finally {
      setTenantLoading(false);
    }
  };

  // ========== 启禁租户 ==========
  const toggleTenant = async (tenantId: string, currentActive: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/admin/tenants/${tenantId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_active: !currentActive }),
      });
      if (res.ok) {
        fetchTenants();
        showToast(currentActive ? '已禁用租户' : '已启用租户');
      }
    } catch (err) {
      console.error('切换租户状态失败:', err);
    }
  };

  // ========== 创建用户 ==========
  const handleCreateUser = async () => {
    if (!userForm.username.trim()) { setUserError('请输入用户名'); return; }
    if (!userForm.password || userForm.password.length < 8) { setUserError('密码至少8位'); return; }
    if (userForm.role !== 'superadmin' && !userForm.tenant_id) { setUserError('请选择所属租户'); return; }
    setUserLoading(true);
    setUserError('');
    try {
      const body: any = {
        username: userForm.username.trim(),
        password: userForm.password,
        display_name: userForm.display_name.trim() || userForm.username.trim(),
        role: userForm.role,
      };
      if (userForm.role !== 'superadmin') body.tenant_id = userForm.tenant_id;

      const res = await fetch(`${API_BASE}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setShowCreateUser(false);
        setUserForm({ username: '', password: '', display_name: '', role: 'teacher', tenant_id: '' });
        fetchUsers();
        showToast(`用户「${data.user.display_name}」创建成功`);
      } else {
        setUserError(data.message || data.error || '创建失败');
      }
    } catch {
      setUserError('网络错误，请重试');
    } finally {
      setUserLoading(false);
    }
  };

  // ========== Chat 权限 ==========
  const toggleUserChat = async (userId: string, currentEnabled: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/chat`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ chat_enabled: !currentEnabled }),
      });
      if (res.ok) {
        setUsers((prev: any[]) => prev.map(u => u.id === userId ? { ...u, chat_enabled: !currentEnabled } : u));
      
      } else {
        alert('AI对话权限更新失败，状态码: ' + res.status);
      }
    } catch (err) { console.error('切换Chat权限失败:', err); alert('切换失败（网络错误）: ' + err); }
  };
  // ========== 智能体权限（REQ-062，与 Chat 权限刻意分开，见后端 UpdateUserAgent 注释）==========
  const toggleUserAgent = async (userId: string, currentEnabled: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/agent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ agent_enabled: !currentEnabled }),
      });
      if (res.ok) {
        setUsers((prev: any[]) => prev.map(u => u.id === userId ? { ...u, agent_enabled: !currentEnabled } : u));
      } else {
        alert('智能体权限更新失败，状态码: ' + res.status);
      }
    } catch (err) { console.error('切换智能体权限失败:', err); alert('切换失败（网络错误）: ' + err); }
  };
  // ========== 启禁用户 ==========
  const toggleUser = async (userId: string, currentActive: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_active: !currentActive }),
      });
      if (res.ok) {
        fetchUsers();
        showToast(currentActive ? '已禁用用户' : '已启用用户');
      }
    } catch (err) {
      console.error('切换用户状态失败:', err);
    }
  };

  // ========== 辅助函数 ==========
  const roleLabel = (role: string) => {
    const labels: Record<string, string> = {
      superadmin: '超级管理员',
      admin: '管理员',
      teacher: '教师',
    };
    return labels[role] || role;
  };

  const roleBadgeColor = (role: string) => {
    const colors: Record<string, string> = {
      superadmin: 'bg-purple-100 text-purple-700',
      admin: 'bg-amber-100 text-amber-800',
      teacher: 'bg-green-100 text-green-700',
    };
    return colors[role] || 'bg-gray-100 text-gray-700';
  };

  const availableRoles = () => {
    if (isSuperAdmin) return ['admin', 'teacher'];
    if (isAdmin) return ['teacher'];
    return [];
  };

  // 房间统计：排序后的数据
  const sortedStats = [...roomStats].sort((a, b) => b[sortField] - a[sortField]);

  // ===== 渲染 =====
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast 提示 */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-green-500 text-white text-sm px-5 py-2.5 rounded-xl shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* 顶部导航 */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate('/dashboard')} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={20} />
          </button>
          <Shield size={20} className="text-amber-700" />
          <h1 className="text-lg font-semibold">管理后台</h1>
          <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full">
            {roleLabel(user?.role || '')}
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* ===== Tab 切换 ===== */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
            {isSuperAdmin && (
              <button
                onClick={() => setTab('tenants')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5
                  ${tab === 'tenants' ? 'bg-white shadow-sm text-amber-800' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <Building size={14} /> 租户管理
              </button>
            )}
            <button
              onClick={() => setTab('users')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5
                ${tab === 'users' ? 'bg-white shadow-sm text-amber-800' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Users size={14} /> 用户管理
            </button>
            {/* 需求5：房间统计 Tab */}
            <button
              onClick={() => setTab('room-stats')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5
                ${tab === 'room-stats' ? 'bg-white shadow-sm text-amber-800' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <BarChart2 size={14} /> 房间统计
            </button>
          </div>

          {/* 操作按钮 */}
          <div>
            {tab === 'tenants' && isSuperAdmin && (
              <button onClick={() => setShowCreateTenant(true)} className="btn-primary flex items-center gap-2">
                <Plus size={16} /> 添加学校/机构
              </button>
            )}
            {tab === 'users' && availableRoles().length > 0 && (
              <button onClick={() => {
                setShowCreateUser(true);
                if (isAdmin && user?.tenant_id) {
                  setUserForm(prev => ({ ...prev, tenant_id: user.tenant_id }));
                } else if (tenants.length === 1) {
                  setUserForm(prev => ({ ...prev, tenant_id: tenants[0].id }));
                }
              }} className="btn-primary flex items-center gap-2">
                <UserPlus size={16} /> 添加用户
              </button>
            )}
            {tab === 'room-stats' && (
              <div className="flex gap-2">
                <button
                  onClick={fetchRoomStats}
                  disabled={roomStatsLoading}
                  className="btn-secondary flex items-center gap-1.5 text-sm"
                >
                  <RefreshCw size={14} className={roomStatsLoading ? 'animate-spin' : ''} />
                  刷新
                </button>
                <button
                  onClick={exportRoomStatsCSV}
                  className="btn-primary flex items-center gap-1.5 text-sm"
                >
                  <Download size={14} /> 导出 CSV
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ========== 创建租户弹窗 ========== */}
        {showCreateTenant && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">添加学校/机构</h3>
                <button onClick={() => { setShowCreateTenant(false); setTenantError(''); }} className="text-gray-400 hover:text-gray-600">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    学校/机构名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={tenantForm.name}
                    onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })}
                    className="input"
                    placeholder="例如：北京大学"
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">最大教师数</label>
                    <input
                      type="number"
                      value={tenantForm.max_teachers}
                      onChange={(e) => setTenantForm({ ...tenantForm, max_teachers: Number(e.target.value) })}
                      className="input" min={1} max={500}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">最大房间数</label>
                    <input
                      type="number"
                      value={tenantForm.max_rooms}
                      onChange={(e) => setTenantForm({ ...tenantForm, max_rooms: Number(e.target.value) })}
                      className="input" min={1} max={1000}
                    />
                  </div>
                </div>
              </div>
              {tenantError && (
                <div className="mt-3 bg-red-50 text-red-600 text-sm px-4 py-2 rounded-lg">{tenantError}</div>
              )}
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => { setShowCreateTenant(false); setTenantError(''); }} className="btn-secondary">取消</button>
                <button onClick={handleCreateTenant} className="btn-primary" disabled={tenantLoading || !tenantForm.name.trim()}>
                  {tenantLoading ? '创建中...' : '创建'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========== 创建用户弹窗 ========== */}
        {showCreateUser && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">添加用户</h3>
                <button onClick={() => { setShowCreateUser(false); setUserError(''); }} className="text-gray-400 hover:text-gray-600">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    用户名 <span className="text-red-500">*</span>
                  </label>
                  <input type="text" value={userForm.username}
                    onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                    className="input" placeholder="3-30位字母、数字或下划线" autoFocus />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    密码 <span className="text-red-500">*</span>
                  </label>
                  <input type="text" value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                    className="input" placeholder="至少8位" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">显示名称</label>
                  <input type="text" value={userForm.display_name}
                    onChange={(e) => setUserForm({ ...userForm, display_name: e.target.value })}
                    className="input" placeholder="不填则使用用户名" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    角色 <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-3">
                    {availableRoles().map((role) => (
                      <button key={role} type="button"
                        onClick={() => setUserForm({ ...userForm, role })}
                        className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border-2 transition-all
                          ${userForm.role === role
                            ? 'border-amber-500 bg-amber-50 text-amber-800'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                        {roleLabel(role)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    所属学校/机构 <span className="text-red-500">*</span>
                  </label>
                  {isAdmin && user?.tenant_id ? (
                    <div className="input bg-gray-50 text-gray-500 cursor-not-allowed">
                      {tenants.find(t => t.id === user.tenant_id)?.name || '本机构'}
                    </div>
                  ) : (
                    <select value={userForm.tenant_id}
                      onChange={(e) => setUserForm({ ...userForm, tenant_id: e.target.value })}
                      className="input">
                      <option value="">请选择学校/机构</option>
                      {tenants.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  )}
                  {tenants.length === 0 && isSuperAdmin && (
                    <p className="text-xs text-orange-500 mt-1">
                      暂无租户，请先到「租户管理」创建学校/机构
                    </p>
                  )}
                </div>
              </div>
              {userError && (
                <div className="mt-3 bg-red-50 text-red-600 text-sm px-4 py-2 rounded-lg">{userError}</div>
              )}
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => { setShowCreateUser(false); setUserError(''); }} className="btn-secondary">取消</button>
                <button onClick={handleCreateUser} className="btn-primary" disabled={userLoading || !userForm.username.trim()}>
                  {userLoading ? '创建中...' : '创建'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========== 租户列表 ========== */}
        {tab === 'tenants' && isSuperAdmin && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">学校/机构列表</h3>
              <span className="text-xs text-gray-400">共 {tenants.length} 个</span>
            </div>
            {tenants.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Building size={40} className="mx-auto mb-3 opacity-30" />
                <p>暂无学校/机构</p>
                <p className="text-xs mt-1">点击右上角「添加学校/机构」创建</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 font-medium text-gray-500">名称</th>
                    <th className="text-left py-2 font-medium text-gray-500">最大教师数</th>
                    <th className="text-left py-2 font-medium text-gray-500">最大房间数</th>
                    <th className="text-left py-2 font-medium text-gray-500">状态</th>
                    <th className="text-left py-2 font-medium text-gray-500">创建时间</th>
                    <th className="text-right py-2 font-medium text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 font-medium">{t.name}</td>
                      <td className="py-3">{t.max_teachers}</td>
                      <td className="py-3">{t.max_rooms}</td>
                      <td className="py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {t.is_active ? '启用' : '禁用'}
                        </span>
                      </td>
                      <td className="py-3 text-gray-400">{new Date(t.created_at).toLocaleDateString('zh-CN')}</td>
                      <td className="py-3 text-right">
                        <button onClick={() => toggleTenant(t.id, t.is_active)}
                          className={`text-xs px-3 py-1 rounded-md transition-colors ${t.is_active ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}>
                          {t.is_active
                            ? <span className="flex items-center gap-1"><ToggleRight size={14} /> 禁用</span>
                            : <span className="flex items-center gap-1"><ToggleLeft size={14} /> 启用</span>}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ========== 用户列表 ========== */}
        {tab === 'users' && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">用户列表</h3>
              <span className="text-xs text-gray-400">共 {users.length} 个</span>
            </div>
            {users.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Users size={40} className="mx-auto mb-3 opacity-30" />
                <p>暂无用户</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 font-medium text-gray-500">用户名</th>
                    <th className="text-left py-2 font-medium text-gray-500">显示名</th>
                    <th className="text-left py-2 font-medium text-gray-500">角色</th>
                    <th className="text-left py-2 font-medium text-gray-500">所属机构</th>
                    <th className="text-left py-2 font-medium text-gray-500">状态</th>
                    <th className="text-left py-2 font-medium text-gray-500">创建时间</th>
                    <th className="text-left py-2 font-medium text-gray-500">AI对话</th>
                    <th className="text-left py-2 font-medium text-gray-500">智能体</th>
                    <th className="text-right py-2 font-medium text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 font-mono text-sm">{u.username}</td>
                      <td className="py-3">{u.display_name}</td>
                      <td className="py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${roleBadgeColor(u.role)}`}>
                          {roleLabel(u.role)}
                        </span>
                      </td>
                      <td className="py-3 text-gray-400 text-xs">{u.tenant_name || '-'}</td>
                      <td className="py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {u.is_active ? '正常' : '禁用'}
                        </span>
                      </td>
                      <td className="py-3 text-gray-400">{new Date(u.created_at).toLocaleDateString('zh-CN')}</td>
                                            <td className="py-3">
                        <div className="flex flex-col items-center gap-0.5">
                          <button
                            onClick={() => toggleUserChat(u.id, !!u.chat_enabled)}
                            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${u.chat_enabled ? "bg-green-500" : "bg-gray-300"}`}
                          >
                            <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition duration-200 ease-in-out ${u.chat_enabled ? "translate-x-4" : "translate-x-0"}`} />
                          </button>
                          <span className={`text-xs ${u.chat_enabled ? "text-green-600" : "text-gray-400"}`}>
                            {u.chat_enabled ? "已开通" : "未开通"}
                          </span>
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-col items-center gap-0.5">
                          <button
                            onClick={() => toggleUserAgent(u.id, !!u.agent_enabled)}
                            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${u.agent_enabled ? "bg-green-500" : "bg-gray-300"}`}
                          >
                            <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition duration-200 ease-in-out ${u.agent_enabled ? "translate-x-4" : "translate-x-0"}`} />
                          </button>
                          <span className={`text-xs ${u.agent_enabled ? "text-green-600" : "text-gray-400"}`}>
                            {u.agent_enabled ? "已开通" : "未开通"}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 text-right">
                        {u.id !== user?.id && u.role !== 'superadmin' && (
                          <button onClick={() => toggleUser(u.id, u.is_active)}
                            className={`text-xs px-3 py-1 rounded-md transition-colors ${u.is_active ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}>
                            {u.is_active
                              ? <span className="flex items-center gap-1"><ToggleRight size={14} /> 禁用</span>
                              : <span className="flex items-center gap-1"><ToggleLeft size={14} /> 启用</span>}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ========== 房间统计 Tab（需求5）========== */}
        {tab === 'room-stats' && (
          <div className="space-y-4">

            {/* 筛选和排序工具栏 */}
            <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3">
              {/* 按机构筛选（仅超管） */}
              {isSuperAdmin && tenants.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">机构：</span>
                  <select
                    value={filterTenantId}
                    onChange={e => setFilterTenantId(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-200"
                  >
                    <option value="">全部机构</option>
                    {tenants.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* 排序方式 */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">排序：</span>
                <div className="flex rounded-lg overflow-hidden border border-gray-200">
                  <button
                    onClick={() => setSortField('total_rooms')}
                    className={`text-xs px-3 py-1 transition-colors ${
                      sortField === 'total_rooms'
                        ? 'bg-amber-700 text-white'
                        : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    总房间数
                  </button>
                  <button
                    onClick={() => setSortField('active_rooms')}
                    className={`text-xs px-3 py-1 transition-colors ${
                      sortField === 'active_rooms'
                        ? 'bg-amber-700 text-white'
                        : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    活跃房间
                  </button>
                </div>
              </div>

              <span className="text-xs text-gray-400 ml-auto">
                共 {roomStats.length} 位教师
              </span>
            </div>

            {/* 加载中 */}
            {roomStatsLoading && (
              <div className="text-center py-16">
                <RefreshCw size={24} className="animate-spin mx-auto mb-3 text-amber-500" />
                <p className="text-sm text-gray-400">正在加载统计数据...</p>
              </div>
            )}

            {/* 空状态 */}
            {!roomStatsLoading && roomStats.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <BarChart2 size={40} className="mx-auto mb-3 opacity-30" />
                <p>暂无教师数据</p>
                <p className="text-xs mt-1">请先在「用户管理」中创建教师账号</p>
              </div>
            )}

            {/* 统计列表 */}
            {!roomStatsLoading && sortedStats.length > 0 && (
              <div className="space-y-2">
                {sortedStats.map(stat => (
                  <div key={stat.teacher_id} className="bg-white border border-gray-100 rounded-xl overflow-hidden">

                    {/* 主行：教师信息 + 统计数字 */}
                    <div
                      className="flex items-center px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => toggleTeacherRooms(stat.teacher_id)}
                    >
                      {/* 教师信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-800 text-sm">{stat.display_name}</span>
                          <span className="text-xs text-gray-400 font-mono">@{stat.username}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400 flex items-center gap-0.5">
                            <Building size={10} />{stat.tenant_name}
                          </span>
                          <span className="text-xs text-gray-300">·</span>
                          <span className="text-xs text-gray-400">
                            最近活跃：{stat.last_active_str}
                          </span>
                        </div>
                      </div>

                      {/* 统计数字 */}
                      <div className="flex items-center gap-4 flex-shrink-0 mx-4">
                        <div className="text-center">
                          <div className="text-lg font-bold text-amber-800">{stat.total_rooms}</div>
                          <div className="text-xs text-gray-400">总房间</div>
                        </div>
                        <div className="text-center">
                          <div className={`text-lg font-bold ${stat.active_rooms > 0 ? 'text-green-600' : 'text-gray-300'}`}>
                            {stat.active_rooms}
                          </div>
                          <div className="text-xs text-gray-400">活跃</div>
                        </div>
                      </div>

                      {/* 展开箭头 */}
                      <div className="flex-shrink-0">
                        {stat.total_rooms > 0 ? (
                          expandedTeacherId === stat.teacher_id
                            ? <ChevronUp size={16} className="text-gray-400" />
                            : <ChevronDown size={16} className="text-gray-400" />
                        ) : (
                          <span className="text-xs text-gray-300">无房间</span>
                        )}
                      </div>
                    </div>

                    {/* 展开的房间列表 */}
                    {expandedTeacherId === stat.teacher_id && stat.total_rooms > 0 && (
                      <div className="border-t border-gray-100 bg-gray-50">
                        {teacherRoomsLoading === stat.teacher_id ? (
                          <div className="py-4 text-center text-xs text-gray-400">
                            <RefreshCw size={14} className="animate-spin mx-auto mb-1" />
                            加载中...
                          </div>
                        ) : (
                          <div className="divide-y divide-gray-100">
                            {(teacherRooms[stat.teacher_id] || []).map(room => (
                              <div key={room.id} className="flex items-center px-6 py-2.5 text-xs">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <BookOpen size={11} className="text-gray-400 flex-shrink-0" />
                                    <span className="font-medium text-gray-700 truncate">{room.title}</span>
                                    <span className="text-gray-400 font-mono flex-shrink-0">{room.invite_code}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                                  <span className={`px-2 py-0.5 rounded-full ${
                                    room.status === 'active'
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-gray-100 text-gray-500'
                                  }`}>
                                    {room.status === 'active' ? '活跃' : '已结束'}
                                  </span>
                                  <span className="text-gray-400">最多{room.max_capacity}人</span>
                                  <span className="text-gray-400">
                                    {new Date(room.updated_at).toLocaleDateString('zh-CN')}
                                  </span>
                                </div>
                              </div>
                            ))}
                            {(teacherRooms[stat.teacher_id] || []).length === 0 && (
                              <div className="py-4 text-center text-xs text-gray-400">该教师暂无房间</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminPage;
