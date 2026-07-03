// =============================================================
// MindCanvas v4.1 Phase7 - 发布分享弹窗
// 功能：配置并发布公开分享页，支持密码、隐藏姓名、过期时间
//       发布后显示分享链接并支持一键复制
// =============================================================
import React, { useState, useEffect, useCallback } from 'react';
import {
  X, Globe, Lock, Eye, EyeOff, Calendar, Copy,
  Check, Share2, Trash2, ExternalLink, RefreshCw,
  ToggleLeft, ToggleRight,
} from 'lucide-react';

// ===== 类型定义 =====

interface ShareConfig {
  title: string;
  description: string;
  visibility: 'public' | 'password';
  password: string;
  hide_names: boolean;
  show_stats: boolean;
  show_canvas: boolean;
  show_dropzone: boolean;
  expires_at: string;
}

interface ExistingShare {
  id: string;
  share_token: string;
  title: string;
  visibility: 'public' | 'password';
  hide_names: boolean;
  show_stats: boolean;
  show_canvas: boolean;
  show_dropzone: boolean;
  expires_at?: string;
  view_count: number;
  created_at: string;
}

interface Props {
  roomId: string;
  roomTitle: string;
  onClose: () => void;
}

// ===== 工具函数 =====

/** 复制到剪贴板（兼容旧浏览器） */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}
function fallbackCopy(text: string): Promise<void> {
  return new Promise(resolve => {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    resolve();
  });
}

/** Toggle 开关组件 */
function Toggle({ enabled, onChange, label, desc }: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <div className="text-sm text-gray-700">{label}</div>
        {desc && <div className="text-xs text-gray-400 mt-0.5">{desc}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        className={`relative flex-shrink-0 ml-4 transition-colors ${
          enabled ? 'text-amber-700' : 'text-gray-300'
        }`}
      >
        {enabled
          ? <ToggleRight size={32} className="text-amber-700" />
          : <ToggleLeft size={32} className="text-gray-300" />}
      </button>
    </div>
  );
}

// ===== 主组件 =====

