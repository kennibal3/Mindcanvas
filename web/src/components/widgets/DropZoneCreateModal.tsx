// =============================================================
// MindCanvas v4.1 - 作品收集区创建弹窗
// =============================================================
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Minus } from 'lucide-react';
import type { DropzonePayload } from '@/types/widget';

interface Props {
  onConfirm: (payload: DropzonePayload) => void;
  onClose: () => void;
}

// 内容类型选项
const ACCEPT_OPTIONS = [
  { value: 'text' as const,  label: '📝 文字', desc: '文本内容' },
  { value: 'image' as const, label: '🖼️ 图片', desc: 'JPG/PNG等' },
  { value: 'file' as const,  label: '📁 文件', desc: 'PDF/Word/PPT/ZIP等' },
  { value: 'link' as const,  label: '🔗 链接', desc: '网页链接' },
];

// 布局选项
const LAYOUT_OPTIONS = [
  { value: 'grid' as const,      label: '网格' },
  { value: 'waterfall' as const, label: '瀑布流' },
  { value: 'list' as const,      label: '列表' },
  { value: 'spotlight' as const, label: '聚焦' },
];

export const DropZoneCreateModal: React.FC<Props> = ({ onConfirm, onClose }) => {
  const [title, setTitle] = useState('作品收集');
  const [prompt, setPrompt] = useState('请提交你的作品');
  const [acceptTypes, setAcceptTypes] = useState<Array<'text' | 'image' | 'file' | 'link'>>(['text', 'image']);
  const [layout, setLayout] = useState<DropzonePayload['layout']>('grid');
  const [maxPerStudent, setMaxPerStudent] = useState(3);
  const [maxFileSizeMB, setMaxFileSizeMB] = useState(50);
  const [submissionUnit, setSubmissionUnit] = useState<'individual' | 'group'>('individual');
  const [hideNames, setHideNames] = useState(false);
  const [enableLike, setEnableLike] = useState(true);
  const [deadline, setDeadline] = useState('');
  const [requireDescription, setRequireDescription] = useState(false);

  const toggleAccept = (val: 'text' | 'image' | 'file' | 'link') => {
    setAcceptTypes(prev =>
      prev.includes(val) ? prev.filter(t => t !== val) : [...prev, val]
    );
  };

  const isValid = title.trim().length > 0 && acceptTypes.length > 0;

  const handleConfirm = () => {
    if (!isValid) return;
    onConfirm({
      title: title.trim(),
      prompt: prompt.trim(),
      acceptTypes,
      maxFileSizeMB,
      status: 'draft',
      deadline: deadline || undefined,
      submissionUnit,
      maxPerStudent,
      requireDescription,
      layout,
      hideNames,
      enableLike,
      submissionOrder: [],
      submissionCount: 0,
    });
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2147483647]">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[520px] max-h-[88vh] overflow-y-auto">

        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span>📥</span> 创建作品收集区
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-5">

          {/* 标题 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              收集标题 <span className="text-red-500">*</span>
            </label>
            <input
              className="input w-full"
              placeholder="例：课堂作品展示"
              value={title}
              maxLength={60}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          {/* 引导语 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              学生提交引导语
            </label>
            <input
              className="input w-full"
              placeholder="例：请上传你的设计草图"
              value={prompt}
              maxLength={100}
              onChange={e => setPrompt(e.target.value)}
            />
          </div>

          {/* 接受内容类型 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              接受内容类型 <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ACCEPT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => toggleAccept(opt.value)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                    acceptTypes.includes(opt.value)
                      ? 'bg-amber-50 border-amber-400 text-amber-800 dark:bg-amber-900/30 dark:border-amber-500 dark:text-amber-300'
                      : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  <span>{opt.label}</span>
                  <span className="text-xs text-gray-400">{opt.desc}</span>
                </button>
              ))}
            </div>
            {acceptTypes.length === 0 && (
              <p className="text-xs text-red-500 mt-1">至少选择一种内容类型</p>
            )}
          </div>

          {/* 文件大小上限（仅当选了 file 时显示） */}
          {acceptTypes.includes('file') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                单文件大小上限
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={1} max={100} step={1}
                  value={maxFileSizeMB}
                  onChange={e => setMaxFileSizeMB(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 w-16 text-right">
                  {maxFileSizeMB} MB
                </span>
              </div>
            </div>
          )}

          {/* 提交单位 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              提交单位
            </label>
            <div className="flex gap-2">
              {(['individual', 'group'] as const).map(unit => (
                <button
                  key={unit}
                  onClick={() => setSubmissionUnit(unit)}
                  className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                    submissionUnit === unit
                      ? 'bg-amber-700 text-white border-amber-700'
                      : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                  }`}
                >
                  {unit === 'individual' ? '👤 个人' : '👥 小组'}
                </button>
              ))}
            </div>
          </div>

          {/* 每人提交上限 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              每{submissionUnit === 'group' ? '组' : '人'}提交上限
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMaxPerStudent(v => Math.max(1, v - 1))}
                className="p-1.5 rounded-full border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <Minus size={14} />
              </button>
              <span className="w-8 text-center font-semibold text-gray-800 dark:text-gray-100">
                {maxPerStudent}
              </span>
              <button
                onClick={() => setMaxPerStudent(v => Math.min(10, v + 1))}
                className="p-1.5 rounded-full border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <Plus size={14} />
              </button>
              <span className="text-sm text-gray-500">件</span>
            </div>
          </div>

          {/* 截止时间（课后提交） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              截止时间 <span className="text-xs text-gray-400 ml-1">（不填则不限时，支持课后提交）</span>
            </label>
            <input
              type="datetime-local"
              className="input w-full"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
            />
          </div>

          {/* 展示布局 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              展示布局
            </label>
            <div className="flex gap-2 flex-wrap">
              {LAYOUT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setLayout(opt.value)}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                    layout === opt.value
                      ? 'bg-amber-700 text-white border-amber-700'
                      : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 开关选项 */}
          <div className="space-y-3">
            {[
              { key: 'hideNames', label: '隐藏学生姓名', desc: '适合匿名互评', val: hideNames, set: setHideNames },
              { key: 'enableLike', label: '允许点赞', desc: '教师可为作品点赞', val: enableLike, set: setEnableLike },
              { key: 'requireDescription', label: '要求填写说明', desc: '提交时必须填写作品描述', val: requireDescription, set: setRequireDescription },
            ].map(item => (
              <div key={item.key} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{item.label}</p>
                  <p className="text-xs text-gray-400">{item.desc}</p>
                </div>
                <button
                  onClick={() => item.set((v: boolean) => !v)}
                  className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                    item.val ? 'bg-amber-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    item.val ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose} className="btn btn-secondary px-4 py-2">取消</button>
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="btn btn-primary px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            创建收集区
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default DropZoneCreateModal;
