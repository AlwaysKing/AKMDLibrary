import { useEffect, useState, useRef, useCallback, useLayoutEffect } from 'react';
import { Paintbrush, Eraser, Merge } from 'lucide-react';
import { ColorListContent } from './BlockNoteComponents';
import { mergeCells } from 'prosemirror-tables';

/**
 * TableCellMenu — renders a single blue border frame around selected table cells
 * and a notch button (always visible) on the right edge center of the frame.
 *
 * Architecture:
 * - The ProseMirror plugin (TableCellHighlight) adds `cell-active` / `cell-primary`
 *   classes to selected cells via Decoration.node().
 * - This component observes those classes and computes a bounding rectangle
 *   encompassing all `cell-active` cells → renders one blue frame overlay.
 * - A notch button is always rendered at the right edge center of the frame.
 * - Clicking the notch opens a context menu with color/clear options.
 */
export default function TableCellMenu({
  editorContainer,
}: {
  editorContainer: HTMLDivElement | null;
}) {
  // Selection border state
  const [selectionRect, setSelectionRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const selectionRectRef = useRef<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const notchRef = useRef<HTMLButtonElement | null>(null);

  // Menu state
  const [menuState, setMenuState] = useState<{
    cell: HTMLTableCellElement;
    tableId: string;
    rowIndex: number;
    cellIndex: number;
    x: number;
    y: number;
  } | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = !!menuState;
  const resizeTrackingRef = useRef(false);

  const applyOverlayRect = useCallback((rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null) => {
    selectionRectRef.current = rect;

    if (frameRef.current) {
      if (!rect) {
        frameRef.current.style.display = 'none';
      } else {
        frameRef.current.style.display = 'block';
        frameRef.current.style.left = `${rect.left}px`;
        frameRef.current.style.top = `${rect.top}px`;
        frameRef.current.style.width = `${rect.width}px`;
        frameRef.current.style.height = `${rect.height}px`;
      }
    }

    if (notchRef.current) {
      if (!rect) {
        notchRef.current.style.display = 'none';
      } else {
        notchRef.current.style.display = 'block';
        notchRef.current.style.left = `${rect.left + rect.width - 1}px`;
        notchRef.current.style.top = `${rect.top + rect.height / 2}px`;
      }
    }
  }, []);

  // ---- Editor access ----
  const getEditor = useCallback((): any => {
    if (!editorContainer) return null;
    const editorEl = editorContainer.querySelector('.bn-editor');
    if (!editorEl) return null;
    const fiberKey = Object.keys(editorEl).find(k => k.startsWith('__reactFiber'));
    if (!fiberKey) return null;
    let fiber = (editorEl as any)[fiberKey];
    while (fiber) {
      if (fiber.memoizedProps?.editor) return fiber.memoizedProps.editor;
      fiber = fiber.return;
    }
    return null;
  }, [editorContainer]);

  // ---- Track selection rect: single bounding frame around all cell-active cells ----
  useEffect(() => {
    if (!editorContainer) return;

    let scheduledFrame = 0;
    let dragFrame = 0;

    const updateRect = () => {
      const activeCells = editorContainer.querySelectorAll('td.cell-active, th.cell-active');
      if (activeCells.length === 0) {
        if (selectionRectRef.current) {
          applyOverlayRect(null);
          setSelectionRect(null);
        }
        return;
      }

      let minLeft = Infinity, minTop = Infinity;
      let maxRight = -Infinity, maxBottom = -Infinity;

      activeCells.forEach((cell) => {
        const rect = cell.getBoundingClientRect();
        minLeft = Math.min(minLeft, rect.left);
        minTop = Math.min(minTop, rect.top);
        maxRight = Math.max(maxRight, rect.right);
        maxBottom = Math.max(maxBottom, rect.bottom);
      });

      // Extend 1px outside cell boundaries to cover the gray border (matches old ::before inset: -1px)
      const nextRect = {
        left: minLeft - 1,
        top: minTop - 1,
        width: maxRight - minLeft + 2,
        height: maxBottom - minTop + 2,
      };

      const prev = selectionRectRef.current;
      if (
        prev &&
        Math.abs(prev.left - nextRect.left) < 0.5 &&
        Math.abs(prev.top - nextRect.top) < 0.5 &&
        Math.abs(prev.width - nextRect.width) < 0.5 &&
        Math.abs(prev.height - nextRect.height) < 0.5
      ) {
        return;
      }

      applyOverlayRect(nextRect);
      if (!prev) {
        setSelectionRect(nextRect);
      }
    };

    const scheduleRectUpdate = () => {
      cancelAnimationFrame(scheduledFrame);
      scheduledFrame = requestAnimationFrame(updateRect);
    };

    const stopResizeTracking = () => {
      resizeTrackingRef.current = false;
      cancelAnimationFrame(dragFrame);
      dragFrame = 0;
      scheduleRectUpdate();
    };

    const trackResizeFrame = () => {
      if (!resizeTrackingRef.current) return;
      updateRect();
      dragFrame = requestAnimationFrame(trackResizeFrame);
    };

    const syncResizeTracking = () => {
      const isDragging = !!editorContainer.querySelector('td.column-resize-dragging, th.column-resize-dragging');
      if (isDragging === resizeTrackingRef.current) {
        scheduleRectUpdate();
        return;
      }
      if (isDragging) {
        resizeTrackingRef.current = true;
        cancelAnimationFrame(dragFrame);
        dragFrame = requestAnimationFrame(trackResizeFrame);
      } else {
        stopResizeTracking();
      }
    };

    scheduleRectUpdate();

    // Watch for class changes on td elements (cell-active added/removed)
    const classObserver = new MutationObserver(syncResizeTracking);
    classObserver.observe(editorContainer, {
      attributes: true,
      subtree: true,
      attributeFilter: ['class'],
    });

    // Watch for style changes inside tables (column resize updates col/cell styles)
    const tableObserver = new MutationObserver(scheduleRectUpdate);
    editorContainer.querySelectorAll('[data-content-type="table"]').forEach(table => {
      tableObserver.observe(table, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['style'],
      });
    });

    window.addEventListener('scroll', scheduleRectUpdate, true);
    window.addEventListener('resize', scheduleRectUpdate);
    document.addEventListener('mouseup', stopResizeTracking, true);

    return () => {
      classObserver.disconnect();
      tableObserver.disconnect();
      cancelAnimationFrame(scheduledFrame);
      cancelAnimationFrame(dragFrame);
      window.removeEventListener('scroll', scheduleRectUpdate, true);
      window.removeEventListener('resize', scheduleRectUpdate);
      document.removeEventListener('mouseup', stopResizeTracking, true);
    };
  }, [editorContainer]);

  useLayoutEffect(() => {
    applyOverlayRect(selectionRect);
  }, [selectionRect, applyOverlayRect]);

  useLayoutEffect(() => {
    if (!selectionRectRef.current || !notchRef.current) return;
    const rect = selectionRectRef.current;
    notchRef.current.style.left = `${rect.left + rect.width - 1}px`;
    notchRef.current.style.top = `${rect.top + rect.height / 2}px`;
  }, [menuState]);

  // ---- Helper: collect all active cell coordinates (tableId, rowIndex, cellIndex) ----
  const getAllActiveCells = useCallback((): {
    tableId: string;
    rowIndex: number;
    cellIndex: number;
  }[] => {
    if (!editorContainer) return [];
    const activeCells = editorContainer.querySelectorAll('td.cell-active, th.cell-active');
    return Array.from(activeCells).map(cell => {
      const tableBlock = cell.closest('[data-id]');
      const tableId = tableBlock?.getAttribute('data-id') || '';
      const row = cell.closest('tr') as HTMLTableRowElement | null;
      const tableEl = cell.closest('[data-content-type="table"]');
      const allRows = tableEl ? Array.from(tableEl.querySelectorAll('tr')) as HTMLTableRowElement[] : [];
      const rowIndex = Array.from(allRows).indexOf(row);
      const cells = row ? Array.from(row.querySelectorAll('td, th')) as HTMLTableCellElement[] : [];
      const cellIndex = cells.indexOf(cell);
      return { tableId, rowIndex, cellIndex };
    }).filter(c => c.rowIndex >= 0 && c.cellIndex >= 0);
  }, [editorContainer]);

  // ---- Open menu from notch button ----
  const openMenu = useCallback(() => {
    const currentRect = selectionRectRef.current;
    if (!editorContainer || !currentRect) return;
    const activeCell = editorContainer.querySelector('td.cell-primary, th.cell-primary') as HTMLTableCellElement | null;
    if (!activeCell) return;

    const tableBlock = activeCell.closest('[data-id]');
    const tableId = tableBlock?.getAttribute('data-id') || '';
    const row = activeCell.closest('tr') as HTMLTableRowElement | null;
    const tableEl = activeCell.closest('[data-content-type="table"]');
    const allRows = tableEl ? Array.from(tableEl.querySelectorAll('tr')) as HTMLTableRowElement[] : [];
    const rowIndex = Array.from(allRows).indexOf(row);
    const cells = row ? Array.from(row.querySelectorAll('td, th')) as HTMLTableCellElement[] : [];
    const cellIndex = cells.indexOf(activeCell);

    // Position menu at the right edge center of the selection frame
    setMenuState({
      cell: activeCell,
      tableId,
      rowIndex,
      cellIndex,
      x: currentRect.left + currentRect.width + 4,
      y: currentRect.top + currentRect.height / 2,
    });
    setColorOpen(false);
  }, [editorContainer]);

  // ---- Click outside to close ----
  useEffect(() => {
    if (!menuState) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.tcm-menu') && !(e.target as HTMLElement).closest('.tcm-notch-btn')) {
        setMenuState(null);
        setColorOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuState]);

  // ---- Escape to close ----
  useEffect(() => {
    if (!menuState) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (colorOpen) {
          setColorOpen(false);
        } else {
          setMenuState(null);
        }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [menuState, colorOpen]);

  // ---- ProseMirror helper: find cell position in doc ----
  const findCellPos = useCallback((
    doc: any,
    tableId: string,
    rowIndex: number,
    cellIndex: number,
  ): { pos: number; node: any } | null => {
    let blockOffset = -1;
    doc.descendants((node: any, pos: number) => {
      if (blockOffset !== -1) return false;
      if (node.type.name === 'blockContainer' && node.attrs.id === tableId) {
        blockOffset = pos;
        return false;
      }
    });
    if (blockOffset === -1) return null;

    const blockNode = doc.nodeAt(blockOffset);
    if (!blockNode) return null;

    let tableNode: any = null;
    let tableChildIdx = 0;
    for (let i = 0; i < blockNode.childCount; i++) {
      const child = blockNode.child(i);
      if (child.type.name === 'table') {
        tableNode = child;
        tableChildIdx = i;
        break;
      }
    }
    if (!tableNode) return null;

    if (rowIndex >= tableNode.childCount) return null;
    const targetRow = tableNode.child(rowIndex);
    if (cellIndex >= targetRow.childCount) return null;
    const targetCell = targetRow.child(cellIndex);

    let pos = blockOffset + 1;
    for (let i = 0; i < tableChildIdx; i++) {
      pos += blockNode.child(i).nodeSize;
    }
    pos += 1;
    for (let r = 0; r < rowIndex; r++) {
      pos += tableNode.child(r).nodeSize;
    }
    pos += 1;
    for (let c = 0; c < cellIndex; c++) {
      pos += targetRow.child(c).nodeSize;
    }

    return { pos, node: targetCell };
  }, []);

  // ---- Actions ----
  const mergeSelectedCells = useCallback(() => {
    const editor = getEditor();
    if (!editor || !menuState) return;

    const view = editor._tiptapEditor.view;
    const state = view.state;
    mergeCells(state, view.dispatch.bind(view));
    setMenuState(null);
    setColorOpen(false);
  }, [getEditor, menuState]);

  const clearCell = useCallback(() => {
    const editor = getEditor();
    if (!editor || !menuState) return;

    const allCells = getAllActiveCells();
    if (allCells.length === 0) return;

    editor.transact((tr: any) => {
      // Process cells in reverse order to avoid position shifts
      const positions: { pos: number; node: any }[] = [];
      const state = editor._tiptapEditor.state;
      for (const cell of allCells) {
        const found = findCellPos(state.doc, cell.tableId, cell.rowIndex, cell.cellIndex);
        if (found) positions.push(found);
      }
      positions.sort((a, b) => b.pos - a.pos);

      for (const found of positions) {
        // Clear content
        const from = found.pos + 1;
        const to = found.pos + found.node.nodeSize - 1;
        const emptyParagraph = tr.doc.type.schema.nodes.tableParagraph.create();
        tr.replaceWith(from, to, emptyParagraph);
        // Clear all style attributes
        const resetAttrs = { ...found.node.attrs, textColor: 'default', backgroundColor: 'default' };
        tr.setNodeMarkup(found.pos, undefined, resetAttrs);
      }
      // Do NOT set selection — preserve the CellSelection
    });

    setMenuState(null);
    setColorOpen(false);
  }, [getEditor, menuState, findCellPos, getAllActiveCells]);

  const getCurrentCellColors = useCallback((): { textColor: string; bgColor: string } => {
    const defaults = { textColor: 'default', bgColor: 'default' };
    if (!menuState) return defaults;
    const editor = getEditor();
    if (!editor) return defaults;

    const state = editor._tiptapEditor.state;
    const found = findCellPos(state.doc, menuState.tableId, menuState.rowIndex, menuState.cellIndex);
    if (!found) return defaults;

    return {
      textColor: found.node.attrs.textColor || 'default',
      bgColor: found.node.attrs.backgroundColor || 'default',
    };
  }, [getEditor, menuState, findCellPos]);

  const setCellColorProp = useCallback((propName: string, colorKey: string) => {
    const editor = getEditor();
    if (!editor || !menuState) return;

    const allCells = getAllActiveCells();
    if (allCells.length === 0) return;

    editor.transact((tr: any) => {
      const positions: { pos: number; node: any }[] = [];
      const state = editor._tiptapEditor.state;
      for (const cell of allCells) {
        const found = findCellPos(state.doc, cell.tableId, cell.rowIndex, cell.cellIndex);
        if (found) positions.push(found);
      }
      // Reverse order so earlier positions stay valid
      positions.sort((a, b) => b.pos - a.pos);

      for (const found of positions) {
        const newAttrs = { ...found.node.attrs, [propName]: colorKey };
        tr.setNodeMarkup(found.pos, undefined, newAttrs);
      }
      // Do NOT set selection — preserve the CellSelection
    });

    setMenuState(null);
    setColorOpen(false);
  }, [getEditor, menuState, findCellPos, getAllActiveCells]);

  // ---- Render ----
  return (
    <>
      {/* Selection border overlay — single blue frame around all active cells */}
      {selectionRect && (
        <div
          ref={frameRef}
          className="cell-selection-frame"
          style={{
            position: 'fixed',
            left: selectionRect.left,
            top: selectionRect.top,
            width: selectionRect.width,
            height: selectionRect.height,
            border: '2px solid rgb(35, 131, 226)',
            borderRadius: '2px',
            pointerEvents: 'none',
            zIndex: 30,
          }}
        />
      )}

      {/* Notch button — keep visible while its menu is open */}
      {selectionRect && (
        <button
          ref={notchRef}
          className={`tcm-notch-btn${menuState ? ' is-active' : ''}`}
          style={{
            position: 'fixed',
            left: selectionRect.left + selectionRect.width - 1,
            top: selectionRect.top + selectionRect.height / 2,
            width: menuState ? 12 : 6,
            height: menuState ? 16 : 12,
            zIndex: 30,
            transform: 'translate(-50%, -50%)',
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            openMenu();
          }}
        />
      )}

      {/* Cell context menu */}
      {menuState && (
        <div
          className="tcm-menu"
          style={{
            position: 'fixed',
            left: menuState.x,
            top: menuState.y - 32,
            zIndex: 30,
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Color item — hover to show submenu */}
          <div
            className="tcm-menu-item"
            style={{ position: 'relative' }}
            onMouseEnter={() => setColorOpen(true)}
            onMouseLeave={() => setColorOpen(false)}
          >
            <button className="tcm-menu-item-btn">
              <Paintbrush size={15} />
              <span>颜色</span>
              <svg width="12" height="12" viewBox="0 0 12 12" style={{ marginLeft: 'auto' }}>
                <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </button>

            {/* Color submenu */}
            {colorOpen && (() => {
              const { textColor, bgColor } = getCurrentCellColors();
              return (
                <div className="drag-handle-submenu color-submenu">
                  <ColorListContent
                    currentTextColor={textColor}
                    currentBgColor={bgColor}
                    onTextColor={(c) => setCellColorProp('textColor', c)}
                    onBgColor={(c) => setCellColorProp('backgroundColor', c)}
                  />
                </div>
              );
            })()}
          </div>

          {/* Merge cells item — only for multi-cell selection */}
          {getAllActiveCells().length > 1 && (
            <button
              className="tcm-menu-item-btn"
              onClick={mergeSelectedCells}
            >
              <Merge size={15} />
              <span>合并单元格</span>
            </button>
          )}

          {/* Clear content item */}
          <button
            className="tcm-menu-item-btn tcm-danger"
            onClick={clearCell}
          >
            <Eraser size={15} />
            <span>清除内容</span>
          </button>
        </div>
      )}
    </>
  );
}
