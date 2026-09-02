/**
 * agentApi.ts
 * REQ-062：房间内智能体（头脑风暴伙伴）前端调用层
 *
 *   POST /api/ai/agent/chat     多轮对话，SSE 流式返回（后端见 agent_handler.go）
 *   GET  /api/ai/agent/history  恢复上次对话
 *
 * 项目里第一次真正消费流式接口（此前 ChatStream 是死代码，见 REQ-056 DEV_LOG）。
 * fetch 的 POST 不能用浏览器原生 EventSource（它只支持 GET），
 * 改用 fetch + ReadableStream 手动切 SSE 帧：按空行分帧、每帧内解析 "event:" / "data:" 两行。
 */

export interface AgentMeta {
  conversation_id: string;
  canvas_elements: number;
  canvas_chars: number;
  canvas_source: string;    // "redis" | "database"（agent_service.go 照抄 ws_handler 的读取顺序）
  canvas_truncated: boolean;
  model: string;
}

export interface AgentDone {
  content: string;
  finished: true;
  conversation_id: string;
  model: string;
  truncated?: boolean;
  warning?: string;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  truncated: boolean;
  created_at: string;
}

export interface AgentHistoryResponse {
  conversation_id: string;
  messages: AgentMessage[];
}

export interface StreamAgentChatArgs {
  roomId: string;
  message: string;
  conversationId?: string;
  isTest?: boolean;
  onMeta?: (meta: AgentMeta) => void;
  onChunk?: (content: string) => void;
  onDone?: (done: AgentDone) => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
}

/**
 * streamAgentChat
 * 发起一次流式对话。不 throw——所有失败路径都走 onError 回调，
 * 方便调用方统一在聊天气泡里显示错误而不必额外套 try/catch。
 */
export async function streamAgentChat(args: StreamAgentChatArgs): Promise<void> {
  const { roomId, message, conversationId, isTest, onMeta, onChunk, onDone, onError, signal } = args;

  let res: Response;
  try {
    res = await fetch("/api/ai/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal,
      body: JSON.stringify({
        room_id: roomId,
        message,
        conversation_id: conversationId || undefined,
        is_test: !!isTest,
      }),
    });
  } catch (e: any) {
    if (e?.name === "AbortError") return; // 主动取消，不算错误
    onError?.("网络连接失败，请检查网络后重试");
    return;
  }

  if (!res.ok || !res.body) {
    // 后端 guard() 失败（未开通/无权限/未配置）走普通 JSON 错误体，不是 SSE
    let msg = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      msg = body.message || body.error || msg;
    } catch { /* 非 JSON 响应，用默认文案 */ }
    onError?.(msg);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE 帧以空行分隔；最后一个可能不完整，留在 buf 里等下一批数据补全
      let sep;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        let event = "message";
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        let payload: any;
        try {
          payload = JSON.parse(data);
        } catch {
          continue; // 畸形帧，跳过不中断整个流
        }
        if (event === "meta") onMeta?.(payload as AgentMeta);
        else if (event === "chunk") onChunk?.(payload.content ?? "");
        else if (event === "error") onError?.(payload.error ?? "智能体暂时无法回答，请稍后重试");
        else if (event === "done") onDone?.(payload as AgentDone);
      }
    }
  } catch (e: any) {
    if (e?.name !== "AbortError") onError?.("回答中断，请重试");
  }
}

/**
 * fetchAgentHistory
 * 恢复房间内上次对话（供刷新页面/重新展开面板时调用）。
 * 失败静默返回空——历史恢复不到不该拦住老师开始新对话。
 */
export async function fetchAgentHistory(roomId: string): Promise<AgentHistoryResponse> {
  try {
    const res = await fetch(`/api/ai/agent/history?room_id=${encodeURIComponent(roomId)}`, {
      credentials: "include",
    });
    if (!res.ok) return { conversation_id: "", messages: [] };
    return await res.json();
  } catch {
    return { conversation_id: "", messages: [] };
  }
}
