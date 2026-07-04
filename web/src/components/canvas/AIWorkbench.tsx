/**
 * AIWorkbench.tsx
 * 左侧 AI 图形工作台（仅教师可见）
 *
 * 功能：
 *   - 可折叠侧边栏（展开 300px / 收起 40px）
 *   - 内联生成流程（选类型 → 输入文本 → 生成 → 存历史）
 *   - 历史记录持久化（localStorage，按 roomId 隔离）
 *   - 每条历史可：插入画布 / 重新生成 / 删除
 *   - 最多保存 20 条，超出自动删最旧
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Clock,
  Users,
  Fish,
  Network,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
  RotateCcw,
  Plus,
  ArrowUpRight,
  X,
} from "lucide-react";
import { generateDiagram, type DiagramType } from "../../utils/diagramApi";
import { buildDiagramElements, type DiagramData } from "../../utils/diagramBuilder";
import { useCanvasStore } from "../../store/canvasStore";

// ─────────────────────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────────────────────
interface WorkbenchItem {
  id: string;
  type: DiagramType;
  title: string;        // 根节点 label
  data: DiagramData;
  inputText: string;    // 原始输入，用于重新生成
  createdAt: string;    // ISO 时间
}

type GenStep = "idle" | "type" | "input" | "generating" | "done" | "error";

// ─────────────────────────────────────────────────────────────
// 图形类型配置
// ─────────────────────────────────────────────────────────────
const DIAGRAM_TYPES: { id: DiagramType; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "mindmap",   label: "思维导图", icon: <Network  size={16} />, desc: "概念梳理·大纲" },
  { id: "flowchart", label: "流程图",   icon: <GitBranch size={16} />, desc: "步骤·算法" },
  { id: "timeline",  label: "时间轴",   icon: <Clock    size={16} />, desc: "历史·里程碑" },
  { id: "orgchart",  label: "架构图",   icon: <Users    size={16} />, desc: "层级·结构" },
  { id: "fishbone",  label: "鱼骨图",   icon: <Fish     size={16} />, desc: "原因·分析" },
];

const TYPE_LABEL: Record<DiagramType, string> = {
  mindmap:   "思维导图",
  flowchart: "流程图",
  timeline:  "时间轴",
  orgchart:  "架构图",
  fishbone:  "鱼骨图",
};

const TYPE_ICON: Record<DiagramType, React.ReactNode> = {
  mindmap:   <Network  size={14} />,
  flowchart: <GitBranch size={14} />,
  timeline:  <Clock    size={14} />,
  orgchart:  <Users    size={14} />,
  fishbone:  <Fish     size={14} />,
};

const MAX_HISTORY = 20;
const STORAGE_KEY = (roomId: string) => `mc_ai_workbench_${roomId}`;

// ─────────────────────────────────────────────────────────────
// 工具：localStorage 历史管理
// ─────────────────────────────────────────────────────────────
function loadHistory(roomId: string): WorkbenchItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(roomId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(roomId: string, items: WorkbenchItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY(roomId), JSON.stringify(items.slice(0, MAX_HISTORY)));
  } catch { /* ignore quota errors */ }
}

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────
interface AIWorkbenchProps {
  roomId: string;
  isTeacher: boolean;
}

