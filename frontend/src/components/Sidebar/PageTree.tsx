import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
import { showToastWithAction } from '../Toast';
import BlockDropOverlay from './BlockDropOverlay';

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
      const allRows = sortableEl?.querySelectorAll('[data-page-row]');
      if (allRows && allRows.length > 1) {
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

// ─── Sidebar → Editor drop helpers ──────────────────────
//
// 拖拽侧边栏页面到编辑器中：把拖动的页面变成"当前打开页面"的子页面，
// 插入位置由 drop 位置在已有 subpage block 序列中的相对位置决定。
//
// afterId 的计算规则（与后端 insertSubpageInParent 对齐）：
//   - afterID = nil  → 插入到第一个现有 subpage 之前
//   - afterID = "X"  → 插入到 subpage X 之后
//
// 我们以 drop 位置为基准，向回查找最近的 subpage block：
//   - 找到 → afterId = 该 subpage 引用的 pageId
//   - 没找到 → afterId = null（插入到所有 subpage 之前）

interface EditorDropTarget {
  blockEl: HTMLElement;     // 鼠标附近的 .bn-block-outer 元素
  position: 'before' | 'after'; // 在该 block 的上方/下方
  rect: DOMRect;            // 该 block 的 rect（用于绘制指示线）
}

/** 在当前编辑器中按文档顺序遍历所有 .bn-block-outer */
function getEditorBlocks(editorEl: HTMLElement): HTMLElement[] {
  return Array.from(editorEl.querySelectorAll<HTMLElement>('.bn-block-outer'));
}

/** 从某个 block 元素的 data 属性取出 subpage pageId（如果有） */
function getBlockSubpageId(blockEl: HTMLElement): string | null {
  const sub = blockEl.querySelector('[data-content-type="subpage"]');
  if (!sub) return null;
  return sub.getAttribute('data-page-id');
}

/** 给定 drop 目标，按文档顺序回溯找最近的前置 subpage，返回其 pageId（或 null） */
function computeAfterIdForEditorDrop(editorEl: HTMLElement, target: EditorDropTarget): string | null {
  const blocks = getEditorBlocks(editorEl);
  const idx = blocks.indexOf(target.blockEl);
  if (idx === -1) return null;
  // position === 'after' 时，目标 block 自身也算"前置"
  const endIdx = target.position === 'after' ? idx : idx - 1;
  for (let i = endIdx; i >= 0; i--) {
    const id = getBlockSubpageId(blocks[i]);
    if (id) return id;
  }
  return null;
}

/** 用 elementFromPoint 找当前光标下的编辑器 block；找不到返回 null */
function detectEditorDrop(clientX: number, clientY: number): { editor: HTMLElement; target: EditorDropTarget } | null {
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  if (!el) return null;
  const editor = el.closest('[data-page-editor="true"]') as HTMLElement | null;
  if (!editor) return null;
  const blockEl = el.closest('.bn-block-outer') as HTMLElement | null;
  if (!blockEl) return null;
  const rect = blockEl.getBoundingClientRect();
  const position: 'before' | 'after' = (clientY - rect.top) < rect.height / 2 ? 'before' : 'after';
  return { editor, target: { blockEl, position, rect } };
}

// DragGhost: renders a mini page tree for the drag overlay, matching real item appearance
function DragGhost({ page, level, expandedPageIds }: { page: Page; level: number; expandedPageIds: Set<string> }) {
  const hasChildren = page.children && page.children.length > 0;
  const isExpanded = expandedPageIds.has(page.id);

  return (
    <div style={{ opacity: 0.7, pointerEvents: 'none' }}>
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
  // 拖到编辑器里的 drop 目标（仅当光标在 PageEditor 区域内时设置）
  const [editorDropTarget, setEditorDropTarget] = useState<EditorDropTarget | null>(null);

  // Track activation Y so we can compute current pointer Y = activatorY + delta.y
  const activatorYRef = useRef(0);
  // Track current over item's row rect (set in onDragOver, read in rAF loop)
  const overRectRef = useRef<{ id: string; rowRect: DOMRect } | null>(null);
  // Real-time pointer Y (updated by pointermove listener)
  const pointerYRef = useRef(0);
  // 实时光标 X（用于检测编辑器 drop）
  const pointerXRef = useRef(0);
  // rAF loop handle
  const rafRef = useRef<number>(0);
  // Tree container ref for block drop overlay
  const treeContainerRef = useRef<HTMLDivElement>(null);
  // 编辑器 drop 目标 ref（与 editorDropTarget 同步，避免 handleDragEnd 闭包读到旧值）
  const editorDropTargetRef = useRef<EditorDropTarget | null>(null);

  // When drag is active: track pointer Y + run rAF loop to continuously update drop position
  // (onDragOver only fires when over ELEMENT changes; we need updates on every pointer move)
  useEffect(() => {
    if (!activeId) return;

    // 标记 body，让 CSS 抑制编辑器内 subpage block 的 :hover 高亮，
    // 避免拖入编辑器时被悬停的 subpage 误判为 drop target。
    document.body.classList.add('sidebar-page-drag-active');

    // Track real-time pointer Y
    const onPointerMove = (e: PointerEvent) => {
      pointerYRef.current = e.clientY;
      pointerXRef.current = e.clientX;
    };
    window.addEventListener('pointermove', onPointerMove);

    // Continuously calculate drop position from pointer Y + saved row rect
    const update = () => {
      // 1. 编辑器 drop 检测：光标是否在 PageEditor 区域内
      const editorDrop = detectEditorDrop(pointerXRef.current, pointerYRef.current);
      if (editorDrop) {
        // 在编辑器内：清空侧边栏 over 信息，设置编辑器 drop 目标
        overRectRef.current = null;
        setOverInfo(null);
        setEditorDropTarget(prev => {
          if (prev && prev.blockEl === editorDrop.target.blockEl && prev.position === editorDrop.target.position) return prev;
          return editorDrop.target;
        });
        editorDropTargetRef.current = editorDrop.target;
      } else {
        // 不在编辑器内：清空编辑器 drop，回到侧边栏 drop 检测
        if (editorDropTargetRef.current) {
          setEditorDropTarget(null);
          editorDropTargetRef.current = null;
        }
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
      }
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      cancelAnimationFrame(rafRef.current);
      document.body.classList.remove('sidebar-page-drag-active');
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
    const savedEditorDrop = editorDropTargetRef.current;
    setActiveId(null);
    setActivePage(null);
    setOverInfo(null);
    setDescendantIds(new Set());
    setEditorDropTarget(null);
    editorDropTargetRef.current = null;

    if (!currentSpace) return;

    // ─── 分支 1：拖到编辑器内 → 把页面移成"当前打开页面"的子页面
    if (savedEditorDrop) {
      const editorEl = savedEditorDrop.blockEl.closest('[data-page-editor="true"]') as HTMLElement | null;
      if (!editorEl) return;
      const currentPageId = window.location.pathname.match(/\/p\/([^/]+)$/)?.[1] || null;
      if (!currentPageId) return;

      // 不能拖到自己里面（或自己的子孙里面）
      const draggedPage = active.data.current?.page as Page | undefined;
      const draggedId = active.id as string;
      if (draggedId === currentPageId) return;
      if (draggedPage && collectDescendantIds(draggedPage).includes(currentPageId)) return;

      const afterId = computeAfterIdForEditorDrop(editorEl, savedEditorDrop);

      const fromParentId = findParentId(pageTree, draggedId) ?? null;
      const fromFound = findPageInTree(pageTree, draggedId);
      const fromAfterId = fromFound && fromFound.index > 0
        ? fromFound.parentChildren[fromFound.index - 1].id
        : null;

      try {
        await movePage(currentSpace.slug, draggedId, currentPageId, afterId);
        // subpage block 同步：通过 PageTree 自身的 refresh + PageEditor 已有的
        // subpage-created/subpage-reordered 事件监听完成。
        if (fromParentId !== currentPageId) {
          document.dispatchEvent(new CustomEvent('subpage-created', {
            detail: { pageId: draggedId, afterId, fromParentId }
          }));
        } else {
          document.dispatchEvent(new CustomEvent('subpage-reordered', {
            detail: { parentId: currentPageId, movedPageId: draggedId, afterId }
          }));
        }

        pushAction({
          type: 'move',
          spaceSlug: currentSpace.slug,
          pageId: draggedId,
          from: { parentId: fromParentId, afterId: fromAfterId },
          to: { parentId: currentPageId, afterId },
        });

        const activeTitle = draggedPage?.title || '未命名页面';
        showToastWithAction(`已将「${activeTitle}」移动到当前页面下`, [
          {
            label: '访问',
            onClick: () => {
              const slug = currentSpace?.slug;
              if (slug) window.location.href = `/s/${slug}/p/${draggedId}`;
            },
          },
          {
            label: '撤销',
            onClick: async () => {
              await useUndoStore.getState().undo();
            },
          },
        ]);
      } catch (err) {
        console.error('[PageTree] Failed to move page into editor:', err);
      }

      await refreshPageTree();
      return;
    }

    // ─── 分支 2：常规的侧边栏内拖拽
    if (!over) return;

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
      // Drop ON → 成为 overPage 的子页面，并插到现有子项的最末尾
      //（后端约定 afterID=nil 表示"插到首位"，所以必须显式取最后一个子项的 id）
      toParentId = overPage.id;
      const overFound = findPageInTree(pageTree, overPage.id);
      const overChildren = overFound?.page.children ?? [];
      toAfterId = overChildren.length > 0 ? overChildren[overChildren.length - 1].id : null;
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

    // Notify editor of subpage block changes
    const currentPageId = window.location.pathname.match(/\/p\/([^/]+)$/)?.[1] || null;
    const movedId = active.id as string;
    if (currentPageId && fromParentId !== toParentId) {
      if (fromParentId === currentPageId) {
        document.dispatchEvent(new CustomEvent('subpage-deleted', { detail: { pageId: movedId } }));
      } else if (toParentId === currentPageId) {
        document.dispatchEvent(new CustomEvent('subpage-created', { detail: { pageId: movedId, afterId: toAfterId, fromParentId } }));
      }
    }

    // Push undo action after successful move
    pushAction({
      type: 'move',
      spaceSlug: currentSpace.slug,
      pageId: active.id as string,
      from: { parentId: fromParentId, afterId: fromAfterId },
      to: { parentId: toParentId, afterId: toAfterId },
    });

    // Build human-readable description for the toast
    const activePage = active.data.current?.page as Page | undefined;
    const activeTitle = activePage?.title || '未命名页面';

    // Find target parent name for description
    let targetName: string;
    if (toParentId) {
      const targetParent = findPageInTree(pageTree, toParentId);
      targetName = targetParent?.page?.title || '未命名页面';
    } else {
      targetName = '根目录';
    }

    // Show toast with undo and visit buttons
    const movedPageId = active.id as string;
    showToastWithAction(`已将「${activeTitle}」移动到「${targetName}」`, [
      {
        label: '访问',
        onClick: () => {
          const slug = currentSpace?.slug;
          if (slug) window.location.href = `/s/${slug}/p/${movedPageId}`;
        },
      },
      {
        label: '撤销',
        onClick: async () => {
          await useUndoStore.getState().undo();
        },
      },
    ]);

    await refreshPageTree();

    // Same-parent reorder: notify editor to update subpage block order (after pageTree is refreshed)
    if (currentPageId && fromParentId === toParentId && toParentId === currentPageId) {
      document.dispatchEvent(new CustomEvent('subpage-reordered', { detail: { parentId: currentPageId, movedPageId: movedId, afterId: toAfterId } }));
    }
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
        <div ref={treeContainerRef} data-page-tree="true" className="space-y-[2px] relative">
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
          <BlockDropOverlay containerRef={treeContainerRef} />
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null} style={{ pointerEvents: 'none' }}>
        {activePage ? (
          <DragGhost page={activePage} level={0} expandedPageIds={expandedPageIds} />
        ) : null}
      </DragOverlay>
      {editorDropTarget && <EditorDropIndicator target={editorDropTarget} />}
    </DndContext>
  );
}

// ─── Editor drop indicator ──────────────────────────────
//
// 在编辑器中拖到 drop 目标位置画一条横线，样式与 BlockNote 原生
// dropcursor 对齐（BlockNote 默认: width=5, color="#ddeeff"，淡蓝色 5px 实线）。
// 用 portal 渲染到 body，避免被编辑器父元素的 transform/overflow 影响。
function EditorDropIndicator({ target }: { target: EditorDropTarget }) {
  // BlockNote 的 dropcursor 以中线为基准、上下各 2.5px，所以这里 top 也减 2.5
  const DROP_CURSOR_HEIGHT = 5;
  const baseTop = target.position === 'before' ? target.rect.top : target.rect.bottom;
  const top = baseTop - DROP_CURSOR_HEIGHT / 2;
  return createPortal(
    <div
      style={{
        position: 'fixed',
        top,
        left: target.rect.left,
        width: target.rect.width,
        height: DROP_CURSOR_HEIGHT,
        backgroundColor: '#ddeeff',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    />,
    document.body,
  );
}
