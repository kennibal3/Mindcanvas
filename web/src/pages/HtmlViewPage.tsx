// =============================================================
// REQ-067：HTML 展示组件「新标签页打开」专用页 /view/html/:roomId/:eid
// 整页展示一个 HTML 展示组件（单文件或 zip 课件包），适合投到第二块屏幕。
// 安全模型与房间内 HtmlWidget 完全一致：iframe sandbox="allow-scripts"、不给 allow-same-origin，
// 课件脚本处于 opaque 源，拿不到本站 Cookie/localStorage。
// 刻意不让浏览器顶层直接打开课件文件地址——那样课件就和本站同源了。
// 数据走与房间内相同的两个接口（OptionalAuth，带 Cookie）。
// =============================================================
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const HtmlViewPage = () => {
  const { roomId, eid } = useParams<{ roomId: string; eid: string }>();
  const [html, setHtml] = useState('');
  const [entryUrl, setEntryUrl] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!roomId || !eid) return;
    let cancelled = false;
    const base = `/api/rooms/${roomId}/elements/${eid}`;
    // 先问是不是 zip 课件；不是再拉单文件源码（与 HtmlWidget 的两条路对应）
    fetch(`${base}/courseware`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(async data => {
        if (cancelled) return;
        if (data?.is_courseware) {
          const entry = ((data.entry_file as string) || 'index.html')
            .split('/').map(encodeURIComponent).join('/');
          setEntryUrl(`${base}/courseware/files/${entry}`);
          setReady(true);
          return;
        }
        const r = await fetch(`${base}/html`, { credentials: 'include' });
        if (!r.ok) throw new Error('内容加载失败');
        const d = await r.json();
        if (!cancelled) { setHtml((d.html as string) ?? ''); setReady(true); }
      })
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : '内容加载失败'));
    return () => { cancelled = true; };
  }, [roomId, eid]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-600 text-sm">{error}</div>
    );
  }
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-sm text-gray-400">加载中…</div>
    );
  }
  return (
    <div className="fixed inset-0 bg-white">
      <iframe
        title="HTML 展示"
        sandbox="allow-scripts"
        {...(entryUrl ? { src: entryUrl } : { srcDoc: html })}
        className="w-full h-full border-0"
      />
    </div>
  );
};

export default HtmlViewPage;
