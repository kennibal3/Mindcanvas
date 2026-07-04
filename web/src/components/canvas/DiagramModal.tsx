/**
 * DiagramModal.tsx
 * AI 图形生成弹窗
 *
 * 功能：
 *   1. 选择图形类型（5种）
 *   2. 粘贴/输入 Markdown 文本（或从已上传材料快速导入 — P1 后续）
 *   3. 调用后端生成图形结构
 *   4. 预览结构（节点树摘要）
 *   5. 注入画布（updateScene + scrollToContent）
 */

import React, { useState, useRef, useCallback } from "react";
import {
  Sparkles,
  X,
  ChevronRight,
  GitBranch,
  Clock,
  Users,
  Fish,
  Network,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { generateDiagram, type DiagramType } from "../../utils/diagramApi";
import { buildDiagramElements, type DiagramData } from "../../utils/diagramBuilder";
import { useCanvasStore } from "../../store/canvasStore";

// ─────────────────────────────────────────────────────────
// 图形类型配置
// ─────────────────────────────────────────────────────────
interface DiagramTypeConfig {
  id: DiagramType;
  label: string;
  desc: string;
  icon: React.ReactNode;
  example: string;
}

const DIAGRAM_TYPES: DiagramTypeConfig[] = [
  {
    id: "mindmap",
    label: "思维导图",
    desc: "概念梳理 · 知识网络 · 课件大纲",
    icon: <Network size={22} />,
    example: "# 光合作用\n## 原料\n- 水\n- 二氧化碳\n## 产物\n- 葡萄糖\n- 氧气",
  },
  {
    id: "flowchart",
    label: "流程图",
    desc: "步骤流程 · 算法 · 操作规程",
    icon: <GitBranch size={22} />,
    example: "## 水的净化流程\n1. 取样\n2. 沉淀\n3. 过滤\n4. 消毒\n5. 检验是否合格？\n   - 合格 → 供水\n   - 不合格 → 重新过滤",
  },
  {
    id: "timeline",
    label: "时间轴",
    desc: "历史事件 · 项目里程碑 · 进度",
    icon: <Clock size={22} />,
    example: "# 中国近代史大事记\n## 1839年 虎门销烟\n## 1842年 《南京条约》\n## 1851年 太平天国运动\n## 1898年 戊戌变法",
  },
  {
    id: "orgchart",
    label: "架构图",
    desc: "组织结构 · 层级关系 · 职责分工",
    icon: <Users size={22} />,
    example: "# 学校管理结构\n## 校长\n### 教务处\n- 课程组\n- 考务组\n### 德育处\n- 班主任团队",
  },
  {
    id: "fishbone",
    label: "鱼骨图",
    desc: "问题分析 · 原因归类 · 讨论",
    icon: <Fish size={22} />,
    example: "# 学生成绩下滑的原因\n## 学习方法\n- 复习不系统\n- 缺乏练习\n## 外部环境\n- 手机干扰\n- 睡眠不足\n## 课堂参与\n- 听课不专注",
  },
];

// ─────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────
interface DiagramModalProps {
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────────────────
export default function DiagramModal({ onClose }: DiagramModalProps) {
  const [step, setStep] = useState<"type" | "input" | "generating" | "done" | "error">("type");
  const [selectedType, setSelectedType] = useState<DiagramType>("mindmap");
  const [mdText, setMdText] = useState("");
  const [diagramData, setDiagramData] = useState<DiagramData | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const excalidrawAPI = useCanvasStore(s => s.excalidrawAPI);

  // ── 生成 ──────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    const text = textareaRef.current?.value.trim() ?? mdText.trim();
    if (!text) return;
    setStep("generating");
    setErrorMsg("");
    try {
      const data = await generateDiagram({ markdown: text, diagram_type: selectedType });
      setDiagramData(data);
      setStep("done");
    } catch (e: any) {
      setErrorMsg(e.message ?? "未知错误");
      setStep("error");
    }
  }, [mdText, selectedType]);

  // ── 注入画布 ──────────────────────────────────────────
  const handleInsert = useCallback(() => {
    if (!diagramData || !excalidrawAPI) return;

    // 获取当前视口中心作为 origin（略偏左上）
    const appState = excalidrawAPI.getAppState();
    const originX = -appState.scrollX + 80 / appState.zoom.value;
    const originY = -appState.scrollY + 60 / appState.zoom.value;

    const newElements = buildDiagramElements(diagramData, originX, originY);
    const currentElements = excalidrawAPI.getSceneElements();

    excalidrawAPI.updateScene({
      elements: [...currentElements, ...newElements],
    });

    // 滚动到新内容
    setTimeout(() => {
      excalidrawAPI.scrollToContent(newElements, { fitToContent: true, animate: true });
    }, 100);

    onClose();
  }, [diagramData, excalidrawAPI, onClose]);

  // ── 节点预览摘要 ──────────────────────────────────────
  const renderPreview = () => {
    if (!diagramData) return null;
    const root = diagramData.nodes.find(n => !n.parent);
    const level1 = diagramData.nodes.filter(n => n.parent === root?.id);
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900 max-h-40 overflow-y-auto">
        <div className="font-medium mb-1">
          📊 已生成 {diagramData.nodes.length} 个节点
          {diagramData.edges.length > 0 && `，${diagramData.edges.length} 条连线`}
        </div>
        {root && (
          <div className="font-semibold">▶ {root.label}</div>
        )}
        {level1.slice(0, 6).map(n => (
          <div key={n.id} className="ml-3 text-amber-700">
            • {n.label}
          </div>
        ))}
        {level1.length > 6 && (
          <div className="ml-3 text-amber-500 text-xs">…还有 {level1.length - 6} 个分支</div>
        )}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────
  // 渲染
  // ─────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[2147483647] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        style={{ maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-amber-600" />
            <span className="font-semibold text-gray-800">AI 图形生成</span>
            {step !== "type" && (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                {DIAGRAM_TYPES.find(t => t.id === selectedType)?.label}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="overflow-y-auto flex-1 px-5 py-4">

          {/* ── Step 1: 选择图形类型 ── */}
          {step === "type" && (
            <div>
              <p className="text-sm text-gray-500 mb-3">选择你想生成的图形类型</p>
              <div className="space-y-2">
                {DIAGRAM_TYPES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setSelectedType(t.id); setStep("input"); setMdText(t.example); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all
                      ${selectedType === t.id
                        ? "border-amber-500 bg-amber-50"
                        : "border-gray-200 hover:border-amber-300 hover:bg-amber-50/50"
                      }`}
                  >
                    <span className="text-amber-600 shrink-0">{t.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-800">{t.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{t.desc}</div>
                    </div>
                    <ChevronRight size={16} className="text-gray-400 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 2: 输入文本 ── */}
          {step === "input" && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <button
                  onClick={() => setStep("type")}
                  className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1"
                >
                  ← 重新选择
                </button>
              </div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                粘贴课件 / 笔记内容（支持 Markdown）
              </label>
              <textarea
                ref={textareaRef}
                defaultValue={mdText}
                onChange={e => setMdText(e.target.value)}
                onInput={e => setMdText((e.target as HTMLTextAreaElement).value)}
                className="w-full h-48 text-sm font-mono border border-gray-300 rounded-xl p-3 resize-none
                           focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                placeholder="# 课件主题&#10;## 第一章&#10;- 要点一&#10;- 要点二"
                spellCheck={false}
              />
              <p className="text-xs text-gray-400 mt-1">
                💡 直接粘贴任意文字、大纲或 Markdown，AI 会自动提炼结构
              </p>
            </div>
          )}

          {/* ── Step 3: 生成中 ── */}
          {step === "generating" && (
            <div className="flex flex-col items-center justify-center py-10 gap-4">
              <Loader2 size={36} className="text-amber-500 animate-spin" />
              <div className="text-sm text-gray-600 text-center">
                AI 正在分析内容，生成
                <span className="font-medium text-amber-700">
                  {DIAGRAM_TYPES.find(t => t.id === selectedType)?.label}
                </span>
                结构…
              </div>
              <div className="text-xs text-gray-400">通常需要 3–8 秒</div>
            </div>
          )}

          {/* ── Step 4: 完成 ── */}
          {step === "done" && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 size={18} className="text-green-500" />
                <span className="text-sm font-medium text-gray-700">生成完成，预览结构</span>
              </div>
              {renderPreview()}
              <div className="mt-3 text-xs text-gray-400">
                点击「插入画布」后可在 Excalidraw 中自由编辑、移动节点、修改文字
              </div>
            </div>
          )}

          {/* ── Step 5: 错误 ── */}
          {step === "error" && (
            <div>
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-4">
                <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-red-700 mb-1">生成失败</div>
                  <div className="text-xs text-red-600">{errorMsg}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2 justify-end">
          {step === "input" && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleGenerate}
                disabled={!mdText.trim() && !textareaRef.current?.value.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-amber-600 hover:bg-amber-700
                           text-white text-sm font-medium rounded-xl transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles size={14} />
                生成图形
              </button>
            </>
          )}

          {step === "done" && (
            <>
              <button
                onClick={() => { setStep("input"); setDiagramData(null); }}
                className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600
                           hover:text-gray-800 transition-colors"
              >
                <RotateCcw size={14} />
                重新生成
              </button>
              <button
                onClick={handleInsert}
                className="flex items-center gap-2 px-5 py-2 bg-amber-600 hover:bg-amber-700
                           text-white text-sm font-medium rounded-xl transition-colors"
              >
                <CheckCircle2 size={14} />
                插入画布
              </button>
            </>
          )}

          {step === "error" && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                关闭
              </button>
              <button
                onClick={() => setStep("input")}
                className="flex items-center gap-2 px-5 py-2 bg-amber-600 hover:bg-amber-700
                           text-white text-sm font-medium rounded-xl transition-colors"
              >
                <RotateCcw size={14} />
                重试
              </button>
            </>
          )}

          {step === "generating" && (
            <button
              disabled
              className="flex items-center gap-2 px-5 py-2 bg-amber-400
                         text-white text-sm font-medium rounded-xl opacity-60 cursor-not-allowed"
            >
              <Loader2 size={14} className="animate-spin" />
              生成中…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
