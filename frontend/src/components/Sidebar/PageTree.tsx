import { useState, useCallback, useRef, useEffect } from 'react';
import { FileText } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  CollisionDetection,
  DragOverlay,
  DroppableContainer,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import SortablePageTreeItem from './SortablePageTreeItem';
import { useSpaceStore } from '../../stores/spaceStore';
import { usePreferenceStore } from '../../stores/preferenceStore';
import { usePageStore } from '../../stores/pageStore';
import { Page } from '../../api/pages';
import { useUndoStore } from '../../stores/undoStore';

// Collect all descendant IDs of a page (to prevent circular moves)
function collectDescendantIds(page: Page): string[] {
  const ids: string[] = [];
  if (page.children) {
    for (const child of page.children) {
      ids.push(child.id);
      ids.push(...collectDescendantIds(child));
    }
  }
  return ids;
}

// Find a page and its parent's children array in the tree
function findPageInTree(pages: Page[], pageId: string): { page: Page; parentChildren: Page[]; index: number } | null {
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].id === pageId) {
      return { page: pages[i], parentChildren: pages, index: i };
    }
    if (pages[i].children) {
      const result = findPageInTree(pages[i].children!, pageId);
      if (result) return result;
    }
  }
  return null;
}

// Determine the drop position based on cursor Y relative to the hovered element
function getDropPositionFromRect(rect: DOMRect, cursorY: number): 'before' | 'on' | 'after' {
  const relativeY = cursorY - rect.top;
  const height = rect.height;

  if (relativeY < height * 0.25) return 'before';
  if (relativeY > height * 0.75) return 'after';
  return 'on';
}

// Custom collision detection: use [data-page-row] row element centers instead of
// sortable wrapper rects. This prevents parent items (whose wrappers include all children)
// from being incorrectly selected when the pointer is near a child item.
// Additionally, when the pointer is in the bottom 25% ("after" zone) of an expanded parent,
// we redirect to the first visible child so the drop indicator appears between the parent
// and its first child (Notion behavior), not at the end of all siblings.
const closestRowCenter: CollisionDetection = (args) => {
  const { droppableContainers, pointerCoordinates } = args;
  if (!pointerCoordinates) return [];

  const pointerY = pointerCoordinates.y;

  let closest: { container: DroppableContainer; distance: number } | null = null;

  for (const container of droppableContainers) {
    // Find the row element within this sortable container
    const sortableEl = document.querySelector(`[data-sortable-id="${container.id}"]`);
    const rowEl = sortableEl?.querySelector('[data-page-row]') as HTMLElement | undefined;
    if (!rowEl) continue;

    const rect = rowEl.getBoundingClientRect();
    // Only consider rows that vertically overlap with the pointer.
    // Use >= for bottom boundary (exclusive) so that when two rows share
    // an edge (parent bottom = child top), the lower row wins.
    if (pointerY < rect.top || pointerY >= rect.bottom) continue;

    const relativeY = pointerY - rect.top;
    const height = rect.height;

    // If pointer is in the bottom 25% ("after" zone) of an expanded parent's row,
    // redirect to the first visible child instead — this makes "after parent"
    // behave like "before first child", matching Notion behavior.
    if (relativeY > height * 0.75) {
      const allRows = sortableEl.querySelectorAll('[data-page-row]');
      if (allRows.length > 1) {
        // This is an expanded parent with visible children
        const firstChildRow = allRows[1] as HTMLElement;
        const childSortable = firstChildRow.closest('[data-sortable-id]');
        const childId = childSortable?.getAttribute('data-sortable-id');
        if (childId) {
          const childContainer = Array.from(droppableContainers).find(c => String(c.id) === childId);
          if (childContainer) {
            const childRect = firstChildRow.getBoundingClientRect();
            const childCenterY = childRect.top + childRect.height / 2;
            const distance = Math.abs(pointerY - childCenterY);
            if (!closest || distance < closest.distance) {
              closest = { container: childContainer, distance };
            }
          }
        }
        continue; // Skip the parent — child has been matched instead
      }
    }

    const centerY = rect.top + rect.height / 2;
    const distance = Math.abs(pointerY - centerY);

    if (!closest || distance < closest.distance) {
      closest = { container, distance };
    }
  }

  return closest ? [closest.container] : [];
};

// Get the parent ID of a page in the tree (null for root)
function findParentId(pages: Page[], pageId: string, parentId: string | null = null): string | null {
  for (const p of pages) {
    if (p.id === pageId) return parentId;
    if (p.children) {
      const result = findParentId(p.children, pageId, p.id);
      if (result !== undefined) return result;
    }
  }
  return undefined as unknown as string | null;
}

