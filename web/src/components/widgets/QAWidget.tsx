// =============================================================
// MindCanvas v4.3 - 问答 Widget（教师+学生视图）
// REQ-020修复：固定白色背景，移除所有 dark: 前缀 class
// V4.3-STABLE：onUpdate 传 inner+changes，不产生三层嵌套
// =============================================================
import React, { useState, useMemo } from 'react'
import {
  Play, StopCircle, Eye, EyeOff,
  BookOpen, BookOpenCheck, Trash2,
  CheckCircle2, XCircle, Users,
} from 'lucide-react'
import { useRoomStore } from '@/store/roomStore'
import { useWidgetStore } from '@/store/widgetStore'

interface QAWidgetProps {
  id: string
  payload: Record<string, any>
  isTeacher: boolean
  isLocked?: boolean
  onUpdate: (payload: Record<string, any>) => void
  onSubmit?: (action: string, data: Record<string, any>) => void
}

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

// REQ-020：状态配置无 dark: 前缀
const STATUS_LABELS: Record<string, string> = {
  draft:  '未开始',
  open:   '答题中',
  closed: '已结束',
}

const STATUS_COLORS: Record<string, string> = {
  draft:  'bg-gray-100 text-gray-500',
  open:   'bg-green-100 text-green-700',
  closed: 'bg-red-100 text-red-600',
}

// 从 payload 提取内层业务字段，兼容嵌套/平铺两种格式
function extractInner(payload: Record<string, any>): Record<string, any> {
  const inner = payload?.payload
  if (
    inner !== null &&
    inner !== undefined &&
    typeof inner === 'object' &&
    !Array.isArray(inner)
  ) {
    return inner as Record<string, any>
  }
  return payload
}

