/**
 * diagramApi.ts
 * 调用后端 POST /api/ai/diagram 接口
 */

import type { DiagramData } from "./diagramBuilder";

export type DiagramType = "mindmap" | "flowchart" | "timeline" | "orgchart" | "fishbone";

export interface GenerateDiagramRequest {
  markdown: string;
  diagram_type: DiagramType;
}

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
