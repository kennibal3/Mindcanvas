// =============================================================
// MindCanvas Phase8-v2 - 学生作业提交页
// 路由：/submit（完全公开，无需登录）
// 功能：输入作业码 → 验证 → 填写内容 → 提交 → 查看结果
// 特点：手机端友好，零登录门槛，支持身份续接
// =============================================================
import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen, CheckCircle, AlertCircle, Loader2,
  Send, ChevronRight, User, FileText, RefreshCw,
  Star, Award, Clock, ArrowLeft, Upload, Link, X, Paperclip,
} from 'lucide-react';
import { verifyToken, submitByToken, getStudentResult } from '@/utils/tokenApi';
import type {
  TokenVerifyResult, SubmitPageStep, StudentAssessmentResult,
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
// 子组件：评价结果展示
// =============================================================
const AssessmentCard = ({
  assessment,
  assignmentTitle,
}: {
  assessment: StudentAssessmentResult;
  assignmentTitle: string;
}) => {
  const score = assessment.final_score ?? assessment.ai_score;
  const feedback = assessment.final_feedback || assessment.ai_feedback;
  const dimScores = assessment.final_dimension_scores || assessment.ai_dimension_scores;

  return (
    <div className="space-y-4">
      {/* 总分卡片 */}
      <div className="bg-gradient-to-br from-amber-600 to-amber-800 rounded-2xl p-6 text-white text-center">
        <Award size={32} className="mx-auto mb-2 opacity-80" />
        <div className="text-5xl font-bold mb-1">{score?.toFixed(1) ?? '--'}</div>
        <div className="text-amber-200 text-sm">综合得分</div>
        <div className="text-white/70 text-xs mt-2">{assignmentTitle}</div>
      </div>

      {/* 分项得分 */}
      {dimScores && Object.keys(dimScores).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Star size={14} className="text-yellow-400" />
            分项评分
          </h3>
          <div className="space-y-2">
            {Object.entries(dimScores).map(([dim, s]) => (
              <div key={dim} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20 flex-shrink-0 truncate">{dim}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-amber-500 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (s / 5) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-gray-700 w-6 text-right">{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 综合评语 */}
      {feedback && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">📝 综合评语</h3>
          <p className="text-sm text-gray-600 leading-relaxed">{feedback}</p>
        </div>
      )}

      {/* 亮点 */}
      {assessment.ai_highlights && (
        <div className="bg-green-50 rounded-2xl border border-green-100 p-4">
          <h3 className="text-sm font-semibold text-green-700 mb-2">✨ 作业亮点</h3>
          <p className="text-sm text-green-700 leading-relaxed">{assessment.ai_highlights}</p>
        </div>
      )}

      {/* 待改进 */}
      {assessment.ai_issues && (
        <div className="bg-orange-50 rounded-2xl border border-orange-100 p-4">
          <h3 className="text-sm font-semibold text-orange-700 mb-2">💡 待改进</h3>
          <p className="text-sm text-orange-700 leading-relaxed">{assessment.ai_issues}</p>
        </div>
      )}

      {/* 修改建议 */}
      {assessment.ai_suggestions && (
        <div className="bg-amber-50 rounded-2xl border border-amber-100 p-4">
          <h3 className="text-sm font-semibold text-amber-800 mb-2">🎯 改进建议</h3>
          <p className="text-sm text-amber-800 leading-relaxed">{assessment.ai_suggestions}</p>
        </div>
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

  // 评价结果
  const [assessment, setAssessment] = useState<StudentAssessmentResult | null>(null);
  const [loadingResult, setLoadingResult] = useState(false);

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

      // 专属码：已有身份信息，直接跳到填写内容
      if (result.token_type === 'dedicated' && result.student_uuid) {
        setStudentUUID(result.student_uuid);
        setStudentName(result.student_name || '');

        // 如果已提交过，预填内容
        if (result.existing_submission) {
          setContentText(result.existing_submission.content_text || '');
        }
        setStep('write_content');
        return;
      }

      // 通用码：需要填写姓名
      // 先检查LocalStorage是否有保存的UUID
      const savedUUID = getSavedUUID(result.assignment_id);
      if (savedUUID) {
        setStudentUUID(savedUUID);
        setStep('write_content');
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
  // 查看评价结果
  // =============================================================
  const handleViewResult = async () => {
    if (!verifyResult?.assignment_id || !studentUUID) return;

    setLoadingResult(true);
    try {
      const res = await getStudentResult(verifyResult.assignment_id, studentUUID);
      setAssessment(res.assessment);
      setStep('view_result');
    } catch (e: any) {
      showToast(e.message || '暂无评价结果，请等待老师批改');
    } finally {
      setLoadingResult(false);
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

            {/* 查看评价结果 */}
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
                <><Star size={16} /> 查看评价结果</>
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

        {/* ===== 查看评价结果 ===== */}
        {step === 'view_result' && verifyResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <button
                onClick={() => setStep('success')}
                className="text-gray-400 hover:text-gray-600"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="text-lg font-bold text-gray-900">我的评价结果</h2>
            </div>

            {assessment ? (
              <AssessmentCard
                assessment={assessment}
                assignmentTitle={verifyResult.assignment_title}
              />
            ) : (
              <div className="text-center py-16 text-gray-400">
                <Star size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">老师还未发布评价结果</p>
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
