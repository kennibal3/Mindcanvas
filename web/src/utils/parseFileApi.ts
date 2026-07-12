/**
 * parseFileApi.ts
 * 调用后端 POST /api/ai/parse-file 接口
 * REQ-038：AI 工作台文件上传 → MarkItDown 解析为 Markdown
 */

export interface ParseFileResult {
  markdown: string;
  word_count: number;
  char_count: number;
  elapsed_ms: number;
  file_name: string;
  /** 解析来源：markitdown | doubao_ocr | doubao_ocr_pdf（REQ-040） */
  source?: string;
  /** 扫描 PDF OCR 时返回：原文总页数 / 实际识别页数（REQ-040 二期） */
  page_count?: number;
  ocr_pages?: number;
}

export interface ParseFileError {
  error: string;
}

/** 与后端 maxParseFileSize 一致：20MB */
export const PARSE_FILE_MAX_BYTES = 20 * 1024 * 1024;

/** 文件选择器的建议格式（MarkItDown 支持范围） */
export const PARSE_FILE_ACCEPT =
  ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.html,.png,.jpg,.jpeg,.webp,.gif,.bmp";

/**
 * parseFile
 * 成功返回解析后的 Markdown 及统计；失败 throw Error（message 来自后端 error 字段）
 */
export async function parseFile(file: File): Promise<ParseFileResult> {
  if (file.size > PARSE_FILE_MAX_BYTES) {
    throw new Error("文件超过 20MB 限制，请压缩或拆分后再试");
  }

  const fd = new FormData();
  fd.append("file", file, file.name);

  const res = await fetch("/api/ai/parse-file", {
    method: "POST",
    credentials: "include", // Cookie JWT
    body: fd, // 不手动设 Content-Type，浏览器自动带 multipart boundary
  });

  if (!res.ok) {
    const body: ParseFileError = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error ?? `请求失败 (${res.status})`);
  }

  return res.json() as Promise<ParseFileResult>;
}
