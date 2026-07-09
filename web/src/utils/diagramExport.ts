/**
 * diagramExport.ts
 * REQ-028（导出中心）：AI 图形单条历史记录的独立导出（不涉及整块画布）
 *
 * 支持 4 种格式，对齐 markdown-mindmap 原版能力：
 *   md  — 导出生成该图形时使用的原始/提炼后 Markdown 文本（纯文本 Blob，零依赖）
 *   png — 复用 Excalidraw 自带 exportToBlob（零新增依赖）
 *   svg — 复用 Excalidraw 自带 exportToSvg（零新增依赖）
 *   pdf — 导出高分辨率 PNG 后用 jsPDF 嵌入 A4 横向单页（唯一的新增依赖，见 package.json）
 *
 * 导出用的 elements 由 buildDiagramElements(data, 0, 0) 重新生成（从原点开始的独立坐标系），
 * 与该图形当前在画布上的实际位置无关，导出结果不受用户后续拖动/编辑影响。
 */

import { exportToBlob, exportToSvg, exportToCanvas } from "@excalidraw/excalidraw";
import jsPDF from "jspdf";
import { buildDiagramElements, type DiagramData } from "./diagramBuilder";

// Excalidraw 导出函数要求的 appState 是 Partial<AppState>，这里只关心背景色/深色模式，
// 用 any 避免额外引入 AppState 类型依赖（与 diagramBuilder.ts 里 wrapInFrame 的做法一致）
const EXPORT_APP_STATE: any = {
  exportBackgroundColor: "#ffffff",
  exportWithDarkMode: false,
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 安全文件名：去掉路径分隔符等特殊字符，避免下载时被浏览器/系统拒绝
function safeFilename(title: string) {
  return (title || "AI图形").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

/** 导出原始 Markdown 文本（生成该图形时的输入文本） */
export function exportDiagramMarkdown(inputText: string, title: string) {
  const blob = new Blob([inputText], { type: "text/markdown;charset=utf-8" });
  downloadBlob(blob, `${safeFilename(title)}.md`);
}

/** 导出为 PNG 图片 */
export async function exportDiagramPng(data: DiagramData, title: string) {
  const elements = buildDiagramElements(data, 0, 0);
  const blob = await exportToBlob({
    elements,
    files: null,
    appState: EXPORT_APP_STATE,
    mimeType: "image/png",
    exportPadding: 24,
  });
  downloadBlob(blob, `${safeFilename(title)}.png`);
}

/** 导出为 SVG 矢量图 */
export async function exportDiagramSvg(data: DiagramData, title: string) {
  const elements = buildDiagramElements(data, 0, 0);
  const svgEl = await exportToSvg({
    elements,
    files: null,
    appState: EXPORT_APP_STATE,
    exportPadding: 24,
  });
  const svgStr = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, `${safeFilename(title)}.svg`);
}

/** 导出为 PDF（A4 横向单页，图形居中缩放铺满，与 markdown-mindmap 原版行为一致） */
export async function exportDiagramPdf(data: DiagramData, title: string) {
  const elements = buildDiagramElements(data, 0, 0);
  // 限制导出画布最大边长，避免超大图形导致内存占用过高（1.6GB 内存服务器上浏览器端也要克制）
  const canvas = await exportToCanvas({
    elements,
    files: null,
    appState: EXPORT_APP_STATE,
    exportPadding: 24,
    getDimensions: (width: number, height: number) => {
      const maxSide = 2400;
      const scale = Math.min(2, maxSide / Math.max(width, height));
      return {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        scale,
      };
    },
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 10; // mm
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
  const w = canvas.width * ratio;
  const h = canvas.height * ratio;
  const x = (pageW - w) / 2;
  const y = (pageH - h) / 2;
  pdf.addImage(imgData, "PNG", x, y, w, h);
  pdf.save(`${safeFilename(title)}.pdf`);
}
