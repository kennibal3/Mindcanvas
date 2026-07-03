// =============================================================
// MindCanvas - 养成类对话页面 (Victoria Chat) · 手账森林版
// 功能：角色人设、多会话、Claude对话、记忆压缩、文件记忆库、主题切换
// 视觉：手账贴纸风 · 月亮发送键 · 三套可切换主题
// 路由：/chat（仅 chat_enabled 用户可访问）
// =============================================================
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Settings, Plus, Trash2, Upload, FileText,
  ChevronLeft, X, Brain, Sparkles,
  MessageSquare, ToggleLeft, ToggleRight, Loader2,
  BookOpen, User, Menu, Key, Palette,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';

// ===== 类型定义 =====
interface Persona {
  id: string;
  name: string;
  description: string;
  avatar_emoji: string;
  compress_every: number;
  api_key_hint: string;
}
interface Session {
  id: string;
  title: string;
  turn_count: number;
  compress_version: number;
  created_at: string;
  updated_at: string;
}
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  is_compressed: boolean;
  turn_number: number;
  created_at: string;
}
interface MemoryFile {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  is_active: boolean;
  char_count: number;
  created_at: string;
}

// ===== 主题系统 =====
// 三套手账风主题，每套定义一组配色 token
interface Theme {
  key: string;
  label: string;
  sticker: string;       // 主题代表贴纸
  bg: string;            // 整体背景
  sidebar: string;       // 侧边栏背景
  card: string;          // 卡片/气泡背景
  ink: string;           // 主文字
  inkSoft: string;       // 次要文字
  accent: string;        // 主强调色（按钮、高亮）
  accentSoft: string;    // 浅强调（选中态背景）
  accentInk: string;     // 强调色上的文字
  userBubble: string;    // 用户气泡
  userInk: string;       // 用户气泡文字
  aiBubble: string;      // AI气泡
  border: string;        // 虚线边框色
  moonGlow: string;      // 月亮按钮的光晕
}

const THEMES: Theme[] = [
  {
    key: 'forest',
    label: '抹茶森林',
    sticker: '🌿',
    bg: '#f4f1e8',
    sidebar: '#ebe6d6',
    card: '#fffdf6',
    ink: '#4a5240',
    inkSoft: '#8a9079',
    accent: '#7d9968',
    accentSoft: '#e3ecd5',
    accentInk: '#3a4a2c',
    userBubble: '#7d9968',
    userInk: '#fffdf6',
    aiBubble: '#fffdf6',
    border: '#cdd4b8',
    moonGlow: '#a8c089',
  },
  {
    key: 'moon',
    label: '月亮夜空',
    sticker: '🌙',
    bg: '#1f2438',
    sidebar: '#272d45',
    card: '#2f3654',
    ink: '#e8e6f0',
    inkSoft: '#9a9bb8',
    accent: '#f5d77a',
    accentSoft: '#3a4063',
    accentInk: '#2a2f47',
    userBubble: '#f5d77a',
    userInk: '#2a2f47',
    aiBubble: '#2f3654',
    border: '#444b6e',
    moonGlow: '#f5d77a',
  },
  {
    key: 'sakura',
    label: '樱花梦境',
    sticker: '🌸',
    bg: '#fdf2f4',
    sidebar: '#fbe6ea',
    card: '#fffafb',
    ink: '#6b4a52',
    inkSoft: '#b58a94',
    accent: '#e89aac',
    accentSoft: '#fbdde3',
    accentInk: '#7a3a48',
    userBubble: '#e89aac',
    userInk: '#fffafb',
    aiBubble: '#fffafb',
    border: '#f3cdd5',
    moonGlow: '#f5b3c2',
  },
];

// ===== API 工具 =====
const api = async (method: string, path: string, body?: any) => {
  const res = await fetch(`/api/chat${path}`, {
    method,
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body instanceof FormData ? body : (body ? JSON.stringify(body) : undefined),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || '请求失败');
  }
  return res.json();
};

