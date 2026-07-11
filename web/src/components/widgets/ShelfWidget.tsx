import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Image, Link, Type, Loader2, Pencil, Check, X as XIcon } from 'lucide-react';
import { useImageUpload } from '@/hooks/useImageUpload';

interface ShelfCard {
  id: string;
  room_id: string;
  element_id: string;
  group_id: string | null;
  author_uuid: string;
  author_name: string;
  card_type: 'text' | 'image' | 'link';
  content: string;
  image_url?: string;
  link_url?: string;
  link_title?: string;
  is_hidden: boolean;
  created_at: string;
}

// REQ-036：协作墙改为"主题 + 回复"模式。老师创建时先写好 topic_text（必填）/
// topic_image_url/topic_link_url（都可选），固定展示在墙顶部；所有学生的
// shelf_cards 都是围绕这一个主题的回复，统一显示为一条留言流，不再按学生分组
// 分栏、不再有"各组隔离"的可见性开关——回复默认互相可见（讨论区风格）。
interface ShelfPayload {
  title?: string;
  status?: 'open' | 'closed';
  allow_types?: ('text' | 'image' | 'link')[];
  topic_text?: string;
  topic_image_url?: string;
  topic_link_url?: string;
  topic_link_title?: string;
}

interface ShelfWidgetProps {
  elementId: string;
  roomId: string;
  payload: ShelfPayload;
  isTeacher: boolean;
  studentUUID?: string;
  studentName?: string;
  onUpdate?: (patch: Partial<ShelfPayload>) => void;
  /**
   * REQ-035-a：删除整个协作墙组件。此前完全没有这个入口——组件里唯一的 Trash2
   * 图标（见下方卡片渲染处）删的是单张卡片，不是组件本身。
   * 单独开一个 onDelete prop 而不是复用 onUpdate({__delete:true})，是因为
   * FloatingWidgets.tsx 里 ShelfWidget 的 onUpdate 会把参数包进 { payload: p }
   * 再转给 handleElementUpdate，__delete 标记会被包在 payload 里而不是顶层，
   * 对不上 handleElementUpdate 检查 patch?.__delete 的位置，直接复用会导致删除不生效。
   */
  onDelete?: () => void;
}

const CARD_BG = [
  '#FFF9C4', '#FFE0B2', '#E8F5E9', '#E3F2FD',
  '#FCE4EC', '#EDE7F6', '#E0F7FA', '#F3E5F5',
];
function cardBg(authorUUID: string) {
  let h = 0;
  for (let i = 0; i < authorUUID.length; i++) h = (h * 31 + authorUUID.charCodeAt(i)) >>> 0;
  return CARD_BG[h % CARD_BG.length];
}

async function fetchCards(roomId: string, elementId: string) {
  const res = await fetch(`/api/rooms/${roomId}/elements/${elementId}/shelf-cards`,
    { credentials: 'include' });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.cards ?? []) as ShelfCard[];
}

async function postCard(roomId: string, elementId: string, payload: {
  card_type: string;
  content: string;
  image_url?: string;
  link_url?: string;
  link_title?: string;
  author_uuid?: string;
  author_name?: string;
}) {
  const res = await fetch(`/api/rooms/${roomId}/elements/${elementId}/shelf-cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('发送失败');
  const data = await res.json();
  return data.card as ShelfCard;
}

async function deleteCard(roomId: string, elementId: string, cardId: string, authorUUID?: string) {
  await fetch(`/api/rooms/${roomId}/elements/${elementId}/shelf-cards/${cardId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ author_uuid: authorUUID }),
  });
}

