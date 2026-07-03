// =============================================================
// MindCanvas v4.1 - 学生入场页面
// 手机端优化：
//   - 防止键盘弹出时页面被挤压（viewport-fit=cover + scroll）
//   - 房间码输入框更大点击区、自动大写
//   - 头像选择格子更大（手机友好）
//   - 昵称输入 inputMode="text" 避免手机键盘切换
//   - 提交按钮固定底部（手机端）
//   - 错误提示位置更显眼
// =============================================================
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AVATARS } from '@/utils/constants';

const API_BASE = '/api';

const JoinPage = () => {
  const { t } = useTranslation();
  const { code: urlCode } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [roomCode, setRoomCode] = useState(urlCode || '');
  const [nickname, setNickname] = useState('');
  const [avatarId, setAvatarId] = useState(1);
  // 需求3：自定义头像上传状态
  const [avatarURL, setAvatarURL] = useState<string>('');        // 上传成功后的 URL
  const [avatarUploading, setAvatarUploading] = useState(false); // 上传中
  const [avatarUploadErr, setAvatarUploadErr] = useState('');    // 上传错误
  const avatarInputRef = useRef<HTMLInputElement>(null);         // 隐藏 file input
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 手机端：记录键盘是否弹出，动态调整布局
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  // 监听视口高度变化判断键盘是否弹出
  useEffect(() => {
    const initialHeight = window.innerHeight;
    const handleResize = () => {
      // 键盘弹出时视口高度缩小超过 150px
      setKeyboardOpen(window.innerHeight < initialHeight - 150);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 如果 URL 中有邀请码，自动聚焦昵称输入框
  const nicknameRef = useRef<HTMLInputElement>(null);
  const roomCodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (urlCode) {
      // 有邀请码时直接聚焦昵称
      setTimeout(() => nicknameRef.current?.focus(), 300);
    }
  }, [urlCode]);

  // 需求3：处理头像文件选择 - Canvas 裁剪为 200x200 正方形后上传
  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > 2 * 1024 * 1024) {
      setAvatarUploadErr('图片不能超过 2MB');
      return;
    }
    setAvatarUploading(true);
    setAvatarUploadErr('');
    try {
      const croppedBlob = await cropImageToSquare(file);
      const fd = new FormData();
      fd.append('avatar', croppedBlob, 'avatar.jpg');
      const res = await fetch('/api/upload/avatar', { method: 'POST', body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '上传失败');
      }
      const data = await res.json();
      setAvatarURL(data.url);
      setAvatarId(0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '上传失败，请重试';
      setAvatarUploadErr(msg);
    } finally {
      setAvatarUploading(false);
    }
  };

  // 需求3：Canvas 裁剪工具函数 - 取图片中心正方形裁剪为 200x200
  const cropImageToSquare = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectURL = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectURL);
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 200;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas 不可用')); return; }
        const size = Math.min(img.width, img.height);
        const offsetX = (img.width - size) / 2;
        const offsetY = (img.height - size) / 2;
        ctx.drawImage(img, offsetX, offsetY, size, size, 0, 0, 200, 200);
        canvas.toBlob(
          (blob) => { if (blob) resolve(blob); else reject(new Error('图片处理失败')); },
          'image/jpeg', 0.85
        );
      };
      img.onerror = () => { URL.revokeObjectURL(objectURL); reject(new Error('图片加载失败')); };
      img.src = objectURL;
    });
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim() || !nickname.trim()) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/guest/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_code: roomCode.toUpperCase().trim(),
          nickname: nickname.trim(),
          avatar_id: avatarId,
          avatar_url: avatarURL || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || '加入失败，请检查房间码');
      }

      // 存储到 localStorage
      localStorage.setItem('mc_uuid', data.data.uuid);
      localStorage.setItem('mc_nickname', data.data.nickname);
      localStorage.setItem('mc_room_id', data.data.room_id);
      localStorage.setItem('mc_avatar_id', String(data.data.avatar_id));
      if (avatarURL) localStorage.setItem('mc_avatar_url', avatarURL);

      // 跳转房间
      navigate(`/room/${data.data.room_id}?uuid=${data.data.uuid}`);
    } catch (err: any) {
      setError(err.message || '加入失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = roomCode.trim().length > 0 && nickname.trim().length >= 1 && !loading;

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 flex flex-col"
      style={{ minHeight: '-webkit-fill-available' }}
    >
      {/* 滚动容器：键盘弹出时内容可滚动 */}
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-center px-4 py-8 sm:py-12">

          {/* Logo 区域（键盘弹出时隐藏，节省空间） */}
          {!keyboardOpen && (
            <div className="text-center mb-6 sm:mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 bg-amber-700 rounded-2xl mb-3 shadow-lg">
                <span className="text-white text-2xl font-bold">MC</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
                {t('student.join')}
              </h1>
              <p className="text-gray-400 text-sm mt-1">无需注册，即用即走</p>
            </div>
          )}

          {/* 表单卡片 */}
          <div
            ref={formRef}
            className="bg-white rounded-2xl shadow-lg w-full max-w-md overflow-hidden"
          >
            <form onSubmit={handleJoin} className="p-6 sm:p-8 space-y-5">

              {/* 房间码 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t('student.roomCode')}
                </label>
                <input
                  ref={roomCodeRef}
                  type="text"
                  value={roomCode}
                  onChange={e => setRoomCode(e.target.value.toUpperCase())}
                  className="w-full text-center text-3xl font-mono font-bold tracking-[0.4em] uppercase
                             border-2 border-gray-200 rounded-xl px-4 py-4
                             focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100
                             transition-all placeholder:text-gray-200 placeholder:tracking-normal
                             placeholder:text-xl"
                  placeholder="ABCDEF"
                  maxLength={6}
                  required
                  autoFocus={!urlCode}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  inputMode="text"
                />
              </div>

              {/* 昵称 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t('student.nickname')}
                </label>
                <input
                  ref={nicknameRef}
                  type="text"
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3
                             text-base focus:outline-none focus:border-amber-400 focus:ring-2
                             focus:ring-amber-100 transition-all"
                  placeholder="输入你的昵称（2-20字）"
                  maxLength={20}
                  required
                  autoComplete="nickname"
                  inputMode="text"
                />
              </div>

              {/* 头像选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('student.avatar')}
                </label>
                {/* 手机端：4列更大格子；桌面端：保持原有大小 */}
                <div className="grid grid-cols-4 gap-2 sm:gap-3">
                  {AVATARS.map(avatar => (
                    <button
                      key={avatar.id}
                      type="button"
                      onClick={() => { setAvatarId(avatar.id); setAvatarURL(''); }}
                      className={`
                        aspect-square rounded-xl text-2xl sm:text-3xl
                        flex items-center justify-center
                        transition-all duration-150 select-none
                        active:scale-95
                        ${avatarId === avatar.id && !avatarURL
                          ? 'bg-amber-100 ring-2 ring-amber-600 ring-offset-1 scale-105 shadow-sm'
                          : 'bg-gray-100 hover:bg-amber-50 hover:ring-1 hover:ring-amber-300'
                        }
                      `}
                      aria-label={`头像 ${avatar.id}`}
                    >
                      {avatar.emoji}
                    </button>
                  ))}
                  {/* 需求3：上传自定义头像格子 */}
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={avatarUploading}
                    className={`
                      aspect-square rounded-xl text-2xl sm:text-3xl
                      flex items-center justify-center flex-col gap-0.5
                      transition-all duration-150 select-none active:scale-95
                      ${avatarURL
                        ? 'ring-2 ring-amber-600 ring-offset-1 scale-105 shadow-sm bg-amber-50'
                        : 'bg-gray-100 hover:bg-amber-50 hover:ring-1 hover:ring-amber-300'
                      }
                    `}
                    aria-label="上传自定义头像"
                  >
                    {avatarUploading ? (
                      <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    ) : avatarURL ? (
                      <img src={avatarURL} alt="我的头像" className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <span className="text-xl">📷</span>
                    )}
                    {!avatarURL && !avatarUploading && (
                      <span className="text-[9px] text-gray-400 leading-none">上传</span>
                    )}
                  </button>
                </div>
                {/* 上传错误提示 */}
                {avatarUploadErr && (
                  <p className="text-xs text-red-500 mt-1">{avatarUploadErr}</p>
                )}
                {/* 隐藏的 file input */}
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleAvatarFileChange}
                />
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
                  <span className="text-lg">⚠️</span>
                  <span>{error}</span>
                </div>
              )}

              {/* 提交按钮 */}
              <button
                type="submit"
                disabled={!canSubmit}
                className={`
                  w-full py-4 rounded-xl text-base font-semibold
                  transition-all duration-200 shadow-sm
                  ${canSubmit
                    ? 'bg-amber-700 hover:bg-amber-800 active:bg-amber-900 text-white shadow-amber-200 active:scale-[0.98]'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }
                `}
              >
                {loading
                  ? <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      {t('student.joining')}
                    </span>
                  : t('student.join')
                }
              </button>
            </form>

            {/* 教师入口 */}
            <div className="px-6 sm:px-8 pb-6 pt-0 text-center border-t border-gray-50">
              <button
                onClick={() => navigate('/login')}
                className="text-sm text-amber-600 hover:text-amber-800 transition-colors py-2"
              >
                教师 / 管理员登录 →
              </button>
            </div>
          </div>

          {/* 底部说明（键盘弹出时隐藏） */}
          {!keyboardOpen && (
            <div className="mt-6 text-center text-xs text-gray-300 space-y-1">
              <p>扫描教师分享的二维码可自动填入房间码</p>
              <p>你的昵称仅在本次课堂中使用</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default JoinPage;
