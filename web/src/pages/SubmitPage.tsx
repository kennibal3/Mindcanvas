// =============================================================
// MindCanvas Phase8-v2 - 学生作业提交页
// 路由：/submit（完全公开，无需登录）
// 功能：输入作业码 → 验证 → 填写内容 → 提交 →（老师发送后）查看老师的反馈
// 特点：手机端友好，零登录门槛，支持身份续接
//
// REQ-039 3c（2026-07-19）：
//   - 新增 my_work 步骤：已提交过的学生再次凭码进来，先看到「我的作业 + 老师的反馈」
//     而不是直接跳到重新填写（原实现导致隔天回来根本没有入口看反馈）
//   - 「查看评价结果」原先查的是 assignment_assessments（历史死表、零行、必然报错），
//     改为查 3c 的补救反馈接口（token + uuid 双证，只返回温和版与题面）
// =============================================================
import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen, CheckCircle, AlertCircle, Loader2,
  Send, ChevronRight, User, FileText, RefreshCw,
  Star, Clock, ArrowLeft, Upload, Link, X, Paperclip,
} from 'lucide-react';
import { verifyToken, submitByToken, getStudentRemediation } from '@/utils/tokenApi';
import type {
  TokenVerifyResult, SubmitPageStep, StudentRemediationPublic,
} from '@/types/token';

// =============================================================
// 工具函数
// =============================================================

/** 保存学生UUID到LocalStorage（跨会话身份续接）*/
function saveStudentUUID(uuid: string, assignmentId: string) {
  try {
    localStorage.setItem(`submit_uuid_${assignmentId}`, uuid);
  } catch {}
}

/** 读取已保存的学生UUID */
function getSavedUUID(assignmentId: string): string {
  try {
    return localStorage.getItem(`submit_uuid_${assignmentId}`) || '';
  } catch {
    return '';
  }
}

// =============================================================
// 子组件：步骤进度指示器
// =============================================================
const StepDot = ({ active, done }: { active: boolean; done: boolean }) => (
  <div className={`w-2.5 h-2.5 rounded-full transition-all ${
    done ? 'bg-green-500' : active ? 'bg-amber-600 scale-125' : 'bg-gray-300'
  }`} />
);

