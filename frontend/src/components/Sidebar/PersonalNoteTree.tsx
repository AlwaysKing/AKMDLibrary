import { useState, type DragEvent } from 'react';
import { ChevronRight, FileText, Plus, Trash2 } from 'lucide-react';
import { PersonalNoteNode } from '../../api/personal';

interface NoteDropTarget {
  id: string;
  position: 'before' | 'on' | 'after';
}

function collectNoteDescendantIds(note: PersonalNoteNode): string[] {
  return (note.children || []).flatMap((child) => [child.id, ...collectNoteDescendantIds(child)]);
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

function NoteTreeRows({
  notes,
  depth,
  expandedIds,
  draggedNoteId,
  dropTarget,
  variant,
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
  dropTarget: NoteDropTarget | null;
  variant: 'sidebar' | 'page';
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onAddChild: (id: string) => void;
  onDelete: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, position: 'before' | 'on' | 'after') => void;
  onDrop: (id: string, position: 'before' | 'on' | 'after') => void;
  onDragEnd: () => void;
}) {
  const isPage = variant === 'page';
  return notes.map((note) => {
    const children = note.children || [];
    const isExpanded = expandedIds.has(note.id);
    const rowDropPosition = dropTarget?.id === note.id ? dropTarget.position : null;
    return (
      <div
        key={note.id}
        className={rowDropPosition === 'on' ? 'rounded-md bg-[#e8f1fb]' : ''}
      >
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
              const relativeY = event.clientY - rect.top;
              onDragOver(
                note.id,
                relativeY < rect.height * 0.25 ? 'before' : relativeY > rect.height * 0.75 ? 'after' : 'on',
              );
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (rowDropPosition) onDrop(note.id, rowDropPosition);
            }}
            onDragEnd={onDragEnd}
            onClick={() => onOpen(note.id)}
            className={`group flex w-full cursor-grab items-center overflow-hidden transition-colors active:cursor-grabbing ${
              isPage ? 'h-9' : 'h-[30px]'
            } ${rowDropPosition === 'on' ? '' : isPage ? 'hover:bg-notion-hover rounded-md' : 'hover:bg-white/70 rounded-md'}`}
            style={{ paddingLeft: `${Math.min(depth, 4) * 16 + 8}px`, paddingRight: '4px' }}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(note.id);
              }}
              className="mr-2 flex h-[18px] w-[22px] flex-shrink-0 items-center justify-center rounded transition-colors"
              aria-label={
                isExpanded ? `收起子页面：${note.title || '未命名笔记'}` : `展开子页面：${note.title || '未命名笔记'}`
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
              <ChevronRight className={`hidden h-3 w-3 text-[#ada9a3] group-hover:block transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </button>
            <span className={`min-w-0 flex-1 cursor-pointer truncate text-notion-text ${isPage ? 'text-[17px]' : 'text-xs font-medium'}`}>
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
        {isExpanded && (
          children.length > 0 ? (
            <NoteTreeRows
              notes={children}
              depth={depth + 1}
              expandedIds={expandedIds}
              draggedNoteId={draggedNoteId}
              dropTarget={dropTarget}
              variant={variant}
              onToggle={onToggle}
              onOpen={onOpen}
              onAddChild={onAddChild}
              onDelete={onDelete}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
            />
          ) : (
            <div
              onDragOver={(event) => {
                if (!draggedNoteId || draggedNoteId === note.id) return;
                event.preventDefault();
                event.stopPropagation();
                onDragOver(note.id, 'on');
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDrop(note.id, 'on');
              }}
              className="flex items-center text-notion-textSecondary"
              style={{ height: isPage ? 34 : 30, paddingLeft: `${Math.min(depth + 1, 4) * 16 + 30}px` }}
            >
              <span className={isPage ? 'text-sm' : 'text-xs font-medium'}>内无页面</span>
            </div>
          )
        )}
      </div>
    );
  });
}

interface PersonalNoteTreeProps {
  notes: PersonalNoteNode[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onAddChild: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, parentId: string | null, afterId: string | null) => void;
  /** sidebar 为侧栏卡片内的小号行，page 为页面正文里的大号行 */
  variant?: 'sidebar' | 'page';
}

export default function PersonalNoteTree({
  notes,
  expandedIds,
  onToggle,
  onOpen,
  onAddChild,
  onDelete,
  onMove,
  variant = 'sidebar',
}: PersonalNoteTreeProps) {
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<NoteDropTarget | null>(null);

  const resetDrag = () => {
    setDraggedNoteId(null);
    setDropTarget(null);
  };

  const handleDragOver = (targetId: string, position: 'before' | 'on' | 'after') => {
    if (!draggedNoteId || draggedNoteId === targetId) return;
    const source = findNoteLocation(notes, draggedNoteId);
    if (!source) return;
    // 不能拖进自己或自己的子孙里
    if (collectNoteDescendantIds(source.note).includes(targetId)) return;
    setDropTarget((current) => (
      current?.id === targetId && current.position === position
        ? current
        : { id: targetId, position }
    ));
  };

  const handleDrop = (targetId: string, position: 'before' | 'on' | 'after') => {
    if (!draggedNoteId || draggedNoteId === targetId) {
      resetDrag();
      return;
    }
    const source = findNoteLocation(notes, draggedNoteId);
    const target = findNoteLocation(notes, targetId);
    if (!source || !target || collectNoteDescendantIds(source.note).includes(targetId)) {
      resetDrag();
      return;
    }

    let parentId: string | null;
    let afterId: string | null;
    if (position === 'on') {
      // 放到目标上：成为它的子页面，追加到现有子项末尾
      parentId = target.note.id;
      const children = target.note.children || [];
      afterId = children.length > 0 ? children[children.length - 1].id : null;
      if (!expandedIds.has(target.note.id)) onToggle(target.note.id);
    } else {
      // 放到目标前后：跟随目标所在的层级
      parentId = target.parentId;
      const siblings = target.siblings.filter((note) => note.id !== draggedNoteId);
      const targetIndex = siblings.findIndex((note) => note.id === targetId);
      afterId = position === 'after'
        ? targetId
        : (siblings[targetIndex - 1]?.id || null);
    }
    onMove(draggedNoteId, parentId, afterId);
    resetDrag();
  };

  return (
    <NoteTreeRows
      notes={notes}
      depth={0}
      expandedIds={expandedIds}
      draggedNoteId={draggedNoteId}
      dropTarget={dropTarget}
      variant={variant}
      onToggle={onToggle}
      onOpen={onOpen}
      onAddChild={onAddChild}
      onDelete={onDelete}
      onDragStart={setDraggedNoteId}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={resetDrag}
    />
  );
}
