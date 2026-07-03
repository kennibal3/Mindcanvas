// =============================================================
// MindCanvas - 词云创建弹窗
// REQ-001修复：z-index提升至2147483647
// REQ-016修复：词数选项补充4，改为1/2/3/4/5
// REQ-008修复：onInput+onBlur兼容粘贴场景，DOM ref后备
// =============================================================
import React, { useState, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { X, Cloud } from 'lucide-react';

export interface WordCloudConfig {
  prompt: string;
  max_words_per_student: number;
  is_anonymous: boolean;
}

interface Props {
  onClose: () => void;
  onCreate: (config: WordCloudConfig) => void;
}

const WordCloudCreateModal: React.FC<Props> = ({ onClose, onCreate }) => {
  const [prompt, setPrompt]           = useState('用一个词描述你的感受');
  const [maxWords, setMaxWords]       = useState(3);
  const [isAnonymous, setIsAnonymous] = useState(false);

  // REQ-008：DOM ref后备
  const promptRef = useRef<HTMLInputElement>(null);

  const isValid = prompt.trim().length > 0;

  const handleCreate = useCallback(() => {
    // REQ-008：优先DOM读取，React state作为后备
    const finalPrompt = (promptRef.current?.value?.trim()) || prompt.trim();
    if (!finalPrompt) return;
    onCreate({ prompt: finalPrompt, max_words_per_student: maxWords, is_anonymous: isAnonymous });
  }, [prompt, maxWords, isAnonymous, onCreate]);

  return ReactDOM.createPortal(
    // REQ-001：z-index=2147483647
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50"
      style={{ zIndex: 2147483647 }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-amber-700" />
            <h2 className="text-lg font-semibold text-gray-800">创建词云</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* 引导语 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              引导语 <span className="text-red-500">*</span>
            </label>
            <input
              ref={promptRef}
              type="text"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onInput={e => setPrompt((e.target as HTMLInputElement).value)}
              onBlur={e => setPrompt(e.target.value)}
              placeholder="例如：用一个词描述今天的学习"
              maxLength={100}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">{prompt.length}/100</p>
          </div>

          {/* REQ-016：每人最多提交词数，1/2/3/4/5 补全4 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              每人最多提交词数
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setMaxWords(n)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    maxWords === n
                      ? 'bg-amber-700 border-amber-700 text-white'
                      : 'border-gray-200 text-gray-600 hover:border-amber-300'
                  }`}
                >
                  {n}个
                </button>
              ))}
            </div>
          </div>

          {/* 匿名开关 */}
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-gray-700">匿名展示</p>
              <p className="text-xs text-gray-400">开启后词云不显示提交者姓名</p>
            </div>
            <button
              onClick={() => setIsAnonymous(!isAnonymous)}
              className={`relative w-11 h-6 rounded-full transition-colors ${isAnonymous ? 'bg-amber-600' : 'bg-gray-200'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isAnonymous ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={!isValid}
            className="flex-1 py-2.5 rounded-lg bg-amber-700 text-white text-sm font-medium hover:bg-amber-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            创建词云
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default WordCloudCreateModal;
