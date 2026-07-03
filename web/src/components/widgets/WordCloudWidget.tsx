// =============================================================
// MindCanvas v4.3 - 词云 Widget（教师+学生视图）
// REQ-020修复：固定白色背景，移除所有 dark: 前缀 class
// V4.3-STABLE：handleSetStatus 不产生三层嵌套
// =============================================================
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Cloud, Hash, Users, Play, Pause, StopCircle, Trash2,
} from 'lucide-react';
import { useRoomStore } from '@/store/roomStore';

interface WordCloudWidgetProps {
  id: string;
  payload: Record<string, any>;
  isTeacher: boolean;
  isLocked?: boolean;
  onUpdate: (payload: Record<string, any>) => void;
  onSubmit?: (action: string, data: Record<string, any>) => void;
}

// 词云颜色池（固定，不随主题变化）
const WORD_COLORS = [
  '#6366F1', '#8B5CF6', '#EC4899', '#EF4444',
  '#F97316', '#EAB308', '#22C55E', '#06B6D4',
  '#3B82F6', '#14B8A6',
];

// 从 payload 提取内层业务字段，兼容嵌套/平铺两种格式
function extractInner(payload: Record<string, any>): Record<string, any> {
  const inner = payload?.payload;
  if (
    inner !== null &&
    inner !== undefined &&
    typeof inner === 'object' &&
    !Array.isArray(inner)
  ) {
    return inner as Record<string, any>;
  }
  return payload;
}

// 螺旋布局算法：将词云词语排列在 SVG 空间内
interface WordItem {
  word: string;
  count: number;
  x: number;
  y: number;
  fontSize: number;
  color: string;
}

function layoutWords(
  words: Record<string, number>,
  width: number,
  height: number,
): WordItem[] {
  const entries = Object.entries(words)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 40);

  if (entries.length === 0) return [];

  const maxCount = entries[0]?.[1] || 1;
  const cx = width / 2;
  const cy = height / 2;

  const items: WordItem[] = [];
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];

  entries.forEach(([word, count], idx) => {
    const ratio    = count / maxCount;
    const fontSize = Math.round(12 + ratio * 18);
    const color    = WORD_COLORS[idx % WORD_COLORS.length];
    const charW    = fontSize * 0.6;
    const wordW    = word.length * charW;
    const wordH    = fontSize;

    // 螺旋搜索不重叠位置
    let placed_ = false;
    for (let r = 0; r < 200; r += 3) {
      const angle = r * 0.5;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle) * 0.6;

      // 边界检查
      if (
        x - wordW / 2 < 4 || x + wordW / 2 > width - 4 ||
        y - wordH / 2 < 4 || y + wordH / 2 > height - 4
      ) continue;

      // 重叠检查
      const overlap = placed.some(p =>
        Math.abs(x - p.x) < (wordW / 2 + p.w / 2 + 4) &&
        Math.abs(y - p.y) < (wordH / 2 + p.h / 2 + 2)
      );

      if (!overlap) {
        items.push({ word, count, x, y, fontSize, color });
        placed.push({ x, y, w: wordW, h: wordH });
        placed_ = true;
        break;
      }
    }

    // 实在放不下就强制放（小字）
    if (!placed_) {
      const fallbackX = 10 + (idx % 5) * (width / 5);
      const fallbackY = height - 20 - Math.floor(idx / 5) * 20;
      items.push({
        word, count,
        x: Math.min(fallbackX, width - 10),
        y: Math.max(fallbackY, 10),
        fontSize: 10,
        color,
      });
    }
  });

  return items;
}

