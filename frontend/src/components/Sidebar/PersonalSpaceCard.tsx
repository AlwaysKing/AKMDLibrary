import { useEffect, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileText, Loader2, LockKeyhole, NotebookPen, Plus, Trash2 } from 'lucide-react';
import { PersonalNoteNode } from '../../api/personal';
import { usePersonalStore } from '../../stores/personalStore';

function countNotes(notes: PersonalNoteNode[]): number {
  return notes.reduce((total, note) => total + 1 + countNotes(note.children || []), 0);
}

function findNoteLocation(
  notes: PersonalNoteNode[],
  targetId: string,
  parentId: string | null = null,
): { note: PersonalNoteNode; parentId: string | null; siblings: PersonalNoteNode[]; index: number } | null {
  const directIndex = notes.findIndex((note) => note.id === targetId);
  if (directIndex >= 0) {
    return { note: notes[directIndex], parentId, siblings: notes, index: directIndex };
  }
  for (const note of notes) {
    const found = findNoteLocation(note.children || [], targetId, note.id);
    if (found) return found;
  }
  return null;
}

function setRoundedNoteDragPreview(
  event: DragEvent<HTMLDivElement>,
  note: PersonalNoteNode,
  depth: number,
) {
  const rect = event.currentTarget.getBoundingClientRect();
  const preview = document.createElement('div');
  preview.textContent = note.title || '未命名笔记';
  preview.style.position = 'fixed';
  preview.style.top = '-1000px';
  preview.style.left = '-1000px';
  preview.style.width = `${rect.width}px`;
  preview.style.height = `${rect.height}px`;
  preview.style.boxSizing = 'border-box';
  preview.style.display = 'flex';
  preview.style.alignItems = 'center';
  preview.style.paddingLeft = `${Math.min(depth, 4) * 16 + 36}px`;
  preview.style.paddingRight = '12px';
  preview.style.borderRadius = '6px';
  preview.style.overflow = 'hidden';
  preview.style.background = 'rgba(255, 255, 255, 0.98)';
  preview.style.boxShadow = '0 6px 18px rgba(15, 23, 42, 0.14)';
  preview.style.color = '#37352f';
  preview.style.fontSize = '12px';
  preview.style.fontWeight = '500';
  preview.style.whiteSpace = 'nowrap';
  preview.style.pointerEvents = 'none';
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview, 12, rect.height / 2);
  window.setTimeout(() => preview.remove(), 0);
}

