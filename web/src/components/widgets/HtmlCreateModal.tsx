// =============================================================
// MindCanvas - REQ-041 HTML 展示组件创建/编辑弹窗
// 老师粘贴外部 AI（豆包/ChatGPT 等）生成的 HTML 交互课件代码，
// 提交后在画布上以 iframe sandbox=allow-scripts 渲染。
// 安全：源码在沙箱 iframe 中运行（无 same-origin），拿不到 Cookie/JWT。
// 体积上限 512KB（防超大代码拖垮渲染/传输）。
// =============================================================
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldCheck } from 'lucide-react';

const MAX_BYTES = 512 * 1024;

interface Props {
  mode?: 'create' | 'edit';
  initialTitle?: string;
  initialHtml?: string;
  onConfirm: (title: string, html: string) => void;
  onClose: () => void;
}

const PLACEHOLDER = `在此粘贴 HTML 代码，例如：

<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: sans-serif; text-align: center; padding: 24px; }
  button { font-size: 18px; padding: 8px 16px; }
</style></head>
<body>
  <h2>点击计数器</h2>
  <p id="n">0</p>
  <button onclick="document.getElementById('n').innerText=++window.c||(window.c=1)">＋1</button>
</body>
</html>`;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

export const HtmlCreateModal: React.FC<Props> = ({
  mode = 'create', initialTitle = 'HTML 展示', initialHtml = '', onConfirm, onClose,
}) => {
  const [title, setTitle] = useState(initialTitle);
  const [html, setHtml] = useState(initialHtml);

  const byteSize = new Blob([html]).size;
  const overLimit = byteSize > MAX_BYTES;
  const isValid = title.trim().length > 0 && html.trim().length > 0 && !overLimit;

  const handleConfirm = () => {
    if (!isValid) return;
    onConfirm(title.trim(), html);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2147483647]">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[640px] max-h-[90vh] overflow-y-auto flex flex-col">

        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span>🖥️</span> {mode === 'edit' ? '编辑 HTML 代码' : '插入 HTML 展示组件'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 flex-1">
          {/* 标题 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              组件标题 <span className="text-red-500">*</span>
            </label>
            <input
              className="input w-full"
              placeholder="例：交互式函数图像"
              value={title}
              maxLength={60}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          {/* HTML 代码 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                HTML 代码 <span className="text-red-500">*</span>
              </label>
              <span className={`text-xs ${overLimit ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                {formatBytes(byteSize)} / 512 KB
              </span>
            </div>
            <textarea
              className="w-full h-64 text-xs font-mono border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2
                         bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100 outline-none focus:border-amber-400 resize-y"
              placeholder={PLACEHOLDER}
              value={html}
              onChange={e => setHtml(e.target.value)}
              spellCheck={false}
            />
            {overLimit && (
              <p className="text-xs text-red-500 mt-1">代码超过 512KB 上限，请精简后再试。</p>
            )}
          </div>

          {/* 安全说明 */}
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-800 dark:text-amber-300">
            <ShieldCheck size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              代码在隔离沙箱中运行，无法访问本站登录信息，可放心粘贴外部 AI 生成的课件。
              学生端同样可交互。
            </span>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
          <button onClick={onClose} className="btn btn-secondary px-4 py-2">取消</button>
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="btn btn-primary px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mode === 'edit' ? '保存' : '插入画布'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default HtmlCreateModal;
