// =============================================================
// MindCanvas - REQ-041 HTML 展示组件（改造/替代作品收集）
//
// 渲染：老师粘贴的 HTML 源码在 iframe sandbox="allow-scripts" 中运行。
//   - 无 allow-same-origin：iframe 处于独立 opaque 源，拿不到本站 Cookie/JWT/localStorage，
//     即使粘贴恶意代码也无法窃取会话或操作父页面（设计前置安全要求）。
//   - 学生端同样可交互（isTeacher 无关，iframe 对所有人可点击）。
//
// 存储：源码不进 room_elements.payload（REQ-032 教训），走 REST 按 element_id 拉取。
//   payload 仅存 { title, htmlVersion }。编辑源码后 bump htmlVersion，
//   经既有 element_update 广播链路触发全端重新拉取，无需新增 WS 桥接。
// =============================================================
import React, { useState, useEffect, useRef } from 'react';
import { Code2, Trash2, Loader2, AlertTriangle, Maximize2, Minimize2 } from 'lucide-react';
import { useRoomStore } from '@/store/roomStore';
import HtmlCreateModal from './HtmlCreateModal';

interface Props {
  id: string;
  payload: Record<string, unknown>;
  isTeacher: boolean;
  isLocked?: boolean;
  onUpdate: (payload: Record<string, unknown>) => void;
  onSubmit?: (action: string, data: Record<string, unknown>) => void;
}

// 从双层嵌套 payload 中取内层业务字段（与 DropZoneWidget 一致）
function extractInner(payload: Record<string, unknown>): Record<string, unknown> {
  const inner = payload?.payload;
  if (inner !== null && inner !== undefined && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return payload;
}

export const HtmlWidget: React.FC<Props> = ({
  id, payload: rawPayload, isTeacher, isLocked, onUpdate, onSubmit,
}) => {
  const inner = extractInner(rawPayload);
  const title = (inner.title as string) ?? 'HTML 展示';
  const htmlVersion = (inner.htmlVersion as number) ?? 0;

  const { currentRoom } = useRoomStore();
  const roomID = currentRoom?.id ?? '';

  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showEdit, setShowEdit] = useState(false);

  // ===== REQ-043：课件互动上报桥 =====
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // 用 ref 持有最新 onSubmit，监听器只订阅一次、不随父组件重渲染反复增删
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  // ===== REQ-042 一期：全屏播放（浏览器原生 Fullscreen API，师生均可用）=====
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => {
      const d = document as Document & { webkitFullscreenElement?: Element };
      setIsFullscreen(!!(document.fullscreenElement ?? d.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  const toggleFullscreen = () => {
    const el = containerRef.current as (HTMLDivElement & {
      webkitRequestFullscreen?: () => void;
    }) | null;
    const d = document as Document & {
      webkitFullscreenElement?: Element;
      webkitExitFullscreen?: () => void;
    };
    if (document.fullscreenElement ?? d.webkitFullscreenElement) {
      (document.exitFullscreen?.bind(document) ?? d.webkitExitFullscreen?.bind(d))?.();
    } else if (el) {
      (el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el))?.();
    }
  };

  // 拉取源码：id/房间/版本变化时重取（htmlVersion 变化 = 老师改了代码）
  useEffect(() => {
    if (!id || !roomID) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/rooms/${roomID}/elements/${id}/html`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(data => { if (!cancelled) setHtml((data.html as string) ?? ''); })
      .catch(() => { if (!cancelled) setError('内容加载失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, roomID, htmlVersion]);

  // REQ-043：接收课件 iframe 通过 postMessage 上报的互动事件。
  // 沙箱 iframe（allow-scripts 无 same-origin）为 opaque 源，event.origin 恒为 "null"，
  // 故以 event.source === 本 iframe.contentWindow 作为来源校验，只收自己这个课件的事件；
  // 多个 HTML 组件并存时，每个实例只认自己的 iframe，天然互不串。
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const d = e.data as Record<string, unknown> | null;
      if (!d || (d as { type?: unknown }).type !== 'mc_event') return;
      // 白名单收敛字段；elementId 一律不信课件、由父页面（本组件 id）决定
      const out: Record<string, unknown> = {
        event: typeof d.event === 'string' ? (d.event as string).slice(0, 40) : 'interact',
      };
      if (typeof d.questionId === 'string') out.questionId = (d.questionId as string).slice(0, 80);
      if (typeof d.isCorrect === 'boolean') out.isCorrect = d.isCorrect;
      if (typeof d.score === 'number') out.score = d.score;
      if (typeof d.maxScore === 'number') out.maxScore = d.maxScore;
      if (typeof d.knowledgePoint === 'string') out.knowledgePoint = (d.knowledgePoint as string).slice(0, 100);
      if (typeof d.response === 'string') out.response = (d.response as string).slice(0, 500);
      if (d.data && typeof d.data === 'object' && !Array.isArray(d.data)) out.data = d.data;
      onSubmitRef.current?.('html_event', out);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const handleDelete = () => {
    if (confirm('确定删除这个 HTML 展示组件？删除后无法恢复。')) {
      onUpdate({ __delete: true });
    }
  };

  const handleSaveEdit = async (newTitle: string, newHtml: string) => {
    try {
      const res = await fetch(`/api/rooms/${roomID}/elements/${id}/html`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: newHtml }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error || '保存失败');
      }
      setShowEdit(false);
      setHtml(newHtml); // 本地即时更新
      // 更新标题 + bump 版本 → 经 element_update 通知全端重新拉取
      onUpdate({ title: newTitle, htmlVersion: htmlVersion + 1 });
    } catch (err) {
      alert(err instanceof Error ? err.message : '保存失败');
    }
  };

  return (
    <div
      ref={containerRef}
      className="bg-white rounded-xl shadow-lg border border-gray-200 flex flex-col h-full overflow-hidden"
      style={{ color: '#1f2937' }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm">🖥️</span>
          <span className="font-semibold text-gray-800 text-sm truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* REQ-042：全屏播放，师生均可用 */}
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? '退出全屏' : '全屏播放'}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-700 transition-colors"
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          {isTeacher && !isLocked && !isFullscreen && (
            <>
              <button
                onClick={() => setShowEdit(true)}
                title="编辑代码"
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-700 transition-colors"
              >
                <Code2 size={13} />
              </button>
              <button
                onClick={handleDelete}
                title="删除组件"
                className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 内容区：沙箱 iframe 渲染 */}
      <div className="flex-1 min-h-0 relative bg-white">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 text-xs gap-1.5">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            title={title}
            // 安全核心：只给 allow-scripts，不给 allow-same-origin
            sandbox="allow-scripts"
            srcDoc={html}
            className="w-full h-full border-0 block"
          />
        )}
      </div>

      {showEdit && (
        <HtmlCreateModal
          mode="edit"
          initialTitle={title}
          initialHtml={html}
          onConfirm={handleSaveEdit}
          onClose={() => setShowEdit(false)}
        />
      )}
    </div>
  );
};

export default HtmlWidget;
