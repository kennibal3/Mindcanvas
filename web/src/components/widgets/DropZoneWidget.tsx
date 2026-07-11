// =============================================================
// MindCanvas v4.3 - 作品收集区 Widget
// REQ-013修复：异常状态Widget可被教师手动重置为draft
// REQ-020修复：Widget卡片固定白色背景，暗色模式下仍保持可读性
// REQ-023修复：文字提交textarea加onChange+onInput+onBlur三事件
// V4.3-STABLE：handleStatusChange不产生三层嵌套
// =============================================================
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Inbox, Send, ThumbsUp, Pin, Tag, EyeOff, Trash2,
  Play, Pause, CheckSquare, Loader2, Maximize2,
  LayoutGrid, List, AlignJustify, RotateCcw,
} from 'lucide-react';
import { useRoomStore } from '@/store/roomStore';
import type { DropzonePayload, Submission } from '@/types/widget';

const PRESET_TAGS = ['优秀', '有创意', '待改进', '需讨论'] as const;

// REQ-020：固定白色背景，不跟随暗色主题，保证可读性
const STATUS_CONFIG = {
  draft:  { label: '未开始', color: 'bg-gray-100 text-gray-600' },
  open:   { label: '收集中', color: 'bg-green-100 text-green-700' },
  paused: { label: '已暂停', color: 'bg-yellow-100 text-yellow-700' },
  closed: { label: '已结束', color: 'bg-gray-100 text-gray-500' },
};

const TYPE_LABELS: Record<string, string> = {
  text: '文字', image: '图片', file: '文件', link: '链接',
};

interface Props {
  id: string;
  payload: Record<string, unknown>;
  isTeacher: boolean;
  isLocked?: boolean;
  onUpdate: (payload: Record<string, unknown>) => void;
  onSubmit?: (action: string, data: Record<string, unknown>) => void;
}