export function ShelfWidget({
  elementId, roomId, payload, isTeacher,
  studentUUID, studentName,
  onUpdate, onDelete,
}: ShelfWidgetProps) {
  const [cards, setCards] = useState<ShelfCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'text' | 'image' | 'link'>('text');
  const [textContent, setTextContent] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [editingTopic, setEditingTopic] = useState(false);

  const textRef = useRef<HTMLTextAreaElement>(null);
  const linkUrlRef = useRef<HTMLInputElement>(null);

  const allowTypes = payload.allow_types ?? ['text', 'image', 'link'];
  const isOpen = payload.status !== 'closed';

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementId, roomId]);

  async function load() {
    setLoading(true);
    const data = await fetchCards(roomId, elementId);
    setCards(data);
    setLoading(false);
  }

  useEffect(() => {
    function handleWS(e: Event) {
      const { type, data } = (e as CustomEvent).detail ?? {};
      if (data?.element_id !== elementId) return;
      if (type === 'shelf_card_create') {
        setCards(prev => [...prev, data.card as ShelfCard]);
      } else if (type === 'shelf_card_delete') {
        setCards(prev => prev.filter(c => c.id !== data.card_id));
      }
    }
    window.addEventListener('ws_shelf', handleWS);
    return () => window.removeEventListener('ws_shelf', handleWS);
  }, [elementId]);

  async function handleSubmit() {
    const content = activeTab === 'text'
      ? (textRef.current?.value || textContent).trim()
      : activeTab === 'link'
        ? (linkUrlRef.current?.value || linkUrl).trim()
        : imageUrl.trim();
    if (!content) return;
    setSubmitting(true);
    try {
      await postCard(roomId, elementId, {
        card_type: activeTab,
        content: activeTab === 'text' ? content : '',
        image_url: activeTab === 'image' ? content : undefined,
        link_url: activeTab === 'link' ? content : undefined,
        link_title: activeTab === 'link' ? (linkTitle.trim() || content) : undefined,
        author_uuid: studentUUID,
        author_name: studentName,
      });
      setTextContent(''); setLinkUrl(''); setLinkTitle(''); setImageUrl('');
      if (textRef.current) textRef.current.value = '';
      if (linkUrlRef.current) linkUrlRef.current.value = '';
      setShowInput(false);
    } catch {
      alert('发送失败，请重试');
    }
    setSubmitting(false);
  }

  async function handleDelete(card: ShelfCard) {
    if (!isTeacher && card.author_uuid !== studentUUID) return;
    await deleteCard(roomId, elementId, card.id, studentUUID);
  }

  return (
    <div className="flex flex-col h-full rounded-2xl overflow-hidden"
         style={{ color: '#1f2937', background: '#FFF8F0', border: '1.5px solid #E5E2D9' }}>
      <div className="flex items-center justify-between px-3 py-2"
           style={{ background: '#BA7517' }}>
        <span className="text-white font-semibold text-sm truncate">
          {payload.title || '协作墙'}
        </span>
        <div className="flex items-center gap-2">
          {isTeacher && (
            <>
              <button
                onClick={() => onUpdate?.({ status: isOpen ? 'closed' : 'open' })}
                className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                  isOpen ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-white text-amber-700'
                }`}
              >
                {isOpen ? '收集中' : '已关闭'}
              </button>
              {/* REQ-035-a：此前协作墙没有删除整个组件的入口 */}
              {onDelete && (
                <button
                  title="删除整个协作墙"
                  onClick={() => {
                    if (confirm('确定删除整个协作墙？主题和所有留言都会一并删除，且无法恢复。')) {
                      onDelete();
                    }
                  }}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </>
          )}
          {!isTeacher && isOpen && (
            <button
              onClick={() => setShowInput(v => !v)}
              className="flex items-center gap-1 text-xs bg-white/20 hover:bg-white/30 text-white px-2 py-0.5 rounded-full transition-colors"
            >
              <Plus size={12} />写留言
            </button>
          )}
        </div>
      </div>

      <TopicSection
        payload={payload}
        isTeacher={isTeacher}
        editing={editingTopic}
        onStartEdit={() => setEditingTopic(true)}
        onCancelEdit={() => setEditingTopic(false)}
        onSave={(patch) => { onUpdate?.(patch); setEditingTopic(false); }}
      />

      {!isTeacher && showInput && isOpen && (
        <div className="px-3 py-2 border-b" style={{ borderColor: '#E5E2D9', background: '#fff' }}>
          {allowTypes.length > 1 && (
            <div className="flex gap-1 mb-2">
              {allowTypes.includes('text') && (
                <button onClick={() => setActiveTab('text')}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${activeTab === 'text' ? 'bg-amber-100 text-amber-800 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}>
                  <Type size={11} />文字
                </button>
              )}
              {allowTypes.includes('image') && (
                <button onClick={() => setActiveTab('image')}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${activeTab === 'image' ? 'bg-amber-100 text-amber-800 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}>
                  <Image size={11} />图片
                </button>
              )}
              {allowTypes.includes('link') && (
                <button onClick={() => setActiveTab('link')}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${activeTab === 'link' ? 'bg-amber-100 text-amber-800 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}>
                  <Link size={11} />链接
                </button>
              )}
            </div>
          )}
          {activeTab === 'text' && (
            <textarea ref={textRef} value={textContent}
              onChange={e => setTextContent(e.target.value)}
              onInput={e => setTextContent((e.target as HTMLTextAreaElement).value)}
              onBlur={e => setTextContent(e.target.value)}
              placeholder="回复这个主题…" rows={3}
              className="w-full text-sm border rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
              style={{ borderColor: '#E5E2D9' }} />
          )}
          {activeTab === 'image' && (
            <input value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              onInput={e => setImageUrl((e.target as HTMLInputElement).value)}
              onBlur={e => setImageUrl(e.target.value)}
              placeholder="粘贴图片链接..."
              className="w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
              style={{ borderColor: '#E5E2D9' }} />
          )}
          {activeTab === 'link' && (
            <div className="space-y-1.5">
              <input ref={linkUrlRef} value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                onInput={e => setLinkUrl((e.target as HTMLInputElement).value)}
                onBlur={e => setLinkUrl(e.target.value)}
                placeholder="https://..."
                className="w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                style={{ borderColor: '#E5E2D9' }} />
              <input value={linkTitle}
                onChange={e => setLinkTitle(e.target.value)}
                onInput={e => setLinkTitle((e.target as HTMLInputElement).value)}
                onBlur={e => setLinkTitle(e.target.value)}
                placeholder="链接标题（可选）"
                className="w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                style={{ borderColor: '#E5E2D9' }} />
            </div>
          )}
          <button onClick={handleSubmit} disabled={submitting}
            className="mt-2 w-full flex items-center justify-center gap-1 text-xs py-1.5 rounded-lg text-white transition-colors"
            style={{ background: '#BA7517' }}>
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            {submitting ? '发送中...' : '发布'}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-xs">
            <Loader2 size={16} className="animate-spin mr-1" />加载中...
          </div>
        ) : cards.length === 0 ? (
          <div className="text-center text-xs text-gray-400 py-4">暂无留言</div>
        ) : (
          cards.map(card => (
            <CardItem key={card.id} card={card}
              canDelete={isTeacher || card.author_uuid === studentUUID}
              onDelete={() => handleDelete(card)} />
          ))
        )}
      </div>
    </div>
  );
}

function TopicSection({ payload, isTeacher, editing, onStartEdit, onCancelEdit, onSave }: {
  payload: ShelfPayload;
  isTeacher: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: Partial<ShelfPayload>) => void;
}) {
  const [text, setText] = useState(payload.topic_text || '');
  const [imageUrl, setImageUrl] = useState(payload.topic_image_url || '');
  const [linkUrl, setLinkUrl] = useState(payload.topic_link_url || '');
  const [linkTitle, setLinkTitle] = useState(payload.topic_link_title || '');
  const { uploading, uploadImage } = useImageUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setText(payload.topic_text || '');
      setImageUrl(payload.topic_image_url || '');
      setLinkUrl(payload.topic_link_url || '');
      setLinkTitle(payload.topic_link_title || '');
    }
  }, [editing, payload.topic_text, payload.topic_image_url, payload.topic_link_url, payload.topic_link_title]);

  async function handlePickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await uploadImage(file);
    if (result) setImageUrl(result.url);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleSave() {
    if (!text.trim()) { alert('主题内容不能为空'); return; }
    onSave({
      topic_text: text.trim(),
      topic_image_url: imageUrl.trim() || undefined,
      topic_link_url: linkUrl.trim() || undefined,
      topic_link_title: linkTitle.trim() || undefined,
    });
  }

  if (editing) {
    return (
      <div className="px-3 py-2.5 border-b space-y-2" style={{ borderColor: '#E5E2D9', background: '#fff' }}>
        <textarea value={text} onChange={e => setText(e.target.value)}
          rows={3} placeholder="写下这次讨论的主题或问题…"
          className="w-full text-sm border rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
          style={{ borderColor: '#E5E2D9' }} />
        {imageUrl ? (
          <div className="relative">
            <img src={imageUrl} alt="主题配图" className="w-full rounded-lg max-h-32 object-cover" />
            <button onClick={() => setImageUrl('')}
              className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5">
              <XIcon size={12} />
            </button>
          </div>
        ) : (
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="w-full flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border border-dashed text-gray-500 hover:bg-gray-50 transition-colors"
            style={{ borderColor: '#E5E2D9' }}>
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Image size={12} />}
            {uploading ? '上传中...' : '加一张配图（可选）'}
          </button>
        )}
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden" onChange={handlePickImage} />
        <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
          placeholder="参考链接（可选）"
          className="w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
          style={{ borderColor: '#E5E2D9' }} />
        {linkUrl.trim() && (
          <input value={linkTitle} onChange={e => setLinkTitle(e.target.value)}
            placeholder="链接标题（可选）"
            className="w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
            style={{ borderColor: '#E5E2D9' }} />
        )}
        <div className="flex gap-2 pt-0.5">
          <button onClick={onCancelEdit}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs border border-gray-200 text-gray-500 hover:bg-gray-50">
            <XIcon size={12} />取消
          </button>
          <button onClick={handleSave} disabled={uploading}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs text-white disabled:opacity-50"
            style={{ background: '#BA7517' }}>
            <Check size={12} />保存
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5 border-b relative" style={{ borderColor: '#E5E2D9', background: '#FFFCF7' }}>
      {isTeacher && (
        <button onClick={onStartEdit} title="编辑主题"
          className="absolute top-2 right-2 text-gray-400 hover:text-amber-700 transition-colors">
          <Pencil size={13} />
        </button>
      )}
      <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed pr-5">
        {payload.topic_text || (isTeacher ? '（还没写主题，点右上角铅笔补充）' : '')}
      </p>
      {payload.topic_image_url && (
        <img src={payload.topic_image_url} alt="主题配图"
          className="w-full rounded-lg mt-2 max-h-40 object-cover"
          onError={e => (e.currentTarget.style.display = 'none')} />
      )}
      {payload.topic_link_url && (
        <a href={payload.topic_link_url} target="_blank" rel="noopener noreferrer"
          className="mt-2 flex items-center gap-1 text-xs text-amber-700 underline break-all">
          <Link size={11} className="flex-shrink-0" />
          <span className="truncate">{payload.topic_link_title || payload.topic_link_url}</span>
        </a>
      )}
    </div>
  );
}

function CardItem({ card, canDelete, onDelete }: {
  card: ShelfCard;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const bg = cardBg(card.author_uuid);

  return (
    <div className="relative group rounded-xl p-2.5 shadow-sm text-sm"
         style={{ background: bg, border: '1px solid rgba(0,0,0,0.06)' }}>
      <div className="text-xs text-gray-500 mb-1 font-medium truncate">{card.author_name || '匿名'}</div>
      {card.card_type === 'text' && (
        <p className="text-gray-800 break-words whitespace-pre-wrap leading-relaxed">{card.content}</p>
      )}
      {card.card_type === 'image' && (
        <img src={card.image_url} alt="卡片图片"
             className="w-full rounded-lg object-cover max-h-40"
             onError={e => (e.currentTarget.style.display = 'none')} />
      )}
      {card.card_type === 'link' && (
        <a href={card.link_url} target="_blank" rel="noopener noreferrer"
           className="flex items-center gap-1 text-amber-700 underline break-all">
          <Link size={11} className="flex-shrink-0" />
          <span className="truncate">{card.link_title || card.link_url}</span>
        </a>
      )}
      {canDelete && (
        <button
          onClick={() => { if (confirmDel) { onDelete(); setConfirmDel(false); } else setConfirmDel(true); }}
          onBlur={() => setTimeout(() => setConfirmDel(false), 300)}
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
          title={confirmDel ? '确认删除' : '删除'}>
          <Trash2 size={12} className={confirmDel ? 'text-red-500' : 'text-gray-400 hover:text-red-400'} />
        </button>
      )}
    </div>
  );
}

export default ShelfWidget;
