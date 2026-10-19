import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle, Bell, Check, Link2, ListChecks, Loader2, Plus, Search, Sun, Trash2, X,
} from 'lucide-react';
import Breadcrumb from '../components/Editor/Breadcrumb';
import { PersonalTodo, PersonalTodoLink } from '../api/personal';
import { usePersonalStore } from '../stores/personalStore';
import { useSpaceStore } from '../stores/spaceStore';
import { personalTodoLinkPath } from '../utils/personalTodoLinks';
import { personalTrail } from '../utils/personalPages';

interface TodoSection {
  key: string;
  label: string;
  icon: React.ReactNode;
  items: PersonalTodo[];
}

export default function PersonalTodosPage() {
  const navigate = useNavigate();
  const { currentSpace } = useSpaceStore();
  const {
    todos,
    isLoading,
    fetchOverview,
    createTodo,
    updateTodo,
    deleteTodo,
  } = usePersonalStore();
  const [todoText, setTodoText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [addingTodo, setAddingTodo] = useState(false);
  const [query, setQuery] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (todo: PersonalTodo) =>
    !normalizedQuery || todo.text.toLowerCase().includes(normalizedQuery);
  const pendingTodos = todos.filter((todo) => !todo.done && matchesQuery(todo));
  const overdueTodos = pendingTodos.filter((todo) => todo.overdue);
  const todayTodos = pendingTodos.filter((todo) => todo.is_today && !todo.overdue);
  // 既不属于今天也没有逾期记录的待办，统一归入「待办事项」；新添加的排在最前面。
  const laterTodos = pendingTodos
    .filter((todo) => !todo.is_today && !todo.overdue)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const doneTodos = todos.filter((todo) => todo.done && matchesQuery(todo));

  const sections: TodoSection[] = [
    {
      key: 'overdue',
      label: '已逾期',
      icon: <AlertCircle className="h-4 w-4 text-red-500" strokeWidth={1.8} />,
      items: overdueTodos,
    },
    {
      key: 'today',
      label: '今日待办',
      icon: <Sun className="h-4 w-4 text-notion-textSecondary" strokeWidth={1.8} />,
      items: todayTodos,
    },
  ];

  const startAdding = () => {
    setAddingTodo(true);
    window.setTimeout(() => addInputRef.current?.focus(), 0);
  };

  const handleCreateTodo = async () => {
    const text = todoText.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await createTodo(text, { today: false });
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

  const startEditing = (todo: PersonalTodo) => {
    setEditingTodoId(todo.id);
    setEditingText(todo.text);
  };

  const commitEditing = async (todo: PersonalTodo) => {
    const text = editingText.trim();
    setEditingTodoId(null);
    if (!text || text === todo.text) return;
    await updateTodo(todo.id, { text });
  };

  const renderTodo = (todo: PersonalTodo) => (
    <div key={todo.id} className="group flex min-h-9 items-center gap-2 rounded-md px-1 hover:bg-[#f7f7f5]">
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
        {todo.done && <Check className="h-3 w-3" strokeWidth={3} />}
      </button>
      {editingTodoId === todo.id ? (
        <input
          autoFocus
          value={editingText}
          onChange={(event) => setEditingText(event.target.value)}
          onFocus={(event) => event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
          onBlur={() => void commitEditing(todo)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void commitEditing(todo);
            } else if (event.key === 'Escape') {
              setEditingTodoId(null);
            }
          }}
          className={`min-w-0 flex-1 select-text bg-transparent p-0 text-[17px] shadow-[inset_0_-1px_0_0_#c9c8c5] outline-none ${todo.done ? 'text-notion-textSecondary line-through' : 'text-notion-text'}`}
        />
      ) : (
        <span
          onMouseDown={(event) => {
            // 双击的第二下会触发浏览器选中文字，阻止掉以免进入编辑前闪一下选中态
            if (event.detail > 1) event.preventDefault();
          }}
          onDoubleClick={() => startEditing(todo)}
          className={`min-w-0 flex-1 truncate text-[17px] ${todo.done ? 'text-notion-textSecondary line-through' : 'text-notion-text'}`}
        >
          {todo.text}
        </span>
      )}
      {todo.overdue && (
        <span className="flex flex-shrink-0 items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
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
  );

  return (
    <div className="flex h-full flex-col select-none overflow-hidden bg-notion-bg">
      <Breadcrumb
        spaceSlug={currentSpace?.slug || ''}
        rootLabel="个人空间"
        trail={personalTrail(navigate, 'todos')}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[900px] px-10 pb-24 pt-12">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-[34px] font-bold leading-tight tracking-[-0.035em] text-notion-text">
                待办
              </h1>
              <p className="mt-1.5 text-sm text-notion-textSecondary">
                {pendingTodos.length} 项待完成
                {overdueTodos.length > 0 && `，${overdueTodos.length} 项已逾期`}
                {doneTodos.length > 0 && `，${doneTodos.length} 项已完成`}
              </p>
            </div>
          </div>

          <div className="mt-5 flex h-[43px] items-center gap-2 rounded-lg border border-notion-border px-3 shadow-sm">
            <Search className="h-4 w-4 flex-shrink-0 text-notion-textSecondary" strokeWidth={1.8} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索待办…"
              className="min-w-0 flex-1 select-text border-0 bg-transparent text-sm text-notion-text outline-none placeholder:text-notion-textSecondary"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-notion-textSecondary hover:bg-notion-hover"
                aria-label="清空搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {isLoading && todos.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-xs text-notion-textSecondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载…
            </div>
          ) : (
            <>
              {sections.map((section) => {
                if (section.items.length === 0) return null;
                return (
                  <section key={section.key} className="mt-7">
                    <div className={`flex h-8 items-center gap-1.5 text-sm font-semibold ${section.key === 'overdue' ? 'text-red-500' : 'text-notion-textSecondary'}`}>
                      {section.icon}
                      {section.label}
                      <span className="text-xs font-medium text-notion-textSecondary">{section.items.length}</span>
                    </div>
                    {section.items.map(renderTodo)}
                  </section>
                );
              })}

              <section className="mt-7">
                <div className="group flex h-8 items-center gap-1.5 text-sm font-semibold text-notion-textSecondary">
                  <ListChecks className="h-4 w-4 text-notion-textSecondary" strokeWidth={1.8} />
                  待办事项
                  <span className="text-xs font-medium text-notion-textSecondary">{laterTodos.length}</span>
                  <button
                    type="button"
                    onClick={startAdding}
                    className="ml-1 flex h-5 w-5 items-center justify-center rounded text-notion-textSecondary opacity-0 transition-opacity hover:bg-notion-hover hover:text-notion-text group-hover:opacity-100"
                    aria-label="添加待办"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {addingTodo && (
                  <div className="flex min-h-9 items-center gap-2 rounded-md px-1">
                    {submitting ? (
                      <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-[#2383e2]" />
                    ) : (
                      <Plus className="h-4 w-4 flex-shrink-0 text-[#2383e2]" />
                    )}
                    <input
                      ref={addInputRef}
                      autoFocus
                      value={todoText}
                      onChange={(event) => setTodoText(event.target.value)}
                      onBlur={() => {
                        if (!todoText.trim()) {
                          setAddingTodo(false);
                        }
                      }}
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
                      className="min-w-0 flex-1 select-text border-0 bg-transparent p-0 text-[17px] text-notion-text outline-none placeholder:text-notion-textSecondary"
                    />
                  </div>
                )}
                {laterTodos.map(renderTodo)}
                {!addingTodo && (
                  <button
                    type="button"
                    onClick={startAdding}
                    className="flex h-9 items-center gap-2 rounded-md px-1 text-sm text-notion-textSecondary transition-colors hover:bg-[#f7f7f5] hover:text-notion-text"
                  >
                    <Plus className="h-4 w-4" />
                    添加事项
                  </button>
                )}
              </section>

              {doneTodos.length > 0 && (
                <section className="mt-7">
                  <button
                    type="button"
                    onClick={() => setShowDone((value) => !value)}
                    className="flex h-7 items-center gap-1.5 text-xs font-semibold text-notion-text"
                  >
                    <Check className="h-4 w-4 text-notion-textSecondary" strokeWidth={1.8} />
                    已完成
                    <span className="text-[11px] font-medium text-notion-textSecondary">{doneTodos.length}</span>
                    <span className="ml-1 text-[11px] font-medium text-notion-textSecondary hover:text-notion-text">
                      {showDone ? '收起' : '展开'}
                    </span>
                  </button>
                  {showDone && doneTodos.map(renderTodo)}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
