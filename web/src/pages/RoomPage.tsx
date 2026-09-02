// =============================================================
// MindCanvas v4.3 - 房间页面
// REQ-018修复：动态更新 document.title 为「房间名 - MindCanvas 课堂」
// REQ-019修复：学生端顶部右侧头像处点击展开修改昵称/头像面板
// REQ-012修复：教师端成员浮层改用 MemberList 组件，启用 ⋯ 操作菜单
// 跟随模式修复：向 ControlPanel 传入 excalidrawAPI，确保 ctrl_follow_sync 能广播
// REQ-027：左侧新增 AI 工作台（仅教师，fixed 定位悬浮于画布上方）
// =============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Copy, Check, Lock, BookOpen,
  Wifi, WifiOff, Navigation, Eye,
  ChevronDown, ChevronUp, X, Camera, Share2,
} from 'lucide-react';
// REQ-051 二期：房间内分享——生成邀请链接二维码
import QRCode from 'qrcode';
import { useRoomStore } from '@/store/roomStore';
import { useCanvasStore } from '@/store/canvasStore';
import { useWidgetStore } from '@/store/widgetStore';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import CanvasEngine from '@/components/canvas/CanvasEngine';
import ControlPanel from '@/components/teacher/ControlPanel';
import MemberList from '@/components/teacher/MemberList';
import FloatingWidgets from '@/components/canvas/FloatingWidgets';
import AIWorkbench from '@/components/canvas/AIWorkbench';
import { API_BASE, AVATARS } from '@/utils/constants';
// REQ-039 3d：消费作业详情页交接过来的「插入画布」内容
import { takeCanvasInsert } from '@/utils/canvasHandoff';
import { buildLectureCards } from '@/utils/diagramBuilder';

// ===== 剪贴板工具函数 =====
const copyToClipboard = (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
};
const fallbackCopy = (text: string): Promise<void> =>
  new Promise(resolve => {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    resolve();
  });

// ===== REQ-019：学生修改昵称/头像弹窗 =====
interface EditProfileModalProps {
  currentNickname: string;
  currentAvatarId: number;
  currentAvatarUrl?: string;
  uuid: string;
  onClose: () => void;
  onSaved: (nickname: string, avatarId: number, avatarUrl?: string) => void;
}

