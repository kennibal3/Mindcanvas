// =============================================================
// MindCanvas - REQ-041 HTML 展示组件创建/编辑弹窗
// 老师粘贴外部 AI（豆包/ChatGPT 等）生成的 HTML 交互课件代码，
// 提交后在画布上以 iframe sandbox=allow-scripts 渲染。
// 安全：源码在沙箱 iframe 中运行（无 same-origin），拿不到 Cookie/JWT。
// 体积上限 512KB（防超大代码拖垮渲染/传输）。
// =============================================================
import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldCheck, FileArchive, Loader2, Upload } from 'lucide-react';

const MAX_BYTES = 512 * 1024;
// 与后端 CoursewareMaxUploadBytes 及 nginx client_max_body_size 三处对齐。
// 前端先拦一道纯粹是为了给人话提示——否则 100MB 传完了才被拒，白等一场。
const MAX_ZIP_BYTES = 100 * 1024 * 1024;

interface Props {
  mode?: 'create' | 'edit';
  initialTitle?: string;
  initialHtml?: string;
  onConfirm: (title: string, html: string) => void;
  /** REQ-059：传了才显示「上传压缩包」页签（编辑态不传，zip 课件没有源码可编辑） */
  onConfirmZip?: (title: string, file: File) => Promise<void>;
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
  mode = 'create', initialTitle = 'HTML 展示', initialHtml = '', onConfirm, onConfirmZip, onClose,
}) => {
  const [title, setTitle] = useState(initialTitle);
  const [html, setHtml] = useState(initialHtml);

  // REQ-059：两种来源。编辑态没有 onConfirmZip，恒为 paste，行为与改造前完全一致。
  const canZip = mode === 'create' && !!onConfirmZip;
  const [tab, setTab] = useState<'paste' | 'zip'>('paste');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipErr, setZipErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const byteSize = new Blob([html]).size;
  const overLimit = byteSize > MAX_BYTES;
  const pasteValid = title.trim().length > 0 && html.trim().length > 0 && !overLimit;
  const zipValid = title.trim().length > 0 && !!zipFile && !zipErr;
  const isValid = tab === 'zip' ? zipValid : pasteValid;

  // 选中/拖入 zip。标题为空或还是默认值时，用文件名自动填上——
  // 老师的课件包本来就叫「九年级 化学 — 第四单元第三课时.zip」，
  // 比让他再敲一遍标题强。
  const acceptFile = (f: File | null | undefined) => {
    setZipErr('');
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.zip')) {
      setZipFile(null);
      setZipErr('只支持 .zip 压缩包');
      return;
    }
    if (f.size > MAX_ZIP_BYTES) {
      setZipFile(null);
      setZipErr(`压缩包 ${(f.size / 1024 / 1024).toFixed(1)}MB，超过 100MB 上限`);
      return;
    }
    setZipFile(f);
    if (!title.trim() || title === 'HTML 展示') {
      setTitle(f.name.replace(/\.zip$/i, '').slice(0, 60));
    }
  };

  const handleConfirm = async () => {
    if (!isValid || uploading) return;
    if (tab === 'zip' && zipFile && onConfirmZip) {
      setUploading(true);
      setZipErr('');
      try {
        await onConfirmZip(title.trim(), zipFile);
      } catch (e) {
        // 后端把「没有 index.html」「含越界条目」「超限」这类原因原样透出来，
        // 这里就地显示，不要吞成一句「导入失败」——那样老师无从下手
        setZipErr(e instanceof Error ? e.message : '导入失败');
      } finally {
        setUploading(false);
      }
      return;
    }
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

        {/* REQ-059：来源页签。编辑态不显示（zip 课件是一整个目录树，没有源码可编辑） */}
        {canZip && (
          <div className="flex gap-1 px-6 pt-4 flex-shrink-0">
            {([
              ['paste', '粘贴代码'],
              ['zip', '上传压缩包'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  tab === key
                    ? 'bg-amber-100 text-amber-800 font-medium dark:bg-amber-900/40 dark:text-amber-300'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

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

          {/* REQ-059：zip 上传区 */}
          {tab === 'zip' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                课件压缩包 <span className="text-red-500">*</span>
              </label>
              <div
                onClick={() => !uploading && fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault();
                  setDragOver(false);
                  if (!uploading) acceptFile(e.dataTransfer.files?.[0]);
                }}
                className={`border-2 border-dashed rounded-lg px-4 py-8 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-amber-300'
                } ${uploading ? 'opacity-60 cursor-wait' : ''}`}
              >
                {zipFile ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <FileArchive size={18} className="text-amber-600" />
                    <span className="truncate max-w-[380px]">{zipFile.name}</span>
                    <span className="text-gray-400 flex-shrink-0">
                      {(zipFile.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1.5 text-gray-400">
                    <Upload size={22} />
                    <span className="text-sm">点击选择，或把 .zip 拖到这里</span>
                    <span className="text-xs">最大 100MB</span>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={e => acceptFile(e.target.files?.[0])}
              />
              {zipErr && <p className="text-xs text-red-500 mt-1.5">{zipErr}</p>}
              <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                压缩包里需要有 <code className="font-mono">index.html</code> 作为入口
                （外面多包一层文件夹没关系，会自动去掉）。
                课件里的图片、样式、脚本、视频都会一起导入。
              </p>
            </div>
          ) : (
          /* HTML 代码 */
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
          )}

          {/* 安全说明 */}
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-800 dark:text-amber-300">
            <ShieldCheck size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              {tab === 'zip'
                ? '课件在隔离沙箱中运行，无法访问本站登录信息，可放心导入外部工具生成的课件包。学生端同样可交互。'
                : '代码在隔离沙箱中运行，无法访问本站登录信息，可放心粘贴外部 AI 生成的课件。学生端同样可交互。'}
            </span>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
          <button onClick={onClose} disabled={uploading} className="btn btn-secondary px-4 py-2 disabled:opacity-50">取消</button>
          <button
            onClick={handleConfirm}
            disabled={!isValid || uploading}
            className="btn btn-primary px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {uploading && <Loader2 size={14} className="animate-spin" />}
            {uploading ? '导入中…' : mode === 'edit' ? '保存' : '插入画布'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default HtmlCreateModal;
