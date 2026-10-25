import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Bell, FileClock, FileText, Files, Link2, ListChecks, Loader2, NotebookPen, Plus, Sun, Trash2 } from 'lucide-react';
import Breadcrumb from '../components/Editor/Breadcrumb';
import { PersonalTodoLink } from '../api/personal';
import { usePersonalStore } from '../stores/personalStore';
import { useSpaceStore } from '../stores/spaceStore';
import { personalTodoLinkPath } from '../utils/personalTodoLinks';
import { personalTrail } from '../utils/personalPages';

// lucide 当前版本没有扫帚图标，按 lucide 的描边风格内联一个
function BroomIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m16 22-1-4" />
      <path d="M19 13.99a1 1 0 0 0 1-1V12a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v.99a1 1 0 0 0 1 1" />
      <path d="M5 14h14l1.973 6.767A1 1 0 0 1 20 22H4a1 1 0 0 1-.973-1.233z" />
      <path d="m8 22 1-4" />
    </svg>
  );
}

export default function PersonalHomePage() {
  const navigate = useNavigate();
  const { currentSpace } = useSpaceStore();
  const {
    todos,
    recent,
    isLoading,
    fetchOverview,
    createTodo,
    updateTodo,
    deleteTodo,
    createNote,
    deleteNote,
    clearRecentNote,
  } = usePersonalStore();
  const [noteTitle, setNoteTitle] = useState('');
  const [todoText, setTodoText] = useState('');
  const [addingTodo, setAddingTodo] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const scheduledTodos = todos.filter((todo) => todo.is_today || todo.overdue);
  const recentPreview = recent.slice(0, 5);

  const handleCreateNote = async (title = '未命名笔记') => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const note = await createNote(title.trim() || '未命名笔记');
      navigate(`/personal/notes/${note.id}`);
    } catch {
      // The store exposes the request error.
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateTodo = async () => {
    const text = todoText.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await createTodo(text, { today: true });
      setTodoText('');
      setAddingTodo(false);
    } finally {
      setSubmitting(false);
    }
  };

  const openTodoLink = (link: PersonalTodoLink) => {
    const path = personalTodoLinkPath(link);
    if (path) navigate(path);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-notion-bg">
      <Breadcrumb
        spaceSlug={currentSpace?.slug || ''}
        rootLabel="个人空间"
        trail={personalTrail(navigate, 'home')}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[900px] px-10 pb-24 pt-12">
          <div className="flex items-center gap-2 text-xs font-medium text-notion-textSecondary">
            <Sun className="h-3.5 w-3.5 text-notion-textSecondary" />
            个人空间
          </div>
          <h1 className="mt-2 text-[34px] font-bold leading-tight tracking-[-0.035em] text-notion-text">
            从今天开始记录。
          </h1>
          <p className="mt-1.5 text-sm text-notion-textSecondary">
            快速写一篇私人笔记，或者看看还有什么事情没有完成。
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleCreateNote()}
              className="flex h-[38px] items-center gap-2 rounded-md border border-[#d6e7f8] bg-[#eaf3fc] px-3 text-xs font-semibold text-notion-text transition-colors hover:bg-[#dfeefa] disabled:opacity-50"
            >
              <NotebookPen className="h-4 w-4 text-[#2383e2]" />
              新建笔记
            </button>
            <button
              type="button"
              onClick={() => setAddingTodo(true)}
              className="flex h-[38px] items-center gap-2 rounded-md border border-notion-border bg-white px-3 text-xs font-semibold text-notion-text transition-colors hover:bg-notion-hover"
            >
              <Plus className="h-4 w-4 text-[#2383e2]" />
              添加待办
            </button>
            <button
              type="button"
              onClick={() => navigate('/personal/docs')}
              className="flex h-[38px] items-center gap-2 rounded-md border border-notion-border bg-white px-3 text-xs font-semibold text-notion-text transition-colors hover:bg-notion-hover"
            >
              <Files className="h-4 w-4 text-notion-textSecondary" strokeWidth={1.7} />
              全部文档
            </button>
            <button
              type="button"
              onClick={() => navigate('/personal/todos')}
              className="flex h-[38px] items-center gap-2 rounded-md border border-notion-border bg-white px-3 text-xs font-semibold text-notion-text transition-colors hover:bg-notion-hover"
            >
              <ListChecks className="h-4 w-4 text-notion-textSecondary" strokeWidth={1.7} />
              全部待办
            </button>
          </div>

          <div className="mt-5 flex h-[43px] items-center gap-2 rounded-lg border border-notion-border px-3 shadow-sm">
            <Plus className="h-4 w-4 flex-shrink-0 text-[#2383e2]" />
            <input
              value={noteTitle}
              onChange={(event) => setNoteTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void handleCreateNote(noteTitle);
                }
              }}
              placeholder="写下一个想法，回车创建笔记…"
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-notion-text outline-none placeholder:text-notion-textSecondary"
            />
          </div>

          {addingTodo && (
            <div className="mt-3 flex h-[39px] items-center gap-2 rounded-lg border border-notion-border bg-white px-3">
              <Plus className="h-4 w-4 text-[#2383e2]" />
              <input
                autoFocus
                value={todoText}
                onChange={(event) => setTodoText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void handleCreateTodo();
                  } else if (event.key === 'Escape') {
                    setAddingTodo(false);
                    setTodoText('');
                  }
                }}
                placeholder="添加一条待办，回车保存"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-notion-text outline-none placeholder:text-notion-textSecondary"
              />
            </div>
          )}

          <div className="mt-7 grid grid-cols-1 gap-6 min-[760px]:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.65fr)]">
            <section className="min-w-0 border-t border-notion-border pt-4">
              <div className="flex h-7 items-center gap-1.5 text-xs font-semibold text-notion-text">
                <FileClock className="h-4 w-4 text-notion-textSecondary" />
                最近笔记
                <span className="text-[11px] font-medium text-notion-textSecondary">{recentPreview.length}</span>
                <button
                  type="button"
                  onClick={() => navigate('/personal/docs')}
                  className="ml-auto text-[11px] text-notion-textSecondary hover:text-notion-text"
                >
                  全部文档 →
                </button>
              </div>

              {isLoading && recentPreview.length === 0 ? (
                <div className="flex items-center gap-2 py-5 text-xs text-notion-textSecondary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载…
                </div>
              ) : recentPreview.length > 0 ? (
                recentPreview.map((note) => (
                  <div
                    key={note.id}
                    className="group flex h-[34px] w-full items-center gap-2 rounded-md px-1 transition-colors hover:bg-notion-hover"
                  >
                    <button
                      type="button"
                      onClick={() => navigate(`/personal/notes/${note.id}`)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {note.icon ? (
                        note.icon.startsWith('/') || note.icon.startsWith('http') ? (
                          <img src={note.icon} alt="" className="h-4 w-4 flex-shrink-0 object-contain" />
                        ) : (
                          <span className="w-4 flex-shrink-0 text-center text-sm leading-none">{note.icon}</span>
                        )
                      ) : (
                        <FileText className="h-4 w-4 flex-shrink-0 text-notion-textSecondary" strokeWidth={1.7} />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm text-notion-text">{note.title || '未命名笔记'}</span>
                    </button>
                    <div className="flex flex-shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => void clearRecentNote(note.id)}
                        className="flex h-5 w-5 items-center justify-center rounded text-notion-textSecondary opacity-0 transition-opacity hover:bg-notion-border group-hover:opacity-100"
                        aria-label={`从最近访问移除：${note.title || '未命名笔记'}`}
                        title="从最近访问移除"
                      >
                        <BroomIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteNote(note.id)}
                        className="flex h-5 w-5 items-center justify-center rounded text-notion-textSecondary opacity-0 transition-opacity hover:bg-notion-border group-hover:opacity-100"
                        aria-label={`删除笔记：${note.title || '未命名笔记'}`}
                        title="删除笔记"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-5 text-xs text-notion-textSecondary">还没有访问过笔记</div>
              )}
            </section>

            <section className="self-start rounded-lg border border-notion-border bg-[#fafaf9] p-4">
              <div className="flex h-7 items-center gap-1.5 text-xs font-semibold text-notion-text">
                <NotebookPen className="h-4 w-4 text-notion-textSecondary" />
                今日待办
                <span className="text-[11px] font-medium text-notion-textSecondary">
                  {scheduledTodos.filter((todo) => !todo.done).length} / {scheduledTodos.length}
                </span>
                <button
                  type="button"
                  onClick={() => navigate('/personal/todos')}
                  className="ml-auto text-[11px] text-notion-textSecondary hover:text-notion-text"
                >
                  全部待办 →
                </button>
              </div>

              {scheduledTodos.length > 0 ? (
                scheduledTodos.map((todo) => (
                  <div key={todo.id} className="group flex min-h-8 items-center gap-2 rounded-md px-1 hover:bg-notion-hover">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={todo.done}
                      aria-label={todo.done ? `标记未完成：${todo.text}` : `标记完成：${todo.text}`}
                      onClick={() => void updateTodo(todo.id, { done: !todo.done })}
                      className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
                        todo.done
                          ? 'border-[#2383e2] bg-[#2383e2] text-white'
                          : 'border-[#b9b8b4] bg-white'
                      }`}
                    >
                      {todo.done && <span className="text-[9px] leading-none">✓</span>}
                    </button>
                    <span className={`min-w-0 flex-1 truncate text-xs ${todo.done ? 'text-notion-textSecondary line-through' : 'text-notion-textSecondary'}`}>
                      {todo.text}
                    </span>
                    {todo.overdue && (
                      <span className="flex flex-shrink-0 items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold text-red-600">
                        <AlertCircle className="h-2.5 w-2.5" />
                        已逾期
                      </span>
                    )}
                    <div className="ml-0.5 flex flex-shrink-0 items-center gap-0.5">
                      {todo.link && (
                        <button
                          type="button"
                          onClick={() => openTodoLink(todo.link!)}
                          className="flex h-5 w-5 items-center justify-center rounded text-notion-textSecondary hover:bg-notion-hover"
                          aria-label={`打开待办来源：${todo.text}`}
                        >
                          <Link2 className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void updateTodo(todo.id, { today: !todo.is_today })}
                        className={`h-5 w-5 items-center justify-center rounded transition-all hover:bg-notion-hover ${
                          todo.is_today
                            ? 'flex text-[#2383e2]'
                            : 'hidden text-notion-textSecondary group-hover:flex'
                        }`}
                        aria-label={todo.is_today ? `取消今日待办：${todo.text}` : `设为今日待办：${todo.text}`}
                        title={todo.is_today ? '取消今日待办' : '设为今日待办'}
                      >
                        <Bell className="h-3 w-3" fill={todo.is_today ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteTodo(todo.id)}
                        className="hidden h-5 w-5 items-center justify-center rounded text-notion-textSecondary hover:bg-notion-hover group-hover:flex"
                        aria-label={`删除待办：${todo.text}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-3 text-xs text-notion-textSecondary">今天没有待办</div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
