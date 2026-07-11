import { useRef, useState } from 'react';
import { X, Image as ImageIcon, Link as LinkIcon, Loader2 } from 'lucide-react';
import { useImageUpload } from '@/hooks/useImageUpload';

// REQ-036：协作墙改为"主题 + 回复"模式——创建时老师必须先写好主题（多模态：
// 文字必填，图片/链接都可选加），学生只能围绕这一个主题回复，不再支持"各组隔离"
// 的分栏可见性（回复统一互相可见）。
interface ShelfCreateModalProps {
  onClose: () => void;
  onCreate: (payload: {
    title: string;
    status: 'open';
    topic_text: string;
    topic_image_url?: string;
    topic_link_url?: string;
    topic_link_title?: string;
    allow_types: ('text' | 'image' | 'link')[];
  }) => void;
}

export function ShelfCreateModal({ onClose, onCreate }: ShelfCreateModalProps) {
  const [title, setTitle] = useState('协作墙');
  const [topicText, setTopicText] = useState('');
  const [topicImageUrl, setTopicImageUrl] = useState('');
  const [topicLinkUrl, setTopicLinkUrl] = useState('');
  const [topicLinkTitle, setTopicLinkTitle] = useState('');
  const [allowText, setAllowText] = useState(true);
  const [allowImage, setAllowImage] = useState(true);
  const [allowLink, setAllowLink] = useState(true);

  const { uploading, error: uploadError, uploadImage } = useImageUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handlePickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await uploadImage(file);
    if (result) setTopicImageUrl(result.url);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleCreate() {
    if (!topicText.trim()) { alert('请先写一段主题内容，学生才知道要回复什么'); return; }
    if (uploading) { alert('图片还在上传，请稍等'); return; }
    const allow_types: ('text' | 'image' | 'link')[] = [];
    if (allowText) allow_types.push('text');
    if (allowImage) allow_types.push('image');
    if (allowLink) allow_types.push('link');
    if (allow_types.length === 0) { alert('至少选一种回复类型'); return; }
    onCreate({
      title: title.trim() || '协作墙',
      status: 'open',
      topic_text: topicText.trim(),
      topic_image_url: topicImageUrl.trim() || undefined,
      topic_link_url: topicLinkUrl.trim() || undefined,
      topic_link_title: topicLinkTitle.trim() || undefined,
      allow_types,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-96 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">创建协作墙</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">标题（显示在墙的顶部）</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onInput={e => setTitle((e.target as HTMLInputElement).value)}
            onBlur={e => setTitle(e.target.value)}
            placeholder="协作墙"
            className="input w-full"
          />
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">主题内容（必填，学生会围绕这个回复）</label>
          <textarea
            value={topicText}
            onChange={e => setTopicText(e.target.value)}
            onInput={e => setTopicText((e.target as HTMLTextAreaElement).value)}
            onBlur={e => setTopicText(e.target.value)}
            placeholder="写下这次讨论的主题或问题…"
            rows={4}
            className="w-full text-sm border rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
            style={{ borderColor: '#E5E2D9' }}
          />
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">配图（可选）</label>
          {topicImageUrl ? (
            <div className="relative">
              <img src={topicImageUrl} alt="主题配图" className="w-full rounded-lg max-h-32 object-cover" />
              <button onClick={() => setTopicImageUrl('')}
                className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5">
                <X size={12} />
              </button>
            </div>
          ) : (
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg border border-dashed text-gray-500 hover:bg-gray-50 transition-colors"
              style={{ borderColor: '#E5E2D9' }}>
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
              {uploading ? '上传中...' : '上传一张图片'}
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden" onChange={handlePickImage} />
          {uploadError && <p className="text-xs text-red-500 mt-1">{uploadError}</p>}
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block flex items-center gap-1">
            <LinkIcon size={11} />参考链接（可选）
          </label>
          <div className="space-y-1.5">
            <input value={topicLinkUrl}
              onChange={e => setTopicLinkUrl(e.target.value)}
              onInput={e => setTopicLinkUrl((e.target as HTMLInputElement).value)}
              onBlur={e => setTopicLinkUrl(e.target.value)}
              placeholder="https://..."
              className="w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
              style={{ borderColor: '#E5E2D9' }} />
            {topicLinkUrl.trim() && (
              <input value={topicLinkTitle}
                onChange={e => setTopicLinkTitle(e.target.value)}
                onInput={e => setTopicLinkTitle((e.target as HTMLInputElement).value)}
                onBlur={e => setTopicLinkTitle(e.target.value)}
                placeholder="链接标题（可选）"
                className="w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                style={{ borderColor: '#E5E2D9' }} />
            )}
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-2 block">学生可用的回复类型</label>
          <div className="flex gap-2">
            {[
              { key: 'text' as const, label: '文字', checked: allowText, set: setAllowText },
              { key: 'image' as const, label: '图片', checked: allowImage, set: setAllowImage },
              { key: 'link' as const, label: '链接', checked: allowLink, set: setAllowLink },
            ].map(({ key, label, checked, set }) => (
              <button key={key} onClick={() => set(v => !v)}
                className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors border ${
                  checked
                    ? 'border-amber-400 bg-amber-50 text-amber-800'
                    : 'border-gray-200 text-gray-400 hover:bg-gray-50'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-xl text-sm border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
            取消
          </button>
          <button onClick={handleCreate} disabled={uploading}
            className="flex-1 py-2 rounded-xl text-sm text-white font-medium transition-colors disabled:opacity-50"
            style={{ background: '#BA7517' }}>
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

export default ShelfCreateModal;
