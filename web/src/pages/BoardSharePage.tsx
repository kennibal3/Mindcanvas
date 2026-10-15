// =============================================================
// REQ-066 一期：看板分享公开页 /board/:token（免登录、免密码、永久有效）
// 给领导看：整页展示房间里指定 HTML 看板组件（如「项目驾驶舱」）的最新版本。
// 安全模型与房间内 HtmlWidget 一致：iframe sandbox="allow-scripts"、不给 allow-same-origin，
// 看板脚本处于 opaque 源，拿不到本站 Cookie/localStorage。
// =============================================================
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicBoard, type PublicBoard } from '@/utils/dashboardShareApi';

const BoardSharePage = () => {
  const { token } = useParams<{ token: string }>();
  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getPublicBoard(token)
      .then((b) => {
        if (cancelled) return;
        setBoard(b);
        document.title = `${b.title} · ${b.room_title}`;
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : '加载失败'));
    return () => { cancelled = true; };
  }, [token]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <div className="text-4xl mb-3">📊</div>
          <div className="text-gray-700 font-medium">{error}</div>
          <div className="text-xs text-gray-400 mt-2">MindCanvas 看板分享</div>
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-sm text-gray-400">
        看板加载中…
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-white">
      <iframe
        title={board.title}
        srcDoc={board.html}
        sandbox="allow-scripts"
        className="w-full h-full border-0"
      />
      <div className="fixed bottom-2 right-3 text-[11px] text-gray-400 bg-white/80 rounded px-2 py-0.5 pointer-events-none">
        更新于 {new Date(board.updated_at).toLocaleString('zh-CN', { hour12: false })}
      </div>
    </div>
  );
};

export default BoardSharePage;
