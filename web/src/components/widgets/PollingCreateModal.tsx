// =============================================================
// MindCanvas v4.3 - 创建投票弹窗
// REQ-001修复：z-index提升至2147483647，覆盖Excalidraw层
// REQ-008修复：onChange+onInput+onBlur三事件，DOM ref后备读取
// REQ-003-FIX4: onCreate 传递完整 payload 含 status:'draft' 和 is_open:false
//               确保 HandleVote 读到明确的 status 字段，不走默认 closed 分支
// =============================================================
import React, { useState, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { X, Plus, Trash2, BarChart3, PieChart } from 'lucide-react';

interface PollingCreateModalProps {
  onClose: () => void;
  onCreate: (config: PollingConfig) => void;
}

export interface PollingConfig {
  question: string;
  options: string[];
  chart_type: 'bar' | 'pie' | 'horizontal_bar';
  mode: 'single' | 'multiple';
  anonymous: boolean;
  allowChange: boolean;
  deadline: string;
  // REQ-003-FIX4: 明确初始状态字段，避免后端误判为 closed
  status: 'draft';
  is_open: false;
  votes: Record<string, number>;
  total_voters: number;
  showResult: boolean;
}

const PollingCreateModal: React.FC<PollingCreateModalProps> = ({ onClose, onCreate }) => {
  const [question, setQuestion]       = useState('');
  const [options, setOptions]         = useState(['', '']);
  const [chartType, setChartType]     = useState<'bar' | 'pie' | 'horizontal_bar'>('bar');
  const [mode, setMode]               = useState<'single' | 'multiple'>('single');
  const [anonymous, setAnonymous]     = useState(false);
  const [allowChange, setAllowChange] = useState(false);
  const [hasDeadline, setHasDeadline] = useState(false);
  const [deadlineMinutes, setDeadlineMinutes] = useState(5);

  // REQ-008：DOM ref后备，防止React受控输入状态不同步（粘贴/自动填充场景）
  const questionRef = useRef<HTMLInputElement>(null);
  const optionRefs  = useRef<(HTMLInputElement | null)[]>([]);

  const addOption    = () => { if (options.length < 8) setOptions([...options, '']); };
  const removeOption = (idx: number) => {
    if (options.length > 2) setOptions(options.filter((_, i) => i !== idx));
  };
  const updateOption = (idx: number, value: string) => {
    const u = [...options]; u[idx] = value; setOptions(u);
  };

  const handleCreate = useCallback(() => {
    // REQ-008：优先从DOM读取最新值，React state作为后备
    const q = (questionRef.current?.value?.trim()) || question.trim();
    const opts = optionRefs.current
      .map((r, i) => (r?.value?.trim()) || options[i]?.trim() || '')
      .filter(o => o !== '');
    if (!q || opts.length < 2) return;

    let deadline = '';
    if (hasDeadline && deadlineMinutes > 0) {
      const d = new Date();
      d.setMinutes(d.getMinutes() + deadlineMinutes);
      deadline = d.toISOString();
    }

    // REQ-003-FIX4: 包含完整初始状态字段
    // status:'draft' + is_open:false 确保后端正确识别投票未开放状态
    // votes:{} + total_voters:0 确保聚合字段初始化
    onCreate({
      question:     q,
      options:      opts,
      chart_type:   chartType,
      mode,
      anonymous,
      allowChange,
      deadline,
      status:       'draft',
      is_open:      false,
      votes:        {},
      total_voters: 0,
      showResult:   true,
    });
  }, [question, options, chartType, mode, anonymous, allowChange, hasDeadline, deadlineMinutes, onCreate]);

  const isValid = question.trim().length > 0 && options.filter(o => o.trim()).length >= 2;

  const Toggle = ({ value, onChange, label, desc }: {
    value: boolean; onChange: (v: boolean) => void; label: string; desc: string;
  }) => (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm font-medium text-gray-700">{label}</div>
        <div className="text-xs text-gray-400">{desc}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors ${value ? 'bg-amber-600' : 'bg-gray-300'}`}
      >
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );

  return ReactDOM.createPortal(
    // REQ-001：z-index=2147483647，覆盖Excalidraw内部canvas层(z-index:2147483646)
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center animate-fade-in"
      style={{ zIndex: 2147483647 }}
    >
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <span>📊</span> 创建投票
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          {/* 投票问题 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              投票问题 <span className="text-red-500">*</span>
            </label>
            <input
              ref={questionRef}
              type="text"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onInput={e => setQuestion((e.target as HTMLInputElement).value)}
              onBlur={e => setQuestion(e.target.value)}
              className="input w-full"
              placeholder="例如：你觉得这节课的节奏如何？"
              autoFocus
            />
            {question.trim() === '' && (
              <p className="text-xs text-red-400 mt-1">请输入投票问题</p>
            )}
          </div>

          {/* 选项列表 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              选项 <span className="text-red-500">*</span>{' '}
              <span className="text-gray-400 font-normal">(2-8个)</span>
            </label>
            <div className="space-y-2">
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-5">{idx + 1}.</span>
                  <input
                    ref={el => { optionRefs.current[idx] = el; }}
                    type="text"
                    value={opt}
                    onChange={e => updateOption(idx, e.target.value)}
                    onInput={e => updateOption(idx, (e.target as HTMLInputElement).value)}
                    onBlur={e => updateOption(idx, e.target.value)}
                    className="input flex-1"
                    placeholder={`选项 ${idx + 1}`}
                  />
                  {options.length > 2 && (
                    <button
                      onClick={() => removeOption(idx)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {options.length < 8 && (
              <button
                onClick={addOption}
                className="mt-2 flex items-center gap-1 text-xs text-amber-700 hover:text-amber-800 font-medium"
              >
                <Plus size={14} /> 添加选项
              </button>
            )}
          </div>

          {/* 投票模式 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">投票模式</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode('single')}
                className={`flex-1 px-3 py-2 rounded-xl border-2 text-sm font-medium transition-all ${
                  mode === 'single' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-500'
                }`}
              >⚪ 单选</button>
              <button
                onClick={() => setMode('multiple')}
                className={`flex-1 px-3 py-2 rounded-xl border-2 text-sm font-medium transition-all ${
                  mode === 'multiple' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-500'
                }`}
              >☑️ 多选</button>
            </div>
          </div>

          {/* 图表类型 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">图表展示</label>
            <div className="flex gap-2">
              <button
                onClick={() => setChartType('bar')}
                className={`flex-1 flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border-2 ${
                  chartType === 'bar' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-500'
                }`}
              >
                <BarChart3 size={18} /><span className="text-xs">柱状图</span>
              </button>
              <button
                onClick={() => setChartType('pie')}
                className={`flex-1 flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border-2 ${
                  chartType === 'pie' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-500'
                }`}
              >
                <PieChart size={18} /><span className="text-xs">饼图</span>
              </button>
              <button
                onClick={() => setChartType('horizontal_bar')}
                className={`flex-1 flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border-2 ${
                  chartType === 'horizontal_bar' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-500'
                }`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="12" height="4" rx="1"/>
                  <rect x="3" y="10" width="18" height="4" rx="1"/>
                  <rect x="3" y="16" width="8" height="4" rx="1"/>
                </svg>
                <span className="text-xs">条形图</span>
              </button>
            </div>
          </div>

          {/* 开关选项组 */}
          <div className="space-y-3">
            <Toggle
              value={anonymous}
              onChange={setAnonymous}
              label="匿名投票"
              desc="开启后不显示谁投了什么"
            />
            <Toggle
              value={allowChange}
              onChange={setAllowChange}
              label="允许改票"
              desc="开启后学生可以修改已提交的选择"
            />
          </div>

          {/* 截止时间 */}
          <div>
            <Toggle
              value={hasDeadline}
              onChange={setHasDeadline}
              label="设置截止时间"
              desc="不设置则需手动关闭"
            />
            {hasDeadline && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  value={deadlineMinutes}
                  onChange={e => setDeadlineMinutes(Math.max(1, Math.min(120, Number(e.target.value))))}
                  className="input w-20 text-center"
                  min={1} max={120}
                />
                <span className="text-sm text-gray-500">分钟后截止</span>
              </div>
            )}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary">取消</button>
          <button
            onClick={handleCreate}
            disabled={!isValid}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            创建投票
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default PollingCreateModal;