function extractInner(payload: Record<string, unknown>): Record<string, unknown> {
  const inner = payload?.payload;
  if (inner !== null && inner !== undefined && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return payload;
}

function parseInnerPayload(inner: Record<string, unknown>): DropzonePayload {
  return {
    title:              (inner.title              as string)                         ?? '作品收集',
    prompt:             (inner.prompt             as string)                         ?? '请提交你的作品',
    acceptTypes:        (inner.acceptTypes        as DropzonePayload['acceptTypes']) ?? ['text', 'image'],
    maxFileSizeMB:      (inner.maxFileSizeMB      as number)                         ?? 50,
    status:             (inner.status             as DropzonePayload['status'])      ?? 'draft',
    deadline:           inner.deadline            as string | undefined,
    submissionUnit:     (inner.submissionUnit     as 'individual' | 'group')         ?? 'individual',
    maxPerStudent:      (inner.maxPerStudent      as number)                         ?? 3,
    requireDescription: (inner.requireDescription as boolean)                        ?? false,
    layout:             (inner.layout             as DropzonePayload['layout'])      ?? 'grid',
    hideNames:          (inner.hideNames          as boolean)                        ?? false,
    enableLike:         (inner.enableLike         as boolean)                        ?? true,
    submissionOrder:    (inner.submissionOrder    as string[])                       ?? [],
    submissionCount:    (inner.submissionCount    as number)                         ?? 0,
  };
}

export const DropZoneWidget: React.FC<Props> = ({
  id, payload: rawPayload, isTeacher, isLocked, onUpdate, onSubmit,
}) => {
  const inner   = extractInner(rawPayload);
  const payload = parseInnerPayload(inner);

  const { currentUserUUID, currentRoom } = useRoomStore();
  const roomID = currentRoom?.id ?? '';

  const [submissions, setSubmissions]         = useState<Submission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const hasFetchedRef = useRef(false);

  // REQ-023：三事件分别用ref和state双重保险
  const [textInput, setTextInput]   = useState('');
  const textInputRef                = useRef<HTMLInputElement>(null);
  const [linkInput, setLinkInput]   = useState('');
  const linkInputRef                = useRef<HTMLInputElement>(null);
  const [submitError, setSubmitError]   = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [uploading, setUploading]       = useState(false);

  const [tagPickerId, setTagPickerId] = useState<string | null>(null);
  const [filterTag, setFilterTag]     = useState('');
  const [filterType, setFilterType]   = useState('');

  // REQ-013：显示重置确认
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const myCount = submissions.filter(s => s.student_uuid === currentUserUUID && !s.deleted).length;
  const canSubmitMore = myCount < payload.maxPerStudent;

  useEffect(() => {
    if (!id || !roomID || hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    setLoadingSubmissions(true);
    fetch(`/api/rooms/${roomID}/elements/${id}/submissions`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(data => setSubmissions(data.submissions ?? []))
      .catch(err => console.error('[DropZone] fetch error:', err))
      .finally(() => setLoadingSubmissions(false));
  }, [id, roomID]);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const msg = e.detail;
      if (msg.type !== 'dropzone_update' || msg.element_id !== id) return;
      if (msg.payload) onUpdate(msg.payload as Record<string, unknown>);
      if (msg.new_submission) {
        setSubmissions(prev => {
          const exists = prev.find(s => s.id === (msg.new_submission as Submission).id);
          return exists ? prev : [...prev, msg.new_submission as Submission];
        });
      }
      if (msg.updated_submission) {
        const updated = msg.updated_submission as Submission;
        setSubmissions(prev =>
          updated.deleted
            ? prev.filter(s => s.id !== updated.id)
            : prev.map(s => s.id === updated.id ? { ...s, ...updated } : s)
        );
      }
    };
    window.addEventListener('ws_dropzone_update', handler as EventListener);
    return () => window.removeEventListener('ws_dropzone_update', handler as EventListener);
  }, [id, onUpdate]);

  // V4.3-STABLE：传 inner + 新状态
  const handleStatusChange = (newStatus: DropzonePayload['status']) => {
    onUpdate({ ...inner, status: newStatus });
  };

  // REQ-013：重置Widget状态为draft（教师手动重置异常状态）
  const handleReset = () => {
    onUpdate({ ...inner, status: 'draft' });
    setShowResetConfirm(false);
  };

  // REQ-035-a：删除整个作品收集组件（此前只有删单条提交的入口，没有删组件本身的入口）
  const handleDeleteWidget = () => {
    if (confirm('确定删除整个作品收集组件？已提交的作品也会一并删除，且无法恢复。')) {
      onUpdate({ __delete: true });
    }
  };

  const sendAction = useCallback((
    submissionId: string,
    actionType: 'like' | 'pin' | 'tag' | 'hide' | 'delete_submission',
    extra?: Record<string, unknown>
  ) => {
    onSubmit?.('dropzone_action', {
      element_id:    id,
      submission_id: submissionId,
      action_type:   actionType,
      ...extra,
    });
  }, [id, onSubmit]);

  // REQ-023：读取时优先用ref兜底，防止粘贴/自动填充丢失
  const handleSubmitText = () => {
    const val = (textInputRef.current?.value?.trim()) || textInput.trim();
    if (!val || !canSubmitMore) return;
    onSubmit?.('dropzone_submit', { element_id: id, content_type: 'text', content: val });
    setTextInput('');
    if (textInputRef.current) textInputRef.current.value = '';
    setSubmitSuccess(true);
    setTimeout(() => setSubmitSuccess(false), 2000);
  };

  const handleSubmitLink = () => {
    const val = (linkInputRef.current?.value?.trim()) || linkInput.trim();
    if (!val || !canSubmitMore) return;
    try { new URL(val); } catch {
      setSubmitError('请输入有效的链接地址');
      return;
    }
    onSubmit?.('dropzone_submit', { element_id: id, content_type: 'link', content: val });
    setLinkInput('');
    if (linkInputRef.current) linkInputRef.current.value = '';
    setSubmitSuccess(true);
    setTimeout(() => setSubmitSuccess(false), 2000);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canSubmitMore) return;
    if (file.size > 10 * 1024 * 1024) { setSubmitError('图片不能超过 10MB'); return; }
    setUploading(true); setSubmitError('');
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await fetch('/api/upload/image', {
        method: 'POST',
        headers: { 'X-Room-Id': roomID, 'X-Student-UUID': currentUserUUID ?? '' },
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) throw new Error('上传失败');
      const data = await res.json();
      onSubmit?.('dropzone_submit', { element_id: id, content_type: 'image', content: data.url, thumbnail: data.url });
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 2000);
    } catch {
      setSubmitError('图片上传失败，请重试');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canSubmitMore) return;
    const maxBytes = payload.maxFileSizeMB * 1024 * 1024;
    if (file.size > maxBytes) { setSubmitError(`文件不能超过 ${payload.maxFileSizeMB}MB`); return; }
    setUploading(true); setSubmitError('');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`/api/upload/file?element_id=${id}`, {
        method: 'POST',
        headers: { 'X-Room-Id': roomID, 'X-Student-UUID': currentUserUUID ?? '' },
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || '上传失败'); }
      const data = await res.json();
      onSubmit?.('dropzone_submit', {
        element_id: id, content_type: 'file',
        content: data.url, original_name: data.original_name,
        file_category: data.file_category, file_size: data.file_size,
      });
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 2000);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : '文件上传失败，请重试');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const filteredSubmissions = submissions.filter(s => {
    if (s.deleted) return false;
    if (!isTeacher && s.hidden) return false;
    if (filterTag && !s.tags.includes(filterTag)) return false;
    if (filterType && s.content_type !== filterType) return false;
    return true;
  }).sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return 0;
  });

  const statusInfo = STATUS_CONFIG[payload.status] ?? STATUS_CONFIG.draft;

  const renderSubmission = (sub: Submission) => {
    const displayName = (payload.hideNames && !isTeacher) ? '匿名' : sub.student_name;
    return (
      <div
        key={sub.id}
        className={`relative rounded-lg border p-2.5 text-sm transition-all bg-white ${
          sub.pinned ? 'border-amber-400' : 'border-gray-200'
        } ${sub.hidden ? 'opacity-50' : ''}`}
      >
        {sub.pinned && <span className="absolute top-1.5 right-1.5 text-amber-500 text-xs">📌</span>}
        <div className="mb-2 pr-4">
          {sub.content_type === 'text' && (
            <p className="text-gray-800 line-clamp-3 text-xs">{sub.content}</p>
          )}
          {sub.content_type === 'image' && (
            <img src={sub.thumbnail ?? sub.content} alt="作品" className="w-full rounded object-cover max-h-32" />
          )}
          {sub.content_type === 'file' && (
            <a href={sub.content} target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-1.5 text-amber-700 hover:underline text-xs">
              <span>📎</span><span className="truncate">{sub.content.split('/').pop()}</span>
            </a>
          )}
          {sub.content_type === 'link' && (
            <a href={sub.content} target="_blank" rel="noopener noreferrer"
               className="text-amber-700 hover:underline text-xs break-all line-clamp-2">
              {sub.content}
            </a>
          )}
        </div>
        {sub.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap mb-1.5">
            {sub.tags.map(tag => (
              <span key={tag} className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span className="truncate max-w-[60%]">{displayName}</span>
          <div className="flex items-center gap-1">
            <span className="flex items-center gap-0.5"><ThumbsUp size={10} />{sub.likes}</span>
            {isTeacher && (
              <div className="flex items-center gap-0.5 ml-1">
                {payload.enableLike && (
                  <button onClick={() => sendAction(sub.id, 'like')} title="点赞"
                    className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-700">
                    <ThumbsUp size={11} />
                  </button>
                )}
                <button onClick={() => sendAction(sub.id, 'pin')} title={sub.pinned ? '取消置顶' : '置顶'}
                  className={`p-0.5 rounded hover:bg-gray-100 ${sub.pinned ? 'text-amber-500' : 'text-gray-400'}`}>
                  <Pin size={11} />
                </button>
                <div className="relative">
                  <button onClick={() => setTagPickerId(tagPickerId === sub.id ? null : sub.id)} title="标签"
                    className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-green-500">
                    <Tag size={11} />
                  </button>
                  {tagPickerId === sub.id && (
                    <div className="absolute right-0 bottom-6 bg-white border border-gray-200 rounded-lg shadow-lg p-1.5 z-50 min-w-[80px]">
                      {PRESET_TAGS.map(tag => (
                        <button key={tag}
                          onClick={() => { sendAction(sub.id, 'tag', { tags: [tag] }); setTagPickerId(null); }}
                          className="block w-full text-left text-xs px-2 py-1 hover:bg-gray-100 rounded">
                          {tag}
                        </button>
                      ))}
                      <button
                        onClick={() => { sendAction(sub.id, 'tag', { tags: [] }); setTagPickerId(null); }}
                        className="block w-full text-left text-xs px-2 py-1 hover:bg-red-50 text-red-500 rounded">
                        清除
                      </button>
                    </div>
                  )}
                </div>
                <button onClick={() => sendAction(sub.id, 'hide')} title={sub.hidden ? '取消隐藏' : '隐藏'}
                  className={`p-0.5 rounded hover:bg-gray-100 ${sub.hidden ? 'text-orange-500' : 'text-gray-400'}`}>
                  <EyeOff size={11} />
                </button>
                <button
                  onClick={() => { if (confirm('确定删除？')) sendAction(sub.id, 'delete_submission'); }}
                  title="删除"
                  className="p-0.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
                  <Trash2 size={11} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const gridClass = {
    grid:      'grid grid-cols-2 gap-2',
    waterfall: 'columns-2 gap-2',
    list:      'flex flex-col gap-2',
    spotlight: 'flex flex-col gap-2',
  }[payload.layout];

  return (
    // REQ-020：固定白色背景，不跟随暗色主题
    <div
      className="bg-white rounded-xl shadow-lg border border-gray-200 flex flex-col h-full"
      style={{ color: '#1f2937' }}
      onClick={e => { e.stopPropagation(); if (tagPickerId) setTagPickerId(null); }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm">📥</span>
          <span className="font-semibold text-gray-800 text-sm truncate">{payload.title}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
          {/* REQ-013：教师可重置异常状态 */}
          {isTeacher && payload.status === 'closed' && (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="p-1 rounded hover:bg-yellow-50 text-gray-400 hover:text-yellow-600 transition-colors"
              title="重置为未开始"
            >
              <RotateCcw size={12} />
            </button>
          )}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('dropzone_fullscreen', { detail: { id } }))}
            className="p-1 rounded hover:bg-gray-100 text-gray-400"
            title="全屏查看"
          >
            <Maximize2 size={13} />
          </button>
          {/* REQ-035-a：此前作品收集组件没有删除整个组件的入口，只能删单条提交 */}
          {isTeacher && (
            <button
              onClick={handleDeleteWidget}
              className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
              title="删除整个组件"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* REQ-013：重置确认提示 */}
      {showResetConfirm && (
        <div className="mx-2.5 mt-2 p-2.5 bg-yellow-50 border border-yellow-200 rounded-lg text-xs">
          <p className="text-yellow-800 mb-2">重置为「未开始」状态？已提交的作品不会丢失。</p>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="px-2.5 py-1 bg-yellow-500 text-white rounded text-xs font-medium hover:bg-yellow-600"
            >
              确认重置
            </button>
            <button
              onClick={() => setShowResetConfirm(false)}
              className="px-2.5 py-1 bg-white border border-gray-200 text-gray-600 rounded text-xs hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2.5 min-h-0">
        {/* 教师控制按钮 */}
        {isTeacher && !isLocked && (
          <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
            {payload.status === 'draft' && (
              <button onClick={() => handleStatusChange('open')}
                className="flex items-center gap-1 px-2.5 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-medium">
                <Play size={11} /> 开始
              </button>
            )}
            {payload.status === 'open' && (<>
              <button onClick={() => handleStatusChange('paused')}
                className="flex items-center gap-1 px-2.5 py-1 bg-yellow-500 hover:bg-yellow-600 text-white rounded text-xs font-medium">
                <Pause size={11} /> 暂停
              </button>
              <button onClick={() => handleStatusChange('closed')}
                className="flex items-center gap-1 px-2.5 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-medium">
                <CheckSquare size={11} /> 结束
              </button>
            </>)}
            {payload.status === 'paused' && (<>
              <button onClick={() => handleStatusChange('open')}
                className="flex items-center gap-1 px-2.5 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-medium">
                <Play size={11} /> 恢复
              </button>
              <button onClick={() => handleStatusChange('closed')}
                className="flex items-center gap-1 px-2.5 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-medium">
                <CheckSquare size={11} /> 结束
              </button>
            </>)}
            <span className="ml-auto text-xs text-gray-400">
              {submissions.filter(s => !s.deleted).length} 件
            </span>
          </div>
        )}

        {/* 教师筛选栏 */}
        {isTeacher && submissions.length > 0 && (
          <div className="flex gap-1.5 mb-2 flex-wrap items-center">
            <select value={filterTag} onChange={e => setFilterTag(e.target.value)}
              className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-700">
              <option value="">全部标签</option>
              {PRESET_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-700">
              <option value="">全部类型</option>
              {payload.acceptTypes.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
            <div className="ml-auto flex gap-0.5">
              {([['grid', LayoutGrid], ['list', List], ['waterfall', AlignJustify]] as const).map(([val, Icon]) => (
                <button key={val}
                  onClick={() => onUpdate({ ...inner, layout: val })}
                  className={`p-1 rounded ${payload.layout === val ? 'bg-amber-100 text-amber-700' : 'text-gray-400 hover:text-gray-600'}`}>
                  <Icon size={13} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 学生提交区 */}
        {!isTeacher && payload.status === 'open' && (
          <div className="mb-2.5 space-y-1.5">
            {payload.prompt && <p className="text-xs text-gray-400 italic">{payload.prompt}</p>}

            {/* REQ-023：文字提交三事件 */}
            {payload.acceptTypes.includes('text') && (
              <div className="flex gap-1.5">
                <input
                  ref={textInputRef}
                  type="text"
                  placeholder="输入文字作品..."
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  onInput={e => setTextInput((e.target as HTMLInputElement).value)}
                  onBlur={e => setTextInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmitText()}
                  disabled={!canSubmitMore}
                  maxLength={500}
                  className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800 outline-none focus:border-amber-400 disabled:opacity-50"
                />
                <button onClick={handleSubmitText}
                  disabled={!textInput.trim() || !canSubmitMore || uploading}
                  className="px-2.5 py-1 bg-amber-700 hover:bg-amber-800 text-white rounded text-xs disabled:opacity-50">
                  <Send size={12} />
                </button>
              </div>
            )}
            {payload.acceptTypes.includes('image') && (
              <label className={`flex items-center gap-1.5 px-2.5 py-1.5 border border-dashed rounded cursor-pointer text-xs transition-colors ${canSubmitMore && !uploading ? 'border-gray-300 hover:border-amber-400 hover:bg-amber-50' : 'border-gray-200 opacity-50 cursor-not-allowed'} text-gray-500`}>
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Inbox size={12} />}
                上传图片（≤10MB）
                <input type="file" accept="image/*" className="hidden"
                  disabled={!canSubmitMore || uploading} onChange={handleImageUpload} />
              </label>
            )}
            {payload.acceptTypes.includes('file') && (
              <label className={`flex items-center gap-1.5 px-2.5 py-1.5 border border-dashed rounded cursor-pointer text-xs transition-colors ${canSubmitMore && !uploading ? 'border-gray-300 hover:border-purple-400 hover:bg-purple-50' : 'border-gray-200 opacity-50 cursor-not-allowed'} text-gray-500`}>
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <span>📎</span>}
                上传文件（PDF/Word/PPT/ZIP等，≤{payload.maxFileSizeMB}MB）
                <input type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.md,.txt,.mp3,.wav"
                  className="hidden" disabled={!canSubmitMore || uploading} onChange={handleFileUpload} />
              </label>
            )}
            {/* REQ-023：链接提交三事件 */}
            {payload.acceptTypes.includes('link') && (
              <div className="flex gap-1.5">
                <input
                  ref={linkInputRef}
                  type="url"
                  placeholder="粘贴链接..."
                  value={linkInput}
                  onChange={e => setLinkInput(e.target.value)}
                  onInput={e => setLinkInput((e.target as HTMLInputElement).value)}
                  onBlur={e => setLinkInput(e.target.value)}
                  disabled={!canSubmitMore}
                  className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800 outline-none focus:border-amber-400 disabled:opacity-50"
                />
                <button onClick={handleSubmitLink}
                  disabled={!linkInput.trim() || !canSubmitMore}
                  className="px-2.5 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs disabled:opacity-50">
                  提交
                </button>
              </div>
            )}
            {submitError   && <p className="text-xs text-red-500">{submitError}</p>}
            {submitSuccess && <p className="text-xs text-green-600">✓ 提交成功！</p>}
            {!canSubmitMore && <p className="text-xs text-gray-400">已提交 {myCount}/{payload.maxPerStudent} 件，已达上限</p>}
            {canSubmitMore  && <p className="text-xs text-gray-400">已提交 {myCount}/{payload.maxPerStudent} 件</p>}
          </div>
        )}

        {!isTeacher && payload.status === 'draft'  && <div className="text-center py-4 text-xs text-gray-400">等待老师开始收集...</div>}
        {!isTeacher && payload.status === 'paused' && <div className="text-center py-2 text-xs text-yellow-600">⏸ 收集已暂停</div>}
        {!isTeacher && payload.status === 'closed' && <div className="text-center py-2 text-xs text-gray-400">✓ 收集已结束</div>}

        {(isTeacher || payload.status !== 'draft') && (
          loadingSubmissions ? (
            <div className="flex justify-center py-4">
              <Loader2 size={18} className="animate-spin text-gray-400" />
            </div>
          ) : filteredSubmissions.length === 0 ? (
            <div className="text-center py-4 text-xs text-gray-400">
              {payload.status === 'draft' ? '开始收集后将显示作品' : '暂无作品'}
            </div>
          ) : (
            <div className={gridClass}>
              {filteredSubmissions.map(sub => renderSubmission(sub))}
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default DropZoneWidget;