// ===== 月亮发送按钮（CSS 弯月） =====
const MoonButton: React.FC<{ t: Theme; sending: boolean; disabled: boolean; onClick: () => void }> = ({ t, sending, disabled, onClick }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title="发送"
    style={{
      height: 52, width: 52, flexShrink: 0,
      borderRadius: '50%',
      border: 'none',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      background: t.accent,
      boxShadow: disabled ? 'none' : `0 0 0 4px ${t.moonGlow}55, 0 4px 12px ${t.moonGlow}66`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
      transition: 'transform .15s, box-shadow .2s',
    }}
    onMouseEnter={e => { if (!disabled) e.currentTarget.style.transform = 'scale(1.08) rotate(-8deg)'; }}
    onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1) rotate(0)'; }}
  >
    {sending ? (
      <Loader2 size={20} className="animate-spin" style={{ color: t.accentInk }} />
    ) : (
      // 弯月：一个圆被另一个同背景色圆遮住一部分
      <div style={{ position: 'relative', width: 24, height: 24 }}>
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: t.accentInk,
        }} />
        <div style={{
          position: 'absolute', top: -3, right: -5, width: 22, height: 22,
          borderRadius: '50%', background: t.accent,
        }} />
        {/* 小星星点缀 */}
        <span style={{ position: 'absolute', top: -6, left: -4, fontSize: 9, color: t.accentInk }}>✦</span>
      </div>
    )}
  </button>
);

