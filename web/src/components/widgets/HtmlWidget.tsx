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
import { Code2, Trash2, Loader2, AlertTriangle, Maximize2, Minimize2, RotateCw, ExternalLink } from 'lucide-react';
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
  // REQ-059：组件有两种来源。
  //   inline（默认，兼容全部存量组件）＝老师粘贴的单文件源码，srcDoc 渲染
  //   zip                              ＝导入的多文件课件包，iframe src 指向后端下发
  // 存量组件 payload 里没有 source 字段，?? 'inline' 保证零回归。
  const isZip = (inner.source as string) === 'zip';

  const { currentRoom } = useRoomStore();
  const roomID = currentRoom?.id ?? '';

  const [html, setHtml] = useState('');
  const [entryUrl, setEntryUrl] = useState('');
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
  // REQ-067：全屏展示比例。fit＝铺满整个屏幕；16:9 / 4:3＝内容区按比例居中放到最大（四周黑边）
  const [presentRatio, setPresentRatio] = useState<'fit' | '16:9' | '4:3'>('fit');

  useEffect(() => {
    const onFsChange = () => {
      const d = document as Document & { webkitFullscreenElement?: Element };
      const fs = !!(document.fullscreenElement ?? d.webkitFullscreenElement);
      setIsFullscreen(fs);
      if (!fs) setPresentRatio('fit'); // 退出全屏后复位，下次按 F / 全屏键仍是铺满
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  // REQ-067：刷新（重挂 iframe，课件回到初始状态）与快捷键 F（鼠标悬停在组件上时全屏/退出）
  const [reloadKey, setReloadKey] = useState(0);
  const hoverRef = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hoverRef.current || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== 'f' && e.key !== 'F') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      toggleFullscreenRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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

  const toggleFullscreenRef = useRef(toggleFullscreen);
  toggleFullscreenRef.current = toggleFullscreen;

  // REQ-067：教师预设条（FloatingWidgets，在缩放容器之外）通过窗口事件触发全屏展示。
  // 点击手势的「用户激活」会随同步派发的事件一并带到这里，requestFullscreen 才不会被浏览器拒绝。
  useEffect(() => {
    const onPresent = (e: Event) => {
      const d = (e as CustomEvent<{ id?: string; ratio?: 'fit' | '16:9' | '4:3' }>).detail;
      if (!d || d.id !== id) return;
      setPresentRatio(d.ratio ?? 'fit');
      const el = containerRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
      const doc = document as Document & { webkitFullscreenElement?: Element };
      if (el && !(document.fullscreenElement ?? doc.webkitFullscreenElement)) {
        (el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el))?.();
      }
    };
    window.addEventListener('mc-html-present', onPresent);
    return () => window.removeEventListener('mc-html-present', onPresent);
  }, [id]);

  // REQ-067：新标签页打开。不能直接打开课件文件地址——顶层页面是本站同源，课件脚本就能读登录信息；
  // 所以打开的是一个专用页面，里面仍是 sandbox="allow-scripts" 的 iframe，安全模型不变。
  const openInNewTab = () => {
    if (!roomID) return;
    window.open(`/view/html/${roomID}/${id}`, '_blank', 'noopener');
  };

  // 拉取内容：id/房间/版本变化时重取（htmlVersion 变化 = 老师改了代码）
  //
  // zip 课件走另一条路：不拉源码，只问后端要入口文件名，然后让 iframe 直接 src 过去。
  // 为什么必须是 src 而不是 srcDoc——srcDoc 的文档没有 base URL，
  // 课件里的 <img src="assets/x.jpg"> 与 CSS url('assets/y.png') 全部解析不了。
  // 而 sandbox 不带 allow-same-origin 时，即便 src 指向本站路径，
  // 文档仍处于 opaque 源，拿不到 Cookie/localStorage，安全模型与 srcDoc 时代一致。
  useEffect(() => {
    if (!id || !roomID) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    if (isZip) {
      fetch(`/api/rooms/${roomID}/elements/${id}/courseware`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
        .then(data => {
          if (cancelled) return;
          if (!data.is_courseware) { setError('课件内容缺失'); return; }
          const entry = ((data.entry_file as string) || 'index.html')
            .split('/').map(encodeURIComponent).join('/');
          setEntryUrl(`/api/rooms/${roomID}/elements/${id}/courseware/files/${entry}`);
        })
        .catch(() => { if (!cancelled) setError('课件加载失败'); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }

    fetch(`/api/rooms/${roomID}/elements/${id}/html`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(data => { if (!cancelled) setHtml((data.html as string) ?? ''); })
      .catch(() => { if (!cancelled) setError('内容加载失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, roomID, htmlVersion, isZip]);

  // REQ-043：接收课件 iframe 通过 postMessage 上报的互动事件。
  // 沙箱 iframe（allow-scripts 无 same-origin）为 opaque 源，event.origin 恒为 "null"，
  // 故以 event.source === 本 iframe.contentWindow 作为来源校验，只收自己这个课件的事件；
  // 多个 HTML 组件并存时，每个实例只认自己的 iframe，天然互不串。
  //
  // ⚠️ REQ-059 已知限制（2026-08-05 拆真实课件包时发现，一期不修但必须记着）：
  // 真实 zip 课件自己内部还套了一层 iframe（index.html 里是
  // <iframe id="cw-frame" src="p1.html">，翻页靠改这个 frame 的 src）。
  // 此时事件从**孙子窗口**发出，e.source 不等于本 iframe 的 contentWindow，
  // 会被下面这行**静默丢弃**。目前这些外部 AI 工具产出的课件本来也不按
  // mc_event_v1 契约发消息，所以一期无人受影响——但正因为无人察觉，
  // 它与 REQ-050 丢节点 / REQ-057 丢文字 / REQ-058 丢要点是同一类结构。
  // 将来要从 zip 课件收互动数据时，这里要放宽成「遍历本 iframe 的后代窗口」，
  // 或改用带课件包 id 的消息签名，不能只是把校验删掉。
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
      onMouseEnter={() => { hoverRef.current = true; }}
      onMouseLeave={() => { hoverRef.current = false; }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm">🖥️</span>
          <span className="font-semibold text-gray-800 text-sm truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* REQ-067：刷新 / 新标签页打开，师生均可用 */}
          <button
            onClick={() => setReloadKey(k => k + 1)}
            title="刷新（课件回到初始状态）"
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-700 transition-colors"
          >
            <RotateCw size={14} />
          </button>
          <button
            onClick={openInNewTab}
            title="在新标签页打开"
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-700 transition-colors"
          >
            <ExternalLink size={14} />
          </button>
          {/* REQ-042：全屏播放，师生均可用。REQ-067：做成带文字的琥珀色按钮，老师一眼能找到 */}
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? '退出全屏（Esc）' : '全屏播放（鼠标悬停时按 F）'}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors"
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {isFullscreen ? '退出全屏' : '全屏'}
          </button>
          {isTeacher && !isLocked && !isFullscreen && (
            <>
              {/* zip 课件没有「一段源码」可编辑（是一整个目录树），故不给编辑按钮。
                  要换内容就删掉重新导入——一期刻意不做「替换包」，
                  因为替换涉及旧目录清理与并发访问，值得单独想清楚再做。 */}
              {!isZip && (
                <button
                  onClick={() => setShowEdit(true)}
                  title="编辑代码"
                  className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-700 transition-colors"
                >
                  <Code2 size={13} />
                </button>
              )}
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
      <div
        className={`flex-1 min-h-0 relative ${isFullscreen && presentRatio !== 'fit' ? 'bg-black flex items-center justify-center' : 'bg-white'}`}
      >
        {/* 内层始终存在、只改样式，避免进出全屏时重挂 iframe 丢课件状态。
            16:9 / 4:3：全屏元素即整个视口，宽取「视口宽」与「(视口高 − 标题栏 41px) × 比例」的较小值，高由 aspect-ratio 推出 */}
        <div
          className={isFullscreen && presentRatio !== 'fit' ? 'relative bg-white' : 'w-full h-full relative'}
          style={isFullscreen && presentRatio !== 'fit' ? {
            width: `min(100vw, calc((100vh - 41px) * ${presentRatio === '16:9' ? 16 / 9 : 4 / 3}))`,
            aspectRatio: presentRatio === '16:9' ? '16 / 9' : '4 / 3',
          } : undefined}
        >        {loading ? (
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
            // 安全核心：只给 allow-scripts，不给 allow-same-origin。
            // 对 zip 课件同样成立——src 指向本站路径不代表同源，
            // 没有 allow-same-origin 时文档一律是 opaque 源。
            // sandbox 标志还会被课件内部那层 iframe 继承，孙子拿不到更多权限。
            sandbox="allow-scripts"
            {...(isZip ? { src: entryUrl } : { srcDoc: html })}
            key={reloadKey}
            className="absolute inset-0 w-full h-full border-0 block"
          />
        )}
        </div>
        {/* REQ-067：内容区右上角常驻的大号全屏按钮（半透明，悬停变实），不再只靠标题栏小图标 */}
        {!loading && !error && !isFullscreen && (
          <button
            onClick={toggleFullscreen}
            title="全屏播放（鼠标悬停时按 F）"
            className="absolute top-2 right-2 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                       bg-black/50 text-white opacity-60 hover:opacity-100 hover:bg-black/70 transition-opacity shadow"
          >
            <Maximize2 size={16} />
            全屏
          </button>
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
