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
  Star, Eye, Download, Key, Copy, ClipboardList,
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
} from '@/utils/assignmentApi';
import {
  generateTokens, listTokens, exportTokensCSV,
  getRoster, addRosterEntry, importRosterCSVFile,
  syncRosterFromClassroom, deleteRosterEntry,
} from '@/utils/tokenApi';

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

                  {/* 现况说明 + 生成入口占位（第二期填实）*/}
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                    <p className="text-xs text-amber-800 leading-relaxed">
                      以上为本次作业的现有数据汇总。下一步「一键生成讲评分析」将基于 Rubric 维度与学生提交原文，由 AI 生成班级共性问题、维度研判与讲评重点（开发中）。
                    </p>
                    <button
                      disabled
                      className="mt-3 px-4 py-2 text-sm rounded-lg bg-gray-200 text-gray-400 cursor-not-allowed"
                      title="讲评分析生成功能开发中（第二期）"
                    >
                      一键生成讲评分析（开发中）
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* --- 其余三页签占位 --- */}
            {lectureSubTab === 'report' && (
              <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
                生成讲评分析后，可在此编辑报告内容块（第三期）
              </div>
            )}
            {lectureSubTab === 'recommend' && (
              <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
                基于讲评重点生成推荐练习题，支持采用/修改/发布为新作业（第四期）
              </div>
            )}
            {lectureSubTab === 'remediation' && (
              <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
                针对单个学生生成补救建议与温和版反馈（第五期）
              </div>
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