const WordCloudWidget: React.FC<WordCloudWidgetProps> = ({
  id, payload, isTeacher, isLocked, onUpdate, onSubmit,
}) => {
  const currentUserUUID = useRoomStore(s => s.currentUserUUID);

  // 提取内层业务字段（兼容嵌套/平铺）
  const inner = extractInner(payload);

  const prompt:    string                   = (inner?.prompt   as string)                   ?? '请输入关键词';
  const words:     Record<string, number>   = (inner?.words    as Record<string, number>)   ?? {};
  const maxWords:  number                   = (inner?.max_words_per_student as number)      ?? 3;
  const anonymous: boolean                  = !!(inner?.is_anonymous ?? inner?.anonymous);

  // 状态：优先 status 字段，兼容旧 is_open
  const rawStatus = (inner?.status as string) || '';
  const isOpen    = !!(inner?.is_open as boolean);
  const status    = rawStatus || (isOpen ? 'open' : 'draft');

  // 学生已提交词语（从本地追踪）
  const [myWords, setMyWords]       = useState<string[]>([]);
  const [inputWord, setInputWord]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // SVG 尺寸
  const svgRef  = useRef<SVGSVGElement>(null);
  const [svgSize, setSvgSize] = useState({ w: 300, h: 180 });

  useEffect(() => {
    if (!svgRef.current) return;
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        setSvgSize({
          w: entry.contentRect.width  || 300,
          h: entry.contentRect.height || 180,
        });
      }
    });
    obs.observe(svgRef.current);
    return () => obs.disconnect();
  }, []);

  const wordItems = useMemo(
    () => layoutWords(words, svgSize.w, svgSize.h),
    [words, svgSize.w, svgSize.h]
  );

  const uniqueWords = Object.keys(words).length;
  const totalWords  = Object.values(words).reduce((s, v) => s + v, 0);

  // V4.3-STABLE：传 inner + 新状态，不产生三层嵌套
  const handleSetStatus = (newStatus: string) => {
    onUpdate({ ...inner, status: newStatus, is_open: newStatus === 'open' });
  };

  const handleDelete = () => {
    if (confirm('确定删除词云？')) onUpdate({ __delete: true });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  const handleSubmit = () => {
    const word = inputWord.trim();
    if (!word || submitting || isLocked || myWords.length >= maxWords) return;
    if (myWords.includes(word)) {
      setSubmitError('已提交过这个词');
      return;
    }

    setSubmitting(true);
    setSubmitError('');

    onSubmit?.('add_word', { word });

    setMyWords(prev => [...prev, word]);
    setInputWord('');
    setSubmitting(false);
  };

  return (
    // REQ-020修复：固定白色背景+固定文字颜色，不随暗色主题变化
    <div
      className="bg-white rounded-xl shadow-lg border border-gray-200 flex flex-col overflow-hidden"
      style={{ minHeight: '260px', color: '#1f2937' }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 flex-shrink-0 bg-gray-50">
        <div className="flex items-center gap-2 min-w-0">
          <Cloud className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-800 truncate">{prompt}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* 状态徽章 */}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            status === 'open'   ? 'bg-green-100 text-green-700'  :
            status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
            status === 'closed' ? 'bg-red-100 text-red-600'      :
            'bg-gray-100 text-gray-500'
          }`}>
            {status === 'open'   ? '进行中' :
             status === 'paused' ? '已暂停' :
             status === 'closed' ? '已结束' :
             '未开始'}
          </span>
          {isTeacher && (
            <button
              onClick={handleDelete}
              className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 词云可视化区域 */}
      <div className="flex-1 relative overflow-hidden bg-gray-50" style={{ minHeight: '140px' }}>
        {wordItems.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
            <Cloud className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">等待大家提交词语...</p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            className="overflow-visible"
            style={{ minHeight: '140px' }}
          >
            {wordItems.map((item, idx) => (
              <text
                key={`${item.word}-${idx}`}
                x={item.x}
                y={item.y}
                fontSize={item.fontSize}
                fill={item.color}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
                  fontWeight: item.count > 2 ? 600 : 400,
                  opacity:    0.85,
                  cursor:     'default',
                  userSelect: 'none',
                  transition: 'all 0.3s ease',
                }}
              >
                {item.word}
              </text>
            ))}
          </svg>
        )}
      </div>

      {/* 统计栏 */}
      <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-50 border-t border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <Hash className="w-3 h-3" />
          <span>{uniqueWords} 个词</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <Users className="w-3 h-3" />
          <span>{totalWords} 次提交</span>
        </div>
      </div>

      {/* 教师控制区（主操作按钮直接显示）*/}
      {isTeacher && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-t border-gray-100 flex-shrink-0 bg-white">
          {status === 'draft' && (
            <button
              onClick={() => handleSetStatus('open')}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-600 transition-colors"
            >
              <Play className="w-3 h-3" /> 开始
            </button>
          )}
          {status === 'open' && (
            <>
              <button
                onClick={() => handleSetStatus('paused')}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-yellow-500 text-white text-xs font-medium hover:bg-yellow-600 transition-colors"
              >
                <Pause className="w-3 h-3" /> 暂停
              </button>
              <button
                onClick={() => handleSetStatus('closed')}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors"
              >
                <StopCircle className="w-3 h-3" /> 结束
              </button>
            </>
          )}
          {status === 'paused' && (
            <>
              <button
                onClick={() => handleSetStatus('open')}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-600 transition-colors"
              >
                <Play className="w-3 h-3" /> 继续
              </button>
              <button
                onClick={() => handleSetStatus('closed')}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors"
              >
                <StopCircle className="w-3 h-3" /> 结束
              </button>
            </>
          )}
          {status === 'closed' && (
            <span className="text-xs text-gray-400 italic">词云已结束</span>
          )}
        </div>
      )}

      {/* 学生提交区 */}
      {!isTeacher && status === 'open' && (
        <div className="px-3 py-2 border-t border-gray-100 flex-shrink-0 bg-white">
          {myWords.length < maxWords ? (
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputWord}
                  onChange={e => { setInputWord(e.target.value); setSubmitError(''); }}
                  onInput={e => setInputWord((e.target as HTMLInputElement).value)}
                  onBlur={e => setInputWord(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入一个关键词..."
                  maxLength={20}
                  disabled={submitting || isLocked}
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-gray-50 bg-white text-gray-800"
                />
                <button
                  onClick={handleSubmit}
                  disabled={!inputWord.trim() || submitting || isLocked}
                  className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-medium hover:bg-amber-800 disabled:opacity-40 transition-colors"
                >
                  提交
                </button>
              </div>
              {submitError && <p className="text-xs text-red-500">{submitError}</p>}
              <p className="text-xs text-gray-400">
                已提交 {myWords.length}/{maxWords} 个词
                {myWords.length > 0 && `：${myWords.join('、')}`}
              </p>
            </div>
          ) : (
            <div className="text-center py-1">
              <p className="text-xs text-green-600 font-medium">✓ 已提交全部 {maxWords} 个词</p>
              <p className="text-xs text-gray-400 mt-0.5">{myWords.join('、')}</p>
            </div>
          )}
        </div>
      )}

      {/* 学生：非 open 状态提示 */}
      {!isTeacher && status !== 'open' && (
        <div className="px-3 py-2 border-t border-gray-100 flex-shrink-0 bg-gray-50">
          <p className="text-xs text-center text-gray-400">
            {status === 'draft'  && '词云尚未开放'}
            {status === 'paused' && '词云已暂停，等待继续'}
            {status === 'closed' && '词云已结束'}
          </p>
        </div>
      )}
    </div>
  );
};

export default WordCloudWidget;
