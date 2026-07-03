// =============================================================
// MindCanvas v4.1 - Phase 5 流程节点卡片
// 支持：展示/编辑节点信息，拖拽排序手柄
// =============================================================
import { useState } from 'react';
import { GripVertical, ChevronDown, ChevronUp, Trash2, Link2, X } from 'lucide-react';
import type { FlowNode, FlowNodeType, FlowNodeEntryMode } from '@/types/flow';
import { FLOW_NODE_TYPES, ENTRY_MODES } from '@/types/flow';

interface FlowNodeCardProps {
  node: FlowNode;
  index: number;
  total: number;
  /** 可绑定的Widget列表（来自画布元素） */
  availableWidgets: { id: string; title: string; type: string }[];
  onChange: (updated: FlowNode) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /** 是否处于只读模式（流程进行中不允许删除） */
  readOnly?: boolean;
}

// 节点类型色彩映射
const TYPE_COLORS: Record<FlowNodeType, string> = {
  lecture:     'border-l-amber-400 bg-amber-50',
  discussion:  'border-l-green-400 bg-green-50',
  interaction: 'border-l-purple-400 bg-purple-50',
  break:       'border-l-orange-400 bg-orange-50',
  review:      'border-l-gray-400 bg-gray-50',
};

const TYPE_BADGE: Record<FlowNodeType, string> = {
  lecture:     'bg-amber-100 text-amber-800',
  discussion:  'bg-green-100 text-green-700',
  interaction: 'bg-purple-100 text-purple-700',
  break:       'bg-orange-100 text-orange-700',
  review:      'bg-gray-100 text-gray-600',
};

