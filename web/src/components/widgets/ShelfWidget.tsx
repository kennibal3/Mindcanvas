import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Image, Link, Type, Eye, EyeOff, Loader2 } from 'lucide-react';

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

interface ShelfPayload {
  title?: string;
  status?: 'open' | 'closed';
  visibility?: 'isolated' | 'open';
  allow_types?: ('text' | 'image' | 'link')[];
}

interface Group {
  id: string;
  name: string;
  color: string;
  members: string[];
}

interface ShelfWidgetProps {
  elementId: string;
  roomId: string;
  payload: ShelfPayload;
  isTeacher: boolean;
  studentUUID?: string;
  studentName?: string;
  studentGroupId?: string | null;
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

async function fetchCards(roomId: string, elementId: string, groupId?: string | null) {
  const params = groupId ? `?group_id=${groupId}` : '';
  const res = await fetch(`/api/rooms/${roomId}/elements/${elementId}/shelf-cards${params}`,
    { credentials: 'include' });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.cards ?? []) as ShelfCard[];
}

async function postCard(roomId: string, elementId: string, payload: {
  group_id?: string | null;
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

async function setVisibility(roomId: string, elementId: string, visibility: 'isolated' | 'open') {
  await fetch(`/api/rooms/${roomId}/elements/${elementId}/shelf-visibility`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ visibility }),
  });
}

export function ShelfWidget({
  elementId, roomId, payload, isTeacher,
  studentUUID, studentName, studentGroupId,
  onUpdate, onDelete,
}: ShelfWidgetProps) {
  const [cards, setCards] = useState<ShelfCard[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'text' | 'image' | 'link'>('text');
  const [textContent, setTextContent] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [showInput, setShowInput] = useState(false);

  const textRef = useRef<HTMLTextAreaElement>(null);
  const linkUrlRef = useRef<HTMLInputElement>(null);

  const allowTypes = payload.allow_types ?? ['text', 'image', 'link'];
  const visibility = payload.visibility ?? 'open';
  const isOpen = payload.status !== 'closed';
  const viewGroupId = (isTeacher || visibility === 'open') ? null : studentGroupId;

  useEffect(() => {
    load();
    if (isTeacher) {
      fetch(`/api/rooms/${roomId}/groups`, { credentials: 'include' })
        .then(r => r.json())
        .then(d => setGroups(d.groups ?? []))
        .catch(() => {});
    }
  }, [elementId, roomId]);

  async function load() {
    setLoading(true);
    const data = await fetchCards(roomId, elementId, viewGroupId);
    setCards(data);
    setLoading(false);
  }

  useEffect(() => {
    function handleWS(e: Event) {
      const { type, data } = (e as CustomEvent).detail ?? {};
      if (data?.element_id !== elementId) return;
      if (type === 'shelf_card_create') {
        const card = data.card as ShelfCard;
        if (!isTeacher && visibility === 'isolated' &&
            card.group_id && card.group_id !== studentGroupId) return;
        setCards(prev => [...prev, card]);
      } else if (type === 'shelf_card_delete') {
        setCards(prev => prev.filter(c => c.id !== data.card_id));
      } else if (type === 'shelf_visibility') {
        onUpdate?.({ visibility: data.visibility });
      }
    }
    window.addEventListener('ws_shelf', handleWS);
    return () => window.removeEventListener('ws_shelf', handleWS);
  }, [elementId, isTeacher, visibility, studentGroupId, onUpdate]);

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
        group_id: studentGroupId,
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

  const columns: { label: string; color: string; cards: ShelfCard[] }[] =
    isTeacher && groups.length > 0
      ? groups.map(g => ({
          label: g.name,
          color: g.color,
          cards: cards.filter(c => c.group_id === g.id),
        }))
      : [{ label: '全部', color: '#BA7517', cards }];

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
                title={visibility === 'isolated' ? '各组隔离，点击开放互看' : '全组互看，点击隔离'}
                onClick={() => {
                  const next = visibility === 'isolated' ? 'open' : 'isolated';
                  setVisibility(roomId, elementId, next);
                  onUpdate?.({ visibility: next });
                }}
                className="text-white/80 hover:text-white transition-colors"
              >
                {visibility === 'isolated' ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
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
                    if (confirm('确定删除整个协作墙？所有栏目和卡片都会一并删除，且无法恢复。')) {
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
              <Plus size={12} />贴卡片
            </button>
          )}
        </div>
      </div>

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
              placeholder="写点什么..." rows={3}
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

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-xs">
            <Loader2 size={16} className="animate-spin mr-1" />加载中...
          </div>
        ) : (
          <div className="flex gap-3 h-full p-3"
               style={{ minWidth: isTeacher && columns.length > 1 ? `${columns.length * 180}px` : undefined }}>
            {columns.map(col => (
              <div key={col.label} className="flex flex-col flex-shrink-0"
                   style={{ width: isTeacher && columns.length > 1 ? 176 : '100%' }}>
                {isTeacher && columns.length > 1 && (
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: col.color }} />
                    <span className="text-xs font-medium text-gray-600 truncate">{col.label}</span>
                    <span className="text-xs text-gray-400">({col.cards.length})</span>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto space-y-2">
                  {col.cards.length === 0 ? (
                    <div className="text-center text-xs text-gray-400 py-4">暂无内容</div>
                  ) : (
                    col.cards.map(card => (
                      <CardItem key={card.id} card={card}
                        canDelete={isTeacher || card.author_uuid === studentUUID}
                        onDelete={() => handleDelete(card)} />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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