const EditProfileModal: React.FC<EditProfileModalProps> = ({
  currentNickname, currentAvatarId, currentAvatarUrl, uuid, onClose, onSaved,
}) => {
  const [nickname, setNickname]   = useState(currentNickname);
  const [avatarId, setAvatarId]   = useState(currentAvatarId);
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl || '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Canvas 裁剪头像为 200x200 正方形
  const cropImageToSquare = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const size = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = 200; canvas.height = 200;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(
          img,
          (img.width - size) / 2, (img.height - size) / 2, size, size,
          0, 0, 200, 200
        );
        URL.revokeObjectURL(url);
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('裁剪失败')); return; }
          resolve(URL.createObjectURL(blob));
        }, 'image/jpeg', 0.9);
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = url;
    });

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError('头像不能超过2MB'); return; }
    setUploading(true);
    setError('');
    try {
      const croppedUrl = await cropImageToSquare(file);
      const formData = new FormData();
      const resp = await fetch(croppedUrl);
      const blob = await resp.blob();
      formData.append('avatar', blob, 'avatar.jpg');
      const res = await fetch('/api/upload/avatar', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) throw new Error('上传失败');
      const data = await res.json();
      setAvatarUrl(data.url || data.avatar_url || '');
      URL.revokeObjectURL(croppedUrl);
    } catch (err: any) {
      setError(err.message || '上传失败');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (!nickname.trim()) { setError('昵称不能为空'); return; }
    setSaving(true);
    setError('');
    try {
      localStorage.setItem('mc_nickname', nickname.trim());
      if (avatarUrl) localStorage.setItem('mc_avatar_url', avatarUrl);
      onSaved(nickname.trim(), avatarId, avatarUrl || undefined);
      onClose();
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center"
      style={{ zIndex: 2147483647 }}
    >
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-800">修改昵称 / 头像</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>

        {/* 头像区域 */}
        <div className="flex justify-center mb-4">
          <div className="relative">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="头像"
                className="w-16 h-16 rounded-full object-cover border-2 border-amber-200"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center text-3xl border-2 border-amber-200">
                {AVATARS.find(a => a.id === avatarId)?.emoji || '👤'}
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 w-7 h-7 bg-amber-700 text-white rounded-full flex items-center justify-center hover:bg-amber-800 disabled:opacity-50"
            >
              {uploading
                ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                : <Camera size={12} />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleAvatarFile}
            />
          </div>
        </div>

        {/* 预设 emoji 头像选择（未上传自定义图片时显示）*/}
        {!avatarUrl && (
          <div className="grid grid-cols-6 gap-1.5 mb-4">
            {AVATARS.slice(0, 12).map(av => (
              <button
                key={av.id}
                onClick={() => setAvatarId(av.id)}
                className={`text-xl p-1.5 rounded-lg transition-all ${
                  avatarId === av.id
                    ? 'bg-amber-100 ring-2 ring-amber-400'
                    : 'hover:bg-gray-100'
                }`}
              >
                {av.emoji}
              </button>
            ))}
          </div>
        )}

        {/* 昵称输入 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">昵称</label>
          <input
            type="text"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            maxLength={20}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
            placeholder="输入新昵称..."
          />
        </div>

        {error && <p className="text-xs text-red-500 mb-3">⚠️ {error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !nickname.trim()}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-amber-700 hover:bg-amber-800 rounded-lg disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ===== 主组件 =====
const RoomPage = () => {
  const { t } = useTranslation();
  const { id: roomId }  = useParams<{ id: string }>();
  const [searchParams]  = useSearchParams();
  const navigate        = useNavigate();
  const { user }        = useAuth();

  const urlUuid   = searchParams.get('uuid');
  const isTeacher = !!user && !urlUuid;
  const uuid      = isTeacher ? '' : (urlUuid || localStorage.getItem('mc_uuid') || '');

  const currentRoom        = useRoomStore(s => s.currentRoom);
  const setCurrentRoom     = useRoomStore(s => s.setCurrentRoom);
  const setIsTeacher       = useRoomStore(s => s.setIsTeacher);
  const setCurrentUserUUID = useRoomStore(s => s.setCurrentUserUUID);
  const resetRoom          = useRoomStore(s => s.resetRoom);
  const connectionStatus   = useRoomStore(s => s.connectionStatus);
  const isLocked           = useRoomStore(s => s.isLocked);
  const isReadOnly         = useRoomStore(s => s.isReadOnly);
  const members            = useRoomStore(s => s.members);
  const elements           = useRoomStore(s => s.elements);
  // REQ-021：多用户光标
  const cursors            = useRoomStore(s => s.cursors);
  const cursorModeEnabled  = useRoomStore(s => s.cursorModeEnabled);

  const resetCanvas      = useCanvasStore(s => s.resetCanvas);
  const isFollowMode     = useCanvasStore(s => s.isFollowMode);
  const setFollowMode    = useCanvasStore(s => s.setFollowMode);
  // 获取 excalidrawAPI 传给 ControlPanel，用于跟随模式广播视角
  const excalidrawAPI    = useCanvasStore(s => s.excalidrawAPI);
  const resetWidgets     = useWidgetStore(s => s.resetWidgets);

  const [pageLoading, setPageLoading]     = useState(true);
  const [pageError, setPageError]         = useState('');
  const [copied, setCopied]               = useState(false);
  // REQ-051 二期：房间内分享(链接+二维码)弹层
  const [showShare, setShowShare]             = useState(false);
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const [qrDataUrl, setQrDataUrl]             = useState('');
  const [isGathered, setIsGathered]       = useState(false);
  const [showMembers, setShowMembers]     = useState(false);
  const [kickLoading, setKickLoading]     = useState<string | null>(null);

  // REQ-027-UX：右侧控制面板收起状态（ControlPanel 广播 ctrl_panel_collapsed 事件）
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // REQ-019：学生端修改昵称/头像弹窗状态
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [studentNickname, setStudentNickname] = useState(
    localStorage.getItem('mc_nickname') || '学生'
  );
  const [studentAvatarId, setStudentAvatarId] = useState(
    parseInt(localStorage.getItem('mc_avatar_id') || '1', 10)
  );
  const [studentAvatarUrl, setStudentAvatarUrl] = useState(
    localStorage.getItem('mc_avatar_url') || ''
  );

  // REQ-018：动态更新 document.title
  useEffect(() => {
    const roomTitle = currentRoom?.title;
    if (roomTitle) {
      document.title = `${roomTitle} - MindCanvas 课堂`;
    } else {
      document.title = 'MindCanvas 课堂';
    }
    return () => { document.title = 'MindCanvas - 教育协同白板'; };
  }, [currentRoom?.title]);

  // 初始化身份信息
  useEffect(() => {
    setIsTeacher(isTeacher);
    setCurrentUserUUID(isTeacher ? (user?.id || '') : uuid);
  }, [isTeacher, user, uuid]);

  // 获取房间信息
  useEffect(() => {
    if (!roomId) return;
    (async () => {
      try {
        if (isTeacher) {
          const r = await fetch(`${API_BASE}/rooms/${roomId}`, { credentials: 'include' });
          if (!r.ok) throw new Error((await r.json()).error);
          setCurrentRoom((await r.json()).room);
        } else {
          setCurrentRoom({
            id:           roomId,
            teacher_id:   '',
            tenant_id:    '',
            title:        localStorage.getItem('mc_room_title') || '课堂',
            invite_code:  '',
            is_locked:    false,
            is_readonly:  false,
            max_capacity: 200,
            status:       'active',
            room_mode:    'whiteboard' as const,
            collab_mode:  'anonymous' as const,
            created_at:   '',
            updated_at:   '',
          });
        }
      } catch (e: any) {
        setPageError(e.message);
      } finally {
        setPageLoading(false);
      }
    })();
  }, [roomId, isTeacher]);

  // WebSocket 消息处理
  const handleWSMessage = useCallback((msg: any) => {
    if (msg.type === 'ctrl_gather') {
      const api = useCanvasStore.getState().excalidrawAPI;
      if (api && msg.payload) {
        try {
          api.updateScene({
            appState: {
              scrollX: msg.payload.viewport_x || 0,
              scrollY: msg.payload.viewport_y || 0,
              zoom:    { value: msg.payload.zoom || 1 },
            },
          });
        } catch {}
      }
      if (!isTeacher) {
        setIsGathered(true);
        setTimeout(() => setIsGathered(false), 3000);
      }
    }

    if (msg.type === 'ctrl_follow_sync' && !isTeacher && useCanvasStore.getState().isFollowMode) {
      const api = useCanvasStore.getState().excalidrawAPI;
      const syncData = msg.data || msg.payload;
      if (api && syncData) {
        try {
          api.updateScene({
            appState: {
              scrollX: syncData.scrollX || 0,
              scrollY: syncData.scrollY || 0,
              zoom:    { value: syncData.zoom?.value || syncData.zoom || 1 },
            },
          });
        } catch {}
      }
    }

    // REQ-009：处理跟随模式开关
    if (msg.type === 'ctrl_follow_mode' && !isTeacher) {
      const enabled = msg.enabled ?? msg.data?.enabled ?? msg.payload?.enabled;
      setFollowMode(!!enabled);
      if (enabled) {
        setIsGathered(true);
        setTimeout(() => setIsGathered(false), 3000);
      }
    }

    if (msg.type === 'room_sync' && msg.payload?.room) {
      setCurrentRoom(msg.payload.room);
    }
  }, [isTeacher, setFollowMode]);

  // 同时监听 ws_follow_mode 自定义事件（useWebSocket dispatch 的，双重保险）
  useEffect(() => {
    if (isTeacher) return;
    const handler = (e: Event) => {
      const { enabled } = (e as CustomEvent).detail;
      setFollowMode(!!enabled);
    };
    window.addEventListener('ws_follow_mode', handler);
    return () => window.removeEventListener('ws_follow_mode', handler);
  }, [isTeacher, setFollowMode]);

  // REQ-027-UX：监听右侧面板收起/展开，动态让出画布宽度
  useEffect(() => {
    const handler = (e: Event) => setPanelCollapsed(!!(e as CustomEvent).detail?.collapsed);
    window.addEventListener('ctrl_panel_collapsed', handler);
    return () => window.removeEventListener('ctrl_panel_collapsed', handler);
  }, []);

  // REQ-039 3d：消费「从讲评报告插入画布」的待插内容
  // 作业详情页已把要点暂存到 sessionStorage 并跳转过来，这里等画布 API 就绪后插入。
  // 只消费一次（takeCanvasInsert 取出即删），刷新页面不会重复插入。
  useEffect(() => {
    if (!roomId || !isTeacher) return;   // 仅教师端插入
    let cancelled = false;
    let tries = 0;
    const timer = window.setInterval(async () => {
      if (cancelled) return;
      tries++;
      const api = useCanvasStore.getState().excalidrawAPI;
      if (!api) {
        if (tries > 40) window.clearInterval(timer);  // 最多等 ~10 秒
        return;
      }
      window.clearInterval(timer);
      const pending = takeCanvasInsert(roomId);
      if (!pending) return;
      try {
        const appState = api.getAppState();
        const originX = -appState.scrollX + 80 / appState.zoom.value;
        const originY = -appState.scrollY + 60 / appState.zoom.value;
        const newElements = buildLectureCards(
          { title: pending.title, items: pending.items, quotes: pending.quotes },
          originX, originY,
        );
        if (!newElements.length) return;
        api.updateScene({ elements: [...api.getSceneElements(), ...newElements] });
        setTimeout(() => {
          api.scrollToContent(newElements, { fitToContent: true, animate: true });
        }, 100);
      } catch (err) {
        console.error('[REQ-039 3d] 插入讲评要点失败', err);
      }
    }, 250);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [roomId, isTeacher]);

  // REQ-021：光标发送节流 ref（50ms节流，避免频繁广播）
  const cursorThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCursorRef     = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const { send, disconnect } = useWebSocket({
    roomId:    roomId || '',
    uuid:      isTeacher ? undefined : uuid,
    isTeacher,
    onMessage: handleWSMessage,
  });

  useEffect(() => () => {
    disconnect();
    resetRoom();
    resetCanvas();
    resetWidgets();
  }, []);

  const handleCopyCode = useCallback(() => {
    if (!currentRoom?.invite_code) return;
    copyToClipboard(currentRoom.invite_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [currentRoom?.invite_code]);

  // REQ-051 二期：房间内分享入口——链接 + 二维码（打开后自动填房间码）
  const joinLink = currentRoom?.invite_code
    ? `${window.location.origin}/join/${currentRoom.invite_code}`
    : '';

  const handleToggleShare = useCallback(() => {
    setShowShare(prev => !prev);
  }, []);

  // 弹层打开时才现算二维码，避免每次渲染都跑一遍图像生成
  useEffect(() => {
    if (!showShare || !joinLink) return;
    let cancelled = false;
    QRCode.toDataURL(joinLink, {
      width: 180,
      margin: 1,
      color: { dark: '#1f2937', light: '#ffffff' },
    }).then(url => { if (!cancelled) setQrDataUrl(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [showShare, joinLink]);

  const handleCopyShareLink = useCallback(() => {
    if (!joinLink) return;
    copyToClipboard(joinLink).then(() => {
      setCopiedShareLink(true);
      setTimeout(() => setCopiedShareLink(false), 2000);
    });
  }, [joinLink]);

  const handleReadOnlyChange = useCallback(async (readonly: boolean) => {
    if (!roomId) return;
    try {
      await fetch(`${API_BASE}/rooms/${roomId}/readonly`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_readonly: readonly }),
      });
    } catch {}
  }, [roomId]);

  const handleFollowModeChange = useCallback((follow: boolean) => {
    setFollowMode(follow);
  }, [setFollowMode]);

  // REQ-012：踢人操作（教师端成员浮层使用 MemberList 组件）
  const handleKick = useCallback(async (targetUuid: string, nickname: string) => {
    if (!roomId) return;
    setKickLoading(`kick-${targetUuid}`);
    try {
      await fetch(`${API_BASE}/rooms/${roomId}/kick`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ target_uuid: targetUuid }),
      });
    } catch {}
    finally { setKickLoading(null); }
  }, [roomId]);

  const roomMode = currentRoom?.room_mode || 'whiteboard';
  const mc = (() => {
    switch (roomMode) {
      case 'cards':       return { l: '📝 卡片',  b: 'bg-amber-50'  };
      case 'interactive': return { l: '📊 互动', b: 'bg-purple-50' };
      default:            return { l: '🎨 白板', b: 'bg-amber-50'   };
    }
  })();

  if (pageLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="spinner mx-auto mb-4" />
        <p className="text-gray-500">{t('app.loading')}</p>
      </div>
    </div>
  );

  if (pageError) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-md">
        <div className="text-4xl mb-4">😕</div>
        <p className="text-gray-500 mb-6">{pageError}</p>
        <button
          onClick={() => navigate(isTeacher ? '/dashboard' : '/join')}
          className="btn-primary"
        >
          返回
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>

      {/* 顶部导航栏 */}
      <header
        className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-sm border-b border-gray-200"
        style={{ height: '44px', paddingRight: isTeacher && !panelCollapsed ? '300px' : '0' }}
      >
        <div className="flex items-center justify-between h-full px-3">
          {/* 左侧：返回 + 房间标题 + 模式标签 + 状态标签 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(isTeacher ? '/dashboard' : '/join')}
              className="p-1 rounded-lg hover:bg-gray-100 text-gray-500"
            >
              <ArrowLeft size={16} />
            </button>
            <h1 className="text-sm font-semibold text-gray-900 max-w-[160px] truncate">
              {currentRoom?.title || '课堂'}
            </h1>
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${mc.b} text-gray-600`}>
              {mc.l}
            </span>
            {isLocked && (
              <span className="flex items-center gap-0.5 text-xs text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">
                <Lock size={10} /> 锁定
              </span>
            )}
            {isReadOnly && (
              <span className="flex items-center gap-0.5 text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full">
                <BookOpen size={10} /> 只读
              </span>
            )}
          </div>

          {/* 中间：教师邀请码 */}
          {isTeacher && currentRoom?.invite_code && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">邀请码:</span>
              <span className="font-mono font-bold text-amber-800 tracking-widest text-sm">
                {currentRoom.invite_code}
              </span>
              <button
                onClick={handleCopyCode}
                className={`p-1 rounded ${copied ? 'text-green-500' : 'text-gray-400 hover:text-amber-700'}`}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
              {/* REQ-051 二期：分享入口(链接+二维码) */}
              <button
                onClick={handleToggleShare}
                className={`p-1 rounded ${showShare ? 'text-amber-700 bg-amber-50' : 'text-gray-400 hover:text-amber-700'}`}
                title="分享给学生"
              >
                <Share2 size={14} />
              </button>
            </div>
          )}

          {/* 右侧 */}
          <div className="flex items-center gap-2">
            {!isTeacher ? (
              // REQ-019：学生端头像点击入口
              <button
                onClick={() => setShowEditProfile(true)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
                title="修改昵称/头像"
              >
                {studentAvatarUrl ? (
                  <img
                    src={studentAvatarUrl}
                    alt="我的头像"
                    className="w-6 h-6 rounded-full object-cover"
                  />
                ) : (
                  <span className="text-base">
                    {AVATARS.find(a => a.id === studentAvatarId)?.emoji || '👤'}
                  </span>
                )}
                <span className="text-xs text-gray-500 max-w-[80px] truncate hidden sm:block">
                  {studentNickname}
                </span>
              </button>
            ) : (
              // 教师端：成员数量按钮
              <button
                onClick={() => setShowMembers(!showMembers)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-amber-700 px-2 py-1 rounded-lg hover:bg-gray-100"
              >
                <span>👥</span>
                <span>{members.length}人</span>
                {showMembers ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            )}
            {connectionStatus === 'connected'
              ? <Wifi size={14} className="text-green-500" />
              : connectionStatus === 'connecting'
                ? <Wifi size={14} className="text-yellow-500 animate-pulse" />
                : <WifiOff size={14} className="text-red-500" />}
          </div>
        </div>
      </header>

      {/* 教师：成员列表浮层（REQ-012：改用 MemberList 组件，⋯ 按钮可用）*/}
      {isTeacher && showMembers && (
        <div
          className="fixed top-[44px] z-[60] bg-white rounded-xl shadow-xl border border-gray-200 w-72 max-h-[480px] overflow-y-auto animate-fade-in"
          style={{ right: panelCollapsed ? '8px' : '304px' }}
        >
          <div className="p-3 border-b border-gray-100">
            <div className="text-xs font-medium text-gray-400">在线成员 ({members.length})</div>
          </div>
          <div className="p-2">
            <MemberList
              members={members}
              onKick={handleKick}
              kickLoading={kickLoading}
            />
          </div>
        </div>
      )}

      {/* REQ-051 二期：房间内分享弹层(链接+二维码) */}
      {isTeacher && showShare && currentRoom?.invite_code && (
        <div className="fixed top-[44px] left-1/2 -translate-x-1/2 z-[60] bg-white rounded-xl shadow-xl border border-gray-200 w-64 animate-fade-in">
          <div className="p-4 flex flex-col items-center gap-3">
            <div className="text-xs font-medium text-gray-400">分享给学生</div>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="房间二维码"
                className="w-40 h-40 rounded-lg border border-gray-100"
              />
            ) : (
              <div className="w-40 h-40 rounded-lg border border-gray-100 flex items-center justify-center text-xs text-gray-300">
                生成中...
              </div>
            )}
            <div className="text-xs text-gray-400 text-center break-all px-1">{joinLink}</div>
            <button
              onClick={handleCopyShareLink}
              className={`w-full flex items-center justify-center gap-1.5 text-xs font-medium
                          rounded-lg py-2 border transition-colors ${
                copiedShareLink
                  ? 'border-green-200 bg-green-50 text-green-600'
                  : 'border-gray-200 text-gray-500 hover:border-amber-300 hover:text-amber-700 hover:bg-amber-50'
              }`}
            >
              {copiedShareLink
                ? <><Check size={13} /> 链接已复制</>
                : <><Copy size={13} /> 复制入场链接</>}
            </button>
          </div>
        </div>
      )}

      {/* 学生端状态提示横幅 */}
      {!isTeacher && (isLocked || isReadOnly || isGathered || isFollowMode) && (
        <div className="fixed top-[44px] left-0 right-0 z-40 flex justify-center py-2 pointer-events-none">
          <div className="flex items-center gap-3 bg-white/95 backdrop-blur-sm rounded-full shadow-lg border border-gray-200 px-4 py-2 animate-slide-in pointer-events-auto">
            {isFollowMode && (
              <div className="flex items-center gap-1.5 text-amber-800 text-sm">
                <Navigation size={14} className="animate-pulse" />
                <span>📌 教师正在引导视角，当前跟随老师画布位置</span>
              </div>
            )}
            {isGathered && !isFollowMode && (
              <div className="flex items-center gap-1.5 text-amber-800 text-sm">
                <Navigation size={14} className="animate-pulse" />
                <span>召集中</span>
              </div>
            )}
            {isLocked && !isReadOnly && (
              <div className="flex items-center gap-1.5 text-orange-600 text-sm">
                <Lock size={14} />
                <span>已锁定</span>
              </div>
            )}
            {isReadOnly && (
              <div className="flex items-center gap-1.5 text-purple-600 text-sm">
                <Eye size={14} />
                <span>浏览模式</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 画布主区域 */}
      <main
        style={{
          position: 'absolute',
          top:      '44px',
          left:     0,
          right:    isTeacher && !panelCollapsed ? '300px' : 0,
          bottom:   0,
          overflow: 'hidden',
        }}
        onMouseMove={cursorModeEnabled ? (e) => {
          // REQ-021：节流发送光标位置（50ms）
          if (cursorThrottleRef.current) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const transform = useCanvasStore.getState().transform;
          // 屏幕坐标转画布坐标
          const canvasX = (e.clientX - rect.left) / transform.zoom - transform.scrollX;
          const canvasY = (e.clientY - rect.top)  / transform.zoom - transform.scrollY;
          lastCursorRef.current = { x: canvasX, y: canvasY };
          cursorThrottleRef.current = setTimeout(() => {
            cursorThrottleRef.current = null;
            send('cursor_move', { x: lastCursorRef.current.x, y: lastCursorRef.current.y });
          }, 50);
        } : undefined}
      >
        <CanvasEngine
          sendMessage={send}
          isTeacher={isTeacher}
          roomMode={roomMode}
        />
        <FloatingWidgets
          elements={elements}
          sendMessage={send}
          isTeacher={isTeacher}
          isLocked={isLocked}
          isReadOnly={isReadOnly}
          roomId={roomId || ""}
        />

        {/* REQ-021：多用户光标覆盖层 */}
        {cursorModeEnabled && (Object.entries(cursors) as [string, { x: number; y: number; nickname: string; updatedAt: number }][]).map(([cuuid, cursor]) => {
          // 画布坐标转屏幕坐标
          const transform = useCanvasStore.getState().transform;
          const sx = (cursor.x + transform.scrollX) * transform.zoom;
          const sy = (cursor.y + transform.scrollY) * transform.zoom;
          // 超出 3 秒未更新则不渲染（已离开或停止移动）
          if (Date.now() - cursor.updatedAt > 3000) return null;
          return (
            <div
              key={cuuid}
              style={{
                position:      'absolute',
                left:          sx,
                top:           sy,
                pointerEvents: 'none',
                zIndex:        50,
                transform:     'translate(2px, 2px)',
              }}
            >
              {/* 光标箭头 */}
              <svg
                width="18" height="18" viewBox="0 0 24 24"
                fill="currentColor" stroke="white" strokeWidth="1"
                style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
              >
                <path d="M5 3l14 9-7 1-3 7z" fill="#3B82F6"/>
              </svg>
              {/* 昵称标签 */}
              <div
                style={{
                  position:        'absolute',
                  top:             16,
                  left:            10,
                  backgroundColor: '#3B82F6',
                  color:           'white',
                  fontSize:        '11px',
                  fontWeight:      500,
                  padding:         '1px 6px',
                  borderRadius:    '8px',
                  whiteSpace:      'nowrap',
                  boxShadow:       '0 1px 3px rgba(0,0,0,0.3)',
                  maxWidth:        '80px',
                  overflow:        'hidden',
                  textOverflow:    'ellipsis',
                }}
              >
                {cursor.nickname || cuuid.slice(0, 6)}
              </div>
            </div>
          );
        })}
      </main>

      {/* REQ-027：AI 工作台（仅教师，fixed 定位悬浮在画布左侧上方）
          REQ-027-UX：容器 pointer-events-none + flex 居中，收起时只有小胶囊按钮拦截鼠标，
          不再遮挡画布左侧的缩放控件等 UI */}
      {isTeacher && roomId && (
        <div
          className="fixed z-[45] flex items-center pointer-events-none"
          style={{ top: '44px', left: 0, bottom: 0 }}
        >
          <AIWorkbench roomId={roomId} isTeacher={isTeacher} agentEnabled={user?.agent_enabled} />
        </div>
      )}

      {/* 教师控制面板：传入 excalidrawAPI 确保跟随模式 ctrl_follow_sync 能广播 */}
      {isTeacher && roomId && (
        <ControlPanel
          roomId={roomId}
          sendMessage={send}
          connectionStatus={connectionStatus}
          excalidrawAPI={excalidrawAPI}
          onReadOnlyChange={handleReadOnlyChange}
          onFollowModeChange={handleFollowModeChange}
        />
      )}

      {/* 遮罩：点击关闭成员浮层/分享弹层 */}
      {(showMembers || showShare) && (
        <div
          className="fixed inset-0 z-[55]"
          onClick={() => { setShowMembers(false); setShowShare(false); }}
        />
      )}

      {/* REQ-019：学生修改昵称/头像弹窗 */}
      {!isTeacher && showEditProfile && (
        <EditProfileModal
          currentNickname={studentNickname}
          currentAvatarId={studentAvatarId}
          currentAvatarUrl={studentAvatarUrl}
          uuid={uuid}
          onClose={() => setShowEditProfile(false)}
          onSaved={(nick, avId, avUrl) => {
            setStudentNickname(nick);
            setStudentAvatarId(avId);
            if (avUrl) setStudentAvatarUrl(avUrl);
          }}
        />
      )}
    </div>
  );
};

export default RoomPage;
