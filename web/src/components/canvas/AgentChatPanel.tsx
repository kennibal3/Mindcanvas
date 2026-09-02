/**
 * AgentChatPanel.tsx
 * REQ-062 Slice-2：房间内智能体（头脑风暴伙伴）对话区
 *
 * 挂在 AIWorkbench.tsx 的「问一问」Tab 下，与「生成图形」Tab 完全独立的一套 UI。
 * 本期范围（用户拍板）：纯问答——能问、能流式看回答、能看到「它读到了多少画布内容」、
 * 刷新页面对话不丢。「聊着聊着直接生成图形插入画布」的联动留到 Slice-3，本组件不做。
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Send, Loader2, AlertCircle, Sparkles } from "lucide-react";
import {
  streamAgentChat,
  fetchAgentHistory,
  type AgentMeta,
} from "../../utils/agentApi";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  truncated?: boolean;
  pending?: boolean;   // 助手消息仍在流式接收中
  errored?: boolean;   // 这一轮请求失败（配一个「重试」按钮）
}

interface AgentChatPanelProps {
  roomId: string;
}

function uid() {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function AgentChatPanel({ roomId }: AgentChatPanelProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [lastMeta, setLastMeta] = useState<AgentMeta | null>(null);
  const [lastErr, setLastErr] = useState("");

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastUserTextRef = useRef(""); // 供出错后的「重试」复用最后一条问题

  // ── 恢复历史（每个房间只在组件首次挂载时拉一次；Tab 切走再切回不重复拉）──
  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    fetchAgentHistory(roomId).then(res => {
      if (cancelled) return;
      setConversationId(res.conversation_id || "");
      setMessages(
        (res.messages || []).map(m => ({
          id: uid(),
          role: m.role,
          content: m.content,
          truncated: m.truncated,
        }))
      );
      setLoadingHistory(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ── 组件卸载（切到「生成图形」Tab 或收起工作台）时取消未完成的请求 ──
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // ── 新消息/流式增量到达时自动滚到底 ──
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const doSend = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    lastUserTextRef.current = trimmed;
    setLastErr("");

    const userMsg: DisplayMessage = { id: uid(), role: "user", content: trimmed };
    const assistantId = uid();
    const assistantMsg: DisplayMessage = { id: assistantId, role: "assistant", content: "", pending: true };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput("");
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    streamAgentChat({
      roomId,
      message: trimmed,
      conversationId: conversationId || undefined,
      signal: controller.signal,
      onMeta: (meta) => {
        setLastMeta(meta);
        if (meta.conversation_id) setConversationId(meta.conversation_id);
      },
      onChunk: (chunk) => {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: m.content + chunk } : m
        ));
      },
      onDone: (done) => {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: done.content || m.content, pending: false, truncated: !!done.truncated }
            : m
        ));
        setSending(false);
      },
      onError: (msg) => {
        setLastErr(msg);
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, pending: false, errored: true, content: m.content || "" }
            : m
        ));
        setSending(false);
      },
    });
  }, [roomId, conversationId, sending]);

  const handleSubmit = useCallback(() => {
    const text = textareaRef.current?.value ?? input;
    doSend(text);
  }, [input, doSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleRetry = () => {
    if (lastUserTextRef.current) doSend(lastUserTextRef.current);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 消息列表 */}
      <div ref={listRef} className="flex-1 overflow-y-auto min-h-0 px-3 py-2 space-y-2">
        {loadingHistory ? (
          <div className="flex items-center justify-center py-8 text-gray-400 text-xs gap-1.5">
            <Loader2 size={13} className="animate-spin" /> 正在恢复对话…
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-400 text-xs py-8">
            <Bot size={24} className="mx-auto mb-2 text-amber-200" />
            我能看到这块白板上的内容
            <br />
            问我"现在都有什么"，或者哪里没想清楚
          </div>
        ) : (
          messages.map(m => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-xl px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                  m.role === "user"
                    ? "bg-amber-500 text-white"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {m.content}
                {m.pending && m.content === "" && (
                  <Loader2 size={12} className="inline-block animate-spin ml-1 align-middle text-gray-400" />
                )}
                {m.truncated && (
                  <div className="mt-1 text-[11px] text-amber-600 flex items-center gap-1">
                    <AlertCircle size={11} /> 回答较长，结尾可能被截断
                  </div>
                )}
                {m.errored && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[11px] text-red-500 flex items-center gap-1">
                      <AlertCircle size={11} /> {lastErr || "回答失败"}
                    </span>
                    <button
                      onClick={handleRetry}
                      className="text-[11px] text-amber-600 underline hover:text-amber-700"
                    >
                      重试
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 画布读取回执：告诉老师"它这次看到了多少内容"，同 REQ-062 后端 meta 事件 */}
      {lastMeta && (
        <div className="px-3 py-1 text-[11px] text-gray-400 border-t border-gray-50 flex items-center gap-1 shrink-0">
          <Sparkles size={10} className="text-amber-300" />
          {lastMeta.canvas_elements > 0
            ? `已读取画布 ${lastMeta.canvas_elements} 个元素`
            : "这块白板目前还没有内容"}
        </div>
      )}

      {/* 输入区 */}
      <div className="border-t border-gray-100 p-2.5 shrink-0">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="问问这块白板…（Enter 发送，Shift+Enter 换行）"
            rows={2}
            disabled={sending}
            className="flex-1 resize-none text-xs border border-gray-200 rounded-lg px-2 py-1.5
                       focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            onClick={handleSubmit}
            disabled={sending || !input.trim()}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg
                       bg-amber-500 text-white hover:bg-amber-600 transition-colors
                       disabled:bg-gray-200 disabled:text-gray-400"
            title="发送"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