// DragGhost: renders a mini page tree for the drag overlay, matching real item appearance
function DragGhost({ page, level, expandedPageIds }: { page: Page; level: number; expandedPageIds: Set<string> }) {
  const hasChildren = page.children && page.children.length > 0;
  const isExpanded = expandedPageIds.has(page.id);

  return (
    <div>
      <div
        className="w-full flex items-center h-[30px] rounded-md"
        style={{ paddingLeft: `${level * 16 + 8}px`, paddingRight: '8px' }}
      >
        {/* Icon */}
        <div className="flex items-center justify-center flex-shrink-0 mr-2" style={{ width: '22px', height: '18px' }}>
          {page.icon ? (
            (page.icon.startsWith('/') || page.icon.startsWith('http')) ? (
              <img src={page.icon} alt="" className="w-[18px] h-[18px] object-contain" />
            ) : (
              <span className="text-[18px] leading-none" style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"' }}>{page.icon}</span>
            )
          ) : (
            <FileText className="w-[18px] h-[18px] text-[#91918e]" strokeWidth={1.7} />
          )}
        </div>
        {/* Title */}
        <span className="text-sm font-medium truncate text-notion-sidebarText">
          {page.title || '未命名页面'}
        </span>
      </div>
      {/* Recursively render expanded children */}
      {isExpanded && hasChildren && page.children!.map((child) => (
        <DragGhost key={child.id} page={child} level={level + 1} expandedPageIds={expandedPageIds} />
      ))}
    </div>
  );
}

// Find the level (depth) of a page in the tree
function findPageLevel(pages: Page[], pageId: string, level: number = 0): number | null {
  for (const p of pages) {
    if (p.id === pageId) return level;
    if (p.children) {
      const result = findPageLevel(p.children, pageId, level + 1);
      if (result !== null) return result;
    }
  }
  return null;
}