const FlowNodeCard = ({
  node, index, total, availableWidgets,
  onChange, onDelete, onMoveUp, onMoveDown, readOnly = false,
}: FlowNodeCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const meta = FLOW_NODE_TYPES[node.type];

  // 更新节点单个字段
  const update = <K extends keyof FlowNode>(key: K, value: FlowNode[K]) => {
    onChange({ ...node, [key]: value });
  };

  return (
    <div className={`border-l-4 rounded-lg border border-gray-100 ${TYPE_COLORS[node.type]} transition-all`}>
      {/* 节点头部：始终可见 */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* 拖拽手柄（仅视觉，实际拖拽由父组件实现） */}
        <div className="text-gray-300 cursor-grab active:cursor-grabbing flex-shrink-0">
          <GripVertical size={16} />
        </div>

        {/* 序号 */}
        <span className="text-xs font-bold text-gray-400 w-5 flex-shrink-0">{index + 1}</span>

        {/* 类型图标 */}
        <span className="text-base flex-shrink-0">{meta.icon}</span>

        {/* 节点标题（可内联编辑） */}
        <input
          type="text"
          value={node.title}
          onChange={e => update('title', e.target.value)}
          className="flex-1 bg-transparent text-sm font-medium text-gray-800 border-none outline-none focus:bg-white focus:px-1 focus:rounded transition-all"
          placeholder="节点标题"
          disabled={readOnly}
        />

        {/* 时长 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <input
            type="number"
            value={node.duration}
            onChange={e => update('duration', Math.max(1, Number(e.target.value)))}
            className="w-10 text-xs text-center bg-white border border-gray-200 rounded px-1 py-0.5 outline-none focus:border-amber-300"
            min={1} max={90}
            disabled={readOnly}
          />
          <span className="text-xs text-gray-400">分</span>
        </div>

        {/* 类型标签 */}
        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${TYPE_BADGE[node.type]}`}>
          {meta.label}
        </span>

        {/* 展开/收起 */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-gray-400 hover:text-gray-600 flex-shrink-0"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {/* 上移/下移/删除 */}
        {!readOnly && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button onClick={onMoveUp} disabled={index === 0}
              className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20 transition-colors"
              title="上移">▲</button>
            <button onClick={onMoveDown} disabled={index === total - 1}
              className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20 transition-colors"
              title="下移">▼</button>
            <button onClick={onDelete}
              className="p-0.5 text-gray-300 hover:text-red-500 transition-colors ml-1"
              title="删除节点">
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {/* 展开的详细配置 */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3 border-t border-white/60">
          {/* 节点类型选择 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5 mt-2">节点类型</label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(FLOW_NODE_TYPES) as FlowNodeType[]).map(t => (
                <button
                  key={t}
                  onClick={() => update('type', t)}
                  disabled={readOnly}
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all ${
                    node.type === t
                      ? TYPE_BADGE[t] + ' ring-1 ring-current'
                      : 'bg-white text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <span>{FLOW_NODE_TYPES[t].icon}</span>
                  <span>{FLOW_NODE_TYPES[t].label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 进入模式 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">进入时画布模式</label>
            <div className="flex gap-1.5">
              {(Object.keys(ENTRY_MODES) as FlowNodeEntryMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => update('entryMode', mode)}
                  disabled={readOnly}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    node.entryMode === mode
                      ? 'bg-white shadow border border-amber-200 text-amber-800'
                      : 'bg-white/60 text-gray-500 hover:bg-white'
                  }`}
                  title={ENTRY_MODES[mode].desc}
                >
                  {ENTRY_MODES[mode].label}
                </button>
              ))}
            </div>
          </div>

          {/* 绑定Widget（仅interaction类型显示） */}
          {node.type === 'interaction' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                绑定互动组件
                <span className="text-gray-400 font-normal ml-1">（画布上的Widget）</span>
              </label>
              {availableWidgets.length === 0 ? (
                <p className="text-xs text-gray-400 bg-white/60 rounded-lg px-3 py-2">
                  画布上暂无Widget，请先在画布上创建投票/问答/词云等组件
                </p>
              ) : (
                <div className="space-y-1">
                  {/* 未绑定选项 */}
                  <button
                    onClick={() => update('widgetElementId', '')}
                    disabled={readOnly}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${
                      !node.widgetElementId
                        ? 'bg-white shadow border border-gray-200 text-gray-700'
                        : 'bg-white/60 text-gray-400 hover:bg-white'
                    }`}
                  >
                    <X size={12} />
                    <span>不绑定</span>
                  </button>
                  {availableWidgets.map(w => (
                    <button
                      key={w.id}
                      onClick={() => update('widgetElementId', w.id)}
                      disabled={readOnly}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${
                        node.widgetElementId === w.id
                          ? 'bg-white shadow border border-purple-200 text-purple-700'
                          : 'bg-white/60 text-gray-500 hover:bg-white'
                      }`}
                    >
                      <Link2 size={12} />
                      <span className="truncate">{w.title}</span>
                      <span className="text-gray-300 ml-auto">{w.type}</span>
                    </button>
                  ))}
                </div>
              )}
              {/* 自动提示开关 */}
              {node.widgetElementId && (
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={node.autoOpenWidget}
                    onChange={e => update('autoOpenWidget', e.target.checked)}
                    disabled={readOnly}
                    className="rounded accent-purple-500"
                  />
                  <span className="text-xs text-gray-600">进入此节点时弹出提示开启Widget</span>
                </label>
              )}
            </div>
          )}

          {/* 教师备注 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              教师备注
              <span className="text-gray-400 font-normal ml-1">（仅自己可见）</span>
            </label>
            <textarea
              value={node.notes}
              onChange={e => update('notes', e.target.value)}
              disabled={readOnly}
              className="w-full text-xs bg-white/80 border border-gray-100 rounded-lg px-2 py-1.5 outline-none focus:border-amber-200 resize-none"
              rows={2}
              placeholder="添加备注提醒..."
            />
          </div>

          {/* 学生可见开关 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={node.showToStudents}
              onChange={e => update('showToStudents', e.target.checked)}
              disabled={readOnly}
              className="rounded accent-amber-700"
            />
            <span className="text-xs text-gray-600">在学生端进度条中显示此节点标题</span>
          </label>
        </div>
      )}
    </div>
  );
};

export default FlowNodeCard;
