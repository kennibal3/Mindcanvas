// =============================================================
// MindCanvas v4.1 - 课堂总结面板（强化版）
// 修复：无数据时卡死问题，增加空状态提示和正常关闭逻辑
// 新增：QA 问答正确率、DropZone 作品墙、参与概览多维卡片
// =============================================================
import React, { useState, useCallback } from 'react';
import {
  FileText, Download, ChevronDown, ChevronUp,
  BarChart2, Cloud, Users, Clock, RefreshCw,
  CheckCircle, Image, MessageSquare,
} from 'lucide-react';

// ===== 类型定义（与 export_service.go 对齐）=====

interface PollSummary {
  element_id: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
  total_voters: number;
  mode: string;
}

interface WordCloudSummary {
  element_id: string;
  prompt: string;
  words: Record<string, number>;
  total_words: number;
}

interface QASummary {
  element_id: string;
  question: string;
  options: string[];
  correct_index: number;
  answer_counts: Record<string, number>;
  total_answers: number;
  correct_count: number;
  correct_rate: number;
  show_answer: boolean;
}

interface DropZoneSubmission {
  student_name: string;
  content_type: 'text' | 'image' | 'file' | 'link';
  content: string;
  submitted_at: string;
  likes: number;
}

interface DropZoneSummary {
  element_id: string;
  title: string;
  total_submissions: number;
  submissions: DropZoneSubmission[];
}

interface RoomSummary {
  room_id: string;
  title: string;
  created_at: string;
  duration: string;
  total_sessions: number;
  polls: PollSummary[];
  word_clouds: WordCloudSummary[];
  qa_summaries: QASummary[];
  dropzones: DropZoneSummary[];
  top_words: string[];
  participation: Record<string, number>;
}

interface Props {
  roomId: string;
}

// ===== 进度条组件 =====
const ProgressBar = ({
  percent,
  colorClass = 'bg-amber-400',
}: {
  percent: number;
  colorClass?: string;
}) => (
  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
    <div
      className={`h-full rounded-full transition-all ${colorClass}`}
      style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
    />
  </div>
);

