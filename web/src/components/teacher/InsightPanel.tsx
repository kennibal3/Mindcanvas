// =============================================================
// MindCanvas v4.3 - 学情雷达面板
// REQ-002修复：组件自包含ErrorBoundary，崩溃时显示友好提示
//   不影响外层ControlPanel，不会导致整个应用白屏
// =============================================================
import React, { useState, useEffect, useCallback, useRef, Component } from 'react';
import {
  Activity, RefreshCw, ChevronDown, ChevronUp,
  Users, TrendingUp, XCircle, CheckCircle, Star, AlertTriangle,
} from 'lucide-react';

// ===== ErrorBoundary：隔离学情雷达崩溃，不影响外层 =====
interface EBState { hasError: boolean; errorMsg: string; }
class InsightErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error?.message || '未知错误' };
  }
  componentDidCatch(error: Error, info: any) {
    console.error('[InsightPanel] 渲染崩溃:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="border border-red-200 rounded-xl p-4 bg-red-50">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
            <span className="text-sm font-medium text-red-700">学情雷达暂时不可用</span>
          </div>
          <p className="text-xs text-red-500 mb-3">{this.state.errorMsg}</p>
          <button
            onClick={() => this.setState({ hasError: false, errorMsg: '' })}
            className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
          >
            <RefreshCw size={11} /> 点击重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ===== 类型定义（与 insight_service.go 对齐）=====
interface ComponentStat {
  element_id: string;
  type: string;
  title: string;
  submitted: number;
  total: number;
  rate: number;
}
interface UnsubmittedStudent { uuid: string; nickname: string; }
interface QAStat {
  element_id: string; title: string;
  total_answers: number; correct_count: number; correct_rate: number;
}
interface WordStat { word: string; count: number; }
interface GroupActivity { group_id: string; group_name: string; action_count: number; }
interface TopStudent { uuid: string; nickname: string; action_count: number; }
interface InsightData {
  online_count: number;
  total_joined: number;
  components: ComponentStat[];
  unsubmitted: UnsubmittedStudent[];
  qa_stats: QAStat[];
  top_words: WordStat[];
  group_activity: GroupActivity[];
  top_students: TopStudent[];
}

interface Props { roomId: string; }

const TYPE_LABELS: Record<string, string> = {
  polling_widget:   '投票',
  wordcloud_widget: '词云',
  qa_widget:        '问答',
  dropzone_widget:  '作品墙',
};

const rateColor = (rate: number) => {
  if (rate >= 0.8) return 'bg-green-400';
  if (rate >= 0.5) return 'bg-yellow-400';
  return 'bg-red-400';
};

// ===== 防御性数据解析：确保所有数组字段不为undefined =====
function safeInsightData(raw: any): InsightData {
  return {
    online_count:    typeof raw?.online_count === 'number'  ? raw.online_count    : 0,
    total_joined:    typeof raw?.total_joined === 'number'  ? raw.total_joined    : 0,
    components:      Array.isArray(raw?.components)         ? raw.components      : [],
    unsubmitted:     Array.isArray(raw?.unsubmitted)        ? raw.unsubmitted     : [],
    qa_stats:        Array.isArray(raw?.qa_stats)           ? raw.qa_stats        : [],
    top_words:       Array.isArray(raw?.top_words)          ? raw.top_words       : [],
    group_activity:  Array.isArray(raw?.group_activity)     ? raw.group_activity  : [],
    top_students:    Array.isArray(raw?.top_students)       ? raw.top_students    : [],
  };
}

// ===== 内层组件（不含ErrorBoundary）=====
const InsightPanelInner: React.FC<Props> = ({ roomId }) => {
  const [expanded, setExpanded]               = useState(false);
  const [data, setData]                       = useState<InsightData | null>(null);
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState('');
  const [lastUpdated, setLastUpdated]         = useState('');
  const [showUnsubmitted, setShowUnsubmitted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchInsight = useCallback(async (force = false) => {
    if (!expanded && !force) return;
    try {
      const res = await fetch(`/api/rooms/${roomId}/insight`, { credentials: 'include' });
      if (!res.ok) throw new Error('获取失败');
      const json = await res.json();
      // REQ-002：防御性解析，确保数组字段不为undefined
      setData(safeInsightData(json));
      setError('');
      setLastUpdated(new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }));
    } catch {
      setError('数据获取失败');
    }
  }, [roomId, expanded]);

  useEffect(() => {
    if (expanded) {
      setLoading(true);
      fetchInsight(true).finally(() => setLoading(false));
      timerRef.current = setInterval(() => fetchInsight(true), 10000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [expanded, fetchInsight]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    await fetchInsight(true);
    setLoading(false);
  }, [fetchInsight]);

  const handleToggle = useCallback(() => setExpanded(prev => !prev), []);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* 头部 */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-3
                   bg-gradient-to-r from-emerald-50 to-teal-50
                   hover:from-emerald-100 hover:to-teal-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-500" />
          <span className="text-sm font-medium text-gray-700">学情雷达</span>
          {data && (
            <span className="text-xs bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full">
              {data.online_count}人在线
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {expanded && (
            <button
              onClick={e => { e.stopPropagation(); handleRefresh(); }}
              className="p-1 rounded hover:bg-emerald-100 text-gray-400 hover:text-emerald-600"
              title="手动刷新"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {/* 内容区 */}
      {expanded && (
        <div className="p-3 space-y-3 bg-white">

          {/* 加载中 */}
          {loading && !data && (
            <div className="text-center py-6 text-xs text-gray-400">
              <RefreshCw size={18} className="animate-spin mx-auto mb-2 text-emerald-400" />
              <p>正在聚合学情数据...</p>
            </div>
          )}

          {/* 错误且无数据 */}
          {error && !data && (
            <div className="text-center py-6 space-y-3">
              <Activity size={32} className="mx-auto text-gray-200" />
              <div>
                <p className="text-sm text-gray-500">暂无数据</p>
                <p className="text-xs text-gray-400 mt-1">开启互动组件后即可查看学情数据</p>
              </div>
              <button onClick={handleRefresh}
                className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1 mx-auto">
                <RefreshCw size={12} /> 点击重试
              </button>
            </div>
          )}

          {/* 空状态 */}
          {!loading && !error && data &&
            data.components.length === 0 && data.top_students.length === 0 && (
            <div className="text-center py-4 space-y-2">
              <Activity size={28} className="mx-auto text-gray-200" />
              <p className="text-xs text-gray-400">暂无互动数据，开启组件后即可查看</p>
              <div className="flex justify-center gap-4 pt-1">
                <div className="text-center">
                  <div className="text-lg font-bold text-emerald-600">{data.online_count}</div>
                  <div className="text-xs text-gray-400">当前在线</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-amber-700">{data.total_joined}</div>
                  <div className="text-xs text-gray-400">累计加入</div>
                </div>
              </div>
            </div>
          )}

          {/* 有数据展示 */}
          {data && (data.components.length > 0 || data.top_students.length > 0) && (
            <>
              {/* 在线人数 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-emerald-50 rounded-lg p-2.5 text-center">
                  <div className="text-xl font-bold text-emerald-600">{data.online_count}</div>
                  <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    当前在线
                  </div>
                </div>
                <div className="bg-amber-50 rounded-lg p-2.5 text-center">
                  <div className="text-xl font-bold text-amber-700">{data.total_joined}</div>
                  <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
                    <Users size={11} />累计加入
                  </div>
                </div>
              </div>

              {/* 组件参与率 */}
              {data.components.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1">
                    <TrendingUp size={12} className="text-amber-600" />组件参与率
                  </div>
                  <div className="space-y-2">
                    {data.components.map(comp => (
                      <div key={comp?.element_id ?? Math.random()}>
                        <div className="flex justify-between text-xs text-gray-600 mb-0.5">
                          <span className="flex items-center gap-1">
                            <span className="text-gray-400 text-[10px]">
                              [{TYPE_LABELS[comp?.type ?? ''] ?? (comp?.type || '')}]
                            </span>
                            <span className="truncate max-w-[100px]">{comp?.title || ''}</span>
                          </span>
                          <span className="text-gray-500 flex-shrink-0">
                            {comp?.submitted ?? 0}/{comp?.total ?? 0}
                            <span className="ml-1 text-gray-400">
                              ({Math.round((comp?.rate ?? 0) * 100)}%)
                            </span>
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${rateColor(comp?.rate ?? 0)}`}
                            style={{ width: `${Math.round((comp?.rate ?? 0) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 未提交名单 */}
              {data.unsubmitted.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowUnsubmitted(!showUnsubmitted)}
                    className="w-full flex items-center justify-between text-xs font-medium text-gray-500 mb-1"
                  >
                    <span className="flex items-center gap-1">
                      <XCircle size={12} className="text-red-400" />
                      未提交（{data.unsubmitted.length}人）
                    </span>
                    {showUnsubmitted ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                  {showUnsubmitted && (
                    <div className="flex flex-wrap gap-1">
                      {data.unsubmitted.map(s => (
                        <span key={s?.uuid ?? Math.random()}
                          className="text-xs bg-red-50 text-red-600 border border-red-100 px-1.5 py-0.5 rounded-full">
                          {s?.nickname || '匿名'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 问答正确率 */}
              {data.qa_stats.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1">
                    <CheckCircle size={12} className="text-green-400" />问答正确率
                  </div>
                  <div className="space-y-1.5">
                    {data.qa_stats.map(qa => (
                      <div key={qa?.element_id ?? Math.random()} className="flex items-center justify-between text-xs">
                        <span className="text-gray-600 truncate max-w-[130px]">{qa?.title || ''}</span>
                        <span className={`font-medium flex-shrink-0 ${
                          (qa?.correct_rate ?? 0) >= 0.7 ? 'text-green-600' : 'text-red-500'
                        }`}>
                          {Math.round((qa?.correct_rate ?? 0) * 100)}%
                          <span className="text-gray-400 font-normal ml-1">
                            ({qa?.correct_count ?? 0}/{qa?.total_answers ?? 0})
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 高频词 */}
              {data.top_words.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1.5">🔤 高频词 Top10</div>
                  <div className="flex flex-wrap gap-1">
                    {data.top_words.map((w, i) => (
                      <span key={w?.word ?? i}
                        className="text-xs px-1.5 py-0.5 rounded-full border"
                        style={{
                          fontSize:       `${Math.max(10, 13 - i)}px`,
                          backgroundColor: i < 3 ? '#ede9fe' : '#f3f4f6',
                          color:           i < 3 ? '#7c3aed' : '#4b5563',
                          borderColor:     i < 3 ? '#c4b5fd' : '#e5e7eb',
                        }}
                      >
                        {w?.word || ''}
                        <span className="ml-0.5 opacity-60">×{w?.count ?? 0}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 小组活跃度 */}
              {data.group_activity.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1.5">👥 小组活跃度</div>
                  <div className="space-y-1.5">
                    {data.group_activity.map(g => {
                      const maxCount = data.group_activity[0]?.action_count || 1;
                      const rate     = (g?.action_count ?? 0) / maxCount;
                      return (
                        <div key={g?.group_id ?? Math.random()}>
                          <div className="flex justify-between text-xs text-gray-600 mb-0.5">
                            <span>{g?.group_name || ''}</span>
                            <span>{g?.action_count ?? 0} 次互动</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-teal-400 rounded-full transition-all"
                              style={{ width: `${Math.round(rate * 100)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 活跃学生 Top5 */}
              {data.top_students.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1">
                    <Star size={12} className="text-amber-400" />活跃学生 Top5
                  </div>
                  <div className="space-y-1">
                    {data.top_students.map((s, i) => (
                      <div key={s?.uuid ?? i} className="flex items-center gap-2 text-xs">
                        <span className={`w-4 text-center font-bold flex-shrink-0 ${
                          i === 0 ? 'text-amber-500' : i === 1 ? 'text-gray-400'
                            : i === 2 ? 'text-amber-700' : 'text-gray-300'
                        }`}>
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
                        </span>
                        <span className="flex-1 text-gray-700 truncate">{s?.nickname || '匿名'}</span>
                        <span className="text-gray-400 flex-shrink-0">{s?.action_count ?? 0}次</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {lastUpdated && (
                <p className="text-[10px] text-gray-300 text-right">
                  更新于 {lastUpdated} · 每10秒自动刷新
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ===== 导出：自包含ErrorBoundary，崩溃隔离在组件内部 =====
const InsightPanel: React.FC<Props> = (props) => (
  <InsightErrorBoundary>
    <InsightPanelInner {...props} />
  </InsightErrorBoundary>
);

export default InsightPanel;
