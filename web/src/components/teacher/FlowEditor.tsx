// =============================================================
// MindCanvas v4.1 - Phase 5 课堂流程编辑器
// 功能：课前备课，创建/编辑流程节点
// 支持：从文本大纲快速解析节点
// =============================================================
import { useState, useCallback } from 'react';
import { X, Plus, FileText, Save, Loader2, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import type { FlowNode, FlowNodeType, TeachingFlow } from '@/types/flow';
import { FLOW_NODE_TYPES, createDefaultNode } from '@/types/flow';
import { createFlow, updateFlow } from '@/utils/flowApi';
import FlowNodeCard from './FlowNodeCard';

interface FlowEditorProps {
  roomId: string;
  /** 现有流程（编辑模式），null为创建模式 */
  existingFlow: TeachingFlow | null;
  /** 画布上可绑定的Widget列表 */
  availableWidgets: { id: string; title: string; type: string }[];
  onSaved: (flow: TeachingFlow) => void;
  onClose: () => void;
}

// 文本大纲解析：按行/序号/标题识别节点
function parseOutlineToNodes(text: string): FlowNode[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const nodes: FlowNode[] = [];

  for (const line of lines) {
    // 去除序号前缀：1. / 一、 / - / # 等
    const cleaned = line
      .replace(/^[\d]+[\.、。\)）]\s*/, '')
      .replace(/^[一二三四五六七八九十]+[、。\s]+/, '')
      .replace(/^[-#*]+\s*/, '')
      .trim();

    if (!cleaned || cleaned.length < 2) continue;

    // 根据关键词猜测节点类型
    let type: FlowNodeType = 'lecture';
    if (/互动|投票|问答|词云|作品|测试|检测|评价/.test(cleaned)) type = 'interaction';
    else if (/讨论|协作|小组|交流/.test(cleaned)) type = 'discussion';
    else if (/休息|课间|放松/.test(cleaned)) type = 'break';
    else if (/总结|回顾|复习|小结/.test(cleaned)) type = 'review';

    const node = createDefaultNode(type);
    node.title = cleaned.slice(0, 40); // 标题最长40字
    nodes.push(node);
  }

  return nodes;
}

const FlowEditor = ({ roomId, existingFlow, availableWidgets, onSaved, onClose }: FlowEditorProps) => {
  const [title, setTitle] = useState(existingFlow?.title || '课堂流程');
  const [nodes, setNodes] = useState<FlowNode[]>(existingFlow?.nodes || []);
  const [showProgress, setShowProgress] = useState(existingFlow?.show_progress_to_students || false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showOutline, setShowOutline] = useState(false);
  const [outlineText, setOutlineText] = useState('');

  // 计算总时长
  const totalDuration = nodes.reduce((sum, n) => sum + n.duration, 0);

  // 添加节点
  const addNode = useCallback((type: FlowNodeType = 'lecture') => {
    setNodes(prev => [...prev, createDefaultNode(type)]);
  }, []);

  // 更新节点
  const updateNode = useCallback((index: number, updated: FlowNode) => {
    setNodes(prev => prev.map((n, i) => i === index ? updated : n));
  }, []);

  // 删除节点
  const deleteNode = useCallback((index: number) => {
    setNodes(prev => prev.filter((_, i) => i !== index));
  }, []);

  // 上移节点
  const moveUp = useCallback((index: number) => {
    if (index === 0) return;
    setNodes(prev => {
      const arr = [...prev];
      [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
      return arr;
    });
  }, []);

  // 下移节点
  const moveDown = useCallback((index: number) => {
    setNodes(prev => {
      if (index >= prev.length - 1) return prev;
      const arr = [...prev];
      [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
      return arr;
    });
  }, []);

  // 从文本大纲解析
  const handleParseOutline = useCallback(() => {
    if (!outlineText.trim()) return;
    const parsed = parseOutlineToNodes(outlineText);
    if (parsed.length === 0) {
      setError('未能识别到有效节点，请检查文本格式');
      return;
    }
    setNodes(prev => [...prev, ...parsed]);
    setOutlineText('');
    setShowOutline(false);
    setError('');
  }, [outlineText]);

  // 保存流程
  const handleSave = async () => {
    if (!title.trim()) { setError('请输入流程标题'); return; }
    if (nodes.length === 0) { setError('请至少添加一个节点'); return; }

    setSaving(true);
    setError('');
    try {
      let result: { flow: TeachingFlow };
      if (existingFlow) {
        result = await updateFlow(roomId, existingFlow.id, {
          title: title.trim(),
          nodes,
          show_progress_to_students: showProgress,
        });
      } else {
        result = await createFlow(roomId, {
          title: title.trim(),
          nodes,
          show_progress_to_students: showProgress,
        });
      }
      onSaved(result.flow);
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {existingFlow ? '编辑课堂流程' : '创建课堂流程'}
            </h2>
            {nodes.length > 0 && (
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                <Clock size={11} />
                {nodes.length} 个节点 · 共 {totalDuration} 分钟
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        {/* 滚动内容区 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* 流程标题 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">流程标题</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-300"
              placeholder="例如：Python基础第3课"
            />
          </div>

          {/* 导入大纲折叠区 */}
          <div className="border border-dashed border-gray-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowOutline(!showOutline)}
              className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
            >
              <FileText size={15} />
              <span>从教案/大纲文字快速生成节点</span>
              {showOutline ? <ChevronUp size={14} className="ml-auto" /> : <ChevronDown size={14} className="ml-auto" />}
            </button>
            {showOutline && (
              <div className="px-4 pb-4 space-y-2 bg-gray-50">
                <p className="text-xs text-gray-400">
                  粘贴教案文字，每行识别为一个节点。支持序号（1. 一、-）开头的格式。
                </p>
                <textarea
                  value={outlineText}
                  onChange={e => setOutlineText(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-amber-300 bg-white resize-none"
                  rows={5}
                  placeholder={'1. 课程导入\n2. 知识讲解\n3. 课堂互动\n4. 小组讨论\n5. 课堂总结'}
                />
                <button
                  onClick={handleParseOutline}
                  disabled={!outlineText.trim()}
                  className="btn-primary text-xs py-1.5 px-4 disabled:opacity-50"
                >
                  解析并添加节点
                </button>
              </div>
            )}
          </div>

          {/* 节点列表 */}
          {nodes.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <p className="text-sm">还没有节点</p>
              <p className="text-xs mt-1">点击下方按钮添加第一个节点</p>
            </div>
          ) : (
            <div className="space-y-2">
              {nodes.map((node, index) => (
                <FlowNodeCard
                  key={node.id}
                  node={node}
                  index={index}
                  total={nodes.length}
                  availableWidgets={availableWidgets}
                  onChange={updated => updateNode(index, updated)}
                  onDelete={() => deleteNode(index)}
                  onMoveUp={() => moveUp(index)}
                  onMoveDown={() => moveDown(index)}
                />
              ))}
            </div>
          )}

          {/* 添加节点按钮组 */}
          <div>
            <p className="text-xs text-gray-400 mb-2">添加节点</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(FLOW_NODE_TYPES) as FlowNodeType[]).map(type => (
                <button
                  key={type}
                  onClick={() => addNode(type)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200 transition-colors"
                >
                  <span>{FLOW_NODE_TYPES[type].icon}</span>
                  <span>+ {FLOW_NODE_TYPES[type].label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 学生进度开关 */}
          <div className="flex items-center justify-between px-3 py-2.5 bg-amber-50 rounded-xl">
            <div>
              <p className="text-xs font-medium text-amber-900">学生端进度条</p>
              <p className="text-xs text-amber-600 mt-0.5">开启后学生可看到当前第几节/共几节</p>
            </div>
            <button
              onClick={() => setShowProgress(!showProgress)}
              className={`relative w-10 h-5 rounded-full transition-colors ${showProgress ? 'bg-amber-600' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${showProgress ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 text-xs px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            {nodes.length > 0 && `${nodes.length} 个节点，共 ${totalDuration} 分钟`}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-sm py-1.5 px-4">取消</button>
            <button
              onClick={handleSave}
              disabled={saving || nodes.length === 0}
              className="btn-primary text-sm py-1.5 px-4 flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? '保存中...' : '保存流程'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FlowEditor;
