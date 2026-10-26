/**
 * mindmapApi.ts
 * REQ-068 第二步：思维导图多步生成流水线的前端调用层
 *
 *   POST /api/ai/mindmap   SSE：progress（真实步骤进度）/ result（缩进大纲）/ error
 *
 * 与 agentApi.ts 同一套 fetch + ReadableStream 手动切帧；帧解析抽成纯函数 parseSseFrames，
 * 便于用 node --test 直接测（不依赖浏览器）。
 */

export interface MindmapProgress {
  stage: "skeleton" | "expand" | "review";
  message: string;
  done?: number;
  total?: number;
  framework?: string;
  branches?: string[];
}

export interface MindmapResult {
  outline: string;
  framework: string;
  root: string;
  branches: number;
  nodes: number;
  rewritten: number;
  /** 以「（补充）」开头的说明条数＝AI 补充、非原文 */
  supplement_notes: number;
  warnings: string[];
}

/** 后端单次输入上限（与 mindmap_handler.go 的 MindmapMaxInputRunes 一致） */
export const MINDMAP_MAX_INPUT = 12000;

export class MindmapApiError extends Error {
  /** too_long：超长，需先智能提炼；其余为 undefined */
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "MindmapApiError";
    this.code = code;
  }
}

export interface SseFrame {
  event: string;
  data: unknown;
}

/**
 * 把累积缓冲切成完整的 SSE 帧；返回 [帧列表, 剩余未完成的尾巴]。
 * 畸形 JSON 帧跳过，不中断整个流。
 */
export function parseSseFrames(buf: string): [SseFrame[], string] {
  const frames: SseFrame[] = [];
  let sep: number;
  while ((sep = buf.indexOf("\n\n")) !== -1) {
    const raw = buf.slice(0, sep);
    buf = buf.slice(sep + 2);
    let event = "message";
    let data = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) continue;
    try {
      frames.push({ event, data: JSON.parse(data) });
    } catch {
      /* 畸形帧 */
    }
  }
  return [frames, buf];
}

export interface StreamMindmapArgs {
  text: string;
  onProgress?: (p: MindmapProgress) => void;
  signal?: AbortSignal;
}

/**
 * streamMindmap
 * 成功返回 MindmapResult；失败 throw MindmapApiError（code=too_long 表示需先提炼）。
 * 主动取消（AbortError）原样抛出，由调用方静默处理。
 */
export async function streamMindmap(args: StreamMindmapArgs): Promise<MindmapResult> {
  const { text, onProgress, signal } = args;

  let res: Response;
  try {
    res = await fetch("/api/ai/mindmap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal,
      body: JSON.stringify({ text }),
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    throw new MindmapApiError("网络连接失败，请检查网络后重试");
  }

  if (!res.ok || !res.body) {
    // 校验失败（超长/空文本/未登录）走普通 JSON 错误体，不是 SSE
    let msg = `请求失败 (${res.status})`;
    let code: string | undefined;
    try {
      const body = await res.json();
      msg = body.message || body.error || msg;
      code = body.code;
    } catch { /* 非 JSON */ }
    throw new MindmapApiError(msg, code);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let result: MindmapResult | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const [frames, rest] = parseSseFrames(buf);
      buf = rest;
      for (const f of frames) {
        if (f.event === "progress") onProgress?.(f.data as MindmapProgress);
        else if (f.event === "result") result = f.data as MindmapResult;
        else if (f.event === "error") {
          throw new MindmapApiError((f.data as { error?: string }).error ?? "生成失败，请稍后重试");
        }
      }
    }
  } catch (e: any) {
    if (e instanceof MindmapApiError || e?.name === "AbortError") throw e;
    throw new MindmapApiError("生成中断，请重试");
  }

  if (!result) throw new MindmapApiError("生成中断，请重试");
  return result;
}
