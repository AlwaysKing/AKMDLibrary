import { useCallback, useEffect, useRef } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import { Plus } from 'lucide-react';

// ─── Column Block ──────────────────────────────────────────────

function ColumnComponent(_props: any) {
  return <div className="column-block-inner" />;
}

export const ColumnBlockSpec = createReactBlockSpec(
  { type: 'column', propSchema: { widthRatio: { default: 50 } }, content: 'none' },
  { render: ColumnComponent, meta: { selectable: false } },
);

// ─── Column List Block ─────────────────────────────────────────

const MIN_RATIO = 15;
const MAX_COLUMNS = 5;
export const COLUMN_GAP_PX = 52;

function normalizeRatiosToHundred(rawRatios: number[]) {
  if (rawRatios.length === 0) return [];

  const safeRatios = rawRatios.map((ratio) => Math.max(0, ratio));
  const floors = safeRatios.map((ratio) => Math.floor(ratio));
  let remainder = 100 - floors.reduce((sum, ratio) => sum + ratio, 0);

  const ranked = safeRatios
    .map((ratio, index) => ({ index, fraction: ratio - Math.floor(ratio) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let i = 0; i < ranked.length && remainder > 0; i += 1, remainder -= 1) {
    floors[ranked[i].index] += 1;
  }

  if (remainder < 0) {
    const reverseRanked = [...ranked].reverse();
    for (let i = 0; i < reverseRanked.length && remainder < 0; i += 1, remainder += 1) {
      floors[reverseRanked[i].index] -= 1;
    }
  }

  return floors;
}

export function redistributeColumnRatios(
  ratios: number[],
  removedIndices: number[],
  containerWidth: number,
) {
  const removedIndexSet = new Set(removedIndices);
  const remainingRatios = ratios.filter((_, index) => !removedIndexSet.has(index));
  if (remainingRatios.length <= 1) return remainingRatios;

  const oldCount = ratios.length;
  const newCount = remainingRatios.length;
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    const total = remainingRatios.reduce((sum, ratio) => sum + ratio, 0) || newCount;
    return normalizeRatiosToHundred(
      remainingRatios.map((ratio) => (ratio / total) * 100)
    );
  }

  const oldGapShare = oldCount > 1 ? ((oldCount - 1) * COLUMN_GAP_PX) / oldCount : 0;
  const newGapShare = newCount > 1 ? ((newCount - 1) * COLUMN_GAP_PX) / newCount : 0;
  const remainingVisibleWidths = remainingRatios.map((ratio) =>
    Math.max(0, (containerWidth * ratio) / 100 - oldGapShare)
  );
  const oldVisibleTotal = remainingVisibleWidths.reduce((sum, width) => sum + width, 0);
  const newVisibleTotal = Math.max(0, containerWidth - (newCount - 1) * COLUMN_GAP_PX);

  if (oldVisibleTotal <= 0 || newVisibleTotal <= 0) {
    const total = remainingRatios.reduce((sum, ratio) => sum + ratio, 0) || newCount;
    return normalizeRatiosToHundred(
      remainingRatios.map((ratio) => (ratio / total) * 100)
    );
  }

  const scaledRatios = remainingVisibleWidths.map((width) => {
    const nextVisibleWidth = (width / oldVisibleTotal) * newVisibleTotal;
    return ((nextVisibleWidth + newGapShare) / containerWidth) * 100;
  });

  return normalizeRatiosToHundred(scaledRatios);
}

export function redistributeColumnRatiosFromWidths(
  visibleWidths: number[],
  removedIndices: number[],
  containerWidth: number,
) {
  const removedIndexSet = new Set(removedIndices);
  const remainingWidths = visibleWidths.filter((_, index) => !removedIndexSet.has(index));
  const newCount = remainingWidths.length;
  if (newCount <= 1) return newCount === 1 ? [100] : [];

  const safeContainerWidth = Number.isFinite(containerWidth) ? containerWidth : 0;
  const newGapShare = newCount > 1 ? ((newCount - 1) * COLUMN_GAP_PX) / newCount : 0;
  const oldVisibleTotal = remainingWidths.reduce((sum, width) => sum + Math.max(0, width), 0);
  const newVisibleTotal = Math.max(0, safeContainerWidth - (newCount - 1) * COLUMN_GAP_PX);

  if (safeContainerWidth <= 0 || oldVisibleTotal <= 0 || newVisibleTotal <= 0) {
    return normalizeRatiosToHundred(Array(newCount).fill(100 / newCount));
  }

  const scaledRatios = remainingWidths.map((width) => {
    const nextVisibleWidth = (Math.max(0, width) / oldVisibleTotal) * newVisibleTotal;
    return ((nextVisibleWidth + newGapShare) / safeContainerWidth) * 100;
  });

  return normalizeRatiosToHundred(scaledRatios);
}

export function updateColumnListRatios(editor: any, blockId: string, ratios: number[]) {
  const pmView = editor?.prosemirrorView;
  if (!pmView) return false;

  const { state } = pmView;
  let tr = state.tr;
  let updated = false;

  state.doc.descendants((node: any, pos: number) => {
    if (updated) return false;
    if (node.type?.name !== 'blockContainer' || node.attrs?.id !== blockId) return;
    const columnListNode = node.firstChild;
    if (!columnListNode || columnListNode.type?.name !== 'column_list') return false;
    tr = tr.setNodeMarkup(pos + 1, undefined, {
      ...columnListNode.attrs,
      columnRatios: ratios.join(','),
    });
    updated = true;
    return false;
  });

  if (updated) {
    pmView.dispatch(tr);
  }
  return updated;
}

export function updateColumnWidthRatios(editor: any, updates: Record<string, number>) {
  const pmView = editor?.prosemirrorView;
  if (!pmView) return false;

  const { state } = pmView;
  let tr = state.tr;
  let updated = false;

  state.doc.descendants((node: any, pos: number) => {
    if (node.type?.name !== 'blockContainer') return;
    const nextRatio = updates[node.attrs?.id];
    if (nextRatio === undefined) return;
    const columnNode = node.firstChild;
    if (!columnNode || columnNode.type?.name !== 'column') return false;
    tr = tr.setNodeMarkup(pos + 1, undefined, {
      ...columnNode.attrs,
      widthRatio: nextRatio,
    });
    updated = true;
  });

  if (updated) {
    pmView.dispatch(tr);
  }
  return updated;
}

function ColumnListComponent({ block, editor }: any) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlesContainerRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const resizingRef = useRef<{
    startX: number;
    startRatios: number[];
    colIndex: number;
    containerWidth: number;
  } | null>(null);

  const children = block.children || [];

  const childrenRef = useRef(children);
  childrenRef.current = children;

  // Compute a stable key from current ratios — only changes when actual widths change
  const ratioKey = children.map((c: any) => c.props?.widthRatio ?? '').join(',');

  // Inject CSS rules into document.head (outside ProseMirror's observer scope)
  // This avoids triggering ProseMirror's MutationObserver which causes infinite loops
  const injectColumnCSS = useCallback((ratios: number[]) => {
    const styleId = `col-style-${block.id}`;
    document.getElementById(styleId)?.remove();

    if (ratios.length === 0) return;

    const style = document.createElement('style');
    style.id = styleId;

    const gapShare = ratios.length > 1 ? ((ratios.length - 1) * COLUMN_GAP_PX) / ratios.length : 0;
    let css = `
/* Column list outer: take full width, don't shrink */
.bn-block-outer:has([data-column-list-id="${block.id}"]) {
  flex-shrink: 0 !important;
  width: 100% !important;
  min-width: 0 !important;
}
/* Inner flex layout for columns */
.bn-block:has([data-column-list-id="${block.id}"]) > .bn-block-group { display: flex !important; }`;

    ratios.forEach((ratio: number, i: number) => {
      css += `
.bn-block:has([data-column-list-id="${block.id}"]) > .bn-block-group > .bn-block-outer:nth-child(${i + 1}) {
  flex: 0 0 calc(${ratio}% - ${gapShare}px) !important;
  max-width: calc(${ratio}% - ${gapShare}px) !important;
}`;
    });

    style.textContent = css;
    document.head.appendChild(style);
  }, [block.id]);

  useEffect(() => {
    // Use columnRatios prop (authoritative source) instead of individual column props
    const ratiosStr = (block.props as any)?.columnRatios as string | undefined;
    if (ratiosStr) {
      const ratios = ratiosStr.split(',').map(Number);
      if (ratios.length === children.length) {
        injectColumnCSS(ratios);
      } else {
        // Mismatch: fall back to even distribution
        const evenRatio = Math.round(100 / children.length);
        const ratios = Array(children.length).fill(evenRatio);
        ratios[ratios.length - 1] = 100 - evenRatio * (children.length - 1);
        injectColumnCSS(ratios);
      }
    } else {
      // No columnRatios prop: compute evenly
      const evenRatio = Math.round(100 / children.length);
      const ratios = Array(children.length).fill(evenRatio);
      ratios[ratios.length - 1] = 100 - evenRatio * (children.length - 1);
      injectColumnCSS(ratios);
    }
    return () => document.getElementById(`col-style-${block.id}`)?.remove();
  }, [block.id, ratioKey, injectColumnCSS]);

  // MutationObserver: re-inject CSS when BN adds/removes column DOM elements
  // This catches cases where PageEditor's drag handler adds columns via editor.updateBlock
  // without going through our React addColumn (which calls injectColumnCSS directly).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const blockEl = container.closest('.bn-block');
    if (!blockEl) return;
    const blockGroup = blockEl.querySelector(':scope > .bn-block-group');
    if (!blockGroup) return;

    let lastChildCount = blockGroup.children.length;

    const observer = new MutationObserver(() => {
      const newCount = blockGroup.children.length;
      if (newCount !== lastChildCount) {
        lastChildCount = newCount;
        // Re-read ratios from column_list's columnRatios prop (authoritative source),
        // NOT from individual column widthRatio props (which may be stale after addColumn)
        const liveBlock = editor.getBlock(block.id);
        if (liveBlock) {
          const ratiosStr = liveBlock.props?.columnRatios as string | undefined;
          if (ratiosStr) {
            const ratios = ratiosStr.split(',').map(Number);
            if (ratios.length === newCount) {
              injectColumnCSS(ratios);
              return;
            }
          }
          // Fallback: compute evenly if columnRatios prop is missing/stale
          const childCount = liveBlock.children?.length || newCount;
          const evenRatio = Math.round(100 / childCount);
          const ratios = Array(childCount).fill(evenRatio);
          ratios[ratios.length - 1] = 100 - evenRatio * (childCount - 1);
          injectColumnCSS(ratios);
        }
      }
    });

    observer.observe(blockGroup, { childList: true });
    return () => observer.disconnect();
  }, [block.id, editor, injectColumnCSS]);

  // Position resize handles and add button via direct DOM manipulation on OUR elements
  const positionHandles = useCallback(() => {
    const container = handlesContainerRef.current;
    if (!container) return;
    const blockEl = container.closest('.bn-block');
    if (!blockEl) return;
    const blockGroup = blockEl.querySelector(':scope > .bn-block-group') as HTMLElement;
    if (!blockGroup) return;

    const outers = blockGroup.querySelectorAll(':scope > .bn-block-outer');
    const groupRect = blockGroup.getBoundingClientRect();

    // Position resize handles
    const handles = container.querySelectorAll<HTMLDivElement>(':scope > .col-layout-resize-handle');
    const isResizing = resizingRef.current !== null;
    const resizeColIndex = resizingRef.current?.colIndex ?? -1;
    handles.forEach((handle, i) => {
      if (i < outers.length - 1) {
        const rect = outers[i].getBoundingClientRect();
        handle.style.display = '';
        handle.style.position = 'fixed';
        handle.style.top = `${Math.round(groupRect.top)}px`;
        handle.style.left = `${Math.round(rect.right) - 5}px`;
        handle.style.width = '20px';
        handle.style.height = `${Math.round(groupRect.height)}px`;
        handle.style.zIndex = '100';
        handle.style.cursor = 'col-resize';
        handle.style.pointerEvents = 'auto';
        // Keep the resize line visible during active resize
        if (isResizing && i === resizeColIndex) {
          handle.classList.add('active');
        } else {
          handle.classList.remove('active');
        }
      } else {
        handle.style.display = 'none';
      }
    });

    // Position add button
    const btn = addBtnRef.current;
    if (btn && outers.length > 0 && childrenRef.current.length < MAX_COLUMNS) {
      const lastRect = outers[outers.length - 1].getBoundingClientRect();
      btn.style.display = '';
      btn.style.position = 'fixed';
      btn.style.top = `${Math.round(groupRect.top + groupRect.height / 2 - 10)}px`;
      btn.style.left = `${Math.round(lastRect.right + 4)}px`;
      btn.style.pointerEvents = 'auto';
    } else if (btn) {
      btn.style.display = 'none';
    }
  }, []);

  // Fix pointer-events on content block outers inside columns.
  // BlockNote's SideMenuPlugin sets inline pointer-events:none on block-outers at runtime,
  // which overrides CSS !important in some cases (likely timing-related DOM recreation).
  // This MutationObserver re-applies the correct value whenever BlockNote changes it.
  useEffect(() => {
    const fixPointerEvents = () => {
      const container = containerRef.current;
      if (!container || !container.isConnected) return;
      const blockEl = container.closest('.bn-block');
      if (!blockEl) return;
      const blockGroup = blockEl.querySelector(':scope > .bn-block-group');
      if (!blockGroup) return;

      const columnOuters = blockGroup.querySelectorAll(':scope > .bn-block-outer');
      columnOuters.forEach(colOuter => {
        const innerGroup = colOuter.querySelector(':scope > .bn-block > .bn-block-group');
        if (!innerGroup) return;
        const contentOuters = innerGroup.querySelectorAll(':scope > .bn-block-outer');
        contentOuters.forEach(contentOuter => {
          if ((contentOuter as HTMLElement).style.pointerEvents === 'none') {
            (contentOuter as HTMLElement).style.pointerEvents = 'auto';
          }
        });
      });
    };

    // Run immediately
    fixPointerEvents();

    // Re-run on DOM changes (BlockNote re-renders may re-set inline styles)
    const observer = new MutationObserver(fixPointerEvents);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });

    return () => observer.disconnect();
  }, [block.id]);

  // Position handles on mount, resize, and when column content changes
  useEffect(() => {
    // Initial position after a frame (CSS needs to be applied first)
    const rafId = requestAnimationFrame(positionHandles);

    const observer = new ResizeObserver(positionHandles);
    if (containerRef.current) {
      const blockEl = containerRef.current.closest('.bn-block');
      if (blockEl) observer.observe(blockEl);
    }

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [positionHandles, ratioKey]);

  // Watch BlockNote's dynamic block-selection-style to detect column selection.
  // When a column is selected, add class to block-group for CSS highlight.
  // (The CSS hides column block-outers' ::after with !important — pure CSS override.)
  // IMPORTANT: DOM lookups must be fresh each call (not captured in closure) because
  // React/ProseMirror may re-render and recreate DOM elements at any time.
  const updateSelection = useCallback(() => {
    const container = containerRef.current;
    if (!container || !container.isConnected) return;

    const blockId = container.getAttribute('data-column-list-id');
    if (!blockId) return;

    const blockEl = container.closest('.bn-block');
    if (!blockEl) return;
    const blockGroup = blockEl.querySelector(':scope > .bn-block-group') as HTMLElement;
    if (!blockGroup) return;

    const selStyleId = `col-sel-${blockId}`;

    const styleEl = document.getElementById('block-selection-style');
    if (!styleEl || !styleEl.textContent) {
      document.getElementById(selStyleId)?.remove();
      return;
    }

    const ids = [...styleEl.textContent.matchAll(/data-id="([^"]+)"/g)].map(m => m[1]);

    // Show group highlight ONLY when there are selected blocks both
    // INSIDE and OUTSIDE the column_list. If only outside blocks are selected
    // (normal box selection of root-level blocks), don't highlight the column.
    // If only inside blocks are selected, show individual highlights.
    let hasInsideSelected = false;
    let hasOutsideSelected = false;
    const columnListOuter = blockEl.closest('.bn-block-outer');
    if (columnListOuter) {
      // Check inside: column_list's descendant block-outers
      const innerOuters = columnListOuter.querySelectorAll('.bn-block-outer');
      innerOuters.forEach(inner => {
        const innerId = inner.getAttribute('data-id') || '';
        if (ids.includes(innerId)) {
          hasInsideSelected = true;
        }
      });

      // Check outside: siblings of column_list
      const parentGroup = columnListOuter.parentElement;
      if (parentGroup) {
        const siblingOuters = parentGroup.querySelectorAll(':scope > .bn-block-outer');
        siblingOuters.forEach((sibling) => {
          if (sibling !== columnListOuter && ids.includes(sibling.getAttribute('data-id') || '')) {
            hasOutsideSelected = true;
          }
        });
      }
    }
    const hasColumnSelected = hasInsideSelected && hasOutsideSelected;

    // Inject/remove selection style into document.head (avoids ProseMirror DOM reconciliation)
    // Only modify DOM when state actually changes to avoid MutationObserver infinite loop
    const existingStyle = document.getElementById(selStyleId);

    if (hasColumnSelected && !existingStyle) {
      const selStyle = document.createElement('style');
      selStyle.id = selStyleId;
      selStyle.textContent = `
.bn-block:has([data-column-list-id="${blockId}"]) > .bn-block-group::after {
  content: '' !important;
  position: absolute !important;
  inset: 2px !important;
  background: rgba(35, 131, 226, 0.14) !important;
  border-radius: 4px !important;
  pointer-events: none !important;
}
.bn-block:has([data-column-list-id="${blockId}"]) > .bn-block-group .bn-block-outer::after {
  content: none !important;
  background: none !important;
}`;
      document.head.appendChild(selStyle);
    } else if (!hasColumnSelected && existingStyle) {
      existingStyle.remove();
    }
  }, []);

  useEffect(() => {
    // Primary: listen for direct custom event from setBlockSelection — instant, no delay
    const onSelectionChange = () => updateSelection();
    document.addEventListener('block-selection-change', onSelectionChange);

    // Fallback: MutationObserver for cases where custom event isn't dispatched
    // (e.g. external code modifies block-selection-style directly)
    let lastUpdate = 0;
    const observer = new MutationObserver((mutations) => {
      const relevant = mutations.some(m => {
        if (m.type === 'childList') {
          return Array.from(m.addedNodes).some(n => (n as Element).id === 'block-selection-style') ||
                 Array.from(m.removedNodes).some(n => (n as Element).id === 'block-selection-style');
        }
        if (m.type === 'characterData') {
          let node = m.target;
          while (node.parentElement && node.parentElement !== document.head) node = node.parentElement;
          return (node.parentElement as Element)?.id === 'block-selection-style' ||
                 (node as Element)?.id === 'block-selection-style';
        }
        return false;
      });
      if (relevant) {
        const now = Date.now();
        if (now - lastUpdate > 50) {
          lastUpdate = now;
          updateSelection();
        }
      }
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });

    // Initial check
    updateSelection();

    return () => {
      document.removeEventListener('block-selection-change', onSelectionChange);
      observer.disconnect();
    };
  }, [block.id, updateSelection]);

  // Add a new column — new column gets 1/(n+1) of width, others keep their ratios
  // IMPORTANT: Do NOT call updateBlock on existing columns — it corrupts their structure.
  // Only insert the new column and let CSS handle the visual width.
  const addColumn = useCallback(() => {
    const liveBlock = editor.getBlock(block.id);
    if (!liveBlock?.children) return;
    const liveChildren = liveBlock.children as any[];
    const liveCount = liveChildren.length;

    const newCount = liveCount + 1;
    if (newCount > MAX_COLUMNS) return;

    // Calculate new ratios: scale existing columns proportionally to make room
    const newColumnWidth = Math.round(100 / newCount);
    const scaleFactor = (100 - newColumnWidth) / 100;
    const allRatios: number[] = [];
    let remaining = 100 - newColumnWidth;
    liveChildren.forEach((child: any, i: number) => {
      const oldRatio = child.props?.widthRatio || Math.round(100 / liveCount);
      const scaled = Math.max(MIN_RATIO, Math.round(oldRatio * scaleFactor));
      if (i < liveChildren.length - 1) {
        allRatios.push(scaled);
        remaining -= scaled;
      } else {
        allRatios.push(Math.max(MIN_RATIO, remaining));
      }
    });
    allRatios.push(newColumnWidth);

    // Step 1: Inject CSS with new ratios FIRST (so layout is ready before DOM change)
    injectColumnCSS(allRatios);

    // Step 2: Insert new empty column at the end — do NOT touch existing columns
    const lastColumn = liveChildren[liveChildren.length - 1];
    editor.insertBlocks([{
      type: 'column',
      props: { widthRatio: newColumnWidth },
      children: [{ type: 'paragraph' as const }],
    }], lastColumn, 'after');

    // Step 3: Update column_list props via PM transaction (updateBlock corrupts structure)
    updateColumnListRatios(editor, block.id, allRatios);
  }, [block.id, editor, injectColumnCSS]);

  // Delete a column — removed column's width is redistributed proportionally to remaining columns
  const deleteColumn = useCallback((colIndex: number) => {
    // Always use live BN API — React props (children/columnCount) may be stale
    const liveBlock = editor.getBlock(block.id);
    if (!liveBlock || !liveBlock.children) return;

    const liveChildren = liveBlock.children as any[];

    // Remove the specified column
    if (colIndex < 0 || colIndex >= liveChildren.length) return;
    const remainingColumns = liveChildren.filter((_: any, i: number) => i !== colIndex);

    // If 0 or 1 column would remain → dissolve column_list entirely
    if (remainingColumns.length <= 1) {
      const allContent: any[] = [];
      remainingColumns.forEach((col: any) => {
        if (col.children && col.children.length > 0) {
          allContent.push(...col.children.map((c: any) => ({
            type: c.type,
            props: c.props,
            content: c.content,
            children: c.children || [],
          })));
        }
      });
      // Insert content BEFORE removing column_list (so block.id is still valid)
      if (allContent.length > 0) {
        editor.insertBlocks(allContent, liveBlock, 'after');
      }
      editor.removeBlocks([liveBlock]);
      return;
    }

    // Multiple columns remain → redistribute width and remove target column
    const blockEl = containerRef.current?.closest('.bn-block');
    const blockGroup = blockEl?.querySelector(':scope > .bn-block-group') as HTMLElement | null;
    const containerWidth = blockGroup?.getBoundingClientRect().width ?? 0;
    const columnOuters = blockGroup
      ? Array.from(blockGroup.querySelectorAll(':scope > .bn-block-outer')) as HTMLElement[]
      : [];
    const visibleWidths = columnOuters.map((outer) => outer.getBoundingClientRect().width);
    const fallbackRatio = Math.round(100 / liveChildren.length);
    const currentRatios = typeof liveBlock.props?.columnRatios === 'string'
      ? (liveBlock.props.columnRatios as string).split(',').map(Number)
      : [];
    const sourceRatios = liveChildren.map((col: any, index: number) => {
      const liveWidthRatio = Number(col.props?.widthRatio);
      const ratio = currentRatios[index];
      return Number.isFinite(liveWidthRatio) && liveWidthRatio > 0
        ? liveWidthRatio
        : (Number.isFinite(ratio) && ratio > 0 ? ratio : fallbackRatio);
    });
    const ratios = visibleWidths.length === liveChildren.length
      ? redistributeColumnRatiosFromWidths(visibleWidths, [colIndex], containerWidth)
      : redistributeColumnRatios(sourceRatios, [colIndex], containerWidth);

    // Step 2: Inject CSS with new ratios BEFORE removing column (so layout is ready)
    injectColumnCSS(ratios);

    // Step 3: Remove the target column
    editor.removeBlocks([liveChildren[colIndex]]);

    // Step 4: Update column_list props via PM transaction (updateBlock corrupts structure)
    updateColumnListRatios(editor, block.id, ratios);
  }, [block.id, editor, injectColumnCSS]);

  // Resize handler
  const handleResizeStart = useCallback((colIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!containerRef.current) return;
    const blockEl = containerRef.current.closest('.bn-block');
    if (!blockEl) return;
    const blockGroup = blockEl.querySelector(':scope > .bn-block-group') as HTMLElement;
    if (!blockGroup) return;

    const ratios = childrenRef.current.map((child: any) =>
      child.props?.widthRatio || Math.round(100 / childrenRef.current.length)
    );
    resizingRef.current = {
      startX: e.clientX,
      startRatios: [...ratios],
      colIndex,
      containerWidth: blockGroup.getBoundingClientRect().width,
    };

    // Immediately add 'active' class to the dragged handle so the resize line stays visible
    const handlesContainer = handlesContainerRef.current;
    if (handlesContainer) {
      const allHandles = handlesContainer.querySelectorAll<HTMLDivElement>(':scope > .col-layout-resize-handle');
      allHandles.forEach((h, i) => {
        if (i === colIndex) h.classList.add('active');
        else h.classList.remove('active');
      });
    }

    const handleMove = (moveEvent: MouseEvent) => {
      if (!resizingRef.current) return;
      const { startX, startRatios, colIndex: ci, containerWidth } = resizingRef.current;
      const dx = moveEvent.clientX - startX;
      const deltaRatio = (dx / containerWidth) * 100;

      let newLeft = Math.round(startRatios[ci] + deltaRatio);
      let newRight = Math.round(startRatios[ci + 1] - deltaRatio);

      if (newLeft < MIN_RATIO) {
        newRight += (newLeft - MIN_RATIO);
        newLeft = MIN_RATIO;
      }
      if (newRight < MIN_RATIO) {
        newLeft += (newRight - MIN_RATIO);
        newRight = MIN_RATIO;
      }

      newLeft = Math.max(MIN_RATIO, newLeft);
      newRight = Math.max(MIN_RATIO, newRight);

      const leftChild = childrenRef.current[ci];
      const rightChild = childrenRef.current[ci + 1];
      const allRatios = startRatios.map((r: number, idx: number) => {
        if (idx === ci) return newLeft;
        if (idx === ci + 1) return newRight;
        return r;
      });
      // Use PM transaction to update column props (updateBlock corrupts structure)
      const updates: Record<string, number> = {};
      if (leftChild) updates[leftChild.id] = newLeft;
      if (rightChild) updates[rightChild.id] = newRight;
      updateColumnWidthRatios(editor, updates);
      updateColumnListRatios(editor, block.id, allRatios);

      // Directly update CSS for instant visual feedback (don't wait for React re-render)
      const styleEl = document.getElementById(`col-style-${block.id}`);
      if (styleEl) {
        const gs = allRatios.length > 1 ? ((allRatios.length - 1) * 52) / allRatios.length : 0;
        let css = `
.bn-block-outer:has([data-column-list-id="${block.id}"]) {
  flex-shrink: 0 !important;
  width: 100% !important;
  min-width: 0 !important;
}
.bn-block:has([data-column-list-id="${block.id}"]) > .bn-block-group { display: flex !important; }`;
        allRatios.forEach((ratio: number, i: number) => {
          css += `\n.bn-block:has([data-column-list-id="${block.id}"]) > .bn-block-group > .bn-block-outer:nth-child(${i + 1}) { flex: 0 0 calc(${ratio}% - ${gs}px) !important; max-width: calc(${ratio}% - ${gs}px) !important; }`;
        });
        styleEl.textContent = css;
      }

      // Synchronously reposition the resize handle to follow the column boundary
      // (don't wait for positionHandles via requestAnimationFrame which causes the handle to lag)
      const currentBlockEl = containerRef.current?.closest('.bn-block');
      if (currentBlockEl) {
        const currentBlockGroup = currentBlockEl.querySelector(':scope > .bn-block-group') as HTMLElement;
        if (currentBlockGroup && handlesContainerRef.current) {
          const outers = currentBlockGroup.querySelectorAll(':scope > .bn-block-outer');
          const groupRect = currentBlockGroup.getBoundingClientRect();
          const activeHandle = handlesContainerRef.current.querySelector<HTMLDivElement>(
            `:scope > .col-layout-resize-handle.active`
          );
          if (activeHandle && ci < outers.length) {
            const rect = outers[ci].getBoundingClientRect();
            activeHandle.style.position = 'fixed';
            activeHandle.style.top = `${Math.round(groupRect.top)}px`;
            activeHandle.style.left = `${Math.round(rect.right) - 5}px`;
            activeHandle.style.height = `${Math.round(groupRect.height)}px`;
          }
        }
      }
    };

    const handleUp = () => {
      resizingRef.current = null;
      // Remove 'active' class from all handles
      if (handlesContainer) {
        handlesContainer.querySelectorAll('.col-layout-resize-handle').forEach(h => {
          h.classList.remove('active');
        });
      }
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [editor]);

  // ─── Enter key in column: insert new paragraph below cursor ───
  // BN treats column blocks as atomic (content:"none"), so its default Enter
  // handler doesn't know about children and corrupts the structure.
  // We intercept Enter here and manually insert a new block into the column.
  const handleEnterInColumn = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return;

    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed) return;
    const anchor = sel.anchorNode;
    if (!anchor) return;

    // Use BN API to get current cursor position — this works regardless of DOM structure
    // Note: We cannot use DOM to detect if cursor is inside a column, because column blocks
    // have content:"none" and don't render [data-content-type="column"] elements.
    // Instead, we rely entirely on BN's block API to determine the nesting.
    let cursorPos;
    try {
      cursorPos = editor.getTextCursorPosition();
    } catch {
      return;
    }
    if (!cursorPos) return;

    const currentBlock = cursorPos.block;
    const currentBlockId = currentBlock.id;

    // Check if the current block's parent is a column or column_list
    // BN's getParentBlock may return column_list directly (since column is atomic with content:"none")
    const parentBlock = editor.getParentBlock(currentBlockId);
    if (!parentBlock) return;

    let columnBlockId: string | null = null;
    let liveColumn: any = null;

    if (parentBlock.type === 'column') {
      // Direct parent is a column block
      columnBlockId = parentBlock.id;
      liveColumn = editor.getBlock(columnBlockId);
    } else if (parentBlock.type === 'column_list') {
      // Parent is column_list — need to find which column child contains our block
      const columnList = editor.getBlock(parentBlock.id);
      if (!columnList?.children) return;
      for (const col of columnList.children) {
        const liveCol = editor.getBlock(col.id);
        if (liveCol?.children) {
          const found = liveCol.children.find((c: any) => c.id === currentBlockId);
          if (found) {
            columnBlockId = col.id;
            liveColumn = liveCol;
            break;
          }
        }
      }
      if (!columnBlockId || !liveColumn) return;
    } else {
      return; // Not inside a column
    }

    if (!liveColumn.children) return;

    // Find the index of the current content block in the column's children
    const blockIndex = liveColumn.children.findIndex((c: any) => c.id === currentBlockId);
    if (blockIndex < 0) return;

    e.preventDefault();
    e.stopPropagation();

    // Insert a new paragraph after the current block inside the column
    // Use insertBlocks instead of updateBlock (which corrupts column structure)
    const currentBlockInColumn = liveColumn.children[blockIndex];
    editor.insertBlocks([{ type: 'paragraph' as const }], currentBlockInColumn, 'after');

    // Move cursor to the newly inserted paragraph
    requestAnimationFrame(() => {
      try {
        const updatedColumn = editor.getBlock(columnBlockId);
        if (updatedColumn && updatedColumn.children) {
          const newBlock = (updatedColumn.children as any[])[blockIndex + 1];
          if (newBlock) {
            editor.setTextCursorPosition(newBlock.id, 'start');
          }
        }
      } catch {
        // ignore cursor errors
      }
    });
  }, [editor]);

  // ─── Backspace/Delete in column: prevent BN default and handle manually ───
  // Same problem as Enter: BN treats column blocks as atomic (content:"none"),
  // so its default Backspace handler doesn't know about children.
  const handleBackspaceInColumn = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;

    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed) return;
    const anchor = sel.anchorNode;
    if (!anchor) return;

    // Use BN API to determine cursor position (same approach as Enter handler)
    let cursorPos;
    try {
      cursorPos = editor.getTextCursorPosition();
    } catch {
      return;
    }
    if (!cursorPos) return;

    const currentBlock = cursorPos.block;
    const currentBlockId = currentBlock.id;

    // Check if cursor is at the very start of the block (for Backspace) or end (for Delete)
    // We only intercept when the cursor is at the boundary and the block is empty
    // For non-empty blocks or mid-content cursor, let BN handle it normally
    const parentBlock = editor.getParentBlock(currentBlockId);
    if (!parentBlock) return;

    let columnBlockId: string | null = null;
    let liveColumn: any = null;
    let columnListBlock: any = null;

    if (parentBlock.type === 'column') {
      columnBlockId = parentBlock.id;
      liveColumn = editor.getBlock(columnBlockId);
      columnListBlock = editor.getParentBlock(columnBlockId);
    } else if (parentBlock.type === 'column_list') {
      columnListBlock = editor.getBlock(parentBlock.id);
      if (!columnListBlock?.children) return;
      for (const col of columnListBlock.children) {
        const liveCol = editor.getBlock(col.id);
        if (liveCol?.children) {
          const found = liveCol.children.find((c: any) => c.id === currentBlockId);
          if (found) {
            columnBlockId = col.id;
            liveColumn = liveCol;
            break;
          }
        }
      }
      if (!columnBlockId || !liveColumn) return;
    } else {
      return;
    }

    if (!liveColumn.children) return;

    // Only intercept if the current block is an empty paragraph
    // Check if content is empty
    const content = currentBlock.content;
    const isEmpty = !content || (Array.isArray(content) && content.length === 0) ||
      (Array.isArray(content) && content.every((item: any) =>
        (typeof item === 'string' && item === '') ||
        (item.text === '') || (item.type === 'text' && item.text === '')
      ));
    if (!isEmpty) return;

    // Find the index of the current block in the column's children
    const blockIndex = liveColumn.children.findIndex((c: any) => c.id === currentBlockId);
    if (blockIndex < 0) return;

    e.preventDefault();
    e.stopPropagation();

    // Case 1: Column has only this one empty block → delete the entire column
    if (liveColumn.children.length <= 1) {
      // Find the column's index in column_list
      if (!columnListBlock) columnListBlock = editor.getParentBlock(columnBlockId!);
      if (!columnListBlock?.children) return;
      const colIndex = columnListBlock.children.findIndex((c: any) => c.id === columnBlockId);
      if (colIndex < 0) return;
      deleteColumn(colIndex);
      return;
    }

    // Case 2: Column has multiple blocks → remove just this empty block
    // Use removeBlocks instead of updateBlock (which corrupts column structure)
    const targetIndex = blockIndex > 0 ? blockIndex - 1 : 0;

    editor.removeBlocks([liveColumn.children[blockIndex]]);

    // Move cursor to the nearest remaining block
    requestAnimationFrame(() => {
      try {
        const updatedColumn = editor.getBlock(columnBlockId!);
        if (updatedColumn?.children && updatedColumn.children.length > 0) {
          const targetBlock = (updatedColumn.children as any[])[Math.min(targetIndex, updatedColumn.children.length - 1)];
          if (targetBlock) {
            editor.setTextCursorPosition(targetBlock.id, 'end');
          }
        }
      } catch {
        // ignore cursor errors
      }
    });
  }, [editor, deleteColumn]);

  useEffect(() => {
    document.addEventListener('keydown', handleBackspaceInColumn, true);
    document.addEventListener('keydown', handleEnterInColumn, true);
    return () => {
      document.removeEventListener('keydown', handleBackspaceInColumn, true);
      document.removeEventListener('keydown', handleEnterInColumn, true);
    };
  }, [handleBackspaceInColumn, handleEnterInColumn]);

  // Attach native mousedown listeners on resize handles (React's event delegation
  // conflicts with ProseMirror's capture-phase handlers, so native listeners are needed)
  useEffect(() => {
    const handlesContainer = handlesContainerRef.current;
    if (!handlesContainer) return;

    const listeners: Array<{ el: Element; fn: EventListener }> = [];

    handlesContainer.querySelectorAll('.col-layout-resize-handle').forEach((handle, i) => {
      const fn = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        handleResizeStart(i, e as MouseEvent);
      };
      handle.addEventListener('mousedown', fn, true);
      listeners.push({ el: handle, fn });
    });

    return () => {
      listeners.forEach(({ el, fn }) => el.removeEventListener('mousedown', fn, true));
    };
  }, [handleResizeStart]);

  return (
    <div ref={containerRef} className="column-list-inner" data-column-list-id={block.id}>
      {/* Resize handles container — handles positioned via ref DOM manipulation */}
      <div ref={handlesContainerRef} style={{ pointerEvents: 'none' }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="col-layout-resize-handle"
            style={{ display: 'none' }}
          >
            <div className="col-layout-resize-line" />
          </div>
        ))}
      </div>

      {/* Add column button */}
      <button
        ref={addBtnRef}
        className="column-add-button"
        style={{ display: 'none' }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          addColumn();
        }}
        title="添加一列"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export const ColumnListBlockSpec = createReactBlockSpec(
  { type: 'column_list', propSchema: { columnRatios: { default: '50,50' } }, content: 'none' },
  { render: ColumnListComponent, meta: { selectable: false } },
);