export default function PageTree() {
  const { pageTree, currentSpace } = useSpaceStore();
  const { getExpandedPageIds, setExpandedPageIds } = usePreferenceStore();
  const { movePage, refreshPageTree } = usePageStore();

  const expandedPageIds = new Set(
    currentSpace ? getExpandedPageIds(currentSpace.slug) : []
  );

  const handleToggleExpand = useCallback((pageId: string, expanded: boolean) => {
    if (!currentSpace) return;
    const current = getExpandedPageIds(currentSpace.slug);
    const next = expanded
      ? [...current, pageId]
      : current.filter((id: string) => id !== pageId);
    setExpandedPageIds(currentSpace.slug, next);
  }, [currentSpace, getExpandedPageIds, setExpandedPageIds]);

  // Drag state — ALL hooks must be before any early returns
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<Page | null>(null);
  const [overInfo, setOverInfo] = useState<{ id: string; position: 'before' | 'on' | 'after' } | null>(null);
  const [descendantIds, setDescendantIds] = useState<Set<string>>(new Set());

  // Track activation Y so we can compute current pointer Y = activatorY + delta.y
  const activatorYRef = useRef(0);
  // Track current over item's row rect (set in onDragOver, read in rAF loop)
  const overRectRef = useRef<{ id: string; rowRect: DOMRect } | null>(null);
  // Real-time pointer Y (updated by pointermove listener)
  const pointerYRef = useRef(0);
  // rAF loop handle
  const rafRef = useRef<number>(0);

  // When drag is active: track pointer Y + run rAF loop to continuously update drop position
  // (onDragOver only fires when over ELEMENT changes; we need updates on every pointer move)
  useEffect(() => {
    if (!activeId) return;

    // Track real-time pointer Y
    const onPointerMove = (e: PointerEvent) => { pointerYRef.current = e.clientY; };
    window.addEventListener('pointermove', onPointerMove);

    // Continuously calculate drop position from pointer Y + saved row rect
    const update = () => {
      const over = overRectRef.current;
      if (over) {
        const pointerY = pointerYRef.current;
        if (pointerY) {
          const position = getDropPositionFromRect(over.rowRect, pointerY);
          setOverInfo(prev => {
            if (prev && prev.id === over.id && prev.position === position) return prev;
            return { id: over.id, position };
          });
        }
      }
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, [activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // Helper: get drop position for any page ID
  const getDropPositionFor = useCallback((id: string): 'before' | 'after' | 'on' | null => {
    if (!overInfo || !activeId) return null;
    if (id === activeId) return null;
    if (overInfo.id !== id) return null;
    if (descendantIds.has(id)) return null;
    return overInfo.position;
  }, [overInfo, activeId, descendantIds]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const page = active.data.current?.page as Page | undefined;
    if (page) {
      setActiveId(active.id as string);
      setActivePage(page);
      setDescendantIds(new Set(collectDescendantIds(page)));
      const activator = event.activatorEvent as MouseEvent | null;
      if (activator) activatorYRef.current = activator.clientY;
    }
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (!over || over.id === activeId || descendantIds.has(over.id as string)) {
      overRectRef.current = null;
      setOverInfo(null);
      return;
    }

    // Get the rect of just the row element using data attributes
    const sortableEl = document.querySelector(`[data-sortable-id="${over.id}"]`);
    const rowEl = sortableEl?.querySelector('[data-page-row]') as HTMLElement | undefined;
    const rowRect = rowEl?.getBoundingClientRect() ?? null;

    if (!rowRect) {
      overRectRef.current = null;
      setOverInfo({ id: over.id as string, position: 'on' });
      return;
    }

    // Save rect for continuous updates in handleDragMove
    overRectRef.current = { id: over.id as string, rowRect };

    // Calculate initial position
    const pointerY = pointerYRef.current || (event.activatorEvent ? (event.activatorEvent as MouseEvent).clientY : rowRect.top + rowRect.height / 2);
    const position = getDropPositionFromRect(rowRect, pointerY);

    setOverInfo({ id: over.id as string, position });
  }, [activeId, descendantIds]);

  const { pushAction } = useUndoStore();

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;

    // Clean up
    const savedOverInfo = overInfo;
    setActiveId(null);
    setActivePage(null);
    setOverInfo(null);
    setDescendantIds(new Set());

    if (!over || !currentSpace) return;

    // Ignore drop on self or descendant
    if (active.id === over.id) return;
    const descSet = new Set(collectDescendantIds(active.data.current?.page as Page));
    if (descSet.has(over.id as string)) return;

    const overPage = over.data.current?.page as Page;
    if (!overPage) return;

    // Record the FROM position for undo
    const fromParentId = findParentId(pageTree, active.id as string) ?? null;
    const fromFound = findPageInTree(pageTree, active.id as string);
    const fromAfterId = fromFound && fromFound.index > 0
      ? fromFound.parentChildren[fromFound.index - 1].id
      : null;

    // Use the saved position from the last dragOver
    const position = savedOverInfo?.position || 'on';

    let toParentId: string | null;
    let toAfterId: string | null;

    if (position === 'on') {
      // Drop ON → become child of over page
      toParentId = overPage.id;
      toAfterId = null;
    } else {
      // Drop BEFORE/AFTER → insert among siblings of over page
      toParentId = findParentId(pageTree, overPage.id) ?? null;

      if (position === 'after') {
        toAfterId = overPage.id;
      } else {
        // 'before': find the sibling before overPage
        const found = findPageInTree(pageTree, overPage.id);
        if (found && found.index > 0) {
          toAfterId = found.parentChildren[found.index - 1].id;
        } else {
          toAfterId = null;
        }
      }
    }

    await movePage(currentSpace.slug, active.id as string, toParentId, toAfterId);

    // Push undo action after successful move
    pushAction({
      type: 'move',
      spaceSlug: currentSpace.slug,
      pageId: active.id as string,
      from: { parentId: fromParentId, afterId: fromAfterId },
      to: { parentId: toParentId, afterId: toAfterId },
    });

    refreshPageTree();
  }, [currentSpace, pageTree, overInfo, movePage, refreshPageTree, pushAction]);

  // Early returns AFTER all hooks
  if (!currentSpace) {
    return (
      <div className="text-notion-textSecondary text-sm px-2 py-4">
        选择一个空间以查看页面
      </div>
    );
  }

  if (pageTree.length === 0) {
    return (
      <div className="text-notion-textSecondary text-sm px-2 py-4">
        暂无页面，创建你的第一个页面吧！
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestRowCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={pageTree.map(p => p.id)} strategy={verticalListSortingStrategy}>
        <div data-page-tree="true" className="space-y-[2px]">
          {pageTree.map((page) => (
            <SortablePageTreeItem
              key={page.id}
              page={page}
              level={0}
              expandedPageIds={expandedPageIds}
              onToggleExpand={handleToggleExpand}
              dropPosition={getDropPositionFor(page.id)}
              getDropPositionFor={getDropPositionFor}
              dragActiveId={activeId}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activePage ? (
          <DragGhost page={activePage} level={0} expandedPageIds={expandedPageIds} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
