// =============================================================
// MindCanvas v4.1 - Phase 5 课堂流程执行器
// 功能：课中控制节点推进，显示进度，触发Widget提示
// =============================================================
import { useState, useEffect, useCallback } from 'react';
import { Play, SkipForward, SkipBack, Square, ChevronRight,
         Clock, Eye, EyeOff, Pencil, AlertCircle, Loader2 } from 'lucide-react';
import type { TeachingFlow, FlowNode } from '@/types/flow';
import { FLOW_NODE_TYPES } from '@/types/flow';
import {
  getFlow, activateFlow, advanceFlow, finishFlow, updateShowProgress
} from '@/utils/flowApi';

interface FlowControllerProps {
  roomId: string;
  /** 通知父组件打开编辑器 */
  onEditFlow: () => void;
  /** 通知父组件有Widget需要手动开启（传递elementId） */
  onWidgetHint?: (elementId: string, nodeTitle: string) => void;
  /** 节点进入时的画布模式变更回调 */
  onEntryModeChange?: (mode: 'free' | 'readonly' | 'follow') => void;
}

// 节点状态样式
const NODE_STATUS = {
  done:    'text-gray-300 line-through',
  current: 'text-gray-900 font-semibold',
  pending: 'text-gray-400',
};

const FlowController = ({
  roomId, onEditFlow, onWidgetHint, onEntryModeChange
}: FlowControllerProps) => {
  const [flow, setFlow] = useState<TeachingFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [widgetHint, setWidgetHint] = useState<{ elementId: string; title: string } | null>(null);
  const [error, setError] = useState('');

  // 加载流程
  const loadFlow = useCallback(async () => {
    try {
      const res = await getFlow(roomId);
      setFlow(res.flow);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => { loadFlow(); }, [loadFlow]);

  // 监听WebSocket流程更新（ctrl_flow_update）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.flow_id && flow?.id === detail.flow_id) {
        loadFlow(); // 重新加载最新流程状态
      }
    };
    window.addEventListener('ws_flow_update', handler);
    return () => window.removeEventListener('ws_flow_update', handler);
  }, [flow?.id, loadFlow]);

  // 开始上课
  const handleActivate = async () => {
    if (!flow) return;
    setActionLoading('activate');
    try {
      const res = await activateFlow(roomId, flow.id);
      setFlow(res.flow);
      // 应用第一个节点的画布模式
      if ((res.flow.nodes ?? [])[0]) {
        onEntryModeChange?.((res.flow.nodes ?? [])[0].entryMode);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // 推进节点
  const handleAdvance = async (direction: 'next' | 'prev' | 'jump', targetIndex?: number) => {
    if (!flow) return;
    setActionLoading(direction);
    try {
      const res = await advanceFlow(roomId, flow.id, {
        direction,
        target_index: targetIndex,
      });
      setFlow(res.flow);

      // 应用新节点的画布模式
      const newNode = (res.flow.nodes ?? [])[res.flow.current_node_index];
      if (newNode) {
        onEntryModeChange?.(newNode.entryMode);

        // 检查是否需要提示开启Widget
        if (newNode.type === 'interaction' && newNode.widgetElementId && newNode.autoOpenWidget) {
          setWidgetHint({ elementId: newNode.widgetElementId, title: newNode.title });
          onWidgetHint?.(newNode.widgetElementId, newNode.title);
        } else {
          setWidgetHint(null);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // 结束流程
  const handleFinish = async () => {
    if (!flow || !confirm('确定结束课堂流程？')) return;
    setActionLoading('finish');
    try {
      const res = await finishFlow(roomId, flow.id);
      setFlow(res.flow);
      onEntryModeChange?.('free'); // 恢复自由模式
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // 切换学生进度显示
  const handleToggleProgress = async () => {
    if (!flow) return;
    const newVal = !flow.show_progress_to_students;
    try {
      await updateShowProgress(roomId, flow.id, newVal);
      setFlow(prev => prev ? { ...prev, show_progress_to_students: newVal } : prev);
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={18} className="animate-spin text-gray-400" />
      </div>
    );
  }

  // 没有流程：引导创建
  if (!flow) {
    return (
      <div className="py-4 text-center">
        <p className="text-xs text-gray-400 mb-3">还没有课堂流程</p>
        <button onClick={onEditFlow}
          className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5 mx-auto">
          <Play size={12} />创建课堂流程
        </button>
      </div>
    );
  }

  const currentNode: FlowNode | undefined = (flow.nodes ?? [])[flow.current_node_index];
  const isActive = flow.status === 'active';
  const isFinished = flow.status === 'finished';
  const totalDuration = (flow.nodes ?? []).reduce((s, n) => s + n.duration, 0);

  return (
    <div className="space-y-3">
      {/* 流程标题 + 编辑按钮 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-700 truncate max-w-[160px]">{flow.title}</p>
          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
            <Clock size={10} />
            {(flow.nodes ?? []).length}节点 · {totalDuration}分钟
          </p>
        </div>
        <div className="flex items-center gap-1">
          {/* 学生进度开关 */}
          {isActive && (
            <button
              onClick={handleToggleProgress}
              title={flow.show_progress_to_students ? '隐藏学生进度' : '显示学生进度'}
              className={`p-1.5 rounded-lg text-xs transition-colors ${
                flow.show_progress_to_students
                  ? 'bg-amber-100 text-amber-700'
                  : 'text-gray-400 hover:bg-gray-100'
              }`}
            >
              {flow.show_progress_to_students ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          )}
          {/* 编辑流程（draft/active状态均可） */}
          {!isFinished && (
            <button onClick={onEditFlow}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
              title="编辑流程">
              <Pencil size={13} />
            </button>
          )}
        </div>
      </div>

      {/* 状态标签 */}
      <div className="flex items-center gap-2">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          flow.status === 'draft'    ? 'bg-gray-100 text-gray-500' :
          flow.status === 'active'   ? 'bg-green-100 text-green-700' :
                                       'bg-gray-100 text-gray-400'
        }`}>
          {flow.status === 'draft' ? '📋 草稿' : flow.status === 'active' ? '▶ 进行中' : '✅ 已结束'}
        </span>
        {isActive && (
          <span className="text-xs text-gray-400">
            {flow.current_node_index + 1} / {(flow.nodes ?? []).length}
          </span>
        )}
      </div>

      {/* Widget提示横幅 */}
      {widgetHint && isActive && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertCircle size={13} className="text-purple-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-purple-800">「{widgetHint.title}」有绑定互动</p>
            <p className="text-xs text-purple-500 mt-0.5">请手动点击画布上的组件开启</p>
          </div>
          <button onClick={() => setWidgetHint(null)}
            className="text-purple-300 hover:text-purple-500 flex-shrink-0">×</button>
        </div>
      )}

      {/* 节点列表（可视化进度） */}
      {(flow.nodes ?? []).length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {(flow.nodes ?? []).map((node, idx) => {
            const isCurrent = isActive && idx === flow.current_node_index;
            const isDone = isActive && idx < flow.current_node_index;
            const meta = FLOW_NODE_TYPES[node.type];

            return (
              <div
                key={node.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                  isCurrent ? 'bg-amber-50 border border-amber-200' :
                  isDone    ? 'opacity-50' : ''
                }`}
              >
                <span className="text-sm flex-shrink-0">{meta.icon}</span>
                <span className={`text-xs flex-1 truncate ${
                  isCurrent ? NODE_STATUS.current :
                  isDone    ? NODE_STATUS.done :
                              NODE_STATUS.pending
                }`}>
                  {node.title}
                </span>
                <span className="text-xs text-gray-300 flex-shrink-0">{node.duration}m</span>
                {/* 跳转按钮（active模式下，非当前节点显示） */}
                {isActive && !isCurrent && (
                  <button
                    onClick={() => handleAdvance('jump', idx)}
                    disabled={!!actionLoading}
                    className="text-xs text-gray-300 hover:text-amber-700 transition-colors flex-shrink-0"
                    title={`跳到第${idx + 1}节`}
                  >
                    <ChevronRight size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 控制按钮区 */}
      <div className="pt-1">
        {flow.status === 'draft' && (
          <button
            onClick={handleActivate}
            disabled={!!actionLoading || (flow.nodes ?? []).length === 0}
            className="w-full btn-primary text-xs py-2 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {actionLoading === 'activate'
              ? <Loader2 size={13} className="animate-spin" />
              : <Play size={13} />}
            开始上课
          </button>
        )}

        {flow.status === 'active' && (
          <div className="flex gap-2">
            <button
              onClick={() => handleAdvance('prev')}
              disabled={!!actionLoading || flow.current_node_index === 0}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium bg-gray-50 text-gray-600 hover:bg-gray-100 disabled:opacity-30 transition-colors"
            >
              {actionLoading === 'prev'
                ? <Loader2 size={12} className="animate-spin" />
                : <SkipBack size={12} />}
              上一节
            </button>

            {flow.current_node_index < (flow.nodes ?? []).length - 1 ? (
              <button
                onClick={() => handleAdvance('next')}
                disabled={!!actionLoading}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50 transition-colors"
              >
                {actionLoading === 'next'
                  ? <Loader2 size={12} className="animate-spin" />
                  : <SkipForward size={12} />}
                下一节
              </button>
            ) : (
              <button
                onClick={handleFinish}
                disabled={!!actionLoading}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors"
              >
                {actionLoading === 'finish'
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Square size={12} />}
                结束课程
              </button>
            )}
          </div>
        )}

        {flow.status === 'finished' && (
          <div className="text-center py-2">
            <p className="text-xs text-gray-400">课堂流程已结束</p>
            <button onClick={onEditFlow}
              className="text-xs text-amber-700 hover:underline mt-1">
              查看流程详情
            </button>
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 text-red-600 text-xs px-3 py-2 rounded-lg flex items-center gap-2">
          <AlertCircle size={12} />
          {error}
          <button onClick={() => setError('')} className="ml-auto text-red-300 hover:text-red-500">×</button>
        </div>
      )}
    </div>
  );
};

export default FlowController;
