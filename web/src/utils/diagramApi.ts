/**
 * diagramApi.ts
 * 调用后端 POST /api/ai/diagram 接口
 */

import type { DiagramData } from "./diagramBuilder";

export type DiagramType = "mindmap" | "flowchart" | "timeline" | "orgchart" | "fishbone";

export interface GenerateDiagramRequest {
  markdown: string;
  diagram_type: DiagramType;
  room_id?: string; // REQ-050 B：仅用于采集归因
}

// REQ-050 一期 B：老师拿到图之后干了什么（后端有同名白名单）
export type DiagramOutcome =
  | "inserted"               // 直接插进画布用了 ≈ 不用手改就能用
  | "regenerated_same_input" // 同一段文本重来 ≈ 这张不行
  | "switched_type"          // 换个图型重来 ≈ 选型不对
  | "deleted";               // 删掉不要了

export interface GenerateDiagramError {
  error: string;
  raw?: string;
}

/**
 * generateDiagram
 * 成功返回 DiagramData；失败 throw Error（message 来自后端 error 字段）
 */
export async function generateDiagram(req: GenerateDiagramRequest): Promise<DiagramData> {
  const res = await fetch("/api/ai/diagram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // Cookie JWT
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body: GenerateDiagramError = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error ?? `请求失败 (${res.status})`);
  }

  return res.json() as Promise<DiagramData>;
}

/**
 * reportDiagramOutcome（REQ-050 一期 B）
 * 回报老师拿到图之后的动作。纯旁路信号采集：
 * 不 await、不抛错、失败静默——绝不能因为埋点失败打断老师上课。
 */
export function reportDiagramOutcome(generationId: string | undefined, outcome: DiagramOutcome): void {
  if (!generationId) return; // 后端采集失败时不会下发 id，静默跳过
  void fetch(`/api/ai/diagram/${encodeURIComponent(generationId)}/outcome`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ outcome }),
  }).catch(() => {
    /* 采集失败无声吞掉 */
  });
}