// ===== 主组件 =====
const SummaryPanel: React.FC<Props> = ({ roomId }) => {
  const [summary, setSummary]   = useState<RoomSummary | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [expanded, setExpanded] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ===== 加载总结数据 =====
  const loadSummary = useCallback(async (force = false) => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/rooms/${roomId}/summary`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('加载失败');
      const data: RoomSummary = await res.json();
      setSummary(data);
      // 强制刷新或首次加载都展开
      if (force || !expanded) setExpanded(true);
    } catch {
      setError('加载总结失败，请重试');
      // 首次加载失败也要展开，显示错误和关闭按钮
      if (!expanded) setExpanded(true);
    } finally {
      setLoading(false);
    }
  }, [roomId, loading, expanded]);

  // ===== 导出 Markdown =====
  const exportMarkdown = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/summary/export`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('导出失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `课堂总结_${summary?.title || roomId}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  }, [roomId, summary]);

  // ===== 头部点击：展开加载 or 切换收起 =====
  const handleToggle = useCallback(() => {
    if (!summary && !expanded) {
      // 首次点击：加载数据
      loadSummary();
    } else {
      // 已有数据或已展开：切换收起/展开
      setExpanded(prev => !prev);
    }
  }, [summary, expanded, loadSummary]);

  // ===== 投票最高选项 =====
  const getTopOption = (poll: PollSummary) => {
    if (!poll.votes || Object.keys(poll.votes).length === 0) return '暂无数据';
    const top = Object.entries(poll.votes).sort((a, b) => b[1] - a[1])[0];
    const pct = poll.total_voters > 0
      ? Math.round(top[1] * 100 / poll.total_voters)
      : 0;
    return `${top[0]} (${pct}%)`;
  };

  // ===== 词云 Top5 =====
  const getTopWords = (wc: WordCloudSummary) =>
    Object.entries(wc.words || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([w]) => w);

  // ===== 内容类型图标 =====
  const contentTypeIcon = (type: string) => {
    switch (type) {
      case 'image': return '🖼️';
      case 'file':  return '📎';
      case 'link':  return '🔗';
      default:      return '📝';
    }
  };

  // ===== 是否有任何互动数据 =====
  const hasInteractionData = summary && (
    (summary.polls?.length || 0) > 0 ||
    (summary.word_clouds?.length || 0) > 0 ||
    (summary.qa_summaries?.length || 0) > 0 ||
    (summary.dropzones?.length || 0) > 0
  );

  // ===== 总组件数（用于徽章）=====
  const totalWidgets = summary
    ? (summary.polls?.length || 0)
      + (summary.word_clouds?.length || 0)
      + (summary.qa_summaries?.length || 0)
      + (summary.dropzones?.length || 0)
    : 0;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">

      {/* 头部：点击展开/收起 */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-3
                   bg-gradient-to-r from-amber-50 to-orange-50
                   hover:from-amber-100 hover:to-orange-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-amber-600" />
          <span className="text-sm font-medium text-gray-700">课堂总结</span>
          {summary && totalWidgets > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              {totalWidgets} 个组件
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <RefreshCw size={12} className="animate-spin" />
              加载中
            </span>
          )}
          {/* 始终显示展开/收起箭头，保证用户可以关闭面板 */}
          {expanded
            ? <ChevronUp className="w-4 h-4 text-gray-400" />
            : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {/* 展开内容区：无论有无数据都能正常渲染 */}
      {expanded && (
        <div className="bg-white">

          {/* ===== 加载中占位 ===== */}
          {loading && !summary && (
            <div className="p-4 text-center py-8">
              <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-amber-500" />
              <p className="text-xs text-gray-400">正在加载课堂总结...</p>
            </div>
          )}

          {/* ===== 错误 + 空状态：保证有关闭能力 ===== */}
          {error && !summary && (
            <div className="p-4 text-center py-6 space-y-3">
              <FileText size={32} className="mx-auto text-gray-200" />
              <div>
                <p className="text-sm text-gray-500">暂无数据</p>
                <p className="text-xs text-gray-400 mt-1">
                  开启互动后即可查看课堂总结
                </p>
              </div>
              <button
                onClick={() => loadSummary(true)}
                className="text-xs text-amber-700 hover:text-amber-800 flex items-center gap-1 mx-auto"
              >
                <RefreshCw size={12} />
                点击重试
              </button>
            </div>
          )}

          {/* ===== 有数据时的正常展示 ===== */}
          {summary && (
            <div className="p-4 space-y-4">

              {/* 基本信息行 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {summary.created_at}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {summary.total_sessions} 人参与
                  </span>
                  {summary.duration !== '进行中' && (
                    <span className="text-gray-400">时长 {summary.duration}</span>
                  )}
                </div>
                {/* 刷新按钮 */}
                <button
                  onClick={() => loadSummary(true)}
                  disabled={loading}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50
                             transition-colors disabled:opacity-40"
                  title="刷新总结数据"
                >
                  <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>

              {/* 参与度多维统计卡片 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center p-2.5 bg-amber-50 rounded-lg">
                  <p className="text-xl font-bold text-amber-700">
                    {summary.participation?.total_sessions || 0}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">参与人数</p>
                </div>
                {(summary.participation?.total_votes || 0) > 0 && (
                  <div className="text-center p-2.5 bg-purple-50 rounded-lg">
                    <p className="text-xl font-bold text-purple-600">
                      {summary.participation.total_votes}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">投票次数</p>
                  </div>
                )}
                {(summary.participation?.total_words || 0) > 0 && (
                  <div className="text-center p-2.5 bg-teal-50 rounded-lg">
                    <p className="text-xl font-bold text-teal-600">
                      {summary.participation.total_words}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">词云提交</p>
                  </div>
                )}
                {(summary.participation?.total_answers || 0) > 0 && (
                  <div className="text-center p-2.5 bg-green-50 rounded-lg">
                    <p className="text-xl font-bold text-green-600">
                      {summary.participation.total_answers}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">问答作答</p>
                  </div>
                )}
                {(summary.participation?.total_submissions || 0) > 0 && (
                  <div className="text-center p-2.5 bg-orange-50 rounded-lg">
                    <p className="text-xl font-bold text-orange-600">
                      {summary.participation.total_submissions}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">作品提交</p>
                  </div>
                )}
              </div>

              {/* ===== 投票汇总 ===== */}
              {summary.polls?.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <BarChart2 className="w-3.5 h-3.5 text-amber-600" />
                    <span className="text-xs font-semibold text-gray-600">
                      投票结果（{summary.polls.length}个）
                    </span>
                  </div>
                  <div className="space-y-2">
                    {summary.polls.map((poll, idx) => (
                      <div key={poll.element_id || idx} className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs font-medium text-gray-700 mb-2">{poll.question}</p>
                        {(poll.options || []).map(opt => {
                          const cnt = poll.votes?.[opt] || 0;
                          const pct = poll.total_voters > 0
                            ? Math.round(cnt * 100 / poll.total_voters)
                            : 0;
                          return (
                            <div key={opt} className="mb-1.5">
                              <div className="flex justify-between text-xs text-gray-600 mb-0.5">
                                <span className="truncate max-w-[60%]">{opt}</span>
                                <span className="font-medium">{cnt}票 {pct}%</span>
                              </div>
                              <ProgressBar percent={pct} colorClass="bg-amber-400" />
                            </div>
                          );
                        })}
                        <p className="text-xs text-gray-400 mt-1.5">
                          共 {poll.total_voters} 人参与 · 最高：{getTopOption(poll)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ===== 问答汇总 ===== */}
              {summary.qa_summaries?.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                    <span className="text-xs font-semibold text-gray-600">
                      问答结果（{summary.qa_summaries.length}个）
                    </span>
                  </div>
                  <div className="space-y-2">
                    {summary.qa_summaries.map((qa, idx) => {
                      const ratePercent = Math.round(qa.correct_rate * 100);
                      return (
                        <div key={qa.element_id || idx} className="bg-gray-50 rounded-lg p-3">
                          <div className="flex items-start justify-between mb-2 gap-2">
                            <p className="text-xs font-medium text-gray-700 flex-1 leading-relaxed">
                              {qa.question}
                            </p>
                            {qa.total_answers > 0 && (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                                ratePercent >= 70
                                  ? 'bg-green-100 text-green-700'
                                  : ratePercent >= 40
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-red-100 text-red-600'
                              }`}>
                                {ratePercent}% 正确
                              </span>
                            )}
                          </div>
                          {(qa.options || []).map((opt, j) => {
                            const cnt = qa.answer_counts?.[opt] || 0;
                            const pct = qa.total_answers > 0
                              ? Math.round(cnt * 100 / qa.total_answers)
                              : 0;
                            const isCorrect = qa.show_answer && j === qa.correct_index;
                            return (
                              <div key={opt} className="mb-1.5">
                                <div className="flex justify-between text-xs mb-0.5">
                                  <span className={`flex items-center gap-1 truncate max-w-[65%] ${
                                    isCorrect ? 'text-green-600 font-medium' : 'text-gray-600'
                                  }`}>
                                    {isCorrect && <CheckCircle size={10} />}
                                    {opt}
                                  </span>
                                  <span className="text-gray-400">{cnt}人 {pct}%</span>
                                </div>
                                <ProgressBar
                                  percent={pct}
                                  colorClass={isCorrect ? 'bg-green-400' : 'bg-amber-300'}
                                />
                              </div>
                            );
                          })}
                          <p className="text-xs text-gray-400 mt-1.5">
                            共 {qa.total_answers} 人作答
                            {qa.total_answers > 0 && ` · ${qa.correct_count} 人正确`}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ===== 词云汇总 ===== */}
              {summary.word_clouds?.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Cloud className="w-3.5 h-3.5 text-purple-500" />
                    <span className="text-xs font-semibold text-gray-600">
                      词云收集（{summary.word_clouds.length}个）
                    </span>
                  </div>
                  <div className="space-y-2">
                    {summary.word_clouds.map((wc, idx) => (
                      <div key={wc.element_id || idx} className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs font-medium text-gray-700 mb-1.5">
                          {wc.prompt || '词云收集'}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {getTopWords(wc).map(w => (
                            <span
                              key={w}
                              className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full"
                            >
                              {w}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-gray-400 mt-1.5">
                          共收集 {wc.total_words} 个词语
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ===== 作品墙汇总 ===== */}
              {summary.dropzones?.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Image className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-xs font-semibold text-gray-600">
                      作品墙（{summary.dropzones.length}个）
                    </span>
                  </div>
                  <div className="space-y-2">
                    {summary.dropzones.map((dz, idx) => (
                      <div key={dz.element_id || idx} className="bg-gray-50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium text-gray-700">{dz.title}</p>
                          <span className="text-xs text-gray-400">
                            {dz.total_submissions} 件作品
                          </span>
                        </div>
                        <div className="space-y-1">
                          {(dz.submissions || []).slice(0, 3).map((sub, si) => (
                            <div
                              key={si}
                              className="flex items-start gap-2 text-xs text-gray-600 bg-white rounded-lg px-2 py-1.5"
                            >
                              <span className="flex-shrink-0">{contentTypeIcon(sub.content_type)}</span>
                              <span className="text-gray-500 flex-shrink-0">{sub.student_name}</span>
                              <span className="text-gray-700 truncate flex-1">
                                {sub.content_type === 'image'
                                  ? '[图片]'
                                  : sub.content_type === 'file'
                                  ? '[文件]'
                                  : (sub.content ?? '').length > 30
                                  ? (sub.content ?? '').slice(0, 30) + '...'
                                  : (sub.content ?? '')}
                              </span>
                              {sub.likes > 0 && (
                                <span className="text-red-400 flex-shrink-0">❤️{sub.likes}</span>
                              )}
                            </div>
                          ))}
                          {dz.total_submissions > 3 && (
                            <p className="text-xs text-gray-400 text-center pt-1">
                              还有 {dz.total_submissions - 3} 件，导出查看全部
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ===== 无互动数据提示（有summary对象但无组件数据）===== */}
              {!hasInteractionData && (
                <div className="text-center py-4">
                  <MessageSquare size={24} className="mx-auto text-gray-200 mb-2" />
                  <p className="text-xs text-gray-400">暂无互动数据，开启互动后即可查看</p>
                </div>
              )}

              {/* 高频词标签 */}
              {summary.top_words?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">全场高频词</p>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.top_words.map((w, i) => (
                      <span
                        key={w}
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          i < 3
                            ? 'bg-amber-100 text-amber-800 font-medium'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 导出 Markdown 按钮 */}
              <button
                onClick={exportMarkdown}
                disabled={exporting}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg
                           border border-amber-200 text-amber-700 text-sm
                           hover:bg-amber-50 disabled:opacity-40 transition-colors"
              >
                <Download className="w-4 h-4" />
                {exporting ? '导出中...' : '导出 Markdown 总结'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 错误提示条（有summary时的轻量错误提示）*/}
      {error && summary && (
        <div className="px-4 py-2 bg-red-50 text-xs text-red-500 flex items-center gap-1">
          <span>⚠️</span>{error}
        </div>
      )}
    </div>
  );
};

export default SummaryPanel;
