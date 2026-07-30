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

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
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
  Wand2,
  Upload,
} from "lucide-react";
import { generateDiagram, reportDiagramOutcome, type DiagramType } from "../../utils/diagramApi";
import { refineText } from "../../utils/refineApi";
import { parseFile, PARSE_FILE_ACCEPT } from "../../utils/parseFileApi";
import {
  buildDiagramElements,
  type DiagramData,
  type DiagramRepair,
  type DiagramIssue,
  DIAGRAM_THEMES,
  getDiagramThemeKey,
  setDiagramThemeKey,
} from "../../utils/diagramBuilder";
import {
  exportDiagramMarkdown,
  exportDiagramPng,
  exportDiagramSvg,
  exportDiagramPdf,
} from "../../utils/diagramExport";
import { useCanvasStore } from "../../store/canvasStore";

// ─────────────────────────────────────────────────────────────
// REQ-056：提炼必要性判断（纯本地正则，刻意不调 AI）
// ─────────────────────────────────────────────────────────────
// 背景：「智能提炼」与「生成图形」两个按钮并排，最自然的操作是从左到右挨个点，
// 于是本来就有标题层级的 Word 课件也要白等一次 AI 调用（2026-07-29 实测 36s）。
// 提炼的真正价值是给散乱长文本降噪归类；已有结构的文本提炼收益很小。
// 判定只看结构特征，故意不调 AI —— 为了省一次 AI 调用再花一次 AI 调用是荒谬的。
type RefineAdvice = "skip" | "suggest" | null;

const mdHeadingRe = /^#{1,6}[ \t]+\S/gm;
const mdBulletRe = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\S/gm;

function assessRefineNeed(text: string): RefineAdvice {
  const t = text.trim();
  if (t.length < 120) return null; // 太短，两种提示都没意义

  const headings = (t.match(mdHeadingRe) ?? []).length;
  const bullets = (t.match(mdBulletRe) ?? []).length;

  // 已有两级以上标题、或标题配成规模的列表 → diagram 提示词本身就能消化，直接生成
  if (headings >= 2 || (headings >= 1 && bullets >= 3)) return "skip";

  // 长文本且几乎没有结构标记 → 提炼收益明显，值得那次等待
  if (t.length > 600 && headings === 0 && bullets < 3) return "suggest";

  return null; // 介于两者之间：不引导，交给老师自己判断
}

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
  genId?: string;       // REQ-050 B：后端采集记录 id（老式历史条目没有，上报时静默跳过）
}

type GenStep = "idle" | "type" | "input" | "generating" | "done" | "error";

