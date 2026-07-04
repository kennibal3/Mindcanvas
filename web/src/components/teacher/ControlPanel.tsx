// =============================================================
// MindCanvas v4.1 - 教师控制面板
// REQ-006修复：将window.confirm替换为React内联确认Modal
//             handleSetReadOnly和handleKick均使用React Modal
// REQ-009修复：跟随模式开启时通过WebSocket通知学生端显示横幅
// REQ-010修复：召集视角成功后显示Toast反馈
// =============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, ChevronRight, Wifi, WifiOff,
  Lock, Unlock, Navigation, Eye, EyeOff,
  Radio, Palette, Sun,
  Download, Loader2, BookOpen, Share2,
  LayoutTemplate, FileText, AlertTriangle, X,
} from 'lucide-react';

// 自定义 RadioOff 图标
const RadioOff = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="2"/>
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49"/>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
    <line x1="2" y1="2" x2="22" y2="22"/>
  </svg>
);

import { useRoomStore } from '@/store/roomStore';
import { useCanvasStore } from '@/store/canvasStore';
import MemberList from './MemberList';
import WidgetToolbar from './WidgetToolbar';
import SummaryPanel from './SummaryPanel';
import InsightPanel from './InsightPanel';
import { GroupPanel } from './GroupPanel';
import FlowController from './FlowController';
import FlowEditor from './FlowEditor';
import SharePublishModal from '@/components/share/SharePublishModal';
import type { TeachingFlow } from '@/types/flow';
import type { CanvasElement } from '@/types/canvas';

const API_BASE = '/api';

// 画布背景颜色选项
const BACKGROUND_COLORS = [
  { value: '#ffffff', label: '纯白' },
  { value: '#f8f9fa', label: '浅灰' },
  { value: '#fef9e7', label: '暖黄' },
  { value: '#eafaf1', label: '浅绿' },
  { value: '#eaf4fb', label: '浅蓝' },
  { value: '#f5eef8', label: '浅紫' },
  { value: '#fdf2f8', label: '浅粉' },
  { value: '#1a1a2e', label: '深蓝' },
];

type ThemeMode = 'light' | 'eye';
type ControlTab = 'control' | 'flow' | 'group';

interface ControlPanelProps {
  roomId: string;
  sendMessage: (type: string, payload: Record<string, any>) => void;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  excalidrawAPI?: any;
  onReadOnlyChange?: (readonly: boolean) => void;
  onFollowModeChange?: (follow: boolean) => void;
}

