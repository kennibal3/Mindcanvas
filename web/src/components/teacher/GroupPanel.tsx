import React, { useState, useEffect, useCallback } from 'react'
import { Users, Shuffle, Plus, Trash2, ChevronDown, ChevronRight, Crown, X, Loader2 } from 'lucide-react'
import { useRoomStore } from '@/store/roomStore'
import type { Group } from '@/types/group'
import { listGroups, createGroup, updateGroup, deleteGroup, autoGroup } from '@/utils/groupApi'

interface GroupPanelProps {
  roomId: string
}

const GROUP_COLORS = [
  '#E74C3C', '#3498DB', '#2ECC71', '#F39C12',
  '#9B59B6', '#1ABC9C', '#E67E22', '#34495E',
]

export const GroupPanel: React.FC<GroupPanelProps> = ({ roomId }) => {
  const { members } = useRoomStore()
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAutoModal, setShowAutoModal] = useState(false)
  const [autoMode, setAutoMode] = useState<'by_groups' | 'by_count'>('by_groups')
  const [autoN, setAutoN] = useState(4)
  const [autoLoading, setAutoLoading] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(GROUP_COLORS[0])

  const getMemberName = useCallback((uuid: string): string => {
    const m = members.find((m: any) =>
      m.uuid === uuid || m.studentUuid === uuid || m.student_uuid === uuid || m.id === uuid
    )
    return (m as any)?.nickname ?? (m as any)?.name ?? `${uuid.slice(0, 6)}...`
  }, [members])

  const loadGroups = useCallback(async () => {
    setLoading(true)
    try {
      setGroups((await listGroups(roomId)) ?? [])
    } catch (e) {
      console.error('[GroupPanel]', e)
    } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => { loadGroups() }, [loadGroups])

  useEffect(() => {
    const handler = () => loadGroups()
    window.addEventListener('ws_group_update', handler)
    return () => window.removeEventListener('ws_group_update', handler)
  }, [loadGroups])

  // BUG-002 修复: 超时保护,避免请求异常挂起时按钮永远转圈、教师以为程序死掉
  const handleAutoGroup = async () => {
    setAutoLoading(true)
    const timeoutId = window.setTimeout(() => {
      setAutoLoading(false)
      alert('分组请求超时，请检查网络后重试')
    }, 8000)
    try {
      const result = await autoGroup(roomId, autoMode, autoN)
      window.clearTimeout(timeoutId)
      setGroups((result.groups ?? []).map(g => ({
        ...g, room_id: roomId, leader_uuid: '', created_at: '', updated_at: '',
      })))
      setShowAutoModal(false)
    } catch (e: any) {
      window.clearTimeout(timeoutId)
      alert(e.message || '自动分组失败')
    } finally {
      window.clearTimeout(timeoutId)
      setAutoLoading(false)
    }
  }

  const handleCreateGroup = async () => {
    if (!newName.trim()) return
    try {
      await createGroup(roomId, newName.trim(), newColor)
      setNewName(''); setNewColor(GROUP_COLORS[0]); setShowNewForm(false)
      loadGroups()
    } catch (e: any) { alert(e.message || '创建失败') }
  }

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm('确定删除该小组？')) return
    try {
      await deleteGroup(roomId, groupId)
      setGroups(prev => prev.filter(g => g.id !== groupId))
    } catch (e: any) { alert(e.message || '删除失败') }
  }

  const handleSetLeader = async (groupId: string, uuid: string) => {
    try {
      await updateGroup(roomId, groupId, { leader_uuid: uuid })
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, leader_uuid: uuid } : g))
    } catch {}
  }

  const totalStudents = groups.reduce((sum, g) => sum + g.members.length, 0)

  return (
    <div className="space-y-3 px-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Users size={13} />
          <span>{groups.length} 组 · {totalStudents} 人</span>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => setShowAutoModal(true)}
            className="flex items-center gap-1 px-2.5 py-1 bg-amber-700 hover:bg-amber-800 text-white text-xs rounded-xl transition-colors">
            <Shuffle size={11} /> 自动分组
          </button>
          <button onClick={() => setShowNewForm(!showNewForm)}
            className="flex items-center gap-1 px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs rounded-xl transition-colors">
            <Plus size={11} /> 新建
          </button>
        </div>
      </div>

      {showNewForm && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
          <input type="text" placeholder="小组名称" value={newName}
            onChange={e => setNewName(e.target.value)}
            onInput={e => setNewName((e.target as HTMLInputElement).value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateGroup()}
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
            autoFocus />
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-500">颜色：</span>
            {GROUP_COLORS.map(c => (
              <button key={c} onClick={() => setNewColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-all ${newColor === c ? 'border-gray-700 scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreateGroup} disabled={!newName.trim()}
              className="px-3 py-1 bg-amber-700 text-white text-xs rounded-lg disabled:opacity-40">创建</button>
            <button onClick={() => setShowNewForm(false)}
              className="px-3 py-1 bg-gray-200 text-gray-600 text-xs rounded-lg">取消</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-xs text-gray-400 py-6">加载中...</div>
      ) : groups.length === 0 ? (
        <div className="text-center text-gray-400 py-8 space-y-1.5">
          <Users size={28} className="mx-auto opacity-25" />
          <p className="text-sm">还没有分组</p>
          <p className="text-xs">点击「自动分组」快速完成</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map(group => (
            <div key={group.id} className="border border-gray-200 rounded-xl overflow-hidden bg-white">
              <div className="flex items-center gap-2 px-3 py-2">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
                <span className="text-sm font-medium text-gray-800 flex-1 truncate">{group.name}</span>
                <span className="text-xs text-gray-400">{(group.members ?? []).length}人</span>
                <button onClick={() => setExpandedId(expandedId === group.id ? null : group.id)}
                  className="p-0.5 text-gray-400 hover:text-gray-600">
                  {expandedId === group.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <button onClick={() => handleDeleteGroup(group.id)}
                  className="p-0.5 text-gray-300 hover:text-red-400 transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
              {expandedId === group.id && (
                <div className="border-t border-gray-100 px-3 pt-2 pb-3 space-y-1">
                  {(group.members ?? []).length === 0 ? (
                    <p className="text-xs text-gray-400">暂无成员</p>
                  ) : (group.members ?? []).map(uuid => {
                    const isLeader = group.leader_uuid === uuid
                    return (
                      <div key={uuid} className="flex items-center gap-1.5 text-xs text-gray-700">
                        {isLeader
                          ? <Crown size={11} className="text-amber-500 flex-shrink-0" />
                          : <span className="w-[11px] flex-shrink-0" />}
                        <span className="flex-1 truncate">{getMemberName(uuid)}</span>
                        {isLeader ? (
                          <button onClick={() => handleSetLeader(group.id, '')} title="取消组长"
                            className="text-amber-400 hover:text-gray-300 transition-colors"><X size={11} /></button>
                        ) : (
                          <button onClick={() => handleSetLeader(group.id, uuid)} title="设为组长"
                            className="text-gray-300 hover:text-amber-500 transition-colors"><Crown size={11} /></button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAutoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !autoLoading && setShowAutoModal(false)}>
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-72" onClick={e => e.stopPropagation()}>
            {autoLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/85 rounded-2xl">
                <Loader2 size={28} className="text-amber-600 animate-spin" />
                <span className="text-xs text-gray-500">正在分组，请稍候…</span>
              </div>
            )}
            <h3 className="text-base font-semibold text-gray-800 mb-4">自动分组</h3>
            <div className="mb-4">
              <p className="text-xs font-medium text-gray-500 mb-2">分组方式</p>
              <div className="flex gap-2">
                {(['by_groups', 'by_count'] as const).map(m => (
                  <button key={m} onClick={() => setAutoMode(m)}
                    className={`flex-1 py-2 text-xs rounded-xl border transition-all ${
                      autoMode === m ? 'border-amber-500 bg-amber-50 text-amber-700 font-semibold' : 'border-gray-200 text-gray-600'
                    }`}>
                    {m === 'by_groups' ? '按组数' : '按人数'}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-5">
              <p className="text-xs font-medium text-gray-500 mb-2">{autoMode === 'by_groups' ? '组数' : '每组人数'}</p>
              <div className="flex items-center gap-3">
                <button onClick={() => setAutoN(n => Math.max(1, n - 1))}
                  className="w-9 h-9 rounded-xl bg-gray-100 text-gray-600 text-xl font-bold hover:bg-gray-200 flex items-center justify-center">−</button>
                <span className="flex-1 text-center text-2xl font-bold text-gray-800">{autoN}</span>
                <button onClick={() => setAutoN(n => Math.min(20, n + 1))}
                  className="w-9 h-9 rounded-xl bg-gray-100 text-gray-600 text-xl font-bold hover:bg-gray-200 flex items-center justify-center">+</button>
              </div>
              <p className="text-xs text-gray-400 text-center mt-1.5">
                {autoMode === 'by_groups' ? `将学生随机分成 ${autoN} 组` : `每组约 ${autoN} 人`}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAutoModal(false)} disabled={autoLoading}
                className="flex-1 py-2 text-sm text-gray-600 bg-gray-100 rounded-xl disabled:opacity-40">取消</button>
              <button onClick={handleAutoGroup} disabled={autoLoading}
                className="flex-1 py-2 text-sm text-white bg-amber-700 hover:bg-amber-800 rounded-xl disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5">
                {autoLoading ? <><Loader2 size={13} className="animate-spin" /> 分组中…</> : '开始分组'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GroupPanel
