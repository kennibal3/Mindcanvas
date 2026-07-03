// =============================================================
// MindCanvas v4.3 - 投票 Widget（教师+学生视图）
// REQ-014修复：draft 状态显示「未开始」而非「草稿」
// REQ-020修复：固定白色背景，移除所有 dark: 前缀 class
// REQ-017已实现：主操作按钮直接显示在卡片底部
// REQ-003-FIX6：监听服务端 widget_update 确认后才 markSubmitted
// =============================================================
import React, { useState, useMemo, useEffect } from 'react';
import {
  Play, Pause, StopCircle, Eye, EyeOff,
  BarChart3, PieChart, Settings, Download, Trash2, Clock,
} from 'lucide-react';
import { useWidgetStore } from '@/store/widgetStore';
import { useRoomStore } from '@/store/roomStore';

type PollStatus = 'draft' | 'open' | 'paused' | 'closed';
type ChartType  = 'bar' | 'pie' | 'horizontal_bar';

interface PollingWidgetProps {
  id: string;
  payload: Record<string, any>;
  isTeacher: boolean;
  isLocked?: boolean;
  onUpdate: (payload: Record<string, any>) => void;
  onSubmit?: (action: string, data: Record<string, any>) => void;
}

// REQ-014修复：draft 显示「未开始」
const STATUS_LABELS: Record<PollStatus, { text: string; color: string }> = {
  draft:  { text: '未开始', color: 'bg-gray-100 text-gray-500' },
  open:   { text: '进行中', color: 'bg-green-100 text-green-700' },
  paused: { text: '已暂停', color: 'bg-yellow-100 text-yellow-700' },
  closed: { text: '已结束', color: 'bg-red-100 text-red-600' },
};

const CHART_COLORS = [
  '#6366F1', '#22C55E', '#F59E0B', '#EF4444',
  '#8B5CF6', '#06B6D4', '#F97316', '#EC4899',
];

// 从 payload 提取内层业务字段，兼容嵌套/平铺两种格式
function extractInner(payload: Record<string, any>): Record<string, any> {
  const inner = payload?.payload;
  if (
    inner !== null &&
    inner !== undefined &&
    typeof inner === 'object' &&
    !Array.isArray(inner)
  ) {
    return inner as Record<string, any>;
  }
  return payload;
}

