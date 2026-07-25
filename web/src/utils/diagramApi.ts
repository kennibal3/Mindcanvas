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
//
// ⚠️ 2026-07-25 语义订正：这些是「动作」不是「评价」。老师生成完无法判断好坏，
// **插进画布看一眼就是默认动作**，所以 inserted 零区分度；不满意时是在画布上删掉
// 那组元素或 Ctrl+Z，不会回工作台删历史。真质量判据＝后端十分钟后观测的存活率
// （survival 列）。但 switched_type / regenerated_same_input 是准的信号。
export type DiagramOutcome =
  | "inserted"               // 插进画布看一眼（中性动作；同时上报 element_ids 供存活观测）
  | "regenerated_same_input" // 同一段文本重来 ≈ 这张不行（准）
  | "switched_type"          // 换个图型重来 ≈ 选型不对（准）
  | "deleted_history";       // 删掉工作台历史条目（弱信号）

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
export function reportDiagramOutcome(
  generationId: string | undefined,
  outcome: DiagramOutcome,
  elementIds?: string[] // 仅 inserted 时传：这批插进画布的元素 id，供后端观测存活率
): void {
  if (!generationId) return; // 后端采集失败时不会下发 id，静默跳过
  void fetch(`/api/ai/diagram/${encodeURIComponent(generationId)}/outcome`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(
      elementIds && elementIds.length > 0 ? { outcome, element_ids: elementIds } : { outcome }
    ),
  }).catch(() => {
    /* 采集失败无声吞掉 */
  });
}
