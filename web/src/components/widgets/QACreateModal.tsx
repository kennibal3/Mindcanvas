// =============================================================
// MindCanvas - 问答题创建弹窗
// REQ-001修复：z-index提升至2147483647
// REQ-015修复：改为浅色主题，与其他弹窗风格统一（白色背景/浅灰边框）
// REQ-008修复：onInput+onBlur兼容粘贴，DOM ref后备读取
// =============================================================
import React, { useState, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Plus, Trash2, CheckCircle, X } from 'lucide-react';

export interface QAInitPayload {
  question: string;
  options: string[];
  correctIdx: number;
  explanation: string;
  status: 'draft';
  showResult: boolean;
  showExplanation: boolean;
  stats: Record<string, number>;
  width: number;
  height: number;
}

interface QACreateModalProps {
  onConfirm: (payload: QAInitPayload) => void;
  onClose: () => void;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

const QACreateModal: React.FC<QACreateModalProps> = ({ onConfirm, onClose }) => {
  const [question, setQuestion]     = useState('');
  const [options, setOptions]       = useState(['', '', '', '']);
  const [correctIdx, setCorrectIdx] = useState<number | null>(null);
  const [explanation, setExplanation] = useState('');

  // REQ-008：DOM ref后备
  const questionRef    = useRef<HTMLTextAreaElement>(null);
  const optionRefs     = useRef<(HTMLInputElement | null)[]>([]);
  const explanationRef = useRef<HTMLTextAreaElement>(null);

  const addOption = () => {
    if (options.length >= 6) return;
    setOptions([...options, '']);
  };

  const removeOption = (idx: number) => {
    if (options.length <= 2) return;
    const next = options.filter((_, i) => i !== idx);
    setOptions(next);
    if (correctIdx === idx) setCorrectIdx(null);
    else if (correctIdx !== null && correctIdx > idx) setCorrectIdx(correctIdx - 1);
  };

  const updateOption = (idx: number, value: string) => {
    const next = [...options]; next[idx] = value; setOptions(next);
  };

  const isValid =
    question.trim().length > 0 &&
    options.every(o => o.trim().length > 0) &&
    correctIdx !== null;

  const handleConfirm = useCallback(() => {
    if (correctIdx === null) return;
    // REQ-008：优先DOM读取
    const q = (questionRef.current?.value?.trim()) || question.trim();
    const opts = optionRefs.current.map((r, i) =>
      (r?.value?.trim()) || options[i]?.trim() || ''
    );
    const exp = (explanationRef.current?.value?.trim()) || explanation.trim();
    if (!q || opts.some(o => !o) || correctIdx === null) return;
    onConfirm({
      question: q,
      options: opts,
      correctIdx,
      explanation: exp,
      status: 'draft',
      showResult: false,
      showExplanation: false,
      stats: {},
      width: 300,
      height: 400,
    });
    onClose();
  }, [question, options, correctIdx, explanation, onConfirm, onClose]);

  return ReactDOM.createPortal(
    // REQ-001：z-index=2147483647
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50"
      style={{ zIndex: 2147483647 }}
    >
      {/* REQ-015：浅色主题 - 白色背景，与投票/词云弹窗一致 */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">

        {/* 标题栏 - 浅色风格 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <span>❓</span> 创建问答题
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* 题干 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              题干 <span className="text-red-500">*</span>
            </label>
            <textarea
              ref={questionRef}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
              rows={3}
              maxLength={500}
              placeholder="请输入题目内容..."
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onInput={e => setQuestion((e.target as HTMLTextAreaElement).value)}
              onBlur={e => setQuestion(e.target.value)}
            />
            <div className="text-right text-xs text-gray-400 mt-0.5">{question.length}/500</div>
          </div>

          {/* 选项 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">
                选项 <span className="text-red-500">*</span>
                <span className="text-xs text-gray-400 ml-1">（点击左侧字母设为正确答案）</span>
              </label>
              <span className="text-xs text-gray-400">{options.length}/6</span>
            </div>

            <div className="space-y-2">
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCorrectIdx(idx)}
                    className={[
                      'flex-shrink-0 w-8 h-8 rounded-full text-sm font-bold flex items-center justify-center transition-all',
                      correctIdx === idx
                        ? 'bg-green-500 text-white shadow-md'
                        : 'bg-gray-100 text-gray-600 hover:bg-green-100',
                    ].join(' ')}
                    title={correctIdx === idx ? '正确答案' : '设为正确答案'}
                  >
                    {correctIdx === idx ? <CheckCircle size={16} /> : OPTION_LABELS[idx]}
                  </button>
                  <input
                    ref={el => { optionRefs.current[idx] = el; }}
                    type="text"
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder={`选项 ${OPTION_LABELS[idx]}`}
                    maxLength={100}
                    value={opt}
                    onChange={e => updateOption(idx, e.target.value)}
                    onInput={e => updateOption(idx, (e.target as HTMLInputElement).value)}
                    onBlur={e => updateOption(idx, e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => removeOption(idx)}
                    disabled={options.length <= 2}
                    className="flex-shrink-0 text-gray-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            {options.length < 6 && (
              <button
                type="button"
                onClick={addOption}
                className="mt-2 flex items-center gap-1 text-sm text-amber-700 hover:text-amber-800 transition-colors"
              >
                <Plus size={14} /> 添加选项
              </button>
            )}

            {correctIdx === null && (
              <p className="mt-1.5 text-xs text-amber-500">请点击选项左侧字母设置正确答案</p>
            )}
            {correctIdx !== null && (
              <p className="mt-1.5 text-xs text-green-600">
                正确答案：选项 {OPTION_LABELS[correctIdx]}
              </p>
            )}
          </div>

          {/* 解析说明 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              解析说明
              <span className="text-xs text-gray-400 ml-1">（可选，结束后公布给学生）</span>
            </label>
            <textarea
              ref={explanationRef}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
              rows={2}
              maxLength={200}
              placeholder="请输入解析说明..."
              value={explanation}
              onChange={e => setExplanation(e.target.value)}
              onInput={e => setExplanation((e.target as HTMLTextAreaElement).value)}
              onBlur={e => setExplanation(e.target.value)}
            />
            <div className="text-right text-xs text-gray-400 mt-0.5">{explanation.length}/200</div>
          </div>
        </div>

        {/* 底部按钮 - 浅色风格 */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="px-5 py-2 text-sm font-medium text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            创建问答题
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default QACreateModal;
