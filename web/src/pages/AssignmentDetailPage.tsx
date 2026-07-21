// =============================================================
// MindCanvas Phase8 - 作业详情页（Phase8-v2升级版）
// 路由：/assignments/:id
// 功能：材料管理、Rubric确认、提交列表查看、作业码与花名册管理
// =============================================================
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Upload, FileText, Trash2, RefreshCw,
  CheckCircle, AlertCircle, Loader2, Plus, Users,
  Star, Eye, Download, Key, Copy, ClipboardList, Sparkles,
  ChevronUp, ChevronDown, Pencil, Check, X,
} from 'lucide-react';
import type {
  Assignment, AssignmentMaterial, AssignmentRubric,
  AssignmentSubmission, RubricCriterion,
} from '@/types/assignment';
import {
  ASSIGNMENT_STATUS_LABELS, MATERIAL_ROLE_LABELS, PARSE_STATUS_LABELS,
} from '@/types/assignment';
import type {
  AssignmentToken, RosterSummary,
} from '@/types/token';
import {
  getAssignment, listMaterials, addTextMaterial, deleteMaterial,
  reparseMaterial, uploadMaterialFile, generateRubric, getRubric,
  confirmRubric, listSubmissions, updateAssignmentStatus,
  startLectureAnalyze, getLectureReport,
  updateLectureBlock, deleteLectureBlock, regenerateLectureBlock,
  getLectureJob, confirmLectureReport,
  generateRecommendations, getRecommendationJob, listRecommendations,
  updateRecommendation, publishRecommendations,
  listRemediations, generateStudentRemediation, getRemediationJob,
  getStudentRemediation, updateStudentRemediation, sendStudentRemediation,
} from '@/utils/assignmentApi';
import type {
  LectureReport, LectureReportBlock, RecommendedQuestion,
  RemediationListItem, StudentRemediation,
} from '@/utils/assignmentApi';
import {
  generateTokens, listTokens, exportTokensCSV,
  getRoster, addRosterEntry, importRosterCSVFile,
  syncRosterFromClassroom, deleteRosterEntry,
} from '@/utils/tokenApi';
// REQ-039 第三期 3d：导出（Markdown/打印 PDF）与「插入画布」跨页交接
import { reportToMarkdown, downloadMarkdown, printReport } from '@/utils/lectureExport';
import { stashCanvasInsert } from '@/utils/canvasHandoff';

// ===== 错误边界：捕获渲染错误并显示详情而非白屏 =====
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8">
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-2xl w-full">
            <h2 className="text-red-700 font-bold mb-2">页面渲染错误（调试信息）</h2>
            <p className="text-red-600 text-sm mb-3">{this.state.error.message}</p>
            <pre className="text-xs text-red-500 bg-red-100 p-3 rounded-lg overflow-auto max-h-48">
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => window.history.back()}
              className="mt-4 px-4 py-2 bg-red-500 text-white rounded-lg text-sm"
            >
              返回
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ===== 解析状态徽章 =====
const ParseBadge = ({ status }: { status: string }) => {
  const cfg = PARSE_STATUS_LABELS[status as keyof typeof PARSE_STATUS_LABELS]
    || { label: status, color: 'text-gray-400' };
  const icons: Record<string, React.ReactNode> = {
    pending:  <Loader2 size={11} />,
    parsing:  <Loader2 size={11} className="animate-spin" />,
    done:     <CheckCircle size={11} />,
    failed:   <AlertCircle size={11} />,
    skipped:  <span>—</span>,
  };
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${cfg.color}`}>
      {icons[status]}
      {cfg.label}
    </span>
  );
};

// ===== 文件大小格式化 =====
const fmtSize = (bytes: number) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
};

// ===== 复制到剪贴板 =====
const copyText = (text: string) => {
  navigator.clipboard.writeText(text).catch(() => {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  });
};

// ===== 作业码状态徽章 =====
const TokenBadge = ({ token }: { token: AssignmentToken }) => {
  const isUsed = !!token.used_at;
  const isExpired = new Date(token.expires_at) < new Date();
  if (isUsed) return <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">已使用</span>;
  if (isExpired) return <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">已过期</span>;
  return <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">待使用</span>;
};

// ===== 讲评报告：要点小列表（REQ-039 第二期，防空不白屏）=====
const LectureList: React.FC<{ title: string; items?: string[]; color: 'green' | 'red' | 'amber' }> = ({ title, items, color }) => {
  const list = Array.isArray(items) ? items : [];
  const dot = color === 'green' ? 'bg-green-400' : color === 'red' ? 'bg-red-400' : 'bg-amber-400';
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-1">{title}</p>
      {list.length === 0 ? (
        <p className="text-xs text-gray-300">—</p>
      ) : (
        <ul className="space-y-1">
          {list.map((t, i) => (
            <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
              <span className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${dot}`} />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ===== 讲评报告编辑器（REQ-039 第三期 3a）=====
