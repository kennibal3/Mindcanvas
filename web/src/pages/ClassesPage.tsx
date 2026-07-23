// =============================================================
// MindCanvas REQ-045 P2 Slice-3 - 班级管理页
// 教师建一次的班级 + 花名册（稳定学生实体）。开 roster（实名上课）房间时选。
// 布局：左列班级列表（建班/删班），右列选中班级的花名册（粘名导入/单个添加/删除）。
// =============================================================
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Trash2, Users, ArrowLeft, ClipboardPaste, UserPlus, X,
} from 'lucide-react';
import {
  listClasses, createClass, deleteClass,
  listStudents, addStudent, importStudents, deleteStudent,
  type Class, type ClassStudent,
} from '@/utils/classApi';

const ClassesPage = () => {
  const navigate = useNavigate();

  const [classes, setClasses] = useState<Class[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [students, setStudents] = useState<ClassStudent[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);

  const [toast, setToast] = useState('');

  // 建班
  const [showCreate, setShowCreate] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  // 粘名导入
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importLoading, setImportLoading] = useState(false);

  // 单个添加
  const [addName, setAddName] = useState('');
  const [addDisambig, setAddDisambig] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const selectedClass = classes.find(c => c.id === selectedId) || null;

  // ===== 拉班级列表 =====
  const fetchClasses = useCallback(async () => {
    setClassesLoading(true);
    try {
      const list = await listClasses();
      setClasses(list);
      // 默认选中第一个班级
      setSelectedId(prev => {
        if (prev && list.some(c => c.id === prev)) return prev;
        return list.length > 0 ? list[0].id : null;
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载班级失败');
    } finally {
      setClassesLoading(false);
    }
  }, []);

  // ===== 拉花名册 =====
  const fetchStudents = useCallback(async (cid: string) => {
    setStudentsLoading(true);
    try {
      setStudents(await listStudents(cid));
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载花名册失败');
      setStudents([]);
    } finally {
      setStudentsLoading(false);
    }
  }, []);

  useEffect(() => { fetchClasses(); }, [fetchClasses]);

  useEffect(() => {
    if (selectedId) fetchStudents(selectedId);
    else setStudents([]);
  }, [selectedId, fetchStudents]);

  // 刷新当前班级学生数（列表聚合值）后重拉
  const refreshCounts = () => fetchClasses();

  // ===== 建班 =====
  const handleCreateClass = async () => {
    const name = newClassName.trim();
    if (!name) return;
    setCreateLoading(true);
    try {
      const cls = await createClass(name);
      setShowCreate(false);
      setNewClassName('');
      await fetchClasses();
      setSelectedId(cls.id);
      showToast(`班级「${cls.name}」已创建`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreateLoading(false);
    }
  };

  // ===== 删班 =====
  const handleDeleteClass = async (e: React.MouseEvent, cls: Class) => {
    e.stopPropagation();
    if (!confirm(`删除班级「${cls.name}」？花名册${cls.student_count}人将一并删除，关联房间会自动解绑。`)) return;
    try {
      await deleteClass(cls.id);
      if (selectedId === cls.id) setSelectedId(null);
      await fetchClasses();
      showToast('班级已删除');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败');
    }
  };

  // ===== 粘名导入 =====
  const handleImport = async () => {
    if (!selectedId) return;
    const names = importText
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (names.length === 0) {
      showToast('请先粘贴名单（每行一个名字）');
      return;
    }
    setImportLoading(true);
    try {
      const { inserted, skipped } = await importStudents(selectedId, names);
      setShowImport(false);
      setImportText('');
      await fetchStudents(selectedId);
      refreshCounts();
      showToast(`导入完成：新增 ${inserted} 人，跳过 ${skipped} 人（重复）`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImportLoading(false);
    }
  };

  // ===== 单个添加 =====
  const handleAddStudent = async () => {
    if (!selectedId) return;
    const name = addName.trim();
    if (!name) return;
    setAddLoading(true);
    try {
      await addStudent(selectedId, name, addDisambig.trim());
      setAddName('');
      setAddDisambig('');
      await fetchStudents(selectedId);
      refreshCounts();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '添加失败（同名请填写右侧消歧后重试）');
    } finally {
      setAddLoading(false);
    }
  };

  // ===== 删学生 =====
  const handleDeleteStudent = async (st: ClassStudent) => {
    if (!selectedId) return;
    const label = st.disambig ? `${st.student_name}（${st.disambig}）` : st.student_name;
    if (!confirm(`从花名册删除「${label}」？`)) return;
    try {
      await deleteStudent(selectedId, st.id);
      await fetchStudents(selectedId);
      refreshCounts();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-amber-700 text-white text-sm px-5 py-2.5 rounded-xl shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* 顶部导航 */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-gray-400 hover:text-amber-700 flex items-center gap-1 text-sm transition-colors"
          >
            <ArrowLeft size={18} /> 返回
          </button>
          <div className="h-4 w-px bg-gray-200" />
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Users size={18} className="text-amber-700" /> 班级管理
          </h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 md:grid-cols-[300px_1fr] gap-6">

        {/* ===== 左：班级列表 ===== */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-600">我的班级</h2>
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary btn-sm flex items-center gap-1 text-xs"
            >
              <Plus size={14} /> 建班
            </button>
          </div>

          {classesLoading ? (
            <div className="flex justify-center py-10"><div className="spinner" /></div>
          ) : classes.length === 0 ? (
            <div className="text-center py-10 text-gray-400 bg-white rounded-xl border border-dashed border-gray-200">
              <Users size={36} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">还没有班级</p>
              <p className="text-xs mt-1">点「建班」后可粘贴名单</p>
            </div>
          ) : (
            <div className="space-y-2">
              {classes.map(cls => (
                <div
                  key={cls.id}
                  onClick={() => setSelectedId(cls.id)}
                  className={`group flex items-center justify-between rounded-xl border-2 px-4 py-3 cursor-pointer transition-all ${
                    selectedId === cls.id
                      ? 'border-amber-500 bg-amber-50'
                      : 'border-transparent bg-white hover:border-amber-200'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800 truncate">{cls.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{cls.student_count} 名学生</p>
                  </div>
                  <button
                    onClick={e => handleDeleteClass(e, cls)}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    title="删除班级"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ===== 右：花名册 ===== */}
        <section>
          {!selectedClass ? (
            <div className="text-center py-24 text-gray-400 bg-white rounded-2xl border border-gray-100">
              <p>选择或创建一个班级来管理花名册</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{selectedClass.name}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">花名册 {students.length} 人</p>
                </div>
                <button
                  onClick={() => setShowImport(true)}
                  className="btn-secondary btn-sm flex items-center gap-1 text-xs"
                >
                  <ClipboardPaste size={14} /> 粘贴名单导入
                </button>
              </div>

              {/* 单个添加 */}
              <div className="flex items-end gap-2 mb-5 flex-wrap">
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-xs text-gray-500 mb-1">姓名</label>
                  <input
                    type="text"
                    value={addName}
                    onChange={e => setAddName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addName.trim() && handleAddStudent()}
                    className="input"
                    placeholder="学生姓名"
                  />
                </div>
                <div className="w-28">
                  <label className="block text-xs text-gray-500 mb-1">消歧（可选）</label>
                  <input
                    type="text"
                    value={addDisambig}
                    onChange={e => setAddDisambig(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addName.trim() && handleAddStudent()}
                    className="input"
                    placeholder="如 01"
                    maxLength={20}
                  />
                </div>
                <button
                  onClick={handleAddStudent}
                  disabled={addLoading || !addName.trim()}
                  className="btn-primary flex items-center gap-1 disabled:opacity-50"
                >
                  <UserPlus size={15} /> 添加
                </button>
              </div>
              <p className="text-xs text-gray-400 -mt-3 mb-4">
                同名同学请填「消歧」（学号后两位/座位号等）区分，学生实名进入课堂时会用它二选一。
              </p>

              {/* 名单 */}
              {studentsLoading ? (
                <div className="flex justify-center py-10"><div className="spinner" /></div>
              ) : students.length === 0 ? (
                <div className="text-center py-12 text-gray-400 border border-dashed border-gray-200 rounded-xl">
                  <p className="text-sm">花名册为空</p>
                  <p className="text-xs mt-1">用上方「添加」或右上「粘贴名单导入」录入</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {students.map(st => (
                    <div
                      key={st.id}
                      className="group flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2"
                    >
                      <span className="text-sm text-gray-800 truncate">
                        {st.student_name}
                        {st.disambig && (
                          <span className="ml-1 text-xs text-amber-600">#{st.disambig}</span>
                        )}
                      </span>
                      <button
                        onClick={() => handleDeleteStudent(st)}
                        className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                        title="删除"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {/* ===== 建班弹窗 ===== */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-sm shadow-xl">
            <h3 className="text-lg font-semibold mb-4">新建班级</h3>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              班级名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={newClassName}
              onChange={e => setNewClassName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && newClassName.trim() && handleCreateClass()}
              className="input"
              placeholder="例如：初一(3)班"
              autoFocus
              maxLength={100}
            />
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => { setShowCreate(false); setNewClassName(''); }} className="btn-secondary">
                取消
              </button>
              <button
                onClick={handleCreateClass}
                className="btn-primary"
                disabled={createLoading || !newClassName.trim()}
              >
                {createLoading ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 粘名导入弹窗 ===== */}
      {showImport && selectedClass && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-1">导入名单到「{selectedClass.name}」</h3>
            <p className="text-xs text-gray-400 mb-3">
              每行一个名字。重名需消歧时，同一行写「名字|消歧」（也支持中英文逗号、Tab 分隔）。重复的名字会自动跳过。
            </p>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              className="input h-48 font-mono text-sm leading-6"
              placeholder={'张三\n李四\n王五|01\n王五|02'}
              autoFocus
            />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => { setShowImport(false); setImportText(''); }} className="btn-secondary">
                取消
              </button>
              <button
                onClick={handleImport}
                className="btn-primary"
                disabled={importLoading || !importText.trim()}
              >
                {importLoading ? '导入中...' : '导入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassesPage;
