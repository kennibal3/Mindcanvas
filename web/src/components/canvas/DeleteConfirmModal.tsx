// =============================================================
// BUG-020 二期：批量删除画布元素前的二次确认弹窗
//
// 背景：8-11 事故（房间 5f160f5d 286 个元素一次清空）之后，一期在服务端
// 补了快照+熔断+审计日志兜底（scene_snapshot.go），但触发条件本身没变——
// 老师依然可以一键清空整块画布，前端零提示。这里补的就是那个提示。
//
// 沿用 ControlPanel.tsx 里 REQ-006 的方案：React 内联 Modal 而不是
// window.confirm——后者是同步阻塞的，会冻结整个页面，协作画布场景下
// 代价太大（别人这时候还在画布上操作，页面卡住体验很差）。
// 没有直接从 ControlPanel.tsx 里 export 复用，是因为那个 ConfirmModal
// 是私有组件、且带了一堆本场景用不到的可选项（confirmText/confirmClass
// 等）；CanvasEngine 也不在同一个子目录下。这里单独建一个更小的版本，
// 保持改动面小，不动 ControlPanel.tsx 已经验证过的代码。
// =============================================================
import { AlertTriangle } from 'lucide-react';

interface DeleteConfirmModalProps {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteConfirmModal = ({ count, onConfirm, onCancel }: DeleteConfirmModalProps) => (
  // zIndex 沿用 ControlPanel.tsx REQ-006 弹窗的做法：必须盖过 Excalidraw 自身图层。
  <div
    className="fixed inset-0 bg-black/50 flex items-center justify-center animate-fade-in"
    style={{ zIndex: 2147483647 }}
  >
    <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0">
          <AlertTriangle size={20} className="text-amber-500" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-800">确认删除</h3>
          <p className="text-sm text-gray-500 mt-1">
            即将删除 {count} 个元素，删除后不能在画布上直接撤销。确定继续吗？
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 text-sm font-medium rounded-lg transition-colors bg-red-500 hover:bg-red-600 text-white"
        >
          确认删除
        </button>
      </div>
    </div>
  </div>
);

export default DeleteConfirmModal;