function PersonalNoteTree({
  notes,
  depth,
  expandedIds,
  draggedNoteId,
  dropTarget,
  onToggle,
  onOpen,
  onAddChild,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  notes: PersonalNoteNode[];
  depth: number;
  expandedIds: Set<string>;
  draggedNoteId: string | null;
  dropTarget: { id: string; position: 'before' | 'after' } | null;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onAddChild: (id: string) => void;
  onDelete: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, position: 'before' | 'after') => void;
  onDrop: (id: string, position: 'before' | 'after') => void;
  onDragEnd: () => void;
}) {
  return notes.map((note) => {
    const children = note.children || [];
    const isExpanded = expandedIds.has(note.id);
    const rowDropPosition = dropTarget?.id === note.id ? dropTarget.position : null;
    return (
      <div key={note.id}>
        <div className="relative">
          {rowDropPosition === 'before' && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-10 h-[2px] bg-[#2383e2] opacity-60"
              style={{ top: -1, marginLeft: `${Math.min(depth, 4) * 16 + 8}px` }}
            />
          )}
          <div
            draggable
            onDragStart={(event) => {
              event.stopPropagation();
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', note.id);
              setRoundedNoteDragPreview(event, note, depth);
              onDragStart(note.id);
            }}
            onDragOver={(event) => {
              if (!draggedNoteId || draggedNoteId === note.id) return;
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              onDragOver(note.id, event.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (rowDropPosition) onDrop(note.id, rowDropPosition);
            }}
            onDragEnd={onDragEnd}
            onClick={() => onOpen(note.id)}
            className="group flex h-[30px] w-full cursor-grab items-center overflow-hidden rounded-md transition-colors hover:bg-white/70 active:cursor-grabbing"
            style={{ paddingLeft: `${Math.min(depth, 4) * 16 + 8}px`, paddingRight: '4px' }}
          >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (children.length > 0) onToggle(note.id);
              else onOpen(note.id);
            }}
            className="mr-2 flex h-[18px] w-[22px] flex-shrink-0 items-center justify-center rounded transition-colors"
            aria-label={
              children.length > 0
                ? (isExpanded ? `收起子页面：${note.title || '未命名笔记'}` : `展开子页面：${note.title || '未命名笔记'}`)
                : `打开笔记：${note.title || '未命名笔记'}`
            }
          >
            {note.icon ? (
              note.icon.startsWith('/') || note.icon.startsWith('http') ? (
                <img src={note.icon} alt="" className="h-[18px] w-[18px] object-contain group-hover:hidden" />
              ) : (
                <span
                  className="text-[18px] leading-none group-hover:hidden"
                  style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"' }}
                >
                  {note.icon}
                </span>
              )
            ) : (
              <FileText className="h-[18px] w-[18px] text-[#91918e] group-hover:hidden" strokeWidth={1.7} />
            )}
            {children.length > 0 && (
              <ChevronRight className={`hidden h-3 w-3 text-[#ada9a3] group-hover:block transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            )}
          </button>
          <span className="min-w-0 flex-1 cursor-pointer truncate text-xs font-medium text-notion-text">
            {note.title || '未命名笔记'}
          </span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAddChild(note.id);
              }}
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-notion-textSecondary opacity-0 transition-opacity hover:bg-notion-hover group-hover:opacity-100"
              aria-label={`添加子页面：${note.title || '未命名笔记'}`}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(note.id);
              }}
              className="mr-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-notion-textSecondary opacity-0 transition-opacity hover:bg-notion-hover group-hover:opacity-100"
              aria-label={`删除私人笔记：${note.title || '未命名笔记'}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          {rowDropPosition === 'after' && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-10 h-[2px] bg-[#2383e2] opacity-60"
              style={{ bottom: -1, marginLeft: `${Math.min(depth, 4) * 16 + 8}px` }}
            />
          )}
        </div>
        {children.length > 0 && isExpanded && (
          <PersonalNoteTree
            notes={children}
            depth={depth + 1}
            expandedIds={expandedIds}
            draggedNoteId={draggedNoteId}
            dropTarget={dropTarget}
            onToggle={onToggle}
            onOpen={onOpen}
            onAddChild={onAddChild}
            onDelete={onDelete}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
          />
        )}
      </div>
    );
  });
}

export default function PersonalSpaceCard() {
  const navigate = useNavigate();
  const {
    todos,
    notes,
    isLoading,
    error,
    fetchOverview,
    createTodo,
    updateTodo,
    deleteTodo,
    createNote,
    deleteNote,
    moveNote,
  } = usePersonalStore();
  const [expanded, setExpanded] = useState(false);
  const [addingTodo, setAddingTodo] = useState(false);
  const [todoText, setTodoText] = useState('');
  const [submittingTodo, setSubmittingTodo] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [noteDropTarget, setNoteDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);

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
  const noteCount = countNotes(notes);

  const toggleNote = (id: string) => {
    setExpandedNoteIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetNoteDrag = () => {
    setDraggedNoteId(null);
    setNoteDropTarget(null);
  };

  const handleNoteDragOver = (targetId: string, position: 'before' | 'after') => {
    if (!draggedNoteId || draggedNoteId === targetId) return;
    const source = findNoteLocation(notes, draggedNoteId);
    const target = findNoteLocation(notes, targetId);
    if (!source || !target || source.parentId !== target.parentId) return;
    setNoteDropTarget((current) => (
      current?.id === targetId && current.position === position
        ? current
        : { id: targetId, position }
    ));
  };

  const handleNoteDrop = (targetId: string) => {
    if (!draggedNoteId || draggedNoteId === targetId || !noteDropTarget) {
      resetNoteDrag();
      return;
    }
    const source = findNoteLocation(notes, draggedNoteId);
    const target = findNoteLocation(notes, targetId);
    if (!source || !target || source.parentId !== target.parentId) {
      resetNoteDrag();
      return;
    }

    const remainingSiblings = source.siblings.filter((note) => note.id !== draggedNoteId);
    const targetIndex = remainingSiblings.findIndex((note) => note.id === targetId);
    if (targetIndex < 0) {
      resetNoteDrag();
      return;
    }
    const afterId = noteDropTarget.position === 'after'
      ? targetId
      : (remainingSiblings[targetIndex - 1]?.id || null);
    void moveNote(draggedNoteId, source.parentId, afterId);
    resetNoteDrag();
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
    <section className="mx-1 mb-2 overflow-hidden rounded-lg border border-[#dbe8f5] bg-[#eaf3fc]">
      <div className="flex items-center gap-1 px-2.5 py-2">
        <button
          type="button"
          onClick={() => navigate('/personal')}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left"
        >
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-[#d8eafb] text-[#2383e2]">
            <NotebookPen className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-notion-text">
              个人空间
              <LockKeyhole className="h-3 w-3 text-notion-textSecondary" strokeWidth={1.8} />
            </span>
            <span className="mt-0.5 block text-[11px] text-notion-textSecondary">
              {isLoading ? '正在加载…' : `${pendingCount} 项待办 · ${noteCount} 篇笔记`}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
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
        {error && <div className="px-1 py-1 text-[11px] text-red-500">{error}</div>}

        <div className="rounded-md bg-white/55 px-1 py-1">
          {todos.length > 0 ? (
            todos.map((todo) => (
              <div key={`${todo.index}:${todo.text}`} className="group flex min-h-[28px] items-center gap-2 overflow-hidden rounded-md px-1 hover:bg-white/70">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={todo.done}
                  aria-label={todo.done ? `标记未完成：${todo.text}` : `标记完成：${todo.text}`}
                  onClick={() => void updateTodo(todo.index, { done: !todo.done })}
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
                <button
                  type="button"
                  onClick={() => void deleteTodo(todo.index)}
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-notion-textSecondary opacity-0 transition-opacity hover:bg-notion-hover group-hover:opacity-100"
                  aria-label={`删除待办：${todo.text}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
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
              depth={0}
              expandedIds={expandedNoteIds}
              draggedNoteId={draggedNoteId}
              dropTarget={noteDropTarget}
              onToggle={toggleNote}
              onOpen={(id) => navigate(`/personal/notes/${id}`)}
              onAddChild={(id) => void handleCreateNote(id)}
              onDelete={(id) => void deleteNote(id)}
              onDragStart={setDraggedNoteId}
              onDragOver={handleNoteDragOver}
              onDrop={handleNoteDrop}
              onDragEnd={resetNoteDrag}
            />
          ) : (
            <div className="px-1 py-1 text-[11px] text-notion-textSecondary">暂无私人笔记</div>
          )}
        </div>
      </div>}
    </section>
  );
}
