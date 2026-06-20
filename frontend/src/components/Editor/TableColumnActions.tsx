import { useEffect, useState, useRef, useCallback } from 'react';
import { Paintbrush, Eraser } from 'lucide-react';
import { COLORS, COLOR_NAMES, findBlockDeep } from './BlockNoteComponents';

interface ColInfo {
  tableId: string;
  colIndex: number;
  rightX: number;
  topY: number;
  bottomY: number;
  // Active cell position (for indicator placement)
  activeCellTopY: number | null;
  activeCellBottomY: number | null;
}

export default function TableColumnActions({
  editorContainer,
}: {
  editorContainer: HTMLDivElement | null;
}) {
  // Column positions
  const [cols, setCols] = useState<ColInfo[]>([]);
  // Currently hovered column (tableId:colIndex)
  const [hoveredCol, setHoveredCol] = useState<string | null>(null);
  // Currently open menu column
  const [openCol, setOpenCol] = useState<string | null>(null);
  // Color submenu open
  const [colorOpen, setColorOpen] = useState(false);
  // Active column (the column containing the selected/active cell)
  const [activeCol, setActiveCol] = useState<string | null>(null);

  // Refs for hover coordination
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const mousePos = useRef({ x: 0, y: 0 });

  // Generate a unique key for a column
  const colKey = (tableId: string, colIndex: number) => `${tableId}:${colIndex}`;

  // ---- Scan: find tables and their column boundaries ----
  const scan = useCallback(() => {
    if (!editorContainer) return;

    const tableEls = editorContainer.querySelectorAll('[data-content-type="table"]');
    const newCols: ColInfo[] = [];
    let newActiveCol: string | null = null;

    tableEls.forEach((tableBlock) => {
      const tableId = tableBlock.closest('[data-id]')?.getAttribute('data-id') || '';
      const table = tableBlock.querySelector('table');
      if (!table) return;

      const rows = table.querySelectorAll('tr');
      if (rows.length === 0) return;

      // Get column count from first row
      const firstRowCells = rows[0].querySelectorAll('td');
      const colCount = firstRowCells.length;
      const containerRect = editorContainer.getBoundingClientRect();

      // Detect active cell (cell-active class from ProseMirror decoration)
      const activeCell = table.querySelector('td.cell-active') as HTMLElement | null;
      let activeCellTopY: number | null = null;
      let activeCellBottomY: number | null = null;
      if (activeCell) {
        const activeRow = activeCell.closest('tr');
        if (activeRow) {
          const rowCells = activeRow.querySelectorAll('td');
          const activeIdx = Array.from(rowCells).indexOf(activeCell as HTMLTableCellElement);
          if (activeIdx >= 0 && activeIdx < colCount - 1) {
            newActiveCol = colKey(tableId, activeIdx);
          } else if (activeIdx === colCount - 1) {
            if (activeIdx > 0) {
              newActiveCol = colKey(tableId, activeIdx - 1);
            }
          }
          // Record active cell's vertical position for indicator placement
          const activeRect = activeCell.getBoundingClientRect();
          activeCellTopY = activeRect.top - containerRect.top;
          activeCellBottomY = activeRect.bottom - containerRect.top;
        }
      }

      // For each column (except the last — no boundary after last col),
      // calculate the right edge position
      for (let colIdx = 0; colIdx < colCount - 1; colIdx++) {
        let topY = Infinity;
        let bottomY = -Infinity;
        let rightX = 0;

        for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
          const cells = rows[rowIdx].querySelectorAll('td');
          if (cells[colIdx]) {
            const rect = cells[colIdx].getBoundingClientRect();
            rightX = rect.right - containerRect.left;
            if (rect.top - containerRect.top < topY) {
              topY = rect.top - containerRect.top;
            }
            if (rect.bottom - containerRect.top > bottomY) {
              bottomY = rect.bottom - containerRect.top;
            }
          }
        }

        newCols.push({
          tableId,
          colIndex: colIdx,
          rightX,
          topY,
          bottomY,
          activeCellTopY: activeCell ? activeCellTopY : null,
          activeCellBottomY: activeCell ? activeCellBottomY : null,
        });
      }
    });

    setCols((prev) => {
      if (prev.length !== newCols.length) return newCols;
      for (let i = 0; i < prev.length; i++) {
        if (
          prev[i].tableId !== newCols[i].tableId ||
          prev[i].colIndex !== newCols[i].colIndex ||
          Math.abs(prev[i].rightX - newCols[i].rightX) > 1 ||
          Math.abs(prev[i].topY - newCols[i].topY) > 1 ||
          prev[i].activeCellTopY !== newCols[i].activeCellTopY ||
          prev[i].activeCellBottomY !== newCols[i].activeCellBottomY
        ) {
          return newCols;
        }
      }
      return prev;
    });
    setActiveCol(newActiveCol);
  }, [editorContainer]);

  // ---- Hover handlers ----
  const handleShow = useCallback((key: string) => {
    clearTimeout(hideTimeoutRef.current);
    setHoveredCol(key);
  }, []);

  const handleHide = useCallback((key: string) => {
    clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => {
      const menuEl = document.querySelector(`.tca-menu[data-col-key="${key}"]`);
      if (menuEl) {
        const rect = menuEl.getBoundingClientRect();
        const { x, y } = mousePos.current;
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return;
        }
      }
      setHoveredCol((prev) => (prev === key ? null : prev));
    }, 150);
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

  // ---- Actions ----
  const clearColumn = useCallback((tableId: string, colIndex: number) => {
    const editor = getEditor();
    if (!editor) return;

    const block = findBlockDeep(editor.document, tableId);
    if (!block?.content?.rows) return;

    const newRows = block.content.rows.map((row: any) => ({
      ...row,
      cells: row.cells.map((cell: any, idx: number) =>
        idx === colIndex ? { ...cell, content: [] } : cell
      ),
    }));

    editor.updateBlock(block, {
      type: 'table',
      content: { ...block.content, rows: newRows },
    });
    editor.setTextCursorPosition(block);

    setOpenCol(null);
    setColorOpen(false);
  }, [getEditor]);

  const setColumnColor = useCallback((tableId: string, colIndex: number, colorKey: string) => {
    const editor = getEditor();
    if (!editor) return;

    const block = findBlockDeep(editor.document, tableId);
    if (!block?.content?.rows) return;

    const newRows = block.content.rows.map((row: any) => ({
      ...row,
      cells: row.cells.map((cell: any, idx: number) =>
        idx === colIndex
          ? { ...cell, props: { ...cell.props, backgroundColor: colorKey } }
          : cell
      ),
    }));

    editor.updateBlock(block, {
      type: 'table',
      content: { ...block.content, rows: newRows },
    });
    editor.setTextCursorPosition(block);

    setOpenCol(null);
    setColorOpen(false);
  }, [getEditor]);

  // ---- Mouse tracking + proximity detection ----
  // Only detect hover on the ACTIVE column's indicator.
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const openColRef = useRef(openCol);
  openColRef.current = openCol;
  const hoveredColRef = useRef(hoveredCol);
  hoveredColRef.current = hoveredCol;
  const activeColRef = useRef(activeCol);
  activeColRef.current = activeCol;
  const handleHideRef = useRef(handleHide);
  handleHideRef.current = handleHide;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY };

      // Don't change hover while menu is open
      if (openColRef.current) return;

      // Only check proximity for the active column
      const active = activeColRef.current;
      if (!active) {
        // No active column → clear any hover
        if (hoveredColRef.current) {
          handleHideRef.current(hoveredColRef.current);
        }
        return;
      }

      const mx = e.clientX;
      const my = e.clientY;

      // Find the active column's info
      const activeColInfo = colsRef.current.find(
        c => colKey(c.tableId, c.colIndex) === active
      );
      if (!activeColInfo || !editorContainer) return;

      const containerRect = editorContainer.getBoundingClientRect();
      const left = containerRect.left + activeColInfo.rightX - 5;
      const right = left + 10;
      const top = containerRect.top + activeColInfo.topY;
      const bottom = containerRect.top + activeColInfo.bottomY;

      if (mx >= left && mx <= right && my >= top && my <= bottom) {
        clearTimeout(hideTimeoutRef.current);
        setHoveredCol(active);
      } else if (hoveredColRef.current) {
        handleHideRef.current(hoveredColRef.current);
      }
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [editorContainer]);

  // ---- Observers for position updates ----
  useEffect(() => {
    if (!editorContainer) return;
    scan();

    let rafId = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(scan);
    });
    observer.observe(editorContainer, { childList: true, subtree: true });

    // Also observe ProseMirror selection changes (attribute changes on td)
    const attrObserver = new MutationObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(scan);
    });
    // Observe the editor for attribute changes (cell-active class)
    const pmEditor = editorContainer.querySelector('.ProseMirror');
    if (pmEditor) {
      attrObserver.observe(pmEditor, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }

    const scrollParent = editorContainer.closest('.overflow-y-auto');
    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(scan);
    };
    scrollParent?.addEventListener('scroll', onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(scan);
    });
    resizeObserver.observe(editorContainer);

    return () => {
      observer.disconnect();
      attrObserver.disconnect();
      cancelAnimationFrame(rafId);
      scrollParent?.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
    };
  }, [editorContainer, scan]);

  // ---- Click outside to close ----
  useEffect(() => {
    if (!openCol) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.tca-menu, .tca-btn')) {
        setOpenCol(null);
        setColorOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openCol]);

  // ---- Escape to close ----
  useEffect(() => {
    if (!openCol) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (colorOpen) {
          setColorOpen(false);
        } else {
          setOpenCol(null);
        }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [openCol, colorOpen]);

  // ---- Render ----
  // Only render triggers for columns that are active (have a selected cell)
  return (
    <>
      {cols.map((col) => {
        const key = colKey(col.tableId, col.colIndex);
        const isActive = activeCol === key;
        const isHovered = hoveredCol === key;
        const isOpen = openCol === key;
        const showButton = isHovered || isOpen;

        if (!isActive) return null;

        return (
          <div
            key={key}
            className={`tca-trigger${showButton ? ' tca-trigger-visible' : ''}`}
            style={{
              position: 'absolute',
              left: col.rightX - 3,
              top: col.topY,
              width: 6,
              height: col.bottomY - col.topY,
              zIndex: 20,
              cursor: 'pointer',
              pointerEvents: showButton ? 'auto' : 'none',
            }}
          >
            {/* Action button (visible on hover) */}
            {showButton && (
              <button
                className="tca-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenCol(openCol === key ? null : key);
                  setColorOpen(false);
                }}
                style={{
                  position: 'absolute',
                  top: (col.bottomY - col.topY) / 2 - 7,
                  left: -7,
                }}
              >
                <svg width="6" height="8" viewBox="0 0 6 8" fill="currentColor">
                  <circle cx="3" cy="1.5" r="1.2" />
                  <circle cx="3" cy="4" r="1.2" />
                  <circle cx="3" cy="6.5" r="1.2" />
                </svg>
              </button>
            )}

            {/* Dropdown menu */}
            {isOpen && (
              <div
                className="tca-menu"
                data-col-key={key}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: (col.bottomY - col.topY) / 2 - 20,
                }}
                onMouseEnter={() => handleShow(key)}
                onMouseLeave={() => handleHide(key)}
              >
                {/* Color item */}
                <div className="tca-menu-item" style={{ position: 'relative' }}>
                  <button
                    className="tca-menu-item-btn"
                    onClick={() => setColorOpen(!colorOpen)}
                  >
                    <Paintbrush size={15} />
                    <span>颜色</span>
                    <svg width="12" height="12" viewBox="0 0 12 12" style={{ marginLeft: 'auto' }}>
                      <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    </svg>
                  </button>

                  {/* Color submenu */}
                  {colorOpen && (
                    <div className="tca-color-submenu">
                      {Object.entries(COLORS).map(([key, color]) => (
                        <button
                          key={key}
                          className="tca-color-item"
                          onClick={() => setColumnColor(col.tableId, col.colIndex, key)}
                          title={COLOR_NAMES[key]}
                        >
                          <div
                            className="tca-color-swatch"
                            style={{ backgroundColor: color.background, border: `1px solid ${color.bgBorder}` }}
                          />
                          <span>{COLOR_NAMES[key]}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Clear content item */}
                <button
                  className="tca-menu-item-btn tca-danger"
                  onClick={() => clearColumn(col.tableId, col.colIndex)}
                >
                  <Eraser size={15} />
                  <span>清除内容</span>
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