// ─────────────────────────────────────────────────────────────
// 图形类型配置
// ─────────────────────────────────────────────────────────────
// REQ-050 一期：每种图给出「适合什么内容」的场景提示，帮老师选型，避免把内容硬套不合适的图型
const DIAGRAM_TYPES: { id: DiagramType; label: string; icon: React.ReactNode; desc: string; scene: string }[] = [
  { id: "mindmap",   label: "思维导图", icon: <Network  size={16} />, desc: "概念梳理·大纲",
    scene: "把一个主题层层拆成要点｜知识点框架、章节大纲、读书笔记" },
  { id: "flowchart", label: "流程图",   icon: <GitBranch size={16} />, desc: "步骤·判断·流程",
    scene: "有先后顺序、含判断分支的过程｜解题步骤、实验流程、操作规程" },
  { id: "timeline",  label: "时间轴",   icon: <Clock    size={16} />, desc: "时序·里程碑",
    scene: "按时间先后排列的事件｜历史脉络、项目进度、发展历程" },
  { id: "orgchart",  label: "架构图",   icon: <Users    size={16} />, desc: "上下隶属·层级",
    scene: "谁管谁的上下级关系｜组织架构、分类体系、从属结构（非时序/非因果）" },
  { id: "fishbone",  label: "鱼骨图",   icon: <Fish     size={16} />, desc: "原因·归因",
    scene: "分析一个结果由哪些原因造成｜问题归因、影响因素、错因分析" },
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
// 工具：localStorage 草稿暂存（REQ-028）
// 只在用户手动编辑文本框时写入（不跟随 inputText 的所有程序化变化），
// 避免收起工作台 / 取消生成流程时把草稿意外清空——这正是这个功能要防的场景。
// ─────────────────────────────────────────────────────────────
const DRAFT_KEY = (roomId: string) => `mc_ai_workbench_draft_${roomId}`;

function loadDraft(roomId: string): { type: DiagramType; text: string } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.text === "string" && typeof parsed.type === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function saveDraft(roomId: string, type: DiagramType, text: string) {
  try {
    if (!text.trim()) {
      localStorage.removeItem(DRAFT_KEY(roomId));
      return;
    }
    localStorage.setItem(DRAFT_KEY(roomId), JSON.stringify({ type, text }));
  } catch { /* ignore quota errors */ }
}

function clearDraft(roomId: string) {
  try {
    localStorage.removeItem(DRAFT_KEY(roomId));
  } catch { /* ignore */ }
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
  // REQ-050 一期：后端结构体检回执（自动修了什么 / 还剩什么问题），有内容时成功页不自动收起
  const [genNotice, setGenNotice] = useState<{
    repairs: DiagramRepair[];
    issues: DiagramIssue[];
    regenerated: boolean;
  } | null>(null);
  // REQ-049：AI 图形配色风格（全局，存 localStorage，插入画布时生效）
  const [themeKey, setThemeKey] = useState<string>(() => getDiagramThemeKey());

  // REQ-028：文本→Markdown 智能提炼（生成图形前的可选预处理）
  const [refining, setRefining] = useState(false);
  const [refineErr, setRefineErr] = useState("");
  const [refineWarn, setRefineWarn] = useState(""); // REQ-057：提炼结果被截断的黄色警告
  // REQ-056：是否建议提炼，随输入框内容实时重算（纯正则，无网络开销）
  const refineAdvice = useMemo(() => assessRefineNeed(inputText), [inputText]);

  // REQ-038：文件上传 → MarkItDown 解析为 Markdown
  const [parsingFile, setParsingFile] = useState(false);
  const [parseFileErr, setParseFileErr] = useState("");
  const [parseFileHint, setParseFileHint] = useState("");
  const [parseFileWarn, setParseFileWarn] = useState(""); // REQ-040：0 字符黄色警告
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const excalidrawAPI = useCanvasStore(s => s.excalidrawAPI);

  // REQ-028：草稿自动暂存（防止误关工作台/切换步骤丢失正在输入的文本）
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleDraftSave = useCallback((text: string) => {
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      saveDraft(roomId, selType, text);
    }, 600);
  }, [roomId, selType]);

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
    setGenNotice(null);
    // REQ-050 B：这次生成是不是在「对上一张不满意」之后发生的？
    // 是的话把上一张标成质量差信号——同文本重来＝这张不行，换类型＝选型不对。
    if (regenItem) {
      reportDiagramOutcome(
        regenItem.genId,
        selType !== regenItem.type ? "switched_type" : "regenerated_same_input"
      );
    }

    try {
      const data = await generateDiagram({ markdown: text, diagram_type: selType, room_id: roomId });
      const rootNode = data.nodes.find(n => !n.parent);
      const title = rootNode?.label ?? "未命名图形";

      const item: WorkbenchItem = {
        id: `wb_${Date.now()}`,
        type: selType,
        title,
        data,
        inputText: text,
        createdAt: new Date().toISOString(),
        genId: data.generation_id,
      };

      setHistory(prev => [item, ...prev].slice(0, MAX_HISTORY));
      setGenStep("done");
      clearDraft(roomId); // 文本已生成为正式图形并入历史，草稿失去保护意义，清掉避免和下次新建混淆

      // REQ-050 一期：后端体检修过东西或留有问题时，成功页停住让老师看清，
      // 不再 1.2 秒自动收起（否则提示一闪而过等于没提示）
      const repairs = data.repairs ?? [];
      const issues = data.issues ?? [];
      if (repairs.length > 0 || issues.length > 0 || data.regenerated) {
        setGenNotice({ repairs, issues, regenerated: !!data.regenerated });
      } else {
        setGenNotice(null);
        // 自动收起生成区，返回历史列表
        setTimeout(() => setGenStep("idle"), 1200);
      }
    } catch (e: any) {
      setErrorMsg(e.message ?? "未知错误");
      setGenStep("error");
    }
  }, [inputText, selType, roomId, regenItem]);

  // ── 智能提炼（REQ-028）───────────────────────────────────────
  const handleRefine = useCallback(async () => {
    const text = textareaRef.current?.value.trim() ?? inputText.trim();
    if (!text) return;
    setRefining(true);
    setRefineErr("");
    setRefineWarn("");
    try {
      const result = await refineText({ text });
      setInputText(result.markdown);
      if (textareaRef.current) textareaRef.current.value = result.markdown;
      saveDraft(roomId, selType, result.markdown); // 提炼结果立即落草稿，防止提炼完还没点生成就误关丢失
      // REQ-057：内容被截断时留在界面上，不自动消失——与 REQ-050 体检提示同一取舍，
      // 一闪而过的提示等于没提示，而这里少掉的内容老师根本看不出来。
      if (result.truncated && result.warning) setRefineWarn(result.warning);
    } catch (e: any) {
      setRefineErr(e.message ?? "提炼失败，请稍后重试");
    } finally {
      setRefining(false);
    }
  }, [inputText, roomId, selType]);

  // ── 文件上传解析（REQ-038）───────────────────────────────────
  const handleParseFile = useCallback(async (file: File) => {
    setParseFileErr("");
    setParseFileHint("");
    setParseFileWarn("");
    setParsingFile(true);
    // REQ-040 二期：扫描 PDF 会自动转分页 AI 识别，耗时明显更长，提前给预期
    if (file.name.toLowerCase().endsWith(".pdf")) {
      setParseFileHint(`正在解析「${file.name}」…若为扫描件将自动 AI 识别，最长约 1-2 分钟`);
    }
    try {
      const result = await parseFile(file);
      setInputText(result.markdown);
      if (textareaRef.current) textareaRef.current.value = result.markdown;
      saveDraft(roomId, selType, result.markdown); // 解析结果立即落草稿，防误关丢失
      // REQ-040 二期：扫描 PDF OCR 结果的专属提示（含截断说明）
      const ocrNote =
        result.source === "doubao_ocr_pdf" &&
        result.page_count != null &&
        result.ocr_pages != null &&
        result.page_count > result.ocr_pages
          ? `；原文 ${result.page_count} 页，仅识别前 ${result.ocr_pages} 页`
          : "";
      const parsedLabel =
        result.source === "doubao_ocr_pdf" ? "已 AI 识别扫描件" : "已解析";
      if (result.char_count === 0) {
        // REQ-040：0 字符不再显示绿色"已解析"，给出黄色警告
        setParseFileErr("");
        setParseFileHint("");
        setParseFileWarn(
          result.source === "doubao_ocr_pdf"
            ? `「${file.name}」已尝试 AI 识别扫描件，仍未找到可读文字，请确认文件内容清晰且包含文字`
            : `「${file.name}」未提取到文字——请确认文件中包含可读文字（图片与扫描 PDF 均已支持 AI 识别）`
        );
      } else if (result.char_count > 3000) {
        setParseFileWarn("");
        setParseFileHint(
          `${parsedLabel}「${file.name}」（${result.char_count} 字符${ocrNote}）。文本较长，建议先点「智能提炼」压缩再生成图形`
        );
      } else {
        setParseFileWarn("");
        setParseFileHint(`${parsedLabel}「${file.name}」（${result.char_count} 字符${ocrNote}）`);
      }
    } catch (e: any) {
      setParseFileHint(""); // 清掉 PDF 预设的"正在解析"提示
      setParseFileErr(e.message ?? "解析失败，请稍后重试");
    } finally {
      setParsingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = ""; // 允许再次选同一文件
    }
  }, [roomId, selType]);

  // ── 插入画布 ────────────────────────────────────────────────
  const handleInsert = useCallback((item: WorkbenchItem) => {
    if (!excalidrawAPI) return;
    const appState = excalidrawAPI.getAppState();
    const originX = -appState.scrollX + 80 / appState.zoom.value;
    const originY = -appState.scrollY + 60 / appState.zoom.value;
    const newElements = buildDiagramElements(item.data, originX, originY);
    const current = excalidrawAPI.getSceneElements();
    excalidrawAPI.updateScene({ elements: [...current, ...newElements] });
    // REQ-050 B：上报这批元素 id。插入本身只是「看一眼」的默认动作不代表图好，
    // 真判据是后端十分钟后回来看这组元素还在不在（2026-07-25 订正）。
    reportDiagramOutcome(
      item.genId,
      "inserted",
      newElements.map(el => el.id).filter(Boolean)
    );
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
  // REQ-050 B：改收整个 item（原来只收 id），为的是拿到 genId 上报「删掉不要了」
  const handleDelete = useCallback((item: WorkbenchItem) => {
    reportDiagramOutcome(item.genId, "deleted_history");
    setHistory(prev => prev.filter(it => it.id !== item.id));
  }, []);

  // ── 导出（REQ-028 导出中心）──────────────────────────────────
  // 一次只允许一个导出任务在跑（简单起见，跨条目也互斥），避免用户连点触发多个大画布导出占满内存
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const handleExportItem = useCallback(async (item: WorkbenchItem, format: "md" | "png" | "svg" | "pdf") => {
    const key = `${item.id}:${format}`;
    setExportingKey(key);
    try {
      if (format === "md") {
        exportDiagramMarkdown(item.inputText, item.title);
      } else if (format === "png") {
        await exportDiagramPng(item.data, item.title);
      } else if (format === "svg") {
        await exportDiagramSvg(item.data, item.title);
      } else {
        await exportDiagramPdf(item.data, item.title);
      }
    } catch (e) {
      console.error("[AIWorkbench] 导出失败", format, e);
      window.alert("导出失败，请重试");
    } finally {
      setExportingKey(null);
    }
  }, []);

  // ── 取消生成流程 ─────────────────────────────────────────────
  const cancelGen = () => {
    setGenStep("idle");
    setGenNotice(null); // REQ-050：体检回执不跨次残留
    setRegenItem(null);
    setInputText("");
    setRefineErr("");
    setRefineWarn(""); // REQ-057：截断警告同样不跨次残留
    setRefining(false);
    setParseFileErr("");
    setParseFileHint("");
    setParseFileWarn("");
    setParsingFile(false);
    setDragOver(false);
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
                          onClick={() => handleDelete(item)}
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

                      {/* 导出（REQ-028）：MD 原文 / PNG / SVG / PDF，与画布位置无关的独立导出 */}
                      <div className="flex border-t border-gray-100">
                        {(["md", "png", "svg", "pdf"] as const).map(fmt => {
                          const key = `${item.id}:${fmt}`;
                          const busy = exportingKey === key;
                          return (
                            <button
                              key={fmt}
                              onClick={() => handleExportItem(item, fmt)}
                              disabled={exportingKey !== null}
                              className="flex-1 flex items-center justify-center gap-1 py-1.5
                                         text-[10px] font-medium uppercase tracking-wide
                                         text-gray-400 hover:text-amber-600 hover:bg-amber-50
                                         transition-colors border-r border-gray-100 last:border-r-0
                                         disabled:opacity-40 disabled:cursor-not-allowed"
                              title={`导出为 ${fmt.toUpperCase()}`}
                            >
                              {busy ? <Loader2 size={10} className="animate-spin" /> : fmt.toUpperCase()}
                            </button>
                          );
                        })}
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
                      onClick={() => {
                        setSelType(t.id);
                        setGenStep("input");
                        // REQ-028：同类型有未完成草稿时恢复，避免误关工作台/切步骤丢内容
                        const draft = loadDraft(roomId);
                        const initial = draft && draft.type === t.id ? draft.text : "";
                        setInputText(initial);
                        setTimeout(() => { if (textareaRef.current) textareaRef.current.value = initial; }, 50);
                      }}
                      className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl
                                 border border-gray-200 hover:border-amber-400 hover:bg-amber-50
                                 text-left transition-all"
                    >
                      <span className="text-amber-600 shrink-0 mt-0.5">{t.icon}</span>
                      <div>
                        <div className="text-xs font-medium text-gray-800">
                          {t.label}
                          <span className="ml-1.5 text-[11px] font-normal text-gray-400">{t.desc}</span>
                        </div>
                        <div className="text-[11px] text-gray-400 mt-0.5 leading-snug">{t.scene}</div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* ── 配色风格（REQ-049，全局设置，作用于新生成/插入的图形）── */}
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-600">配色风格</span>
                    <select
                      value={themeKey}
                      onChange={e => { setThemeKey(e.target.value); setDiagramThemeKey(e.target.value); }}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1
                                 text-gray-700 bg-white hover:border-amber-400 focus:outline-none
                                 focus:border-amber-400"
                    >
                      {DIAGRAM_THEMES.map(t => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1 leading-snug">
                    切换后对新生成/插入的图形生效，已在画布上的图形不变。
                  </p>
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
                  onChange={e => { setInputText(e.target.value); scheduleDraftSave(e.target.value); }}
                  onInput={e => { const v = (e.target as HTMLTextAreaElement).value; setInputText(v); scheduleDraftSave(v); }}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f && !parsingFile) handleParseFile(f); // REQ-038：拖文件进输入框直接解析
                  }}
                  className={`w-full h-40 text-xs font-mono border rounded-xl p-2.5
                             resize-none focus:outline-none focus:ring-2 focus:ring-amber-400
                             focus:border-transparent text-gray-700
                             ${dragOver ? "border-amber-500 ring-2 ring-amber-300 bg-amber-50" : "border-gray-300"}`}
                  placeholder={"# 主题\n## 章节一\n- 要点\n## 章节二\n- 要点\n\n（也可以把 PDF/Word/PPT 等文件直接拖进这里）"}
                  spellCheck={false}
                />
                <p className="text-xs text-gray-400 mt-1">
                  粘贴课件、大纲或任意文字，也可上传 / 拖入文件自动解析
                </p>
                {/* REQ-038：文件上传解析入口 */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={PARSE_FILE_ACCEPT}
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleParseFile(f);
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={parsingFile || refining}
                  className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5
                             border border-amber-300 text-amber-700 text-xs font-medium
                             rounded-xl hover:bg-amber-50 transition-colors
                             disabled:opacity-40 disabled:cursor-not-allowed"
                  title="上传 PDF/Word/PPT/Excel/图片/文本，自动解析为 Markdown 填入输入框"
                >
                  {parsingFile ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  {parsingFile ? "文件解析中…" : "上传文件解析（PDF / Word / PPT…）"}
                </button>
                {parseFileHint && (
                  <p className="text-xs text-green-600 mt-1">{parseFileHint}</p>
                )}
                {parseFileWarn && (
                  <p className="text-xs text-amber-600 mt-1">{parseFileWarn}</p>
                )}
                {parseFileErr && (
                  <p className="text-xs text-red-500 mt-1">{parseFileErr}</p>
                )}
                <button
                  onClick={handleRefine}
                  disabled={refining || (!inputText.trim() && !textareaRef.current?.value.trim())}
                  className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5
                             border border-amber-300 text-amber-700 text-xs font-medium
                             rounded-xl hover:bg-amber-50 transition-colors
                             disabled:opacity-40 disabled:cursor-not-allowed"
                  title="可选步骤：用 AI 把杂乱文本整理成结构化 Markdown。输入本身已有标题层级时可直接生成图形"
                >
                  {refining ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                  {refining ? "提炼中…" : "智能提炼为 Markdown（可选）"}
                </button>
                {/* REQ-056：提炼中给出耗时预期。刻意不做百分比进度条 ——
                    当前提炼是非流式调用，服务端拿到完整响应前没有任何可上报的中间状态，
                    假进度条走到 100% 还没结束比没有进度条更让人焦虑。 */}
                {refining && (
                  <p className="text-xs text-gray-500 mt-1">
                    正在提炼，文本较长时可能需要半分钟以上，请保持面板打开
                  </p>
                )}
                {/* REQ-056：该不该提炼的引导。最好的等待优化是不需要等待。 */}
                {!refining && refineAdvice === "skip" && (
                  <p className="text-xs text-gray-500 mt-1">
                    文本结构已清晰，可跳过提炼，直接点下方「生成图形」
                  </p>
                )}
                {!refining && refineAdvice === "suggest" && (
                  <p className="text-xs text-amber-600 mt-1">
                    文本结构较松散，先提炼一次，生成的图会更整齐
                  </p>
                )}
                {refineErr && (
                  <p className="text-xs text-red-500 mt-1">{refineErr}</p>
                )}
                {/* REQ-057：提炼结果被上游 max_tokens 截断的警告。
                    与 parseFileWarn 同一视觉档位（黄色＝成功但有损），
                    区别于 refineErr（红色＝失败）。 */}
                {!refining && refineWarn && (
                  <p className="text-xs text-amber-600 mt-1 leading-relaxed">
                    ⚠ {refineWarn}
                  </p>
                )}
                <button
                  onClick={handleGenerate}
                  disabled={!inputText.trim() && !textareaRef.current?.value.trim()}
                  className="w-full mt-2 flex items-center justify-center gap-1.5 py-2
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

            {/* ── 生成成功（无体检提示时短暂显示后自动收起）── */}
            {genStep === "done" && !genNotice && (
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

            {/* ── 生成成功 + REQ-050 结构体检回执（停住等老师确认）── */}
            {genStep === "done" && genNotice && (
              <div className="p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <CheckCircle2 size={15} className="text-green-500 shrink-0" />
                  <span className="text-xs font-medium text-gray-700">生成成功，已加入历史</span>
                </div>

                {genNotice.regenerated && (
                  <div className="text-xs text-gray-500 mb-2">
                    首次生成的结构不可用，已自动重新生成了一次。
                  </div>
                )}

                {genNotice.repairs.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 mb-2">
                    <div className="text-xs font-medium text-amber-800 mb-1">
                      已自动修正 {genNotice.repairs.reduce((s, r) => s + r.count, 0)} 处
                    </div>
                    <ul className="space-y-0.5">
                      {genNotice.repairs.map(r => (
                        <li key={r.code} className="text-xs text-amber-700 leading-snug">
                          · {r.detail}
                          {r.count > 1 && <span className="text-amber-500">（{r.count} 处）</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {genNotice.issues.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-2.5 mb-2">
                    <div className="flex items-start gap-1.5">
                      <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-medium text-red-700 mb-1">
                          这些地方需要你确认（没有自动改，改了会变成瞎编）
                        </div>
                        <ul className="space-y-0.5">
                          {genNotice.issues.map(r => (
                            <li key={r.code} className="text-xs text-red-600 leading-snug">
                              · {r.detail}
                              {r.count > 1 && <span className="text-red-400">（{r.count} 处）</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => { setGenNotice(null); setGenStep("input"); }}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs
                               text-gray-600 hover:text-gray-800 border border-gray-300
                               rounded-lg transition-colors"
                  >
                    <RotateCcw size={12} />
                    重新生成
                  </button>
                  <button
                    onClick={() => { setGenNotice(null); setGenStep("idle"); }}
                    className="flex-1 py-1.5 bg-amber-600 text-white text-xs rounded-lg
                               hover:bg-amber-700 transition-colors"
                  >
                    知道了
                  </button>
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