// ─────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────
export default function AIWorkbench({ roomId, isTeacher }: AIWorkbenchProps) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<WorkbenchItem[]>(() => loadHistory(roomId));

  // 生成流程状态
  const [genStep, setGenStep] = useState<GenStep>("idle");
  const [selType, setSelType] = useState<DiagramType>("mindmap");
  const [inputText, setInputText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [regenItem, setRegenItem] = useState<WorkbenchItem | null>(null); // 重新生成时复用

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const excalidrawAPI = useCanvasStore(s => s.excalidrawAPI);

  // 教师以外不渲染
  if (!isTeacher) return null;

  // ── 持久化 ─────────────────────────────────────────────────
  useEffect(() => {
    saveHistory(roomId, history);
  }, [history, roomId]);

  // ── 生成 ───────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    const text = textareaRef.current?.value.trim() ?? inputText.trim();
    if (!text) return;
    setGenStep("generating");
    setErrorMsg("");
    try {
      const data = await generateDiagram({ markdown: text, diagram_type: selType });
      const rootNode = data.nodes.find(n => !n.parent);
      const title = rootNode?.label ?? "未命名图形";

      const item: WorkbenchItem = {
        id: `wb_${Date.now()}`,
        type: selType,
        title,
        data,
        inputText: text,
        createdAt: new Date().toISOString(),
      };

      setHistory(prev => [item, ...prev].slice(0, MAX_HISTORY));
      setGenStep("done");

      // 自动收起生成区，返回历史列表
      setTimeout(() => setGenStep("idle"), 1200);
    } catch (e: any) {
      setErrorMsg(e.message ?? "未知错误");
      setGenStep("error");
    }
  }, [inputText, selType]);

  // ── 插入画布 ────────────────────────────────────────────────
  const handleInsert = useCallback((item: WorkbenchItem) => {
    if (!excalidrawAPI) return;
    const appState = excalidrawAPI.getAppState();
    const originX = -appState.scrollX + 80 / appState.zoom.value;
    const originY = -appState.scrollY + 60 / appState.zoom.value;
    const newElements = buildDiagramElements(item.data, originX, originY);
    const current = excalidrawAPI.getSceneElements();
    excalidrawAPI.updateScene({ elements: [...current, ...newElements] });
    setTimeout(() => {
      excalidrawAPI.scrollToContent(newElements, { fitToContent: true, animate: true });
    }, 100);
  }, [excalidrawAPI]);

  // ── 重新生成 ────────────────────────────────────────────────
  const handleRegen = useCallback((item: WorkbenchItem) => {
    setRegenItem(item);
    setSelType(item.type);
    setInputText(item.inputText);
    setGenStep("input");
    // 等 DOM 更新后填 textarea
    setTimeout(() => {
      if (textareaRef.current) textareaRef.current.value = item.inputText;
    }, 50);
  }, []);

  // ── 删除 ───────────────────────────────────────────────────
  const handleDelete = useCallback((id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  }, []);

  // ── 取消生成流程 ─────────────────────────────────────────────
  const cancelGen = () => {
    setGenStep("idle");
    setRegenItem(null);
    setInputText("");
  };

  // ── 格式化时间 ──────────────────────────────────────────────
  const fmtTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    } catch { return ""; }
  };

  // ──────────────────────────────────────────────────────────
  // 渲染
  // ──────────────────────────────────────────────────────────
  // REQ-027-UX：收起时不再是全高白条（会遮挡画布左侧 UI），改为垂直居中的小胶囊按钮；
  // pointer-events-auto 配合外层容器的 pointer-events-none，只有面板/按钮本身拦截鼠标
  return (
    <div
      className={`flex flex-col shrink-0 bg-white transition-all duration-300 overflow-hidden pointer-events-auto ${
        expanded
          ? "h-full border-r border-gray-200 shadow-lg"
          : "border border-l-0 border-amber-200 rounded-r-xl shadow-md"
      }`}
      style={{ width: expanded ? 300 : 40, minWidth: expanded ? 300 : 40 }}
    >
      {/* ── 收起状态：垂直居中小胶囊 Tab ── */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="flex flex-col items-center justify-center gap-1 w-full py-3
                     text-amber-600 hover:bg-amber-50 transition-colors"
          title="展开 AI 工作台"
        >
          <Sparkles size={16} />
          <span
            className="text-xs font-medium text-amber-700 tracking-widest"
            style={{ writingMode: "vertical-rl" }}
          >
            AI工作台
          </span>
          <ChevronRight size={14} className="text-amber-500" />
        </button>
      )}

      {/* ── 展开状态 ── */}
      {expanded && (
        <div className="flex flex-col h-full min-h-0">
          {/* 顶栏 */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 shrink-0">
            <div className="flex items-center gap-1.5">
              <Sparkles size={14} className="text-amber-600" />
              <span className="text-sm font-semibold text-gray-800">AI 工作台</span>
              {history.length > 0 && (
                <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                  {history.length}
                </span>
              )}
            </div>
            <button
              onClick={() => { setExpanded(false); cancelGen(); }}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              title="收起工作台"
            >
              <ChevronLeft size={16} />
            </button>
          </div>

          {/* 内容区（可滚动）*/}
          <div className="flex-1 overflow-y-auto min-h-0">

            {/* ── 空闲/历史列表 ── */}
            {genStep === "idle" && (
              <div className="p-3 space-y-2">
                {/* 新建按钮 */}
                <button
                  onClick={() => setGenStep("type")}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl
                             border-2 border-dashed border-amber-300 text-amber-600
                             hover:border-amber-500 hover:bg-amber-50 transition-all text-sm font-medium"
                >
                  <Plus size={15} />
                  新建图形
                </button>

                {/* 历史列表 */}
                {history.length === 0 ? (
                  <div className="text-center text-gray-400 text-xs py-8">
                    <Sparkles size={24} className="mx-auto mb-2 text-amber-200" />
                    还没有生成任何图形
                    <br />
                    点击「新建图形」开始
                  </div>
                ) : (
                  history.map(item => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-gray-200 bg-gray-50 hover:border-amber-200
                                 hover:bg-amber-50/50 transition-all overflow-hidden"
                    >
                      {/* 标题行 */}
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="text-amber-600 shrink-0">{TYPE_ICON[item.type]}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-gray-800 truncate">{item.title}</div>
                          <div className="text-xs text-gray-400 flex items-center gap-1">
                            <span>{TYPE_LABEL[item.type]}</span>
                            <span>·</span>
                            <span>{fmtTime(item.createdAt)}</span>
                            <span>·</span>
                            <span>{item.data.nodes.length} 节点</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                          title="删除"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex border-t border-gray-100">
                        <button
                          onClick={() => handleRegen(item)}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5
                                     text-xs text-gray-500 hover:text-amber-600 hover:bg-amber-50
                                     transition-colors border-r border-gray-100"
                        >
                          <RotateCcw size={11} />
                          重新生成
                        </button>
                        <button
                          onClick={() => handleInsert(item)}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5
                                     text-xs text-amber-700 font-medium hover:bg-amber-100
                                     transition-colors"
                        >
                          <ArrowUpRight size={11} />
                          插入画布
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── 选择图形类型 ── */}
            {genStep === "type" && (
              <div className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-600">选择图形类型</span>
                  <button onClick={cancelGen} className="text-gray-400 hover:text-gray-600">
                    <X size={14} />
                  </button>
                </div>
                <div className="space-y-1.5">
                  {DIAGRAM_TYPES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => { setSelType(t.id); setGenStep("input"); setInputText(""); setTimeout(() => { if (textareaRef.current) textareaRef.current.value = ""; }, 50); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl
                                 border border-gray-200 hover:border-amber-400 hover:bg-amber-50
                                 text-left transition-all"
                    >
                      <span className="text-amber-600 shrink-0">{t.icon}</span>
                      <div>
                        <div className="text-xs font-medium text-gray-800">{t.label}</div>
                        <div className="text-xs text-gray-400">{t.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── 输入文本 ── */}
            {genStep === "input" && (
              <div className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-amber-600">{TYPE_ICON[selType]}</span>
                    <span className="text-xs font-medium text-gray-700">{TYPE_LABEL[selType]}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setGenStep("type")}
                      className="text-xs text-amber-600 hover:text-amber-700"
                    >
                      切换
                    </button>
                    <span className="text-gray-200">|</span>
                    <button onClick={cancelGen} className="text-gray-400 hover:text-gray-600">
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <textarea
                  ref={textareaRef}
                  defaultValue={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onInput={e => setInputText((e.target as HTMLTextAreaElement).value)}
                  className="w-full h-40 text-xs font-mono border border-gray-300 rounded-xl p-2.5
                             resize-none focus:outline-none focus:ring-2 focus:ring-amber-400
                             focus:border-transparent text-gray-700"
                  placeholder={"# 主题\n## 章节一\n- 要点\n## 章节二\n- 要点"}
                  spellCheck={false}
                />
                <p className="text-xs text-gray-400 mt-1">
                  粘贴课件、大纲或任意文字
                </p>
                <button
                  onClick={handleGenerate}
                  disabled={!inputText.trim() && !textareaRef.current?.value.trim()}
                  className="w-full mt-2.5 flex items-center justify-center gap-1.5 py-2
                             bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium
                             rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Sparkles size={14} />
                  生成图形
                </button>
              </div>
            )}

            {/* ── 生成中 ── */}
            {genStep === "generating" && (
              <div className="flex flex-col items-center justify-center py-12 gap-3 px-4">
                <Loader2 size={28} className="text-amber-500 animate-spin" />
                <div className="text-xs text-gray-500 text-center">
                  AI 正在生成
                  <br />
                  <span className="font-medium text-amber-700">{TYPE_LABEL[selType]}</span>
                  <br />
                  通常需要 3–8 秒
                </div>
              </div>
            )}

            {/* ── 生成成功（短暂显示后自动收起）── */}
            {genStep === "done" && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 px-4">
                <CheckCircle2 size={28} className="text-green-500" />
                <div className="text-xs text-gray-600 text-center font-medium">
                  生成成功，已加入历史
                </div>
                <div className="text-xs text-gray-400 text-center">
                  在下方列表点「插入画布」
                </div>
              </div>
            )}

            {/* ── 错误 ── */}
            {genStep === "error" && (
              <div className="p-3">
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={15} className="text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-medium text-red-700 mb-1">生成失败</div>
                      <div className="text-xs text-red-600 break-all">{errorMsg}</div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={cancelGen}
                    className="flex-1 py-1.5 text-xs text-gray-600 hover:text-gray-800
                               border border-gray-300 rounded-lg transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => setGenStep("input")}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5
                               bg-amber-600 text-white text-xs rounded-lg hover:bg-amber-700
                               transition-colors"
                  >
                    <RotateCcw size={12} />
                    重试
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 底部提示 */}
          {genStep === "idle" && history.length > 0 && (
            <div className="px-3 py-2 border-t border-gray-100 text-xs text-gray-400 text-center shrink-0">
              历史记录仅保存在本浏览器
            </div>
          )}
        </div>
      )}
    </div>
  );
}
