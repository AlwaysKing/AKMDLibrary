import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ReactNode } from 'react';
import { Page } from '../../api/pages';
import PageTreeItem from './PageTreeItem';

interface SortablePageTreeItemProps {
  page: Page;
  level: number;
  expandedPageIds: Set<string>;
  onToggleExpand: (pageId: string, expanded: boolean) => void;
  dropPosition: 'before' | 'after' | 'on' | null;
  getDropPositionFor: (id: string) => 'before' | 'after' | 'on' | null;
  dragActiveId: string | null;
}

export default function SortablePageTreeItem({ page, level, expandedPageIds, onToggleExpand, dropPosition, getDropPositionFor, dragActiveId }: SortablePageTreeItemProps) {
  const hasChildren = page.children && page.children.length > 0;

  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useSortable({
    id: page.id,
    data: { page, level },
  });

  // Recursive child renderer: wraps each child level in its own SortableContext
  const renderChildren = (_parent: Page, parentLevel: number): ReactNode => {
    if (!hasChildren) return null;
    const childLevel = parentLevel + 1;
    const childIds = page.children!.map(c => c.id);
    return (
      <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
        {page.children!.map((child) => (
          <SortablePageTreeItem
            key={child.id}
            page={child}
            level={childLevel}
            expandedPageIds={expandedPageIds}
            onToggleExpand={onToggleExpand}
            dropPosition={getDropPositionFor(child.id)}
            getDropPositionFor={getDropPositionFor}
            dragActiveId={dragActiveId}
          />
        ))}
      </SortableContext>
    );
  };

  const showLineBefore = dropPosition === 'before';
  const showLineAfter = dropPosition === 'after';

  return (
    <div ref={setNodeRef} {...attributes} data-sortable-id={page.id} className="relative">
      {/* Blue drop line above the item — absolute so it doesn't affect layout */}
      {showLineBefore && (
        <div
          className="absolute left-0 right-0 h-[2px] z-10"
          style={{
            backgroundColor: 'rgb(35, 131, 226)',
            top: -1,
            marginLeft: `${level * 16 + 8}px`,
          }}
        />
      )}
      <PageTreeItem
        page={page}
        level={level}
        expandedPageIds={expandedPageIds}
        onToggleExpand={onToggleExpand}
        dragHandleProps={listeners}
        isDragging={isDragging}
        isDropTarget={dropPosition === 'on' && dragActiveId !== null ? 'on' : null}
        renderChildren={renderChildren}
      />
      {/* Blue drop line below the item — absolute so it doesn't affect layout */}
      {showLineAfter && (
        <div
          className="absolute left-0 right-0 h-[2px] z-10"
          style={{
            backgroundColor: 'rgb(35, 131, 226)',
            bottom: -1,
            marginLeft: `${level * 16 + 8}px`,
          }}
        />
      )}
    </div>
  );
}
