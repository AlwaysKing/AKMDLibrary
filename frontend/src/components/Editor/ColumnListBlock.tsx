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
  const columnCount = children.length;

  const childrenRef = useRef(children);
  childrenRef.current = children;

  // Compute a stable key from current ratios — only changes when actual widths change
  const ratioKey = children.map((c: any) => c.props?.widthRatio ?? '').join(',');

  // Inject CSS rules into document.head (outside ProseMirror's observer scope)
  // This avoids triggering ProseMirror's MutationObserver which causes infinite loops
  useEffect(() => {
    const styleId = `col-style-${block.id}`;

    // Remove previous style
    document.getElementById(styleId)?.remove();

    const ratios = children.map((child: any) =>
      child.props?.widthRatio || Math.round(100 / children.length)
    );

    if (ratios.length === 0) return;

    const style = document.createElement('style');
    style.id = styleId;

    const gapShare = ratios.length > 1 ? ((ratios.length - 1) * 52) / ratios.length : 0;
    let css = `.bn-block:has([data-column-list-id="${block.id}"]) > .bn-block-group { display: flex !important; }`;

    ratios.forEach((ratio: number, i: number) => {
      css += `
.bn-block:has([data-column-list-id="${block.id}"]) > .bn-block-group > .bn-block-outer:nth-child(${i + 1}) {
  flex: 0 0 calc(${ratio}% - ${gapShare}px) !important;
  max-width: calc(${ratio}% - ${gapShare}px) !important;
}`;
    });

    style.textContent = css;
    document.head.appendChild(style);

    return () => document.getElementById(styleId)?.remove();
  }, [block.id, ratioKey]);

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

    // Like toggle heading: show group highlight ONLY when there are selected blocks
    // OUTSIDE the column_list (sibling blocks). If all selection is inside the layout,
    // show individual highlights on those blocks.
    let hasColumnSelected = false;
    const columnListOuter = blockEl.closest('.bn-block-outer');
    if (columnListOuter) {
      const parentGroup = columnListOuter.parentElement;
      if (parentGroup) {
        const siblingOuters = parentGroup.querySelectorAll(':scope > .bn-block-outer');
        siblingOuters.forEach((sibling) => {
          if (sibling !== columnListOuter && ids.includes(sibling.getAttribute('data-id') || '')) {
            hasColumnSelected = true;
          }
        });
      }
    }

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
    let lastUpdate = 0;
    const observer = new MutationObserver((mutations) => {
      // Only react to changes on block-selection-style, not our own col-sel- styles
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
        // Debounce to avoid rapid successive calls
        const now = Date.now();
        if (now - lastUpdate > 50) {
          lastUpdate = now;
          updateSelection();
        }
      }
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    updateSelection();

    // Periodic re-check ensures class is re-applied after React re-renders
    const intervalId = setInterval(updateSelection, 500);

    return () => {
      observer.disconnect();
      clearInterval(intervalId);
    };
  }, [block.id, updateSelection]);

  // Add a new column
  const addColumn = useCallback(() => {
    const newCount = columnCount + 1;
    const equalRatio = Math.round(100 / newCount);

    children.forEach((child: any) => {
      editor.updateBlock(child.id, {
        type: 'column',
        props: { widthRatio: equalRatio },
      } as any);
    });

    editor.insertBlocks(
      [{
        type: 'column',
        props: { widthRatio: equalRatio },
        children: [{ type: 'paragraph' }],
      }],
      block.id,
      'childLast',
    );
  }, [block.id, children, columnCount, editor]);

  // Delete a column
  const deleteColumn = useCallback((colIndex: number) => {
    if (columnCount <= 1) {
      const allContent: any[] = [];
      children.forEach((child: any) => {
        if (child.children && child.children.length > 0) {
          allContent.push(...child.children);
        }
      });
      editor.removeBlocks([block]);
      if (allContent.length > 0) {
        editor.insertBlocks(allContent, block.id, 'after');
      }
      return;
    }

    const childToRemove = children[colIndex];
    if (!childToRemove) return;
    editor.removeBlocks([childToRemove]);

    const newCount = columnCount - 1;
    const equalRatio = Math.round(100 / newCount);
    setTimeout(() => {
      const updatedBlock = editor.document.find((b: any) => b.id === block.id);
      if (updatedBlock) {
        (updatedBlock.children || []).forEach((child: any) => {
          editor.updateBlock(child.id, {
            type: 'column',
            props: { widthRatio: equalRatio },
          } as any);
        });
      }
    }, 0);
  }, [block, children, columnCount, editor]);

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
      if (leftChild) {
        editor.updateBlock(leftChild.id, { type: 'column', props: { widthRatio: newLeft } } as any);
      }
      if (rightChild) {
        editor.updateBlock(rightChild.id, { type: 'column', props: { widthRatio: newRight } } as any);
      }

      // Directly update CSS for instant visual feedback (don't wait for React re-render)
      const styleEl = document.getElementById(`col-style-${block.id}`);
      if (styleEl) {
        const allRatios = startRatios.map((r: number, idx: number) => {
          if (idx === ci) return newLeft;
          if (idx === ci + 1) return newRight;
          return r;
        });
        const gs = allRatios.length > 1 ? ((allRatios.length - 1) * 52) / allRatios.length : 0;
        let css = `.bn-block:has([data-column-list-id="${block.id}"]) > .bn-block-group { display: flex !important; }`;
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

  // Backspace on empty last paragraph in a column → delete that column
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed) return;
      const anchor = sel.anchorNode;
      if (!anchor) return;

      const element = anchor instanceof Text ? anchor.parentElement : anchor as HTMLElement;
      if (!element) return;

      const columnContent = element.closest('[data-content-type="column"]');
      if (!columnContent) return;

      const columnBnBlock = columnContent.closest('.bn-block');
      if (!columnBnBlock) return;

      const blockGroup = columnBnBlock.querySelector(':scope > .bn-block-group');
      if (!blockGroup) return;

      const childOuters = blockGroup.querySelectorAll(':scope > .bn-block-outer');
      if (childOuters.length !== 1) return;

      const onlyChild = childOuters[0];
      const paragraph = onlyChild.querySelector('[data-content-type="paragraph"]');
      if (!paragraph) return;
      const inlineContent = paragraph.querySelector('.bn-inline-content');
      if (!inlineContent) return;

      const text = inlineContent.textContent || '';
      if (text.trim() !== '') return;

      const columnOuter = columnBnBlock.closest('.bn-block-outer');
      if (!columnOuter) return;
      const siblings = Array.from(columnOuter.parentElement?.children || []);
      const colIndex = siblings.indexOf(columnOuter);
      if (colIndex < 0) return;

      e.preventDefault();
      deleteColumn(colIndex);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [deleteColumn]);

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
