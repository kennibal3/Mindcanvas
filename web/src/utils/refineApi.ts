/**
 * refineApi.ts
 * 调用后端 POST /api/ai/refine 接口
 * REQ-028（第一步）：普通文本 → Markdown AI 提炼，供生成图形前的可选预处理
 */

export interface RefineTextRequest {
  text: string;
}

export interface RefineTextResult {
  markdown: string;
  model: string;
  provider: string;
  // REQ-057：输出被上游 max_tokens 截断。截断仍返回 200 且内容通顺，
  // 不显式提示的话老师无从察觉少了东西，只会归因成「AI 不好使」。
  truncated?: boolean;
  warning?: string;
}

export interface RefineTextError {
  error: string;
}

/**
 * refineText
 * 成功返回提炼后的 Markdown；失败 throw Error（message 来自后端 error 字段）
 */
export async function refineText(req: RefineTextRequest): Promise<RefineTextResult> {
  const res = await fetch("/api/ai/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // Cookie JWT
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body: RefineTextError = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error ?? `请求失败 (${res.status})`);
  }

  return res.json() as Promise<RefineTextResult>;
}
