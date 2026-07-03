// =============================================================
// MindCanvas v4.3 - 公开只读分享页
// REQ-007修复：所有data字段加防御性默认值，防止undefined解构崩溃
//   - summary/participation/meta 均有完整默认值
//   - 加 ErrorBoundary 兜底
// =============================================================
import React, { useState, useEffect, Component } from 'react';
import { useParams } from 'react-router-dom';
import {
  BookOpen, Clock, TrendingUp, Eye, Users,
  BarChart2, Cloud, Image, CheckCircle,
  ChevronDown, ChevronUp, Share2, Heart,
} from 'lucide-react';

// ===== 类型定义 =====
interface PollSummary {
  element_id: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
  total_voters: number;
}

interface QASummary {
  element_id: string;
  question: string;
  options: string[];
  correct_index: number;
  answer_counts: Record<string, number>;
  total_answers: number;
  correct_rate: number;
  show_answer: boolean;
}

interface WordCloudSummary {
  element_id: string;
  prompt: string;
  words: Record<string, number>;
  total_words: number;
}

interface DropZoneSubmission {
  student_name: string;
  content_type: string;
  content: string;
  submitted_at: string;
  likes: number;
}

interface DropZoneSummary {
  element_id: string;
  title: string;
  submissions: DropZoneSubmission[];
  total_submissions: number;
}

interface SummaryData {
  title: string;
  created_at: string;
  duration: string;
  total_sessions: number;
  polls: PollSummary[];
  qa_summaries: QASummary[];
  word_clouds: WordCloudSummary[];
  dropzones: DropZoneSummary[];
  top_words: string[];
}

interface ParticipationData {
  total_votes: number;
  total_words: number;
  total_submissions: number;
}

// 默认空摘要，防止undefined访问崩溃
const emptySummary: SummaryData = {
  title: '',
  created_at: '',
  duration: '',
  total_sessions: 0,
  polls: [],
  qa_summaries: [],
  word_clouds: [],
  dropzones: [],
  top_words: [],
};

const emptyParticipation: ParticipationData = {
  total_votes: 0,
  total_words: 0,
  total_submissions: 0,
};

// ===== ErrorBoundary =====
interface EBState { hasError: boolean; }
class ShareErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center max-w-md px-4">
            <div className="text-4xl mb-4">😕</div>
            <h2 className="text-lg font-semibold text-gray-700 mb-2">页面渲染出错</h2>
            <p className="text-gray-500 text-sm mb-4">分享内容加载失败，请刷新页面重试</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-amber-700 text-white rounded-lg text-sm hover:bg-amber-800"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ===== 进度条 =====
function ProgressBar({ percent, color = 'bg-amber-400' }: { percent: number; color?: string }) {
  return (
    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
      />
    </div>
  );
}