// 块编辑（标题+每行一条要点）/ 上下移动 / 删除 / 单块重新生成（轮询 job）/ 逐块确认 / 整报告确认
const LectureReportEditor: React.FC<{
  aid: string;
  report: LectureReport | null;
  reload: () => Promise<LectureReport | null>;
  toast: (msg: string) => void;
  assignmentTitle: string;          // 3d：导出文件名与页眉
  roomId?: string | null;           // 3d：插入画布的目标房间（作业未关联房间时为空）
  onInsertToCanvas: (block: LectureReportBlock) => void; // 3d
}> = ({ aid, report, reload, toast, assignmentTitle, roomId, onInsertToCanvas }) => {
  const [busyId, setBusyId] = useState<string | null>(null);     // 正在重新生成的块
  const [actionBusy, setActionBusy] = useState(false);           // 其他操作互斥
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const regenPollRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (regenPollRef.current) window.clearInterval(regenPollRef.current);
  }, []);

  if (!report || report.generation_status !== 'done') {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
        {report?.generation_status === 'analyzing'
          ? <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin text-amber-500" />讲评分析生成中…完成后即可在此编辑</span>
          : report?.generation_status === 'failed'
            ? `上次生成失败：${report.last_error || '未知错误'}。请到「班级分析」页签重新生成。`
            : '请先到「班级分析」页签点击「一键生成讲评分析」，生成后即可在此编辑报告'}
      </div>
    );
  }

  const blocks = report.blocks ?? [];
  const confirmed = report.status === 'confirmed';
  const toList = (s: string) => (s || '').split('\n').map(x => x.trim()).filter(Boolean);

  const startEdit = (block: LectureReportBlock) => {
    const c = block.content ?? {};
    setEditingId(block.id);
    setDraftTitle(block.title || '');
    if (block.block_type === 'overview') {
      setDrafts({
        class_summary: c.class_summary ?? '',
        strengths: (c.strengths ?? []).join('\n'),
        common_issues: (c.common_issues ?? []).join('\n'),
        priority_topics: (c.priority_topics ?? []).join('\n'),
      });
    } else {
      setDrafts({
        common_problems: (c.common_problems ?? []).join('\n'),
        teacher_talking_points: (c.teacher_talking_points ?? []).join('\n'),
        example_quotes: (c.example_quotes ?? []).join('\n'),
      });
    }
  };

  const saveEdit = async (block: LectureReportBlock) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const c = block.content ?? {};
      let content: any;
      if (block.block_type === 'overview') {
        content = {
          ...c,
          class_summary: (drafts.class_summary ?? '').trim(),
          strengths: toList(drafts.strengths),
          common_issues: toList(drafts.common_issues),
          priority_topics: toList(drafts.priority_topics),
        };
      } else {
        content = {
          ...c,
          dimension_name: draftTitle.trim() || c.dimension_name,
          common_problems: toList(drafts.common_problems),
          teacher_talking_points: toList(drafts.teacher_talking_points),
          example_quotes: toList(drafts.example_quotes),
        };
      }
      await updateLectureBlock(aid, block.id, { title: draftTitle.trim(), content });
      setEditingId(null);
      await reload();
      toast('已保存');
    } catch (e: any) {
      toast(e?.message || '保存失败');
    } finally {
      setActionBusy(false);
    }
  };

  const doMove = async (block: LectureReportBlock, dir: 'up' | 'down') => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await updateLectureBlock(aid, block.id, { move: dir });
      await reload();
    } catch (e: any) {
      toast(e?.message || '移动失败');
    } finally {
      setActionBusy(false);
    }
  };

  const doConfirmBlock = async (block: LectureReportBlock) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await updateLectureBlock(aid, block.id, { confirm: !block.teacher_confirmed });
      await reload();
    } catch (e: any) {
      toast(e?.message || '操作失败');
    } finally {
      setActionBusy(false);
    }
  };

  const doDelete = async (block: LectureReportBlock) => {
    if (actionBusy) return;
    if (!window.confirm(`确定删除「${block.title || '该内容块'}」？删除后可通过「重新生成讲评分析」整体找回。`)) return;
    setActionBusy(true);
    try {
      await deleteLectureBlock(aid, block.id);
      await reload();
      toast('已删除');
    } catch (e: any) {
      toast(e?.message || '删除失败');
    } finally {
      setActionBusy(false);
    }
  };

  const doRegen = async (block: LectureReportBlock) => {
    if (busyId || actionBusy) return;
    setBusyId(block.id);
    try {
      const { job_id } = await regenerateLectureBlock(aid, block.id);
      regenPollRef.current = window.setInterval(async () => {
        try {
          const { status, last_error } = await getLectureJob(aid, job_id);
          if (status === 'done' || status === 'failed') {
            if (regenPollRef.current) window.clearInterval(regenPollRef.current);
            regenPollRef.current = null;
            setBusyId(null);
            await reload();
            toast(status === 'done' ? '该内容块已重新生成' : `重新生成失败：${last_error || '请重试'}`);
          }
        } catch { /* 网络抖动时继续轮询 */ }
      }, 2500);
    } catch (e: any) {
      setBusyId(null);
      toast(e?.message || '发起重新生成失败');
    }
  };

  const doConfirmReport = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await confirmLectureReport(aid);
      await reload();
      toast('整份报告已确认');
    } catch (e: any) {
      toast(e?.message || '确认失败');
    } finally {
      setActionBusy(false);
    }
  };

  // ===== 导出（REQ-039 3d）=====
  const doExportMarkdown = () => {
    if (!report) return;
    try {
      const md = reportToMarkdown(report, assignmentTitle);
      const safeName = (assignmentTitle || '讲评报告').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      downloadMarkdown(`${safeName}_讲评报告_${day}.md`, md);
      toast('Markdown 已下载');
    } catch (e: any) {
      toast(e?.message || '导出失败');
    }
  };

  const doPrintReport = () => {
    if (!report) return;
    const ok = printReport(report, assignmentTitle);
    if (!ok) toast('打印窗口被浏览器拦截，请允许本站弹出窗口后重试');
  };

  const iconBtn = 'p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors';

  return (
    <div className="space-y-3">
      {/* 报告状态条 */}
      <div className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${
        confirmed ? 'bg-green-50 border-green-100' : 'bg-amber-50 border-amber-100'}`}>
        <p className={`text-xs leading-relaxed ${confirmed ? 'text-green-700' : 'text-amber-800'}`}>
          {confirmed
            ? '整份报告已确认，可导出 Markdown 或打印为 PDF。修改任何内容块后需重新确认。'
            : '逐块检查并编辑下方内容；全部满意后点「确认整份报告」。已确认的报告才能导出。'}
        </p>
        {!confirmed && (
          <button
            onClick={doConfirmReport}
            disabled={actionBusy || !!busyId || blocks.length === 0}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
          >
            <CheckCircle size={13} />确认整份报告
          </button>
        )}
      </div>

      {/* 导出工具条（REQ-039 3d）：仅在整份报告已确认后可用 */}
      <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500 leading-relaxed">
          {confirmed
            ? '导出整份报告（含全部内容块）。PDF 请在打印对话框中选择「存储为 PDF」。'
            : '确认整份报告后即可导出 Markdown / PDF。'}
        </p>
        <div className="flex-shrink-0 flex items-center gap-2">
          <button
            onClick={doExportMarkdown}
            disabled={!confirmed || blocks.length === 0}
            title={confirmed ? '下载 Markdown 文件' : '请先确认整份报告'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:text-amber-700 hover:border-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Download size={13} />导出 Markdown
          </button>
          <button
            onClick={doPrintReport}
            disabled={!confirmed || blocks.length === 0}
            title={confirmed ? '打开打印视图，可存为 PDF' : '请先确认整份报告'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:text-amber-700 hover:border-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <FileText size={13} />打印 / 存为 PDF
          </button>
        </div>
      </div>

      {blocks.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
          报告暂无内容块，请到「班级分析」页签重新生成讲评分析
        </div>
      )}

      {blocks.map((block, bi) => {
        const c = block.content ?? {};
        const isEditing = editingId === block.id;
        const isRegen = busyId === block.id;
        const isOverview = block.block_type === 'overview';
        return (
          <div key={block.id} className={`bg-white rounded-xl border p-4 ${
            block.teacher_confirmed ? 'border-green-200' : 'border-gray-100'}`}>
            {/* 块头：标题 + 操作按钮 */}
            <div className="flex items-center gap-2 mb-2">
              {isEditing ? (
                <input
                  value={draftTitle}
                  onChange={e => setDraftTitle(e.target.value)}
                  className="flex-1 text-sm font-semibold text-gray-700 border border-amber-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              ) : (
                <h3 className="flex-1 text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                  {isOverview && <ClipboardList size={14} className="text-amber-600" />}
                  {block.title || (isOverview ? '班级总体概览' : '维度分析')}
                  {block.teacher_confirmed && (
                    <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-normal">已确认</span>
                  )}
                </h3>
              )}
              {isEditing ? (
                <>
                  <button onClick={() => saveEdit(block)} disabled={actionBusy}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg text-white bg-amber-500 hover:bg-amber-600 disabled:bg-gray-200 transition-colors">
                    <Check size={12} />保存
                  </button>
                  <button onClick={() => setEditingId(null)} disabled={actionBusy}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors">
                    <X size={12} />取消
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-0.5">
                  <button onClick={() => doMove(block, 'up')} disabled={actionBusy || !!busyId || bi === 0}
                    className={iconBtn} title="上移"><ChevronUp size={15} /></button>
                  <button onClick={() => doMove(block, 'down')} disabled={actionBusy || !!busyId || bi === blocks.length - 1}
                    className={iconBtn} title="下移"><ChevronDown size={15} /></button>
                  <button onClick={() => startEdit(block)} disabled={actionBusy || !!busyId}
                    className={iconBtn} title="编辑"><Pencil size={14} /></button>
                  <button onClick={() => doRegen(block)} disabled={actionBusy || !!busyId}
                    className={iconBtn} title="用 AI 重新生成该块">
                    {isRegen ? <Loader2 size={14} className="animate-spin text-amber-500" /> : <RefreshCw size={14} />}
                  </button>
                  {/* 插入画布（REQ-039 3d）：跳转关联房间并当场插入要点卡片 */}
                  <button onClick={() => onInsertToCanvas(block)}
                    disabled={actionBusy || !!busyId || !roomId}
                    className={iconBtn}
                    title={roomId ? '把该块要点插入课堂画布' : '该作业未关联课堂房间，无法插入画布'}>
                    <Sparkles size={14} />
                  </button>
                  <button onClick={() => doConfirmBlock(block)} disabled={actionBusy || !!busyId}
                    className={`${iconBtn} ${block.teacher_confirmed ? 'text-green-500 hover:text-green-600' : ''}`}
                    title={block.teacher_confirmed ? '取消确认' : '确认该块'}>
                    <CheckCircle size={14} />
                  </button>
                  <button onClick={() => doDelete(block)} disabled={actionBusy || !!busyId}
                    className={`${iconBtn} hover:text-red-500`} title="删除该块"><Trash2 size={14} /></button>
                </div>
              )}
            </div>

            {/* 重新生成中 */}
            {isRegen && (
              <p className="text-xs text-amber-600 mb-2 flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />AI 正在重新生成该块，其余内容不受影响…
              </p>
            )}

            {/* 块体：编辑态 / 只读态 */}
            {isEditing ? (
              <div className="space-y-2">
                {isOverview && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">班级小结</p>
                    <textarea value={drafts.class_summary ?? ''} rows={3}
                      onChange={e => setDrafts(d => ({ ...d, class_summary: e.target.value }))}
                      className="w-full text-xs text-gray-600 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                  </div>
                )}
                {(isOverview
                  ? [['strengths', '亮点'], ['common_issues', '共性问题'], ['priority_topics', '讲评重点']]
                  : [['common_problems', '典型问题'], ['teacher_talking_points', '讲评要点'], ['example_quotes', '学生原话样例']]
                ).map(([field, label]) => (
                  <div key={field}>
                    <p className="text-xs font-semibold text-gray-500 mb-1">{label}（每行一条）</p>
                    <textarea value={drafts[field] ?? ''} rows={3}
                      onChange={e => setDrafts(d => ({ ...d, [field]: e.target.value }))}
                      className="w-full text-xs text-gray-600 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                  </div>
                ))}
              </div>
            ) : isOverview ? (
              <>
                {c.class_summary && <p className="text-sm text-gray-600 leading-relaxed mb-3">{c.class_summary}</p>}
                <div className="grid sm:grid-cols-3 gap-3">
                  <LectureList title="亮点" items={c.strengths} color="green" />
                  <LectureList title="共性问题" items={c.common_issues} color="red" />
                  <LectureList title="讲评重点" items={c.priority_topics} color="amber" />
                </div>
              </>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <LectureList title="典型问题" items={c.common_problems} color="red" />
                  <LectureList title="讲评要点" items={c.teacher_talking_points} color="amber" />
                </div>
                {(c.example_quotes ?? []).length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-gray-500 mb-1">学生原话样例</p>
                    <div className="space-y-1">
                      {(c.example_quotes ?? []).map((q: string, i: number) => (
                        <p key={i} className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1 italic">“{q}”</p>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ===== 推荐练习面板（REQ-039 第三期 3b）=====
// 生成（轮询 job）/ 题卡展示 / 采用·拒绝·修改 / 发布为新作业（复用花名册+每人专属码）
const RecommendationPanel: React.FC<{
  aid: string;
  reportConfirmed: boolean;
  toast: (msg: string) => void;
}> = ({ aid, reportConfirmed, toast }) => {
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<RecommendedQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ stem: '', options: '', answer: '', explanation: '' });
  const [publishing, setPublishing] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await listRecommendations(aid);
      setQuestions(res.questions ?? []);
    } catch {
      setQuestions([]);
    } finally {
      setLoading(false);
    }
  }, [aid]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  const doGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await generateRecommendations(aid);
      toast('正在生成推荐练习题…');
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(async () => {
        try {
          const job = await getRecommendationJob(aid, res.job_id);
          if (job.status === 'done' || job.status === 'failed') {
            if (pollRef.current) window.clearInterval(pollRef.current);
            pollRef.current = null;
            setGenerating(false);
            if (job.status === 'failed') toast(`生成失败：${job.last_error || '未知错误'}`);
            else toast('推荐练习题已生成');
            await load();
          }
        } catch {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setGenerating(false);
        }
      }, 2500);
    } catch (e: any) {
      setGenerating(false);
      toast(e?.message || '生成失败');
    }
  };

  const stemOf = (q: RecommendedQuestion) =>
    (q.final_content?.stem ?? q.content?.stem ?? '').toString();
  const optionsOf = (q: RecommendedQuestion) =>
    (q.final_content?.options ?? q.content?.options ?? []) as string[];

  const startEdit = (q: RecommendedQuestion) => {
    setEditingId(q.id);
    setDraft({
      stem: stemOf(q),
      options: (optionsOf(q) ?? []).join('\n'),
      answer: q.answer?.answer ?? '',
      explanation: q.explanation ?? '',
    });
  };

  const saveEdit = async (q: RecommendedQuestion) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await updateRecommendation(aid, q.id, {
        content: {
          stem: draft.stem.trim(),
          options: draft.options.split('\n').map(x => x.trim()).filter(Boolean),
        },
        answer: { answer: draft.answer.trim() },
        explanation: draft.explanation.trim(),
      });
      setEditingId(null);
      await load();
      toast('已保存（该题已标记为采用）');
    } catch (e: any) {
      toast(e?.message || '保存失败');
    } finally {
      setActionBusy(false);
    }
  };

  const doAction = async (q: RecommendedQuestion, action: 'accept' | 'reject' | 'pending') => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await updateRecommendation(aid, q.id, { action });
      await load();
    } catch (e: any) {
      toast(e?.message || '操作失败');
    } finally {
      setActionBusy(false);
    }
  };

  const acceptedCount = questions.filter(
    q => q.teacher_action === 'accepted' || q.teacher_action === 'edited',
  ).length;

  const doPublish = async () => {
    if (publishing || acceptedCount === 0) return;
    if (!window.confirm(
      `将 ${acceptedCount} 道已采用的题目发布为一份新作业？\n\n新作业为草稿状态，会自动复制本次花名册并给每位学生生成专属作业码，你确认后再开放提交。`,
    )) return;
    setPublishing(true);
    try {
      const res = await publishRecommendations(aid);
      const r = res.result;
      toast(`已创建新作业「${r.title}」：${r.question_count} 题 / ${r.roster_count} 人 / ${r.token_count} 个作业码`);
      setTimeout(() => navigate(`/assignments/${r.assignment_id}`), 1200);
    } catch (e: any) {
      toast(e?.message || '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  if (!reportConfirmed) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
        推荐练习基于已确认的讲评报告生成。<br />
        请先到「报告编辑」页签点击「确认整份报告」。
      </div>
    );
  }

  const actionBadge = (a: string) => {
    const map: Record<string, { text: string; cls: string }> = {
      pending:   { text: '待审核', cls: 'bg-gray-100 text-gray-500' },
      accepted:  { text: '已采用', cls: 'bg-green-100 text-green-700' },
      edited:    { text: '已修改', cls: 'bg-green-100 text-green-700' },
      rejected:  { text: '已拒绝', cls: 'bg-red-50 text-red-500' },
      published: { text: '已发布', cls: 'bg-blue-100 text-blue-700' },
      saved:     { text: '已保存', cls: 'bg-gray-100 text-gray-500' },
    };
    return map[a] || map.pending;
  };

  return (
    <div className="space-y-4">
      {/* 顶部操作条 */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-600">
          共 <span className="font-semibold text-gray-800">{questions.length}</span> 道推荐题
          {acceptedCount > 0 && <>，已采用 <span className="font-semibold text-green-600">{acceptedCount}</span> 道</>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={doGenerate}
            disabled={generating || actionBusy}
            className="px-4 py-2 text-sm rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {generating
              ? <><Loader2 size={14} className="animate-spin" />生成中…</>
              : <><Sparkles size={14} />{questions.length > 0 ? '重新生成' : '一键生成推荐题'}</>}
          </button>
          <button
            onClick={doPublish}
            disabled={publishing || acceptedCount === 0}
            className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 inline-flex items-center gap-2"
          >
            {publishing
              ? <><Loader2 size={14} className="animate-spin" />发布中…</>
              : <><ClipboardList size={14} />发布为新作业</>}
          </button>
        </div>
      </div>

      {generating && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700 inline-flex items-center gap-2 w-full">
          <Loader2 size={16} className="animate-spin" />
          AI 正在基于讲评报告出题，通常需要 20-60 秒，可以先做别的事。
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">加载中…</div>
      ) : questions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
          还没有推荐题，点上面的「一键生成推荐题」开始。
        </div>
      ) : (
        questions.map((q, idx) => {
          const badge = actionBadge(q.teacher_action);
          const editing = editingId === q.id;
          const locked = q.teacher_action === 'published';
          const options = optionsOf(q) ?? [];
          return (
            <div key={q.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-800">第 {idx + 1} 题</span>
                  {q.question_type && <span className="text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-500">{q.question_type}</span>}
                  {q.difficulty && <span className="text-[11px] px-2 py-0.5 rounded bg-amber-50 text-amber-600">{q.difficulty}</span>}
                  <span className={`text-[11px] px-2 py-0.5 rounded ${badge.cls}`}>{badge.text}</span>
                </div>
                {!locked && (
                  <div className="flex gap-1 shrink-0">
                    {!editing && (
                      <>
                        <button onClick={() => startEdit(q)} disabled={actionBusy}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 disabled:opacity-40" title="修改">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => doAction(q, q.teacher_action === 'rejected' ? 'pending' : 'reject')} disabled={actionBusy}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 disabled:opacity-40" title="拒绝">
                          <X size={14} />
                        </button>
                        <button onClick={() => doAction(q, 'accept')} disabled={actionBusy}
                          className="p-1.5 rounded hover:bg-green-50 text-gray-400 hover:text-green-600 disabled:opacity-40" title="采用">
                          <Check size={14} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {editing ? (
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-500">题面</label>
                    <textarea value={draft.stem} onChange={e => setDraft({ ...draft, stem: e.target.value })}
                      rows={4} className="w-full text-sm border border-gray-200 rounded-lg p-2 mt-1" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">选项（每行一个，非选择题留空）</label>
                    <textarea value={draft.options} onChange={e => setDraft({ ...draft, options: e.target.value })}
                      rows={3} className="w-full text-sm border border-gray-200 rounded-lg p-2 mt-1" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">参考答案</label>
                    <textarea value={draft.answer} onChange={e => setDraft({ ...draft, answer: e.target.value })}
                      rows={2} className="w-full text-sm border border-gray-200 rounded-lg p-2 mt-1" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">解析</label>
                    <textarea value={draft.explanation} onChange={e => setDraft({ ...draft, explanation: e.target.value })}
                      rows={3} className="w-full text-sm border border-gray-200 rounded-lg p-2 mt-1" />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)} disabled={actionBusy}
                      className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-500">取消</button>
                    <button onClick={() => saveEdit(q)} disabled={actionBusy}
                      className="px-3 py-1.5 text-sm rounded-lg bg-amber-500 text-white disabled:opacity-50">保存</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{stemOf(q) || '（题面为空）'}</p>
                  {options.length > 0 && (
                    <div className="space-y-0.5">
                      {options.map((opt, i) => (
                        <p key={i} className="text-sm text-gray-600">{String.fromCharCode(65 + i)}. {opt}</p>
                      ))}
                    </div>
                  )}
                  {(q.knowledge_points ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(q.knowledge_points ?? []).map((kp, i) => (
                        <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-gray-50 text-gray-500">{kp}</span>
                      ))}
                    </div>
                  )}
                  {q.answer?.answer && (
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-xs font-semibold text-gray-500 mb-1">参考答案</p>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{q.answer.answer}</p>
                    </div>
                  )}
                  {q.explanation && (
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-xs font-semibold text-gray-500 mb-1">解析</p>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{q.explanation}</p>
                    </div>
                  )}
                  {q.recommendation_reason && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                      推荐理由：{q.recommendation_reason}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
      {questions.length > 0 && (
        <p className="text-[11px] text-gray-400 text-center">
          AI 出题仅供参考，请逐题核对后再采用；发布后会生成一份新的草稿作业，需你手动开放提交。
        </p>
      )}
    </div>
  );
};

// =============================================================
// 学生补救面板（REQ-039 第三期 3c）
// 左列表（谁交了/谁生成了/谁已发送）→ 右详情（教师版诊断 + 温和版可编辑 + 补救题）
// 逐个生成，不做全班批量，控 AI 成本
// =============================================================
const RemediationPanel: React.FC<{
  aid: string;
  reportConfirmed: boolean;
  toast: (msg: string) => void;
}> = ({ aid, reportConfirmed, toast }) => {
  const [students, setStudents] = useState<RemediationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>('');
  const [detail, setDetail] = useState<StudentRemediation | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [generatingUUID, setGeneratingUUID] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [draftFeedback, setDraftFeedback] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await listRemediations(aid);
      setStudents(res.students ?? []);
    } catch {
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }, [aid]);

  const loadDetail = useCallback(async (uuid: string) => {
    if (!uuid) return;
    setDetailLoading(true);
    try {
      const res = await getStudentRemediation(aid, uuid);
      setDetail(res.remediation);
      setDraftFeedback(res.remediation?.gentle_feedback ?? '');
      setDraftNote(res.remediation?.teacher_note ?? '');
    } catch {
      setDetail(null);      // 还没生成过：右侧显示引导，不报错弹窗
    } finally {
      setDetailLoading(false);
      setEditing(false);
    }
  }, [aid]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  const pickStudent = (uuid: string) => {
    setSelected(uuid);
    setDetail(null);
    loadDetail(uuid);
  };

  const doGenerate = async (uuid: string) => {
    if (generatingUUID) return;
    setGeneratingUUID(uuid);
    try {
      const res = await generateStudentRemediation(aid, uuid);
      toast('正在生成该学生的补救建议…');
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(async () => {
        try {
          const job = await getRemediationJob(aid, res.job_id);
          if (job.status === 'done' || job.status === 'failed') {
            if (pollRef.current) window.clearInterval(pollRef.current);
            pollRef.current = null;
            setGeneratingUUID('');
            if (job.status === 'failed') toast(`生成失败：${job.last_error || '未知错误'}`);
            else toast('补救建议已生成');
            await loadList();
            if (uuid === selected || !selected) {
              setSelected(uuid);
              await loadDetail(uuid);
            }
          }
        } catch {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setGeneratingUUID('');
        }
      }, 2500);
    } catch (e: any) {
      setGeneratingUUID('');
      toast(e?.message || '生成失败');
    }
  };

  const saveFeedback = async () => {
    if (busy || !detail) return;
    if (!draftFeedback.trim()) { toast('温和版反馈不能为空'); return; }
    setBusy(true);
    try {
      await updateStudentRemediation(aid, detail.student_uuid, {
        gentle_feedback: draftFeedback.trim(),
        teacher_note: draftNote.trim(),
      });
      setEditing(false);
      await loadDetail(detail.student_uuid);
      toast('已保存');
    } catch (e: any) {
      toast(e?.message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const doSend = async () => {
    if (busy || !detail) return;
    if (!window.confirm(
      `把这段温和版反馈发送给「${detail.student_name || '该学生'}」？\n\n发送后，该生用作业码进入提交页即可看到。诊断内容与参考答案不会下发。`,
    )) return;
    setBusy(true);
    try {
      await sendStudentRemediation(aid, detail.student_uuid);
      await Promise.all([loadList(), loadDetail(detail.student_uuid)]);
      toast('已发送');
    } catch (e: any) {
      toast(e?.message || '发送失败');
    } finally {
      setBusy(false);
    }
  };

  const statusChip = (s: RemediationListItem) => {
    if (!s.has_submitted) return <span className="text-[11px] text-gray-400">未提交</span>;
    if (s.sent) return <span className="text-[11px] text-green-600">已发送</span>;
    if (s.generation_status === 'done') return <span className="text-[11px] text-amber-700">待发送</span>;
    if (s.generation_status === 'generating') return <span className="text-[11px] text-blue-500">生成中…</span>;
    if (s.generation_status === 'failed') return <span className="text-[11px] text-red-500">生成失败</span>;
    return <span className="text-[11px] text-gray-400">未生成</span>;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
        <Loader2 size={20} className="animate-spin mx-auto mb-2" />
        <p className="text-sm">加载学生列表…</p>
      </div>
    );
  }

  const weakDims = detail?.diagnosis?.weak_dimensions ?? [];
  const strengths = detail?.diagnosis?.strengths ?? [];
  const questions = detail?.questions ?? [];

  return (
    <div className="space-y-3">
      {!reportConfirmed && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          请先在「报告编辑」页签确认整份讲评报告，再为学生生成补救建议（个人诊断要以已确认的班级分析为基准）。
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 左：学生列表 */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">学生</span>
            <span className="text-[11px] text-gray-400">
              已发送 {students.filter(s => s.sent).length}/{students.filter(s => s.has_submitted).length}
            </span>
          </div>
          <div className="max-h-[520px] overflow-y-auto divide-y divide-gray-50">
            {students.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">还没有学生提交</p>
            ) : (
              students.map((s, i) => (
                <button
                  key={s.student_uuid || `name-${i}`}
                  onClick={() => s.has_submitted && pickStudent(s.student_uuid)}
                  disabled={!s.has_submitted}
                  className={`w-full text-left px-4 py-2.5 transition-colors ${
                    selected === s.student_uuid && s.has_submitted
                      ? 'bg-amber-50'
                      : s.has_submitted ? 'hover:bg-gray-50' : 'opacity-50 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-800 truncate">
                      {s.student_name || '（未填姓名）'}
                    </span>
                    {statusChip(s)}
                  </div>
                  {s.has_submitted && s.question_count > 0 && (
                    <span className="text-[11px] text-gray-400">补救题 {s.question_count} 道</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* 右：详情 */}
        <div className="md:col-span-2 bg-white rounded-xl border border-gray-100 p-5">
          {!selected ? (
            <div className="text-center text-gray-400 py-16 text-sm">
              从左侧选一位已提交的学生，为他生成补救建议
            </div>
          ) : detailLoading ? (
            <div className="text-center text-gray-400 py-16">
              <Loader2 size={20} className="animate-spin mx-auto mb-2" />
              <p className="text-sm">加载中…</p>
            </div>
          ) : !detail ? (
            <div className="text-center py-14 space-y-4">
              <p className="text-sm text-gray-500">这位学生还没有补救建议</p>
              <button
                onClick={() => doGenerate(selected)}
                disabled={!reportConfirmed || !!generatingUUID}
                className="px-5 py-2.5 bg-amber-700 text-white text-sm rounded-xl
                           hover:bg-amber-800 disabled:opacity-40 inline-flex items-center gap-2"
              >
                {generatingUUID === selected
                  ? <><Loader2 size={15} className="animate-spin" /> 生成中…</>
                  : <><Sparkles size={15} /> 生成补救建议</>}
              </button>
              {!reportConfirmed && (
                <p className="text-xs text-gray-400">需先确认讲评报告</p>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {/* 头部 */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">
                    {detail.student_name || '（未填姓名）'}
                  </h3>
                  {detail.teacher_summary && (
                    <p className="text-xs text-gray-500 mt-1">{detail.teacher_summary}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => doGenerate(detail.student_uuid)}
                    disabled={!!generatingUUID || !reportConfirmed}
                    className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg
                               text-gray-600 hover:bg-gray-50 disabled:opacity-40
                               inline-flex items-center gap-1.5"
                  >
                    {generatingUUID === detail.student_uuid
                      ? <><Loader2 size={13} className="animate-spin" /> 生成中</>
                      : <><RefreshCw size={13} /> 重新生成</>}
                  </button>
                  <button
                    onClick={doSend}
                    disabled={busy || detail.generation_status !== 'done'}
                    className="px-3 py-1.5 text-xs bg-amber-700 text-white rounded-lg
                               hover:bg-amber-800 disabled:opacity-40 inline-flex items-center gap-1.5"
                  >
                    <Check size={13} /> {detail.sent ? '重新发送' : '发送给学生'}
                  </button>
                </div>
              </div>

              {detail.sent && (
                <p className="text-[11px] text-green-600">
                  已于 {detail.sent_at?.slice(0, 19).replace('T', ' ')} 发送
                </p>
              )}
              {detail.generation_status === 'failed' && detail.last_error && (
                <p className="text-xs text-red-500 bg-red-50 rounded px-3 py-2">
                  上次生成失败：{detail.last_error}
                </p>
              )}

              {/* 教师版诊断（不下发学生）*/}
              <div className="border border-gray-100 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ClipboardList size={14} className="text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">教师版诊断</span>
                  <span className="text-[11px] text-gray-400">（仅你可见，不发给学生）</span>
                </div>
                {weakDims.length === 0 ? (
                  <p className="text-xs text-gray-400">本次未产出结构化诊断</p>
                ) : (
                  weakDims.map((d, i) => (
                    <div key={i} className="text-xs space-y-1 bg-gray-50 rounded-lg px-3 py-2">
                      <div className="font-medium text-gray-700">
                        {d.dimension_name || `维度${i + 1}`}
                        {d.error_cause && (
                          <span className="ml-2 text-amber-700">错因：{d.error_cause}</span>
                        )}
                      </div>
                      {d.issue && <p className="text-gray-600">{d.issue}</p>}
                      {d.evidence && (
                        <p className="text-gray-400">原文佐证：「{d.evidence}」</p>
                      )}
                    </div>
                  ))
                )}
                {strengths.length > 0 && (
                  <p className="text-xs text-gray-500">
                    亮点：{strengths.join('；')}
                  </p>
                )}
              </div>

              {/* 温和版反馈（学生可见）*/}
              <div className="border border-amber-200 bg-amber-50/40 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Star size={14} className="text-amber-600" />
                    <span className="text-sm font-medium text-gray-700">温和版反馈</span>
                    <span className="text-[11px] text-gray-400">（发送后学生可见）</span>
                  </div>
                  {!editing ? (
                    <button
                      onClick={() => setEditing(true)}
                      className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
                    >
                      <Pencil size={12} /> 编辑
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={saveFeedback}
                        disabled={busy}
                        className="text-xs text-amber-700 hover:text-amber-900 inline-flex items-center gap-1"
                      >
                        <Check size={12} /> 保存
                      </button>
                      <button
                        onClick={() => {
                          setEditing(false);
                          setDraftFeedback(detail.gentle_feedback ?? '');
                          setDraftNote(detail.teacher_note ?? '');
                        }}
                        className="text-xs text-gray-400 hover:text-gray-600 inline-flex items-center gap-1"
                      >
                        <X size={12} /> 取消
                      </button>
                    </div>
                  )}
                </div>

                {editing ? (
                  <>
                    <textarea
                      value={draftFeedback}
                      onChange={e => setDraftFeedback(e.target.value)}
                      rows={7}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2
                                 focus:outline-none focus:ring-2 focus:ring-amber-200"
                      placeholder="写给这位学生本人看的话"
                    />
                    <textarea
                      value={draftNote}
                      onChange={e => setDraftNote(e.target.value)}
                      rows={2}
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2
                                 focus:outline-none focus:ring-2 focus:ring-amber-200"
                      placeholder="教师备注（仅你可见，不发给学生）"
                    />
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {detail.gentle_feedback || '（暂无）'}
                    </p>
                    {detail.teacher_note && (
                      <p className="text-xs text-gray-400 border-t border-amber-100 pt-2">
                        备注：{detail.teacher_note}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* 补救题 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">
                    补救练习（{questions.length} 道）
                  </span>
                  <span className="text-[11px] text-gray-400">学生端只看到题面，不含答案</span>
                </div>
                {questions.length === 0 ? (
                  <p className="text-xs text-gray-400">本次未产出补救题</p>
                ) : (
                  questions.map((q, i) => {
                    const stem = (q.final_content?.stem ?? q.content?.stem ?? '').toString();
                    const options = (q.final_content?.options ?? q.content?.options ?? []) as string[];
                    return (
                      <div key={q.id} className="border border-gray-100 rounded-lg p-3 space-y-1.5">
                        <div className="text-xs text-gray-400">
                          第 {i + 1} 题 · {q.question_type || '未标注题型'} · {q.difficulty || '未标注难度'}
                        </div>
                        <p className="text-sm text-gray-800 whitespace-pre-wrap">{stem}</p>
                        {(options ?? []).length > 0 && (
                          <ul className="text-xs text-gray-600 space-y-0.5">
                            {(options ?? []).map((opt, j) => (
                              <li key={j}>{String.fromCharCode(65 + j)}. {opt}</li>
                            ))}
                          </ul>
                        )}
                        {q.answer?.answer && (
                          <p className="text-xs text-gray-500">参考答案：{q.answer.answer}</p>
                        )}
                        {q.explanation && (
                          <p className="text-xs text-gray-400">解析：{q.explanation}</p>
                        )}
                        {q.recommendation_reason && (
                          <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1">
                            推荐理由：{q.recommendation_reason}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* 学生提交原文（对照用）*/}
              {detail.submission_text && (
                <details className="border border-gray-100 rounded-xl p-3">
                  <summary className="text-xs text-gray-500 cursor-pointer">
                    查看该生提交原文
                  </summary>
                  <p className="text-xs text-gray-600 whitespace-pre-wrap mt-2 leading-relaxed">
                    {detail.submission_text}
                  </p>
                </details>
              )}

              <p className="text-[11px] text-gray-400 text-center">
                AI 生成的诊断与反馈仅供参考，发送前请通读一遍温和版措辞。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ===== 主页面 =====
const AssignmentDetailPage: React.FC = () => {
  const { id: aid } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // ===== 基础数据 =====
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [materials, setMaterials] = useState<AssignmentMaterial[]>([]);
  const [rubric, setRubric] = useState<AssignmentRubric | null>(null);
  const [submissions, setSubmissions] = useState<AssignmentSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [activeTab, setActiveTab] = useState<'materials' | 'rubric' | 'submissions' | 'tokens' | 'lecture'>('materials');
  // ===== 讲评报告二级页签（REQ-039 第一期）=====
  const [lectureSubTab, setLectureSubTab] = useState<'analysis' | 'report' | 'recommend' | 'remediation'>('analysis');
  // ===== 讲评分析生成（REQ-039 第二期）=====
  const [lectureReport, setLectureReport] = useState<LectureReport | null>(null);
  const [lectureBusy, setLectureBusy] = useState(false);
  const lecturePollRef = useRef<number | null>(null);

  // ===== 材料状态 =====
  const [uploading, setUploading] = useState(false);
  const [uploadRole, setUploadRole] = useState('instruction');
  const [showTextForm, setShowTextForm] = useState(false);
  const [textContent, setTextContent] = useState('');
  const [textName, setTextName] = useState('');
  const [textRole, setTextRole] = useState('instruction');
  const [savingText, setSavingText] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showMarkdown, setShowMarkdown] = useState<string | null>(null);

  // ===== Rubric状态 =====
  const [generatingRubric, setGeneratingRubric] = useState(false);
  const [editingRubric, setEditingRubric] = useState(false);
  const [editCriteria, setEditCriteria] = useState<RubricCriterion[]>([]);
  const [savingRubric, setSavingRubric] = useState(false);

  // ===== 作业码状态 =====
  const [tokens, setTokens] = useState<AssignmentToken[]>([]);
  const [rosterSummary, setRosterSummary] = useState<RosterSummary | null>(null);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [generatingTokens, setGeneratingTokens] = useState(false);
  const [tokenType, setTokenType] = useState<'universal' | 'dedicated'>('universal');
  const [tokenCount, setTokenCount] = useState(5);
  const [expireDays, setExpireDays] = useState(7);
  const [showGenForm, setShowGenForm] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');
  const [addingRoster, setAddingRoster] = useState(false);
  const rosterCsvRef = useRef<HTMLInputElement>(null);
  const [importingCSV, setImportingCSV] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ===== Toast =====
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // ===== 加载基础数据 =====
  const loadAll = useCallback(async () => {
    if (!aid) return;
    setLoading(true);
    try {
      const [aRes, mRes, sRes] = await Promise.all([
        getAssignment(aid),
        listMaterials(aid),
        listSubmissions(aid),
      ]);
      setAssignment(aRes.assignment);
      setMaterials(mRes.materials || []);
      setSubmissions(sRes.submissions || []);
      try {
        const rRes = await getRubric(aid);
        // 防护criteria_json为null导致JSON.parse崩溃
        const safeRubric = rRes.rubric ? {
          ...rRes.rubric,
          criteria_json: rRes.rubric.criteria_json || '[]',
        } : null;
        setRubric(safeRubric);
      } catch {
        setRubric(null);
      }
    } catch (e: any) {
      console.error('loadAll失败详情:', e);
      showToast('加载失败：' + e.message);
    } finally {
      setLoading(false);
    }
  }, [aid]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ===== 加载作业码和花名册 =====
  const loadTokensAndRoster = useCallback(async () => {
    if (!aid) return;
    setLoadingTokens(true);
    try {
      const [tokRes, rosterRes] = await Promise.all([
        listTokens(aid),
        getRoster(aid),
      ]);
      setTokens(Array.isArray(tokRes.tokens) ? tokRes.tokens : []);
      setRosterSummary({
        ...rosterRes,
        roster: Array.isArray(rosterRes.roster) ? rosterRes.roster : [],
      });
    } catch (e: any) {
      showToast('加载作业码失败：' + e.message);
    } finally {
      setLoadingTokens(false);
    }
  }, [aid]);

  // 切换到作业码Tab时加载
  useEffect(() => {
    if (activeTab === 'tokens' || activeTab === 'lecture') {
      loadTokensAndRoster();
    }
  }, [activeTab, loadTokensAndRoster]);

  // ===== 讲评分析：加载已有报告 + 生成 + 轮询（REQ-039 第二期）=====
  const loadLectureReport = useCallback(async (): Promise<LectureReport | null> => {
    if (!aid) return null;
    try {
      const { report } = await getLectureReport(aid);
      setLectureReport(report);
      return report;
    } catch {
      return null;
    }
  }, [aid]);

  const stopLecturePoll = () => {
    if (lecturePollRef.current) {
      window.clearInterval(lecturePollRef.current);
      lecturePollRef.current = null;
    }
  };

  // 进入讲评报告 Tab 时拉一次已有报告
  useEffect(() => {
    if (activeTab === 'lecture') loadLectureReport();
  }, [activeTab, loadLectureReport]);

  // 报告处于 analyzing 时自动轮询（覆盖首次生成 + 刷新页面续接）
  useEffect(() => {
    if (lectureReport?.generation_status === 'analyzing' && !lecturePollRef.current) {
      setLectureBusy(true);
      lecturePollRef.current = window.setInterval(async () => {
        const report = await loadLectureReport();
        const gs = report?.generation_status;
        if (gs === 'done' || gs === 'failed') {
          stopLecturePoll();
          setLectureBusy(false);
          showToast(gs === 'done' ? '讲评分析已生成' : '生成失败：' + (report?.last_error || '请重试'));
        }
      }, 2500);
    }
  }, [lectureReport, loadLectureReport]);

  // 卸载时清理轮询
  useEffect(() => () => { stopLecturePoll(); }, []);

  const handleGenerateLecture = useCallback(async () => {
    if (!aid || lectureBusy) return;
    setLectureBusy(true);
    try {
      await startLectureAnalyze(aid);
      // 立即置 analyzing，交给上面的 useEffect 接管轮询
      setLectureReport(prev => prev
        ? { ...prev, generation_status: 'analyzing', last_error: '' }
        : ({ generation_status: 'analyzing', blocks: [] } as unknown as LectureReport));
    } catch (e: any) {
      setLectureBusy(false);
      showToast('发起分析失败：' + e.message);
    }
  }, [aid, lectureBusy]);

  // ===== 轮询解析状态 =====
  useEffect(() => {
    const hasPending = materials.some(
      m => m.parse_status === 'pending' || m.parse_status === 'parsing'
    );
    if (!hasPending) return;
    const timer = setInterval(async () => {
      if (!aid) return;
      try {
        const mRes = await listMaterials(aid);
        setMaterials(mRes.materials || []);
      } catch {}
    }, 3000);
    return () => clearInterval(timer);
  }, [materials, aid]);

  // ===== 状态切换 =====
  const handleStatusChange = async (newStatus: string) => {
    if (!aid) return;
    try {
      await updateAssignmentStatus(aid, newStatus);
      setAssignment(prev => prev ? { ...prev, status: newStatus as any } : null);
      showToast('状态已更新');
    } catch (e: any) {
      showToast('更新失败：' + e.message);
    }
  };

  // ===== 文件上传 =====
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !aid) return;
    setUploading(true);
    try {
      await uploadMaterialFile(aid, file, uploadRole);
      showToast(`「${file.name}」上传成功，正在解析...`);
      const mRes = await listMaterials(aid);
      setMaterials(mRes.materials || []);
    } catch (e: any) {
      showToast('上传失败：' + e.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ===== 添加文字材料 =====
  const handleAddText = async () => {
    if (!aid || !textContent.trim()) return;
    setSavingText(true);
    try {
      await addTextMaterial(aid, {
        material_role: textRole,
        content_text: textContent.trim(),
        original_name: textName.trim() || '文字材料',
      });
      setShowTextForm(false);
      setTextContent('');
      setTextName('');
      showToast('材料已添加');
      const mRes = await listMaterials(aid);
      setMaterials(mRes.materials || []);
    } catch (e: any) {
      showToast('添加失败：' + e.message);
    } finally {
      setSavingText(false);
    }
  };

  // ===== 删除材料 =====
  const handleDeleteMaterial = async (mid: string, name: string) => {
    if (!aid || !confirm(`删除材料「${name}」？`)) return;
    try {
      await deleteMaterial(aid, mid);
      setMaterials(prev => prev.filter(m => m.id !== mid));
      showToast('材料已删除');
    } catch (e: any) {
      showToast('删除失败：' + e.message);
    }
  };

  // ===== 重新解析 =====
  const handleReparse = async (mid: string) => {
    if (!aid) return;
    try {
      await reparseMaterial(aid, mid);
      setMaterials(prev => prev.map(m =>
        m.id === mid ? { ...m, parse_status: 'parsing' } : m
      ));
      showToast('已触发重新解析');
    } catch (e: any) {
      showToast('触发失败：' + e.message);
    }
  };

  // ===== 生成Rubric =====
  const handleGenerateRubric = async () => {
    if (!aid) return;
    setGeneratingRubric(true);
    try {
      const res = await generateRubric(aid);
      setRubric(res.rubric);
      try {
        const parsed = JSON.parse(res.rubric.criteria_json);
        setEditCriteria(Array.isArray(parsed) ? parsed : []);
      } catch { setEditCriteria([]); }
      setEditingRubric(true);
      showToast('已生成默认评分标准，请确认后保存');
    } catch (e: any) {
      showToast('生成失败：' + e.message);
    } finally {
      setGeneratingRubric(false);
    }
  };

  // ===== 确认Rubric =====
  const handleConfirmRubric = async () => {
    if (!aid || editCriteria.length === 0) return;
    setSavingRubric(true);
    try {
      const res = await confirmRubric(aid, { criteria: editCriteria, total_score: 100 });
      setRubric(res.rubric);
      setEditingRubric(false);
      showToast('评分标准已确认保存');
      loadAll();
    } catch (e: any) {
      showToast('保存失败：' + e.message);
    } finally {
      setSavingRubric(false);
    }
  };

  // ===== 生成作业码 =====
  const handleGenerateTokens = async () => {
    if (!aid) return;
    setGeneratingTokens(true);
    try {
      const res = await generateTokens(aid, {
        token_type: tokenType,
        count: tokenType === 'universal' ? tokenCount : undefined,
        expire_days: expireDays,
      });
      showToast(`成功生成 ${res.total_count} 个${tokenType === 'universal' ? '通用' : '专属'}作业码`);
      setShowGenForm(false);
      await loadTokensAndRoster();
    } catch (e: any) {
      showToast('生成失败：' + e.message);
    } finally {
      setGeneratingTokens(false);
    }
  };

  // ===== 复制作业码 =====
  const handleCopyToken = (tokenStr: string, id: string) => {
    copyText(tokenStr);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    showToast(`已复制：${tokenStr}`);
  };

  // ===== 手动添加花名册 =====
  const handleAddRoster = async () => {
    if (!aid || !newStudentName.trim()) return;
    setAddingRoster(true);
    try {
      await addRosterEntry(aid, newStudentName.trim());
      setNewStudentName('');
      showToast('已添加学生');
      await loadTokensAndRoster();
    } catch (e: any) {
      showToast('添加失败：' + e.message);
    } finally {
      setAddingRoster(false);
    }
  };

  // ===== CSV导入花名册 =====
  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !aid) return;
    setImportingCSV(true);
    try {
      const res = await importRosterCSVFile(aid, file);
      showToast(`已导入 ${res.imported} 位学生`);
      await loadTokensAndRoster();
    } catch (e: any) {
      showToast('导入失败：' + e.message);
    } finally {
      setImportingCSV(false);
      if (rosterCsvRef.current) rosterCsvRef.current.value = '';
    }
  };

  // ===== 典型错误插入画布（REQ-039 第三期 3d）=====
  // 把内容块的要点暂存后跳转到关联房间，由房间页在画布就绪时插入卡片。
  // 走前端插入链路（同 REQ-027 AI 图形），插入结果经既有场景同步自然落库，
  // 不直接改写服务端 room_scenes。
  const handleInsertBlockToCanvas = useCallback((block: LectureReportBlock) => {
    const roomId = (assignment as any)?.room_id as string | undefined;
    if (!roomId) {
      showToast('该作业未关联课堂房间，无法插入画布');
      return;
    }
    const c: any = block.content ?? {};
    const isOverview = block.block_type === 'overview';
    // 取「问题类」要点：概览取共性问题，维度块取典型问题
    const items: string[] = isOverview
      ? (Array.isArray(c.common_issues) ? c.common_issues : [])
      : (Array.isArray(c.common_problems) ? c.common_problems : []);
    const quotes: string[] = Array.isArray(c.example_quotes) ? c.example_quotes : [];
    if (items.length === 0 && quotes.length === 0) {
      showToast('该内容块没有可插入的典型问题要点');
      return;
    }
    const title = block.title || (isOverview ? '班级共性问题' : '典型问题');
    if (!stashCanvasInsert({ roomId, title, items, quotes })) {
      showToast('浏览器不支持暂存，无法插入画布');
      return;
    }
    navigate(`/room/${roomId}`);
  }, [assignment, navigate]);

  // ===== 从课堂同步花名册 =====
  const handleSyncFromClassroom = async () => {
    if (!aid || !(assignment as any)?.room_id) {
      showToast('该作业未关联课堂房间，无法同步');
      return;
    }
    try {
      const res = await syncRosterFromClassroom(aid!, (assignment as any).room_id as string);
      showToast(`已同步 ${res.synced} 位学生`);
      await loadTokensAndRoster();
    } catch (e: any) {
      showToast('同步失败：' + e.message);
    }
  };

  // ===== 删除花名册条目 =====
  const handleDeleteRoster = async (rid: string, name: string) => {
    if (!aid || !confirm(`从花名册移除「${name}」？`)) return;
    try {
      await deleteRosterEntry(aid, rid);
      showToast('已移除');
      await loadTokensAndRoster();
    } catch (e: any) {
      showToast('移除失败：' + e.message);
    }
  };

  // ===== 渲染Loading =====
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-amber-500" />
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto mb-4 opacity-30" />
          <p>作业不存在</p>
          <button onClick={() => navigate('/assignments')} className="mt-4 px-4 py-2 bg-amber-700 text-white rounded-lg text-sm">
            返回列表
          </button>
        </div>
      </div>
    );
  }

  const statusCfg = ASSIGNMENT_STATUS_LABELS[assignment.status];
  const parsedCriteria: RubricCriterion[] = (() => {
    if (!rubric || !rubric.criteria_json) return [];
    try {
      const parsed = JSON.parse(rubric.criteria_json);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  })();

  const nextStatusOptions: Record<string, { label: string; value: string }[]> = {
    draft:      [{ label: '开始收集', value: 'collecting' }],
    collecting: [{ label: '转为评审中', value: 'reviewing' }, { label: '关闭收集', value: 'closed' }],
    reviewing:  [{ label: '关闭', value: 'closed' }],
    closed:     [{ label: '重新开放收集', value: 'collecting' }],
  };

  // 作业码统计
  const usedCount = (tokens || []).filter(t => t.used_at).length;
  const unusedCount = (tokens || []).filter(t => !t.used_at && new Date(t.expires_at) > new Date()).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast提示 */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50
                        bg-amber-700 text-white text-sm px-5 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* 顶部标题栏 */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() => navigate('/assignments')}
              className="text-gray-400 hover:text-gray-600 flex items-center gap-1 text-sm"
            >
              <ArrowLeft size={16} /> 返回
            </button>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.bg} ${statusCfg.color}`}>
                  {statusCfg.label}
                </span>
                {rubric?.teacher_confirmed && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle size={10} /> 评分标准已确认
                  </span>
                )}
              </div>
              <h1 className="text-xl font-bold text-gray-900 truncate">{assignment.title}</h1>
              {assignment.description && (
                <p className="text-sm text-gray-400 mt-1">{assignment.description}</p>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {(nextStatusOptions[assignment.status] || []).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className="text-xs bg-amber-700 hover:bg-amber-800 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-4 mt-3 text-xs text-gray-400">
            <span>{materials.length} 份材料</span>
            <span>{submissions.length} 份提交</span>
            {rubric && <span>Rubric v{rubric.version}</span>}
            {tokens.length > 0 && <span>{tokens.length} 个作业码</span>}
            <span>创建于 {new Date(assignment.created_at).toLocaleDateString('zh-CN')}</span>
          </div>
        </div>
      </header>

      {/* Tab导航 — 新增「作业码」第四Tab */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="flex gap-0 overflow-x-auto">
            {[
              { key: 'materials',   label: '材料管理', icon: FileText, count: materials.length },
              { key: 'rubric',      label: '评分标准', icon: Star,     count: rubric ? rubric.version : 0 },
              { key: 'submissions', label: '学生提交', icon: Users,    count: submissions.length },
              { key: 'tokens',      label: '作业码',   icon: Key,      count: tokens.length },
              { key: 'lecture',     label: '讲评报告', icon: ClipboardList, count: 0 },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap
                           border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-amber-500 text-amber-700'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                <tab.icon size={14} />
                {tab.label}
                {tab.count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.key ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">

        {/* ===== 材料管理Tab ===== */}
        {activeTab === 'materials' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">材料类型</label>
                  <select
                    value={uploadRole}
                    onChange={e => setUploadRole(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
                  >
                    {Object.entries(MATERIAL_ROLE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v.icon} {v.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">上传文件</label>
                  <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden"
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.html,.csv,.jpg,.jpeg,.png,.gif,.webp,.zip" />
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm border border-dashed border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-50">
                    {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {uploading ? '上传中...' : '选择文件'}
                  </button>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">文字内容</label>
                  <button onClick={() => setShowTextForm(!showTextForm)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
                    <Plus size={14} />
                    添加文字材料
                  </button>
                </div>
              </div>
              {showTextForm && (
                <div className="mt-4 p-4 bg-gray-50 rounded-xl space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">标题</label>
                      <input type="text" value={textName} onChange={e => setTextName(e.target.value)}
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300"
                        placeholder="材料标题（选填）" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">类型</label>
                      <select value={textRole} onChange={e => setTextRole(e.target.value)}
                        className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300">
                        {Object.entries(MATERIAL_ROLE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <textarea value={textContent} onChange={e => setTextContent(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300"
                    placeholder="输入材料内容..." rows={4} />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowTextForm(false)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">取消</button>
                    <button onClick={handleAddText} disabled={savingText || !textContent.trim()}
                      className="text-sm bg-amber-700 hover:bg-amber-800 text-white px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                      {savingText ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-3">支持：PDF、Word、PPT、Excel、图片、TXT、HTML、CSV、ZIP（最大50MB）</p>
            </div>

            {materials.length === 0 ? (
              <div className="text-center py-12 text-gray-400 bg-white rounded-xl border border-gray-100">
                <FileText size={36} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">暂无材料，上传任务说明或评分标准来开始</p>
              </div>
            ) : (
              <div className="space-y-2">
                {materials.map(m => {
                  const roleCfg = MATERIAL_ROLE_LABELS[m.material_role as keyof typeof MATERIAL_ROLE_LABELS] || { label: m.material_role, icon: '📄' };
                  return (
                    <div key={m.id} className="bg-white rounded-xl border border-gray-100 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-base">{roleCfg.icon}</span>
                            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{roleCfg.label}</span>
                            <ParseBadge status={m.parse_status} />
                            {m.file_size > 0 && <span className="text-xs text-gray-400">{fmtSize(m.file_size)}</span>}
                          </div>
                          <p className="text-sm font-medium text-gray-800 truncate">{m.original_name}</p>
                          {m.parse_status === 'done' && (
                            <p className="text-xs text-gray-400 mt-1">
                              {m.char_count.toLocaleString()} 字符{m.parse_elapsed_ms > 0 && ` · ${m.parse_elapsed_ms}ms`}
                            </p>
                          )}
                          {m.parse_error && <p className="text-xs text-red-500 mt-1">解析失败：{m.parse_error}</p>}
                          {m.content_text && (
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2 bg-gray-50 rounded-lg px-2 py-1">{m.content_text}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {m.parse_status === 'done' && m.parsed_markdown && (
                            <button onClick={() => setShowMarkdown(showMarkdown === m.id ? null : m.id)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-amber-700 hover:bg-amber-50 transition-colors" title="查看解析内容">
                              <Eye size={14} />
                            </button>
                          )}
                          {(m.parse_status === 'failed' || m.parse_status === 'done') && m.file_path && (
                            <button onClick={() => handleReparse(m.id)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-amber-700 hover:bg-amber-50 transition-colors" title="重新解析">
                              <RefreshCw size={14} />
                            </button>
                          )}
                          <button onClick={() => handleDeleteMaterial(m.id, m.original_name)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="删除">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {showMarkdown === m.id && m.parsed_markdown && (
                        <div className="mt-3 p-3 bg-gray-50 rounded-xl text-xs text-gray-600 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto border border-gray-200">
                          {m.parsed_markdown.slice(0, 2000)}
                          {m.parsed_markdown.length > 2000 && <span className="text-gray-400">...（共{m.char_count}字符，已截断）</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ===== 评分标准Tab ===== */}
        {activeTab === 'rubric' && (
          <div className="space-y-4">
            {!rubric ? (
              <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
                <Star size={40} className="mx-auto mb-4 text-gray-200" />
                <p className="text-gray-500 mb-2">还没有评分标准</p>
                <p className="text-sm text-gray-400 mb-6">可以上传评分标准文件后自动提取，或直接生成默认6维度 Rubric</p>
                <button onClick={handleGenerateRubric} disabled={generatingRubric}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-700 hover:bg-amber-800 text-white rounded-xl text-sm transition-colors disabled:opacity-50">
                  {generatingRubric ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  {generatingRubric ? '生成中...' : '生成默认评分标准'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Star size={16} className="text-yellow-400" />
                      <span className="font-semibold text-gray-800">评分标准 v{rubric.version}</span>
                      <span className="text-xs text-gray-400">
                        {rubric.source === 'generated' ? '自动生成' : rubric.source === 'manual' ? '教师编辑' : '从材料提取'}
                      </span>
                      {rubric.teacher_confirmed && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle size={10} /> 已确认
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleGenerateRubric} disabled={generatingRubric}
                        className="text-xs text-gray-500 hover:text-amber-700 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-amber-50 transition-colors">
                        <RefreshCw size={12} /> 重新生成
                      </button>
                      <button onClick={() => { setEditCriteria(parsedCriteria); setEditingRubric(true); }}
                        className="text-xs bg-amber-700 hover:bg-amber-800 text-white px-3 py-1 rounded-lg transition-colors">
                        编辑确认
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">总分 {rubric.total_score} 分 · {parsedCriteria.length} 个评价维度</p>
                </div>
                {!editingRubric && (
                  <div className="space-y-2">
                    {parsedCriteria.map((c, i) => (
                      <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-gray-800 text-sm">{c.name}</span>
                          <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">权重 {c.weight}%</span>
                        </div>
                        <div className="flex gap-2">
                          {c.levels.map((lv, j) => (
                            <div key={j} className={`flex-1 rounded-lg p-2 text-xs ${
                              j === 0 ? 'bg-green-50 border border-green-100' : j === 1 ? 'bg-amber-50 border border-amber-100' : 'bg-gray-50 border border-gray-100'
                            }`}>
                              <div className="font-medium mb-0.5">{lv.label} ({lv.score}分)</div>
                              <div className="text-gray-500 leading-relaxed">{lv.desc}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {editingRubric && (
                  <div className="bg-white rounded-xl border border-amber-200 p-4 space-y-4">
                    <p className="text-sm font-medium text-amber-800 flex items-center gap-1">
                      <Star size={14} /> 编辑评分标准（确认后生效）
                    </p>
                    {editCriteria.map((c, i) => (
                      <div key={i} className="border border-gray-100 rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <input type="text" value={c.name}
                            onChange={e => { const nc = [...editCriteria]; nc[i] = { ...nc[i], name: e.target.value }; setEditCriteria(nc); }}
                            className="flex-1 text-sm font-medium border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300" />
                          <span className="text-xs text-gray-500">权重</span>
                          <input type="number" value={c.weight}
                            onChange={e => { const nc = [...editCriteria]; nc[i] = { ...nc[i], weight: Number(e.target.value) }; setEditCriteria(nc); }}
                            className="w-16 text-sm text-center border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300" />
                          <span className="text-xs text-gray-500">%</span>
                        </div>
                        {c.levels.map((lv, j) => (
                          <div key={j} className="flex gap-2 items-start">
                            <span className={`text-xs px-2 py-1 rounded-lg flex-shrink-0 ${
                              j === 0 ? 'bg-green-100 text-green-700' : j === 1 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'
                            }`}>{lv.label}({lv.score})</span>
                            <input type="text" value={lv.desc}
                              onChange={e => {
                                const nc = [...editCriteria];
                                const nl = [...nc[i].levels];
                                nl[j] = { ...nl[j], desc: e.target.value };
                                nc[i] = { ...nc[i], levels: nl };
                                setEditCriteria(nc);
                              }}
                              className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300" />
                          </div>
                        ))}
                      </div>
                    ))}
                    <div className="flex justify-end gap-3">
                      <button onClick={() => setEditingRubric(false)} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">取消</button>
                      <button onClick={handleConfirmRubric} disabled={savingRubric}
                        className="text-sm bg-green-500 hover:bg-green-600 text-white px-5 py-2 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2">
                        {savingRubric ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                        {savingRubric ? '保存中...' : '确认评分标准'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== 学生提交Tab ===== */}
        {activeTab === 'submissions' && (
          <div className="space-y-3">
            {submissions.length === 0 ? (
              <div className="text-center py-12 text-gray-400 bg-white rounded-xl border border-gray-100">
                <Users size={36} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">暂无学生提交</p>
                {assignment.status === 'draft' && (
                  <p className="text-xs mt-2 text-orange-400">请先将状态切换为「收集中」</p>
                )}
              </div>
            ) : (
              submissions.map(sub => (
                <div key={sub.id} className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-800 text-sm">
                          {sub.student_name || sub.student_uuid.slice(0, 8)}
                        </span>
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">v{sub.version}</span>
                        <span className="text-xs text-gray-400">
                          {sub.content_type === 'text' ? '📝 文字' : sub.content_type === 'file' ? '📎 文件' : sub.content_type === 'link' ? '🔗 链接' : '📦 混合'}
                        </span>
                      </div>
                      {sub.content_text && (
                        <p className="text-sm text-gray-600 line-clamp-2 bg-gray-50 rounded-lg px-3 py-2 mt-1">{sub.content_text}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-2">提交于 {new Date(sub.submitted_at).toLocaleString('zh-CN')}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ===== 作业码Tab（Phase8-v2新增）===== */}
        {activeTab === 'tokens' && (
          <div className="space-y-4">

            {/* 统计卡片行 */}
            {tokens.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-800">{tokens.length}</p>
                  <p className="text-xs text-gray-400 mt-1">作业码总数</p>
                </div>
                <div className="bg-white rounded-xl border border-green-100 p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{usedCount}</p>
                  <p className="text-xs text-gray-400 mt-1">已使用</p>
                </div>
                <div className="bg-white rounded-xl border border-amber-100 p-4 text-center">
                  <p className="text-2xl font-bold text-amber-700">{unusedCount}</p>
                  <p className="text-xs text-gray-400 mt-1">待使用</p>
                </div>
              </div>
            )}

            {/* 操作区：生成作业码 + 导出 */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Key size={14} className="text-amber-700" />
                  生成作业码
                </h3>
                <div className="flex gap-2">
                  {tokens.length > 0 && (
                    <button
                      onClick={() => exportTokensCSV(aid!)}
                      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-600 border border-gray-200 hover:border-green-300 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Download size={12} /> 导出CSV
                    </button>
                  )}
                  <button
                    onClick={() => setShowGenForm(!showGenForm)}
                    className="flex items-center gap-1.5 text-xs bg-amber-700 hover:bg-amber-800 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Plus size={12} /> 生成新作业码
                  </button>
                </div>
              </div>

              {/* 生成表单 */}
              {showGenForm && (
                <div className="mt-3 p-4 bg-gray-50 rounded-xl space-y-3 border border-gray-200">
                  {/* 码类型 */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-2">作业码类型</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setTokenType('universal')}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs border transition-colors ${
                          tokenType === 'universal'
                            ? 'bg-amber-700 text-white border-amber-700'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300'
                        }`}
                      >
                        通用码
                        <span className="block text-opacity-70 mt-0.5 font-normal">
                          {tokenType === 'universal' ? '任何学生可用，填写姓名' : '任何学生可用'}
                        </span>
                      </button>
                      <button
                        onClick={() => setTokenType('dedicated')}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs border transition-colors ${
                          tokenType === 'dedicated'
                            ? 'bg-amber-700 text-white border-amber-700'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300'
                        }`}
                      >
                        专属码
                        <span className="block text-opacity-70 mt-0.5 font-normal">
                          {tokenType === 'dedicated' ? '一人一码，绑定课堂身份' : '一人一码'}
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    {/* 通用码数量 */}
                    {tokenType === 'universal' && (
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">生成数量</label>
                        <input
                          type="number"
                          value={tokenCount}
                          onChange={e => setTokenCount(Math.max(1, Math.min(100, Number(e.target.value))))}
                          min={1} max={100}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
                        />
                        <p className="text-xs text-gray-400 mt-1">最多100个</p>
                      </div>
                    )}
                    {tokenType === 'dedicated' && (
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">专属码来源</label>
                        <p className="text-xs text-gray-500 bg-white border border-gray-200 rounded-lg px-3 py-2">
                          将为花名册中的每位学生生成一个专属码
                        </p>
                      </div>
                    )}
                    {/* 有效期 */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">有效天数</label>
                      <select
                        value={expireDays}
                        onChange={e => setExpireDays(Number(e.target.value))}
                        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
                      >
                        <option value={1}>1天</option>
                        <option value={3}>3天</option>
                        <option value={7}>7天</option>
                        <option value={14}>14天</option>
                        <option value={30}>30天</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowGenForm(false)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">取消</button>
                    <button
                      onClick={handleGenerateTokens}
                      disabled={generatingTokens}
                      className="text-sm bg-amber-700 hover:bg-amber-800 text-white px-5 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {generatingTokens ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
                      {generatingTokens ? '生成中...' : '确认生成'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 作业码列表 */}
            {loadingTokens ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="animate-spin text-amber-500" />
              </div>
            ) : tokens.length === 0 ? (
              <div className="text-center py-12 text-gray-400 bg-white rounded-xl border border-gray-100">
                <Key size={36} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">还没有作业码</p>
                <p className="text-xs mt-1">点击「生成新作业码」开始</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">作业码列表（共 {tokens.length} 个）</span>
                  <span className="text-xs text-gray-400">学生访问：mindcanvas.com.cn/submit</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {tokens.map(tok => (
                    <div key={tok.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                      {/* 码值（等宽字体） */}
                      <code className="text-base font-mono font-bold text-gray-800 tracking-widest flex-shrink-0 w-28">
                        {tok.token}
                      </code>
                      {/* 类型 */}
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {tok.token_type === 'universal' ? '通用' : '专属'}
                      </span>
                      {/* 绑定学生（专属码） */}
                      {tok.student_name && (
                        <span className="text-xs text-gray-600 flex-1 truncate">{tok.student_name}</span>
                      )}
                      {!tok.student_name && <span className="flex-1" />}
                      {/* 状态徽章 */}
                      <TokenBadge token={tok} />
                      {/* 过期时间 */}
                      <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:block">
                        {new Date(tok.expires_at).toLocaleDateString('zh-CN')} 到期
                      </span>
                      {/* 复制按钮 */}
                      <button
                        onClick={() => handleCopyToken(tok.token, tok.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-amber-700 hover:bg-amber-50 transition-colors flex-shrink-0"
                        title="复制作业码"
                      >
                        {copiedId === tok.id ? <CheckCircle size={14} className="text-green-500" /> : <Copy size={14} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 花名册管理 */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Users size={14} className="text-amber-600" />
                  花名册
                  {rosterSummary && (
                    <span className="text-xs text-gray-400 font-normal">
                      {rosterSummary.total_submitted}/{rosterSummary.total_expected} 已提交
                      （{rosterSummary.submit_rate.toFixed(0)}%）
                    </span>
                  )}
                </h3>
                <div className="flex gap-2">
                  {/* 从课堂同步 */}
                  {assignment.room_id && (
                    <button
                      onClick={handleSyncFromClassroom}
                      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-amber-700 border border-gray-200 hover:border-amber-300 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <RefreshCw size={12} /> 从课堂同步
                    </button>
                  )}
                  {/* CSV导入 */}
                  <input ref={rosterCsvRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleImportCSV} />
                  <button
                    onClick={() => rosterCsvRef.current?.click()}
                    disabled={importingCSV}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-amber-700 border border-gray-200 hover:border-amber-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {importingCSV ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    导入CSV
                  </button>
                </div>
              </div>

              {/* 手动添加一行 */}
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={newStudentName}
                  onChange={e => setNewStudentName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddRoster(); }}
                  placeholder="输入学生姓名，回车添加"
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
                <button
                  onClick={handleAddRoster}
                  disabled={addingRoster || !newStudentName.trim()}
                  className="text-sm bg-amber-700 hover:bg-amber-800 text-white px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {addingRoster ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  添加
                </button>
              </div>

              {/* 花名册列表 */}
              {!rosterSummary || !(rosterSummary.roster?.length) ? (
                <div className="text-center py-6 text-gray-400">
                  <p className="text-xs">花名册为空，可手动添加、导入CSV或从课堂同步</p>
                </div>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {(rosterSummary.roster || []).map(r => (
                    <div key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
                      {/* 提交状态图标 */}
                      {r.has_submitted
                        ? <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                        : <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 flex-shrink-0" />
                      }
                      {/* 姓名 */}
                      <span className="text-sm text-gray-700 flex-1">{r.student_name}</span>
                      {/* 专属码（如有） */}
                      {r.token && (
                        <code className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                          {r.token}
                        </code>
                      )}
                      {/* 提交时间 */}
                      {r.submitted_at && (
                        <span className="text-xs text-gray-400 hidden sm:block">
                          {new Date(r.submitted_at).toLocaleDateString('zh-CN')}
                        </span>
                      )}
                      {/* 评价状态 */}
                      {r.assess_status && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          r.assess_status === 'published' ? 'bg-green-100 text-green-700'
                          : r.assess_status === 'teacher_confirmed' ? 'bg-amber-100 text-amber-800'
                          : 'bg-gray-100 text-gray-500'
                        }`}>
                          {r.assess_status === 'published' ? '已发布'
                            : r.assess_status === 'teacher_confirmed' ? '已确认'
                            : r.assess_status === 'ai_done' ? 'AI已评'
                            : '待评'}
                        </span>
                      )}
                      {/* 删除 */}
                      <button
                        onClick={() => handleDeleteRoster(r.id, r.student_name)}
                        className="p-1 rounded text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0"
                        title="移除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 学生提交链接提示 */}
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
              <p className="text-xs font-medium text-amber-800 mb-1">📋 学生提交入口</p>
              <p className="text-xs text-amber-700 mb-2">将以下链接或作业码发给学生，学生无需注册即可提交：</p>
              <div className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2">
                <code className="text-xs text-gray-700 flex-1">https://mindcanvas.com.cn/submit</code>
                <button
                  onClick={() => { copyText('https://mindcanvas.com.cn/submit'); showToast('链接已复制'); }}
                  className="text-xs text-amber-700 hover:text-amber-800 flex items-center gap-1"
                >
                  <Copy size={12} /> 复制
                </button>
              </div>
            </div>

          </div>
        )}

        {/* ===== 讲评报告Tab（REQ-039 第一期·数据视图，不调AI）===== */}
        {activeTab === 'lecture' && (
          <div className="space-y-4">
            {/* 二级页签 */}
            <div className="flex gap-1 bg-white rounded-xl border border-gray-100 p-1">
              {[
                { key: 'analysis',    label: '班级分析' },
                { key: 'report',      label: '报告编辑' },
                { key: 'recommend',   label: '推荐练习' },
                { key: 'remediation', label: '学生补救' },
              ].map(st => (
                <button
                  key={st.key}
                  onClick={() => setLectureSubTab(st.key as any)}
                  className={`flex-1 text-sm py-2 rounded-lg transition-colors ${
                    lectureSubTab === st.key
                      ? 'bg-amber-100 text-amber-800 font-medium'
                      : 'text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {/* --- 班级分析（真实数据视图）--- */}
            {lectureSubTab === 'analysis' && (() => {
              let criteria: RubricCriterion[] = [];
              if (rubric?.criteria_json) {
                try { criteria = JSON.parse(rubric.criteria_json); } catch { criteria = []; }
              }
              const expected = rosterSummary?.total_expected ?? 0;
              const submitted = rosterSummary?.total_submitted ?? submissions.length;
              const submitRate = rosterSummary?.submit_rate
                ?? (expected > 0 ? (submitted / expected) * 100 : 0);
              return (
                <div className="space-y-4">
                  {/* 任务概览 */}
                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">任务概览</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="text-center p-3 bg-gray-50 rounded-lg">
                        <div className="text-2xl font-bold text-gray-800">{expected}</div>
                        <div className="text-xs text-gray-500 mt-1">花名册人数</div>
                      </div>
                      <div className="text-center p-3 bg-gray-50 rounded-lg">
                        <div className="text-2xl font-bold text-gray-800">{submitted}</div>
                        <div className="text-xs text-gray-500 mt-1">已提交</div>
                      </div>
                      <div className="text-center p-3 bg-gray-50 rounded-lg">
                        <div className="text-2xl font-bold text-gray-800">{submitRate.toFixed(0)}%</div>
                        <div className="text-xs text-gray-500 mt-1">提交率</div>
                      </div>
                      <div className="text-center p-3 bg-gray-50 rounded-lg">
                        <div className="text-2xl font-bold text-gray-800">{criteria.length}</div>
                        <div className="text-xs text-gray-500 mt-1">评价维度</div>
                      </div>
                    </div>
                  </div>

                  {/* Rubric 维度 */}
                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">评价维度（来自 Rubric）</h3>
                    {criteria.length === 0 ? (
                      <div className="text-center py-6 text-gray-400 text-xs">
                        尚未生成评分标准，请先到「评分标准」Tab 生成并确认 Rubric
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {criteria.map((c, i) => (
                          <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                            <span className="text-sm text-gray-700">{c.name}</span>
                            <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">权重 {c.weight}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 提交原文预览 */}
                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">学生提交预览（{submissions.length}）</h3>
                    {submissions.length === 0 ? (
                      <div className="text-center py-6 text-gray-400 text-xs">暂无学生提交</div>
                    ) : (
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {submissions.map(s => (
                          <div key={s.id} className="px-3 py-2 bg-gray-50 rounded-lg">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-gray-700">{s.student_name}</span>
                              <span className="text-xs text-gray-400">
                                {new Date(s.submitted_at).toLocaleDateString('zh-CN')}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500">
                              {s.content_text ? s.content_text.slice(0, 160) : '（非文字提交）'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 讲评分析生成入口（REQ-039 第二期）*/}
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs text-amber-800 leading-relaxed flex-1">
                        基于上方 Rubric 维度与学生提交原文，由 AI 生成班级共性问题、维度研判与讲评重点。
                      </p>
                      <button
                        onClick={handleGenerateLecture}
                        disabled={lectureBusy || submissions.length === 0}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg text-white bg-amber-500 hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                        title={submissions.length === 0 ? '暂无学生提交，无法生成' : '基于 Rubric + 提交原文生成讲评分析'}
                      >
                        {lectureBusy
                          ? <><Loader2 size={14} className="animate-spin" />生成中…</>
                          : <><Sparkles size={14} />{lectureReport?.generation_status === 'done' ? '重新生成讲评分析' : '一键生成讲评分析'}</>}
                      </button>
                    </div>
                    {submissions.length === 0 && (
                      <p className="text-xs text-amber-600 mt-2">提示：需至少有一份学生文字提交才能生成。</p>
                    )}
                  </div>

                  {/* 生成中 */}
                  {lectureReport?.generation_status === 'analyzing' && (
                    <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
                      <Loader2 size={22} className="animate-spin mx-auto mb-2 text-amber-500" />
                      <p className="text-sm text-gray-500">正在生成讲评分析…约 1-3 分钟，可留在本页等待</p>
                    </div>
                  )}

                  {/* 生成失败 */}
                  {lectureReport?.generation_status === 'failed' && (
                    <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-start gap-2">
                      <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-red-600">
                        生成失败：{lectureReport.last_error || '未知错误'}。可点击上方「重新生成」重试。
                      </div>
                    </div>
                  )}

                  {/* 生成结果 */}
                  {lectureReport?.generation_status === 'done' && (
                    <div className="space-y-3">
                      {(lectureReport.blocks ?? []).map(block => {
                        const c = block.content || {};
                        if (block.block_type === 'overview') {
                          return (
                            <div key={block.id} className="bg-white rounded-xl border border-gray-100 p-4">
                              <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                                <ClipboardList size={14} className="text-amber-600" />班级总体概览
                              </h3>
                              {c.class_summary && <p className="text-sm text-gray-600 leading-relaxed mb-3">{c.class_summary}</p>}
                              <div className="grid sm:grid-cols-3 gap-3">
                                <LectureList title="亮点" items={c.strengths} color="green" />
                                <LectureList title="共性问题" items={c.common_issues} color="red" />
                                <LectureList title="讲评重点" items={c.priority_topics} color="amber" />
                              </div>
                            </div>
                          );
                        }
                        const ss = c.score_summary || {};
                        return (
                          <div key={block.id} className="bg-white rounded-xl border border-gray-100 p-4">
                            <div className="flex items-center justify-between mb-2">
                              <h3 className="text-sm font-semibold text-gray-700">{block.title || c.dimension_name || '维度分析'}</h3>
                              <span className="text-xs text-gray-400">
                                均分 {typeof ss.average === 'number' ? ss.average : '—'} · 低分 {ss.low_score_count ?? 0} 人
                              </span>
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3">
                              <LectureList title="典型问题" items={c.common_problems} color="red" />
                              <LectureList title="讲评要点" items={c.teacher_talking_points} color="amber" />
                            </div>
                            {(c.example_quotes ?? []).length > 0 && (
                              <div className="mt-3">
                                <p className="text-xs font-semibold text-gray-500 mb-1">学生原话样例</p>
                                <div className="space-y-1">
                                  {(c.example_quotes ?? []).map((q: string, i: number) => (
                                    <p key={i} className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1 italic">“{q}”</p>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <p className="text-[11px] text-gray-400 text-center">AI 生成的讲评草稿，仅供参考；可切到「报告编辑」页签逐块修改、重新生成与确认。</p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* --- 报告编辑（REQ-039 第三期 3a）--- */}
            {lectureSubTab === 'report' && (
              <LectureReportEditor
                aid={aid || ''}
                report={lectureReport}
                reload={loadLectureReport}
                toast={showToast}
                assignmentTitle={assignment?.title || '作业'}
                roomId={(assignment as any)?.room_id || null}
                onInsertToCanvas={handleInsertBlockToCanvas}
              />
            )}

            {/* --- 推荐练习（REQ-039 第三期 3b）--- */}
            {lectureSubTab === 'recommend' && (
              <RecommendationPanel
                aid={aid || ''}
                reportConfirmed={lectureReport?.status === 'confirmed'}
                toast={showToast}
              />
            )}
            {/* --- 学生补救（REQ-039 第三期 3c）--- */}
            {lectureSubTab === 'remediation' && (
              <RemediationPanel
                aid={aid || ''}
                reportConfirmed={lectureReport?.status === 'confirmed'}
                toast={showToast}
              />
            )}
          </div>
        )}

      </main>
    </div>
  );
};

const WrappedAssignmentDetailPage: React.FC = () => (
  <ErrorBoundary>
    <AssignmentDetailPage />
  </ErrorBoundary>
);

export default WrappedAssignmentDetailPage;
