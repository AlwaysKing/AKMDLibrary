import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileClock, FileText, Loader2, NotebookPen, Plus, Sun } from 'lucide-react';
import Breadcrumb from '../components/Editor/Breadcrumb';
import { PersonalNoteNode } from '../api/personal';
import { usePersonalStore } from '../stores/personalStore';
import { useSpaceStore } from '../stores/spaceStore';

interface FlatPersonalNote {
  note: PersonalNoteNode;
  depth: number;
}

function flattenPersonalNotes(notes: PersonalNoteNode[], depth = 0): FlatPersonalNote[] {
  return notes.flatMap((note) => [
    { note, depth },
    ...flattenPersonalNotes(note.children || [], depth + 1),
  ]);
}

export default function PersonalHomePage() {
  const navigate = useNavigate();
  const { currentSpace } = useSpaceStore();
  const {
    todos,
    notes,
    isLoading,
    error,
    fetchOverview,
    createTodo,
    updateTodo,
    createNote,
  } = usePersonalStore();
  const [noteTitle, setNoteTitle] = useState('');
  const [todoText, setTodoText] = useState('');
  const [addingTodo, setAddingTodo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [showAllTodos, setShowAllTodos] = useState(false);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const flatNotes = flattenPersonalNotes(notes);
  const visibleNotes = showAllNotes ? flatNotes : flatNotes.slice(0, 5);
  const pendingTodos = todos.filter((todo) => !todo.done);
  const visibleTodos = showAllTodos ? todos : pendingTodos.slice(0, 3);

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
      await createTodo(text);
      setTodoText('');
      setAddingTodo(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-notion-bg">
      <Breadcrumb
        pageTitle="个人主页"
        spaceSlug={currentSpace?.slug || ''}
        rootLabel="个人空间"
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

          {error && <div className="mt-4 text-xs text-red-500">{error}</div>}

          <div className="mt-7 grid grid-cols-1 gap-6 min-[760px]:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.65fr)]">
            <section className="min-w-0 border-t border-notion-border pt-4">
              <div className="flex h-7 items-center gap-1.5 text-xs font-semibold text-notion-text">
                <FileClock className="h-4 w-4 text-notion-textSecondary" />
                最近笔记
                <span className="text-[11px] font-medium text-notion-textSecondary">{flatNotes.length}</span>
                {flatNotes.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setShowAllNotes((value) => !value)}
                    className="ml-auto text-[11px] text-notion-textSecondary hover:text-notion-text"
                  >
                    {showAllNotes ? '收起' : '全部笔记'} →
                  </button>
                )}
              </div>

              {isLoading && visibleNotes.length === 0 ? (
                <div className="flex items-center gap-2 py-5 text-xs text-notion-textSecondary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载…
                </div>
              ) : visibleNotes.length > 0 ? (
                visibleNotes.map(({ note, depth }) => (
                  <button
                    type="button"
                    key={note.id}
                    onClick={() => navigate(`/personal/notes/${note.id}`)}
                    className="flex h-[34px] w-full items-center gap-2 rounded-md px-1 text-left transition-colors hover:bg-notion-hover"
                    style={{ paddingLeft: `${depth * 16 + 4}px` }}
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
                ))
              ) : (
                <div className="py-5 text-xs text-notion-textSecondary">还没有私人笔记</div>
              )}
            </section>

            <section className="self-start rounded-lg border border-notion-border bg-[#fafaf9] p-4">
              <div className="flex h-7 items-center gap-1.5 text-xs font-semibold text-notion-text">
                <NotebookPen className="h-4 w-4 text-notion-textSecondary" />
                今日待办
                <span className="text-[11px] font-medium text-notion-textSecondary">
                  {pendingTodos.length} / {todos.length}
                </span>
              </div>

              {visibleTodos.length > 0 ? (
                visibleTodos.map((todo) => (
                  <div key={`${todo.index}:${todo.text}`} className="flex min-h-8 items-center gap-2">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={todo.done}
                      aria-label={todo.done ? `标记未完成：${todo.text}` : `标记完成：${todo.text}`}
                      onClick={() => void updateTodo(todo.index, { done: !todo.done })}
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
                  </div>
                ))
              ) : (
                <div className="py-3 text-xs text-notion-textSecondary">暂无待办</div>
              )}

              {todos.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAllTodos((value) => !value)}
                  className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-[#2383e2]"
                >
                  <ArrowRight className="h-3 w-3" />
                  {showAllTodos ? '收起待办' : '查看全部待办'}
                </button>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