// ===== 词云气泡 =====
const BUBBLE_COLORS = [
  'bg-amber-100 text-amber-800', 'bg-purple-100 text-purple-700',
  'bg-green-100 text-green-700', 'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700',  'bg-teal-100 text-teal-700',
];
function WordBubble({ word, count, maxCount, index }: {
  word: string; count: number; maxCount: number; index: number;
}) {
  const ratio    = maxCount > 0 ? count / maxCount : 0;
  const fontSize = Math.round(12 + ratio * 10);
  const colorCls = BUBBLE_COLORS[index % BUBBLE_COLORS.length];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full border ${colorCls}`}
      style={{ fontSize: `${fontSize}px` }}
    >
      {word}
      {count > 1 && <span className="ml-1 opacity-60 text-xs">×{count}</span>}
    </span>
  );
}

// ===== 内容类型图标 =====
function ContentTypeIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    text: '📝', image: '🖼️', file: '📎', link: '🔗',
  };
  return <span>{icons[type] || '📄'}</span>;
}

// ===== 主组件（被ErrorBoundary包裹）=====
const SharePageInner: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  type PageState = 'loading' | 'need_password' | 'loaded' | 'error' | 'expired';
  const [pageState, setPageState] = useState<PageState>('loading');
  const [errorMsg, setErrorMsg]   = useState('');
  const [password, setPassword]   = useState('');
  const [pwError, setPwError]     = useState('');

  // 分享数据，加完整防御性默认值
  const [data, setData] = useState<any>({});
  const summary: SummaryData = {
    ...emptySummary,
    ...(data?.summary ?? {}),
    polls:         Array.isArray(data?.summary?.polls)         ? data.summary.polls         : [],
    qa_summaries:  Array.isArray(data?.summary?.qa_summaries)  ? data.summary.qa_summaries  : [],
    word_clouds:   Array.isArray(data?.summary?.word_clouds)   ? data.summary.word_clouds   : [],
    dropzones:     Array.isArray(data?.summary?.dropzones)     ? data.summary.dropzones     : [],
    top_words:     Array.isArray(data?.summary?.top_words)     ? data.summary.top_words     : [],
  };
  const participation: ParticipationData = { ...emptyParticipation, ...(data?.participation ?? {}) };
  const meta = data?.meta ?? {};

  const [expandPolls, setExpandPolls]     = useState(true);
  const [expandQA, setExpandQA]           = useState(true);
  const [expandWords, setExpandWords]     = useState(true);
  const [expandDropzone, setExpandDropzone] = useState(true);

  // 数据有效性判断，防止map崩溃
  const hasPollData     = summary.polls.length > 0;
  const hasQAData       = summary.qa_summaries.length > 0;
  const hasWordData     = summary.word_clouds.length > 0;
  const hasDropzone     = summary.dropzones.length > 0;
  const hasTopWords     = summary.top_words.length > 0;

  // 加载分享数据
  const loadData = async (pwd?: string) => {
    try {
      const headers: Record<string, string> = {};
      if (pwd) headers['X-Share-Password'] = pwd;
      const res = await fetch(`/api/share/${token}/data`, {
        headers,
        credentials: 'include',
      });
      if (res.status === 401) {
        // 需要密码
        const json = await res.json().catch(() => ({}));
        if (json?.need_password) {
          setPageState('need_password');
          if (pwd) setPwError('密码错误，请重新输入');
          return;
        }
      }
      if (res.status === 410) { setPageState('expired'); return; }
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setErrorMsg(json?.error || '分享页加载失败');
        setPageState('error');
        return;
      }
      const json = await res.json();
      setData(json ?? {});
      setPwError('');
      setPageState('loaded');
    } catch (err: any) {
      setErrorMsg(err?.message || '网络错误，请稍后重试');
      setPageState('error');
    }
  };

  useEffect(() => {
    if (token) loadData();
  }, [token]);

  // ===== 加载中 =====
  if (pageState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="spinner mx-auto mb-4" />
          <p className="text-gray-400 text-sm">加载分享内容...</p>
        </div>
      </div>
    );
  }

  // ===== 需要密码 =====
  if (pageState === 'need_password') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">需要访问密码</h2>
          <p className="text-sm text-gray-500 mb-5">此分享页面已加密，请输入密码查看</p>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadData(password)}
            placeholder="请输入密码"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-amber-300"
            autoFocus
          />
          {pwError && <p className="text-xs text-red-500 mb-3">{pwError}</p>}
          <button
            onClick={() => loadData(password)}
            disabled={!password.trim()}
            className="w-full py-2.5 bg-amber-700 text-white rounded-xl text-sm font-medium hover:bg-amber-800 disabled:opacity-50"
          >
            确认访问
          </button>
        </div>
      </div>
    );
  }

  // ===== 过期 =====
  if (pageState === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <div className="text-4xl mb-4">⌛</div>
          <h2 className="text-lg font-semibold text-gray-700 mb-2">分享链接已过期</h2>
          <p className="text-sm text-gray-400">此分享页面已超过有效期，请联系教师重新分享</p>
        </div>
      </div>
    );
  }

  // ===== 错误 =====
  if (pageState === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <div className="text-4xl mb-4">😕</div>
          <h2 className="text-lg font-semibold text-gray-700 mb-2">加载失败</h2>
          <p className="text-sm text-gray-400 mb-4">{errorMsg || '分享内容不存在或已被删除'}</p>
          <button
            onClick={() => loadData()}
            className="px-4 py-2 bg-amber-700 text-white rounded-lg text-sm hover:bg-amber-800"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  // ===== 正常展示 =====
  return (
    <div className="min-h-screen bg-gray-50">

      {/* Banner */}
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-5">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 bg-amber-700 rounded-md flex items-center justify-center">
                  <span className="text-white font-bold text-xs">MC</span>
                </div>
                <span className="text-xs text-gray-400">MindCanvas 课堂成果</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 leading-tight">
                {data?.title || summary.title || '课堂成果'}
              </h1>
              {data?.description && (
                <p className="text-gray-500 text-sm mt-1">{data.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-gray-400">
                {meta?.teacher_name && (
                  <span className="flex items-center gap-1">
                    <BookOpen size={12} />{meta.teacher_name}
                  </span>
                )}
                {summary.created_at && (
                  <span className="flex items-center gap-1">
                    <Clock size={12} />{summary.created_at}
                  </span>
                )}
                {summary.duration && summary.duration !== '进行中' && (
                  <span className="flex items-center gap-1">
                    <TrendingUp size={12} />时长 {summary.duration}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Eye size={12} />{data?.view_count ?? 0} 次查看
                </span>
                {data?.expires_at && (
                  <span className="flex items-center gap-1 text-orange-400">
                    <Clock size={12} />
                    {new Date(data.expires_at).toLocaleDateString('zh-CN')} 过期
                  </span>
                )}
              </div>
            </div>
            <div className="ml-4 flex-shrink-0">
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                <Share2 size={18} className="text-amber-500" />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* 参与概览 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={<Users size={18} className="text-amber-700" />}
            value={summary.total_sessions}
            label="参与人数"
            color="bg-amber-50"
          />
          {participation.total_votes > 0 && (
            <StatCard
              icon={<BarChart2 size={18} className="text-purple-500" />}
              value={participation.total_votes}
              label="投票次数"
              color="bg-purple-50"
            />
          )}
          {participation.total_words > 0 && (
            <StatCard
              icon={<Cloud size={18} className="text-teal-500" />}
              value={participation.total_words}
              label="词云提交"
              color="bg-teal-50"
            />
          )}
          {participation.total_submissions > 0 && (
            <StatCard
              icon={<Image size={18} className="text-orange-500" />}
              value={participation.total_submissions}
              label="作品提交"
              color="bg-orange-50"
            />
          )}
        </div>

        {/* 投票结果 */}
        {hasPollData && (
          <Section title="投票结果" icon={<BarChart2 size={16} className="text-purple-500" />}
            expanded={expandPolls} onToggle={() => setExpandPolls(!expandPolls)} count={summary.polls.length}>
            <div className="space-y-5">
              {summary.polls.map((poll, i) => (
                <PollCard key={poll?.element_id ?? i} poll={poll} index={i} />
              ))}
            </div>
          </Section>
        )}

        {/* 问答结果 */}
        {hasQAData && (
          <Section title="问答结果" icon={<CheckCircle size={16} className="text-green-500" />}
            expanded={expandQA} onToggle={() => setExpandQA(!expandQA)} count={summary.qa_summaries.length}>
            <div className="space-y-5">
              {summary.qa_summaries.map((qa, i) => (
                <QACard key={qa?.element_id ?? i} qa={qa} index={i} />
              ))}
            </div>
          </Section>
        )}

        {/* 词云 */}
        {hasWordData && (
          <Section title="词云收集" icon={<Cloud size={16} className="text-teal-500" />}
            expanded={expandWords} onToggle={() => setExpandWords(!expandWords)} count={summary.word_clouds.length}>
            <div className="space-y-5">
              {summary.word_clouds.map((wc, i) => (
                <WordCloudCard key={wc?.element_id ?? i} wc={wc} index={i} />
              ))}
            </div>
          </Section>
        )}

        {/* 作品墙 */}
        {hasDropzone && (
          <Section title="作品墙" icon={<Image size={16} className="text-orange-500" />}
            expanded={expandDropzone} onToggle={() => setExpandDropzone(!expandDropzone)}
            count={summary.dropzones.reduce((s, d) => s + (d?.total_submissions ?? 0), 0)}
            countLabel="件作品">
            <div className="space-y-5">
              {summary.dropzones.map(dz => (
                <DropzoneCard key={dz?.element_id ?? Math.random()} dz={dz} hideNames={!!(data?.hide_names)} />
              ))}
            </div>
          </Section>
        )}

        {/* 全场高频词 */}
        {hasTopWords && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <span className="text-base">🔑</span> 全场高频词
            </h3>
            <div className="flex flex-wrap gap-2">
              {summary.top_words.map((word, i) => (
                <span key={word ?? i}
                  className={`px-3 py-1 rounded-full text-sm border ${
                    i < 3 ? 'bg-amber-100 text-amber-800 border-amber-200 font-medium' : 'bg-gray-100 text-gray-600 border-gray-200'
                  }`}>
                  {word}
                </span>
              ))}
            </div>
          </div>
        )}

        <footer className="text-center py-6 text-xs text-gray-300">
          <p>由 <span className="text-amber-500">MindCanvas</span> 生成 · 只读展示</p>
          {data?.hide_names && (
            <p className="mt-1 flex items-center justify-center gap-1">
              <Eye size={10} /> 已隐藏学生姓名
            </p>
          )}
        </footer>
      </main>
    </div>
  );
};

// ===== 子组件 =====

function StatCard({ icon, value, label, color }: {
  icon: React.ReactNode; value: number; label: string; color: string;
}) {
  return (
    <div className={`${color} rounded-xl p-3 text-center`}>
      <div className="flex justify-center mb-1">{icon}</div>
      <div className="text-2xl font-bold text-gray-800">{value ?? 0}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function Section({ title, icon, expanded, onToggle, count, countLabel = '个', children }: {
  title: string; icon: React.ReactNode; expanded: boolean;
  onToggle: () => void; count: number; countLabel?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-semibold text-gray-800">{title}</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {count ?? 0}{countLabel}
          </span>
        </div>
        {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {expanded && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

function PollCard({ poll, index }: { poll: PollSummary; index: number }) {
  if (!poll) return null;
  const total = poll.total_voters || 0;
  const options = Array.isArray(poll.options) ? poll.options : [];
  const votes   = poll.votes ?? {};
  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <p className="text-sm font-medium text-gray-800 mb-3">
        <span className="text-gray-400 mr-1">Q{index + 1}.</span>{poll.question}
      </p>
      <div className="space-y-2.5">
        {options.map(opt => {
          const cnt = votes?.[opt] || 0;
          const pct = total > 0 ? Math.round(cnt * 100 / total) : 0;
          return (
            <div key={opt}>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>{opt}</span>
                <span className="font-medium">{cnt}票 ({pct}%)</span>
              </div>
              <ProgressBar percent={pct} color={pct >= 50 ? 'bg-amber-600' : 'bg-amber-300'} />
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 mt-3 text-right">共 {total} 人参与投票</p>
    </div>
  );
}

function QACard({ qa, index }: { qa: QASummary; index: number }) {
  if (!qa) return null;
  const total   = qa.total_answers || 0;
  const options = Array.isArray(qa.options) ? qa.options : [];
  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm font-medium text-gray-800 flex-1">
          <span className="text-gray-400 mr-1">Q{index + 1}.</span>{qa.question}
        </p>
        {total > 0 && (
          <span className={`ml-3 text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
            (qa.correct_rate ?? 0) >= 0.7 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
          }`}>
            正确率 {Math.round((qa.correct_rate ?? 0) * 100)}%
          </span>
        )}
      </div>
      <div className="space-y-2">
        {options.map((opt, j) => {
          const cnt      = qa.answer_counts?.[opt] || 0;
          const pct      = total > 0 ? Math.round(cnt * 100 / total) : 0;
          const isCorrect = qa.show_answer && j === qa.correct_index;
          return (
            <div key={opt}>
              <div className="flex justify-between text-xs mb-1">
                <span className={`flex items-center gap-1 ${isCorrect ? 'text-green-600 font-medium' : 'text-gray-600'}`}>
                  {isCorrect && <CheckCircle size={11} />}{opt}
                </span>
                <span className="text-gray-500">{cnt}人 ({pct}%)</span>
              </div>
              <ProgressBar percent={pct} color={isCorrect ? 'bg-green-400' : 'bg-amber-300'} />
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 mt-3 text-right">共 {total} 人作答</p>
    </div>
  );
}

function WordCloudCard({ wc, index }: { wc: WordCloudSummary; index: number }) {
  if (!wc) return null;
  const words = wc.words ?? {};
  const sorted = Object.entries(words).sort(([, a], [, b]) => b - a).slice(0, 30);
  const maxCount = sorted[0]?.[1] || 1;
  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-gray-800">
          <span className="text-gray-400 mr-1">#{index + 1}</span>{wc.prompt || '词云收集'}
        </p>
        <span className="text-xs text-gray-400">共 {wc.total_words ?? 0} 个词</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sorted.map(([word, count], i) => (
          <WordBubble key={word} word={word} count={count} maxCount={maxCount} index={i} />
        ))}
      </div>
    </div>
  );
}

function DropzoneCard({ dz, hideNames }: { dz: DropZoneSummary; hideNames: boolean }) {
  if (!dz) return null;
  const [expanded, setExpanded] = useState(false);
  const submissions = Array.isArray(dz.submissions) ? dz.submissions : [];
  const displaySubs = expanded ? submissions : submissions.slice(0, 6);
  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-gray-800">{dz.title}</h4>
        <span className="text-xs text-gray-400">
          {dz.total_submissions ?? 0} 件作品
          {hideNames && <span className="ml-1 text-gray-300">· 已隐名</span>}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {displaySubs.map((sub, i) => (
          <SubmissionCard key={i} sub={sub} hideNames={hideNames} />
        ))}
      </div>
      {submissions.length > 6 && (
        <button onClick={() => setExpanded(!expanded)}
          className="mt-3 w-full text-xs text-amber-700 hover:text-amber-800 py-1.5 border border-amber-100 rounded-lg hover:bg-amber-50 transition-colors">
          {expanded ? '收起' : `展开全部 ${submissions.length} 件作品`}
        </button>
      )}
    </div>
  );
}

function SubmissionCard({ sub, hideNames }: { sub: DropZoneSubmission; hideNames: boolean }) {
  if (!sub) return null;
  const displayName = hideNames ? '匿名' : (sub.student_name || '匿名');
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-xs border border-gray-100">
      <div className="flex items-center gap-1.5 mb-2 text-gray-500">
        <ContentTypeIcon type={sub.content_type} />
        <span className="font-medium text-gray-700">{displayName}</span>
        {(sub.likes ?? 0) > 0 && (
          <span className="ml-auto flex items-center gap-0.5 text-red-400">
            <Heart size={10} fill="currentColor" />{sub.likes}
          </span>
        )}
      </div>
      {sub.content_type === 'image' ? (
        <img src={sub.content} alt="作品图片"
          className="w-full h-24 object-cover rounded-md"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      ) : sub.content_type === 'link' ? (
        <a href={sub.content} target="_blank" rel="noopener noreferrer"
           className="text-amber-700 hover:underline break-all">{sub.content}</a>
      ) : (
        <p className="text-gray-600 break-words line-clamp-3">{sub.content}</p>
      )}
      {sub.submitted_at && (
        <p className="mt-2 text-gray-300">
          {new Date(sub.submitted_at).toLocaleString('zh-CN')}
        </p>
      )}
    </div>
  );
}

// ===== 导出：被ErrorBoundary包裹 =====
const SharePage: React.FC = () => (
  <ShareErrorBoundary>
    <SharePageInner />
  </ShareErrorBoundary>
);

export default SharePage;