// =============================================================
// 子组件：老师的反馈展示（REQ-039 3c 温和版 + 补救练习题面）
// =============================================================
const FeedbackCard = ({
  remediation,
  assignmentTitle,
}: {
  remediation: StudentRemediationPublic;
  assignmentTitle: string;
}) => {
  const questions = remediation.questions ?? [];

  return (
    <div className="space-y-4">
      {/* 老师的话 */}
      <div className="bg-gradient-to-br from-amber-600 to-amber-800 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-2 mb-3 text-amber-100 text-sm">
          <Star size={16} />
          老师的反馈
        </div>
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
          {remediation.gentle_feedback}
        </p>
        <div className="text-white/60 text-xs mt-4">{assignmentTitle}</div>
      </div>

      {/* 补救练习（只给题面，答案不下发）*/}
      {questions.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <FileText size={14} className="text-amber-600" />
            给你的练习（{questions.length} 道）
          </h3>
          {questions.map((q, i) => (
            <div key={i} className="border border-gray-100 rounded-xl p-3 space-y-1.5">
              <div className="text-xs text-gray-400">
                第 {i + 1} 题
                {q.question_type ? ` · ${q.question_type}` : ''}
                {q.difficulty ? ` · ${q.difficulty}` : ''}
              </div>
              <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{q.stem}</p>
              {(q.options ?? []).length > 0 && (
                <ul className="text-sm text-gray-600 space-y-1 pt-1">
                  {(q.options ?? []).map((opt, j) => (
                    <li key={j}>{String.fromCharCode(65 + j)}. {opt}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <p className="text-xs text-gray-400 text-center pt-1">
            先自己试着做一遍，做完可以拿去问老师
          </p>
        </div>
      )}

      {remediation.sent_at && (
        <p className="text-xs text-gray-400 text-center">
          老师于 {remediation.sent_at.slice(0, 19).replace('T', ' ')} 发送
        </p>
      )}
    </div>
  );
};

// =============================================================
// 主页面
// =============================================================
const SubmitPage: React.FC = () => {
  const [searchParams] = useSearchParams();

  // 页面状态机
  const [step, setStep] = useState<SubmitPageStep>('input_token');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // 作业码相关
  const [tokenInput, setTokenInput] = useState('');
  const [verifyResult, setVerifyResult] = useState<TokenVerifyResult | null>(null);

  // 学生身份
  const [studentName, setStudentName] = useState('');
  const [studentUUID, setStudentUUID] = useState('');

  // 提交内容 - 支持文字/文件/链接三种模式
  const [contentText, setContentText] = useState('');
  const [contentType, setContentType] = useState<'text' | 'file' | 'link'>('text');
  // 文件提交
  const [uploadedFile, setUploadedFile] = useState<{url: string; name: string; size: string} | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadError, setUploadError] = useState('');
  // 链接提交
  const [linkURL, setLinkURL] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 提交成功
  const [submissionId, setSubmissionId] = useState('');

  // 老师的反馈（REQ-039 3c）
  const [remediation, setRemediation] = useState<StudentRemediationPublic | null>(null);
  const [loadingResult, setLoadingResult] = useState(false);
  const [feedbackChecked, setFeedbackChecked] = useState(false);

  const tokenInputRef = useRef<HTMLInputElement>(null);

  // URL参数预填作业码
  useEffect(() => {
    const tokenFromURL = searchParams.get('token');
    if (tokenFromURL) {
      setTokenInput(tokenFromURL.toUpperCase());
    }
    // 聚焦输入框
    setTimeout(() => tokenInputRef.current?.focus(), 100);
  }, [searchParams]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // =============================================================
  // 拉取老师的反馈（REQ-039 3c，token + uuid 双证；老师未发送时静默置空）
  // =============================================================
  const fetchFeedback = async (
    assignmentId: string,
    uuid: string,
    token: string,
  ): Promise<StudentRemediationPublic | null> => {
    if (!assignmentId || !uuid || !token) {
      setFeedbackChecked(true);
      return null;
    }
    setLoadingResult(true);
    try {
      const res = await getStudentRemediation(assignmentId, token, uuid);
      setRemediation(res.remediation ?? null);
      return res.remediation ?? null;
    } catch {
      setRemediation(null);       // 未发送/无反馈：不当错误弹窗，页面自己展示"暂无"
      return null;
    } finally {
      setLoadingResult(false);
      setFeedbackChecked(true);
    }
  };

  // =============================================================
  // 步骤1：验证作业码
  // =============================================================
  const handleVerifyToken = async () => {
    const token = tokenInput.trim().toUpperCase();
    if (!token) {
      setError('请输入作业码');
      return;
    }
    if (token.length < 6) {
      setError('作业码格式不正确');
      return;
    }

    setStep('verifying');
    setError('');

    try {
      const result = await verifyToken(token);
      if (!result.valid) {
        setError(result.error || '作业码无效或已过期');
        setStep('input_token');
        return;
      }

      setVerifyResult(result);
      setRemediation(null);
      setFeedbackChecked(false);

      // 专属码：已有身份信息
      if (result.token_type === 'dedicated' && result.student_uuid) {
        setStudentUUID(result.student_uuid);
        setStudentName(result.student_name || '');

        // 已提交过：先进「我的作业」，那里能看到老师的反馈（3c）
        if (result.existing_submission) {
          setContentText(result.existing_submission.content_text || '');
          setStep('my_work');
          fetchFeedback(result.assignment_id, result.student_uuid, token);
          return;
        }
        setStep('write_content');
        return;
      }

      // 通用码：先检查 LocalStorage 是否有保存的 UUID（有＝这台设备提交过）
      const savedUUID = getSavedUUID(result.assignment_id);
      if (savedUUID) {
        setStudentUUID(savedUUID);
        setStep('my_work');
        fetchFeedback(result.assignment_id, savedUUID, token);
        return;
      }

      setStep('fill_name');
    } catch (e: any) {
      setError(e.message || '验证失败，请检查网络');
      setStep('input_token');
    }
  };

  // =============================================================
  // 步骤2（通用码）：确认姓名
  // =============================================================
  const handleConfirmName = () => {
    if (!studentName.trim()) {
      setError('请输入你的姓名');
      return;
    }
    setError('');
    setStep('write_content');
  };

  // =============================================================
  // 文件上传处理
  // =============================================================
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingFile(true);
    setUploadError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const uuid = studentUUID || localStorage.getItem(`submit_uuid_${verifyResult?.assignment_id}`) || '';
      const res = await fetch('/api/submit/upload', {
        method: 'POST',
        headers: uuid ? { 'X-Student-UUID': uuid } : {},
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');

      setUploadedFile({
        url: data.file_url,
        name: data.file_name,
        size: data.file_size_mb + 'MB',
      });
    } catch (e: any) {
      setUploadError(e.message || '上传失败，请重试');
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // =============================================================
  // 步骤3：提交作业
  // =============================================================
  const handleSubmit = async () => {
    // 按提交类型验证
    if (contentType === 'text' && !contentText.trim()) {
      setError('请填写作业内容');
      return;
    }
    if (contentType === 'file' && !uploadedFile) {
      setError('请先上传文件');
      return;
    }
    if (contentType === 'link' && !linkURL.trim()) {
      setError('请输入链接地址');
      return;
    }
    if (!verifyResult) return;

    setStep('submitting');
    setError('');

    try {
      const result = await submitByToken({
        token: verifyResult.token,
        student_name: studentName || verifyResult.student_name,
        content_type: contentType,
        content_text: contentType === 'text' ? contentText.trim() : '',
        file_url: contentType === 'file' ? uploadedFile?.url || '' : '',
        file_name: contentType === 'file' ? uploadedFile?.name || '' : '',
        link_url: contentType === 'link' ? linkURL.trim() : '',
      } as any);

      setSubmissionId(result.submission_id);

      // 保存UUID到LocalStorage用于后续身份续接
      if (result.student_uuid) {
        setStudentUUID(result.student_uuid);
        saveStudentUUID(result.student_uuid, verifyResult.assignment_id);
      }

      setStep('success');
    } catch (e: any) {
      setError(e.message || '提交失败，请重试');
      setStep('write_content');
    }
  };

  // =============================================================
  // 查看老师的反馈（3c：原先查的是历史死表 assignment_assessments，已改接补救反馈）
  // =============================================================
  const handleViewResult = async () => {
    if (!verifyResult?.assignment_id || !studentUUID) return;
    const token = (verifyResult.token || tokenInput).trim().toUpperCase();
    const res = await fetchFeedback(verifyResult.assignment_id, studentUUID, token);
    if (res) {
      setStep('view_result');
    } else {
      showToast('老师还没有发布你的反馈，请稍后再来看');
    }
  };

  // =============================================================
  // 渲染
  // =============================================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-amber-50">
      {/* Toast提示 */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50
                        bg-gray-800 text-white text-sm px-5 py-2.5
                        rounded-xl shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* 顶部品牌栏 */}
      <header className="bg-white border-b border-gray-100 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-700 rounded-xl flex items-center justify-center">
            <BookOpen size={16} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-800">MindCanvas</div>
            <div className="text-xs text-gray-400">作业提交</div>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">

        {/* ===== 步骤1：输入作业码 ===== */}
        {(step === 'input_token' || step === 'verifying') && (
          <div className="space-y-6">
            <div className="text-center pt-4">
              <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center
                              mx-auto mb-4">
                <FileText size={28} className="text-amber-700" />
              </div>
              <h1 className="text-xl font-bold text-gray-900">提交作业</h1>
              <p className="text-sm text-gray-500 mt-2">输入老师发给你的作业码</p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                作业码
              </label>
              <input
                ref={tokenInputRef}
                type="text"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleVerifyToken()}
                placeholder="输入8位作业码，如 ABCD1234"
                maxLength={8}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="w-full text-center text-2xl font-mono font-bold tracking-widest
                           border-2 border-gray-200 rounded-xl px-4 py-4
                           focus:outline-none focus:border-amber-400
                           placeholder:text-gray-300 placeholder:text-base placeholder:font-normal
                           placeholder:tracking-normal"
              />

              {error && (
                <div className="mt-3 flex items-center gap-2 text-red-500 text-sm
                                bg-red-50 rounded-xl px-3 py-2">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}

              <button
                onClick={handleVerifyToken}
                disabled={step === 'verifying' || tokenInput.length < 6}
                className="w-full mt-4 bg-amber-700 hover:bg-amber-800 disabled:opacity-50
                           text-white font-semibold py-4 rounded-xl transition-colors
                           flex items-center justify-center gap-2 text-base"
              >
                {step === 'verifying' ? (
                  <><Loader2 size={18} className="animate-spin" /> 验证中...</>
                ) : (
                  <>下一步 <ChevronRight size={18} /></>
                )}
              </button>
            </div>

            <p className="text-center text-xs text-gray-400">
              作业码由老师课堂上发放，有效期通常为7天
            </p>
          </div>
        )}

        {/* ===== 步骤2：填写姓名（通用码）===== */}
        {step === 'fill_name' && verifyResult && (
          <div className="space-y-6">
            {/* 作业信息卡片 */}
            <div className="bg-amber-700 rounded-2xl p-5 text-white">
              <div className="text-xs opacity-70 mb-1">作业</div>
              <div className="font-bold text-lg leading-tight">
                {verifyResult.assignment_title}
              </div>
              {verifyResult.assignment_description && (
                <p className="text-amber-100 text-sm mt-2 leading-relaxed">
                  {verifyResult.assignment_description}
                </p>
              )}
              {verifyResult.due_at && (
                <div className="flex items-center gap-1 mt-3 text-amber-200 text-xs">
                  <Clock size={11} />
                  截止：{new Date(verifyResult.due_at).toLocaleDateString('zh-CN')}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                <User size={14} className="inline mr-1.5" />
                你的姓名
              </label>
              <input
                type="text"
                value={studentName}
                onChange={e => setStudentName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleConfirmName()}
                placeholder="请输入你的真实姓名"
                autoFocus
                className="w-full text-lg border-2 border-gray-200 rounded-xl px-4 py-3
                           focus:outline-none focus:border-amber-400"
              />
              {error && (
                <div className="mt-2 text-red-500 text-sm flex items-center gap-1">
                  <AlertCircle size={13} /> {error}
                </div>
              )}

              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => setStep('input_token')}
                  className="flex-1 border border-gray-200 text-gray-600
                             py-3 rounded-xl text-sm font-medium"
                >
                  <ArrowLeft size={14} className="inline mr-1" />
                  返回
                </button>
                <button
                  onClick={handleConfirmName}
                  disabled={!studentName.trim()}
                  className="flex-1 bg-amber-700 hover:bg-amber-800 disabled:opacity-50
                             text-white font-semibold py-3 rounded-xl transition-colors"
                >
                  继续 <ChevronRight size={16} className="inline" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== 我的作业（已提交过的学生再次进来，REQ-039 3c）===== */}
        {step === 'my_work' && verifyResult && (
          <div className="space-y-5">
            <div className="text-center pt-4">
              <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center
                              justify-center mx-auto mb-3">
                <CheckCircle size={30} className="text-green-500" />
              </div>
              <h2 className="text-lg font-bold text-gray-900">你已提交过这份作业</h2>
              <p className="text-sm text-gray-500 mt-1">{verifyResult.assignment_title}</p>
            </div>

            {/* 已提交内容 */}
            {verifyResult.existing_submission && (
              <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span className="flex items-center gap-1">
                    <Clock size={12} />
                    {new Date(verifyResult.existing_submission.submitted_at).toLocaleString('zh-CN')}
                  </span>
                  <span>第 {verifyResult.existing_submission.version} 版</span>
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed
                              max-h-40 overflow-y-auto">
                  {verifyResult.existing_submission.content_text || '（无文字内容）'}
                </p>
              </div>
            )}

            {/* 老师的反馈 */}
            {loadingResult ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center text-gray-400">
                <Loader2 size={18} className="animate-spin mx-auto mb-2" />
                <p className="text-sm">正在查看老师有没有留言…</p>
              </div>
            ) : remediation ? (
              <FeedbackCard
                remediation={remediation}
                assignmentTitle={verifyResult.assignment_title}
              />
            ) : feedbackChecked ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
                <Star size={28} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-500">老师还没有发布反馈</p>
                <p className="text-xs text-gray-400 mt-1">批改后再回来看看</p>
                <button
                  onClick={() => {
                    const token = (verifyResult.token || tokenInput).trim().toUpperCase();
                    fetchFeedback(verifyResult.assignment_id, studentUUID, token);
                  }}
                  className="mt-3 text-xs text-amber-700 inline-flex items-center gap-1"
                >
                  <RefreshCw size={12} /> 刷新看看
                </button>
              </div>
            ) : null}

            {/* 操作 */}
            <div className="space-y-3">
              {verifyResult.allow_resubmit ? (
                <button
                  onClick={() => setStep('write_content')}
                  className="w-full border-2 border-amber-200 text-amber-700 font-medium
                             py-4 rounded-xl hover:bg-amber-50 transition-colors
                             flex items-center justify-center gap-2"
                >
                  <RefreshCw size={16} /> 修改并重新提交
                </button>
              ) : (
                <p className="text-xs text-gray-400 text-center">
                  这份作业不允许重新提交
                </p>
              )}
              <button
                onClick={() => {
                  setStep('input_token');
                  setTokenInput('');
                  setVerifyResult(null);
                  setContentText('');
                  setRemediation(null);
                  setFeedbackChecked(false);
                  setError('');
                }}
                className="w-full text-gray-400 text-sm py-2 hover:text-gray-600"
              >
                用另一个作业码进入
              </button>
            </div>
          </div>
        )}

        {/* ===== 步骤3：填写作业内容 ===== */}
        {step === 'write_content' && verifyResult && (
          <div className="space-y-4">
            {/* 作业信息 */}
            <div className="bg-amber-700 rounded-2xl p-5 text-white">
              <div className="text-xs opacity-70 mb-1">作业</div>
              <div className="font-bold text-lg leading-tight">
                {verifyResult.assignment_title}
              </div>
              {verifyResult.assignment_description && (
                <p className="text-amber-100 text-sm mt-2 leading-relaxed">
                  {verifyResult.assignment_description}
                </p>
              )}
              <div className="flex items-center gap-3 mt-3 text-amber-200 text-xs">
                <span>
                  <User size={11} className="inline mr-1" />
                  {studentName || verifyResult.student_name || '匿名'}
                </span>
                {verifyResult.due_at && (
                  <span>
                    <Clock size={11} className="inline mr-1" />
                    截止 {new Date(verifyResult.due_at).toLocaleDateString('zh-CN')}
                  </span>
                )}
              </div>
            </div>

            {/* 已提交提示 */}
            {verifyResult.existing_submission && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3
                              flex items-start gap-2">
                <RefreshCw size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-amber-700 text-sm font-medium">你已提交过这份作业</p>
                  <p className="text-amber-600 text-xs mt-0.5">
                    提交于 {new Date(verifyResult.existing_submission.submitted_at)
                      .toLocaleString('zh-CN')}
                    {verifyResult.allow_resubmit && ' · 可以重新提交'}
                  </p>
                </div>
              </div>
            )}

            {/* 提交类型选择 */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex border-b border-gray-100">
                {([
                  { type: 'text', label: '文字', icon: FileText },
                  { type: 'file', label: '文件', icon: Paperclip },
                  { type: 'link', label: '链接', icon: Link },
                ] as const).map(tab => (
                  <button
                    key={tab.type}
                    onClick={() => { setContentType(tab.type); setError(''); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium
                               transition-colors ${
                      contentType === tab.type
                        ? 'bg-amber-50 text-amber-800 border-b-2 border-amber-600'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    <tab.icon size={14} />
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* 文字输入 */}
              {contentType === 'text' && (
                <textarea
                  value={contentText}
                  onChange={e => setContentText(e.target.value)}
                  placeholder="在这里输入你的作业内容..."
                  rows={10}
                  className="w-full px-4 py-4 text-sm text-gray-800 leading-relaxed
                             resize-none focus:outline-none"
                />
              )}

              {/* 文件上传 */}
              {contentType === 'file' && (
                <div className="p-5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileUpload}
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.jpg,.jpeg,.png,.gif,.webp,.zip,.rar,.mp4,.mov"
                  />
                  {uploadedFile ? (
                    <div className="flex items-center gap-3 bg-green-50 border border-green-200
                                    rounded-xl p-4">
                      <CheckCircle size={20} className="text-green-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {uploadedFile.name}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{uploadedFile.size}</p>
                      </div>
                      <button
                        onClick={() => setUploadedFile(null)}
                        className="text-gray-400 hover:text-red-400 p-1"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingFile}
                      className="w-full border-2 border-dashed border-gray-300 hover:border-amber-400
                                 rounded-xl py-10 flex flex-col items-center gap-3
                                 text-gray-400 hover:text-amber-700 transition-colors
                                 disabled:opacity-50"
                    >
                      {uploadingFile
                        ? <Loader2 size={28} className="animate-spin" />
                        : <Upload size={28} />}
                      <span className="text-sm">
                        {uploadingFile ? '上传中...' : '点击选择文件'}
                      </span>
                      <span className="text-xs text-gray-300">
                        支持 PDF/Word/PPT/Excel/图片/ZIP，最大50MB
                      </span>
                    </button>
                  )}
                  {uploadError && (
                    <p className="mt-2 text-red-500 text-xs flex items-center gap-1">
                      <AlertCircle size={12} /> {uploadError}
                    </p>
                  )}
                  {/* 文字补充说明（可选）*/}
                  <div className="mt-3">
                    <label className="text-xs text-gray-500 mb-1 block">补充说明（可选）</label>
                    <textarea
                      value={contentText}
                      onChange={e => setContentText(e.target.value)}
                      placeholder="可以补充文字说明..."
                      rows={3}
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2
                                 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300"
                    />
                  </div>
                </div>
              )}

              {/* 链接提交 */}
              {contentType === 'link' && (
                <div className="p-5 space-y-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">链接地址</label>
                    <input
                      type="url"
                      value={linkURL}
                      onChange={e => setLinkURL(e.target.value)}
                      placeholder="https://..."
                      className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3
                                 focus:outline-none focus:ring-2 focus:ring-amber-300"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      支持：网盘链接、在线文档、作品展示页等
                    </p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">链接说明（可选）</label>
                    <textarea
                      value={contentText}
                      onChange={e => setContentText(e.target.value)}
                      placeholder="简要说明链接内容..."
                      rows={4}
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2
                                 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-gray-400 px-1">
              <span>
                {contentType === 'text' && `${contentText.length} 字`}
                {contentType === 'file' && (uploadedFile ? '文件已就绪' : '请选择文件')}
                {contentType === 'link' && (linkURL ? '链接已填写' : '请输入链接')}
              </span>
              {error && (
                <span className="text-red-500 flex items-center gap-1">
                  <AlertCircle size={11} /> {error}
                </span>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(
                  verifyResult.token_type === 'universal' ? 'fill_name' : 'input_token'
                )}
                className="border border-gray-200 text-gray-600 px-5
                           py-3.5 rounded-xl text-sm font-medium"
              >
                <ArrowLeft size={14} className="inline mr-1" />
                返回
              </button>
              <button
                onClick={handleSubmit}
                disabled={!contentText.trim()}
                className="flex-1 bg-amber-700 hover:bg-amber-800 disabled:opacity-50
                           text-white font-semibold py-3.5 rounded-xl
                           transition-colors flex items-center justify-center gap-2"
              >
                <Send size={16} />
                {verifyResult.existing_submission ? '重新提交' : '提交作业'}
              </button>
            </div>
          </div>
        )}

        {/* ===== 提交中 ===== */}
        {step === 'submitting' && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 size={40} className="animate-spin text-amber-700" />
            <p className="text-gray-500 text-sm">正在提交...</p>
          </div>
        )}

        {/* ===== 提交成功 ===== */}
        {step === 'success' && verifyResult && (
          <div className="space-y-6">
            <div className="text-center pt-6">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center
                              justify-center mx-auto mb-4">
                <CheckCircle size={40} className="text-green-500" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">提交成功！</h2>
              <p className="text-sm text-gray-500 mt-2">
                你的作业已提交给老师，请等待批改
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">作业</span>
                <span className="text-gray-800 font-medium">
                  {verifyResult.assignment_title}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">提交人</span>
                <span className="text-gray-800">
                  {studentName || verifyResult.student_name}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">提交时间</span>
                <span className="text-gray-800">
                  {new Date().toLocaleString('zh-CN')}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">提交编号</span>
                <span className="text-gray-400 text-xs font-mono">
                  {submissionId.slice(0, 8)}...
                </span>
              </div>
            </div>

            {/* 查看老师的反馈（3c）*/}
            <button
              onClick={handleViewResult}
              disabled={loadingResult}
              className="w-full border-2 border-amber-200 text-amber-700 font-medium
                         py-4 rounded-xl hover:bg-amber-50 transition-colors
                         flex items-center justify-center gap-2"
            >
              {loadingResult ? (
                <><Loader2 size={16} className="animate-spin" /> 查询中...</>
              ) : (
                <><Star size={16} /> 查看老师的反馈</>
              )}
            </button>

            <button
              onClick={() => {
                setStep('input_token');
                setTokenInput('');
                setVerifyResult(null);
                setContentText('');
                setError('');
              }}
              className="w-full text-gray-400 text-sm py-2 hover:text-gray-600"
            >
              提交另一份作业
            </button>
          </div>
        )}

        {/* ===== 查看老师的反馈 ===== */}
        {step === 'view_result' && verifyResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <button
                onClick={() => setStep(submissionId ? 'success' : 'my_work')}
                className="text-gray-400 hover:text-gray-600"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="text-lg font-bold text-gray-900">老师的反馈</h2>
            </div>

            {remediation ? (
              <FeedbackCard
                remediation={remediation}
                assignmentTitle={verifyResult.assignment_title}
              />
            ) : (
              <div className="text-center py-16 text-gray-400">
                <Star size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">老师还没有发布你的反馈</p>
                <p className="text-xs mt-1">请稍后再来查看</p>
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
};

export default SubmitPage;
