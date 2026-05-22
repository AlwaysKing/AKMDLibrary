import { useEffect, useState, useRef, useCallback } from 'react';
import { Paintbrush, Eraser } from 'lucide-react';
import { Selection } from 'prosemirror-state';
import { ColorListContent } from './BlockNoteComponents';

/**
 * TableCellMenu — handles the notch hover detection and cell context menu.
 *
 * When a cell is active (.cell-active), a CSS ::after pseudo-element shows
 * a small blue notch on the right edge of the blue border. This component:
 * 1. Detects when the mouse is precisely over the notch area
 * 2. Renders an expanded button overlay (three white dots) at the notch position
 * 3. Adds .notch-hovering class to editorContainer to hide the CSS notch while overlay is shown
 * 4. Opens a cell menu on click with "颜色" and "清除内容" options
 *
 * NOTE: We cannot modify the TD element's attributes/classes because ProseMirror's
 * Decoration system continuously resets them. Instead, we use a React-rendered
 * overlay button positioned at the notch location.
 */
export default function TableCellMenu({
  editorContainer,
}: {
  editorContainer: HTMLDivElement | null;
}) {
  // Notch hover state — position of the active cell for overlay rendering
  const [notchHover, setNotchHover] = useState<{
    cell: HTMLTableCellElement;
    x: number;
    y: number;
  } | null>(null);

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

  // Track which TD is hovered (ref for event handlers)
  const hoveredTdRef = useRef<HTMLTableCellElement | null>(null);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = !!menuState;

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

  // ---- Compute notch hit area ----
  const getNotchHitArea = useCallback((td: HTMLTableCellElement) => {
    const rect = td.getBoundingClientRect();
    const cx = rect.right;
    const cy = rect.top + rect.height / 2;
    return {
      left: cx - 8,
      right: cx + 8,
      top: cy - 12,
      bottom: cy + 12,
    };
  }, []);

  // ---- Mouse move handler: detect notch hover ----
  useEffect(() => {
    if (!editorContainer) return;

    const onMove = (e: MouseEvent) => {
      // Don't change hover while menu is open
      if (menuOpenRef.current) return;

      const activeCell = editorContainer.querySelector('td.cell-active') as HTMLTableCellElement | null;
      if (!activeCell) {
        if (hoveredTdRef.current) {
          hoveredTdRef.current = null;
          editorContainer.classList.remove('notch-hovering');
          setNotchHover(null);
        }
        return;
      }

      const hit = getNotchHitArea(activeCell);
      const mx = e.clientX;
      const my = e.clientY;

      if (mx >= hit.left && mx <= hit.right && my >= hit.top && my <= hit.bottom) {
        if (hoveredTdRef.current !== activeCell) {
          hoveredTdRef.current = activeCell;
          editorContainer.classList.add('notch-hovering');
          const rect = activeCell.getBoundingClientRect();
          setNotchHover({
            cell: activeCell,
            x: rect.right,
            y: rect.top + rect.height / 2,
          });
        } else {
          // Same cell, but position might have changed (scroll)
          const rect = activeCell.getBoundingClientRect();
          setNotchHover(prev => {
            if (!prev) return null;
            const nx = rect.right;
            const ny = rect.top + rect.height / 2;
            if (Math.abs(prev.x - nx) < 1 && Math.abs(prev.y - ny) < 1) return prev;
            return { ...prev, x: nx, y: ny };
          });
        }
      } else {
        if (hoveredTdRef.current) {
          hoveredTdRef.current = null;
          editorContainer.classList.remove('notch-hovering');
          setNotchHover(null);
        }
      }
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      hoveredTdRef.current = null;
      editorContainer.classList.remove('notch-hovering');
    };
  }, [editorContainer, getNotchHitArea]);

  // ---- Click handler: detect notch click ----
  useEffect(() => {
    if (!editorContainer) return;

    const onClick = (e: MouseEvent) => {
      const activeCell = editorContainer.querySelector('td.cell-active') as HTMLTableCellElement | null;
      if (!activeCell) return;

      const hit = getNotchHitArea(activeCell);
      const mx = e.clientX;
      const my = e.clientY;

      if (mx >= hit.left && mx <= hit.right && my >= hit.top && my <= hit.bottom) {
        e.preventDefault();
        e.stopPropagation();

        const tableBlock = activeCell.closest('[data-id]');
        const tableId = tableBlock?.getAttribute('data-id') || '';
        const row = activeCell.closest('tr');
        const tableEl = activeCell.closest('[data-content-type="table"]');
        const allRows = tableEl ? tableEl.querySelectorAll('tr') : [];
        const rowIndex = Array.from(allRows).indexOf(row);
        const cells = row ? Array.from(row.querySelectorAll('td')) : [];
        const cellIndex = cells.indexOf(activeCell);

        const cellRect = activeCell.getBoundingClientRect();
        setMenuState({
          cell: activeCell,
          tableId,
          rowIndex,
          cellIndex,
          x: cellRect.right + 4,
          y: cellRect.top + cellRect.height / 2,
        });
        setColorOpen(false);
        // Close notch hover when menu opens
        setNotchHover(null);
      }
    };

    editorContainer.addEventListener('click', onClick, true);
    return () => editorContainer.removeEventListener('click', onClick, true);
  }, [editorContainer, getNotchHitArea]);

  // ---- Click outside to close ----
  useEffect(() => {
    if (!menuState) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.tcm-menu')) {
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
    // Find the blockContainer with the matching id
    // Doc structure: doc > blockGroup > blockContainer[id] > table > tableRow > tableCell
    let blockOffset = -1;
    doc.descendants((node: any, pos: number) => {
      if (blockOffset !== -1) return false; // Already found
      if (node.type.name === 'blockContainer' && node.attrs.id === tableId) {
        blockOffset = pos;
        return false; // Stop descending this branch
      }
    });
    if (blockOffset === -1) return null;

    const blockNode = doc.nodeAt(blockOffset);
    if (!blockNode) return null;

    // Find the table content node (first child of blockContainer)
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

    // Calculate absolute position of the cell in the document
    let pos = blockOffset + 1; // Enter blockContainer
    for (let i = 0; i < tableChildIdx; i++) {
      pos += blockNode.child(i).nodeSize;
    }
    pos += 1; // Enter table
    for (let r = 0; r < rowIndex; r++) {
      pos += tableNode.child(r).nodeSize;
    }
    pos += 1; // Enter row
    for (let c = 0; c < cellIndex; c++) {
      pos += targetRow.child(c).nodeSize;
    }

    return { pos, node: targetCell };
  }, []);

  // ---- Actions ----
  const clearCell = useCallback(() => {
    const editor = getEditor();
    if (!editor || !menuState) return;

    const state = editor._tiptapEditor.state;
    const found = findCellPos(state.doc, menuState.tableId, menuState.rowIndex, menuState.cellIndex);
    if (!found) return;

    // Replace cell content with an empty tableParagraph, preserving the cell node itself
    const from = found.pos + 1; // Enter cell content
    const to = found.pos + found.node.nodeSize - 1; // Exit cell content
    const emptyParagraph = state.schema.nodes.tableParagraph.create();

    // Use editor.transact to stay within BlockNote's transaction system
    // so onChange fires and changes are saved.
    // Also restore selection into the cell since editor may have lost focus
    // during menu interaction (mousedown on submenu → blur → selection moves out).
    editor.transact((tr: any) => {
      tr.replaceWith(from, to, emptyParagraph);
      const $cellPos = tr.doc.resolve(from + 1);
      tr.setSelection(Selection.near($cellPos));
    });

    setMenuState(null);
    setColorOpen(false);
  }, [getEditor, menuState, findCellPos]);

  // Get current cell colors — read directly from ProseMirror node attrs
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

    const state = editor._tiptapEditor.state;
    const found = findCellPos(state.doc, menuState.tableId, menuState.rowIndex, menuState.cellIndex);
    if (!found) return;

    // Update only this cell's attributes without replacing the table
    const newAttrs = { ...found.node.attrs, [propName]: colorKey };

    // Use editor.transact to stay within BlockNote's transaction system
    // so onChange fires and changes are saved.
    // When the user clicks a color in the submenu, the editor loses focus (mousedown → blur)
    // and TipTap moves the selection outside the table cell.
    // We must explicitly restore the selection into the cell to preserve cell-active.
    editor.transact((tr: any) => {
      tr.setNodeMarkup(found.pos, undefined, newAttrs);
      // Resolve a position inside the cell's content in the NEW document
      const cellContentStart = found.pos + 1; // Past cell opening
      const $cellPos = tr.doc.resolve(cellContentStart + 1); // +1 past tableParagraph opening
      tr.setSelection(Selection.near($cellPos));
    });

    setMenuState(null);
    setColorOpen(false);
  }, [getEditor, menuState, findCellPos]);

  // ---- Render ----
  return (
    <>
      {/* Notch hover overlay button — replaces the CSS ::after notch when hovered */}
      {notchHover && !menuState && (
        <button
          className="tcm-notch-btn"
          style={{
            position: 'fixed',
            left: notchHover.x - 6,
            top: notchHover.y - 8,
            width: 12,
            height: 16,
            zIndex: 1000,
          }}
          onClick={(e) => {
            e.stopPropagation();
            const activeCell = editorContainer?.querySelector('td.cell-active') as HTMLTableCellElement | null;
            if (!activeCell) return;

            const tableBlock = activeCell.closest('[data-id]');
            const tableId = tableBlock?.getAttribute('data-id') || '';
            const row = activeCell.closest('tr');
            const tableEl = activeCell.closest('[data-content-type="table"]');
            const allRows = tableEl ? tableEl.querySelectorAll('tr') : [];
            const rowIndex = Array.from(allRows).indexOf(row);
            const cells = row ? Array.from(row.querySelectorAll('td')) : [];
            const cellIndex = cells.indexOf(activeCell);

            const cellRect = activeCell.getBoundingClientRect();
            setMenuState({
              cell: activeCell,
              tableId,
              rowIndex,
              cellIndex,
              x: cellRect.right + 4,
              y: cellRect.top + cellRect.height / 2,
            });
            setColorOpen(false);
            setNotchHover(null);
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
            zIndex: 1000,
          }}
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

            {/* Color submenu — reuses ColorListContent from drag handle menu */}
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
