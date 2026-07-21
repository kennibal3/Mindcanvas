// =============================================================
// MindCanvas REQ-039 第三期 3d — 讲评报告导出（Markdown + 打印 PDF）
// 纯前端实现，零后端依赖（拆分方案决策 B：MVP 走前端打印）
//   - reportToMarkdown()  已确认报告 → Markdown 文本
//   - downloadMarkdown()  触发浏览器下载 .md
//   - printReport()       新开窗口渲染打印样式 → window.print()（用户可存为 PDF）
// 设计取舍：打印走独立新窗口而非全局 @media print，
//   ① 不污染主应用 CSS，② 打印内容与屏幕布局解耦，输出干净，
//   ③ 用户点击触发，不会被弹窗拦截。
// 内容块结构与 lecture_prompt.go / lecture_edit.go 的 AI 输出格式对齐：
//   overview          → class_summary / strengths / common_issues / priority_topics
//   dimension_analysis→ dimension_name / score_summary / common_problems /
//                       teacher_talking_points / example_quotes
//   其他块类型 → 通用兜底（按 key 输出字符串与字符串数组），不因新增块类型而漏内容
// =============================================================

import type { LectureReport, LectureReportBlock } from './assignmentApi';

// ── 小工具：安全取数组（延续 BUG-011「防空不防 null」教训）──────────
const arr = (v: any): string[] =>
  Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : [];

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── 单块 → Markdown ───────────────────────────────────────────────
function blockToMarkdown(block: LectureReportBlock, index: number): string {
  const c = block.content ?? {};
  const isOverview = block.block_type === 'overview';
  const title = block.title || (isOverview ? '班级总体概览' : `内容块 ${index + 1}`);
  const out: string[] = [`## ${title}`, ''];

  if (isOverview) {
    if (c.class_summary) out.push(String(c.class_summary), '');
    const sections: [string, string[]][] = [
      ['亮点', arr(c.strengths)],
      ['共性问题', arr(c.common_issues)],
      ['讲评重点', arr(c.priority_topics)],
    ];
    for (const [label, items] of sections) {
      if (!items.length) continue;
      out.push(`### ${label}`, '');
      items.forEach(i => out.push(`- ${i}`));
      out.push('');
    }
    return out.join('\n');
  }

  if (block.block_type === 'dimension_analysis') {
    const ss = c.score_summary;
    if (ss && typeof ss === 'object') {
      const bits: string[] = [];
      if (ss.average !== undefined && ss.average !== null) bits.push(`平均分 ${ss.average}`);
      if (ss.low_score_count !== undefined && ss.low_score_count !== null) {
        bits.push(`低分人数 ${ss.low_score_count}`);
      }
      if (bits.length) out.push(`> ${bits.join(' ｜ ')}`, '');
    }
    const sections: [string, string[]][] = [
      ['典型问题', arr(c.common_problems)],
      ['讲评要点', arr(c.teacher_talking_points)],
    ];
    for (const [label, items] of sections) {
      if (!items.length) continue;
      out.push(`### ${label}`, '');
      items.forEach(i => out.push(`- ${i}`));
      out.push('');
    }
    const quotes = arr(c.example_quotes);
    if (quotes.length) {
      out.push('### 学生原话样例', '');
      quotes.forEach(q => out.push(`> “${q}”`, ''));
    }
    return out.join('\n');
  }

  // 通用兜底：未知块类型也不丢内容
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === 'string' && v.trim()) {
      out.push(`**${k}**：${v}`, '');
    } else if (Array.isArray(v)) {
      const items = arr(v);
      if (items.length) {
        out.push(`**${k}**`, '');
        items.forEach(i => out.push(`- ${i}`));
        out.push('');
      }
    }
  }
  return out.join('\n');
}

// ── 整份报告 → Markdown ───────────────────────────────────────────
export function reportToMarkdown(report: LectureReport, assignmentTitle: string): string {
  const blocks = report.blocks ?? [];
  const date = new Date().toLocaleDateString('zh-CN');
  const head: string[] = [
    `# ${report.title || `${assignmentTitle} · 讲评报告`}`,
    '',
    `> 作业：${assignmentTitle}　｜　导出时间：${date}`,
    '',
  ];
  if (report.summary) head.push(report.summary, '');
  head.push('---', '');
  const body = blocks.map((b, i) => blockToMarkdown(b, i)).join('\n');
  return head.join('\n') + body;
}

