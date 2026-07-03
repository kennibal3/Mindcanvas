import { useState } from 'react';
import { X } from 'lucide-react';

interface ShelfCreateModalProps {
  onClose: () => void;
  onCreate: (payload: {
    title: string;
    status: 'open';
    visibility: 'isolated' | 'open';
    allow_types: ('text' | 'image' | 'link')[];
  }) => void;
}

export function ShelfCreateModal({ onClose, onCreate }: ShelfCreateModalProps) {
  const [title, setTitle] = useState('协作墙');
  const [visibility, setVisibility] = useState<'isolated' | 'open'>('open');
  const [allowText, setAllowText] = useState(true);
  const [allowImage, setAllowImage] = useState(true);
  const [allowLink, setAllowLink] = useState(true);

  function handleCreate() {
    const allow_types: ('text' | 'image' | 'link')[] = [];
    if (allowText) allow_types.push('text');
    if (allowImage) allow_types.push('image');
    if (allowLink) allow_types.push('link');
    if (allow_types.length === 0) { alert('至少选一种卡片类型'); return; }
    onCreate({ title: title.trim() || '协作墙', status: 'open', visibility, allow_types });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-80 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">创建协作墙</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">标题</label>
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
          <label className="text-xs text-gray-500 mb-2 block">初始可见性</label>
          <div className="flex gap-2">
            {([
              { value: 'open' as const, label: '全组互看', desc: '所有组可以看到彼此的卡片' },
              { value: 'isolated' as const, label: '各组隔离', desc: '每组只看到自己的卡片' },
            ]).map(opt => (
              <button key={opt.value} onClick={() => setVisibility(opt.value)} title={opt.desc}
                className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors border ${
                  visibility === opt.value
                    ? 'border-amber-400 bg-amber-50 text-amber-800'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-2 block">允许类型</label>
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
          <button onClick={handleCreate}
            className="flex-1 py-2 rounded-xl text-sm text-white font-medium transition-colors"
            style={{ background: '#BA7517' }}>
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

export default ShelfCreateModal;