const SharePublishModal: React.FC<Props> = ({ roomId, roomTitle, onClose }) => {
  // 表单状态
  const [config, setConfig] = useState<ShareConfig>({
    title: roomTitle,
    description: '',
    visibility: 'public',
    password: '',
    hide_names: false,
    show_stats: true,
    show_canvas: true,
    show_dropzone: true,
    expires_at: '',
  });

  // 弹窗阶段：form（配置）→ published（已发布）
  const [stage, setStage]           = useState<'loading' | 'form' | 'published'>('loading');
  const [existingShare, setExistingShare] = useState<ExistingShare | null>(null);
  const [shareUrl, setShareUrl]     = useState('');
  const [copied, setCopied]         = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting]     = useState(false);
  const [error, setError]           = useState('');
  const [showPwd, setShowPwd]       = useState(false);

  // 计算完整分享 URL
  const buildShareUrl = useCallback((token: string) => {
    return `${window.location.origin}/share/${token}`;
  }, []);

  // 加载已有分享配置
  useEffect(() => {
    fetch(`/api/rooms/${roomId}/share`, { credentials: 'include' })
      .then(r => r.json())
      .then(json => {
        const shares: ExistingShare[] = json.shares || [];
        if (shares.length > 0) {
          const s = shares[0];
          setExistingShare(s);
          // 用已有配置回填表单
          setConfig(prev => ({
            ...prev,
            title:        s.title || roomTitle,
            visibility:   s.visibility,
            hide_names:   s.hide_names,
            show_stats:   s.show_stats,
            show_canvas:  s.show_canvas,
            show_dropzone: s.show_dropzone,
            expires_at:   s.expires_at
              ? new Date(s.expires_at).toISOString().split('T')[0]
              : '',
          }));
          setShareUrl(buildShareUrl(s.share_token));
          setStage('published');
        } else {
          setStage('form');
        }
      })
      .catch(() => setStage('form'));
  }, [roomId, roomTitle, buildShareUrl]);

  // 更新单个配置字段
  const update = <K extends keyof ShareConfig>(key: K, val: ShareConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: val }));
  };

  // 发布分享
  const handlePublish = useCallback(async () => {
    setError('');
    if (config.visibility === 'password' && !config.password && !existingShare) {
      setError('请设置访问密码');
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '发布失败');
        return;
      }
      const share = json.share as ExistingShare;
      setExistingShare(share);
      setShareUrl(buildShareUrl(share.share_token));
      setStage('published');
    } catch {
      setError('网络错误，请重试');
    } finally {
      setPublishing(false);
    }
  }, [roomId, config, existingShare, buildShareUrl]);

  // 更新已有分享（重新发布）
  const handleUpdate = useCallback(async () => {
    setError('');
    setPublishing(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '更新失败');
        return;
      }
      const share = json.share as ExistingShare;
      setExistingShare(share);
      setShareUrl(buildShareUrl(share.share_token));
      setStage('published');
    } catch {
      setError('网络错误，请重试');
    } finally {
      setPublishing(false);
    }
  }, [roomId, config, buildShareUrl]);

  // 删除分享
  const handleDelete = useCallback(async () => {
    if (!existingShare) return;
    if (!confirm('确认撤销分享？已分享的链接将立即失效。')) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/share/${existingShare.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setExistingShare(null);
        setShareUrl('');
        setConfig(prev => ({
          ...prev,
          title: roomTitle,
          description: '',
          visibility: 'public',
          password: '',
          hide_names: false,
          show_stats: true,
          show_canvas: true,
          show_dropzone: true,
          expires_at: '',
        }));
        setStage('form');
      }
    } catch {
      setError('删除失败，请重试');
    } finally {
      setDeleting(false);
    }
  }, [roomId, existingShare, roomTitle]);

  // 复制链接
  const handleCopy = useCallback(async () => {
    await copyText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  // ===== 渲染 =====

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">

        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Share2 size={18} className="text-amber-700" />
            <h2 className="text-base font-semibold text-gray-800">发布课堂分享</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* 加载中 */}
        {stage === 'loading' && (
          <div className="py-12 flex items-center justify-center">
            <RefreshCw size={24} className="animate-spin text-gray-300" />
          </div>
        )}

        {/* 已发布状态：显示分享链接 */}
        {stage === 'published' && existingShare && (
          <div className="p-6 space-y-4">
            {/* 成功横幅 */}
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <div className="text-2xl mb-1">✅</div>
              <p className="text-sm font-medium text-green-700">分享页已发布</p>
              <p className="text-xs text-green-600 mt-0.5">
                {existingShare.view_count} 次访问
              </p>
            </div>

            {/* 分享链接 */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">分享链接</label>
              <div className="flex items-center gap-2 bg-gray-50 rounded-xl border border-gray-200 px-3 py-2.5">
                <span className="flex-1 text-sm text-amber-800 break-all font-mono text-xs">
                  {shareUrl}
                </span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={handleCopy}
                    className={`p-1.5 rounded-lg transition-colors ${
                      copied
                        ? 'text-green-500 bg-green-50'
                        : 'text-gray-400 hover:text-amber-700 hover:bg-amber-50'
                    }`}
                    title="复制链接"
                  >
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-amber-700 hover:bg-amber-50 transition-colors"
                    title="在新窗口打开"
                  >
                    <ExternalLink size={15} />
                  </a>
                </div>
              </div>
            </div>

            {/* 当前配置摘要 */}
            <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500 space-y-1">
              <div className="flex items-center justify-between">
                <span>访问方式</span>
                <span className={`font-medium ${
                  existingShare.visibility === 'password'
                    ? 'text-orange-600'
                    : 'text-green-600'
                }`}>
                  {existingShare.visibility === 'password' ? '🔒 密码保护' : '🌐 公开访问'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>学生姓名</span>
                <span>{existingShare.hide_names ? '已隐藏' : '显示'}</span>
              </div>
              {existingShare.expires_at && (
                <div className="flex items-center justify-between">
                  <span>过期时间</span>
                  <span className="text-orange-500">
                    {new Date(existingShare.expires_at).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-2">
              <button
                onClick={() => setStage('form')}
                className="flex-1 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5"
              >
                <RefreshCw size={14} />
                修改设置
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-2 text-sm border border-red-200 rounded-xl text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 size={14} />
                {deleting ? '撤销中...' : '撤销分享'}
              </button>
            </div>

            <button
              onClick={handleCopy}
              className="w-full py-2.5 bg-amber-700 hover:bg-amber-800 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? '已复制！' : '复制分享链接'}
            </button>
          </div>
        )}

        {/* 配置表单（新建或修改） */}
        {stage === 'form' && (
          <div className="p-6 space-y-4">

            {/* 分享标题 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">分享标题</label>
              <input
                type="text"
                value={config.title}
                onChange={e => update('title', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                placeholder={roomTitle}
              />
            </div>

            {/* 分享描述 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                描述 <span className="text-gray-400 font-normal">（选填）</span>
              </label>
              <textarea
                value={config.description}
                onChange={e => update('description', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"
                placeholder="简要描述这次课堂活动..."
                rows={2}
              />
            </div>

            {/* 访问方式 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">访问方式</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => update('visibility', 'public')}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 transition-all text-sm ${
                    config.visibility === 'public'
                      ? 'border-amber-400 bg-amber-50 text-amber-800'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <Globe size={16} />
                  <div className="text-left">
                    <div className="font-medium">公开访问</div>
                    <div className="text-xs opacity-70">任何人可查看</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => update('visibility', 'password')}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 transition-all text-sm ${
                    config.visibility === 'password'
                      ? 'border-orange-400 bg-orange-50 text-orange-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <Lock size={16} />
                  <div className="text-left">
                    <div className="font-medium">密码保护</div>
                    <div className="text-xs opacity-70">需要密码查看</div>
                  </div>
                </button>
              </div>
            </div>

            {/* 密码输入框（密码模式时显示） */}
            {config.visibility === 'password' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  访问密码
                  {existingShare && (
                    <span className="ml-1 text-gray-400 font-normal">
                      （留空保持原密码）
                    </span>
                  )}
                </label>
                <div className="relative">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={config.password}
                    onChange={e => update('password', e.target.value)}
                    className="w-full px-3 py-2 pr-10 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                    placeholder={existingShare ? '不修改则留空' : '设置访问密码'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                  >
                    {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            )}

            {/* 展示内容开关 */}
            <div className="border border-gray-100 rounded-xl px-4 divide-y divide-gray-50">
              <Toggle
                enabled={config.show_stats}
                onChange={v => update('show_stats', v)}
                label="展示统计数据"
                desc="投票结果、问答正确率、词云"
              />
              <Toggle
                enabled={config.show_dropzone}
                onChange={v => update('show_dropzone', v)}
                label="展示作品墙"
                desc="学生提交的作品内容"
              />
              <Toggle
                enabled={config.hide_names}
                onChange={v => update('hide_names', v)}
                label="隐藏学生姓名"
                desc="作品墙中显示匿名而非真实姓名"
              />
            </div>

            {/* 过期时间 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                <Calendar size={12} className="inline mr-1" />
                过期时间
                <span className="text-gray-400 font-normal ml-1">（不设置则永久有效）</span>
              </label>
              <input
                type="date"
                value={config.expires_at}
                onChange={e => update('expires_at', e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
              {config.expires_at && (
                <button
                  type="button"
                  onClick={() => update('expires_at', '')}
                  className="text-xs text-red-400 hover:text-red-600 mt-1"
                >
                  清除过期时间
                </button>
              )}
            </div>

            {/* 错误提示 */}
            {error && (
              <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            {/* 提交按钮 */}
            <div className="flex gap-2 pt-1">
              {existingShare && (
                <button
                  type="button"
                  onClick={() => setStage('published')}
                  className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
              )}
              <button
                type="button"
                onClick={existingShare ? handleUpdate : handlePublish}
                disabled={publishing}
                className="flex-1 py-2.5 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Share2 size={15} />
                {publishing
                  ? '发布中...'
                  : existingShare
                    ? '更新分享'
                    : '发布分享'}
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
};

export default SharePublishModal;