const PollingWidget: React.FC<PollingWidgetProps> = ({
  id, payload, isTeacher, isLocked, onUpdate, onSubmit,
}) => {
  const { isSubmitted, markSubmitted } = useWidgetStore();
  const currentRoom = useRoomStore(s => s.currentRoom);
  const roomId = currentRoom?.id ?? '';

  const innerPayload = extractInner(payload);

  const question:    string                 = (innerPayload?.question    as string)                 ?? '投票题目';
  const options:     string[]               = Array.isArray(innerPayload?.options) ? (innerPayload.options as string[]) : [];
  const mode:        string                 = (innerPayload?.mode        as string)                 ?? 'single';
  const anonymous:   boolean                = !!(innerPayload?.anonymous);
  const allowChange: boolean                = !!(innerPayload?.allowChange);
  const showResult:  boolean                = !!(innerPayload?.showResult ?? innerPayload?.show_result ?? true);
  const chartType:   ChartType              = (innerPayload?.chart_type  as ChartType)              ?? 'bar';
  const votes:       Record<string, number> = (innerPayload?.votes       as Record<string, number>) ?? {};
  const totalVoters: number                 = (innerPayload?.total_voters as number)                ?? 0;
  const deadline:    string | undefined     = innerPayload?.deadline     as string | undefined;

  // 状态：优先 status 字段，兼容旧 is_open
  const rawStatus = (innerPayload?.status as string) || '';
  const isOpen    = !!(innerPayload?.is_open as boolean);
  const status: PollStatus = (
    rawStatus === 'draft' || rawStatus === 'open' ||
    rawStatus === 'paused' || rawStatus === 'closed'
      ? rawStatus
      : (isOpen ? 'open' : 'draft')
  ) as PollStatus;

  const hasVoted = isSubmitted(id);

  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [submitting, setSubmitting]           = useState(false);
  const [submitError, setSubmitError]         = useState('');
  const [showSettings, setShowSettings]       = useState(false);
  const [timeLeft, setTimeLeft]               = useState('');
  const [isExpired, setIsExpired]             = useState(false);

  // 截止时间倒计时
  useEffect(() => {
    if (!deadline || status !== 'open') return;
    const timer = setInterval(() => {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) {
        setIsExpired(true);
        setTimeLeft('已截止');
        clearInterval(timer);
      } else {
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setTimeLeft(`${m}:${s.toString().padStart(2, '0')}`);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline, status]);

  // REQ-003-FIX6：监听服务端 widget_update 确认事件，确认后才 markSubmitted
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.element_id === id && detail?.confirmed) {
        markSubmitted(id);
        setSubmitting(false);
        setSubmitError('');
      } else if (detail?.element_id === id && detail?.error) {
        setSubmitting(false);
        setSubmitError(detail.error);
        setSelectedOptions([]);
      }
    };
    window.addEventListener('ws_widget_vote_result', handler);
    return () => window.removeEventListener('ws_widget_vote_result', handler);
  }, [id, markSubmitted]);

  const canVote   = status === 'open' && !hasVoted && !isLocked && !isExpired;
  const canChange = status === 'open' && hasVoted && allowChange && !isLocked && !isExpired;
  const maxVotes  = useMemo(() => Math.max(1, ...Object.values(votes)), [votes]);

  const toggleOption = (opt: string) => {
    if (mode === 'single') {
      setSelectedOptions([opt]);
    } else {
      setSelectedOptions(prev =>
        prev.includes(opt) ? prev.filter(o => o !== opt) : [...prev, opt]
      );
    }
    setSubmitError('');
  };

  const handleVote = () => {
    if (!onSubmit || selectedOptions.length === 0 || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    if (mode === 'single') {
      onSubmit('vote', { option: selectedOptions[0] });
    } else {
      onSubmit('vote', { options: selectedOptions });
    }
    setTimeout(() => { setSubmitting(false); }, 3000);
  };

  // 更新内层 payload，FloatingWidgets.handleElementUpdate 会 merge 到外层
  const updateInnerPayload = (changes: Record<string, any>) => {
    onUpdate({ ...innerPayload, ...changes });
  };

  const handleStatusChange    = (s: PollStatus) => updateInnerPayload({ status: s, is_open: s === 'open' });
  const handleChartTypeChange = (t: ChartType)  => updateInnerPayload({ chart_type: t });
  const handleToggleResult    = ()               => updateInnerPayload({ showResult: !showResult, show_result: !showResult });

  // ===== 图表渲染 =====
  const renderBarChart = () => (
    <div className="space-y-2">
      {options.map((opt, idx) => {
        const count   = votes[opt] || 0;
        const percent = totalVoters > 0 ? Math.round((count / totalVoters) * 100) : 0;
        const w       = maxVotes > 0 ? (count / maxVotes) * 100 : 0;
        return (
          <div key={opt} className="space-y-0.5">
            <div className="flex justify-between text-xs">
              <span className="text-gray-700 font-medium truncate max-w-[60%]">{opt}</span>
              <span className="text-gray-500">{count}票 ({percent}%)</span>
            </div>
            <div className="h-5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${w}%`, backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderPieChart = () => {
    const total = totalVoters || 1;
    let cum = 0;
    const slices = options.map((opt, idx) => {
      const p = ((votes[opt] || 0) / total) * 100;
      const s = cum; cum += p;
      return {
        opt, count: votes[opt] || 0, percent: p, start: s,
        color: CHART_COLORS[idx % CHART_COLORS.length],
      };
    });
    const gradient = slices.length > 0
      ? slices.map(s => `${s.color} ${s.start}% ${s.start + s.percent}%`).join(', ')
      : '#E5E7EB 0% 100%';
    return (
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-full flex-shrink-0"
          style={{ background: `conic-gradient(${gradient})` }} />
        <div className="space-y-1 flex-1 min-w-0">
          {slices.map(s => (
            <div key={s.opt} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-xs text-gray-600 truncate">{s.opt}</span>
              <span className="text-xs text-gray-400 ml-auto">{s.count}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderHBar = () => (
    <div className="space-y-1.5">
      {options.map((opt, idx) => {
        const count = votes[opt] || 0;
        const w = maxVotes > 0 ? (count / maxVotes) * 100 : 0;
        return (
          <div key={opt} className="flex items-center gap-2">
            <span className="text-xs text-gray-600 w-14 truncate text-right">{opt}</span>
            <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
              <div
                className="h-full rounded transition-all duration-500"
                style={{
                  width: `${Math.max(w, 5)}%`,
                  backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
                }}
              />
            </div>
            <span className="text-xs text-gray-400 w-8">{count}</span>
          </div>
        );
      })}
    </div>
  );

  const renderChart = () => {
    switch (chartType) {
      case 'pie':            return renderPieChart();
      case 'horizontal_bar': return renderHBar();
      default:               return renderBarChart();
    }
  };

  const shouldShowChart = isTeacher
    || (hasVoted && showResult)
    || ((!canVote && !hasVoted) && showResult && (status === 'closed' || status === 'paused'));

  const statusInfo = STATUS_LABELS[status] || STATUS_LABELS.draft;

  return (
    // REQ-020修复：固定白色背景+固定文字颜色，不随暗色主题变化
    <div
      className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden w-full"
      style={{ minHeight: '180px', color: '#1f2937' }}
    >
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base">📊</span>
            <h4 className="text-sm font-semibold text-gray-800 truncate">{question}</h4>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${statusInfo.color}`}>
              {statusInfo.text}
            </span>
            {mode === 'multiple' && (
              <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">多选</span>
            )}
            {anonymous && (
              <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">匿名</span>
            )}
            {isTeacher && (
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-1 rounded hover:bg-gray-200 text-gray-400"
              >
                <Settings size={14} />
              </button>
            )}
          </div>
        </div>
        {deadline && !isExpired && status === 'open' && (
          <div className="flex items-center gap-1 mt-1 text-xs text-orange-600">
            <Clock size={10} /><span>剩余 {timeLeft}</span>
          </div>
        )}
      </div>

      {/* 内容区 */}
      <div className="px-4 py-3">

        {/* 图表 */}
        {shouldShowChart && (
          <div>
            {renderChart()}
            <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
              <span>共 {totalVoters} 人投票</span>
              {isTeacher && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleChartTypeChange('bar')}
                    className={`p-1 rounded ${chartType === 'bar' ? 'bg-amber-100 text-amber-700' : 'text-gray-400'}`}
                  >
                    <BarChart3 size={12} />
                  </button>
                  <button
                    onClick={() => handleChartTypeChange('pie')}
                    className={`p-1 rounded ${chartType === 'pie' ? 'bg-amber-100 text-amber-700' : 'text-gray-400'}`}
                  >
                    <PieChart size={12} />
                  </button>
                  <button
                    onClick={() => handleChartTypeChange('horizontal_bar')}
                    className={`p-1 rounded ${chartType === 'horizontal_bar' ? 'bg-amber-100 text-amber-700' : 'text-gray-400'}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="12" height="4" rx="1"/>
                      <rect x="3" y="10" width="18" height="4" rx="1"/>
                      <rect x="3" y="16" width="8" height="4" rx="1"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 已投票状态 */}
        {!isTeacher && hasVoted && !canChange && (
          <div className={`${shouldShowChart ? 'mt-2' : ''} text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2 text-center`}>
            ✅ 你已完成投票
            {!showResult && <div className="text-gray-400 mt-0.5">结果暂未公布</div>}
          </div>
        )}

        {/* 错误提示 */}
        {!isTeacher && submitError && (
          <div className="mt-2 text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 text-center">
            ⚠️ {submitError}
          </div>
        )}

        {/* 投票界面 */}
        {!isTeacher && (canVote || canChange) && (
          <div className={`space-y-2 ${shouldShowChart ? 'mt-3' : ''}`}>
            {canChange && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5 mb-1">
                🔄 允许改票，重新选择后提交
              </div>
            )}
            {mode === 'multiple' && (
              <div className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5 mb-1">
                ☑️ 多选模式：可选择多个选项
              </div>
            )}
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => toggleOption(opt)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border-2 text-sm transition-all ${
                  selectedOptions.includes(opt)
                    ? 'border-amber-500 bg-amber-50 text-amber-800 font-medium'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  {mode === 'single' ? (
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      selectedOptions.includes(opt) ? 'border-amber-500' : 'border-gray-300'
                    }`}>
                      {selectedOptions.includes(opt) && (
                        <div className="w-2 h-2 rounded-full bg-amber-600" />
                      )}
                    </div>
                  ) : (
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                      selectedOptions.includes(opt) ? 'border-amber-600 bg-amber-600' : 'border-gray-300'
                    }`}>
                      {selectedOptions.includes(opt) && (
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                          <path
                            d="M2.5 6L5 8.5L9.5 3.5"
                            stroke="white" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>
                  )}
                  <span>{opt}</span>
                </div>
              </button>
            ))}
            <button
              onClick={handleVote}
              disabled={selectedOptions.length === 0 || submitting}
              className="w-full mt-3 px-4 py-2.5 bg-amber-700 text-white rounded-lg font-medium text-sm hover:bg-amber-800 transition-colors disabled:opacity-50"
            >
              {submitting ? '提交中...' : canChange ? '修改投票' : '提交投票'}
            </button>
          </div>
        )}

        {/* 不可投票提示 */}
        {!isTeacher && !canVote && !canChange && !hasVoted && (
          <div className="text-center py-6 text-gray-400 text-sm">
            {status === 'draft'  ? '⏳ 投票尚未开始' :
             status === 'paused' ? '⏸ 投票已暂停' :
             status === 'closed' ? (showResult ? '' : '🔒 投票已结束，结果未公布') :
             isExpired           ? '⌛ 投票已截止' : ''}
          </div>
        )}
      </div>

      {/* REQ-017：教师主操作按钮直接显示在底部 */}
      {isTeacher && (
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
          <div className="flex gap-1.5">
            {(status === 'draft' || status === 'closed') && (
              <button
                onClick={() => handleStatusChange('open')}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
              >
                <Play size={12} /> 开启
              </button>
            )}
            {status === 'open' && (
              <button
                onClick={() => handleStatusChange('paused')}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium bg-yellow-50 text-yellow-600 hover:bg-yellow-100 transition-colors"
              >
                <Pause size={12} /> 暂停
              </button>
            )}
            {status === 'paused' && (
              <button
                onClick={() => handleStatusChange('open')}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
              >
                <Play size={12} /> 继续
              </button>
            )}
            {(status === 'open' || status === 'paused') && (
              <button
                onClick={() => handleStatusChange('closed')}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
              >
                <StopCircle size={12} /> 结束
              </button>
            )}
            <button
              onClick={handleToggleResult}
              className={`flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
                showResult
                  ? 'bg-orange-50 text-orange-600 hover:bg-orange-100'
                  : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
              }`}
            >
              {showResult ? <><EyeOff size={12} /> 隐藏</> : <><Eye size={12} /> 显示</>}
            </button>
          </div>
        </div>
      )}

      {/* 教师次要操作（导出/删除，藏在齿轮里）*/}
      {isTeacher && showSettings && (
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 space-y-2">
          <button
            onClick={() => {
              const url = `/api/rooms/${roomId}/export?type=vote&element_id=${id}`;
              fetch(url, { credentials: 'include' })
                .then(r => r.blob())
                .then(blob => {
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = `投票_${(question || id).slice(0, 20)}_${new Date().toISOString().split('T')[0]}.csv`;
                  a.click();
                });
            }}
            className="w-full flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-amber-50 hover:text-amber-700 transition-colors"
          >
            <Download size={12} /> 导出投票数据 CSV
          </button>
          <button
            onClick={() => { if (confirm('确定删除此投票？')) onUpdate({ __delete: true }); }}
            className="w-full flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors"
          >
            <Trash2 size={12} /> 删除投票
          </button>
        </div>
      )}
    </div>
  );
};

export default PollingWidget;
