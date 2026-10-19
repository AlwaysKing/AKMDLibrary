import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckSquare, ChevronDown, Files, Link2, Loader2, NotebookPen, Plus, Trash2 } from 'lucide-react';
import { PersonalTodoLink } from '../../api/personal';
import { usePersonalStore } from '../../stores/personalStore';
import { personalTodoLinkPath } from '../../utils/personalTodoLinks';
import { countPersonalNotes } from '../../utils/personalNotes';
import PersonalNoteTree from './PersonalNoteTree';

const EXPANDED_STORAGE_KEY = 'personal-space-card-expanded';

function readExpandedState() {
  return localStorage.getItem(EXPANDED_STORAGE_KEY) === '1';
}

export default function PersonalSpaceCard() {
  const navigate = useNavigate();
  const {
    todos,
    notes,
    isLoading,
    fetchOverview,
    createTodo,
    updateTodo,
    deleteTodo,
    createNote,
    deleteNote,
    moveNote,
  } = usePersonalStore();
  const [expanded, setExpanded] = useState(readExpandedState);
  const [addingTodo, setAddingTodo] = useState(false);
  const [todoText, setTodoText] = useState('');
  const [submittingTodo, setSubmittingTodo] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void fetchOverview();
    const refresh = () => void fetchOverview();
    window.addEventListener('focus', refresh);
    document.addEventListener('subpage-created', refresh);
    document.addEventListener('subpage-deleted', refresh);
    document.addEventListener('subpage-reordered', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('subpage-created', refresh);
      document.removeEventListener('subpage-deleted', refresh);
      document.removeEventListener('subpage-reordered', refresh);
    };
  }, [fetchOverview]);

  const pendingTodos = todos.filter((todo) => !todo.done);
  const pendingCount = pendingTodos.length;
  const noteCount = countPersonalNotes(notes);

  const toggleExpanded = () => {
    setExpanded((value) => {
      localStorage.setItem(EXPANDED_STORAGE_KEY, value ? '0' : '1');
      return !value;
    });
  };

  const toggleNote = (id: string) => {
    setExpandedNoteIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openTodoLink = (link: PersonalTodoLink) => {
    const path = personalTodoLinkPath(link);
    if (path) navigate(path);
  };

  const handleCreateTodo = async () => {
    const text = todoText.trim();
    if (!text || submittingTodo) return;
    setSubmittingTodo(true);
    try {
      await createTodo(text);
      setTodoText('');
      setAddingTodo(false);
    } finally {
      setSubmittingTodo(false);
    }
  };

  const handleCreateNote = async (parentId?: string) => {
    if (creatingNote) return;
    setCreatingNote(true);
    try {
      const note = await createNote(parentId ? '未命名子页面' : '未命名笔记', parentId);
      if (parentId) {
        setExpandedNoteIds((current) => new Set(current).add(parentId));
      }
      navigate(`/personal/notes/${note.id}`);
    } catch {
      // Store surfaces the request error inside the card.
    } finally {
      setCreatingNote(false);
    }
  };

  return (
    <section
      className="mx-1 mb-2 overflow-hidden rounded-lg border border-[#dbe8f5] bg-[#eaf3fc]"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-1 px-2.5 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-[#d8eafb] text-[#2383e2]">
            <NotebookPen className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => navigate('/personal')}
              className="flex items-center gap-1.5 text-[13px] font-medium text-notion-text"
            >
              个人空间
            </button>
            {isLoading ? (
              <span className="mt-0.5 block text-[11px] text-notion-textSecondary">正在加载…</span>
            ) : (
              <span className="mt-0.5 flex items-center gap-1 text-[11px] text-notion-textSecondary">
                <button
                  type="button"
                  onClick={() => navigate('/personal/todos')}
                  className="flex items-center gap-0.5 rounded transition-colors hover:text-notion-text"
                  aria-label="查看全部待办"
                  title="全部待办"
                >
                  <CheckSquare className="h-3 w-3" strokeWidth={1.8} />
                  {pendingCount} 项待办
                </button>
                <span className="text-notion-textSecondary/60">·</span>
                <button
                  type="button"
                  onClick={() => navigate('/personal/docs')}
                  className="flex items-center gap-0.5 rounded transition-colors hover:text-notion-text"
                  aria-label="查看全部个人文档"
                  title="全部个人文档"
                >
                  <Files className="h-3 w-3" strokeWidth={1.8} />
                  {noteCount} 篇笔记
                </button>
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={toggleExpanded}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-notion-textSecondary"
          aria-expanded={expanded}
          aria-label={expanded ? '收起个人空间' : '展开个人空间'}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          )}
        </button>
      </div>

      {expanded && <div className="px-2 pb-2">
        <div className="rounded-md bg-white/55 px-1 py-1">
          {todos.length > 0 ? (
            todos.map((todo) => (
              <div key={todo.id} className="group flex min-h-[28px] items-center gap-2 overflow-hidden rounded-md px-1 hover:bg-white/70">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={todo.done}
                  aria-label={todo.done ? `标记未完成：${todo.text}` : `标记完成：${todo.text}`}
                  onClick={() => void updateTodo(todo.id, { done: !todo.done })}
                  className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
                    todo.done
                      ? 'border-[#2383e2] bg-[#2383e2] text-white'
                      : 'border-[#b9b8b4] bg-white hover:border-[#8e8b86]'
                  }`}
                >
                  {todo.done && <span className="text-[10px] leading-none">✓</span>}
                </button>
                <span className={`min-w-0 flex-1 truncate text-xs ${todo.done ? 'text-notion-textSecondary line-through' : 'text-notion-text'}`}>
                  {todo.text}
                </span>
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
            <div className="px-1 py-1 text-[11px] text-notion-textSecondary">暂无待办</div>
          )}

          {expanded && (
            <div className="mt-1 border-t border-[#dbe8f5] pt-1">
              {addingTodo ? (
                <input
                  autoFocus
                  value={todoText}
                  onChange={(event) => setTodoText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleCreateTodo();
                    } else if (event.key === 'Escape') {
                      setAddingTodo(false);
                      setTodoText('');
                    }
                  }}
                  onBlur={() => {
                    if (!todoText.trim()) setAddingTodo(false);
                  }}
                  placeholder="添加待办，回车保存"
                  className="h-7 w-full rounded border border-[#cbdff3] bg-white px-2 text-xs outline-none focus:border-[#2383e2]"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingTodo(true)}
                  className="flex h-7 w-full items-center gap-1.5 rounded px-1 text-[11px] text-notion-textSecondary hover:bg-white/70 hover:text-notion-text"
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加待办
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mt-2 flex h-6 items-center gap-1 px-1 text-[11px] font-medium text-notion-textSecondary">
          <span>私人笔记</span>
          <span className="text-notion-textSecondary/70">{noteCount}</span>
          {expanded && (
            <button
              type="button"
              onClick={() => void handleCreateNote()}
              disabled={creatingNote}
              className="ml-auto flex h-5 w-5 items-center justify-center rounded hover:bg-white/70 disabled:opacity-50"
              aria-label="新建私人笔记"
            >
              {creatingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        <div className="rounded-md bg-white/55 px-1 py-1">
          {notes.length > 0 ? (
            <PersonalNoteTree
              notes={notes}
              expandedIds={expandedNoteIds}
              onToggle={toggleNote}
              onOpen={(id) => navigate(`/personal/notes/${id}`)}
              onAddChild={(id) => void handleCreateNote(id)}
              onDelete={(id) => void deleteNote(id)}
              onMove={(id, parentId, afterId) => void moveNote(id, parentId, afterId)}
            />
          ) : (
            <div className="px-1 py-1 text-[11px] text-notion-textSecondary">暂无私人笔记</div>
          )}
        </div>
      </div>}
    </section>
  );
}
