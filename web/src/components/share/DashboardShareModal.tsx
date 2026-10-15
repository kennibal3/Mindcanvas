// =============================================================
// REQ-066 一期：看板分享弹窗（教师）
// 选房间里的一个 HTML 看板组件（默认最近更新的那个）→ 生成永久免登录链接。
// 已有链接时换组件不换链接，已经发给领导的链接继续有效；「停用」后旧链接失效。
// =============================================================
import { useCallback, useEffect, useState } from 'react';
import { X, Copy, Check, LayoutDashboard } from 'lucide-react';
import {
  getDashboardShare, putDashboardShare, deleteDashboardShare, boardLink,
  type DashboardShare, type DashboardCandidate,
} from '@/utils/dashboardShareApi';
import { formatRelativeTime } from '@/utils/relativeTime';

interface Props {
  roomId: string;
  onClose: () => void;
}

const DashboardShareModal = ({ roomId, onClose }: Props) => {
  const [share, setShare] = useState<DashboardShare | null>(null);
  const [cands, setCands] = useState<DashboardCandidate[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getDashboardShare(roomId);
      setShare(d.share);
      setCands(d.candidates);
      // 默认：已有链接用它当前的组件；否则最近更新的那个（列表第一项）
      setSelected(d.share?.element_id || d.candidates[0]?.element_id || '');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setBusy(true); setMsg('');
    try {
      const d = await putDashboardShare(roomId, selected);
      setShare(d.share);
      setMsg(share ? '已更新，链接不变' : '链接已生成');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true); setMsg('');
    try {
      await deleteDashboardShare(roomId);
      setShare(null);
      setConfirmStop(false);
      setMsg('链接已停用，旧链接打不开了');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const link = share ? boardLink(share.share_token) : '';
  const handleCopy = () => {
    if (!link) return;
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => setMsg('复制失败，请手动选中链接复制'));
  };

  const currentIsSelected = share?.element_id === selected;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div className="flex items-center gap-2 font-medium text-gray-800">
            <LayoutDashboard size={16} className="text-amber-700" /> 领导看板链接
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          <p className="text-xs leading-relaxed text-gray-500">
            对方无需登录、无需密码，打开即看到所选看板的<strong>最新版本</strong>；看板更新后刷新即可看到。链接永久有效，可随时停用。
          </p>

          {loading ? (
            <div className="py-6 text-center text-gray-400">加载中…</div>
          ) : cands.length === 0 ? (
            <div className="rounded-lg bg-gray-50 p-4 text-center text-gray-500">
              房间里还没有 HTML 看板组件。<br />先用「HTML 展示」或画布助手生成一个看板，再来这里分享。
            </div>
          ) : (
            <>
              <label className="block">
                <span className="mb-1 block text-xs text-gray-500">展示哪个看板</span>
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-amber-400 focus:outline-none"
                >
                  {cands.map((c, i) => (
                    <option key={c.element_id} value={c.element_id}>
                      {c.title}（{formatRelativeTime(c.updated_at)}更新{i === 0 ? '，最新' : ''}）
                    </option>
                  ))}
                </select>
              </label>

              {share && (
                <div className="space-y-2 rounded-lg border border-amber-100 bg-amber-50/50 p-3">
                  <div className="break-all text-xs text-gray-600">{link}</div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCopy}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-medium ${
                        copied ? 'border-green-200 bg-green-50 text-green-600' : 'border-gray-200 bg-white text-gray-600 hover:border-amber-300'
                      }`}
                    >
                      {copied ? <><Check size={13} /> 已复制</> : <><Copy size={13} /> 复制链接</>}
                    </button>
                    <a
                      href={link} target="_blank" rel="noreferrer"
                      className="flex flex-1 items-center justify-center rounded-lg border border-gray-200 bg-white py-1.5 text-xs text-gray-600 hover:border-amber-300"
                    >打开看看</a>
                  </div>
                  <div className="text-[11px] text-gray-400">已被打开 {share.view_count} 次</div>
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={busy || !selected || (!!share && currentIsSelected)}
                className="w-full rounded-lg bg-amber-600 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-40"
              >
                {share ? (currentIsSelected ? '链接已在展示这个看板' : '改为展示这个看板（链接不变）') : '生成链接'}
              </button>

              {share && (confirmStop ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  <div className="mb-2">停用后，已经发出去的链接将打不开。确定停用？</div>
                  <div className="flex gap-2">
                    <button onClick={handleStop} disabled={busy} className="flex-1 rounded-md bg-red-500 py-1.5 text-white hover:bg-red-600">确认停用</button>
                    <button onClick={() => setConfirmStop(false)} className="flex-1 rounded-md border border-gray-200 bg-white py-1.5 text-gray-600">取消</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirmStop(true)} className="w-full py-1 text-xs text-gray-400 hover:text-red-600">停用链接</button>
              ))}
            </>
          )}
          {msg && <div className="text-center text-xs text-gray-500">{msg}</div>}
        </div>
      </div>
    </div>
  );
};

export default DashboardShareModal;