// ===== 主页面 =====
const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  // 主题
  const [themeKey, setThemeKey] = useState(() => localStorage.getItem('victoria_theme') || 'forest');
  const [showThemePicker, setShowThemePicker] = useState(false);
  const t = THEMES.find(x => x.key === themeKey) || THEMES[0];
  const applyTheme = (k: string) => {
    setThemeKey(k);
    localStorage.setItem('victoria_theme', k);
    setShowThemePicker(false);
  };

  // API Key
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('victoria_api_key') || '');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [tempKey, setTempKey] = useState('');

  // 人设
  const [persona, setPersona] = useState<Persona | null>(null);
  const [showPersona, setShowPersona] = useState(false);
  const [editPersona, setEditPersona] = useState<Partial<Persona>>({});

  // 会话
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSid, setCurrentSid] = useState<string>('');
  const [showSidebar, setShowSidebar] = useState(true);

  // 消息
  const [messages, setMessages] = useState<Message[]>([]);
  const [memorySummary, setMemorySummary] = useState('');
  const [turnCount, setTurnCount] = useState(0);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // 文件记忆库
  const [showMemory, setShowMemory] = useState(false);
  const [memFiles, setMemFiles] = useState<MemoryFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);
  useEffect(() => { scrollToBottom(); }, [messages]);

  useEffect(() => {
    loadPersona();
    loadSessions();
    loadMemFiles();
  }, []);

  const loadPersona = async () => {
    try {
      const data = await api('GET', '/persona');
      setPersona(data.persona);
      setEditPersona(data.persona);
    } catch (e: any) { setError(e.message); }
  };
  const loadSessions = async () => {
    try {
      const data = await api('GET', '/sessions');
      setSessions(data.sessions || []);
    } catch {}
  };
  const loadMessages = async (sid: string) => {
    try {
      const data = await api('GET', `/sessions/${sid}/messages`);
      setMessages(data.messages || []);
      setMemorySummary(data.memory_summary || '');
      setTurnCount(data.turn_count || 0);
    } catch (e: any) { setError(e.message); }
  };
  const selectSession = (sid: string) => {
    setCurrentSid(sid);
    loadMessages(sid);
    setError('');
  };
  const createSession = async () => {
    try {
      const data = await api('POST', '/sessions', {});
      await loadSessions();
      selectSession(data.session_id);
    } catch (e: any) { setError(e.message); }
  };
  const deleteSession = async (sid: string) => {
    if (!confirm('确定删除这个对话？')) return;
    try {
      await api('DELETE', `/sessions/${sid}`);
      await loadSessions();
      if (currentSid === sid) { setCurrentSid(''); setMessages([]); }
    } catch {}
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    if (!apiKey) { setShowKeyInput(true); return; }
    if (!currentSid) {
      try {
        const data = await api('POST', '/sessions', {});
        await loadSessions();
        setCurrentSid(data.session_id);
        await doSend(data.session_id);
      } catch (e: any) { setError(e.message); }
      return;
    }
    await doSend(currentSid);
  };

  const doSend = async (sid: string) => {
    const userContent = input.trim();
    setInput('');
    setSending(true);
    setError('');
    const tempUserMsg: Message = {
      id: 'temp-user-' + Date.now(),
      role: 'user', content: userContent,
      is_compressed: false, turn_number: turnCount + 1,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);
    try {
      const data = await api('POST', `/sessions/${sid}/send`, {
        content: userContent, api_key: apiKey,
      });
      const aiMsg: Message = {
        id: data.reply_id || 'temp-ai-' + Date.now(),
        role: 'assistant', content: data.reply,
        is_compressed: false, turn_number: data.turn_count,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev.filter(m => m.id !== tempUserMsg.id), tempUserMsg, aiMsg]);
      setTurnCount(data.turn_count);
      loadSessions();
      if (data.should_compress) {
        setTimeout(() => {
          setMemorySummary('🔄 正在整理记忆...');
          setTimeout(async () => {
            const refreshed = await api('GET', `/sessions/${sid}/messages`);
            setMemorySummary(refreshed.memory_summary || '');
          }, 5000);
        }, 1000);
      }
    } catch (e: any) {
      setError(e.message);
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
    } finally {
      setSending(false);
    }
  };

  const savePersona = async () => {
    try {
      await api('PUT', '/persona', editPersona);
      await loadPersona();
      setShowPersona(false);
    } catch (e: any) { setError(e.message); }
  };
  const loadMemFiles = async () => {
    try {
      const data = await api('GET', '/memory/files');
      setMemFiles(data.files || []);
    } catch {}
  };
  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api('POST', '/memory/upload', fd);
      await loadMemFiles();
    } catch (err: any) { setError(err.message); }
    finally { setUploading(false); e.target.value = ''; }
  };
  const toggleFile = async (fid: string) => {
    try { await api('PATCH', `/memory/files/${fid}/toggle`); await loadMemFiles(); } catch {}
  };
  const deleteFile = async (fid: string) => {
    if (!confirm('从记忆库删除此文件？')) return;
    try { await api('DELETE', `/memory/files/${fid}`); await loadMemFiles(); } catch {}
  };
  const saveAPIKey = () => {
    if (tempKey.trim()) {
      localStorage.setItem('victoria_api_key', tempKey.trim());
      setApiKey(tempKey.trim());
    }
    setShowKeyInput(false);
    setTempKey('');
  };

  const fmtSize = (bytes: number) => {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / 1024 / 1024).toFixed(1) + 'MB';
  };
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const currentSession = sessions.find(s => s.id === currentSid);
  const activeFileCount = memFiles.filter(f => f.is_active).length;

  // 通用：手账卡片样式
  const dashedCard = (active = false): React.CSSProperties => ({
    border: `2px dashed ${active ? t.accent : t.border}`,
    borderRadius: 18,
    background: active ? t.accentSoft : t.card,
  });

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: t.bg, fontFamily: '"PingFang SC","Microsoft YaHei",system-ui,sans-serif' }}>

      {/* ===== 左侧边栏 ===== */}
      {showSidebar && (
        <div style={{ width: 270, background: t.sidebar, display: 'flex', flexDirection: 'column', flexShrink: 0, borderRight: `2px dashed ${t.border}` }}>
          {/* 顶部 */}
          <div style={{ padding: 18, borderBottom: `2px dashed ${t.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: t.card, border: `2px dashed ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                  {persona?.avatar_emoji || '🌸'}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: t.ink }}>{persona?.name || 'AI伴侣'}</div>
                  <div style={{ fontSize: 12, color: t.inkSoft }}>与 {user?.display_name || 'Victoria'}</div>
                </div>
              </div>
              <button onClick={() => navigate('/dashboard')} title="返回主页"
                style={{ padding: 5, borderRadius: 10, border: 'none', background: 'transparent', color: t.inkSoft, cursor: 'pointer' }}>
                <ChevronLeft size={18} />
              </button>
            </div>
            <button onClick={createSession}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 0', background: t.accent, color: t.accentInk, borderRadius: 16, border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: `0 3px 0 ${t.border}` }}>
              <Plus size={16} /> 开启新对话
            </button>
          </div>

          {/* 会话列表 */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            {sessions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: t.inkSoft }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🌱</div>
                点击「开启新对话」<br />和我聊聊吧～
              </div>
            ) : (
              sessions.map(s => {
                const sel = currentSid === s.id;
                return (
                  <div key={s.id} onClick={() => selectSession(s.id)}
                    style={{ ...dashedCard(sel), display: 'flex', alignItems: 'center', gap: 9, padding: '11px 12px', cursor: 'pointer', marginBottom: 9, position: 'relative', transition: 'all .15s' }}
                    className="vc-session">
                    <MessageSquare size={15} style={{ flexShrink: 0, color: sel ? t.accent : t.inkSoft }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: t.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</div>
                      <div style={{ fontSize: 11, color: t.inkSoft }}>{s.turn_count}轮 · {fmtTime(s.updated_at)}</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); deleteSession(s.id); }}
                      className="vc-del"
                      style={{ padding: 5, borderRadius: 8, border: 'none', background: 'transparent', color: t.inkSoft, cursor: 'pointer', opacity: 0, transition: 'opacity .15s' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* 底部工具栏 */}
          <div style={{ padding: 12, borderTop: `2px dashed ${t.border}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <SideBtn t={t} icon={<Palette size={15} />} label="切换主题" extra={<span>{t.sticker}</span>} onClick={() => setShowThemePicker(true)} />
            <SideBtn t={t} icon={<Settings size={15} />} label="角色人设" onClick={() => setShowPersona(true)} />
            <SideBtn t={t} icon={<Brain size={15} />} label="记忆文件库"
              extra={activeFileCount > 0 ? <span style={{ background: t.accent, color: t.accentInk, fontSize: 11, padding: '1px 7px', borderRadius: 10, fontWeight: 700 }}>{activeFileCount}</span> : null}
              onClick={() => { setShowMemory(true); loadMemFiles(); }} />
            <SideBtn t={t} icon={<Key size={15} />} label={apiKey ? `API Key ••••${apiKey.slice(-4)}` : 'API Key 未设置'}
              onClick={() => { setTempKey(apiKey); setShowKeyInput(true); }} />
          </div>
        </div>
      )}

      {/* ===== 主对话区域 ===== */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* 顶部栏 */}
        <div style={{ height: 56, background: t.card, borderBottom: `2px dashed ${t.border}`, display: 'flex', alignItems: 'center', padding: '0 18px', gap: 12, flexShrink: 0 }}>
          <button onClick={() => setShowSidebar(!showSidebar)}
            style={{ padding: 7, borderRadius: 10, border: 'none', background: 'transparent', color: t.inkSoft, cursor: 'pointer' }}>
            <Menu size={18} />
          </button>
          <span style={{ fontSize: 18 }}>{persona?.avatar_emoji || '🌸'}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: t.ink }}>
            {currentSession?.title || (currentSid ? '对话中' : '选择或新建对话')}
          </span>
          {turnCount > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: 12, color: t.inkSoft }}>
              第 {turnCount} 轮{persona?.compress_every ? ` · 每${persona.compress_every}轮整理记忆` : ''}
            </span>
          )}
          {memorySummary && !memorySummary.startsWith('🔄') && (
            <button title="查看记忆摘要" onClick={() => alert('当前记忆摘要：\n\n' + memorySummary)}
              style={{ marginLeft: turnCount > 0 ? 12 : 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: t.accentInk, background: t.accentSoft, padding: '5px 11px', borderRadius: 12, border: `1px dashed ${t.accent}`, cursor: 'pointer' }}>
              <Sparkles size={12} /> 有记忆
            </button>
          )}
        </div>

        {/* 消息区域 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {memorySummary && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: t.accentSoft, border: `1px dashed ${t.accent}`, borderRadius: 16, padding: '6px 16px', fontSize: 12, color: t.accentInk }}>
                <Brain size={13} />
                <span>{memorySummary.startsWith('🔄') ? memorySummary : `记忆已整理 · 第${currentSession?.compress_version || 1}版`}</span>
              </div>
            </div>
          )}

          {messages.length === 0 && currentSid && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '60px 0' }}>
              <div style={{ fontSize: 56, marginBottom: 16, filter: `drop-shadow(0 4px 8px ${t.moonGlow}66)` }}>{persona?.avatar_emoji || '🌸'}</div>
              <p style={{ color: t.ink, fontSize: 16, fontWeight: 700, marginBottom: 6 }}>你好呀，我是{persona?.name || 'AI伴侣'}</p>
              <p style={{ color: t.inkSoft, fontSize: 13 }}>跟我说说今天发生了什么？🌿</p>
            </div>
          )}
          {!currentSid && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '60px 0' }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>🌳</div>
              <p style={{ color: t.inkSoft, fontSize: 14 }}>选择一个对话，或开启新对话开始～</p>
            </div>
          )}

          {messages.map(msg => {
            const isUser = msg.role === 'user';
            return (
              <div key={msg.id} style={{ display: 'flex', gap: 11, flexDirection: isUser ? 'row-reverse' : 'row', opacity: msg.is_compressed ? 0.4 : 1 }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, background: t.card, border: `2px dashed ${isUser ? t.accent : t.border}` }}>
                  {isUser ? <User size={16} style={{ color: t.accent }} /> : <span>{persona?.avatar_emoji || '🌸'}</span>}
                </div>
                <div style={{ maxWidth: '70%', display: 'flex', flexDirection: 'column', gap: 4, alignItems: isUser ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    padding: '11px 15px', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                    background: isUser ? t.userBubble : t.aiBubble,
                    color: isUser ? t.userInk : t.ink,
                    borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    border: isUser ? 'none' : `2px dashed ${t.border}`,
                    boxShadow: isUser ? `0 2px 6px ${t.moonGlow}44` : 'none',
                  }}>
                    {msg.content}
                  </div>
                  <div style={{ fontSize: 11, color: t.inkSoft, padding: '0 4px' }}>
                    {fmtTime(msg.created_at)}{msg.is_compressed && ' · 已收进记忆'}
                  </div>
                </div>
              </div>
            );
          })}

          {sending && (
            <div style={{ display: 'flex', gap: 11 }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, background: t.card, border: `2px dashed ${t.border}` }}>
                <span>{persona?.avatar_emoji || '🌸'}</span>
              </div>
              <div style={{ background: t.aiBubble, border: `2px dashed ${t.border}`, borderRadius: '18px 18px 18px 4px', padding: '13px 16px' }}>
                <div style={{ display: 'flex', gap: 5 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} className="animate-bounce"
                      style={{ width: 8, height: 8, background: t.accent, borderRadius: '50%', animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 错误提示 */}
        {error && (
          <div style={{ margin: '0 18px 10px', padding: 13, background: '#fce8e6', border: '2px dashed #e8a8a0', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: '#b04a3f' }}>{error}</span>
            <button onClick={() => setError('')} style={{ border: 'none', background: 'transparent', color: '#b04a3f', cursor: 'pointer' }}><X size={15} /></button>
          </div>
        )}

        {/* 输入区域 */}
        <div style={{ padding: 18, background: t.card, borderTop: `2px dashed ${t.border}` }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder={currentSid ? `和${persona?.name || 'AI'}说说话... (Enter发送，Shift+Enter换行)` : '开启新对话后开始聊天'}
              disabled={sending || !currentSid}
              rows={2}
              style={{ flex: 1, resize: 'none', border: `2px dashed ${t.border}`, borderRadius: 18, padding: '13px 16px', fontSize: 14, outline: 'none', background: t.bg, color: t.ink, fontFamily: 'inherit' }}
            />
            <MoonButton t={t} sending={sending} disabled={!input.trim() || sending || !currentSid} onClick={sendMessage} />
          </div>
        </div>
      </div>

      {/* ===== 主题切换弹窗 ===== */}
      {showThemePicker && (
        <Modal t={t} onClose={() => setShowThemePicker(false)} title="选择主题 🎨" maxW={420}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {THEMES.map(th => (
              <button key={th.key} onClick={() => applyTheme(th.key)}
                style={{ border: `2px dashed ${th.key === themeKey ? th.accent : t.border}`, borderRadius: 16, padding: 14, background: th.bg, cursor: 'pointer', textAlign: 'center', transition: 'transform .15s' }}
                onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-3px)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>{th.sticker}</div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 8 }}>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: th.accent }} />
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: th.userBubble }} />
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: th.card, border: `1px solid ${th.border}` }} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: th.ink }}>{th.label}</div>
                {th.key === themeKey && <div style={{ fontSize: 11, color: th.accent, marginTop: 3 }}>✓ 使用中</div>}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* ===== 人设设置弹窗 ===== */}
      {showPersona && (
        <Modal t={t} onClose={() => setShowPersona(false)} title="角色人设 ⚙️" maxW={460}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.inkSoft, marginBottom: 6 }}>头像</label>
                <input type="text" value={editPersona.avatar_emoji || ''} maxLength={2}
                  onChange={e => setEditPersona(p => ({ ...p, avatar_emoji: e.target.value }))}
                  style={{ width: 60, textAlign: 'center', border: `2px dashed ${t.border}`, borderRadius: 12, padding: '8px 0', fontSize: 22, background: t.bg, color: t.ink, outline: 'none' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.inkSoft, marginBottom: 6 }}>角色名称</label>
                <input type="text" value={editPersona.name || ''} placeholder="如：小绿、星辰、Leo..."
                  onChange={e => setEditPersona(p => ({ ...p, name: e.target.value }))}
                  style={{ width: '100%', border: `2px dashed ${t.border}`, borderRadius: 12, padding: '10px 12px', fontSize: 14, background: t.bg, color: t.ink, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.inkSoft, marginBottom: 6 }}>人设描述（系统提示词）</label>
              <textarea value={editPersona.description || ''} rows={5}
                onChange={e => setEditPersona(p => ({ ...p, description: e.target.value }))}
                placeholder="描述AI的性格、说话方式、背景故事等..."
                style={{ width: '100%', border: `2px dashed ${t.border}`, borderRadius: 12, padding: '10px 12px', fontSize: 14, background: t.bg, color: t.ink, outline: 'none', resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              <p style={{ fontSize: 11, color: t.inkSoft, marginTop: 5 }}>这段描述会作为系统提示词发给Claude，决定AI的性格和行为方式。</p>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.inkSoft, marginBottom: 6 }}>记忆整理频率（每 N 轮对话整理一次）</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input type="range" min={5} max={100} step={5} value={editPersona.compress_every || 20}
                  onChange={e => setEditPersona(p => ({ ...p, compress_every: Number(e.target.value) }))}
                  style={{ flex: 1, accentColor: t.accent }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: t.accent, width: 48, textAlign: 'center' }}>{editPersona.compress_every || 20} 轮</span>
              </div>
              <p style={{ fontSize: 11, color: t.inkSoft, marginTop: 5 }}>轮次越少整理越频繁（省token），越多记忆越完整（费token）。</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <ModalBtn t={t} variant="ghost" onClick={() => setShowPersona(false)}>取消</ModalBtn>
            <ModalBtn t={t} variant="solid" onClick={savePersona}>保存人设</ModalBtn>
          </div>
        </Modal>
      )}

      {/* ===== API Key 弹窗 ===== */}
      {showKeyInput && (
        <Modal t={t} onClose={() => setShowKeyInput(false)} title="设置 API Key 🔑" maxW={380}>
          <p style={{ fontSize: 12, color: t.inkSoft, marginBottom: 16 }}>
            API Key 仅存储在本地浏览器，不会上传到服务器，安全可放心使用。
          </p>
          <input type="password" value={tempKey} placeholder="sk-..." autoFocus
            onChange={e => setTempKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveAPIKey()}
            style={{ width: '100%', border: `2px dashed ${t.border}`, borderRadius: 12, padding: '11px 12px', fontSize: 14, background: t.bg, color: t.ink, outline: 'none', marginBottom: 16, boxSizing: 'border-box' }} />
          {apiKey && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: 10, background: t.accentSoft, borderRadius: 12 }}>
              <span style={{ fontSize: 12, color: t.accentInk }}>当前Key: ••••{apiKey.slice(-8)}</span>
              <button onClick={() => { localStorage.removeItem('victoria_api_key'); setApiKey(''); setShowKeyInput(false); }}
                style={{ marginLeft: 'auto', fontSize: 12, color: '#c0524a', border: 'none', background: 'transparent', cursor: 'pointer' }}>清除</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <ModalBtn t={t} variant="ghost" onClick={() => setShowKeyInput(false)}>取消</ModalBtn>
            <ModalBtn t={t} variant="solid" onClick={saveAPIKey} disabled={!tempKey.trim()}>保存</ModalBtn>
          </div>
        </Modal>
      )}

      {/* ===== 记忆文件库弹窗 ===== */}
      {showMemory && (
        <Modal t={t} onClose={() => setShowMemory(false)} title="记忆文件库 🧠" subtitle="上传的文件将永久作为AI的背景知识" maxW={520} noPad>
          <div style={{ padding: 16, borderBottom: `2px dashed ${t.border}` }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16, border: `2px dashed ${uploading ? t.border : t.accent}`, borderRadius: 14, cursor: 'pointer', background: uploading ? t.bg : t.accentSoft }}>
              {uploading ? <Loader2 size={18} className="animate-spin" style={{ color: t.inkSoft }} /> : <Upload size={18} style={{ color: t.accent }} />}
              <div style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 700, color: t.accentInk }}>点击上传文件</span>
                <span style={{ color: t.inkSoft }}> · .md .txt .doc .docx（≤10MB）</span>
              </div>
              <input ref={fileInputRef} type="file" accept=".md,.markdown,.txt,.doc,.docx" style={{ display: 'none' }} disabled={uploading} onChange={uploadFile} />
            </label>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, maxHeight: 360 }}>
            {memFiles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: t.inkSoft }}>
                <BookOpen size={26} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
                <p>暂无记忆文件</p>
                <p style={{ fontSize: 11, marginTop: 4 }}>上传 Markdown 或 Word 文件，AI会记住内容</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {memFiles.map(f => (
                  <div key={f.id} style={{ ...dashedCard(f.is_active), opacity: f.is_active ? 1 : 0.6, display: 'flex', alignItems: 'center', gap: 11, padding: 12 }}>
                    <FileText size={16} style={{ color: f.is_active ? t.accent : t.inkSoft }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: t.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.file_name}</div>
                      <div style={{ fontSize: 11, color: t.inkSoft }}>{f.file_type} · {fmtSize(f.file_size)} · {f.char_count} 字符</div>
                    </div>
                    <button onClick={() => toggleFile(f.id)} title={f.is_active ? '点击停用' : '点击启用'}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 9px', borderRadius: 10, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: f.is_active ? t.accent : t.border, color: f.is_active ? t.accentInk : t.inkSoft }}>
                      {f.is_active ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
                      {f.is_active ? '启用' : '停用'}
                    </button>
                    <button onClick={() => deleteFile(f.id)} title="从记忆库删除"
                      style={{ padding: 6, borderRadius: 9, border: 'none', background: 'transparent', color: t.inkSoft, cursor: 'pointer' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* 局部样式：hover 显示删除键 */}
      <style>{`
        .vc-session:hover .vc-del { opacity: 1 !important; }
        .vc-session:hover { transform: translateX(2px); }
      `}</style>
    </div>
  );
};

// ===== 侧边栏按钮 =====
const SideBtn: React.FC<{ t: Theme; icon: React.ReactNode; label: string; extra?: React.ReactNode; onClick: () => void }> = ({ t, icon, label, extra, onClick }) => (
  <button onClick={onClick}
    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 12, border: 'none', background: 'transparent', color: t.ink, fontSize: 13, cursor: 'pointer', transition: 'background .15s' }}
    onMouseEnter={e => e.currentTarget.style.background = t.card}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
    <span style={{ color: t.inkSoft, display: 'flex' }}>{icon}</span>
    <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
    {extra}
  </button>
);

// ===== 通用弹窗 =====
const Modal: React.FC<{ t: Theme; onClose: () => void; title: string; subtitle?: string; maxW?: number; noPad?: boolean; children: React.ReactNode }> = ({ t, onClose, title, subtitle, maxW = 440, noPad, children }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }} onClick={onClose}>
    <div onClick={e => e.stopPropagation()}
      style={{ background: t.card, borderRadius: 22, border: `3px dashed ${t.border}`, width: '100%', maxWidth: maxW, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: noPad ? 20 : '22px 22px 0' }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: t.ink, margin: 0 }}>{title}</h3>
          {subtitle && <p style={{ fontSize: 12, color: t.inkSoft, margin: '4px 0 0' }}>{subtitle}</p>}
        </div>
        <button onClick={onClose} style={{ padding: 5, borderRadius: 9, border: 'none', background: 'transparent', color: t.inkSoft, cursor: 'pointer' }}><X size={17} /></button>
      </div>
      <div style={{ padding: noPad ? 0 : 22, overflowY: 'auto' }}>{children}</div>
    </div>
  </div>
);

// ===== 弹窗按钮 =====
const ModalBtn: React.FC<{ t: Theme; variant: 'solid' | 'ghost'; disabled?: boolean; onClick: () => void; children: React.ReactNode }> = ({ t, variant, disabled, onClick, children }) => (
  <button onClick={onClick} disabled={disabled}
    style={{
      flex: 1, padding: '11px 0', fontSize: 14, fontWeight: 700, borderRadius: 14, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      border: variant === 'ghost' ? `2px dashed ${t.border}` : 'none',
      background: variant === 'solid' ? t.accent : 'transparent',
      color: variant === 'solid' ? t.accentInk : t.inkSoft,
      boxShadow: variant === 'solid' && !disabled ? `0 3px 0 ${t.border}` : 'none',
    }}>
    {children}
  </button>
);

export default ChatPage;