// ── 下载 .md ──────────────────────────────────────────────────────
export function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟回收，避免部分浏览器下载未开始就失效
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── 单块 → 打印用 HTML ────────────────────────────────────────────
function blockToHtml(block: LectureReportBlock, index: number): string {
  const c = block.content ?? {};
  const isOverview = block.block_type === 'overview';
  const title = block.title || (isOverview ? '班级总体概览' : `内容块 ${index + 1}`);
  const parts: string[] = [`<section><h2>${esc(title)}</h2>`];

  const list = (label: string, items: string[], cls = '') => {
    if (!items.length) return '';
    return `<h3 class="${cls}">${esc(label)}</h3><ul>${
      items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
  };

  if (isOverview) {
    if (c.class_summary) parts.push(`<p class="lead">${esc(c.class_summary)}</p>`);
    parts.push(list('亮点', arr(c.strengths), 'good'));
    parts.push(list('共性问题', arr(c.common_issues), 'bad'));
    parts.push(list('讲评重点', arr(c.priority_topics), 'key'));
  } else if (block.block_type === 'dimension_analysis') {
    const ss = c.score_summary;
    if (ss && typeof ss === 'object') {
      const bits: string[] = [];
      if (ss.average !== undefined && ss.average !== null) bits.push(`平均分 ${esc(String(ss.average))}`);
      if (ss.low_score_count !== undefined && ss.low_score_count !== null) {
        bits.push(`低分人数 ${esc(String(ss.low_score_count))}`);
      }
      if (bits.length) parts.push(`<p class="meta">${bits.join('　｜　')}</p>`);
    }
    parts.push(list('典型问题', arr(c.common_problems), 'bad'));
    parts.push(list('讲评要点', arr(c.teacher_talking_points), 'key'));
    const quotes = arr(c.example_quotes);
    if (quotes.length) {
      parts.push('<h3>学生原话样例</h3>');
      parts.push(quotes.map(q => `<blockquote>${esc(q)}</blockquote>`).join(''));
    }
  } else {
    for (const [k, v] of Object.entries(c)) {
      if (typeof v === 'string' && v.trim()) {
        parts.push(`<p><strong>${esc(k)}</strong>：${esc(v)}</p>`);
      } else if (Array.isArray(v)) {
        parts.push(list(k, arr(v)));
      }
    }
  }
  parts.push('</section>');
  return parts.join('');
}

// ── 打印（用户在打印对话框里选「存储为 PDF」）────────────────────────
export function printReport(report: LectureReport, assignmentTitle: string): boolean {
  const blocks = report.blocks ?? [];
  const docTitle = report.title || `${assignmentTitle} · 讲评报告`;
  const date = new Date().toLocaleDateString('zh-CN');
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(docTitle)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
         color: #2b2b2b; line-height: 1.75; font-size: 12pt; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 4px; color: #8a5511; }
  .sub { color: #888; font-size: 10pt; margin-bottom: 18px;
         border-bottom: 2px solid #BA7517; padding-bottom: 10px; }
  section { margin-bottom: 20px; page-break-inside: avoid; }
  h2 { font-size: 14pt; color: #8a5511; margin: 18px 0 8px;
       border-left: 4px solid #BA7517; padding-left: 8px; }
  h3 { font-size: 11.5pt; margin: 12px 0 4px; color: #444; }
  h3.good { color: #2f7a43; } h3.bad { color: #b03a3a; } h3.key { color: #a9711b; }
  p.lead { margin: 6px 0 12px; }
  p.meta { color: #777; font-size: 10.5pt; background: #faf6ef;
           padding: 5px 9px; border-radius: 5px; display: inline-block; }
  ul { margin: 4px 0 10px; padding-left: 20px; }
  li { margin-bottom: 4px; }
  blockquote { margin: 5px 0; padding: 6px 12px; background: #f7f7f7;
               border-left: 3px solid #ccc; color: #555; font-style: italic; }
  .foot { margin-top: 26px; padding-top: 8px; border-top: 1px solid #ddd;
          color: #aaa; font-size: 9pt; text-align: center; }
  @media print { .tip { display: none !important; } }
  .tip { background: #fff7e6; border: 1px solid #ffd591; color: #8a5511;
         padding: 10px 14px; border-radius: 8px; font-size: 11pt; margin-bottom: 16px; }
</style></head><body>
<div class="tip">打印对话框中「目标/打印机」选择「存储为 PDF」即可导出 PDF 文件。此提示不会被打印。</div>
<h1>${esc(docTitle)}</h1>
<div class="sub">作业：${esc(assignmentTitle)}　｜　导出时间：${esc(date)}</div>
${report.summary ? `<p class="lead">${esc(report.summary)}</p>` : ''}
${blocks.map((b, i) => blockToHtml(b, i)).join('')}
<div class="foot">MindCanvas 讲评报告 · 由教师确认后导出</div>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return false; // 被浏览器拦截，调用方给提示
  win.document.open();
  win.document.write(html);
  win.document.close();
  // 等待样式与字体就绪再唤起打印，避免空白页
  win.onload = () => setTimeout(() => { win.focus(); win.print(); }, 250);
  return true;
}