// =============================================================
// REQ-006：React内联确认对话框（替代window.confirm）
// 白色圆角卡片，不冻结页面，与整体UI风格一致
// =============================================================
interface ConfirmModalProps {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  confirmClass?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal = ({
  title, description, confirmText = '确认', cancelText = '取消',
  confirmClass = 'bg-red-500 hover:bg-red-600 text-white',
  onConfirm, onCancel,
}: ConfirmModalProps) => (
  // z-[2147483647]确保覆盖Excalidraw层
  <div
    className="fixed inset-0 bg-black/50 flex items-center justify-center animate-fade-in"
    style={{ zIndex: 2147483647 }}
  >
    <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0">
          <AlertTriangle size={20} className="text-amber-500" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-800">{title}</h3>
          <p className="text-sm text-gray-500 mt-1">{description}</p>
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
        >
          {cancelText}
        </button>
        <button
          onClick={onConfirm}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${confirmClass}`}
        >
          {confirmText}
        </button>
      </div>
    </div>
  </div>
);

// ===== 保存模板弹窗（内联小弹窗）=====
interface SaveTemplateModalProps {
  roomId: string;
  onClose: () => void;
  onSaved: () => void;
}

const SaveTemplateModal = ({ roomId, onClose, onSaved }: SaveTemplateModalProps) => {
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory]       = useState('通用');
  const [isPublic, setIsPublic]       = useState(false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const CATEGORIES = ['通用', '语文', '数学', '英语', '科学', '历史', '社会', '艺术', '其他'];

  const handleSave = async () => {
    if (!name.trim()) { setError('请输入模板名称'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/rooms/${roomId}/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          category,
          is_public: isPublic,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || '保存失败');
      }
      onSaved();
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center animate-fade-in"
      style={{ zIndex: 2147483647 }}
    >
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <LayoutTemplate size={16} className="text-amber-700" />
            保存为模板
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              模板名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-amber-300"
              placeholder="例如：期末复习课模板"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">描述（选填）</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none
                         focus:outline-none focus:ring-2 focus:ring-amber-300"
              placeholder="模板适用场景、包含哪些互动组件..."
              rows={2}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">分类</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-amber-300"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={e => setIsPublic(e.target.checked)}
              className="rounded border-gray-300 text-amber-700"
            />
            <span className="text-xs text-gray-600">公开此模板（其他教师可使用）</span>
          </label>
          {error && <p className="text-xs text-red-500 flex items-center gap-1">⚠️ {error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary text-sm px-4 py-2">取消</button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存模板'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ===== 主面板 =====
const ControlPanel = ({
  roomId, sendMessage, connectionStatus, excalidrawAPI,
  onReadOnlyChange, onFollowModeChange,
}: ControlPanelProps) => {
  const { t } = useTranslation();

  const members     = useRoomStore(s => s.members);
  const elements    = useRoomStore(s => s.elements) as CanvasElement[];
  const isLocked    = useRoomStore(s => s.isLocked);
  const isReadOnly  = useRoomStore(s => s.isReadOnly);
  const currentRoom = useRoomStore(s => s.currentRoom);
  const transform   = useCanvasStore(s => s.transform);

  // UI 状态
  const [collapsed, setCollapsed]           = useState(false);
  const [activeTab, setActiveTab]           = useState<ControlTab>('control');
  const [actionLoading, setActionLoading]   = useState<string | null>(null);
  const [exportLoading, setExportLoading]   = useState<string | null>(null);
  const [toast, setToast]                   = useState('');
  const [isFollowMode, setFollowMode]       = useState(false);
  // REQ-021：多用户光标模式（人数<=10时可开启）
  const [cursorModeOn, setCursorModeOn]     = useState(false);
  const [showThemePanel, setShowThemePanel] = useState(false);
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [showFlowEditor, setShowFlowEditor] = useState(false);
  const [currentFlow, setCurrentFlow]       = useState<TeachingFlow | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  // REQ-006：React确认弹窗状态（替代window.confirm）
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    description: string;
    confirmText?: string;
    confirmClass?: string;
    onConfirm: () => void;
  } | null>(null);

  // REQ-012：踢人/封禁待操作目标
  const [pendingKick, setPendingKick] = useState<{ uuid: string; nickname: string } | null>(null);

  const followTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // 跟随模式定时广播
  // REQ-009：开启跟随模式时，通知学生端显示「教师正在引导视角」横幅
  useEffect(() => {
    if (isFollowMode) {
      // 通知学生端开启跟随横幅
      sendMessage('ctrl_follow_mode', { enabled: true });

      followTimerRef.current = setInterval(() => {
        if (!excalidrawAPI) return;
        const appState = excalidrawAPI.getAppState?.();
        if (!appState) return;
        sendMessage('ctrl_follow_sync', {
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          zoom:    appState.zoom,
        });
      }, 500);
    } else {
      if (followTimerRef.current) {
        clearInterval(followTimerRef.current);
        followTimerRef.current = null;
      }
      // 通知学生端关闭跟随横幅
      sendMessage('ctrl_follow_mode', { enabled: false });
    }
    return () => {
      if (followTimerRef.current) clearInterval(followTimerRef.current);
    };
  }, [isFollowMode, sendMessage, excalidrawAPI]);

  // 背景色修改
  const handleBgChange = useCallback((color: string) => {
    setBackgroundColor(color);
    useCanvasStore.getState().setBackgroundColor(color);
  }, []);

  // 通用 API 调用
  const callAPI = useCallback(
    async (endpoint: string, method = 'PUT', body?: any) => {
      try {
        const res = await fetch(`${API_BASE}/rooms/${roomId}${endpoint}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '操作失败');
        }
        return await res.json();
      } catch (err: any) {
        showToast(`错误: ${err.message}`);
        throw err;
      }
    },
    [roomId]
  );

  // 锁定/解锁
  const handleToggleLock = useCallback(async () => {
    setActionLoading('lock');
    try {
      await callAPI('/lock', 'PUT', { is_locked: !isLocked });
      showToast(isLocked ? '画布已解锁' : '画布已锁定');
    } finally { setActionLoading(null); }
  }, [isLocked, callAPI]);

  // 召集视角 - REQ-010：显示成功Toast
  const handleGather = useCallback(async () => {
    setActionLoading('gather');
    try {
      await callAPI('/gather', 'POST', {
        viewport_x: transform.scrollX,
        viewport_y: transform.scrollY,
        zoom:       transform.zoom,
      });
      // REQ-010：教师端召集后显示Toast
      showToast('✅ 已召集全部学生视角');
    } finally { setActionLoading(null); }
  }, [transform, callAPI]);

  // REQ-006：只读模式 - 使用React Modal替代window.confirm
  const handleSetReadOnly = useCallback(() => {
    setConfirmModal({
      title: '设为只读模式',
      description: '课程结束后学生只能浏览画布，无法继续编辑。确定要设为只读模式吗？',
      confirmText: '确认只读',
      confirmClass: 'bg-orange-500 hover:bg-orange-600 text-white',
      onConfirm: async () => {
        setConfirmModal(null);
        setActionLoading('readonly');
        try {
          await callAPI('/readonly', 'PUT', { is_readonly: true });
          showToast('已设为只读模式');
        } catch {}
        finally { setActionLoading(null); }
      },
    });
  }, [callAPI]);

  // REQ-006：踢人 - 使用React Modal替代window.confirm
  const handleKick = useCallback((uuid: string, nickname: string) => {
    setPendingKick({ uuid, nickname });
    setConfirmModal({
      title: '踢出学生',
      description: `确认将「${nickname}」移出本次课堂？该学生将被重定向到提示页面。`,
      confirmText: '确认踢出',
      confirmClass: 'bg-red-500 hover:bg-red-600 text-white',
      onConfirm: async () => {
        setConfirmModal(null);
        const target = { uuid, nickname };
        setActionLoading(`kick-${target.uuid}`);
        try {
          await callAPI('/kick', 'POST', { target_uuid: target.uuid });
          showToast(`已踢出 ${target.nickname}`);
        } catch {}
        finally {
          setActionLoading(null);
          setPendingKick(null);
        }
      },
    });
  }, [callAPI]);

  // 数据导出（CSV）
  const handleExport = useCallback((type: string, elementId?: string) => {
    setExportLoading(type);
    let url: string;
    if (type === 'contributions' || type === 'text') {
      url = `${API_BASE}/rooms/${roomId}/export/${type}`;
    } else {
      url = `${API_BASE}/rooms/${roomId}/export?type=${type}`;
      if (elementId) url += `&element_id=${elementId}`;
    }
    fetch(url, { credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('导出失败');
        return res.blob();
      })
      .then(blob => {
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        const typeLabels: Record<string, string> = {
          all: '全部互动', vote: '投票数据', word: '词云数据',
          contributions: '贡献统计', text: '文字内容',
        };
        a.download = `${typeLabels[type] || type}_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
        showToast(`${typeLabels[type] || type} 导出成功`);
      })
      .catch(() => showToast('导出失败，请重试'))
      .finally(() => setExportLoading(null));
  }, [roomId]);

  // Markdown 总结导出
  const handleExportMarkdown = useCallback(() => {
    setExportLoading('markdown');
    fetch(`${API_BASE}/rooms/${roomId}/summary/export`, { credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('导出失败');
        return res.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `课堂总结_${new Date().toISOString().split('T')[0]}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Markdown 总结导出成功');
      })
      .catch(() => showToast('导出失败，请重试'))
      .finally(() => setExportLoading(null));
  }, [roomId]);

  // 可用 Widget 列表
  const availableWidgets = elements
    .filter(e => !e.is_deleted && [
      'polling_widget', 'wordcloud_widget', 'qa_widget', 'dropzone_widget',
    ].includes(e.type))
    .map(e => ({
      id:    e.id,
      title: (e.payload as any)?.title || (e.payload as any)?.prompt || e.type,
      type:  e.type,
    }));

  // 课堂流程画布模式联动
  const handleEntryModeChange = useCallback((mode: 'free' | 'readonly' | 'follow') => {
    if (mode === 'readonly') {
      onReadOnlyChange?.(true);
    } else if (mode === 'follow') {
      setFollowMode(true);
      onFollowModeChange?.(true);
    } else {
      onReadOnlyChange?.(false);
      setFollowMode(false);
      onFollowModeChange?.(false);
    }
  }, [onReadOnlyChange, onFollowModeChange]);

  // 收起状态
  if (collapsed) {
    return (
      <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50">
        <button
          onClick={() => { setCollapsed(false); window.dispatchEvent(new CustomEvent('ctrl_panel_collapsed', { detail: { collapsed: false } })); }}
          className="bg-white shadow-lg rounded-l-lg p-2 hover:bg-gray-50 transition-colors border border-r-0 border-gray-200"
          title={t('control.panel')}
        >
          <ChevronLeft size={18} />
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed right-0 top-0 bottom-0 z-50 bg-white shadow-xl border-l border-gray-200 flex flex-col"
      style={{ width: '300px' }}
    >
      {/* Toast */}
      {toast && (
        <div className="absolute top-2 left-2 right-2 bg-amber-700 text-white text-sm px-3 py-2 rounded-lg z-50 animate-slide-in">
          {toast}
        </div>
      )}

      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">{t('control.panel')}</h3>
          {connectionStatus === 'connected'
            ? <Wifi size={14} className="text-green-500" />
            : <WifiOff size={14} className="text-red-500" />}
        </div>
        <button
          onClick={() => { setCollapsed(true); window.dispatchEvent(new CustomEvent('ctrl_panel_collapsed', { detail: { collapsed: true } })); }}
          className="p-1 rounded hover:bg-gray-100 text-gray-400"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-gray-100">
        <button
          onClick={() => setActiveTab('control')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            activeTab === 'control'
              ? 'text-amber-800 border-b-2 border-amber-600'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          场控
        </button>
        <button
          onClick={() => setActiveTab('flow')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            activeTab === 'flow'
              ? 'text-amber-800 border-b-2 border-amber-600'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <BookOpen size={13} />
          课堂流程
        </button>
        <button
          onClick={() => setActiveTab('group')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            activeTab === 'group'
              ? 'text-amber-800 border-b-2 border-amber-600'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          分组
        </button>
      </div>

      {/* 主内容滚动区 */}
      <div className="flex-1 overflow-y-auto">

        {activeTab === 'control' && (
          <>
            {/* 统计卡片 */}
            <div className="px-4 py-3 grid grid-cols-2 gap-3">
              <div className="bg-amber-50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-amber-700">{members.length}</div>
                <div className="text-xs text-gray-500">{t('control.memberCount')}</div>
              </div>
              <div className="bg-green-50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-green-600">
                  {elements.filter(e => !e.is_deleted).length}
                </div>
                <div className="text-xs text-gray-500">{t('control.elementCount')}</div>
              </div>
            </div>

            {/* 场控按钮组 */}
            <div className="px-4 py-2 space-y-2">
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">场控</div>

              {/* 锁定/解锁 */}
              <button
                onClick={handleToggleLock}
                disabled={actionLoading === 'lock' || isReadOnly}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isLocked
                    ? 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                } disabled:opacity-50`}
              >
                {isLocked ? <Lock size={16} /> : <Unlock size={16} />}
                <span>{isLocked ? t('control.unlock') : t('control.lock')}</span>
              </button>

              {/* 召集视角 - REQ-010：成功后有Toast */}
              <button
                onClick={handleGather}
                disabled={actionLoading === 'gather'}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-gray-50 text-gray-700 hover:bg-amber-50 hover:text-amber-800 transition-colors disabled:opacity-50"
              >
                <Navigation size={16} />
                <span>{t('control.gather')}</span>
              </button>

              {/* 跟随模式 - REQ-009：开启时通知学生 */}
              <button
                onClick={() => setFollowMode(!isFollowMode)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isFollowMode
                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                    : 'bg-gray-50 text-gray-700 hover:bg-amber-50 hover:text-amber-800'
                }`}
              >
                {isFollowMode
                  ? <Radio size={16} className="animate-pulse" />
                  : <RadioOff size={16} />}
                <span>{isFollowMode ? '跟随中（点击停止）' : '开启跟随模式'}</span>
              </button>

              {/* REQ-021：多用户光标模式（房间人数<=10时显示）*/}
              {members.length <= 10 && (
                <button
                  onClick={() => {
                    const next = !cursorModeOn;
                    setCursorModeOn(next);
                    sendMessage('ctrl_cursor_mode', { enabled: next });
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    cursorModeOn
                      ? 'bg-teal-100 text-teal-700 hover:bg-teal-200'
                      : 'bg-gray-50 text-gray-700 hover:bg-teal-50 hover:text-teal-700'
                  }`}
                  title={`当前 ${members.length} 人，≤10人可开启多用户光标`}
                >
                  <svg
                    width="16" height="16" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round"
                    className={cursorModeOn ? 'animate-pulse' : ''}
                  >
                    <path d="M5 3l14 9-7 1-3 7z"/>
                  </svg>
                  <span>{cursorModeOn ? '多人光标（点击关闭）' : '开启多人光标'}</span>
                  {members.length <= 10 && (
                    <span className="ml-auto text-xs text-gray-400">{members.length}/10人</span>
                  )}
                </button>
              )}

              {/* 只读模式 - REQ-006：React Modal */}
              {!isReadOnly ? (
                <button
                  onClick={handleSetReadOnly}
                  disabled={actionLoading === 'readonly'}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-gray-50 text-gray-700 hover:bg-red-50 hover:text-red-700 transition-colors disabled:opacity-50"
                >
                  <EyeOff size={16} />
                  <span>{t('control.readonly')}</span>
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 rounded-lg text-xs text-yellow-700">
                    <Eye size={14} /><span>当前为只读模式</span>
                  </div>
                  <button
                    onClick={async () => {
                      setActionLoading('readonly');
                      try {
                        await callAPI('/readonly', 'PUT', { is_readonly: false });
                        showToast('已恢复编辑模式');
                      } catch {}
                      finally { setActionLoading(null); }
                    }}
                    disabled={actionLoading === 'readonly'}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
                  >
                    <EyeOff size={16} /><span>恢复编辑模式</span>
                  </button>
                </div>
              )}
            </div>

            {/* 主题风格 */}
            <div className="px-4 py-2 border-t border-gray-100">
              <button
                onClick={() => setShowThemePanel(!showThemePanel)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <Palette size={16} /><span>主题风格</span>
                <ChevronRight size={14} className={`ml-auto transition-transform ${showThemePanel ? 'rotate-90' : ''}`} />
              </button>
              {showThemePanel && (
                <div className="mt-2 p-3 bg-gray-50 rounded-lg space-y-3 animate-fade-in">
                  <div>
                    <div className="text-xs text-gray-500 mb-2">画布背景</div>
                    <div className="grid grid-cols-4 gap-2">
                      {BACKGROUND_COLORS.map(bg => (
                        <button
                          key={bg.value}
                          onClick={() => handleBgChange(bg.value)}
                          className={`w-full aspect-square rounded-lg border-2 transition-all ${
                            backgroundColor === bg.value
                              ? 'border-amber-600 scale-110 shadow'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                          style={{ backgroundColor: bg.value }}
                          title={bg.label}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 互动工具栏 */}
            <div className="px-4 py-2 border-t border-gray-100">
              <WidgetToolbar
                roomId={roomId}
                sendMessage={sendMessage}
                isLocked={isLocked}
                isReadOnly={isReadOnly}
              />
            </div>

            {/* 在线成员 */}
            <div className="px-4 py-2 border-t border-gray-100">
              <MemberList
                members={members}
                onKick={handleKick}
                kickLoading={actionLoading}
              />
            </div>

            {/* 学情雷达 */}
            <div className="px-4 py-3 border-t border-gray-100">
              <InsightPanel roomId={roomId} />
            </div>

            {/* 课堂总结 */}
            <div className="px-4 py-3 border-t border-gray-100">
              <SummaryPanel roomId={roomId} />
            </div>

            {/* 数据导出区块 */}
            <div className="px-4 py-3 border-t border-gray-100">
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                数据导出
              </div>
              <div className="flex gap-2 mb-2">
                {(['all', 'vote', 'word'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => handleExport(type)}
                    disabled={exportLoading === type}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-600 transition-colors disabled:opacity-50"
                  >
                    {exportLoading === type
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Download size={12} />}
                    <span>{type === 'all' ? '全部' : type === 'vote' ? '投票' : '词云'}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => handleExport('contributions')}
                disabled={exportLoading === 'contributions'}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
              >
                {exportLoading === 'contributions' ? <Loader2 size={12} className="animate-spin" /> : <span>📊</span>}
                <span>贡献统计 CSV</span>
              </button>
              <button
                onClick={() => handleExport('text')}
                disabled={exportLoading === 'text'}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
              >
                {exportLoading === 'text' ? <Loader2 size={12} className="animate-spin" /> : <span>📝</span>}
                <span>文字内容 CSV</span>
              </button>
              <button
                onClick={handleExportMarkdown}
                disabled={exportLoading === 'markdown'}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50 mt-1"
              >
                {exportLoading === 'markdown' ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                <span>Markdown 课堂总结</span>
              </button>
            </div>

            {/* 分享与模板区块 */}
            <div className="px-4 py-3 border-t border-gray-100 space-y-2">
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                分享与模板
              </div>
              <button
                onClick={() => setShowShareModal(true)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                           bg-gradient-to-r from-amber-50 to-orange-50 text-amber-800
                           hover:from-amber-100 hover:to-orange-100
                           border border-amber-200 transition-all"
              >
                <Share2 size={16} />
                <span>发布课堂分享</span>
                <span className="ml-auto text-xs text-amber-600">只读</span>
              </button>
              <button
                onClick={() => setShowSaveTemplate(true)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                           bg-gray-50 text-gray-700 hover:bg-amber-50 hover:text-amber-700
                           border border-gray-100 hover:border-amber-200 transition-all"
              >
                <LayoutTemplate size={16} />
                <span>保存为模板</span>
                <span className="ml-auto text-xs text-gray-400">复用</span>
              </button>
              <p className="text-xs text-gray-400 px-1">
                分享页可分享给家长或同事；模板可在仪表盘复用。
              </p>
            </div>
          </>
        )}

        {activeTab === 'flow' && (
          <div className="px-4 py-3">
            <FlowController
              roomId={roomId}
              onEditFlow={() => setShowFlowEditor(true)}
              onEntryModeChange={handleEntryModeChange}
            />
          </div>
        )}

        {activeTab === 'group' && (
          <div className="px-3 py-3">
            <GroupPanel roomId={roomId} />
          </div>
        )}
      </div>
      {/* 流程编辑器 */}
      {showFlowEditor && (
        <FlowEditor
          roomId={roomId}
          existingFlow={currentFlow}
          availableWidgets={availableWidgets}
          onSaved={flow => {
            setCurrentFlow(flow);
            setShowFlowEditor(false);
            setActiveTab('flow');
            showToast('课堂流程已保存');
          }}
          onClose={() => setShowFlowEditor(false)}
        />
      )}

      {/* 发布分享弹窗 */}
      {showShareModal && (
        <SharePublishModal
          roomId={roomId}
          roomTitle={currentRoom?.title || '课堂'}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {/* 保存模板弹窗 */}
      {showSaveTemplate && (
        <SaveTemplateModal
          roomId={roomId}
          onClose={() => setShowSaveTemplate(false)}
          onSaved={() => {
            setShowSaveTemplate(false);
            showToast('模板已保存，可在仪表盘模板中心查看');
          }}
        />
      )}

      {/* REQ-006：React确认弹窗（替代window.confirm，不冻结页面） */}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          description={confirmModal.description}
          confirmText={confirmModal.confirmText}
          confirmClass={confirmModal.confirmClass}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => {
            setConfirmModal(null);
            setPendingKick(null);
          }}
        />
      )}
    </div>
  );
};

export default ControlPanel;