const QAWidget: React.FC<QAWidgetProps> = ({
  id, payload, isTeacher, isLocked, onUpdate, onSubmit,
}) => {
  const { isSubmitted, markSubmitted } = useWidgetStore()
  const [selected, setSelected]       = useState<number | null>(null)
  const [submitting, setSubmitting]   = useState(false)

  // 提取内层业务字段（兼容嵌套/平铺）
  const inner = extractInner(payload)

  const question:        string                 = (inner?.question        as string)                 ?? ''
  const options:         string[]               = Array.isArray(inner?.options) ? (inner.options as string[]) : []
  const correctIdx:      number                 = (inner?.correctIdx      as number)                 ?? 0
  const explanation:     string                 = (inner?.explanation     as string)                 ?? ''
  const showResult:      boolean                = !!(inner?.showResult)
  const showExplanation: boolean                = !!(inner?.showExplanation)
  const stats:           Record<string, number> = (inner?.stats as Record<string, number>) ?? {}

  // 状态：优先 status 字段，兼容旧 is_open
  const rawStatus = (inner?.status as string) || ''
  const isOpen    = !!(inner?.is_open as boolean)
  const status    = rawStatus || (isOpen ? 'open' : 'draft')

  const hasSubmitted = isSubmitted(id)

  const totalAnswers = useMemo(
    () => Object.values(stats).reduce((sum: number, v) => sum + (Number(v) || 0), 0),
    [stats],
  )

  const getCount   = (idx: number) => Number(stats[String(idx)] ?? 0)
  const getPercent = (idx: number) =>
    totalAnswers === 0 ? 0 : Math.round((getCount(idx) / totalAnswers) * 100)

  // V4.3-STABLE：传 inner + 变更字段，FloatingWidgets merge 到外层，保持两层结构
  const updateInner = (changes: Record<string, any>) => {
    onUpdate({ ...inner, ...changes })
  }

  const handleStart             = () => updateInner({ status: 'open',   is_open: true  })
  const handleClose             = () => updateInner({ status: 'closed', is_open: false })
  const handleToggleResult      = () => updateInner({ showResult: !showResult })
  const handleToggleExplanation = () => updateInner({ showExplanation: !showExplanation })
  const handleDelete            = () => onUpdate({ __delete: true })

  const handleSubmit = async () => {
    if (selected === null || hasSubmitted || submitting) return
    setSubmitting(true)
    try {
      onSubmit?.('answer', { choice_idx: selected })
      markSubmitted(id)
    } finally {
      setSubmitting(false)
    }
  }

  // 统计图（教师视图）—— REQ-020：移除所有 dark: class
  const renderStats = () => (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
        <span className="flex items-center gap-1">
          <Users size={12} />{totalAnswers} 人已答题
        </span>
        <span>
          正确率 {totalAnswers > 0
            ? Math.round((getCount(correctIdx) / totalAnswers) * 100)
            : 0}%
        </span>
      </div>
      {options.map((opt: string, idx: number) => {
        const isCorrect = idx === correctIdx
        return (
          <div key={idx} className="flex items-center gap-2">
            <span className={[
              'flex-shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center',
              isCorrect ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600',
            ].join(' ')}>
              {OPTION_LABELS[idx]}
            </span>
            <span
              className="flex-shrink-0 text-xs text-gray-700 w-20 truncate"
              title={opt}
            >
              {opt}
            </span>
            <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
              <div
                className={[
                  'h-full rounded-full transition-all duration-500',
                  isCorrect ? 'bg-green-400' : 'bg-amber-400',
                ].join(' ')}
                style={{ width: getPercent(idx) + '%' }}
              />
            </div>
            <span className="flex-shrink-0 text-xs text-gray-500 w-16 text-right">
              {getCount(idx)}人 ({getPercent(idx)}%)
            </span>
          </div>
        )
      })}
    </div>
  )

  // 学生选项视图 —— REQ-020：移除所有 dark: class
  const renderStudentOptions = () => {
    const showFeedback = hasSubmitted && showResult
    return (
      <div className="mt-3 space-y-2">
        {options.map((opt: string, idx: number) => {
          const isCorrect  = idx === correctIdx
          const isMyChoice = hasSubmitted && selected === idx
          const isSelected = selected === idx
          const canClick   = status === 'open' && !hasSubmitted

          let optClass =
            'flex items-center gap-3 p-2.5 rounded-lg border-2 transition-all duration-200 text-sm '
          if (showFeedback) {
            if (isCorrect)       optClass += 'border-green-500 bg-green-50'
            else if (isMyChoice) optClass += 'border-red-400 bg-red-50'
            else                 optClass += 'border-gray-200 bg-white'
          } else if (hasSubmitted) {
            if (isMyChoice)      optClass += 'border-amber-400 bg-amber-50'
            else                 optClass += 'border-gray-200 bg-white'
          } else if (status === 'open') {
            if (isSelected)      optClass += 'border-amber-500 bg-amber-50 cursor-pointer'
            else                 optClass += 'border-gray-200 bg-white hover:border-amber-300 cursor-pointer'
          } else {
            optClass += 'border-gray-200 bg-gray-50 opacity-60'
          }

          return (
            <div
              key={idx}
              className={optClass}
              onClick={() => canClick && setSelected(idx)}
            >
              <span className={[
                'flex-shrink-0 w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center',
                showFeedback && isCorrect                     ? 'bg-green-500 text-white'
                  : showFeedback && isMyChoice && !isCorrect  ? 'bg-red-400 text-white'
                  : isSelected && !hasSubmitted                ? 'bg-amber-700 text-white'
                  : 'bg-gray-200 text-gray-600',
              ].join(' ')}>
                {OPTION_LABELS[idx]}
              </span>
              <span className="flex-1 text-gray-800">{opt}</span>
              {showFeedback && isCorrect                    && (
                <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
              )}
              {showFeedback && isMyChoice && !isCorrect    && (
                <XCircle size={16} className="text-red-400 flex-shrink-0" />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // 解析说明 —— REQ-020：移除所有 dark: class
  const renderExplanation = () => {
    if (!explanation) return null
    if (!isTeacher && !showExplanation) return null
    return (
      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <div className="flex items-center gap-1.5 text-amber-700 text-xs font-medium mb-1">
          <BookOpen size={13} />解析说明
        </div>
        <p className="text-sm text-amber-800 leading-relaxed">{explanation}</p>
      </div>
    )
  }

  return (
    // REQ-020修复：固定白色背景+固定文字颜色，不随暗色主题变化
    <div
      className="bg-white rounded-xl shadow-lg border border-gray-200 p-4 w-72 select-none"
      style={{ color: '#1f2937' }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
            问答
          </span>
          <span className={[
            'text-xs px-2 py-0.5 rounded-full font-medium',
            STATUS_COLORS[status] ?? STATUS_COLORS.draft,
          ].join(' ')}>
            {STATUS_LABELS[status] ?? '未知'}
          </span>
        </div>
        {isTeacher && (
          <button
            onClick={handleDelete}
            className="text-gray-300 hover:text-red-400 transition-colors"
            title="删除问答题"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <p className="text-sm font-medium text-gray-900 leading-snug">{question}</p>

      {isTeacher  && renderStats()}
      {!isTeacher && renderStudentOptions()}
      {renderExplanation()}

      {/* 学生提交按钮 */}
      {!isTeacher && status === 'open' && !hasSubmitted && (
        <button
          onClick={handleSubmit}
          disabled={selected === null || submitting}
          className="mt-3 w-full py-2 text-sm font-medium text-white bg-purple-500 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          {submitting ? '提交中...' : '提交答案'}
        </button>
      )}

      {!isTeacher && hasSubmitted && !showResult && (
        <div className="mt-3 text-center text-sm text-gray-500">
          已提交，等待教师公布结果
        </div>
      )}

      {!isTeacher && hasSubmitted && showResult && (
        <div className={[
          'mt-3 text-center text-sm font-medium',
          selected === correctIdx ? 'text-green-600' : 'text-red-500',
        ].join(' ')}>
          {selected === correctIdx ? '回答正确！' : '回答错误'}
        </div>
      )}

      {/* 教师主操作按钮（直接显示在底部，1次点击）—— REQ-020：无 dark: class */}
      {isTeacher && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="flex flex-wrap gap-2">
            {status === 'draft' && (
              <button
                onClick={handleStart}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-green-500 hover:bg-green-600 rounded-lg transition-colors"
              >
                <Play size={12} />开始答题
              </button>
            )}
            {status === 'open' && (
              <button
                onClick={handleClose}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                <StopCircle size={12} />结束答题
              </button>
            )}
            {status === 'closed' && (
              <button
                onClick={handleToggleResult}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  showResult
                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                    : 'bg-amber-700 text-white hover:bg-amber-800',
                ].join(' ')}
              >
                {showResult ? <EyeOff size={12} /> : <Eye size={12} />}
                {showResult ? '收起结果' : '公布结果'}
              </button>
            )}
            {status === 'closed' && explanation && (
              <button
                onClick={handleToggleExplanation}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  showExplanation
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-amber-500 text-white hover:bg-amber-600',
                ].join(' ')}
              >
                {showExplanation ? <BookOpen size={12} /> : <BookOpenCheck size={12} />}
                {showExplanation ? '收起解析' : '公布解析'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default QAWidget
