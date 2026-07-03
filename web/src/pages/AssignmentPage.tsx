// =============================================================
// MindCanvas Phase8 - 作业评价中心主页面
// 路由：/assignments
// 功能：列出作业、创建作业、进入作业详情
// =============================================================
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, BookOpen, Users, FileText, ChevronRight,
  Trash2, AlertCircle, CheckCircle, Loader2,
} from 'lucide-react';
import type { Assignment } from '@/types/assignment';
import { ASSIGNMENT_STATUS_LABELS } from '@/types/assignment';
import {
  listAssignments, createAssignment, deleteAssignment,
} from '@/utils/assignmentApi';

const AssignmentPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const roomId = searchParams.get('room_id') || undefined;

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // 创建弹窗状态
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAllowResubmit, setNewAllowResubmit] = useState(true);
  const [creating, setCreating] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listAssignments(roomId);
      setAssignments(data.assignments || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const data = await createAssignment({
        title: newTitle.trim(),
        description: newDesc.trim(),
        allow_resubmit: newAllowResubmit,
        room_id: roomId,
      });
      setShowCreate(false);
      setNewTitle('');
      setNewDesc('');
      showToast(`作业「${data.assignment.title}」已创建`);
      fetchAssignments();
    } catch (e: any) {
      showToast('创建失败：' + e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, aid: string, title: string) => {
    e.stopPropagation();
    if (!confirm(`确定删除作业「${title}」？此操作不可恢复。`)) return;
    try {
      await deleteAssignment(aid);
      showToast('作业已删除');
      fetchAssignments();
    } catch (e: any) {
      showToast('删除失败：' + e.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-700 text-white
                        text-sm px-5 py-2.5 rounded-xl shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* 顶部导航 */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              ← 返回
            </button>
            <div className="w-px h-4 bg-gray-200" />
            <div className="flex items-center gap-2">
              <BookOpen size={18} className="text-amber-700" />
              <h1 className="text-base font-semibold">作业评价中心</h1>
            </div>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Plus size={16} /> 发布作业
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3
                          flex items-center gap-2 text-red-600 text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* 作业列表 */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={32} className="animate-spin text-amber-500" />
          </div>
        ) : assignments.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <BookOpen size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">暂无作业</p>
            <p className="text-sm mt-2">点击「发布作业」创建第一个作业任务</p>
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary mt-6 inline-flex items-center gap-2"
            >
              <Plus size={16} /> 发布第一个作业
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {assignments.map(a => {
              const statusCfg = ASSIGNMENT_STATUS_LABELS[a.status];
              return (
                <div
                  key={a.id}
                  onClick={() => navigate(`/assignments/${a.id}`)}
                  className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5
                             hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                                         ${statusCfg.bg} ${statusCfg.color}`}>
                          {statusCfg.label}
                        </span>
                        {a.allow_resubmit && (
                          <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
                            可重新提交
                          </span>
                        )}
                      </div>
                      <h3 className="font-semibold text-gray-900 group-hover:text-amber-800
                                     transition-colors truncate text-base">
                        {a.title}
                      </h3>
                      {a.description && (
                        <p className="text-sm text-gray-400 mt-1 line-clamp-1">
                          {a.description}
                        </p>
                      )}
                      {/* 统计数字 */}
                      <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                        <span className="flex items-center gap-1">
                          <FileText size={12} />
                          {a.material_count ?? 0} 份材料
                        </span>
                        <span className="flex items-center gap-1">
                          <Users size={12} />
                          {a.submission_count ?? 0} 份提交
                        </span>
                        {(a.assessed_count ?? 0) > 0 && (
                          <span className="flex items-center gap-1 text-green-500">
                            <CheckCircle size={12} />
                            {a.assessed_count} 已评价
                          </span>
                        )}
                        <span className="ml-auto">
                          {new Date(a.created_at).toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                    </div>

                    {/* 操作区 */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={e => handleDelete(e, a.id, a.title)}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-red-400
                                   hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                        title="删除作业"
                      >
                        <Trash2 size={14} />
                      </button>
                      <ChevronRight size={16} className="text-gray-300 group-hover:text-amber-500" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* 创建作业弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center
                        justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-lg shadow-xl">
            <h3 className="text-lg font-semibold mb-4">发布作业</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  作业标题 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="input"
                  placeholder="例如：期末作文：我的暑假计划"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && newTitle.trim() && handleCreate()}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  作业说明
                </label>
                <textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  className="input resize-none"
                  placeholder="详细描述作业要求、字数、格式等..."
                  rows={3}
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newAllowResubmit}
                  onChange={e => setNewAllowResubmit(e.target.checked)}
                  className="rounded border-gray-300 text-amber-700"
                />
                <span className="text-sm text-gray-600">允许学生重新提交</span>
              </label>
              <div className="bg-amber-50 rounded-xl px-4 py-3 text-xs text-amber-700">
                💡 创建后可上传评分标准、参考材料，并切换状态为「收集中」让学生提交
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowCreate(false)} className="btn-secondary">
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newTitle.trim()}
                className="btn-primary disabled:opacity-50"
              >
                {creating ? '创建中...' : '创建作业'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssignmentPage;
