import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type TdHTMLAttributes, type WheelEvent as ReactWheelEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowUpDown,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Activity,
  GripVertical,
  Filter,
  HelpCircle,
  Image,
  Info,
  List,
  Lock,
  Map as MapIcon,
  MoreHorizontal,
  PieChart,
  Plus,
  Repeat2,
  Search,
  SlidersHorizontal,
  Trash2,
  Workflow,
  EyeOff,
  FileText,
  Copy,
} from 'lucide-react';
import { databasesApi, type DatabaseColumn, type DatabaseColumnType, type DatabaseDetail, type DatabaseRow, type DatabaseSummary } from '../../../api/databases';
import { evalFormula } from '../../../formula/evaluator';
import { defaultView, type DatabaseViewConfig, type ViewAdvancedFilterGroup, type ViewAdvancedFilterNode, type ViewColumnRule } from './viewConfig';
import { notionColumnIconOptions, type ColumnIconOption } from './columnIcons';
import { showToast } from '../../Toast';
import './database.css';

interface Props {
  spaceSlug: string;
  dbId: string;
  blockId?: string;
  view?: DatabaseViewConfig;
  readonly?: boolean;
  columnControls?: boolean;
  createRequest?: number;
  missingState?: ReactNode;
  onAvailabilityChange?: (available: boolean) => void;
  onSchemaChange?: (columns: DatabaseColumn[]) => void;
  onOpenRow?: (rowId: string) => void;
  onViewChange?: (view: DatabaseViewConfig) => void;
  onOpenViewSettings?: (pane: 'main' | 'visibility') => void;
  onSelectionChange?: (count: number) => void;
  onAddFilterColumn?: (column: DatabaseColumn) => void;
  onAddSortColumn?: (column: DatabaseColumn) => void;
}

type CellCoord = { rowIndex: number; colIndex: number };
type CellRange = { anchor: CellCoord; focus: CellCoord };

const DATABASE_POPUP_SELECTOR = [
  '.akdb-filter-menu',
  '.akdb-view-rule-editor',
  '.akdb-view-rule-dropdown-menu',
  '.akdb-view-rule-action-menu',
  '.akdb-view-tab-context-menu',
  '.akdb-row-context-menu',
  '.akdb-add-column-menu',
  '.akdb-column-menu',
  '.akdb-column-type-submenu',
  '.akdb-column-property-submenu',
  '.akdb-column-number-submenu',
  '.akdb-option-menu',
  '.akdb-option-edit-menu',
  '.akdb-option-color-palette',
  '.akdb-date-picker',
  '.akdb-date-picker-submenu',
  '.akdb-timezone-submenu',
  '.akdb-column-icon-popover',
  '.akdb-status-group-edit-menu',
  '.akdb-view-settings-menu',
  '.akdb-dialog-backdrop',
  '.akdb-cell-popup-mask',
].join(',');

export function requestDatabaseImmediateSync() {
  window.setTimeout(() => {
    document.dispatchEvent(new CustomEvent('akdb-request-immediate-sync'));
  }, 0);
}

export default function DatabaseRenderer({ spaceSlug, dbId, blockId, view, readonly, columnControls = true, createRequest = 0, missingState, onAvailabilityChange, onSchemaChange, onOpenRow, onViewChange, onOpenViewSettings, onSelectionChange, onAddFilterColumn, onAddSortColumn }: Props) {
  const [schema, setSchema] = useState<DatabaseDetail | null>(null);
  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [columnMenuIndex, setColumnMenuIndex] = useState<number | null>(null);
  const [columnMenuSubmenu, setColumnMenuSubmenu] = useState<'type' | 'property' | null>(null);
  const [pendingDeleteColumn, setPendingDeleteColumn] = useState<DatabaseColumn | null>(null);
  const [deletingColumn, setDeletingColumn] = useState(false);
  const [rowContextMenu, setRowContextMenu] = useState<{ row: DatabaseRow; top: number; left: number } | null>(null);
  const rowContextMenuRef = useRef<HTMLDivElement | null>(null);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const [selectedRowIDs, setSelectedRowIDs] = useState<Set<string>>(() => new Set());
  const [activeCell, setActiveCell] = useState<CellCoord | null>(null);
  const [editingCell, setEditingCell] = useState<CellCoord | null>(null);
  const [cellRange, setCellRange] = useState<CellRange | null>(null);
  const [fillRange, setFillRange] = useState<CellRange | null>(null);
  const [hoveredRowID, setHoveredRowID] = useState<string | null>(null);
  const [rowDragState, setRowDragState] = useState<{ sourceRowID: string; targetRowID: string; sourceIndex: number; targetIndex: number; placement: 'before' | 'after' } | null>(null);
  const [rowDragPreview, setRowDragPreview] = useState<{ left: number; top: number; width: number; height: number; cells: Array<{ width: number; text: string }> } | null>(null);
  const [pendingDeleteRows, setPendingDeleteRows] = useState<string[] | null>(null);
  const [deletingRows, setDeletingRows] = useState(false);
  const [columnDragState, setColumnDragState] = useState<{
    sourceIndex: number;
    targetIndex: number;
    pointerOffset: number;
    minLeft: number;
    maxLeft: number;
    initialLeft: number;
    currentLeft: number;
    columnWidth: number;
    clipLeft: number;
    clipRight: number;
    centers: number[];
  } | null>(null);
  const [columnWidthDrafts, setColumnWidthDrafts] = useState<Record<string, number>>({});
  const columnDragStateRef = useRef<typeof columnDragState>(null);
  const rowDragStateRef = useRef<typeof rowDragState>(null);
  const cellSelectionDragRef = useRef<{ anchor: CellCoord; dragged: boolean } | null>(null);
  const fillDragRef = useRef<{ source: CellCoord; target: CellCoord } | null>(null);
  const recentlyClosedEditingCellRef = useRef<CellCoord | null>(null);
  const suppressNextCellClickRef = useRef<(() => void) | null>(null);
  const resizeColumnRef = useRef<{ id: string; startX: number; startWidth: number } | null>(null);
  const addColumnButtonRef = useRef<HTMLButtonElement | null>(null);
  const columnMenuAnchorRef = useRef<HTMLElement | null>(null);
  const suppressNextHeaderClickRef = useRef(false);
  const activeView = useMemo(() => view || defaultView(schema?.columns || []), [view, schema?.columns]);
  const addColumnMenuRect = useDropdownPosition(addColumnOpen, addColumnButtonRef, 360);
  const columnMenuRect = useDropdownPosition(columnMenuIndex !== null, columnMenuAnchorRef, 220, 'below', 0, false);
  const showColumnControls = !readonly && columnControls;
  const showFillColumn = !readonly;
  useDropdownOutsideClose(addColumnOpen, addColumnButtonRef, () => setAddColumnOpen(false), '.akdb-add-column-menu');
  useDropdownOutsideClose(columnMenuIndex !== null, columnMenuAnchorRef, () => closeColumnMenu(), '.akdb-column-menu, .akdb-column-icon-popover, .akdb-column-type-submenu, .akdb-column-property-submenu, .akdb-column-number-submenu, .akdb-option-edit-menu, .akdb-status-group-edit-menu');
  useEffect(() => {
    const handlePopupContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(DATABASE_POPUP_SELECTOR)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener('contextmenu', handlePopupContextMenu, true);
    return () => document.removeEventListener('contextmenu', handlePopupContextMenu, true);
  }, []);
  useEffect(() => () => {
    suppressNextCellClickRef.current?.();
  }, []);
  const applySchema = (nextSchema: DatabaseDetail | null) => {
    setSchema(nextSchema);
    onSchemaChange?.(nextSchema?.columns || []);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const [detail, rowRes] = await Promise.all([
        databasesApi.get(spaceSlug, dbId),
        databasesApi.listRows(spaceSlug, dbId, { limit: 0 }),
      ]);
      applySchema(detail);
      setRows(rowRes.rows || []);
      onAvailabilityChange?.(true);
    } catch {
      applySchema(null);
      setRows([]);
      onAvailabilityChange?.(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (spaceSlug && dbId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceSlug, dbId]);

  const visibleColumns = useMemo(() => {
    if (!schema) return [];
    const byID = new Map(schema.columns.map((c) => [c.id, c]));
    const rules = activeView.columns;
    return rules.filter((r) => !r.hidden).map((r, index) => ({
      rule: r,
      column: r.property ? byID.get(r.property) : undefined,
      id: viewColumnID(r, index),
      name: r.property ? byID.get(r.property)?.name || '' : '',
    })).filter((c) => c.rule.property && c.column);
  }, [activeView, schema]);

  const displayRows = useMemo(() => {
    if (!schema) return [];
    let items = rows.map((row) => {
      const props = buildFormulaProps(schema.columns, row);
      const display: Record<string, any> = {};
      for (const col of visibleColumns) {
        display[col.id] = displayValueForColumn(col.column, row, props);
      }
      return { row, display, props };
    });
    items = applyViewFilters(items, schema.columns, activeView);
    items = applyViewSorts(items, schema.columns, activeView);
    if (activeView.limit && activeView.limit > 0) items = items.slice(0, activeView.limit);
    return items;
  }, [activeView, rows, schema, visibleColumns]);
  const displayRowIDs = useMemo(() => displayRows.map(({ row }) => row.uuid), [displayRows]);

  useEffect(() => {
    const visible = new Set(displayRowIDs);
    setSelectedRowIDs((current) => {
      const next = new Set(Array.from(current).filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [displayRowIDs]);

  useEffect(() => {
    if (readonly) setSelectedRowIDs(new Set());
  }, [readonly]);

  useEffect(() => {
    const handleMouseDown = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!activeCell && !cellRange) return;
      if (target?.closest(`.akdb-table-wrap, .akdb-text-editor-overlay, ${DATABASE_POPUP_SELECTOR}`)) return;
      setActiveCell(null);
      setEditingCell(null);
      setCellRange(null);
      setFillRange(null);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [activeCell, cellRange]);

  useEffect(() => {
    if (!activeCell && !cellRange) return;
    const isEditingTarget = (target: EventTarget | null) => (target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]');
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditingTarget(event.target)) return;
      if (event.key === 'Escape') {
        setActiveCell(null);
        setEditingCell(null);
        setCellRange(null);
        setFillRange(null);
        return;
      }
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      const range = cellRange || (activeCell ? { anchor: activeCell, focus: activeCell } : null);
      if (!range || readonly) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void clearCellRange(range);
    };
    const handleCopy = (event: ClipboardEvent) => {
      if (isEditingTarget(event.target)) return;
      const range = cellRange || (activeCell ? { anchor: activeCell, focus: activeCell } : null);
      if (!range) return;
      event.preventDefault();
      event.clipboardData?.setData('text/plain', serializeCellRange(range));
    };
    const handlePaste = (event: ClipboardEvent) => {
      if (isEditingTarget(event.target)) return;
      const range = cellRange || (activeCell ? { anchor: activeCell, focus: activeCell } : null);
      const text = event.clipboardData?.getData('text/plain') || '';
      if (!range || !text || readonly) return;
      event.preventDefault();
      void pasteCellText(range.anchor, text);
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('copy', handleCopy);
    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('paste', handlePaste);
    };
  }, [activeCell, cellRange, readonly, displayRows, visibleColumns]);

  useEffect(() => {
    if (!selectedRowIDs.size) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedRowIDs(new Set());
        return;
      }
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      requestDeleteSelectedRows();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedRowIDs, readonly, spaceSlug, dbId]);

  useEffect(() => {
    onSelectionChange?.(selectedRowIDs.size);
  }, [onSelectionChange, selectedRowIDs.size]);

  useEffect(() => {
    return () => onSelectionChange?.(0);
  }, [onSelectionChange]);

  useEffect(() => {
    document.body.classList.toggle('akdb-row-selection-active', selectedRowIDs.size > 0);
    return () => document.body.classList.remove('akdb-row-selection-active');
  }, [selectedRowIDs.size]);

  useEffect(() => {
    const handleEditorDragSelect = (event: Event) => {
      const detail = (event as CustomEvent<{
        blockId?: string;
        mode: 'rows' | 'block' | 'clear';
        rect?: { left: number; right: number; top: number; bottom: number };
      }>).detail;
      if (!detail) return;
      if (detail.mode === 'clear') {
        setSelectedRowIDs(new Set());
        return;
      }
      if (!blockId || detail.blockId !== blockId) return;
      if (detail.mode === 'block') {
        setSelectedRowIDs(new Set());
        return;
      }
      if (!detail.rect) return;
      const next = new Set<string>();
      tableWrapRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-akdb-row-id]').forEach((rowEl) => {
        const rect = rowEl.getBoundingClientRect();
        if (
          detail.rect!.left < rect.right &&
          detail.rect!.right > rect.left &&
          detail.rect!.top < rect.bottom &&
          detail.rect!.bottom > rect.top
        ) {
          const id = rowEl.dataset.akdbRowId;
          if (id) next.add(id);
        }
      });
      setSelectedRowIDs(next);
    };
    document.addEventListener('akdb-editor-drag-select', handleEditorDragSelect);
    return () => document.removeEventListener('akdb-editor-drag-select', handleEditorDragSelect);
  }, [blockId]);

  useEffect(() => {
    const handleDeleteSelectedRows = (event: Event) => {
      const detail = (event as CustomEvent<{ blockId?: string }>).detail;
      if (!blockId || detail?.blockId !== blockId) return;
      requestDeleteSelectedRows();
    };
    document.addEventListener('akdb-delete-selected-rows', handleDeleteSelectedRows);
    return () => document.removeEventListener('akdb-delete-selected-rows', handleDeleteSelectedRows);
  }, [blockId, selectedRowIDs, readonly, spaceSlug, dbId]);

  useEffect(() => {
    const handleDeleteActiveSelectedRows = () => {
      if (!selectedRowIDs.size) return;
      requestDeleteSelectedRows();
    };
    document.addEventListener('akdb-delete-active-selected-rows', handleDeleteActiveSelectedRows);
    return () => document.removeEventListener('akdb-delete-active-selected-rows', handleDeleteActiveSelectedRows);
  }, [selectedRowIDs, readonly]);

  const createRow = async (defaults: Record<string, string> = {}) => {
    if (readonly) return;
    const created = await databasesApi.createRow(spaceSlug, dbId, defaults);
    setRows((prev) => [...prev, created]);
    requestDatabaseImmediateSync();
  };

  const createRowBelow = async (rowID: string) => {
    if (readonly) return;
    const created = await databasesApi.createRow(spaceSlug, dbId, {});
    const ordered = rows.map((row) => row.uuid);
    const next = ordered.filter((id) => id !== created.uuid);
    const index = next.indexOf(rowID);
    if (index === -1) {
      next.push(created.uuid);
    } else {
      next.splice(index + 1, 0, created.uuid);
    }
    const reordered = await databasesApi.reorderRows(spaceSlug, dbId, next);
    setRows(reordered.rows || []);
    requestDatabaseImmediateSync();
  };

  const reorderRows = async (sourceRowID: string, targetRowID: string, placement: 'before' | 'after' = 'before') => {
    if (readonly || sourceRowID === targetRowID) return;
    const ordered = rows.map((row) => row.uuid);
    const next = ordered.filter((id) => id !== sourceRowID);
    const targetIndex = next.indexOf(targetRowID);
    if (targetIndex === -1) return;
    next.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, sourceRowID);
    const reordered = await databasesApi.reorderRows(spaceSlug, dbId, next);
    setRows(reordered.rows || []);
    requestDatabaseImmediateSync();
  };

  useEffect(() => {
    if (createRequest > 0) createRow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequest]);

  useEffect(() => {
    if (!rowContextMenu) return;
    const handleMouseDown = (event: globalThis.MouseEvent) => {
      if (rowContextMenuRef.current?.contains(event.target as Node)) return;
      closeRowContextMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRowContextMenu();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [rowContextMenu]);

  const updateCell = async (rowId: string, col: DatabaseColumn | undefined, value: string) => {
    if (readonly || !col || col.readonly || col.type === 'formula') return;
    await databasesApi.updateRow(spaceSlug, dbId, rowId, { [col.id]: value });
    setRows((prev) => prev.map((r) => r.uuid === rowId ? { ...r, values: { ...r.values, [col.id]: value } } : r));
    requestDatabaseImmediateSync();
  };

  const editableColumnAt = (colIndex: number) => {
    const column = visibleColumns[colIndex]?.column;
    if (!column || readonly || column.readonly || column.type === 'formula') return null;
    return column;
  };

  const cellRangeBounds = (range: CellRange) => ({
    rowStart: Math.min(range.anchor.rowIndex, range.focus.rowIndex),
    rowEnd: Math.max(range.anchor.rowIndex, range.focus.rowIndex),
    colStart: Math.min(range.anchor.colIndex, range.focus.colIndex),
    colEnd: Math.max(range.anchor.colIndex, range.focus.colIndex),
  });

  const cellInRange = (coord: CellCoord, range: CellRange | null) => {
    if (!range) return false;
    const bounds = cellRangeBounds(range);
    return coord.rowIndex >= bounds.rowStart && coord.rowIndex <= bounds.rowEnd && coord.colIndex >= bounds.colStart && coord.colIndex <= bounds.colEnd;
  };

  const sameCell = (a: CellCoord | null, b: CellCoord) => !!a && a.rowIndex === b.rowIndex && a.colIndex === b.colIndex;

  const displayedCellValue = (rowIndex: number, colIndex: number) => {
    const row = displayRows[rowIndex];
    const column = visibleColumns[colIndex];
    if (!row || !column) return '';
    return String(row.display[column.id] ?? '');
  };

  const rawCellValue = (rowIndex: number, colIndex: number) => {
    const row = displayRows[rowIndex]?.row;
    const column = visibleColumns[colIndex]?.column;
    if (!row || !column) return '';
    return String(row.values?.[column.id] ?? '');
  };

  const serializeCellRange = (range: CellRange) => {
    const bounds = cellRangeBounds(range);
    const lines: string[] = [];
    for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex++) {
      const cells: string[] = [];
      for (let colIndex = bounds.colStart; colIndex <= bounds.colEnd; colIndex++) {
        cells.push(displayedCellValue(rowIndex, colIndex));
      }
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  };

  const updateCells = async (patches: Array<{ rowID: string; column: DatabaseColumn; value: string }>) => {
    if (readonly || patches.length === 0) return;
    const rowPatches = new Map<string, Record<string, string>>();
    for (const patch of patches) {
      if (patch.column.readonly || patch.column.type === 'formula') continue;
      rowPatches.set(patch.rowID, { ...(rowPatches.get(patch.rowID) || {}), [patch.column.id]: patch.value });
    }
    if (!rowPatches.size) return;
    await Promise.all(Array.from(rowPatches.entries()).map(([rowID, values]) => databasesApi.updateRow(spaceSlug, dbId, rowID, values)));
    setRows((prev) => prev.map((row) => rowPatches.has(row.uuid) ? { ...row, values: { ...row.values, ...rowPatches.get(row.uuid)! } } : row));
    requestDatabaseImmediateSync();
  };

  const clearCellRange = async (range: CellRange) => {
    const bounds = cellRangeBounds(range);
    const patches: Array<{ rowID: string; column: DatabaseColumn; value: string }> = [];
    for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex++) {
      const row = displayRows[rowIndex]?.row;
      if (!row) continue;
      for (let colIndex = bounds.colStart; colIndex <= bounds.colEnd; colIndex++) {
        const column = editableColumnAt(colIndex);
        if (column) patches.push({ rowID: row.uuid, column, value: '' });
      }
    }
    await updateCells(patches);
  };

  const pasteCellText = async (origin: CellCoord, text: string) => {
    const rowsText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (rowsText[rowsText.length - 1] === '') rowsText.pop();
    const matrix = rowsText.map((line) => line.split('\t'));
    const patches: Array<{ rowID: string; column: DatabaseColumn; value: string }> = [];
    matrix.forEach((line, rowOffset) => {
      const row = displayRows[origin.rowIndex + rowOffset]?.row;
      if (!row) return;
      line.forEach((value, colOffset) => {
        const column = editableColumnAt(origin.colIndex + colOffset);
        if (column) patches.push({ rowID: row.uuid, column, value });
      });
    });
    await updateCells(patches);
    if (matrix.length && matrix[0]?.length) {
      setCellRange({
        anchor: origin,
        focus: {
          rowIndex: Math.min(displayRows.length - 1, origin.rowIndex + matrix.length - 1),
          colIndex: Math.min(visibleColumns.length - 1, origin.colIndex + Math.max(...matrix.map((line) => line.length)) - 1),
        },
      });
      setActiveCell(origin);
    }
  };

  const selectCell = (coord: CellCoord, edit = true) => {
    clearEditorBlockSelection();
    setSelectedRowIDs(new Set());
    setActiveCell(coord);
    setCellRange({ anchor: coord, focus: coord });
    setFillRange(null);
    setEditingCell(edit && editableColumnAt(coord.colIndex) ? coord : null);
    tableWrapRef.current?.focus({ preventScroll: true });
  };

  const suppressNextCellClick = () => {
    suppressNextCellClickRef.current?.();
    const handleClick = (clickEvent: MouseEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      clickEvent.stopImmediatePropagation();
      cleanup();
    };
    const cleanup = () => {
      document.removeEventListener('click', handleClick, true);
      if (suppressNextCellClickRef.current === cleanup) suppressNextCellClickRef.current = null;
    };
    suppressNextCellClickRef.current = cleanup;
    document.addEventListener('click', handleClick, true);
    window.setTimeout(cleanup, 350);
  };

  const beginCellPointer = (coord: CellCoord, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest('.akdb-cell-fill-handle')) return;
    const recentlyClosedEditingCell = recentlyClosedEditingCellRef.current;
    if (recentlyClosedEditingCell && !sameCell(recentlyClosedEditingCell, coord)) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextCellClick();
      setActiveCell(recentlyClosedEditingCell);
      setCellRange({ anchor: recentlyClosedEditingCell, focus: recentlyClosedEditingCell });
      setFillRange(null);
      setEditingCell(null);
      return;
    }
    if (editingCell && !sameCell(editingCell, coord)) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextCellClick();
      setActiveCell(editingCell);
      setCellRange({ anchor: editingCell, focus: editingCell });
      setFillRange(null);
      setEditingCell(null);
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    const target = event.target as HTMLElement | null;
    const textPreviewElement = target?.closest<HTMLElement>('.akdb-text-cell-preview');
    const inputElement = target?.closest<HTMLInputElement>('input');
    const cellElement = target?.closest<HTMLTableCellElement>('td[data-akdb-row-index][data-akdb-col-index]');
    const textEditingElement = target?.closest<HTMLElement>('textarea, [contenteditable="true"]');
    if (textEditingElement && (!cellElement || cellElement.contains(textEditingElement))) {
      return;
    }
    if (inputElement && sameCell(editingCell, coord)) {
      return;
    }
    if (inputElement) event.preventDefault();
    closeRowContextMenu();
    closeColumnMenu();
    const anchor = coord;
    const startX = event.clientX;
    const startY = event.clientY;
    cellSelectionDragRef.current = { anchor, dragged: false };

    const coordFromPoint = (clientX: number, clientY: number): CellCoord | null => {
      const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLTableCellElement>('td[data-akdb-row-index][data-akdb-col-index]');
      if (!el) return null;
      const rowIndex = Number(el.dataset.akdbRowIndex);
      const colIndex = Number(el.dataset.akdbColIndex);
      if (!Number.isFinite(rowIndex) || !Number.isFinite(colIndex)) return null;
      return { rowIndex, colIndex };
    };

    const handleMove = (moveEvent: PointerEvent) => {
      const state = cellSelectionDragRef.current;
      if (!state) return;
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (!state.dragged && distance > 4) {
        state.dragged = true;
        suppressNextCellClick();
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        setEditingCell(null);
        (document.activeElement as HTMLElement | null)?.blur();
        clearEditorBlockSelection();
        setSelectedRowIDs(new Set());
        setActiveCell(anchor);
        setCellRange({ anchor, focus: anchor });
      }
      if (!state.dragged) return;
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      const focus = coordFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (!focus) return;
      setActiveCell(anchor);
      setCellRange({ anchor, focus });
    };
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove, true);
      document.removeEventListener('pointerup', handleUp, true);
      document.removeEventListener('pointercancel', handleUp, true);
      const dragged = cellSelectionDragRef.current?.dragged;
      cellSelectionDragRef.current = null;
      if (!dragged) {
        if (!textPreviewElement) window.setTimeout(() => selectCell(coord, true), 0);
      } else {
        suppressNextCellClick();
      }
    };
    document.addEventListener('pointermove', handleMove, true);
    document.addEventListener('pointerup', handleUp, true);
    document.addEventListener('pointercancel', handleUp, true);
  };

  const beginCellPointerFromTable = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const cell = target?.closest<HTMLTableCellElement>('td[data-akdb-row-index][data-akdb-col-index]');
    if (!cell) return;
    const rowIndex = Number(cell.dataset.akdbRowIndex);
    const colIndex = Number(cell.dataset.akdbColIndex);
    if (!Number.isFinite(rowIndex) || !Number.isFinite(colIndex)) return;
    beginCellPointer({ rowIndex, colIndex }, event);
  };

  const beginFillDrag = (coord: CellCoord, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || readonly) return;
    event.preventDefault();
    event.stopPropagation();
    const source = coord;
    fillDragRef.current = { source, target: source };
    setFillRange({ anchor: source, focus: source });
    const targetFromPoint = (clientX: number, clientY: number) => {
      const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLTableCellElement>('td[data-akdb-row-index][data-akdb-col-index]');
      if (!el) return null;
      const rowIndex = Number(el.dataset.akdbRowIndex);
      if (!Number.isFinite(rowIndex)) return null;
      return { rowIndex, colIndex: source.colIndex };
    };
    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const target = targetFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (!target) return;
      fillDragRef.current = { source, target };
      setFillRange({ anchor: source, focus: target });
    };
    const handleUp = async () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      const final = fillDragRef.current;
      fillDragRef.current = null;
      setFillRange(null);
      if (!final) return;
      const bounds = cellRangeBounds({ anchor: final.source, focus: final.target });
      if (bounds.rowStart === bounds.rowEnd) return;
      const column = editableColumnAt(source.colIndex);
      if (!column) return;
      const sourceValue = rawCellValue(source.rowIndex, source.colIndex);
      const patches: Array<{ rowID: string; column: DatabaseColumn; value: string }> = [];
      for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex++) {
        if (rowIndex === source.rowIndex) continue;
        const row = displayRows[rowIndex]?.row;
        if (row) patches.push({ rowID: row.uuid, column, value: sourceValue });
      }
      await updateCells(patches);
      setCellRange({ anchor: source, focus: final.target });
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
  };

  const closeRowContextMenu = () => setRowContextMenu(null);

  const clearEditorBlockSelection = () => {
    document.dispatchEvent(new CustomEvent('akdb-clear-block-selection'));
  };

  const toggleRowSelection = (rowID: string) => {
    clearEditorBlockSelection();
    setSelectedRowIDs((current) => {
      const next = new Set(current);
      if (next.has(rowID)) next.delete(rowID);
      else next.add(rowID);
      return next;
    });
  };

  const openRowContextMenuAt = (row: DatabaseRow, clientX: number, clientY: number) => {
    if (readonly) return;
    closeColumnMenu();
    setRowContextMenu({
      row,
      left: Math.max(8, Math.min(clientX, window.innerWidth - 320)),
      top: Math.max(8, Math.min(clientY, window.innerHeight - 360)),
    });
  };

  const openRowContextMenu = (row: DatabaseRow, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openRowContextMenuAt(row, event.clientX, event.clientY);
  };

  const copyRowLink = async (row: DatabaseRow) => {
    await navigator.clipboard.writeText(`${window.location.origin}/s/${spaceSlug}/db/${dbId}/row/${row.uuid}`);
    showToast('链接已复制');
    closeRowContextMenu();
  };

  const duplicateRow = async (row: DatabaseRow) => {
    if (readonly) return;
    const created = await databasesApi.createRow(spaceSlug, dbId, { ...row.values });
    setRows((prev) => {
      const index = prev.findIndex((item) => item.uuid === row.uuid);
      if (index < 0) return [...prev, created];
      const next = [...prev];
      next.splice(index + 1, 0, created);
      return next;
    });
    requestDatabaseImmediateSync();
    closeRowContextMenu();
  };

  const deleteRowById = async (rowId: string) => {
    closeRowContextMenu();
    requestDeleteRows([rowId]);
  };

  function requestDeleteRows(rowIDs: string[]) {
    if (readonly) return;
    const ids = rowIDs.filter(Boolean);
    if (ids.length === 0) return;
    setPendingDeleteRows(ids);
  };

  function requestDeleteSelectedRows() {
    if (readonly || selectedRowIDs.size === 0) return;
    requestDeleteRows(Array.from(selectedRowIDs));
  }

  async function confirmDeleteRows() {
    if (readonly || !pendingDeleteRows?.length) return;
    setDeletingRows(true);
    const ids = pendingDeleteRows;
    const idSet = new Set(ids);
    try {
      await Promise.all(ids.map((rowId) => databasesApi.deleteRow(spaceSlug, dbId, rowId)));
      setRows((prev) => prev.filter((row) => !idSet.has(row.uuid)));
      setSelectedRowIDs((current) => new Set(Array.from(current).filter((id) => !idSet.has(id))));
      setPendingDeleteRows(null);
      closeRowContextMenu();
      requestDatabaseImmediateSync();
    } finally {
      setDeletingRows(false);
    }
  }

  const beginRowDrag = (row: DatabaseRow, index: number, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || readonly) return;
    const rowEl = tableWrapRef.current?.querySelector<HTMLTableRowElement>(`tr[data-akdb-row-id="${CSS.escape(row.uuid)}"]`);
    if (!rowEl) return;
    const rowRect = rowEl.getBoundingClientRect();
    const previewCells = Array.from(rowEl.cells).map((cell) => {
      const rect = cell.getBoundingClientRect();
      return { width: rect.width, text: cell.innerText };
    });
    const pointerOffsetY = event.clientY - rowRect.top;
    event.preventDefault();
    event.stopPropagation();
    closeRowContextMenu();
    closeColumnMenu();
    const startClientY = event.clientY;
    let hasDragged = false;

    const handleMove = (moveEvent: PointerEvent) => {
      if (!hasDragged && Math.abs(moveEvent.clientY - startClientY) > 4) {
        hasDragged = true;
        setRowDragState({ sourceRowID: row.uuid, targetRowID: row.uuid, sourceIndex: index, targetIndex: index, placement: 'before' });
        rowDragStateRef.current = { sourceRowID: row.uuid, targetRowID: row.uuid, sourceIndex: index, targetIndex: index, placement: 'before' };
        setRowDragPreview({
          left: rowRect.left,
          top: moveEvent.clientY - pointerOffsetY,
          width: rowRect.width,
          height: rowRect.height,
          cells: previewCells,
        });
      }
      if (!hasDragged) return;
      moveEvent.preventDefault();
      setRowDragPreview((current) => current ? { ...current, top: moveEvent.clientY - pointerOffsetY } : current);
      const rowsEls = Array.from(tableWrapRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-akdb-row-id]') || []);
      let targetIndex = Math.max(0, rowsEls.length - 1);
      let targetRowID = rowsEls[targetIndex]?.dataset.akdbRowId || row.uuid;
      let placement: 'before' | 'after' = 'after';
      for (let i = 0; i < rowsEls.length; i++) {
        const rect = rowsEls[i].getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        if (moveEvent.clientY <= center) {
          targetIndex = i;
          targetRowID = rowsEls[i].dataset.akdbRowId || row.uuid;
          placement = 'before';
          break;
        }
      }
      const next = { sourceRowID: row.uuid, targetRowID, sourceIndex: index, targetIndex, placement };
      rowDragStateRef.current = next;
      setRowDragState(next);
    };
    const handleUp = async (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      const final = rowDragStateRef.current;
      rowDragStateRef.current = null;
      setRowDragState(null);
      setRowDragPreview(null);
      if (hasDragged && final && final.sourceRowID !== final.targetRowID) {
        await reorderRows(final.sourceRowID, final.targetRowID, final.placement);
      }
      if (!hasDragged) {
        openRowContextMenuAt(row, upEvent.clientX, upEvent.clientY);
      }
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
  };

  const createColumnOption = async (col: DatabaseColumn, label: string) => {
    if (readonly || col.readonly || (col.type !== 'select' && col.type !== 'status' && col.type !== 'multi_select')) return null;
    const value = label.trim();
    if (!value) return null;
    const options = Array.isArray(col.config?.options) ? col.config.options : [];
    const existing = options.find((option: any) => String(option.value || '').trim().toLowerCase() === value.toLowerCase());
    if (existing) return existing;
    const option = createOptionConfig(value, options);
    const nextConfig = { ...(col.config || {}), options: [...options, option] };
    const nextSchema = await databasesApi.updateColumn(spaceSlug, dbId, col.id, { config: nextConfig });
    applySchema(nextSchema);
    requestDatabaseImmediateSync();
    return option;
  };

  const reorderColumnOption = async (col: DatabaseColumn, sourceID: string, targetID: string) => {
    if (readonly || col.readonly || (col.type !== 'select' && col.type !== 'status' && col.type !== 'multi_select')) return;
    const options = Array.isArray(col.config?.options) ? col.config.options : [];
    const sourceIndex = options.findIndex((option: any) => option.id === sourceID);
    const targetIndex = options.findIndex((option: any) => option.id === targetID);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const nextOptions = [...options];
    const [moved] = nextOptions.splice(sourceIndex, 1);
    nextOptions.splice(targetIndex, 0, moved);
    const nextConfig = { ...(col.config || {}), options: nextOptions };
    const nextSchema = await databasesApi.updateColumn(spaceSlug, dbId, col.id, { config: nextConfig });
    applySchema(nextSchema);
    requestDatabaseImmediateSync();
  };

  const updateColumnOption = async (col: DatabaseColumn, optionID: string, patch: Record<string, any>) => {
    if (readonly || col.readonly || (col.type !== 'select' && col.type !== 'status' && col.type !== 'multi_select')) return;
    const options = Array.isArray(col.config?.options) ? col.config.options : [];
    const nextOptions = options.map((option: any) => option.id === optionID ? { ...option, ...patch } : option);
    const nextConfig = { ...(col.config || {}), options: nextOptions };
    const nextSchema = await databasesApi.updateColumn(spaceSlug, dbId, col.id, { config: nextConfig });
    applySchema(nextSchema);
    requestDatabaseImmediateSync();
  };

  const deleteColumnOption = async (col: DatabaseColumn, optionID: string) => {
    if (readonly || col.readonly || (col.type !== 'select' && col.type !== 'status')) return;
    const options = Array.isArray(col.config?.options) ? col.config.options : [];
    const nextOptions = options.filter((option: any) => option.id !== optionID);
    const nextConfig = {
      ...(col.config || {}),
      options: nextOptions,
      groups: Array.isArray(col.config?.groups)
        ? col.config.groups.map((group: any) => ({ ...group, option_ids: (group.option_ids || []).filter((id: string) => id !== optionID) }))
        : col.config?.groups,
    };
    const nextSchema = await databasesApi.updateColumn(spaceSlug, dbId, col.id, { config: nextConfig });
    const affectedRows = rows.filter((row) => row.values?.[col.id] === optionID);
    await Promise.all(affectedRows.map((row) => databasesApi.updateRow(spaceSlug, dbId, row.uuid, { [col.id]: '' })));
    applySchema(nextSchema);
    if (affectedRows.length) {
      const affectedIDs = new Set(affectedRows.map((row) => row.uuid));
      setRows((prev) => prev.map((row) => affectedIDs.has(row.uuid) ? { ...row, values: { ...row.values, [col.id]: '' } } : row));
    }
    requestDatabaseImmediateSync();
  };

  const updateColumnConfig = async (col: DatabaseColumn, patch: Record<string, any>) => {
    if (readonly || col.readonly) return;
    const nextConfig = { ...(col.config || {}), ...patch };
    const nextSchema = await databasesApi.updateColumn(spaceSlug, dbId, col.id, { config: nextConfig });
    applySchema(nextSchema);
    requestDatabaseImmediateSync();
  };

  const closeColumnMenu = () => {
    setColumnMenuIndex(null);
    setColumnMenuSubmenu(null);
    columnMenuAnchorRef.current = null;
  };

  const openColumnMenu = (index: number, anchor: HTMLElement) => {
    if (readonly) return;
    columnMenuAnchorRef.current = anchor;
    setColumnMenuIndex(index);
    setColumnMenuSubmenu(null);
  };

  const handleColumnHeaderClick = (index: number, event: ReactMouseEvent<HTMLTableCellElement>) => {
    if (suppressNextHeaderClickRef.current) {
      suppressNextHeaderClickRef.current = false;
      return;
    }
    openColumnMenu(index, event.currentTarget);
  };

  const handleColumnHeaderContextMenu = (index: number, event: ReactMouseEvent<HTMLTableCellElement>) => {
    event.preventDefault();
    event.stopPropagation();
    suppressNextHeaderClickRef.current = false;
    openColumnMenu(index, event.currentTarget);
  };

  const appendViewColumn = (rule: ViewColumnRule) => {
    onViewChange?.({
      ...activeView,
      columns: [...activeView.columns, rule],
    });
  };

  const createSourceColumn = async (name: string, type: DatabaseColumnType, config?: Record<string, any>) => {
    if (!schema || readonly) return;
    const title = name.trim() || defaultColumnName(type);
    const nextConfig = type === 'date' ? { date_format: 'chinese', time_format: 'none', timezone: 'GMT+8', date_content: 'date', include_time: false, hour12: false, ...(config || {}) } : config;
    const nextSchema = await databasesApi.addColumn(spaceSlug, dbId, { name: title, type, config: nextConfig });
    applySchema(nextSchema);
    const created = [...nextSchema.columns].reverse().find((column) => column.name === title && column.type === type) || nextSchema.columns[nextSchema.columns.length - 1];
    if (created) {
      appendViewColumn({ property: created.id, width: 150 });
    }
    setAddColumnOpen(false);
    requestDatabaseImmediateSync();
  };

  const columnWidth = (column: typeof visibleColumns[number], index: number) => columnWidthDrafts[column.id] || column.rule.width || (index === 0 ? 280 : 200);

  const updateViewColumn = (index: number, patch: Partial<ViewColumnRule>) => {
    const target = visibleColumns[index];
    if (!target) return;
    const nextVisible = visibleColumns.map((column, i) => i === index ? { ...column, rule: { ...column.rule, ...patch } } : column);
    commitVisibleColumnRules(nextVisible);
  };

  const changeColumnType = async (index: number, type: DatabaseColumnType) => {
    const target = visibleColumns[index];
    if (!target?.column || readonly || target.column.readonly) return;
    const nextSchema = await databasesApi.updateColumn(spaceSlug, dbId, target.column.id, { type });
    applySchema(nextSchema);
    closeColumnMenu();
    requestDatabaseImmediateSync();
  };

  const changeColumnIcon = async (index: number, icon: string) => {
    const target = visibleColumns[index];
    if (!target?.column || readonly || target.column.readonly) return;
    const nextSchema = await databasesApi.updateColumn(spaceSlug, dbId, target.column.id, { icon });
    applySchema(nextSchema);
    requestDatabaseImmediateSync();
  };

  const changeColumnName = async (index: number, name: string) => {
    const target = visibleColumns[index];
    const nextName = name.trim();
    if (!target?.column || readonly || target.column.readonly || !nextName || nextName === target.column.name) return;
    const nextSchema = await databasesApi.updateColumn(spaceSlug, dbId, target.column.id, { name: nextName });
    applySchema(nextSchema);
    requestDatabaseImmediateSync();
  };

  const requestDeleteSourceColumn = (index: number) => {
    const target = visibleColumns[index];
    if (!target?.column || readonly) return;
    setPendingDeleteColumn(target.column);
    closeColumnMenu();
  };

  const confirmDeleteSourceColumn = async () => {
    if (!pendingDeleteColumn || readonly) return;
    setDeletingColumn(true);
    try {
      const nextSchema = await databasesApi.deleteColumn(spaceSlug, dbId, pendingDeleteColumn.id);
      applySchema(nextSchema);
      onViewChange?.(removeColumnFromView(activeView, pendingDeleteColumn.id));
      setPendingDeleteColumn(null);
      requestDatabaseImmediateSync();
    } finally {
      setDeletingColumn(false);
    }
  };

  const commitVisibleColumnRules = (nextVisibleColumns: typeof visibleColumns) => {
    const visibleRuleIDs = new Set(visibleColumns.map((column) => column.rule));
    const hiddenRules = activeView.columns.filter((rule) => rule.hidden && !visibleRuleIDs.has(rule));
    onViewChange?.({
      ...activeView,
      columns: [...nextVisibleColumns.map((column) => column.rule), ...hiddenRules],
    });
  };

  const reorderColumn = (sourceIndex: number, targetIndex: number) => {
    if (readonly || sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0 || sourceIndex >= visibleColumns.length || targetIndex >= visibleColumns.length) return;
    const next = [...visibleColumns];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    commitVisibleColumnRules(next);
  };

  const beginColumnDrag = (index: number, event: ReactPointerEvent<HTMLTableCellElement>) => {
    if (event.button !== 0) return;
    const row = event.currentTarget.closest('tr') as HTMLTableRowElement | null;
    const cell = event.currentTarget;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.akdb-col-resizer')) return;
    if (readonly || !columnControls || !row || !cell) return;
    if (visibleColumns.length < 2) return;

    const rowRect = row.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('th[data-column-index]'));
    const cellRects = cells.map((item) => item.getBoundingClientRect());
    const firstRect = cellRects[0];
    const lastRect = cellRects[cellRects.length - 1];
    const initialLeft = cellRect.left - rowRect.left;
    const columnWidth = cellRect.width;
    const centers = cellRects.map((rect) => rect.left - rowRect.left + rect.width / 2);
    const clipLeft = Math.max(0, firstRect.left - rowRect.left);
    const clipRight = Math.max(0, rowRect.right - lastRect.right);
    const baseState = {
      sourceIndex: index,
      targetIndex: index,
      pointerOffset: event.clientX - cellRect.left,
      minLeft: firstRect.left - rowRect.left,
      maxLeft: Math.max(firstRect.left - rowRect.left, lastRect.right - rowRect.left - columnWidth),
      initialLeft,
      currentLeft: initialLeft,
      columnWidth,
      clipLeft,
      clipRight,
      centers,
    };
    const startClientX = event.clientX;
    let hasDragged = false;

    const updateDrag = (clientX: number) => {
      if (!hasDragged && Math.abs(clientX - startClientX) > 4) {
        hasDragged = true;
        columnDragStateRef.current = baseState;
        setColumnDragState(baseState);
      }
      if (!hasDragged) return;
      setColumnDragState((current) => {
        if (!current) return current;
        const currentLeft = Math.min(current.maxLeft, Math.max(current.minLeft, clientX - rowRect.left - current.pointerOffset));
        const currentCenter = currentLeft + current.columnWidth / 2;
        const targetIndex = current.centers.findIndex((center) => currentCenter <= center);
        const next = {
          ...current,
          currentLeft,
          targetIndex: targetIndex === -1 ? current.centers.length - 1 : targetIndex,
        };
        columnDragStateRef.current = next;
        return next;
      });
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateDrag(moveEvent.clientX);
      if (hasDragged) moveEvent.preventDefault();
    };
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      const finalSource = columnDragStateRef.current?.sourceIndex ?? index;
      const finalTarget = columnDragStateRef.current?.targetIndex ?? index;
      flushSync(() => {
        columnDragStateRef.current = null;
        setColumnDragState(null);
        if (hasDragged && finalSource !== finalTarget) reorderColumn(finalSource, finalTarget);
      });
      if (hasDragged) {
        suppressNextHeaderClickRef.current = true;
        window.setTimeout(() => {
          suppressNextHeaderClickRef.current = false;
        }, 0);
      }
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const columnDragTransform = (index: number) => {
    const state = columnDragState;
    if (!state) return undefined;
    if (index === state.sourceIndex) return `translateX(${state.currentLeft - state.initialLeft}px)`;
    if (state.sourceIndex < state.targetIndex && index > state.sourceIndex && index <= state.targetIndex) return `translateX(${-state.columnWidth}px)`;
    if (state.targetIndex < state.sourceIndex && index >= state.targetIndex && index < state.sourceIndex) return `translateX(${state.columnWidth}px)`;
    return undefined;
  };

  const resizeColumn = (event: ReactPointerEvent, column: typeof visibleColumns[number], index: number) => {
    if (readonly || !columnControls) return;
    event.preventDefault();
    event.stopPropagation();
    suppressNextHeaderClickRef.current = true;
    const startX = event.clientX;
    const startWidth = columnWidth(column, index);
    resizeColumnRef.current = { id: column.id, startX, startWidth };
    const handleMove = (moveEvent: PointerEvent) => {
      const state = resizeColumnRef.current;
      if (!state) return;
      const width = Math.max(80, Math.round(state.startWidth + moveEvent.clientX - state.startX));
      setColumnWidthDrafts((prev) => ({ ...prev, [state.id]: width }));
    };
    const handleUp = (upEvent: PointerEvent) => {
      const state = resizeColumnRef.current;
      if (state) {
        const width = Math.max(80, Math.round(state.startWidth + upEvent.clientX - state.startX));
        const next = visibleColumns.map((item) => item.id === state.id ? { ...item, rule: { ...item.rule, width } } : item);
        commitVisibleColumnRules(next);
      }
      resizeColumnRef.current = null;
      setColumnWidthDrafts((prev) => {
        const next = { ...prev };
        if (state) delete next[state.id];
        return next;
      });
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      window.setTimeout(() => {
        suppressNextHeaderClickRef.current = false;
      }, 0);
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp, { once: true });
  };
  const tableMinWidth = visibleColumns.reduce((total, column, index) => total + columnWidth(column, index), showColumnControls ? 64 : 0);
  const columnMenuColumn = columnMenuIndex == null ? undefined : visibleColumns[columnMenuIndex];
  const selectableRowCount = displayRowIDs.length;
  const selectedVisibleRowCount = displayRowIDs.filter((id) => selectedRowIDs.has(id)).length;
  const allVisibleRowsSelected = selectableRowCount > 0 && selectedVisibleRowCount === selectableRowCount;
  const someVisibleRowsSelected = selectedVisibleRowCount > 0;

  const toggleAllVisibleRows = () => {
    clearEditorBlockSelection();
    setSelectedRowIDs(allVisibleRowsSelected ? new Set() : new Set(displayRowIDs));
  };

  if (loading) return <div className="akdb-empty">加载中...</div>;
  if (!schema) return <>{missingState || <div className="akdb-empty">数据源已丢失</div>}</>;

  if (activeView.type === 'board') {
    const groupCol = schema.columns.find((c) => c.id === activeView.groupBy) || schema.columns.find((c) => c.type === 'status' || c.type === 'select');
    const options = (groupCol?.config?.options || []) as Array<{ id: string; value: string; color?: string }>;
    const groups = options.length ? options : [{ id: '', value: '未分组' }];
    return (
      <Frame title={schema.name} icon={<Columns3 size={15} />} onAdd={() => createRow(groupCol ? { [groupCol.id]: groups[0]?.id || '' } : {})} readonly={readonly}>
        <div className="akdb-board">
          {groups.map((g) => (
            <div className="akdb-board-col" key={g.id}>
              <div className="akdb-board-head">{g.value}<button onClick={() => createRow(groupCol ? { [groupCol.id]: g.id } : {})}><Plus size={13} /></button></div>
              {displayRows.filter(({ row }) => !groupCol || (row.values[groupCol.id] || '') === g.id).map(({ row, display }) => (
                <button key={row.uuid} className="akdb-card" onClick={() => onOpenRow?.(row.uuid)}>
                  {visibleColumns.slice(0, 3).map((c) => <span key={c.id}>{c.name}: {displayText(display[c.id], c.column)}</span>)}
                </button>
              ))}
            </div>
          ))}
        </div>
      </Frame>
    );
  }

  if (activeView.type === 'gallery') {
    const coverCol = schema.columns.find((c) => c.id === activeView.cover);
    return (
      <Frame title={schema.name} icon={<Image size={15} />} onAdd={() => createRow()} readonly={readonly}>
        <div className={`akdb-gallery is-${activeView.cardSize || 'medium'}`}>
          {displayRows.map(({ row, display }) => (
            <button className="akdb-gallery-card" key={row.uuid} onClick={() => onOpenRow?.(row.uuid)}>
              {coverCol && row.values[coverCol.id] ? <img src={row.values[coverCol.id]} alt="" /> : <div className="akdb-cover-empty" />}
              <strong>{displayText(display[visibleColumns[0]?.id], visibleColumns[0]?.column) || row.uuid.slice(0, 8)}</strong>
              {visibleColumns.slice(1, 4).map((c) => <span key={c.id}>{c.name}: {displayText(display[c.id], c.column)}</span>)}
            </button>
          ))}
        </div>
      </Frame>
    );
  }

  if (activeView.type === 'list') {
    return (
      <Frame title={schema.name} icon={<List size={15} />} onAdd={() => createRow()} readonly={readonly}>
        <div className="akdb-list">
          {displayRows.map(({ row, display }) => (
            <button key={row.uuid} className="akdb-list-row" onClick={() => onOpenRow?.(row.uuid)}>
              <strong>{displayText(display[visibleColumns[0]?.id], visibleColumns[0]?.column) || row.uuid.slice(0, 8)}</strong>
              {visibleColumns.slice(1, 4).map((c) => <span key={c.id}>{c.name}: {displayText(display[c.id], c.column)}</span>)}
            </button>
          ))}
        </div>
      </Frame>
    );
  }

  if (activeView.type === 'calendar') {
    const dateCol = schema.columns.find((c) => c.id === activeView.date) || schema.columns.find((c) => c.type === 'date');
    const byDay = new Map<string, DatabaseRow[]>();
    for (const r of rows) {
      const day = dateCol ? dateGroupKey(r.values[dateCol.id]) : '未排期';
      byDay.set(day, [...(byDay.get(day) || []), r]);
    }
    return (
      <Frame title={schema.name} icon={<CalendarDays size={15} />} onAdd={() => createRow()} readonly={readonly}>
        <div className="akdb-calendar">
          {Array.from(byDay.entries()).map(([day, rs]) => <div className="akdb-day" key={day}><b>{day}</b>{rs.map((r) => <button onClick={() => onOpenRow?.(r.uuid)} key={r.uuid}>{r.values[visibleColumns[0]?.id] || r.uuid.slice(0, 8)}</button>)}</div>)}
        </div>
      </Frame>
    );
  }

  if (activeView.type === 'timeline') {
    const startCol = schema.columns.find((c) => c.id === activeView.startDate) || schema.columns.find((c) => c.type === 'date');
    const endCol = schema.columns.find((c) => c.id === activeView.endDate);
    return (
      <Frame title={schema.name} icon={<Workflow size={15} />} onAdd={() => createRow()} readonly={readonly}>
        <div className="akdb-timeline">
          {rows.map((r) => <button key={r.uuid} onClick={() => onOpenRow?.(r.uuid)}><strong>{r.values[visibleColumns[0]?.id] || r.uuid.slice(0, 8)}</strong><span>{startCol ? formatDateValue(r.values[startCol.id], startCol) : ''} - {endCol ? formatDateValue(r.values[endCol.id], endCol) : ''}</span></button>)}
        </div>
      </Frame>
    );
  }

  if (activeView.type === 'chart' || activeView.type === 'activity' || activeView.type === 'map') {
    const meta = {
      chart: { label: '图表', icon: <PieChart size={15} /> },
      activity: { label: '动态', icon: <Activity size={15} /> },
      map: { label: '地图', icon: <MapIcon size={15} /> },
    }[activeView.type];
    return (
      <Frame title={schema.name} icon={meta.icon} onAdd={() => createRow()} readonly={readonly}>
        <div className="akdb-view-placeholder">
          <strong>{meta.label}视图</strong>
          <span>视图框架已就绪，具体展示能力待完善。</span>
        </div>
      </Frame>
    );
  }

  return (
    <div className="akdb-frame">
      <div className="akdb-table-shell">
        {visibleColumns.length > 0 && (
          <div className="akdb-row-gutter" aria-hidden={readonly ? 'true' : undefined}>
            {!readonly && selectableRowCount > 0 && (
              <div className={`akdb-row-gutter-item akdb-row-gutter-head ${someVisibleRowsSelected ? 'is-checkbox-visible' : ''}`} style={{ top: 0 }}>
                <span className="akdb-row-selector">
                  <button
                    type="button"
                    className={`akdb-row-checkbox akdb-row-select-all ${someVisibleRowsSelected ? 'is-checked' : ''}`}
                    aria-label={allVisibleRowsSelected ? '取消选择所有行' : '选择所有行'}
                    aria-pressed={allVisibleRowsSelected}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleAllVisibleRows();
                    }}
                  >
                    {allVisibleRowsSelected ? <Check size={12} strokeWidth={2.4} /> : someVisibleRowsSelected ? <span aria-hidden="true" className="akdb-row-checkbox-minus" /> : null}
                  </button>
                </span>
              </div>
            )}
            {displayRows.map(({ row }, index) => {
              const selected = selectedRowIDs.has(row.uuid);
              const menuOpenForRow = rowContextMenu?.row.uuid === row.uuid;
              const controlsVisible = hoveredRowID === row.uuid || menuOpenForRow;
              const checkboxVisible = selected || controlsVisible;
              const isDraggingRow = rowDragState?.sourceRowID === row.uuid;
              return (
                <div
                  key={row.uuid}
                  className={`akdb-row-gutter-item ${controlsVisible ? 'is-controls-visible' : ''} ${checkboxVisible ? 'is-checkbox-visible' : ''} ${isDraggingRow ? 'is-row-dragging' : ''}`}
                  style={{ top: 36 + index * 36 }}
                  onMouseEnter={() => setHoveredRowID(row.uuid)}
                  onMouseLeave={() => setHoveredRowID((current) => current === row.uuid ? null : current)}
                >
                  <span className="akdb-row-selector">
                    <button
                      type="button"
                      className="akdb-row-add"
                      aria-label="添加行"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        await createRowBelow(row.uuid);
                      }}
                    />
                    <button
                      type="button"
                      className="akdb-row-drag-handle"
                      aria-label="拖拽排序或打开菜单"
                      onPointerDown={(event) => beginRowDrag(row, index, event)}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                    />
                    <button
                      type="button"
                      className={`akdb-row-checkbox ${selected ? 'is-checked' : ''}`}
                      aria-label="选择行"
                      aria-pressed={selected}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleRowSelection(row.uuid);
                      }}
                    >
                      {selected && <Check size={12} strokeWidth={2.4} />}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div ref={tableWrapRef} className="akdb-table-wrap" tabIndex={-1} onPointerDownCapture={beginCellPointerFromTable}>
          <table
            className={[
              'akdb-table',
              activeView.showVerticalLines === false ? 'is-hide-vertical-lines' : '',
              activeView.wrapContent ? 'is-wrap-content' : '',
            ].filter(Boolean).join(' ')}
            style={{ minWidth: tableMinWidth }}
          >
            <colgroup>
              {visibleColumns.map((c, index) => <col key={c.id} style={{ width: columnWidth(c, index) }} />)}
              {showColumnControls && <col style={{ width: 64 }} />}
              {showFillColumn && <col />}
            </colgroup>
            <thead
              className={columnDragState ? 'is-column-dragging' : undefined}
              style={columnDragState ? { clipPath: `inset(0 ${columnDragState.clipRight}px 0 ${columnDragState.clipLeft}px)` } : undefined}
            >
              <tr>
                {visibleColumns.map((c, index) => (
                  <th
                    key={c.id}
                    data-column-index={index}
                    className={columnDragState?.sourceIndex === index ? 'is-dragging' : undefined}
                    style={{ transform: columnDragTransform(index), transition: columnDragState?.sourceIndex === index ? 'none' : undefined }}
                    onPointerDown={showColumnControls ? (event) => beginColumnDrag(index, event) : undefined}
                    onClick={showColumnControls ? (event) => handleColumnHeaderClick(index, event) : undefined}
                    onContextMenu={showColumnControls ? (event) => handleColumnHeaderContextMenu(index, event) : undefined}
                  >
                    <span className="akdb-col-head">
                      <span className="akdb-col-type"><ColumnIconGlyph icon={columnIconID(c.column)} /></span>
                      <span>{c.name}</span>
                    </span>
                    {showColumnControls && (
                      <span
                        className="akdb-col-resizer"
                        role="separator"
                        aria-orientation="vertical"
                        onPointerDown={(event) => resizeColumn(event, c, index)}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                      />
                    )}
                  </th>
                ))}
                {showColumnControls && (
                  <th className="akdb-action-cell">
                    <span className="akdb-column-actions">
                      <button
                        ref={addColumnButtonRef}
                        type="button"
                        aria-label="新增字段"
                        aria-haspopup="dialog"
                        aria-expanded={addColumnOpen}
                        onClick={() => {
                          setAddColumnOpen((open) => !open);
                        }}
                      >
                        <Plus size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label="显示或隐藏字段"
                        aria-haspopup="dialog"
                        onClick={() => {
                          setAddColumnOpen(false);
                          onOpenViewSettings?.('visibility');
                        }}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    </span>
                    {addColumnOpen && addColumnMenuRect && schema && createPortal(
                      <AddColumnMenu
                        spaceSlug={spaceSlug}
                        schema={schema}
                        onCreateSource={createSourceColumn}
                        style={addColumnMenuRect}
                      />,
                      document.body,
                    )}
                  </th>
                )}
                {showFillColumn && <th className="akdb-fill-cell" aria-hidden="true" />}
              </tr>
            </thead>
            <tbody
              className={columnDragState ? 'is-column-dragging' : undefined}
              style={columnDragState ? { clipPath: `inset(0 ${columnDragState.clipRight}px 0 ${columnDragState.clipLeft}px)` } : undefined}
            >
            {visibleColumns.length > 0 && displayRows.map(({ row, display }, rowIndex) => (
              <tr
                key={row.uuid}
                data-akdb-row-id={row.uuid}
                className={`${rowContextMenu?.row.uuid === row.uuid ? 'is-context-selected' : ''} ${selectedRowIDs.has(row.uuid) ? 'is-row-selected' : ''} ${rowDragState?.targetRowID === row.uuid ? 'is-row-drop-target' : ''}`}
                onMouseEnter={() => setHoveredRowID(row.uuid)}
                onMouseLeave={() => setHoveredRowID((current) => current === row.uuid ? null : current)}
                onContextMenu={(event) => openRowContextMenu(row, event)}
              >
                {visibleColumns.map((c, index) => {
                  const coord = { rowIndex, colIndex: index };
                  const isActive = sameCell(activeCell, coord);
                  const isEditing = sameCell(editingCell, coord);
                  const isSelected = !isEditing && cellInRange(coord, fillRange || cellRange);
                  const isFillSelected = !isEditing && cellInRange(coord, fillRange);
                  const cellValue = c.column?.type === 'formula' ? String(display[c.id] ?? '') : String(row.values?.[c.column!.id] ?? '');
                  return (
                  <EditableCell
                    key={c.id}
                    value={cellValue}
                    column={c.column}
                    align={c.rule.align}
                    readonly={readonly || c.column?.type === 'formula' || !!c.rule.readonly}
                    active={isActive}
                    editingActive={isEditing}
                    rangeSelected={isSelected}
                    fillSelected={isFillSelected}
                    onChange={(v) => updateCell(row.uuid, c.column, v)}
                    onEditStateChange={(editing) => {
                      if (editing) {
                        clearEditorBlockSelection();
                        setSelectedRowIDs(new Set());
                        setActiveCell(coord);
                        setCellRange({ anchor: coord, focus: coord });
                        setFillRange(null);
                        setEditingCell(coord);
                        return;
                      }
                      setEditingCell((current) => {
                        if (!sameCell(current, coord)) return current;
                        recentlyClosedEditingCellRef.current = coord;
                        window.setTimeout(() => {
                          if (sameCell(recentlyClosedEditingCellRef.current, coord)) recentlyClosedEditingCellRef.current = null;
                        }, 0);
                        return null;
                      });
                    }}
                    onFillPointerDown={(event) => beginFillDrag(coord, event)}
                    onCreateOption={(label) => c.column ? createColumnOption(c.column, label) : Promise.resolve(null)}
                    onReorderOption={(sourceID, targetID) => c.column ? reorderColumnOption(c.column, sourceID, targetID) : Promise.resolve()}
                    onUpdateOption={(optionID, patch) => c.column ? updateColumnOption(c.column, optionID, patch) : Promise.resolve()}
                    onDeleteOption={(optionID) => c.column ? deleteColumnOption(c.column, optionID) : Promise.resolve()}
                    onUpdateColumnConfig={(patch) => c.column ? updateColumnConfig(c.column, patch) : Promise.resolve()}
                    onEditProperty={(anchor) => openColumnMenu(index, anchor)}
                    cellProps={{
                      className: [
                        columnDragState?.sourceIndex === index ? 'is-dragging' : '',
                        isActive && !isEditing ? 'is-akdb-cell-active' : '',
                        isSelected ? 'is-akdb-cell-selected' : '',
                        isFillSelected ? 'is-akdb-cell-fill-selected' : '',
                      ].filter(Boolean).join(' ') || undefined,
                      'data-akdb-row-index': rowIndex,
                      'data-akdb-col-index': index,
                      'data-akdb-row-id': row.uuid,
                      'data-akdb-col-id': c.column?.id,
                      onClickCapture: (event) => {
                        if (!suppressNextCellClickRef.current) return;
                        suppressNextCellClickRef.current();
                        event.preventDefault();
                        event.stopPropagation();
                      },
                      style: {
                        transform: columnDragTransform(index),
                        transition: columnDragState?.sourceIndex === index ? 'none' : undefined,
                      },
                    } as TdHTMLAttributes<HTMLTableCellElement> & Record<string, any>}
                  />
                );})}
                {showColumnControls && <td className="akdb-action-cell" />}
                {showFillColumn && <td className="akdb-fill-cell" aria-hidden="true" />}
              </tr>
            ))}
            {!readonly && (
              <tr className="akdb-add-row">
                <td colSpan={visibleColumns.length + (showColumnControls ? 1 : 0) + (showFillColumn ? 1 : 0)}>
                  <button type="button" onClick={() => createRow()}><Plus size={15} />新页面</button>
                </td>
              </tr>
            )}
          </tbody>
          </table>
        </div>
        {columnMenuColumn && columnMenuRect && createPortal(
          <ColumnHeaderMenu
            column={columnMenuColumn}
            index={columnMenuIndex!}
            typeOpen={columnMenuSubmenu === 'type'}
            propertyOpen={columnMenuSubmenu === 'property'}
            style={columnMenuRect}
            onOpenType={() => setColumnMenuSubmenu('type')}
            onCloseType={() => setColumnMenuSubmenu((current) => current === 'type' ? null : current)}
            onOpenProperty={() => setColumnMenuSubmenu('property')}
            onCloseProperty={() => setColumnMenuSubmenu((current) => current === 'property' ? null : current)}
            onChangeType={(type) => changeColumnType(columnMenuIndex!, type)}
            onChangeIcon={(icon) => changeColumnIcon(columnMenuIndex!, icon)}
            onChangeName={(name) => changeColumnName(columnMenuIndex!, name)}
            onCreateOption={(label) => {
              if (!columnMenuColumn.column) return Promise.resolve(null);
              return createColumnOption(columnMenuColumn.column, label);
            }}
            onUpdateOption={(optionID, patch) => {
              if (columnMenuColumn.column) void updateColumnOption(columnMenuColumn.column, optionID, patch);
            }}
            onReorderOption={(sourceID, targetID) => {
              if (columnMenuColumn.column) void reorderColumnOption(columnMenuColumn.column, sourceID, targetID);
            }}
            onDeleteOption={(optionID) => {
              if (columnMenuColumn.column) void deleteColumnOption(columnMenuColumn.column, optionID);
            }}
            onUpdateConfig={(patch) => {
              if (columnMenuColumn.column) void updateColumnConfig(columnMenuColumn.column, patch);
            }}
            onFilter={() => {
              if (columnMenuColumn.column) onAddFilterColumn?.(columnMenuColumn.column);
              closeColumnMenu();
            }}
            onSort={() => {
              if (columnMenuColumn.column) onAddSortColumn?.(columnMenuColumn.column);
              closeColumnMenu();
            }}
            onToggleReadonly={() => updateViewColumn(columnMenuIndex!, { readonly: !columnMenuColumn.rule.readonly })}
            onChangeAlign={(align) => updateViewColumn(columnMenuIndex!, { align })}
            onHide={() => {
              updateViewColumn(columnMenuIndex!, { hidden: true });
              closeColumnMenu();
            }}
            onDelete={() => requestDeleteSourceColumn(columnMenuIndex!)}
          />,
          document.body,
        )}
        {rowContextMenu && createPortal(
          <DatabaseRowContextMenu
            ref={rowContextMenuRef}
            row={rowContextMenu.row}
            style={{ top: rowContextMenu.top, left: rowContextMenu.left }}
            onOpen={() => {
              onOpenRow?.(rowContextMenu.row.uuid);
              closeRowContextMenu();
            }}
            onCopyLink={() => void copyRowLink(rowContextMenu.row)}
            onDuplicate={() => void duplicateRow(rowContextMenu.row)}
            onDelete={() => void deleteRowById(rowContextMenu.row.uuid)}
          />,
          document.body,
        )}
        {rowDragPreview && createPortal(
          <div
            className="akdb-row-drag-preview"
            style={{
              left: rowDragPreview.left,
              top: rowDragPreview.top,
              width: rowDragPreview.width,
              height: rowDragPreview.height,
            }}
          >
            {rowDragPreview.cells.map((cell, index) => (
              <span key={index} style={{ width: cell.width }}>{cell.text}</span>
            ))}
          </div>,
          document.body,
        )}
        {pendingDeleteColumn && createPortal(
          <DeleteColumnDialog
            column={pendingDeleteColumn}
            loading={deletingColumn}
            onCancel={() => {
              if (!deletingColumn) setPendingDeleteColumn(null);
            }}
            onConfirm={confirmDeleteSourceColumn}
          />,
          document.body,
        )}
        {pendingDeleteRows && createPortal(
          <DeleteRowsDialog
            count={pendingDeleteRows.length}
            loading={deletingRows}
            onCancel={() => {
              if (!deletingRows) setPendingDeleteRows(null);
            }}
            onConfirm={confirmDeleteRows}
          />,
          document.body,
        )}
      </div>
    </div>
  );
}

function columnIconID(column?: DatabaseColumn) {
  return column?.icon || defaultColumnIconID(column);
}

function DeleteColumnDialog({ column, loading, onCancel, onConfirm }: { column: DatabaseColumn; loading: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="akdb-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="akdb-bind-dialog akdb-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="akdb-delete-column-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="akdb-bind-dialog-title" id="akdb-delete-column-title">删除列</div>
        <div className="akdb-bind-dialog-body">
          <span>确定要删除「{column.name}」列吗？</span>
          <span>这会从数据源中永久删除该列及所有行里的对应数据，不能通过视图设置恢复。</span>
        </div>
        <div className="akdb-bind-dialog-actions">
          <button type="button" className="akdb-dialog-ghost" disabled={loading} onClick={onCancel}>取消</button>
          <button type="button" className="akdb-dialog-danger" disabled={loading} onClick={onConfirm}>
            {loading ? '删除中...' : '删除'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteRowsDialog({ count, loading, onCancel, onConfirm }: { count: number; loading: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="akdb-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="akdb-bind-dialog akdb-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="akdb-delete-rows-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="akdb-bind-dialog-title" id="akdb-delete-rows-title">删除行</div>
        <div className="akdb-bind-dialog-body">
          <span>确定要删除选中的 {count} 行吗？</span>
          <span>这些行对应的数据页会进入回收站，可以之后恢复。</span>
        </div>
        <div className="akdb-bind-dialog-actions">
          <button type="button" className="akdb-dialog-ghost" disabled={loading} onClick={onCancel}>取消</button>
          <button type="button" className="akdb-dialog-danger" disabled={loading} onClick={onConfirm}>
            {loading ? '删除中...' : '删除'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function defaultColumnIconID(column?: DatabaseColumn) {
  if (!column) return 'type_formula';
  if (column.type === 'text') return column.config?.secret ? 'type_secret' : 'type_text';
  if (column.type === 'number') return 'type_number';
  if (column.type === 'select') return 'type_select';
  if (column.type === 'multi_select') return 'type_multi_select';
  if (column.type === 'status') return 'type_status';
  if (column.type === 'date' || column.type === 'created_time' || column.type === 'last_edited_time') return 'type_date';
  if (column.type === 'last_edited_user') return 'type_user';
  if (column.type === 'checkbox') return 'type_checkbox';
  if (column.type === 'url') return 'type_url';
  if (column.type === 'formula') return 'type_formula';
  if (column.type === 'relation' || column.type === 'linked') return 'type_relation';
  return 'type_text';
}

function viewColumnID(rule: ViewColumnRule, index: number) {
  if (rule.property) return `property:${rule.property}:${index}`;
  return '';
}

function buildFormulaProps(columns: DatabaseColumn[], row: DatabaseRow) {
  const props: Record<string, any> = { ...row.values, uuid: row.uuid };
  for (const column of columns) {
    if (column.type === 'formula') continue;
    const value = row.values[column.id] ?? '';
    props[column.id] = value;
    if (column.name) props[column.name] = value;
  }
  for (const column of columns) {
    if (column.type !== 'formula') continue;
    const formula = String(column.config?.formula || '""');
    const value = evalFormula(formula, props);
    props[column.id] = value;
    if (column.name) props[column.name] = value;
  }
  return props;
}

function applyViewFilters<T extends { row: DatabaseRow; props: Record<string, any> }>(items: T[], columns: DatabaseColumn[], view: DatabaseViewConfig): T[] {
  const filters = (view.filters || []).filter((rule) => rule.property);
  const advancedFilter = view.advancedFilter;
  if (!filters.length && !advancedFilter) return items;
  const byID = new Map(columns.map((column) => [column.id, column]));
  return items.filter((item) => {
    const matchesFlat = filters.every((filter) => matchesFilterRule(item, byID, filter));
    return matchesFlat && (!advancedFilter || matchesAdvancedFilterGroup(item, byID, advancedFilter));
  });
}

function matchesFilterRule(item: { row: DatabaseRow; props: Record<string, any> }, byID: Map<string, DatabaseColumn>, filter: { property: string; op: string; value?: unknown }) {
  const column = byID.get(filter.property);
  const raw = item.props[filter.property] ?? item.row.values[filter.property] ?? '';
  return matchesViewFilter(raw, column, filter.op, filter.value);
}

function matchesAdvancedFilterGroup(item: { row: DatabaseRow; props: Record<string, any> }, byID: Map<string, DatabaseColumn>, group: ViewAdvancedFilterGroup): boolean {
  const children = group.children.filter((node) => node.type === 'group' || node.rule.property);
  if (!children.length) return true;
  const matches = (node: ViewAdvancedFilterNode) => node.type === 'group'
    ? matchesAdvancedFilterGroup(item, byID, node)
    : matchesFilterRule(item, byID, node.rule);
  return group.op === 'or' ? children.some(matches) : children.every(matches);
}

function matchesViewFilter(raw: unknown, column: DatabaseColumn | undefined, op: string, value: unknown) {
  const text = String(raw ?? '').trim();
  const empty = isEmptyDatabaseFilterValue(text, column);
  if (op === 'is_empty') return empty;
  if (op === 'is_not_empty') return !empty;
  if (column?.type === 'date' || column?.type === 'created_time' || column?.type === 'last_edited_time') {
    if (op === 'relative_to_today') return matchesRelativeDateFilter(text, String(value || 'this_week'));
    return matchesDateFilter(text, op, value);
  }
  if (column?.type === 'checkbox') {
    const matched = String(value) === 'false' ? text !== 'true' : text === 'true';
    return op === 'not_equals' ? !matched : matched;
  }
  if (column?.type === 'select' || column?.type === 'status') {
    const selected = Array.isArray(value) ? value.map(String) : String(value || '').split(',').filter(Boolean);
    if (!selected.length) return true;
    const matched = selected.includes(text);
    return op === 'not_equals' ? !matched : matched;
  }
  if (column?.type === 'multi_select') {
    const selected = Array.isArray(value) ? value.map(String) : String(value || '').split(',').filter(Boolean);
    if (!selected.length) return true;
    const values = parseMultiSelectValue(text);
    const matched = selected.some((id) => values.includes(id));
    return op === 'not_contains' || op === 'not_equals' ? !matched : matched;
  }
  const needle = String(value ?? '').trim().toLowerCase();
  if (!needle) return true;
  if (op === 'equals') return text.toLowerCase() === needle;
  if (op === 'not_equals') return text.toLowerCase() !== needle;
  if (op === 'not_contains') return !text.toLowerCase().includes(needle);
  if (op === 'starts_with') return text.toLowerCase().startsWith(needle);
  if (op === 'ends_with') return text.toLowerCase().endsWith(needle);
  return text.toLowerCase().includes(needle);
}

function matchesDateFilter(text: string, op: string, value: unknown) {
  const date = parseDatabaseFilterDate(text);
  if (!date) return false;
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (op === 'between') {
    const values = Array.isArray(value) ? value : String(value || '').split(',').filter(Boolean);
    const start = parseDatabaseFilterDate(String(values[0] || ''));
    const end = parseDatabaseFilterDate(String(values[1] || ''));
    if (!start || !end) return true;
    const startTime = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const endTime = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    return day >= Math.min(startTime, endTime) && day <= Math.max(startTime, endTime);
  }
  const target = parseDatabaseFilterDate(String(value || ''));
  if (!target) return true;
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  if (op === 'before') return day < targetDay;
  if (op === 'after') return day > targetDay;
  if (op === 'on_or_before') return day <= targetDay;
  if (op === 'on_or_after') return day >= targetDay;
  if (op === 'not_equals') return day !== targetDay;
  return day === targetDay;
}

function matchesRelativeDateFilter(text: string, value: string) {
  const date = parseDatabaseFilterDate(text);
  if (!date) return false;
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const range = relativeDateFilterRange(value);
  return day >= range.start && day <= range.end;
}

function parseDatabaseFilterDate(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const shortcut = resolveDatabaseDateShortcut(raw);
  if (shortcut) return shortcut;
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return new Date(n * 1000);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function resolveDatabaseDateShortcut(value: string) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (value === 'date_shortcut:today') return start;
  if (value === 'date_shortcut:tomorrow') return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  if (value === 'date_shortcut:yesterday') return new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
  if (value === 'date_shortcut:last_week') return new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7);
  if (value === 'date_shortcut:next_week') return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  if (value === 'date_shortcut:last_month') return addDatabaseFilterMonths(start, -1);
  if (value === 'date_shortcut:next_month') return addDatabaseFilterMonths(start, 1);
  return null;
}

function addDatabaseFilterMonths(date: Date, months: number) {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), maxDay));
}

function relativeDateFilterRange(value: string) {
  const parts = value.split('_');
  const rawPrefix = parts[0];
  const rawCount = /^\d+$/.test(parts[1] || '') ? Number(parts[1]) : 1;
  const rawUnit = /^\d+$/.test(parts[1] || '') ? parts[2] : parts[1];
  const prefix = rawPrefix === 'last' || rawPrefix === 'next' || rawPrefix === 'past' || rawPrefix === 'future' ? rawPrefix : 'this';
  const unit = rawUnit === 'day' || rawUnit === 'month' || rawUnit === 'year' ? rawUnit : 'week';
  const count = Math.max(1, rawCount || 1);
  const today = new Date();
  let start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let end = start;
  if (prefix === 'past') return { start: new Date(start.getFullYear(), start.getMonth(), start.getDate() - relativeDateUnitDays(unit, count)), end: start };
  if (prefix === 'future') return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + relativeDateUnitDays(unit, count)) };
  if (unit === 'week') {
    const offset = (start.getDay() + 6) % 7;
    start = new Date(start.getFullYear(), start.getMonth(), start.getDate() - offset);
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  } else if (unit === 'month') {
    start = new Date(start.getFullYear(), start.getMonth(), 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  } else if (unit === 'year') {
    start = new Date(start.getFullYear(), 0, 1);
    end = new Date(start.getFullYear(), 11, 31);
  }
  const shift = prefix === 'last' ? -1 : prefix === 'next' ? 1 : 0;
  if (shift && unit === 'day') {
    start = new Date(start.getFullYear(), start.getMonth(), start.getDate() + shift);
    end = start;
  } else if (shift && unit === 'week') {
    start = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * shift);
    end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 7 * shift);
  } else if (shift && unit === 'month') {
    start = new Date(start.getFullYear(), start.getMonth() + shift, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  } else if (shift && unit === 'year') {
    start = new Date(start.getFullYear() + shift, 0, 1);
    end = new Date(start.getFullYear(), 11, 31);
  }
  return { start, end };
}

function relativeDateUnitDays(unit: string, count: number) {
  if (unit === 'day') return count;
  if (unit === 'month') return 31 * count;
  if (unit === 'year') return 366 * count;
  return 7 * count;
}

function isEmptyDatabaseFilterValue(text: string, column?: DatabaseColumn) {
  if (!text) return true;
  if (column?.type === 'multi_select' || column?.type === 'linked') {
    return parseMultiSelectValue(text).length === 0;
  }
  return false;
}

function applyViewSorts<T extends { row: DatabaseRow; props: Record<string, any> }>(items: T[], columns: DatabaseColumn[], view: DatabaseViewConfig): T[] {
  const sorts = (view.sorts || []).filter((rule) => rule.property);
  if (!sorts.length) return items;
  const byID = new Map(columns.map((column) => [column.id, column]));
  return [...items].sort((a, b) => {
    for (const sort of sorts) {
      const column = byID.get(sort.property);
      const result = compareDatabaseValues(a.props[sort.property], b.props[sort.property], column);
      if (result !== 0) return sort.dir === 'desc' ? -result : result;
    }
    return 0;
  });
}

function removeColumnFromView(view: DatabaseViewConfig, columnId: string): DatabaseViewConfig {
  const unset = (value?: string) => value === columnId ? undefined : value;
  return {
    ...view,
    columns: view.columns.filter((rule) => rule.property !== columnId),
    filters: (view.filters || []).filter((filter) => filter.property !== columnId),
    sorts: (view.sorts || []).filter((sort) => sort.property !== columnId),
    groupBy: unset(view.groupBy),
    cover: unset(view.cover),
    date: unset(view.date),
    startDate: unset(view.startDate),
    endDate: unset(view.endDate),
  };
}

function columnAlignClass(rule: Pick<ViewColumnRule, 'align'>) {
  if (rule.align === 'center') return 'akdb-align-center';
  if (rule.align === 'right') return 'akdb-align-right';
  return 'akdb-align-left';
}

function compareDatabaseValues(a: unknown, b: unknown, column?: DatabaseColumn) {
  const av = String(a ?? '');
  const bv = String(b ?? '');
  if (column?.type === 'number' || column?.type === 'formula') {
    const an = Number(av);
    const bn = Number(bv);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  }
  if (column?.type === 'date' || column?.type === 'created_time' || column?.type === 'last_edited_time') {
    const at = Date.parse(av);
    const bt = Date.parse(bv);
    if (Number.isFinite(at) && Number.isFinite(bt)) return at - bt;
  }
  return av.localeCompare(bv, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

function parseMultiSelectValue(value: string) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function displayValueForColumn(column: DatabaseColumn | undefined, row: DatabaseRow, props: Record<string, any>) {
  if (!column) return '';
  if (column.type === 'formula') return props[column.id] ?? '';
  return row.values[column.id] || '';
}

function Frame({ title, icon, children, onAdd, readonly }: any) {
  return <div className="akdb-frame"><div className="akdb-toolbar"><div>{icon}<span>{title}</span></div>{!readonly && <button onClick={onAdd}><Plus size={14} /> 新增</button>}</div>{children}</div>;
}

const DatabaseRowContextMenu = forwardRef<HTMLDivElement, {
  row: DatabaseRow;
  style: CSSProperties;
  onOpen: () => void;
  onCopyLink: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}>(({ row, style, onOpen, onCopyLink, onDuplicate, onDelete }, ref) => {
  return (
    <div
      ref={ref}
      className="akdb-row-context-menu"
      role="dialog"
      aria-label={`行菜单 ${row.uuid}`}
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="akdb-row-context-section">
        <button type="button" className="akdb-row-context-item" onClick={onOpen}>
          <FileText size={16} />
          <span>打开页面</span>
        </button>
        <button type="button" className="akdb-row-context-item" onClick={onCopyLink}>
          <Copy size={16} />
          <span>拷贝链接</span>
        </button>
        <button type="button" className="akdb-row-context-item" onClick={onDuplicate}>
          <Copy size={16} />
          <span>创建副本</span>
        </button>
        <button type="button" className="akdb-row-context-item" onClick={onDelete}>
          <Trash2 size={16} />
          <span>移到垃圾箱</span>
        </button>
      </div>
    </div>
  );
});

function AddColumnMenu({
  spaceSlug,
  schema,
  onCreateSource,
  style,
}: {
  spaceSlug: string;
  schema: DatabaseDetail;
  onCreateSource: (name: string, type: DatabaseColumnType, config?: Record<string, any>) => void;
  style: CSSProperties;
}) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [relationMode, setRelationMode] = useState(false);
  const [relationTargets, setRelationTargets] = useState<DatabaseSummary[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const search = query.trim().toLowerCase();
  const sourceTypes = sourceColumnTypes.filter((item) => !search || item.label.toLowerCase().includes(search) || item.type.includes(search));
  const filteredTargets = relationTargets.filter((db) => !search || db.name.toLowerCase().includes(search) || db.id.toLowerCase().includes(search));

  useEffect(() => {
    if (!relationMode) return;
    let cancelled = false;
    setTargetsLoading(true);
    databasesApi.list(spaceSlug)
      .then((items) => {
        if (!cancelled) setRelationTargets(items);
      })
      .catch(() => {
        if (!cancelled) setRelationTargets([]);
      })
      .finally(() => {
        if (!cancelled) setTargetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [relationMode, spaceSlug]);

  return (
    <div className="akdb-add-column-menu" role="dialog" aria-label="添加列" style={style}>
      <div className="akdb-add-column-name">
        <span className="akdb-add-column-smile">☻</span>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="输入属性名称..."
        />
      </div>
      <div className="akdb-add-column-search">
        {relationMode && <span>目标数据源</span>}
        <input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="搜索"
        />
      </div>

      {relationMode ? (
        <MenuSection title="选择关联目标">
          <button
            type="button"
            className="akdb-add-column-back"
            onClick={() => {
              setRelationMode(false);
              setQuery('');
            }}
          >
            返回字段类型
          </button>
          {targetsLoading && <div className="akdb-add-column-empty">加载中...</div>}
          {!targetsLoading && filteredTargets.length === 0 && <div className="akdb-add-column-empty">暂无可关联的数据源</div>}
          {!targetsLoading && filteredTargets.map((db) => (
            <MenuItem
              key={db.id}
              icon="type_relation"
              label={db.name}
              detail={db.id === schema.id ? '当前数据源' : '数据源'}
              onClick={() => onCreateSource(name || '关联', 'relation', { target_db_id: db.id, target_db_name: db.name })}
            />
          ))}
        </MenuSection>
      ) : (
        <>
          <MenuSection>
            <div className="akdb-add-column-grid">
              {sourceTypes.map((item) => (
                <MenuItem
                  key={item.type}
                  icon={item.icon}
                  label={item.label}
                  onClick={() => {
                    if (item.type === 'relation') {
                      setRelationMode(true);
                      setQuery('');
                  } else {
                      onCreateSource(name, item.type, defaultSourceColumnConfig(item.type));
                  }
                }}
              />
            ))}
          </div>
          </MenuSection>
        </>
      )}
    </div>
  );
}

function MenuSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="akdb-add-column-section">
      {title && <div className="akdb-add-column-section-title">{title}</div>}
      {children}
    </section>
  );
}

function MenuItem({ icon, label, detail, onClick }: { icon: string; label: string; detail?: string; onClick: () => void }) {
  return (
    <button type="button" className="akdb-add-column-item" onClick={onClick}>
      <span className="akdb-add-column-icon"><ColumnIconGlyph icon={icon} /></span>
      <span className="akdb-add-column-label">{label}</span>
      {detail && <span className="akdb-add-column-detail">{detail}</span>}
    </button>
  );
}

type RenderedColumn = {
  rule: ViewColumnRule;
  column?: DatabaseColumn;
  id: string;
  name: string;
};

function ColumnHeaderMenu({
  column,
  typeOpen,
  propertyOpen,
  style,
  onOpenType,
  onCloseType,
  onOpenProperty,
  onCloseProperty,
  onChangeType,
  onChangeIcon,
  onChangeName,
  onCreateOption,
  onUpdateOption,
  onReorderOption,
  onDeleteOption,
  onUpdateConfig,
  onChangeAlign,
  onFilter,
  onSort,
  onToggleReadonly,
  onHide,
  onDelete,
}: {
  column: RenderedColumn;
  index: number;
  typeOpen: boolean;
  propertyOpen: boolean;
  style: CSSProperties;
  onOpenType: () => void;
  onCloseType: () => void;
  onOpenProperty: () => void;
  onCloseProperty: () => void;
  onChangeType: (type: DatabaseColumnType) => void;
  onChangeIcon: (icon: string) => void;
  onChangeName: (name: string) => void;
  onCreateOption: (label: string) => Promise<any | null>;
  onUpdateOption: (optionID: string, patch: Record<string, any>) => void;
  onReorderOption: (sourceID: string, targetID: string) => void;
  onDeleteOption: (optionID: string) => void;
  onUpdateConfig: (patch: Record<string, any>) => void;
  onChangeAlign: (align: ViewColumnRule['align']) => void;
  onFilter: () => void;
  onSort: () => void;
  onToggleReadonly: () => void;
  onHide: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(column.name);
  const [iconOpen, setIconOpen] = useState(false);
  const iconButtonRef = useRef<HTMLButtonElement | null>(null);
  const typeButtonRef = useRef<HTMLButtonElement | null>(null);
  const propertyButtonRef = useRef<HTMLButtonElement | null>(null);
  const iconPickerRect = useDropdownPosition(iconOpen, iconButtonRef, 408);
  const typeMenuRect = useSubmenuPosition(typeOpen, typeButtonRef, 220, 340);
  const propertyMenuRect = useSubmenuPosition(propertyOpen, propertyButtonRef, column.column?.type === 'number' ? 300 : 260, column.column?.type === 'number' ? 360 : 340);
  useDropdownOutsideClose(iconOpen, iconButtonRef, () => setIconOpen(false), '.akdb-column-icon-popover');
  useEffect(() => setName(column.name), [column.id, column.name]);
  const typeDisabled = !column.column || !!column.column.readonly;
  const selectedIcon = columnIconID(column.column);
  const commitName = () => {
    const nextName = name.trim();
    if (!nextName) {
      setName(column.name);
      return;
    }
    if (nextName !== column.name) onChangeName(nextName);
  };
  return (
    <div className="akdb-column-menu" role="dialog" aria-label="列菜单" style={style} onPointerDown={(event) => event.stopPropagation()}>
      <div className="akdb-column-menu-name">
        <button
          ref={iconButtonRef}
          type="button"
          className="akdb-column-menu-type"
          disabled={typeDisabled}
          onClick={() => setIconOpen((open) => !open)}
          aria-label="更改列图标"
          aria-expanded={iconOpen}
        >
          <ColumnIconGlyph icon={selectedIcon} />
        </button>
        <input
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              setName(column.name);
              event.currentTarget.blur();
            }
          }}
          aria-label="列名称"
        />
        <Info size={14} />
      </div>
      {iconOpen && !typeDisabled && iconPickerRect && createPortal(
        <ColumnIconPopover
          column={column}
          ariaLabel="列图标"
          style={iconPickerRect}
          onPick={(icon) => {
            onChangeIcon(icon);
            setIconOpen(false);
          }}
        />,
        document.body,
      )}
      <div className="akdb-column-menu-section">
        <button
          ref={typeButtonRef}
          type="button"
          className={`akdb-column-menu-item ${typeOpen ? 'is-active' : ''}`}
          disabled={typeDisabled}
          onMouseEnter={onOpenType}
          onFocus={onOpenType}
          aria-haspopup="menu"
          aria-expanded={typeOpen}
        >
          <Repeat2 size={16} />
          <span>更改类型</span>
          <ChevronRight size={14} />
        </button>
        {typeOpen && typeMenuRect && createPortal(
          <div
            className="akdb-column-type-submenu"
            role="menu"
            aria-label="更改列类型"
            style={typeMenuRect}
            onMouseEnter={onOpenType}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="akdb-column-type-list">
            {columnTypeMenuItems.map((type) => (
              <button
                type="button"
                role="menuitem"
                key={type.id}
                className={`akdb-column-type-item ${column.column?.type === type.type ? 'is-active' : ''}`}
                disabled={false}
                onClick={() => {
                  onChangeType(type.type);
                  onCloseType();
                }}
              >
                <span><ColumnIconGlyph icon={type.icon} /></span>
                <span>{type.label}</span>
                {column.column?.type === type.type && <Check size={16} className="akdb-column-type-check" />}
                {type.help && column.column?.type !== type.type && <HelpCircle size={15} className="akdb-column-type-help" />}
              </button>
            ))}
            </div>
          </div>
          , document.body,
        )}
        <button
          ref={propertyButtonRef}
          type="button"
          className={`akdb-column-menu-item ${propertyOpen ? 'is-active' : ''}`}
          disabled={typeDisabled}
          onMouseEnter={onOpenProperty}
          onFocus={onOpenProperty}
          aria-haspopup="menu"
          aria-expanded={propertyOpen}
        >
          <SlidersHorizontal size={16} />
          <span>编辑属性</span>
          <ChevronRight size={14} />
        </button>
        {propertyOpen && propertyMenuRect && column.column && createPortal(
          <ColumnPropertySubmenu
            column={column.column}
            align={column.rule.align}
            style={propertyMenuRect}
            onMouseEnter={onOpenProperty}
            onChangeAlign={onChangeAlign}
            onCreateOption={onCreateOption}
            onUpdateOption={onUpdateOption}
            onReorderOption={onReorderOption}
            onDeleteOption={onDeleteOption}
            onUpdateConfig={onUpdateConfig}
          />,
          document.body,
        )}
        <button type="button" className="akdb-column-menu-item" onMouseEnter={() => { onCloseType(); onCloseProperty(); }} onFocus={() => { onCloseType(); onCloseProperty(); }} onClick={onFilter}>
          <Filter size={16} />
          <span>筛选</span>
        </button>
        <button type="button" className="akdb-column-menu-item" onMouseEnter={() => { onCloseType(); onCloseProperty(); }} onFocus={() => { onCloseType(); onCloseProperty(); }} onClick={onSort}>
          <ArrowUpDown size={16} />
          <span>排序</span>
        </button>
        <button type="button" className="akdb-column-menu-item" onMouseEnter={() => { onCloseType(); onCloseProperty(); }} onFocus={() => { onCloseType(); onCloseProperty(); }} onClick={onToggleReadonly}>
          <Lock size={16} />
          <span>{column.rule.readonly ? '取消只读' : '只读'}</span>
        </button>
        <button type="button" className="akdb-column-menu-item" onMouseEnter={() => { onCloseType(); onCloseProperty(); }} onFocus={() => { onCloseType(); onCloseProperty(); }} onClick={onHide}>
          <EyeOff size={16} />
          <span>隐藏</span>
        </button>
      </div>
      <div className="akdb-column-menu-section">
        <button type="button" className="akdb-column-menu-item is-danger" onMouseEnter={() => { onCloseType(); onCloseProperty(); }} onFocus={() => { onCloseType(); onCloseProperty(); }} onClick={onDelete}>
          <Trash2 size={16} />
          <span>删除</span>
        </button>
      </div>
    </div>
  );
}

type CheckboxDisplayStyle = 'checkbox' | 'radio' | 'switch';

function normalizeCheckboxDisplayStyle(value: unknown): CheckboxDisplayStyle {
  return value === 'radio' || value === 'switch' ? value : 'checkbox';
}

function checkboxDisplayStyleLabel(value: unknown) {
  const style = normalizeCheckboxDisplayStyle(value);
  if (style === 'radio') return '圆点';
  if (style === 'switch') return '开关';
  return '复选框';
}

function ColumnPropertySubmenu({ column, align, style, onMouseEnter, onCreateOption, onUpdateOption, onReorderOption, onDeleteOption, onUpdateConfig, onChangeAlign }: { column: DatabaseColumn; align: ViewColumnRule['align']; style: CSSProperties; onMouseEnter: () => void; onCreateOption: (label: string) => Promise<any | null>; onUpdateOption: (optionID: string, patch: Record<string, any>) => void; onReorderOption: (sourceID: string, targetID: string) => void; onDeleteOption: (optionID: string) => void; onUpdateConfig: (patch: Record<string, any>) => void; onChangeAlign: (align: ViewColumnRule['align']) => void }) {
  const config = column.config || {};
  const options = Array.isArray(config.options) ? config.options : [];
  const textMaxLength = Math.max(0, Number(config.max_length) || 0);
  const textMaxLengthEnabled = textMaxLength > 0;
  const [editingOptionID, setEditingOptionID] = useState<string | null>(null);
  const [editingStatusGroupID, setEditingStatusGroupID] = useState<string | null>(null);
  const [textMaxLengthDraft, setTextMaxLengthDraft] = useState(textMaxLengthEnabled ? String(textMaxLength) : '');
  const [propertyFlyout, setPropertyFlyout] = useState<'textDisplay' | 'align' | 'checkboxStyle' | 'numberFormat' | 'numberColor' | 'precision' | 'dateDisplayFormat' | 'timeDisplayFormat' | 'timezone' | null>(null);
  const [optionDragState, setOptionDragState] = useState<{
    sourceID: string;
    targetID: string;
    sourceGroupID?: string;
    targetGroupID?: string;
    sourceIndex: number;
    targetIndex: number;
    pointerOffset: number;
    minTop: number;
    maxTop: number;
    initialTop: number;
    currentTop: number;
    rowHeight: number;
    step: number;
    centers: number[];
  } | null>(null);
  const [statusGroupDragState, setStatusGroupDragState] = useState<{
    sourceID: string;
    targetID: string;
    sourceIndex: number;
    targetIndex: number;
    pointerOffset: number;
    minTop: number;
    maxTop: number;
    initialTop: number;
    currentTop: number;
    rowHeight: number;
    step: number;
    centers: number[];
  } | null>(null);
  const textDisplayButtonRef = useRef<HTMLButtonElement | null>(null);
  const alignButtonRef = useRef<HTMLButtonElement | null>(null);
  const checkboxStyleButtonRef = useRef<HTMLButtonElement | null>(null);
  const numberFormatButtonRef = useRef<HTMLButtonElement | null>(null);
  const numberColorButtonRef = useRef<HTMLButtonElement | null>(null);
  const precisionButtonRef = useRef<HTMLButtonElement | null>(null);
  const dateContentButtonRef = useRef<HTMLButtonElement | null>(null);
  const dateFormatButtonRef = useRef<HTMLButtonElement | null>(null);
  const timezoneButtonRef = useRef<HTMLButtonElement | null>(null);
  const optionEditAnchorRef = useRef<HTMLButtonElement | null>(null);
  const optionAddButtonRef = useRef<HTMLButtonElement | null>(null);
  const statusGroupEditAnchorRef = useRef<HTMLDivElement | null>(null);
  const optionListRef = useRef<HTMLDivElement | null>(null);
  const optionDragStateRef = useRef<typeof optionDragState>(null);
  const statusGroupDragStateRef = useRef<typeof statusGroupDragState>(null);
  const suppressOptionClickRef = useRef(false);
  const suppressStatusGroupClickRef = useRef(false);
  const textDisplayOpen = propertyFlyout === 'textDisplay';
  const alignOpen = propertyFlyout === 'align';
  const checkboxStyleOpen = propertyFlyout === 'checkboxStyle';
  const numberFormatOpen = propertyFlyout === 'numberFormat';
  const numberColorOpen = propertyFlyout === 'numberColor';
  const precisionOpen = propertyFlyout === 'precision';
  const dateContentOpen = propertyFlyout === 'dateDisplayFormat';
  const dateFormatOpen = propertyFlyout === 'timeDisplayFormat';
  const timezoneOpen = propertyFlyout === 'timezone';
  const textDisplayRect = useSubmenuPosition(textDisplayOpen, textDisplayButtonRef, 220, 180);
  const alignRect = useSubmenuPosition(alignOpen, alignButtonRef, 220, 180);
  const checkboxStyleRect = useSubmenuPosition(checkboxStyleOpen, checkboxStyleButtonRef, 220, 180);
  const numberFormatRect = useSubmenuPosition(numberFormatOpen, numberFormatButtonRef, 260, 520);
  const numberColorRect = useSubmenuPosition(numberColorOpen, numberColorButtonRef, 180, 320);
  const precisionRect = useSubmenuPosition(precisionOpen, precisionButtonRef, 220, 360);
  const dateContentRect = useSubmenuPosition(dateContentOpen, dateContentButtonRef, 220, 220);
  const dateFormatRect = useSubmenuPosition(dateFormatOpen, dateFormatButtonRef, 220, 180);
  const timezoneRect = useSubmenuPosition(timezoneOpen, timezoneButtonRef, 220, 320);
  const optionEditRect = useSubmenuPosition(!!editingOptionID, optionEditAnchorRef, 252, 430);
  const statusGroupEditRect = useSubmenuPosition(!!editingStatusGroupID, statusGroupEditAnchorRef, 220, 180);
  const editingOption = options.find((option: any) => option.id === editingOptionID);
  const statusGroups = Array.isArray(config.groups) && config.groups.length
    ? config.groups
    : [{ id: 'status-all', name: '状态', option_ids: options.map((option: any) => option.id) }];
  const statusOptionByID = new Map(options.map((option: any) => [option.id, option]));
  const statusFlatOptionIDs = statusGroups.flatMap((group: any) => group.option_ids || []);
  const statusVisibleOptionIDs = statusFlatOptionIDs.filter((id: string) => statusOptionByID.has(id));
  const firstStatusOptionID = statusVisibleOptionIDs[0] || options[0]?.id || '';
  const defaultStatusOptionID = String(column.default || firstStatusOptionID || '');
  const editingStatusGroup = statusGroups.find((group: any, index: number) => String(group.id || group.name || `status-group-${index}`) === editingStatusGroupID);
  useEffect(() => {
    setTextMaxLengthDraft(textMaxLengthEnabled ? String(textMaxLength) : '');
  }, [textMaxLength, textMaxLengthEnabled]);
  const commitTextMaxLength = () => {
    if (!textMaxLengthEnabled) return;
    const nextLength = Math.max(1, Number(textMaxLengthDraft) || 1);
    setTextMaxLengthDraft(String(nextLength));
    if (nextLength !== textMaxLength) onUpdateConfig({ max_length: nextLength });
  };
  const renderAlignControl = () => (
    <>
      <button
        ref={alignButtonRef}
        type="button"
        className={`akdb-column-property-nav ${alignOpen ? 'is-active' : ''}`}
        onMouseEnter={() => {
          setEditingOptionID(null);
          setPropertyFlyout('align');
        }}
        onFocus={() => {
          setEditingOptionID(null);
          setPropertyFlyout('align');
        }}
        aria-haspopup="menu"
        aria-expanded={alignOpen}
      >
        <span>对齐方式</span>
        <span>{alignLabel(align)}</span>
        <ChevronRight size={15} />
      </button>
      {alignOpen && alignRect && createPortal(
        <AlignSubmenu
          value={align}
          style={alignRect}
          onMouseEnter={() => setPropertyFlyout('align')}
          onMouseLeave={() => undefined}
          onChange={onChangeAlign}
        />,
        document.body,
      )}
    </>
  );
  const renderCheckboxStyleControl = () => (
    <>
      <button
        ref={checkboxStyleButtonRef}
        type="button"
        className={`akdb-column-property-nav ${checkboxStyleOpen ? 'is-active' : ''}`}
        onMouseEnter={() => {
          setEditingOptionID(null);
          setPropertyFlyout('checkboxStyle');
        }}
        onFocus={() => {
          setEditingOptionID(null);
          setPropertyFlyout('checkboxStyle');
        }}
        aria-haspopup="menu"
        aria-expanded={checkboxStyleOpen}
      >
        <span>切换样式</span>
        <span>{checkboxDisplayStyleLabel(config.checkbox_style)}</span>
        <ChevronRight size={15} />
      </button>
      {checkboxStyleOpen && checkboxStyleRect && createPortal(
        <CheckboxStyleSubmenu
          value={normalizeCheckboxDisplayStyle(config.checkbox_style)}
          style={checkboxStyleRect}
          onMouseEnter={() => setPropertyFlyout('checkboxStyle')}
          onMouseLeave={() => undefined}
          onChange={(nextStyle) => onUpdateConfig({ checkbox_style: nextStyle })}
        />,
        document.body,
      )}
    </>
  );
  const createPropertyOption = async () => {
    setPropertyFlyout(null);
    setEditingStatusGroupID(null);
    optionEditAnchorRef.current = optionAddButtonRef.current;
    const option = await onCreateOption('新选项');
    if (option?.id) setEditingOptionID(option.id);
  };
  const createStatusGroup = () => {
    const existingIDs = new Set(statusGroups.map((group: any, index: number) => String(group.id || group.name || `status-group-${index}`)));
    let id = 'status-group';
    let index = statusGroups.length + 1;
    while (existingIDs.has(id)) {
      id = `status-group-${index}`;
      index += 1;
    }
    onUpdateConfig({ groups: [...statusGroups, { id, name: '新分组', option_ids: [] }] });
    setPropertyFlyout(null);
    setEditingOptionID(null);
  };
  const createStatusGroupOption = (groupID: string) => {
    const groupIndex = statusGroups.findIndex((group: any) => String(group.id || group.name) === groupID);
    if (groupIndex < 0) return;
    const id = slugOptionID('新状态') || 'status';
    const existingIDs = new Set(options.map((option: any) => String(option.id || '')));
    let nextID = id;
    let index = 2;
    while (existingIDs.has(nextID)) {
      nextID = `${id}-${index}`;
      index += 1;
    }
    const nextOption = { id: nextID, value: '新状态', color: 'gray', icon: 'none', shape: 'pill', color_mode: 'background' };
    const nextGroups = statusGroups.map((group: any, index: number) => {
      if (index !== groupIndex) return group;
      const optionIDs = Array.isArray(group.option_ids) ? group.option_ids : [];
      return { ...group, option_ids: [...optionIDs, nextID] };
    });
    onUpdateConfig({ options: [...options, nextOption], groups: nextGroups });
    setPropertyFlyout(null);
    setEditingStatusGroupID(null);
    setEditingOptionID(nextID);
  };
  const updateStatusGroup = (groupID: string, patch: Record<string, any>) => {
    const nextGroups = statusGroups.map((group: any, index: number) => {
      const currentID = String(group.id || group.name || `status-group-${index}`);
      return currentID === groupID ? { ...group, ...patch } : group;
    });
    onUpdateConfig({ groups: nextGroups });
  };
  const deleteStatusGroup = (groupID: string) => {
    const deletingGroup = statusGroups.find((group: any, index: number) => String(group.id || group.name || `status-group-${index}`) === groupID);
    const deletingIDs = new Set(deletingGroup?.option_ids || []);
    const nextGroups = statusGroups.filter((group: any, index: number) => String(group.id || group.name || `status-group-${index}`) !== groupID);
    const remainingIDs = new Set(nextGroups.flatMap((group: any) => group.option_ids || []));
    onUpdateConfig({
      groups: nextGroups,
      options: options.filter((option: any) => !deletingIDs.has(option.id) || remainingIDs.has(option.id)),
    });
    setEditingStatusGroupID(null);
  };
  const reorderStatusGroup = (sourceID: string, targetID: string) => {
    const sourceIndex = statusGroups.findIndex((group: any, index: number) => String(group.id || group.name || `status-group-${index}`) === sourceID);
    const targetIndex = statusGroups.findIndex((group: any, index: number) => String(group.id || group.name || `status-group-${index}`) === targetID);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const nextGroups = [...statusGroups];
    const [moved] = nextGroups.splice(sourceIndex, 1);
    nextGroups.splice(targetIndex, 0, moved);
    onUpdateConfig({ groups: nextGroups });
  };
  const beginStatusGroupDrag = (groupID: string, event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || statusGroups.length < 2) return;
    const list = optionListRef.current;
    const row = event.currentTarget.closest('[data-status-group-id]') as HTMLElement | null;
    if (!list || !row) return;
    event.preventDefault();
    event.stopPropagation();
    setEditingOptionID(null);
    setEditingStatusGroupID(null);
    setPropertyFlyout(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-status-group-id]'));
    const sourceIndex = rows.findIndex((item) => item.dataset.statusGroupId === groupID);
    if (sourceIndex < 0) return;
    const rowRects = rows.map((item) => item.getBoundingClientRect());
    const gap = rowRects.length > 1 ? Math.max(0, rowRects[1].top - rowRects[0].bottom) : 0;
    const rowTop = rowRect.top - listRect.top;
    const rowHeight = rowRect.height;
    const baseState = {
      sourceID: groupID,
      targetID: groupID,
      sourceIndex,
      targetIndex: sourceIndex,
      pointerOffset: event.clientY - rowRect.top,
      minTop: Math.max(0, rowRects[0].top - listRect.top),
      maxTop: Math.max(0, rowRects[rowRects.length - 1].bottom - listRect.top - rowHeight),
      initialTop: rowTop,
      currentTop: rowTop,
      rowHeight,
      step: rowHeight + gap,
      centers: rowRects.map((rect) => rect.top - listRect.top + rect.height / 2),
    };
    statusGroupDragStateRef.current = baseState;
    setStatusGroupDragState(baseState);
    const updateTarget = (clientY: number) => {
      setStatusGroupDragState((current) => {
        if (!current) return current;
        const currentTop = Math.min(current.maxTop, Math.max(current.minTop, clientY - listRect.top - current.pointerOffset));
        const currentCenter = currentTop + current.rowHeight / 2;
        const targetIndex = current.centers.findIndex((center) => currentCenter <= center);
        const nextTargetIndex = targetIndex === -1 ? current.centers.length - 1 : targetIndex;
        const targetID = rows[nextTargetIndex]?.dataset.statusGroupId || current.targetID;
        const next = { ...current, currentTop, targetIndex: nextTargetIndex, targetID };
        statusGroupDragStateRef.current = next;
        return next;
      });
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateTarget(moveEvent.clientY);
      moveEvent.preventDefault();
    };
    const handlePointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      const finalState = statusGroupDragStateRef.current;
      flushSync(() => {
        statusGroupDragStateRef.current = null;
        setStatusGroupDragState(null);
      });
      suppressStatusGroupClickRef.current = true;
      window.setTimeout(() => { suppressStatusGroupClickRef.current = false; }, 0);
      if (finalState && finalState.sourceID !== finalState.targetID) reorderStatusGroup(finalState.sourceID, finalState.targetID);
      try {
        event.currentTarget.releasePointerCapture(upEvent.pointerId);
      } catch {
        // Pointer capture can already be released if the pointer ends outside the handle.
      }
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };
  const beginPropertyOptionDrag = (optionID: string, event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || options.length < 2) return;
    const list = optionListRef.current;
    const row = event.currentTarget.closest('[data-option-id]') as HTMLElement | null;
    if (!list || !row) return;
    event.preventDefault();
    event.stopPropagation();
    setEditingOptionID(null);
    setPropertyFlyout(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-option-id]'));
    const sourceIndex = rows.findIndex((item) => item.dataset.optionId === optionID);
    if (sourceIndex < 0) return;
    const rowRects = rows.map((item) => item.getBoundingClientRect());
    const gap = rowRects.length > 1 ? Math.max(0, rowRects[1].top - rowRects[0].bottom) : 0;
    const rowTop = rowRect.top - listRect.top;
    const rowHeight = rowRect.height;
    const baseState = {
      sourceID: optionID,
      targetID: optionID,
      sourceGroupID: row.dataset.groupId,
      targetGroupID: row.dataset.groupId,
      sourceIndex,
      targetIndex: sourceIndex,
      pointerOffset: event.clientY - rowRect.top,
      minTop: Math.max(0, rowRects[0].top - listRect.top),
      maxTop: Math.max(0, rowRects[rowRects.length - 1].bottom - listRect.top - rowHeight),
      initialTop: rowTop,
      currentTop: rowTop,
      rowHeight,
      step: rowHeight + gap,
      centers: rowRects.map((rect) => rect.top - listRect.top + rect.height / 2),
    };
    optionDragStateRef.current = baseState;
    setOptionDragState(baseState);
    const updateTarget = (clientY: number) => {
      setOptionDragState((current) => {
        if (!current) return current;
        const currentTop = Math.min(current.maxTop, Math.max(current.minTop, clientY - listRect.top - current.pointerOffset));
        const currentCenter = currentTop + current.rowHeight / 2;
        const targetIndex = current.centers.findIndex((center) => currentCenter <= center);
        const nextTargetIndex = targetIndex === -1 ? current.centers.length - 1 : targetIndex;
        const targetRow = rows[nextTargetIndex];
        const targetID = targetRow?.dataset.optionId || current.targetID;
        const targetGroupID = targetRow?.dataset.groupId || current.targetGroupID;
        const next = { ...current, currentTop, targetIndex: nextTargetIndex, targetID, targetGroupID };
        optionDragStateRef.current = next;
        return next;
      });
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateTarget(moveEvent.clientY);
      moveEvent.preventDefault();
    };
    const handlePointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      const finalState = optionDragStateRef.current;
      flushSync(() => {
        optionDragStateRef.current = null;
        setOptionDragState(null);
      });
      suppressOptionClickRef.current = true;
      window.setTimeout(() => { suppressOptionClickRef.current = false; }, 0);
      if (finalState && finalState.sourceID !== finalState.targetID) {
        if (column.type === 'status') reorderStatusOption(finalState.sourceID, finalState.targetID, finalState.targetGroupID);
        else onReorderOption(finalState.sourceID, finalState.targetID);
      }
      try {
        event.currentTarget.releasePointerCapture(upEvent.pointerId);
      } catch {
        // Pointer capture can already be released if the pointer ends outside the handle.
      }
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };
  const reorderStatusOption = (sourceID: string, targetID: string, targetGroupID?: string) => {
    const nextGroups = statusGroups.map((group: any) => ({ ...group, option_ids: (group.option_ids || []).filter((id: string) => id !== sourceID) }));
    const groupIndex = nextGroups.findIndex((group: any) => String(group.id || group.name) === String(targetGroupID || ''));
    if (groupIndex < 0) return;
    const targetIDs = Array.isArray(nextGroups[groupIndex].option_ids) ? [...nextGroups[groupIndex].option_ids] : [];
    const targetIndex = targetIDs.indexOf(targetID);
    targetIDs.splice(targetIndex < 0 ? targetIDs.length : targetIndex, 0, sourceID);
    nextGroups[groupIndex] = { ...nextGroups[groupIndex], option_ids: targetIDs };
    onUpdateConfig({ groups: nextGroups });
  };
  return (
    <div
      className="akdb-column-property-submenu"
      role="menu"
      aria-label="编辑属性"
      style={style}
      onMouseEnter={onMouseEnter}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="akdb-column-property-list">
        {column.type === 'text' && (
          <>
            <button
              ref={textDisplayButtonRef}
              type="button"
              className={`akdb-column-property-nav ${textDisplayOpen ? 'is-active' : ''}`}
              onMouseEnter={() => {
                setEditingOptionID(null);
                setPropertyFlyout('textDisplay');
              }}
              onFocus={() => {
                setEditingOptionID(null);
                setPropertyFlyout('textDisplay');
              }}
              aria-haspopup="menu"
              aria-expanded={textDisplayOpen}
            >
              <span>文本显示</span>
              <span>{config.secret ? '密文' : '明文'}</span>
              <ChevronRight size={15} />
            </button>
            {textDisplayOpen && textDisplayRect && createPortal(
              <TextDisplaySubmenu
                secret={!!config.secret}
                style={textDisplayRect}
                onMouseEnter={() => setPropertyFlyout('textDisplay')}
                onMouseLeave={() => undefined}
                onChange={(secret) => onUpdateConfig({ secret })}
              />,
              document.body,
            )}
          </>
        )}

        {column.type === 'number' && (
          <>
            <button
              ref={numberFormatButtonRef}
              type="button"
              className={`akdb-column-property-nav ${numberFormatOpen ? 'is-active' : ''}`}
              onMouseEnter={() => {
                setEditingOptionID(null);
                setPropertyFlyout('numberFormat');
              }}
              onFocus={() => {
                setEditingOptionID(null);
                setPropertyFlyout('numberFormat');
              }}
              aria-haspopup="menu"
              aria-expanded={numberFormatOpen}
            >
              <span>数字格式</span>
              <span>{numberFormatLabel(config.format || 'number')}</span>
              <ChevronRight size={15} />
            </button>
            {numberFormatOpen && numberFormatRect && createPortal(
              <NumberFormatSubmenu
                value={config.format || 'number'}
                style={numberFormatRect}
                onMouseEnter={() => setPropertyFlyout('numberFormat')}
                onMouseLeave={() => undefined}
                onChange={(format) => onUpdateConfig({ format })}
              />,
              document.body,
            )}
            <button
              ref={precisionButtonRef}
              type="button"
              className={`akdb-column-property-nav ${precisionOpen ? 'is-active' : ''}`}
              onMouseEnter={() => {
                setEditingOptionID(null);
                setPropertyFlyout('precision');
              }}
              onFocus={() => {
                setEditingOptionID(null);
                setPropertyFlyout('precision');
              }}
              aria-haspopup="menu"
              aria-expanded={precisionOpen}
            >
              <span>小数位数</span>
              <span>{precisionLabel(config.precision)}</span>
              <ChevronRight size={15} />
            </button>
            {precisionOpen && precisionRect && createPortal(
              <PrecisionSubmenu
                value={Number.isInteger(Number(config.precision)) ? Number(config.precision) : -1}
                style={precisionRect}
                onMouseEnter={() => setPropertyFlyout('precision')}
                onMouseLeave={() => undefined}
                onChange={(precision) => onUpdateConfig({ precision })}
              />,
              document.body,
            )}
            {renderAlignControl()}
            <div className="akdb-column-property-divider" />
            <div className="akdb-column-property-heading">显示为</div>
            <div className="akdb-number-display-grid" role="group" aria-label="数字显示方式">
              {[
                { id: 'number', label: '数字', preview: '42' },
                { id: 'bar', label: '条形', preview: '' },
                { id: 'ring', label: '圆圈', preview: '' },
              ].map((choice) => {
                const active = (config.display_as || 'number') === choice.id;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    className={`akdb-number-display-card ${active ? 'is-active' : ''}`}
                    aria-pressed={active}
                    onClick={() => onUpdateConfig({ display_as: choice.id })}
                  >
                    {choice.id === 'number' && <span className="akdb-number-display-value">42</span>}
                    {choice.id === 'bar' && <span className="akdb-number-display-bar" />}
                    {choice.id === 'ring' && <span className="akdb-number-display-ring" />}
                    <span>{choice.label}</span>
                  </button>
                );
              })}
            </div>
            {(config.display_as === 'bar' || config.display_as === 'ring') && (
              <div className="akdb-number-display-settings">
                <div className="akdb-number-setting-row">
                  <span>颜色</span>
                  <button
                    ref={numberColorButtonRef}
                    type="button"
                    className={`akdb-number-color-btn ${numberColorOpen ? 'is-active' : ''}`}
                    aria-haspopup="menu"
                    aria-expanded={numberColorOpen}
                    onClick={() => {
                      setEditingOptionID(null);
                      setPropertyFlyout((current) => current === 'numberColor' ? null : 'numberColor');
                    }}
                  >
                    <span
                      className="akdb-number-color-swatch"
                      style={{ backgroundColor: (optionColorMap[config.number_color || 'green'] || optionColorMap.green).bg, borderColor: (optionColorMap[config.number_color || 'green'] || optionColorMap.green).border }}
                    />
                    <span>{optionColorChoices.find((choice) => choice.id === (config.number_color || 'green'))?.label || '绿色'}</span>
                    <ChevronDown size={15} />
                  </button>
                </div>
                {numberColorOpen && numberColorRect && createPortal(
                  <NumberColorSubmenu
                    value={config.number_color || 'green'}
                    style={numberColorRect}
                    onMouseEnter={() => setPropertyFlyout('numberColor')}
                    onMouseLeave={() => undefined}
                    onChange={(color) => {
                      onUpdateConfig({ number_color: color });
                      setPropertyFlyout(null);
                    }}
                  />,
                  document.body,
                )}
                <label className="akdb-number-setting-row">
                  <span>除以</span>
                  <input
                    className="akdb-column-property-number akdb-column-property-length-input"
                    type="number"
                    min={1}
                    value={Number(config.number_divide_by || 100)}
                    aria-label="除以"
                    onChange={(event) => onUpdateConfig({ number_divide_by: Math.max(1, Number(event.currentTarget.value) || 1) })}
                  />
                </label>
                <button
                  type="button"
                  className="akdb-number-setting-row akdb-number-setting-switch"
                  role="switch"
                  aria-checked={config.number_show_value !== false}
                  onClick={() => onUpdateConfig({ number_show_value: config.number_show_value === false })}
                >
                  <span>显示为数值</span>
                  <span className={`akdb-column-property-switch ${config.number_show_value !== false ? 'is-active' : ''}`} aria-hidden="true">
                    <span />
                  </span>
                </button>
              </div>
            )}
            <div className="akdb-number-display-help">更改将应用于显示此属性的所有视图。</div>
          </>
        )}

        {column.type === 'date' && (
          <>
            <button
              ref={dateContentButtonRef}
              type="button"
              className={`akdb-column-property-nav ${dateContentOpen ? 'is-active' : ''}`}
              onMouseEnter={() => {
                setEditingOptionID(null);
                setEditingStatusGroupID(null);
                setPropertyFlyout('dateDisplayFormat');
              }}
              onFocus={() => {
                setEditingOptionID(null);
                setEditingStatusGroupID(null);
                setPropertyFlyout('dateDisplayFormat');
              }}
              aria-haspopup="menu"
              aria-expanded={dateContentOpen}
            >
              <span>日期格式</span>
              <span>{dateDisplayFormatLabel(dateDisplayFormat(config))}</span>
              <ChevronRight size={15} />
            </button>
            {dateContentOpen && dateContentRect && createPortal(
              <DateDisplayFormatSubmenu
                value={dateDisplayFormat(config)}
                style={dateContentRect}
                onMouseEnter={() => setPropertyFlyout('dateDisplayFormat')}
                onMouseLeave={() => undefined}
                onChange={(dateFormat) => onUpdateConfig(dateFormatPatch(config, dateFormat))}
              />,
              document.body,
            )}
            <button
              ref={dateFormatButtonRef}
              type="button"
              className={`akdb-column-property-nav ${dateFormatOpen ? 'is-active' : ''}`}
              onMouseEnter={() => {
                setEditingOptionID(null);
                setEditingStatusGroupID(null);
                setPropertyFlyout('timeDisplayFormat');
              }}
              onFocus={() => {
                setEditingOptionID(null);
                setEditingStatusGroupID(null);
                setPropertyFlyout('timeDisplayFormat');
              }}
              aria-haspopup="menu"
              aria-expanded={dateFormatOpen}
            >
              <span>时间格式</span>
              <span>{timeDisplayFormatLabel(timeDisplayFormat(config))}</span>
              <ChevronRight size={15} />
            </button>
            {dateFormatOpen && dateFormatRect && createPortal(
              <TimeDisplayFormatSubmenu
                value={timeDisplayFormat(config)}
                style={dateFormatRect}
                onMouseEnter={() => setPropertyFlyout('timeDisplayFormat')}
                onMouseLeave={() => undefined}
                onChange={(timeFormat) => onUpdateConfig(timeFormatPatch(config, timeFormat))}
              />,
              document.body,
            )}
            <button
              ref={timezoneButtonRef}
              type="button"
              className={`akdb-column-property-nav ${timezoneOpen ? 'is-active' : ''}`}
              onMouseEnter={() => {
                setEditingOptionID(null);
                setEditingStatusGroupID(null);
                setPropertyFlyout('timezone');
              }}
              onFocus={() => {
                setEditingOptionID(null);
                setEditingStatusGroupID(null);
                setPropertyFlyout('timezone');
              }}
              aria-haspopup="menu"
              aria-expanded={timezoneOpen}
            >
              <span>时区</span>
              <span>{timezoneLabel(config.timezone)}</span>
              <ChevronRight size={15} />
            </button>
            {timezoneOpen && timezoneRect && createPortal(
              <TimezoneSubmenu
                value={String(config.timezone || 'GMT+8')}
                style={timezoneRect}
                onMouseEnter={() => setPropertyFlyout('timezone')}
                onMouseLeave={() => undefined}
                onChange={(timezone) => onUpdateConfig({ timezone })}
              />,
              document.body,
            )}
            {renderAlignControl()}
          </>
        )}

        {(column.type === 'select' || column.type === 'multi_select') && (
          <>
            {renderAlignControl()}
            <div className="akdb-column-property-options-head akdb-menu-caption" onMouseEnter={() => setPropertyFlyout(null)}>
              <span>选项</span>
              <button ref={optionAddButtonRef} type="button" aria-label="添加选项" onClick={createPropertyOption}>
                <svg aria-hidden="true" viewBox="0 0 20 20" className="akdb-column-property-options-plus">
                  <path d="M10 3.59a.66.66 0 0 1 .66.66v5.09h5.09a.66.66 0 0 1 0 1.32h-5.09v5.09a.66.66 0 0 1-1.32 0v-5.09H4.25a.66.66 0 0 1 0-1.32h5.09V4.25a.66.66 0 0 1 .66-.66" />
                </svg>
              </button>
            </div>
            <div ref={optionListRef} className="akdb-column-property-options" onMouseEnter={() => setPropertyFlyout(null)}>
              {options.map((option: any, index: number) => {
                const isDragging = optionDragState?.sourceID === option.id;
                let translateY = 0;
                if (optionDragState) {
                  if (isDragging) translateY = optionDragState.currentTop - optionDragState.initialTop;
                  else if (optionDragState.sourceIndex < optionDragState.targetIndex && index > optionDragState.sourceIndex && index <= optionDragState.targetIndex) translateY = -optionDragState.step;
                  else if (optionDragState.targetIndex < optionDragState.sourceIndex && index >= optionDragState.targetIndex && index < optionDragState.sourceIndex) translateY = optionDragState.step;
                }
                return (
                  <button
                    key={option.id}
                    ref={editingOptionID === option.id ? optionEditAnchorRef : undefined}
                    data-option-id={option.id}
                    type="button"
                    className={`akdb-column-property-option ${editingOptionID === option.id ? 'is-active' : ''} ${isDragging ? 'is-dragging' : ''}`}
                    style={{ transform: translateY ? `translateY(${translateY}px)` : undefined }}
                    aria-haspopup="dialog"
                    aria-expanded={editingOptionID === option.id}
                    onClick={(event) => {
                      if (suppressOptionClickRef.current) return;
                      setPropertyFlyout(null);
                      optionEditAnchorRef.current = event.currentTarget;
                      setEditingOptionID((current) => current === option.id ? null : option.id);
                    }}
                  >
                    <GripVertical size={16} className="akdb-column-property-option-handle" onPointerDown={(event) => beginPropertyOptionDrag(option.id, event)} />
                    <span className="akdb-column-property-option-tag"><OptionTag option={option} config={config} /></span>
                    <ChevronRight size={15} />
                  </button>
                );
              })}
              {!options.length && <div className="akdb-column-property-empty">暂无选项</div>}
            </div>
            {editingOption && optionEditRect && createPortal(
              <OptionEditMenu
                option={editingOption}
                config={config}
                style={optionEditRect}
                onUpdate={(patch) => onUpdateOption(editingOption.id, patch)}
                onDelete={() => {
                  onDeleteOption(editingOption.id);
                  setEditingOptionID(null);
                }}
              />,
              document.body,
            )}
          </>
        )}

        {column.type === 'status' && (
          <>
            {renderAlignControl()}
            <div className="akdb-column-property-divider" />
            <div ref={optionListRef} className="akdb-status-property-groups" onMouseEnter={() => setPropertyFlyout(null)}>
              {statusGroups.map((group: any, groupIndex: number) => {
                const groupID = String(group.id || group.name || `status-group-${groupIndex}`);
                const groupOptions = (group.option_ids || []).map((id: string) => statusOptionByID.get(id)).filter(Boolean);
                const isGroupDragging = statusGroupDragState?.sourceID === groupID;
                let groupTranslateY = 0;
                if (statusGroupDragState) {
                  if (isGroupDragging) groupTranslateY = statusGroupDragState.currentTop - statusGroupDragState.initialTop;
                  else if (statusGroupDragState.sourceIndex < statusGroupDragState.targetIndex && groupIndex > statusGroupDragState.sourceIndex && groupIndex <= statusGroupDragState.targetIndex) groupTranslateY = -statusGroupDragState.step;
                  else if (statusGroupDragState.targetIndex < statusGroupDragState.sourceIndex && groupIndex >= statusGroupDragState.targetIndex && groupIndex < statusGroupDragState.sourceIndex) groupTranslateY = statusGroupDragState.step;
                }
                return (
                  <div
                    key={groupID}
                    data-status-group-id={groupID}
                    className={`akdb-status-property-group ${isGroupDragging ? 'is-dragging' : ''}`}
                    style={{ transform: groupTranslateY ? `translateY(${groupTranslateY}px)` : undefined }}
                  >
                    <div
                      ref={editingStatusGroupID === groupID ? statusGroupEditAnchorRef : undefined}
                      role="button"
                      tabIndex={0}
                      className={`akdb-status-property-group-head akdb-menu-caption ${editingStatusGroupID === groupID ? 'is-active' : ''}`}
                      aria-haspopup="dialog"
                      aria-expanded={editingStatusGroupID === groupID}
                      onClick={(event) => {
                        if (suppressStatusGroupClickRef.current) return;
                        setPropertyFlyout(null);
                        setEditingOptionID(null);
                        statusGroupEditAnchorRef.current = event.currentTarget;
                        setEditingStatusGroupID((current) => current === groupID ? null : groupID);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        setPropertyFlyout(null);
                        setEditingOptionID(null);
                        statusGroupEditAnchorRef.current = event.currentTarget;
                        setEditingStatusGroupID((current) => current === groupID ? null : groupID);
                      }}
                    >
                      <GripVertical size={16} className="akdb-status-property-group-handle" onPointerDown={(event) => beginStatusGroupDrag(groupID, event)} />
                      <span>{group.name || '未命名分组'}</span>
                      <button
                        type="button"
                        className="akdb-status-property-group-add"
                        aria-label="添加状态"
                        onClick={(event) => {
                          event.stopPropagation();
                          createStatusGroupOption(groupID);
                        }}
                      >
                        <Plus size={16} strokeWidth={1.8} />
                      </button>
                      <ChevronRight size={15} />
                    </div>
                    <div className="akdb-status-property-options">
                      {groupOptions.map((option: any) => {
                        const index = statusVisibleOptionIDs.indexOf(option.id);
                        const isDragging = optionDragState?.sourceID === option.id;
                        let translateY = 0;
                        if (optionDragState && index >= 0) {
                          if (isDragging) translateY = optionDragState.currentTop - optionDragState.initialTop;
                          else if (optionDragState.sourceIndex < optionDragState.targetIndex && index > optionDragState.sourceIndex && index <= optionDragState.targetIndex) translateY = -optionDragState.step;
                          else if (optionDragState.targetIndex < optionDragState.sourceIndex && index >= optionDragState.targetIndex && index < optionDragState.sourceIndex) translateY = optionDragState.step;
                        }
                        const isDefault = option.id === defaultStatusOptionID;
                        return (
                          <button
                            key={option.id}
                            ref={editingOptionID === option.id ? optionEditAnchorRef : undefined}
                            data-option-id={option.id}
                            data-group-id={groupID}
                            type="button"
                            className={`akdb-column-property-option akdb-status-property-option ${editingOptionID === option.id ? 'is-active' : ''} ${isDragging ? 'is-dragging' : ''}`}
                            style={{ transform: translateY ? `translateY(${translateY}px)` : undefined }}
                            aria-haspopup="dialog"
                            aria-expanded={editingOptionID === option.id}
                            onClick={(event) => {
                              if (suppressOptionClickRef.current) return;
                              setPropertyFlyout(null);
                              optionEditAnchorRef.current = event.currentTarget;
                              setEditingOptionID((current) => current === option.id ? null : option.id);
                            }}
                          >
                            <GripVertical size={16} className="akdb-column-property-option-handle" onPointerDown={(event) => beginPropertyOptionDrag(option.id, event)} />
                            <span className="akdb-column-property-option-tag"><StatusPropertyTag option={option} config={config} /></span>
                            <span className="akdb-status-property-default">{isDefault ? '默认' : ''}</span>
                            <ChevronRight size={15} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <button type="button" className="akdb-status-property-add-group" onClick={createStatusGroup}>
                <Plus size={16} strokeWidth={1.8} />
                <span>添加分组</span>
              </button>
            </div>
            {editingStatusGroup && statusGroupEditRect && createPortal(
              <StatusGroupEditMenu
                group={editingStatusGroup}
                style={statusGroupEditRect}
                onRename={(name) => updateStatusGroup(editingStatusGroupID!, { name })}
                onDelete={() => deleteStatusGroup(editingStatusGroupID!)}
              />,
              document.body,
            )}
            {editingOption && optionEditRect && createPortal(
              <OptionEditMenu
                option={editingOption}
                config={config}
                style={optionEditRect}
                onUpdate={(patch) => onUpdateOption(editingOption.id, patch)}
                onDelete={() => {
                  onDeleteOption(editingOption.id);
                  setEditingOptionID(null);
                }}
              />,
              document.body,
            )}
          </>
        )}

        {column.type !== 'number' && column.type !== 'select' && column.type !== 'multi_select' && column.type !== 'status' && column.type !== 'date' && column.type !== 'checkbox' && renderAlignControl()}

        {column.type === 'text' && (
          <div className="akdb-column-property-limit">
            <div className="akdb-column-property-heading">长度限制</div>
            <button
              type="button"
              className="akdb-column-property-switch-row"
              role="switch"
              aria-checked={textMaxLengthEnabled}
              onClick={() => onUpdateConfig({ max_length: textMaxLengthEnabled ? 0 : Math.max(1, Number(textMaxLengthDraft) || 100) })}
            >
              <span>启用限制</span>
              <span className={`akdb-column-property-switch ${textMaxLengthEnabled ? 'is-active' : ''}`} aria-hidden="true">
                <span />
              </span>
            </button>
            <label className={`akdb-column-property-input-row ${textMaxLengthEnabled ? '' : 'is-disabled'}`}>
              <span>最大长度</span>
              <input
                className="akdb-column-property-number akdb-column-property-length-input"
                type="number"
                min={1}
                disabled={!textMaxLengthEnabled}
                value={textMaxLengthDraft}
                placeholder="无限制"
                aria-label="最大长度"
                onChange={(event) => setTextMaxLengthDraft(event.currentTarget.value)}
                onBlur={commitTextMaxLength}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
                }}
              />
            </label>
          </div>
        )}

        {column.type === 'formula' && (
          <div className="akdb-column-property-empty">公式属性请在源数据页编辑。</div>
        )}

        {column.type === 'relation' && (
          <div className="akdb-column-property-empty">关联属性请在源数据页编辑。</div>
        )}

        {column.type === 'checkbox' && (
          <>
            {renderCheckboxStyleControl()}
            {renderAlignControl()}
          </>
        )}

      </div>
    </div>
  );
}

const numberFormatChoices = [
  { id: 'number', label: '数字' },
  { id: 'number_with_commas', label: '带分隔符的数字' },
  { id: 'percent', label: '百分比' },
  { id: 'usd', label: '美元 (USD)' },
  { id: 'aud', label: '澳元 (AUD)' },
  { id: 'cad', label: '加元 (CAD)' },
  { id: 'sgd', label: '新加坡元 (SGD)' },
  { id: 'eur', label: '欧元 (EUR)' },
  { id: 'gbp', label: '英镑 (GBP)' },
  { id: 'jpy', label: '日元 (JPY)' },
  { id: 'cny', label: '人民币 (CNY)' },
  { id: 'hkd', label: '港元 (HKD)' },
];

function numberFormatLabel(value: string) {
  return numberFormatChoices.find((choice) => choice.id === value)?.label || '数字';
}

function precisionLabel(value: unknown) {
  const precision = Number(value);
  if (!Number.isInteger(precision) || precision < 0) return '默认';
  return String(precision);
}

type DateContentMode = 'date' | 'time' | 'datetime';
type DateDisplayFormat = 'none' | 'slash' | 'chinese' | 'dash';
type TimeDisplayFormat = 'none' | 'h12_colon_seconds' | 'h12_dash_seconds' | 'h24_colon_seconds' | 'h24_dash_seconds';

function dateContentMode(config: Record<string, any>): DateContentMode {
  const hasDate = dateDisplayFormat(config) !== 'none';
  const hasTime = timeDisplayFormat(config) !== 'none';
  if (hasDate && hasTime) return 'datetime';
  if (hasTime) return 'time';
  if (hasDate) return 'date';
  if (config.date_content === 'time') return 'time';
  if (config.date_content === 'datetime') return 'datetime';
  return config.include_time ? 'datetime' : 'date';
}

function dateDisplayFormat(config: Record<string, any>): DateDisplayFormat {
  const value = config.date_format;
  if (value === 'none' || value === 'slash' || value === 'chinese' || value === 'dash') return value;
  if (config.date_content === 'time') return 'none';
  return 'chinese';
}

function timeDisplayFormat(config: Record<string, any>): TimeDisplayFormat {
  const value = config.time_format;
  if (value === 'none' || value === 'h12_colon_seconds' || value === 'h12_dash_seconds' || value === 'h24_colon_seconds' || value === 'h24_dash_seconds') return value;
  if (config.date_content === 'time' || config.date_content === 'datetime' || config.include_time) {
    return config.hour12 ? 'h12_colon_seconds' : 'h24_colon_seconds';
  }
  return 'none';
}

function dateDisplayFormatLabel(value: DateDisplayFormat) {
  if (value === 'none') return '无';
  if (value === 'slash') return '年/月/日';
  if (value === 'dash') return '年-月-日';
  return '年月日';
}

function timeDisplayFormatLabel(value: TimeDisplayFormat) {
  if (value === 'none') return '无';
  if (value === 'h12_colon_seconds') return '上午 12:00:00';
  if (value === 'h12_dash_seconds') return '上午 12-00-00';
  if (value === 'h24_dash_seconds') return '24-00-00';
  return '24:00:00';
}

function timezoneLabel(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'GMT+8';
}

function dateFormatPatch(config: Record<string, any>, dateFormat: DateDisplayFormat) {
  const nextTimeFormat = timeDisplayFormat(config);
  return {
    date_format: dateFormat,
    date_content: dateContentModeFromFormats(dateFormat, nextTimeFormat),
    include_time: nextTimeFormat !== 'none',
  };
}

function timeFormatPatch(config: Record<string, any>, timeFormat: TimeDisplayFormat) {
  const nextDateFormat = dateDisplayFormat(config);
  return {
    time_format: timeFormat,
    hour12: timeFormat.startsWith('h12'),
    include_time: timeFormat !== 'none',
    date_content: dateContentModeFromFormats(nextDateFormat, timeFormat),
  };
}

function dateContentModeFromFormats(dateFormat: DateDisplayFormat, timeFormat: TimeDisplayFormat): DateContentMode {
  if (dateFormat !== 'none' && timeFormat !== 'none') return 'datetime';
  if (timeFormat !== 'none') return 'time';
  return 'date';
}

function alignLabel(value: ViewColumnRule['align']) {
  if (value === 'center') return '中';
  if (value === 'right') return '右';
  return '左';
}

function TextDisplaySubmenu({ secret, style, onMouseEnter, onMouseLeave, onChange }: { secret: boolean; style: CSSProperties; onMouseEnter: () => void; onMouseLeave: () => void; onChange: (secret: boolean) => void }) {
  const choices = [
    { id: 'plain', label: '明文', secret: false },
    { id: 'secret', label: '密文', secret: true },
  ];
  return (
    <div
      className="akdb-column-number-submenu"
      role="menu"
      aria-label="文本显示方式"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="akdb-column-property-list">
        {choices.map((choice) => {
          const active = secret === choice.secret;
          return (
            <button
              key={choice.id}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`akdb-column-type-item akdb-column-property-choice-item has-leading-visual ${active ? 'is-active' : ''}`}
              onClick={() => onChange(choice.secret)}
            >
              <span>{choice.label}</span>
              {active && <Check size={16} className="akdb-column-type-check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AlignSubmenu({ value, style, onMouseEnter, onMouseLeave, onChange }: { value: ViewColumnRule['align']; style: CSSProperties; onMouseEnter: () => void; onMouseLeave: () => void; onChange: (align: ViewColumnRule['align']) => void }) {
  const choices = [
    { id: 'left', label: '左', icon: <AlignLeft size={15} /> },
    { id: 'center', label: '中', icon: <AlignCenter size={15} /> },
    { id: 'right', label: '右', icon: <AlignRight size={15} /> },
  ] as const;
  return (
    <div
      className="akdb-column-number-submenu"
      role="menu"
      aria-label="对齐方式"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="akdb-column-property-list">
        {choices.map((choice) => {
          const active = choice.id === 'left' ? value === 'left' || !value : value === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`akdb-column-type-item akdb-column-property-choice-item has-leading-visual ${active ? 'is-active' : ''}`}
              onClick={() => onChange(choice.id)}
            >
              <span>{choice.icon}</span>
              <span>{choice.label}</span>
              {active && <Check size={16} className="akdb-column-type-check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CheckboxStyleSubmenu({ value, style, onMouseEnter, onMouseLeave, onChange }: { value: CheckboxDisplayStyle; style: CSSProperties; onMouseEnter: () => void; onMouseLeave: () => void; onChange: (style: CheckboxDisplayStyle) => void }) {
  const choices: Array<{ id: CheckboxDisplayStyle; label: string }> = [
    { id: 'checkbox', label: 'Checkbox' },
    { id: 'radio', label: '圆点' },
    { id: 'switch', label: 'Switch' },
  ];
  return (
    <div
      className="akdb-column-number-submenu"
      role="menu"
      aria-label="复选框样式"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="akdb-column-property-list">
        {choices.map((choice) => {
          const active = value === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`akdb-column-type-item akdb-column-property-choice-item has-leading-visual is-checkbox-style ${active ? 'is-active' : ''}`}
              onClick={() => onChange(choice.id)}
            >
              <span className="akdb-checkbox-style-preview">
                <CheckboxDisplay checked styleType={choice.id} />
              </span>
              <span>{choice.label}</span>
              {active && <Check size={16} className="akdb-column-type-check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CheckboxDisplay({ checked, styleType }: { checked: boolean; styleType: CheckboxDisplayStyle }) {
  if (styleType === 'switch') {
    return (
      <span className={`akdb-checkbox-display akdb-checkbox-display-switch ${checked ? 'is-checked' : ''}`}>
        <span />
      </span>
    );
  }
  if (styleType === 'radio') {
    return (
      <span className={`akdb-checkbox-display akdb-checkbox-display-radio ${checked ? 'is-checked' : ''}`}>
        <span />
      </span>
    );
  }
  return (
    <span className={`akdb-checkbox-display akdb-checkbox-display-box ${checked ? 'is-checked' : ''}`}>
      {checked && <Check size={13} strokeWidth={2.4} />}
    </span>
  );
}

function DateDisplayFormatSubmenu({ value, style, className, onMouseEnter, onMouseLeave, onChange }: { value: DateDisplayFormat; style: CSSProperties; className?: string; onMouseEnter: () => void; onMouseLeave: () => void; onChange: (dateFormat: DateDisplayFormat) => void }) {
  const choices: Array<{ id: DateDisplayFormat; label: string }> = [
    { id: 'none', label: '无' },
    { id: 'slash', label: '年/月/日' },
    { id: 'chinese', label: '年月日' },
    { id: 'dash', label: '年-月-日' },
  ];
  return (
    <div
      className={`akdb-column-number-submenu ${className || ''}`}
      role="menu"
      aria-label="日期格式"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="akdb-column-property-list">
        {choices.map((choice) => {
          const active = value === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`akdb-column-type-item akdb-column-property-choice-item ${active ? 'is-active' : ''}`}
              onClick={() => onChange(choice.id)}
            >
              <span>{choice.label}</span>
              {active && <Check size={16} className="akdb-column-type-check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimeDisplayFormatSubmenu({ value, style, className, onMouseEnter, onMouseLeave, onChange }: { value: TimeDisplayFormat; style: CSSProperties; className?: string; onMouseEnter: () => void; onMouseLeave: () => void; onChange: (timeFormat: TimeDisplayFormat) => void }) {
  const choices: Array<{ id: TimeDisplayFormat; label: string }> = [
    { id: 'none', label: '无' },
    { id: 'h12_colon_seconds', label: '上午 12:00:00' },
    { id: 'h12_dash_seconds', label: '上午 12-00-00' },
    { id: 'h24_colon_seconds', label: '24:00:00' },
    { id: 'h24_dash_seconds', label: '24-00-00' },
  ];
  return (
    <div
      className={`akdb-column-number-submenu ${className || ''}`}
      role="menu"
      aria-label="时间格式"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="akdb-column-property-list">
        {choices.map((choice) => {
          const active = value === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`akdb-column-type-item akdb-column-property-choice-item ${active ? 'is-active' : ''}`}
              onClick={() => onChange(choice.id)}
            >
              <span>{choice.label}</span>
              {active && <Check size={16} className="akdb-column-type-check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimezoneSubmenu({ value, style, className, onMouseEnter, onMouseLeave, onChange }: { value: string; style: CSSProperties; className?: string; onMouseEnter: () => void; onMouseLeave: () => void; onChange: (timezone: string) => void }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const choices = [
    'GMT-12', 'GMT-11', 'GMT-10', 'GMT-9', 'GMT-8', 'GMT-7', 'GMT-6', 'GMT-5', 'GMT-4', 'GMT-3', 'GMT-2', 'GMT-1',
    'GMT+0', 'GMT+1', 'GMT+2', 'GMT+3', 'GMT+4', 'GMT+5', 'GMT+6', 'GMT+7', 'GMT+8', 'GMT+9', 'GMT+10', 'GMT+11', 'GMT+12', 'GMT+13', 'GMT+14',
  ];
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const list = listRef.current;
    if (list) list.scrollTop += event.deltaY;
  };
  return (
    <div
      className={`akdb-column-number-submenu ${className || ''}`}
      role="menu"
      aria-label="时区"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onWheel={handleWheel}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div ref={listRef} className="akdb-timezone-list" onWheel={handleWheel}>
        {choices.map((choice) => {
          const active = value === choice;
          return (
            <button
              key={choice}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`akdb-timezone-item ${active ? 'is-active' : ''}`}
              onClick={() => onChange(choice)}
            >
              <span>{choice}</span>
              {active && <Check size={16} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NumberFormatSubmenu({ value, style, onMouseEnter, onMouseLeave, onChange }: { value: string; style: CSSProperties; onMouseEnter: () => void; onMouseLeave: () => void; onChange: (format: string) => void }) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const options = normalized
    ? numberFormatChoices.filter((choice) => choice.label.toLowerCase().includes(normalized) || choice.id.includes(normalized))
    : numberFormatChoices;
  return (
    <div
      className="akdb-column-number-submenu is-format"
      role="menu"
      aria-label="数字格式"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="akdb-number-format-search">
        <input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="筛选格式..."
          aria-label="筛选格式"
          autoFocus
        />
      </div>
      <div className="akdb-column-property-list">
        {options.map((choice) => {
          const active = (value || 'number') === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`akdb-column-type-item akdb-number-format-item ${active ? 'is-active' : ''}`}
              onClick={() => onChange(choice.id)}
            >
              <span>{choice.label}</span>
              {active && <Check size={16} className="akdb-column-type-check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NumberColorSubmenu({ value, style, onMouseEnter, onMouseLeave, onChange }: { value: string; style: CSSProperties; onMouseEnter: () => void; onMouseLeave: () => void; onChange: (color: string) => void }) {
  return (
    <div
      className="akdb-column-number-submenu"
      role="menu"
      aria-label="数字显示颜色"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="akdb-column-property-list">
        {optionColorChoices.map((choice) => {
          const active = (value || 'green') === choice.id;
          const color = optionColorMap[choice.id] || optionColorMap.gray;
          return (
            <button
              key={choice.id}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`akdb-column-type-item akdb-number-format-item ${active ? 'is-active' : ''}`}
              onClick={() => onChange(choice.id)}
            >
              <span className="akdb-number-color-swatch" style={{ backgroundColor: color.bg, borderColor: color.border }} />
              <span>{choice.label}</span>
              {active && <Check size={16} className="akdb-column-type-check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PrecisionSubmenu({ value, style, onMouseEnter, onMouseLeave, onChange }: { value: number; style: CSSProperties; onMouseEnter: () => void; onMouseLeave: () => void; onChange: (precision: number) => void }) {
  const choices = [-1, 0, 1, 2, 3, 4, 5];
  return (
    <div
      className="akdb-column-number-submenu"
      role="menu"
      aria-label="小数位数"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="akdb-column-property-list">
        {choices.map((precision) => {
          const active = value === precision;
          return (
            <button
              key={precision}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`akdb-column-type-item akdb-number-format-item ${active ? 'is-active' : ''}`}
              onClick={() => onChange(precision)}
            >
              <span>{precisionLabel(precision)}</span>
              {active && <Check size={16} className="akdb-column-type-check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EditableCell({ value, column, align, readonly, active, editingActive, rangeSelected, fillSelected, onChange, onEditStateChange, onFillPointerDown, onCreateOption, onReorderOption, onUpdateOption, onDeleteOption, onUpdateColumnConfig, onEditProperty, cellProps }: { value: string; column?: DatabaseColumn; align?: ViewColumnRule['align']; readonly?: boolean; active?: boolean; editingActive?: boolean; rangeSelected?: boolean; fillSelected?: boolean; onChange: (value: string) => void; onEditStateChange?: (editing: boolean) => void; onFillPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void; onCreateOption?: (label: string) => Promise<any | null>; onReorderOption?: (sourceID: string, targetID: string) => Promise<void>; onUpdateOption?: (optionID: string, patch: Record<string, any>) => Promise<void>; onDeleteOption?: (optionID: string) => Promise<void>; onUpdateColumnConfig?: (patch: Record<string, any>) => Promise<void>; onEditProperty?: (anchor: HTMLElement) => void; cellProps?: TdHTMLAttributes<HTMLTableCellElement> }) {
  const [local, setLocal] = useState(value);
  const [editing, setEditing] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [focusRect, setFocusRect] = useState<CSSProperties | null>(null);
  const cellRef = useRef<HTMLTableCellElement | null>(null);
  const dateButtonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const textEditorFocusedRef = useRef(false);
  const focusTextEditorAtEnd = () => {
    const input = inputRef.current;
    if (!(input instanceof HTMLTextAreaElement)) return;
    input.focus();
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
  };
  const setInputElement = (element: HTMLInputElement | HTMLTextAreaElement | null) => {
    inputRef.current = element;
    if (element instanceof HTMLTextAreaElement && editing && column?.type === 'text' && !column.config?.secret) {
      requestAnimationFrame(updateTextEditorRect);
    }
  };
  const skipNextCommitRef = useRef(false);
  const datePickerRect = useDropdownPosition(datePickerOpen, dateButtonRef, 280, 'below', -8);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    if (editingActive && !editing && column && column.type !== 'checkbox' && column.type !== 'select' && column.type !== 'status' && column.type !== 'multi_select' && column.type !== 'date') {
      setEditing(true);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editingActive, editing, column]);
  useEffect(() => {
    if (editing && (column?.type === 'number' || column?.type === 'url')) inputRef.current?.focus();
  }, [editing, column?.type]);
  useLayoutEffect(() => {
    if (!editing) {
      textEditorFocusedRef.current = false;
      return;
    }
    if (column?.type !== 'text' || column.config?.secret || !focusRect || textEditorFocusedRef.current) return;
    const input = inputRef.current;
    if (!input) return;
    focusTextEditorAtEnd();
    textEditorFocusedRef.current = true;
  }, [editing, focusRect, column?.type, column?.config?.secret]);
  useDropdownOutsideClose(datePickerOpen, dateButtonRef, () => { setDatePickerOpen(false); setFocusRect(null); }, '.akdb-date-picker, .akdb-column-number-submenu');
  const updateFocusRect = () => {
    const rect = cellRef.current?.getBoundingClientRect();
    if (!rect) return;
    setFocusRect({
      position: 'fixed',
      left: rect.left,
      top: rect.top - 1,
      width: rect.width,
      height: rect.height + 2,
    });
  };
  const updateTextEditorRect = () => {
    const rect = cellRef.current?.getBoundingClientRect();
    const input = inputRef.current;
    if (!rect) return;
    const viewportPadding = 8;
    const maxHeight = Math.max(96, window.innerHeight - viewportPadding * 2);
    let contentHeight = rect.height;
    if (input instanceof HTMLTextAreaElement) {
      const previousHeight = input.style.height;
      const previousOverflowY = input.style.overflowY;
      input.style.height = '0px';
      input.style.overflowY = 'hidden';
      contentHeight = input.scrollHeight;
      input.style.height = previousHeight;
      input.style.overflowY = previousOverflowY;
    }
    const height = Math.min(maxHeight, Math.max(rect.height, contentHeight));
    const maxTop = window.innerHeight - viewportPadding - height;
    const top = Math.max(viewportPadding, Math.min(rect.top, maxTop));
    const nextRect = {
      position: 'fixed',
      left: rect.left,
      top,
      width: rect.width,
      height,
      maxHeight,
      overflowY: contentHeight > maxHeight ? 'auto' : 'hidden',
    } as CSSProperties;
    setFocusRect((current) => {
      if (
        current
        && current.left === nextRect.left
        && current.top === nextRect.top
        && current.width === nextRect.width
        && current.height === nextRect.height
        && current.maxHeight === nextRect.maxHeight
        && current.overflowY === nextRect.overflowY
      ) return current;
      return nextRect;
    });
  };
  useEffect(() => {
    if (!focusRect) return;
    const update = () => {
      if (column?.type === 'text' && !column.config?.secret && editing) {
        updateTextEditorRect();
        return;
      }
      updateFocusRect();
    };
    const preventScroll = (event: WheelEvent | TouchEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.akdb-text-editor-overlay')) return;
      event.preventDefault();
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    document.addEventListener('wheel', preventScroll, { capture: true, passive: false });
    document.addEventListener('touchmove', preventScroll, { capture: true, passive: false });
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      document.removeEventListener('wheel', preventScroll, true);
      document.removeEventListener('touchmove', preventScroll, true);
    };
  }, [focusRect, editing, column?.type, column?.config?.secret]);
  useLayoutEffect(() => {
    if (!editing || column?.type !== 'text' || column.config?.secret) return;
    updateTextEditorRect();
  }, [editing, local, column?.type, column?.config?.secret]);
  const isCellEditing = editing || !!editingActive;
  const tdProps = (className?: string): TdHTMLAttributes<HTMLTableCellElement> => ({
    ...cellProps,
    className: [cellProps?.className, className, columnAlignClass({ align }), isCellEditing ? 'is-akdb-cell-editing' : '', !isCellEditing && rangeSelected ? 'is-akdb-cell-selected' : '', !isCellEditing && fillSelected ? 'is-akdb-cell-fill-selected' : '', active && !isCellEditing ? 'is-akdb-cell-active' : ''].filter(Boolean).join(' ') || undefined,
  });
  const focusOverlay = focusRect && column?.type !== 'date' ? createPortal(<div className="akdb-cell-focus-overlay" style={focusRect} />, document.body) : null;
  const cellChrome = active && !isCellEditing && !readonly ? (
    <span
      className="akdb-cell-fill-handle"
      role="presentation"
      onPointerDown={onFillPointerDown}
    />
  ) : null;
  if (!column) return <td {...tdProps('akdb-readonly')}>{formatValue(value, column)}</td>;
  if (column.type === 'checkbox') {
    const disabled = readonly || column.readonly;
    const checked = local === 'true';
    const styleType = normalizeCheckboxDisplayStyle(column.config?.checkbox_style);
    return (
      <td {...tdProps('akdb-checkbox-cell')}>
        <button
          type="button"
          className={`akdb-checkbox-toggle is-${styleType}`}
          aria-pressed={checked}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            const next = String(!checked);
            setLocal(next);
            onChange(next);
          }}
        >
          <CheckboxDisplay checked={checked} styleType={styleType} />
        </button>
        {cellChrome}
      </td>
    );
  }
  if (readonly || column.readonly) return <td {...tdProps('akdb-readonly')}>{formatValue(value, column)}{cellChrome}</td>;
  if (column.type === 'select' || column.type === 'status') {
    const options = (column.config?.options || []) as Array<{ id: string; value: string }>;
    return (
      <td {...tdProps('akdb-choice-cell')} ref={cellRef}>
        <OptionSelect
          value={local}
          options={options}
          config={column.config || {}}
          isStatus={column.type === 'status'}
          anchorRef={cellRef}
          onCreate={onCreateOption}
          onReorder={onReorderOption}
          onUpdateOption={onUpdateOption}
          onDeleteOption={onDeleteOption}
          onOpenChange={(open) => onEditStateChange?.(open)}
          onEditProperty={onEditProperty ? () => {
            if (cellRef.current) onEditProperty(cellRef.current);
          } : undefined}
          onChange={(next) => {
            setLocal(next);
            onChange(next);
          }}
        />
        {cellChrome}
      </td>
    );
  }
  if (column.type === 'multi_select') {
    const options = (column.config?.options || []) as Array<{ id: string; value: string }>;
    let ids: string[] = [];
    try { ids = JSON.parse(local || '[]'); } catch { ids = []; }
    const changeIDs = (nextIDs: string[]) => {
      const next = Array.from(new Set(nextIDs.filter(Boolean)));
      const raw = JSON.stringify(next);
      setLocal(raw);
      onChange(raw);
    };
    return (
      <td {...tdProps('akdb-choice-cell')} ref={cellRef}>
        <OptionMultiSelect
          ids={ids}
          options={options}
          config={column.config || {}}
          anchorRef={cellRef}
          onCreate={onCreateOption}
          onReorder={onReorderOption}
          onUpdateOption={onUpdateOption}
          onDeleteOption={onDeleteOption}
          onOpenChange={(open) => onEditStateChange?.(open)}
          onChange={changeIDs}
        />
        {cellChrome}
      </td>
    );
  }
  if (column.type === 'date') {
    const display = formatDateValue(local, column);
    return (
      <td {...tdProps('akdb-editable-cell akdb-date-cell')} ref={cellRef}>
        <button
          ref={dateButtonRef}
          type="button"
          className={`akdb-date-cell-btn ${datePickerOpen ? 'is-active' : ''}`}
          onClick={() => {
            updateFocusRect();
            setDatePickerOpen((next) => !next);
            onEditStateChange?.(true);
          }}
          aria-haspopup="dialog"
          aria-expanded={datePickerOpen}
        >
          {display || <span className="akdb-date-cell-empty" />}
        </button>
        {focusOverlay}
        {cellChrome}
        {datePickerOpen && datePickerRect && createPortal(
          <>
            <CellPopupMask onClose={() => {
              setDatePickerOpen(false);
              setFocusRect(null);
              onEditStateChange?.(false);
            }} />
            <DateTimePicker
              value={local}
              column={column}
              style={datePickerRect}
              onChange={(next) => {
                setLocal(next);
                onChange(next);
              }}
              onUpdateConfig={(patch) => void onUpdateColumnConfig?.(patch)}
              onClose={() => {
                setDatePickerOpen(false);
                setFocusRect(null);
                onEditStateChange?.(false);
              }}
            />
          </>,
          document.body,
        )}
      </td>
    );
  }
  const maxLength = column.type === 'text' && Number(column.config?.max_length) > 0 ? Number(column.config?.max_length) : undefined;
  const inputType = column.type === 'text' && column.config?.secret ? 'password' : 'text';
  const numberInputProps = column.type === 'number' ? getNumberInputProps(column) : {};
  const inputValue = column.type === 'number' && !editing ? formatNumberValue(local, column) : local;
  const commitValue = () => {
    if (skipNextCommitRef.current) {
      skipNextCommitRef.current = false;
      setLocal(value);
      return;
    }
    const next = column.type === 'number' ? normalizeNumberValue(local, column) : local;
    if (next !== local) setLocal(next);
    if (next !== value) onChange(next);
  };
  if (column.type === 'text' && !column.config?.secret) {
    const textEditor = editing && focusRect ? createPortal(
      <textarea
        ref={setInputElement}
        className="akdb-text-editor-overlay"
        value={local}
        wrap="soft"
        maxLength={maxLength}
        style={focusRect}
        onChange={(event) => setLocal(event.currentTarget.value)}
        onBlur={() => {
          commitValue();
          setEditing(false);
          onEditStateChange?.(false);
          setFocusRect(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.blur();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            skipNextCommitRef.current = true;
            setLocal(value);
            setEditing(false);
            onEditStateChange?.(false);
            setFocusRect(null);
            event.currentTarget.blur();
          }
        }}
      />,
      document.body,
    ) : null;
    return (
      <td {...tdProps('akdb-editable-cell akdb-text-cell')} ref={cellRef}>
        <button
          type="button"
          className="akdb-text-cell-preview"
          onClick={() => {
            setEditing(true);
            onEditStateChange?.(true);
            requestAnimationFrame(() => {
              updateTextEditorRect();
              focusTextEditorAtEnd();
            });
          }}
        >
          {local}
        </button>
        {textEditor}
        {cellChrome}
      </td>
    );
  }
  if (column.type === 'number' && !editing && (column.config?.display_as === 'bar' || column.config?.display_as === 'ring')) {
    return (
      <td {...tdProps('akdb-number-visual-cell')} ref={cellRef}>
        <button type="button" className="akdb-number-visual-btn" onClick={() => { setEditing(true); onEditStateChange?.(true); }}>
          <NumberVisualValue value={local} column={column} />
        </button>
        {cellChrome}
      </td>
    );
  }
  const normalizedUrl = column.type === 'url' ? normalizeDatabaseUrl(local) : '';
  if (column.type === 'url' && normalizedUrl && !editing) {
    return (
      <td
        {...tdProps('akdb-editable-cell akdb-url-cell')}
        ref={cellRef}
        onClick={() => {
          setEditing(true);
          onEditStateChange?.(true);
          requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
          });
        }}
      >
        <button
          type="button"
          className="akdb-url-link"
          title={normalizedUrl}
          onClick={(event) => {
            event.stopPropagation();
            window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
          }}
        >
          {local}
        </button>
      </td>
    );
  }
  return <td {...tdProps('akdb-editable-cell')} ref={cellRef}><input ref={setInputElement} value={inputValue} type={inputType} maxLength={maxLength} {...numberInputProps} onFocus={() => { setEditing(true); onEditStateChange?.(true); updateFocusRect(); }} onChange={(e) => setLocal(e.target.value)} onBlur={() => { commitValue(); setEditing(false); onEditStateChange?.(false); setFocusRect(null); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); skipNextCommitRef.current = true; setLocal(value); setEditing(false); onEditStateChange?.(false); setFocusRect(null); (e.currentTarget as HTMLInputElement).blur(); } }} />{focusOverlay}{cellChrome}</td>;
}

function OptionSelect({ value, options, config, isStatus, anchorRef, onChange, onCreate, onReorder, onUpdateOption, onDeleteOption, onOpenChange, onEditProperty }: { value: string; options: any[]; config: Record<string, any>; isStatus?: boolean; anchorRef?: RefObject<HTMLElement>; onChange: (value: string) => void; onCreate?: (label: string) => Promise<any | null>; onReorder?: (sourceID: string, targetID: string) => Promise<void>; onUpdateOption?: (optionID: string, patch: Record<string, any>) => Promise<void>; onDeleteOption?: (optionID: string) => Promise<void>; onOpenChange?: (open: boolean) => void; onEditProperty?: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [dragState, setDragState] = useState<{
    sourceID: string;
    targetID: string;
    sourceIndex: number;
    targetIndex: number;
    pointerOffset: number;
    minTop: number;
    maxTop: number;
    initialTop: number;
    currentTop: number;
    rowHeight: number;
    step: number;
    centers: number[];
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const editAnchorRef = useRef<HTMLButtonElement | null>(null);
  const dragStateRef = useRef<typeof dragState>(null);
  const suppressOptionClickRef = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  const [editingOptionID, setEditingOptionID] = useState<string | null>(null);
  const menuRect = useDropdownPosition(open, anchorRef || buttonRef, 300, 'overlay', 0, !isStatus);
  const editMenuRect = useSubmenuPosition(!!editingOptionID, editAnchorRef, 252, 430);
  useDropdownOutsideClose(open, buttonRef, () => setOpen(false), '.akdb-option-menu, .akdb-option-edit-menu');
  useDropdownOutsideClose(!!editingOptionID, editAnchorRef, () => setEditingOptionID(null), '.akdb-option-edit-menu, .akdb-column-icon-popover');
  const selected = options.find((option) => option.id === value);
  const editingOption = options.find((option) => option.id === editingOptionID);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) => String(option.value || option.id || '').toLowerCase().includes(normalizedQuery))
    : options;
  const groupedOptions = getGroupedOptions(filteredOptions, config);
  const flatOptions = groupedOptions.flatMap((group) => group.options);
  const exactOption = options.find((option) => String(option.value || '').trim().toLowerCase() === normalizedQuery);
  const canCreate = !isStatus && !!onCreate && !!query.trim() && !exactOption;
  useEffect(() => {
    if (!open) return;
    setQuery('');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  useEffect(() => {
    onOpenChangeRef.current?.(open);
  }, [open]);
  const selectOption = (optionID: string) => {
    onChange(optionID);
    setOpen(false);
  };
  const createAndSelect = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      const option = await onCreate?.(query);
      if (option?.id) selectOption(option.id);
    } finally {
      setCreating(false);
    }
  };
  const beginOptionDrag = (optionID: string, event: ReactPointerEvent<SVGSVGElement>) => {
    if (isStatus || event.button !== 0 || normalizedQuery || options.length < 2 || !onReorder) return;
    const list = listRef.current;
    const row = (event.currentTarget.closest('[data-option-id]') as HTMLElement | null);
    if (!list || !row) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-option-id]'));
    const sourceIndex = rows.findIndex((row) => row.dataset.optionId === optionID);
    if (sourceIndex < 0) return;
    const rowRects = rows.map((item) => item.getBoundingClientRect());
    const gap = rowRects.length > 1 ? Math.max(0, rowRects[1].top - rowRects[0].bottom) : 0;
    const rowTop = rowRect.top - listRect.top;
    const rowHeight = rowRect.height;
    const baseState = {
      sourceID: optionID,
      targetID: optionID,
      sourceIndex,
      targetIndex: sourceIndex,
      pointerOffset: event.clientY - rowRect.top,
      minTop: Math.max(0, rowRects[0].top - listRect.top),
      maxTop: Math.max(0, rowRects[rowRects.length - 1].bottom - listRect.top - rowHeight),
      initialTop: rowTop,
      currentTop: rowTop,
      rowHeight,
      step: rowHeight + gap,
      centers: rowRects.map((rect) => rect.top - listRect.top + rect.height / 2),
    };
    dragStateRef.current = baseState;
    setDragState(baseState);
    const updateTarget = (clientY: number) => {
      setDragState((current) => {
        if (!current) return current;
        const currentTop = Math.min(current.maxTop, Math.max(current.minTop, clientY - listRect.top - current.pointerOffset));
        const currentCenter = currentTop + current.rowHeight / 2;
        const targetIndex = current.centers.findIndex((center) => currentCenter <= center);
        const nextTargetIndex = targetIndex === -1 ? current.centers.length - 1 : targetIndex;
        const targetID = rows[nextTargetIndex]?.dataset.optionId || current.targetID;
        const next = {
          ...current,
          currentTop,
          targetIndex: nextTargetIndex,
          targetID,
        };
        dragStateRef.current = next;
        return next;
      });
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateTarget(moveEvent.clientY);
      moveEvent.preventDefault();
    };
    const handlePointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      const finalState = dragStateRef.current;
      flushSync(() => {
        dragStateRef.current = null;
        setDragState(null);
      });
      suppressOptionClickRef.current = true;
      window.setTimeout(() => { suppressOptionClickRef.current = false; }, 0);
      if (finalState && finalState.sourceID !== finalState.targetID) void onReorder(finalState.sourceID, finalState.targetID);
      try {
        event.currentTarget.releasePointerCapture(upEvent.pointerId);
      } catch {
        // Pointer capture may already be released when the pointer ends outside the icon.
      }
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };
  return (
    <div className="akdb-option-select">
      <button ref={buttonRef} type="button" className={`akdb-option-select-btn ${selected ? 'has-value' : 'is-empty'}`} onClick={() => setOpen((next) => !next)} aria-haspopup="listbox" aria-expanded={open}>
        {selected ? (
          <span className="akdb-option-select-value"><OptionTag option={selected} config={config} /></span>
        ) : (
          <span className="akdb-option-select-empty" aria-hidden="true" />
        )}
      </button>
      {open && menuRect && createPortal(
        <>
        <CellPopupMask onClose={() => {
          setEditingOptionID(null);
          setOpen(false);
        }} />
        <div className={`akdb-option-menu akdb-option-select-menu ${isStatus ? 'is-status' : ''}`} role="dialog" tabIndex={-1} style={menuRect}>
          <div className="akdb-option-combobox" role="combobox" aria-expanded="true" aria-haspopup="listbox">
            {selected && !query && <OptionTag option={selected} config={config} removable onRemove={() => onChange('')} />}
            <input
              ref={inputRef}
              value={query}
              placeholder={selected ? '' : isStatus ? '搜索状态' : '搜索或创建选项'}
              aria-label={isStatus ? '选择状态' : '选择或创建一个选项'}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (canCreate) createAndSelect();
                  else if (filteredOptions[0]) selectOption(filteredOptions[0].id);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                }
                if (event.key === 'Backspace' && !query && selected) onChange('');
              }}
            />
          </div>
          {!isStatus && <div className="akdb-option-menu-title akdb-menu-caption">选择或创建一个选项</div>}
          <div ref={listRef} className="akdb-option-list" role="listbox">
            {!flatOptions.length && <div className="akdb-option-menu-empty">没有匹配的选项</div>}
            {groupedOptions.map((group) => (
              <div key={group.key} className="akdb-option-menu-section">
                {group.label && <div className="akdb-option-menu-group akdb-menu-caption">{group.label}</div>}
                {group.options.map((option) => {
                  const active = option.id === value;
                  const index = flatOptions.findIndex((item) => item.id === option.id);
                  const isDragging = dragState?.sourceID === option.id;
                  let translateY = 0;
                  if (dragState && index >= 0) {
                    if (isDragging) translateY = dragState.currentTop - dragState.initialTop;
                    else if (dragState.sourceIndex < dragState.targetIndex && index > dragState.sourceIndex && index <= dragState.targetIndex) translateY = -dragState.step;
                    else if (dragState.targetIndex < dragState.sourceIndex && index >= dragState.targetIndex && index < dragState.sourceIndex) translateY = dragState.step;
                  }
                  return (
                    <div
                      key={option.id}
                      data-option-id={option.id}
                      className={`akdb-option-menu-item ${active ? 'is-active' : ''} ${isDragging ? 'is-dragging' : ''}`}
                      style={{ transform: translateY ? `translateY(${translateY}px)` : undefined }}
                      role="option"
                      tabIndex={-1}
                      aria-selected={active}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (suppressOptionClickRef.current) return;
                        selectOption(option.id);
                      }}
                    >
                      {!isStatus && <GripVertical size={16} className="akdb-option-drag" onPointerDown={(event) => beginOptionDrag(option.id, event)} />}
                      <OptionTag option={option} config={config} />
                      {!isStatus && (
                        <button
                          ref={editingOptionID === option.id ? editAnchorRef : undefined}
                          type="button"
                          className="akdb-option-more"
                          aria-label="修改选项"
                          aria-haspopup="dialog"
                          aria-expanded={editingOptionID === option.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={(event) => {
                            event.stopPropagation();
                            editAnchorRef.current = event.currentTarget;
                            setEditingOptionID((current) => current === option.id ? null : option.id);
                          }}
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {canCreate && (
            <button
              type="button"
              className="akdb-option-create"
              disabled={creating}
              onMouseDown={(event) => event.preventDefault()}
              onClick={createAndSelect}
            >
              <Plus size={18} />
              <span>创建</span>
              <OptionTag option={{ value: query.trim(), color: 'gray' }} config={config} />
            </button>
          )}
          {isStatus && (
            <button
              type="button"
              className="akdb-option-edit-property"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setOpen(false);
                onEditProperty?.();
              }}
            >
              <SlidersHorizontal size={18} />
              <span>编辑属性</span>
            </button>
          )}
          {editingOption && editMenuRect && createPortal(
            <OptionEditMenu
              option={editingOption}
              config={config}
              style={editMenuRect}
              onUpdate={(patch) => onUpdateOption?.(editingOption.id, patch)}
              onDelete={async () => {
                await onDeleteOption?.(editingOption.id);
                setEditingOptionID(null);
              }}
            />,
            document.body,
          )}
        </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function OptionMultiSelect({ ids, options, config, anchorRef, onChange, onCreate, onReorder, onUpdateOption, onDeleteOption, onOpenChange }: { ids: string[]; options: any[]; config: Record<string, any>; anchorRef?: RefObject<HTMLElement>; onChange: (ids: string[]) => void; onCreate?: (label: string) => Promise<any | null>; onReorder?: (sourceID: string, targetID: string) => Promise<void>; onUpdateOption?: (optionID: string, patch: Record<string, any>) => Promise<void>; onDeleteOption?: (optionID: string) => Promise<void>; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [dragState, setDragState] = useState<{
    sourceID: string;
    targetID: string;
    sourceIndex: number;
    targetIndex: number;
    pointerOffset: number;
    minTop: number;
    maxTop: number;
    initialTop: number;
    currentTop: number;
    rowHeight: number;
    step: number;
    centers: number[];
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const editAnchorRef = useRef<HTMLButtonElement | null>(null);
  const dragStateRef = useRef<typeof dragState>(null);
  const suppressOptionClickRef = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  const [editingOptionID, setEditingOptionID] = useState<string | null>(null);
  const menuRect = useDropdownPosition(open, anchorRef || buttonRef, 300, 'overlay');
  const editMenuRect = useSubmenuPosition(!!editingOptionID, editAnchorRef, 252, 430);
  useDropdownOutsideClose(open, buttonRef, () => setOpen(false), '.akdb-option-menu, .akdb-option-edit-menu');
  useDropdownOutsideClose(!!editingOptionID, editAnchorRef, () => setEditingOptionID(null), '.akdb-option-edit-menu, .akdb-column-icon-popover');
  const selectedOptions = ids.map((id) => options.find((option) => option.id === id)).filter(Boolean);
  const editingOption = options.find((option) => option.id === editingOptionID);
  const selectedIDs = new Set(ids);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) => String(option.value || option.id || '').toLowerCase().includes(normalizedQuery))
    : options;
  const groupedOptions = getGroupedOptions(filteredOptions, config);
  const flatOptions = groupedOptions.flatMap((group) => group.options);
  const exactOption = options.find((option) => String(option.value || '').trim().toLowerCase() === normalizedQuery);
  const canCreate = !!onCreate && !!query.trim() && !exactOption;
  useEffect(() => {
    if (!open) return;
    setQuery('');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  useEffect(() => {
    onOpenChangeRef.current?.(open);
  }, [open]);
  const toggleOption = (optionID: string) => {
    if (selectedIDs.has(optionID)) onChange(ids.filter((id) => id !== optionID));
    else onChange([...ids, optionID]);
  };
  const createAndSelect = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      const option = await onCreate?.(query);
      if (option?.id) {
        onChange([...ids, option.id]);
        setQuery('');
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    } finally {
      setCreating(false);
    }
  };
  const beginOptionDrag = (optionID: string, event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || normalizedQuery || options.length < 2 || !onReorder) return;
    const list = listRef.current;
    const row = (event.currentTarget.closest('[data-option-id]') as HTMLElement | null);
    if (!list || !row) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-option-id]'));
    const sourceIndex = rows.findIndex((row) => row.dataset.optionId === optionID);
    if (sourceIndex < 0) return;
    const rowRects = rows.map((item) => item.getBoundingClientRect());
    const gap = rowRects.length > 1 ? Math.max(0, rowRects[1].top - rowRects[0].bottom) : 0;
    const rowTop = rowRect.top - listRect.top;
    const rowHeight = rowRect.height;
    const baseState = {
      sourceID: optionID,
      targetID: optionID,
      sourceIndex,
      targetIndex: sourceIndex,
      pointerOffset: event.clientY - rowRect.top,
      minTop: Math.max(0, rowRects[0].top - listRect.top),
      maxTop: Math.max(0, rowRects[rowRects.length - 1].bottom - listRect.top - rowHeight),
      initialTop: rowTop,
      currentTop: rowTop,
      rowHeight,
      step: rowHeight + gap,
      centers: rowRects.map((rect) => rect.top - listRect.top + rect.height / 2),
    };
    dragStateRef.current = baseState;
    setDragState(baseState);
    const updateTarget = (clientY: number) => {
      setDragState((current) => {
        if (!current) return current;
        const currentTop = Math.min(current.maxTop, Math.max(current.minTop, clientY - listRect.top - current.pointerOffset));
        const currentCenter = currentTop + current.rowHeight / 2;
        const targetIndex = current.centers.findIndex((center) => currentCenter <= center);
        const nextTargetIndex = targetIndex === -1 ? current.centers.length - 1 : targetIndex;
        const targetID = rows[nextTargetIndex]?.dataset.optionId || current.targetID;
        const next = { ...current, currentTop, targetIndex: nextTargetIndex, targetID };
        dragStateRef.current = next;
        return next;
      });
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateTarget(moveEvent.clientY);
      moveEvent.preventDefault();
    };
    const handlePointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      const finalState = dragStateRef.current;
      flushSync(() => {
        dragStateRef.current = null;
        setDragState(null);
      });
      suppressOptionClickRef.current = true;
      window.setTimeout(() => { suppressOptionClickRef.current = false; }, 0);
      if (finalState && finalState.sourceID !== finalState.targetID) void onReorder(finalState.sourceID, finalState.targetID);
      try {
        event.currentTarget.releasePointerCapture(upEvent.pointerId);
      } catch {
        // Pointer capture may already be released when the pointer ends outside the icon.
      }
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };
  return (
    <div className="akdb-option-select">
      <button ref={buttonRef} type="button" className={`akdb-option-select-btn ${selectedOptions.length ? 'has-value' : 'is-empty'}`} onClick={() => setOpen((next) => !next)} aria-haspopup="listbox" aria-expanded={open}>
        {selectedOptions.length ? (
          <span className="akdb-option-select-value akdb-tag-list">
            {selectedOptions.map((option: any) => <OptionTag key={option.id} option={option} config={config} />)}
          </span>
        ) : (
          <span className="akdb-option-select-empty" aria-hidden="true" />
        )}
      </button>
      {open && menuRect && createPortal(
        <>
        <CellPopupMask onClose={() => {
          setEditingOptionID(null);
          setOpen(false);
        }} />
        <div className="akdb-option-menu akdb-option-select-menu" role="dialog" tabIndex={-1} style={menuRect}>
          <div className="akdb-option-combobox" role="combobox" aria-expanded="true" aria-haspopup="listbox">
            {!query && selectedOptions.map((option: any) => (
              <OptionTag
                key={option.id}
                option={option}
                config={config}
                removable
                onRemove={() => onChange(ids.filter((id) => id !== option.id))}
              />
            ))}
            <input
              ref={inputRef}
              value={query}
              placeholder={selectedOptions.length ? '' : '搜索或创建选项'}
              aria-label="选择或创建多个选项"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (canCreate) createAndSelect();
                  else if (filteredOptions[0]) toggleOption(filteredOptions[0].id);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                }
                if (event.key === 'Backspace' && !query && ids.length) onChange(ids.slice(0, -1));
              }}
            />
          </div>
          <div className="akdb-option-menu-title akdb-menu-caption">选择或创建多个选项</div>
          <div ref={listRef} className="akdb-option-list" role="listbox" aria-multiselectable="true">
            {groupedOptions.map((group) => (
              <div key={group.key} className="akdb-option-menu-section">
                {group.label && <div className="akdb-option-menu-group akdb-menu-caption">{group.label}</div>}
                {group.options.map((option) => {
                  const active = selectedIDs.has(option.id);
                  const index = flatOptions.findIndex((item) => item.id === option.id);
                  const isDragging = dragState?.sourceID === option.id;
                  let translateY = 0;
                  if (dragState && index >= 0) {
                    if (isDragging) translateY = dragState.currentTop - dragState.initialTop;
                    else if (dragState.sourceIndex < dragState.targetIndex && index > dragState.sourceIndex && index <= dragState.targetIndex) translateY = -dragState.step;
                    else if (dragState.targetIndex < dragState.sourceIndex && index >= dragState.targetIndex && index < dragState.sourceIndex) translateY = dragState.step;
                  }
                  return (
                    <div
                      key={option.id}
                      data-option-id={option.id}
                      className={`akdb-option-menu-item ${active ? 'is-active' : ''} ${isDragging ? 'is-dragging' : ''}`}
                      style={{ transform: translateY ? `translateY(${translateY}px)` : undefined }}
                      role="option"
                      tabIndex={-1}
                      aria-selected={active}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (suppressOptionClickRef.current) return;
                        toggleOption(option.id);
                      }}
                    >
                      <GripVertical size={16} className="akdb-option-drag" onPointerDown={(event) => beginOptionDrag(option.id, event)} />
                      <OptionTag option={option} config={config} />
                      <button
                        ref={editingOptionID === option.id ? editAnchorRef : undefined}
                        type="button"
                        className="akdb-option-more"
                        aria-label="修改选项"
                        aria-haspopup="dialog"
                        aria-expanded={editingOptionID === option.id}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                          event.stopPropagation();
                          editAnchorRef.current = event.currentTarget;
                          setEditingOptionID((current) => current === option.id ? null : option.id);
                        }}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {canCreate && (
            <button
              type="button"
              className="akdb-option-create"
              disabled={creating}
              onMouseDown={(event) => event.preventDefault()}
              onClick={createAndSelect}
            >
              <Plus size={18} />
              <span>创建</span>
              <OptionTag option={{ value: query.trim(), color: 'gray' }} config={config} />
            </button>
          )}
          {editingOption && editMenuRect && createPortal(
            <OptionEditMenu
              option={editingOption}
              config={config}
              style={editMenuRect}
              onUpdate={(patch) => onUpdateOption?.(editingOption.id, patch)}
              onDelete={async () => {
                await onDeleteOption?.(editingOption.id);
                setEditingOptionID(null);
              }}
            />,
            document.body,
          )}
        </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function CellPopupMask({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="akdb-cell-popup-mask"
      aria-hidden="true"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    />
  );
}

function OptionEditMenu({ option, config, style, onUpdate, onDelete }: { option: any; config: Record<string, any>; style: CSSProperties; onUpdate?: (patch: Record<string, any>) => void | Promise<void>; onDelete?: () => void | Promise<void> }) {
  const [name, setName] = useState(String(option.value || option.id || ''));
  const [colorOpen, setColorOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const iconButtonRef = useRef<HTMLButtonElement | null>(null);
  const iconPickerRect = useDropdownPosition(iconOpen, iconButtonRef, 408);
  useEffect(() => setName(String(option.value || option.id || '')), [option.id, option.value]);
  useEffect(() => setColorOpen(false), [option.id]);
  useEffect(() => setIconOpen(false), [option.id]);
  useDropdownOutsideClose(iconOpen, iconButtonRef, () => setIconOpen(false), '.akdb-column-icon-popover');
  const currentShape = option.shape || config.option_shape || 'pill';
  const currentColor = option.color || 'gray';
  const currentColorMode = option.color_mode || config.color_mode || 'background';
  const currentColorTokens = optionColorMap[currentColor] || optionColorMap.gray;
  const colorModeDisabled = currentShape === 'plain';
  const commitName = () => {
    const next = name.trim();
    if (next && next !== option.value) void onUpdate?.({ value: next });
    if (!next) setName(String(option.value || option.id || ''));
  };
  return (
    <div className="akdb-option-edit-menu" role="dialog" aria-label="修改选项" style={style} onPointerDown={(event) => event.stopPropagation()}>
      <div className="akdb-option-edit-head">
        <button
          ref={iconButtonRef}
          type="button"
          className="akdb-option-edit-icon"
          aria-label="选项图标"
          aria-haspopup="dialog"
          aria-expanded={iconOpen}
          onClick={() => setIconOpen((open) => !open)}
        >
          <OptionGlyph icon={option.icon || 'none'} color={currentColorTokens.fg} />
        </button>
        <div className="akdb-option-edit-name">
          <input
            value={name}
            aria-label="选项名称"
            onChange={(event) => setName(event.currentTarget.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
              if (event.key === 'Escape') setName(String(option.value || option.id || ''));
            }}
            autoFocus
          />
        </div>
      </div>
      {iconOpen && iconPickerRect && createPortal(
        <ColumnIconPopover
          currentIcon={option.icon || ''}
          defaultIcon="notion_circle"
          ariaLabel="选项图标"
          style={{ ...iconPickerRect, zIndex: 121 }}
          onPick={(icon) => {
            void onUpdate?.({ icon: icon || 'none' });
            setIconOpen(false);
          }}
        />,
        document.body,
      )}

      <div className="akdb-option-edit-row">
        <div className="akdb-option-edit-label">样式</div>
        <div className="akdb-option-segment" role="group" aria-label="选项样式">
          {optionShapeChoices.map((choice) => {
            const active = currentShape === choice.id;
            return (
              <button key={choice.id} type="button" className={`akdb-option-preview-btn ${active ? 'is-active' : ''}`} onClick={() => void onUpdate?.({ shape: choice.id })}>
                {active && choice.id !== 'plain' ? (
                  <OptionTag option={{ ...option, value: choice.label, color: currentColor, color_mode: currentColorMode }} config={{ ...config, option_shape: choice.id }} />
                ) : (
                  <span>{choice.label}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="akdb-option-edit-row">
        <div className="akdb-option-edit-label">颜色</div>
        <div className="akdb-option-segment akdb-option-color-grid" role="group" aria-label="选项颜色">
          <div className="akdb-option-color-cell">
            <button
              type="button"
              className="akdb-option-color-picker"
              aria-haspopup="listbox"
              aria-expanded={colorOpen}
              onClick={() => setColorOpen((next) => !next)}
            >
              <span className="akdb-option-color-square" aria-hidden="true" style={{ '--akdb-option-dot-bg': currentColorTokens.bg, '--akdb-option-dot-fg': currentColorTokens.fg, '--akdb-option-dot-border': currentColorTokens.border } as CSSProperties} />
            </button>
          </div>
          {colorOpen && (
            <div className="akdb-option-color-palette" role="listbox" aria-label="选项颜色">
              {optionColorChoices.map((choice) => {
                const active = currentColor === choice.id;
                const color = optionColorMap[choice.id] || optionColorMap.gray;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    className={`akdb-option-color-choice ${active ? 'is-active' : ''}`}
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setColorOpen(false);
                      void onUpdate?.({ color: choice.id });
                    }}
                  >
                    <span className="akdb-option-color-square" aria-hidden="true" style={{ '--akdb-option-dot-bg': color.bg, '--akdb-option-dot-fg': color.fg, '--akdb-option-dot-border': color.border } as CSSProperties} />
                    <span>{choice.label}</span>
                    {active && <Check size={16} />}
                  </button>
                );
              })}
            </div>
          )}
          {optionColorModeChoices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={`akdb-option-preview-btn ${currentColorMode === choice.id ? 'is-active' : ''}`}
              disabled={colorModeDisabled}
              onClick={() => void onUpdate?.({ color_mode: choice.id })}
            >
              {currentColorMode === choice.id && currentShape !== 'plain' ? (
                <OptionTag option={{ ...option, value: choice.label, color: currentColor, color_mode: choice.id }} config={{ ...config, option_shape: currentShape }} />
              ) : (
                <span>{choice.label}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="akdb-option-edit-divider" />
      <button type="button" className="akdb-option-edit-delete" onClick={() => void onDelete?.()}>
        <Trash2 size={17} />
        <span>删除</span>
      </button>
    </div>
  );
}

function DateTimePicker({ value, column, style, onChange, onUpdateConfig, onClose }: { value: string; column: DatabaseColumn; style: CSSProperties; onChange: (value: string) => void; onUpdateConfig?: (patch: Record<string, any>) => void; onClose: () => void }) {
  const config = column.config || {};
  const mode = dateContentMode(config);
  const currentDateFormat = dateDisplayFormat(config);
  const currentTimeFormat = timeDisplayFormat(config);
  const [settingsFlyout, setSettingsFlyout] = useState<'dateFormat' | 'timeFormat' | 'timezone' | null>(null);
  const dateFormatButtonRef = useRef<HTMLButtonElement | null>(null);
  const timeFormatButtonRef = useRef<HTMLButtonElement | null>(null);
  const timezoneButtonRef = useRef<HTMLButtonElement | null>(null);
  const dateFormatOpen = settingsFlyout === 'dateFormat';
  const timeFormatOpen = settingsFlyout === 'timeFormat';
  const timezoneOpen = settingsFlyout === 'timezone';
  const dateFormatRect = useSubmenuPosition(dateFormatOpen, dateFormatButtonRef, 220, 180);
  const timeFormatRect = useSubmenuPosition(timeFormatOpen, timeFormatButtonRef, 240, 220);
  const timezoneRect = useSubmenuPosition(timezoneOpen, timezoneButtonRef, 220, 360);
  const dateFormatMenuRect = dateFormatRect ? datePickerSubmenuRect(style, dateFormatRect, 220) : null;
  const timeFormatMenuRect = timeFormatRect ? datePickerSubmenuRect(style, timeFormatRect, 240) : null;
  const timezoneMenuRect = timezoneRect ? datePickerSubmenuRect(style, timezoneRect, 220, 360) : null;
  const parsed = parseDateValue(value);
  const baseDate = parsed || new Date();
  const [viewMonth, setViewMonth] = useState(() => new Date(baseDate.getFullYear(), baseDate.getMonth(), 1));
  const [dateDraft, setDateDraft] = useState(() => formatDateInputDate(baseDate));
  const [timeDraft, setTimeDraft] = useState(() => formatDateInputTime(baseDate));
  useEffect(() => {
    const nextDate = parseDateValue(value) || new Date();
    setDateDraft(formatDateInputDate(nextDate));
    setTimeDraft(formatDateInputTime(nextDate));
    setViewMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
  }, [value]);

  const commit = (nextDateDraft = dateDraft, nextTimeDraft = timeDraft, nextMode = mode) => {
    const next = timestampFromDateTimeParts(nextDateDraft, nextTimeDraft, nextMode);
    onChange(next);
  };
  const changeDate = (nextDate: string) => {
    setDateDraft(nextDate);
    if (normalizeDateDraft(nextDate)) commit(nextDate, timeDraft, mode);
  };
  const changeTime = (nextTime: string) => {
    setTimeDraft(nextTime);
    if (normalizeTimeDraft(nextTime)) commit(dateDraft, nextTime, mode);
  };
  const updateDateFormat = (nextDateFormat: DateDisplayFormat) => {
    onUpdateConfig?.(dateFormatPatch(config, nextDateFormat));
    commit(dateDraft, timeDraft, dateContentModeFromFormats(nextDateFormat, currentTimeFormat));
  };
  const updateTimeFormat = (nextTimeFormat: TimeDisplayFormat) => {
    onUpdateConfig?.(timeFormatPatch(config, nextTimeFormat));
    commit(dateDraft, timeDraft, dateContentModeFromFormats(currentDateFormat, nextTimeFormat));
  };
  const days = calendarDaysForMonth(viewMonth);
  const today = new Date();
  const selected = parseDateValue(timestampFromDateTimeParts(dateDraft, timeDraft, mode));
  const showDate = currentDateFormat !== 'none';
  const showTime = currentTimeFormat !== 'none';

  return (
    <div className="akdb-date-picker" role="dialog" aria-label="日期时间" style={style} onPointerDown={(event) => event.stopPropagation()}>
      <div className={`akdb-date-picker-inputs ${showDate && showTime ? '' : 'is-single'}`}>
        {showDate && (
          <input
            className="akdb-date-picker-input"
            value={dateDraft}
            aria-label="日期"
            onChange={(event) => changeDate(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onClose();
            }}
          />
        )}
        {showTime && (
          <input
            className="akdb-date-picker-input"
            value={timeDraft}
            aria-label="时间"
            onChange={(event) => changeTime(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onClose();
            }}
          />
        )}
      </div>
      {showDate && (
        <div className="akdb-date-calendar">
          <div className="akdb-date-calendar-head">
            <strong>{viewMonth.getFullYear()}年{viewMonth.getMonth() + 1}月</strong>
            <button type="button" onClick={() => {
              const now = new Date();
              setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              changeDate(formatDateInputDate(now));
            }}>现在</button>
            <button type="button" aria-label="上个月" onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
            <button type="button" aria-label="下个月" onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
          </div>
          <div className="akdb-date-calendar-grid is-weekdays">
            {['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="akdb-date-calendar-grid">
            {days.map((day) => {
              const active = selected ? isSameDate(day.date, selected) : false;
              const currentMonth = day.date.getMonth() === viewMonth.getMonth();
              return (
                <button
                  key={day.key}
                  type="button"
                  className={[!currentMonth ? 'is-muted' : '', active ? 'is-active' : '', isSameDate(day.date, today) ? 'is-today' : ''].filter(Boolean).join(' ')}
                  onClick={() => changeDate(formatDateInputDate(day.date))}
                >
                  {day.date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="akdb-date-picker-settings">
        <button
          ref={dateFormatButtonRef}
          type="button"
          className={`akdb-date-setting-row ${dateFormatOpen ? 'is-active' : ''}`}
          onClick={() => setSettingsFlyout('dateFormat')}
          aria-haspopup="menu"
          aria-expanded={dateFormatOpen}
        >
          <span>日期格式</span>
          <span>{dateDisplayFormatLabel(currentDateFormat)}</span>
          <ChevronRight size={15} />
        </button>
        {dateFormatOpen && dateFormatMenuRect && createPortal(
          <DateDisplayFormatSubmenu
            value={currentDateFormat}
            style={dateFormatMenuRect}
            onMouseEnter={() => setSettingsFlyout('dateFormat')}
            onMouseLeave={() => undefined}
            className="akdb-date-picker-submenu akdb-timezone-submenu"
            onChange={(dateFormat) => {
              updateDateFormat(dateFormat);
              setSettingsFlyout(null);
            }}
          />,
          document.body,
        )}
        <button
          ref={timeFormatButtonRef}
          type="button"
          className={`akdb-date-setting-row ${timeFormatOpen ? 'is-active' : ''}`}
          onClick={() => setSettingsFlyout('timeFormat')}
          aria-haspopup="menu"
          aria-expanded={timeFormatOpen}
        >
          <span>时间格式</span>
          <span>{timeDisplayFormatLabel(currentTimeFormat)}</span>
          <ChevronRight size={15} />
        </button>
        {timeFormatOpen && timeFormatMenuRect && createPortal(
          <TimeDisplayFormatSubmenu
            value={currentTimeFormat}
            style={timeFormatMenuRect}
            onMouseEnter={() => setSettingsFlyout('timeFormat')}
            onMouseLeave={() => undefined}
            className="akdb-date-picker-submenu"
            onChange={(timeFormat) => {
              updateTimeFormat(timeFormat);
              setSettingsFlyout(null);
            }}
          />,
          document.body,
        )}
        <button
          ref={timezoneButtonRef}
          type="button"
          className={`akdb-date-setting-row ${timezoneOpen ? 'is-active' : ''}`}
          onClick={() => setSettingsFlyout('timezone')}
          aria-haspopup="menu"
          aria-expanded={timezoneOpen}
        >
          <span>时区</span>
          <span>{timezoneLabel(config.timezone)}</span>
          <ChevronRight size={15} />
        </button>
        {timezoneOpen && timezoneMenuRect && createPortal(
          <TimezoneSubmenu
            value={String(config.timezone || 'GMT+8')}
            style={timezoneMenuRect}
            onMouseEnter={() => setSettingsFlyout('timezone')}
            onMouseLeave={() => undefined}
            className="akdb-date-picker-submenu"
            onChange={(timezone) => {
              onUpdateConfig?.({ timezone });
              setSettingsFlyout(null);
            }}
          />,
          document.body,
        )}
      </div>
      <button type="button" className="akdb-date-clear" onClick={() => { onChange(''); onClose(); }}>清除</button>
    </div>
  );
}

function datePickerSubmenuRect(pickerStyle: CSSProperties, submenuStyle: CSSProperties, width: number, maxHeight?: number): CSSProperties {
  const pickerLeft = Number(pickerStyle.left) || 0;
  const pickerWidth = Number(pickerStyle.width || pickerStyle.minWidth) || 280;
  const viewportPadding = 8;
  const gap = 6;
  const rightLeft = pickerLeft + pickerWidth + gap;
  const left = rightLeft + width + viewportPadding <= window.innerWidth
    ? rightLeft
    : Math.max(viewportPadding, pickerLeft - width - gap);
  return { ...submenuStyle, left, width, ...(maxHeight ? { maxHeight } : {}) };
}

function useDropdownPosition(open: boolean, buttonRef: RefObject<HTMLElement>, minWidth = 220, placement: 'below' | 'overlay' = 'below', offsetLeft = 0, matchAnchorWidth = true) {
  const [rect, setRect] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setRect(null);
      return;
    }
    const update = () => {
      const buttonRect = buttonRef.current?.getBoundingClientRect();
      if (!buttonRect) return;
      const viewportPadding = 8;
      const dropdownWidth = matchAnchorWidth ? Math.max(minWidth, buttonRect.width) : minWidth;
      const maxLeft = Math.max(viewportPadding, window.innerWidth - dropdownWidth - viewportPadding);
      const left = Math.min(Math.max(buttonRect.left + offsetLeft, viewportPadding), maxLeft);
      setRect({
        position: 'fixed',
        left,
        top: placement === 'overlay' ? buttonRect.top : buttonRect.bottom + 4,
        minWidth: dropdownWidth,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, buttonRef, minWidth, placement, offsetLeft, matchAnchorWidth]);
  return rect;
}

function useSubmenuPosition(open: boolean, buttonRef: RefObject<HTMLElement>, width = 392, maxHeight = 430) {
  const [rect, setRect] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setRect(null);
      return;
    }
    const update = () => {
      const buttonRect = buttonRef.current?.getBoundingClientRect();
      if (!buttonRect) return;
      const viewportPadding = 8;
      const gap = 6;
      const rightLeft = buttonRect.right + gap;
      const left = rightLeft + width + viewportPadding <= window.innerWidth
        ? rightLeft
        : Math.max(viewportPadding, buttonRect.left - width - gap);
      const maxTop = Math.max(viewportPadding, window.innerHeight - maxHeight - viewportPadding);
      const top = Math.min(Math.max(buttonRect.top - 4, viewportPadding), maxTop);
      setRect({
        position: 'fixed',
        left,
        top,
        width,
        maxHeight,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, buttonRef, width, maxHeight]);
  return rect;
}

function useDropdownOutsideClose(open: boolean, buttonRef: RefObject<HTMLElement>, onClose: () => void, menuSelector = '.akdb-option-menu') {
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && buttonRef.current?.contains(target)) return;
      if (target && (target as Element).closest?.(menuSelector)) return;
      onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, buttonRef, onClose, menuSelector]);
}

function getGroupedOptions(options: any[], config: Record<string, any>): Array<{ key: string; label: string; options: any[] }> {
  const groups = Array.isArray(config.groups) ? config.groups : [];
  if (!groups.length) return [{ key: 'all', label: '', options }];
  const optionByID = new Map(options.map((option) => [option.id, option]));
  const used = new Set<string>();
  const grouped = groups.map((group: any) => {
    const groupOptions = (group.option_ids || []).map((id: string) => optionByID.get(id)).filter(Boolean);
    groupOptions.forEach((option: any) => used.add(option.id));
    return { key: group.id || group.name, label: group.name || '未命名分组', options: groupOptions };
  }).filter((group: any) => group.options.length);
  const rest = options.filter((option) => !used.has(option.id));
  if (rest.length) grouped.push({ key: 'ungrouped', label: '未分组', options: rest });
  return grouped.length ? grouped : [{ key: 'all', label: '', options }];
}

function formatValue(value: string, column?: DatabaseColumn) {
  if (!column) return value;
  if (column.type === 'text' && column.config?.secret && value) return '••••••';
  if (column.type === 'number') {
    if (column.config?.display_as === 'bar' || column.config?.display_as === 'ring') return <NumberVisualValue value={value} column={column} />;
    return formatNumberValue(value, column);
  }
  if (column.type === 'date' || column.type === 'created_time' || column.type === 'last_edited_time') return formatDateValue(value, column);
  if (column.type === 'select' || column.type === 'status') {
    const option = (column.config?.options || []).find((o: any) => o.id === value);
    return option ? <OptionTag option={option} config={column.config || {}} /> : value;
  }
  if (column.type === 'multi_select') {
    try {
      const ids = JSON.parse(value || '[]');
      const options = column.config?.options || [];
      return <span className="akdb-tag-list">{ids.map((id: string) => {
        const option = options.find((o: any) => o.id === id);
        return option ? <OptionTag key={id} option={option} config={column.config || {}} /> : <span key={id}>{id}</span>;
      })}</span>;
    } catch { return value; }
  }
  return value;
}

function displayText(value: unknown, column?: DatabaseColumn) {
  const raw = String(value ?? '');
  if (column?.type === 'date' || column?.type === 'created_time' || column?.type === 'last_edited_time') return formatDateValue(raw, column);
  if (column?.type === 'number') return formatNumberValue(raw, column);
  return raw;
}

function normalizeDatabaseUrl(value: string) {
  const raw = String(value || '').trim();
  if (!raw || /\s/.test(raw)) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (!url.hostname || !url.hostname.includes('.')) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function NumberVisualValue({ value, column }: { value: string; column: DatabaseColumn }) {
  const normalized = normalizeNumberValue(value, column);
  if (normalized === '') return null;
  const number = Number(normalized);
  if (!Number.isFinite(number)) return <span>{value}</span>;
  const divideBy = Math.max(1, Number(column.config?.number_divide_by) || 100);
  const ratio = Math.max(0, Math.min(1, number / divideBy));
  const color = numberVisualColorMap[column.config?.number_color || 'green'] || numberVisualColorMap.green;
  const showValue = column.config?.number_show_value !== false;
  const text = formatNumberValue(value, column);
  if (column.config?.display_as === 'ring') {
    const circumference = 56.55;
    return (
      <span className="akdb-number-visual is-ring">
        {showValue && <span className="akdb-number-visual-text">{text}</span>}
        <svg className="akdb-number-ring" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="akdb-number-ring-track" cx="12" cy="12" r="9" />
          <circle
            className="akdb-number-ring-fill"
            cx="12"
            cy="12"
            r="9"
            style={{ stroke: color, strokeDasharray: `${Math.max(.01, ratio * circumference)} ${circumference}` }}
          />
        </svg>
      </span>
    );
  }
  return (
    <span className="akdb-number-visual is-bar">
      {showValue && <span className="akdb-number-visual-text">{text}</span>}
      <span className="akdb-number-bar-track">
        <span className="akdb-number-bar-fill" style={{ width: `${ratio * 100}%`, backgroundColor: color }} />
      </span>
    </span>
  );
}

function parseDateValue(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return new Date(n * 1000);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function formatDateValue(value: string, column?: DatabaseColumn) {
  const date = parseDateValue(value);
  if (!date) return value || '';
  const systemDate = column?.type === 'created_time' || column?.type === 'last_edited_time';
  const config = column?.config || {};
  const dateFormat = systemDate ? 'chinese' : dateDisplayFormat(config);
  const timeFormat = systemDate ? 'h24_colon_seconds' : timeDisplayFormat(config);
  const parts = [
    formatDatePart(date, dateFormat),
    formatTimePart(date, timeFormat),
  ].filter(Boolean);
  return parts.join(' ');
}

function formatDatePart(date: Date, format: DateDisplayFormat) {
  if (format === 'none') return '';
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  if (format === 'slash') return `${year}/${month}/${day}`;
  if (format === 'dash') return `${year}-${month}-${day}`;
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatTimePart(date: Date, format: TimeDisplayFormat) {
  if (format === 'none') return '';
  const dash = format.endsWith('dash_seconds');
  const separator = dash ? '-' : ':';
  if (format.startsWith('h12')) {
    const hour = date.getHours();
    const prefix = hour >= 12 ? '下午' : '上午';
    const displayHour = hour % 12 || 12;
    return `${prefix} ${String(displayHour).padStart(2, '0')}${separator}${String(date.getMinutes()).padStart(2, '0')}${separator}${String(date.getSeconds()).padStart(2, '0')}`;
  }
  return `${String(date.getHours()).padStart(2, '0')}${separator}${String(date.getMinutes()).padStart(2, '0')}${separator}${String(date.getSeconds()).padStart(2, '0')}`;
}

function timestampFromDateInput(value: string, mode: DateContentMode) {
  if (!value) return '';
  const date = mode === 'time' ? (() => {
    const [hour, minute] = value.split(':').map(Number);
    return new Date(1970, 0, 1, hour || 0, minute || 0);
  })() : mode === 'datetime' ? new Date(value) : (() => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  })();
  const seconds = Math.floor(date.getTime() / 1000);
  return Number.isFinite(seconds) ? String(seconds) : '';
}

function timestampFromDateTimeParts(dateValue: string, timeValue: string, mode: DateContentMode) {
  if (mode === 'time') return timestampFromDateInput(timeValue || '00:00', 'time');
  const date = /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(dateValue.trim()) ? normalizeDateDraft(dateValue) : dateValue;
  if (!date) return '';
  if (mode === 'date') return timestampFromDateInput(date, 'date');
  return timestampFromDateInput(`${date}T${normalizeTimeDraft(timeValue) || '00:00'}`, 'datetime');
}

function normalizeDateDraft(value: string) {
  const match = value.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return '';
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function normalizeTimeDraft(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{1,2})/);
  if (!match) return '';
  const hour = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const minute = Math.max(0, Math.min(59, Number(match[2]) || 0));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatDateInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

function formatDateInputTime(date: Date) {
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
}

function calendarDaysForMonth(monthDate: Date) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - startOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return { key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`, date };
  });
}

function isSameDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dateGroupKey(value: string) {
  const date = parseDateValue(value);
  if (!date) return '未排期';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getNumberInputProps(column: DatabaseColumn) {
  const config = column.config || {};
  const precision = Number(config.precision);
  return { inputMode: precision === 0 ? 'numeric' : 'decimal' } as const;
}

function getNumberBounds(column: DatabaseColumn) {
  const config = column.config || {};
  const configuredMin = toFiniteNumber(config.min);
  const configuredMax = toFiniteNumber(config.max);
  let min = configuredMin;
  let max = configuredMax;
  if (config.sign_mode === 'non_negative') min = min == null ? 0 : Math.max(min, 0);
  if (config.sign_mode === 'positive') min = min == null ? Number.EPSILON : Math.max(min, Number.EPSILON);
  if (config.sign_mode === 'negative') max = max == null ? -Number.EPSILON : Math.min(max, -Number.EPSILON);
  return {
    min: min == null ? undefined : min,
    max: max == null ? undefined : max,
  };
}

function normalizeNumberValue(value: string, column: DatabaseColumn) {
  const sanitized = sanitizeNumberDraft(value);
  if (sanitized === '') return '';
  const parsed = Number(sanitized);
  if (!Number.isFinite(parsed)) return '';
  const bounds = getNumberBounds(column);
  let next = parsed;
  if (bounds.min != null && next < bounds.min) next = bounds.min;
  if (bounds.max != null && next > bounds.max) next = bounds.max;
  const precision = Number(column.config?.precision);
  if (Number.isInteger(precision) && precision >= 0) next = Number(next.toFixed(precision));
  return String(next);
}

function sanitizeNumberDraft(value: string) {
  const raw = String(value ?? '').normalize('NFKC').trim().replace(/[−–—]/g, '-');
  if (!raw) return '';
  let sign = '';
  let body = '';
  let hasDot = false;
  let hasDigit = false;
  for (const char of raw) {
    if ((char === '-' || char === '+') && !hasDigit && body === '') {
      sign = char === '-' ? '-' : '';
      continue;
    }
    if (char >= '0' && char <= '9') {
      body += char;
      hasDigit = true;
      continue;
    }
    if (char === '.' && !hasDot) {
      body += '.';
      hasDot = true;
    }
  }
  if (!hasDigit) return '';
  if (body === '.') return '';
  if (body.startsWith('.')) body = `0${body}`;
  if (body.endsWith('.')) body = body.slice(0, -1);
  return `${sign}${body}`;
}

function formatNumberValue(value: string, column: DatabaseColumn) {
  if (value === '') return '';
  const normalized = normalizeNumberValue(value, column);
  if (normalized === '') return value;
  const precision = Number(column.config?.precision);
  const format = typeof column.config?.format === 'string' ? column.config.format : 'number';
  const unit = typeof column.config?.unit === 'string' ? column.config.unit.trim() : '';
  const number = Number(normalized);
  const text = formatNumberByFormat(number, normalized, format, precision);
  return unit ? `${text} ${unit}` : text;
}

const numberCurrencyCodes: Record<string, string> = {
  usd: 'USD',
  aud: 'AUD',
  cad: 'CAD',
  sgd: 'SGD',
  eur: 'EUR',
  gbp: 'GBP',
  jpy: 'JPY',
  cny: 'CNY',
  hkd: 'HKD',
};

const numberVisualColorMap: Record<string, string> = {
  gray: '#9b9a97',
  brown: '#9f6b53',
  orange: '#d9730d',
  yellow: '#dfab01',
  green: '#529e72',
  blue: '#2383e2',
  purple: '#9b51e0',
  pink: '#e255a1',
  red: '#e03e3e',
};

function formatNumberByFormat(number: number, raw: string, format: string, precision: number) {
  const hasPrecision = Number.isInteger(precision) && precision >= 0;
  if (!Number.isFinite(number)) return raw;
  if (format === 'percent') {
    return `${hasPrecision ? number.toFixed(precision) : raw}%`;
  }
  const currency = numberCurrencyCodes[format];
  if (currency) {
    return formatNumberWithIntl(number, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }, hasPrecision ? precision : undefined);
  }
  if (format === 'number_with_commas') {
    return formatNumberWithIntl(number, { style: 'decimal', useGrouping: true }, hasPrecision ? precision : undefined);
  }
  return hasPrecision ? number.toFixed(precision) : raw;
}

function formatNumberWithIntl(number: number, options: Intl.NumberFormatOptions, precision?: number) {
  const nextOptions = precision == null ? options : { ...options, minimumFractionDigits: precision, maximumFractionDigits: precision };
  return new Intl.NumberFormat(undefined, nextOptions).format(number);
}

function toFiniteNumber(value: unknown) {
  if (value === '' || value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function typeIconOption(id: string, label: string, notionId: string, keywords: string[] = [], fallbackPaths: string[] = []): ColumnIconOption {
  const notionIcon = notionColumnIconOptions.find((item) => item.id === notionId);
  return {
    id,
    label,
    keywords,
    viewBox: notionIcon?.viewBox || '0 0 20 20',
    paths: notionIcon?.paths || fallbackPaths,
  };
}

const typeColumnIconOptions: ColumnIconOption[] = [
  typeIconOption('type_text', '文本', 'notion_description', ['text', 'name', 'title', 'description']),
  { id: 'type_secret', label: '密码', keywords: ['password', 'secret'], text: '***' },
  typeIconOption('type_number', '数字', 'notion_hashtag', ['number', 'hashtag'], ['M6.15 2.5h1.65l-.52 4.05h4.25l.52-4.05h1.65l-.52 4.05h3.07v1.55h-3.27l-.5 3.8h3.02v1.55h-3.22l-.52 4.05h-1.65l.52-4.05H6.38l-.52 4.05H4.2l.52-4.05H1.75V11.9h3.17l.5-3.8H2.5V6.55h3.12zm.42 9.4h4.25l.5-3.8H7.07z']),
  typeIconOption('type_select', '选择', 'notion_arrow_circle_down', ['select']),
  typeIconOption('type_multi_select', '多选', 'notion_checkmark_list', ['multi select', 'list']),
  typeIconOption('type_status', '状态', 'notion_burst', ['status']),
  typeIconOption('type_date', '日期', 'notion_calendar', ['date', 'time']),
  typeIconOption('type_user', '用户', 'notion_people', ['user', 'people']),
  typeIconOption('type_checkbox', '复选框', 'notion_checkmark_square', ['checkbox', 'check']),
  typeIconOption('type_url', '网址', 'notion_chain_link', ['url', 'link']),
  typeIconOption('type_relation', '关联', 'notion_arrow_northeast', ['relation']),
  typeIconOption('type_formula', '公式', 'notion_formula', ['formula']),
  typeIconOption('type_rollup', '汇总', 'notion_search', ['rollup', 'search'], ['M8.8 2.5a6.3 6.3 0 0 1 5 10.14l3.08 3.08a.82.82 0 1 1-1.16 1.16l-3.08-3.08A6.3 6.3 0 1 1 8.8 2.5m0 1.6a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4']),
  { id: 'notion_shuffle', label: '随机', keywords: ['random shuffle'], viewBox: '0 0 16 16', paths: ['M11.982 2.526a.625.625 0 0 0-.884.884l.915.915H10.93a3.83 3.83 0 0 0-3.27 1.837l-.386.635-.388-.637a3.83 3.83 0 0 0-3.268-1.837H2.48a.625.625 0 0 0 0 1.25h1.14c.9 0 1.733.469 2.2 1.237L6.543 8 5.82 9.19a2.58 2.58 0 0 1-2.2 1.237H2.48a.625.625 0 1 0 0 1.25h1.14A3.83 3.83 0 0 0 6.887 9.84l.388-.638.386.636a3.83 3.83 0 0 0 3.268 1.837h1.085l-.916.915a.625.625 0 1 0 .884.884l1.98-1.98a.625.625 0 0 0 0-.884l-1.98-1.98a.625.625 0 0 0-.884.884l.911.91h-1.08a2.58 2.58 0 0 1-2.2-1.236L8.006 8l.723-1.188a2.58 2.58 0 0 1 2.2-1.237h1.08l-.91.911a.625.625 0 1 0 .883.884l1.98-1.98a.625.625 0 0 0 0-.884z'] },
];

const columnIconOptions: ColumnIconOption[] = [...typeColumnIconOptions, ...notionColumnIconOptions];
const columnIconPickerOptions = notionColumnIconOptions;
const columnIconRecentStorageKey = 'akdb.columnIcon.recent';
const maxColumnIconRecent = 24;

function normalizeRecentColumnIcons(icons: string[]) {
  const valid = new Set(columnIconPickerOptions.map((item) => item.id));
  const seen = new Set<string>();
  return icons.filter((icon) => {
    if (!valid.has(icon) || seen.has(icon)) return false;
    seen.add(icon);
    return true;
  }).slice(0, maxColumnIconRecent);
}

function readRecentColumnIcons(seedIcon?: string) {
  const seed = seedIcon ? [seedIcon] : [];
  if (typeof window === 'undefined') return normalizeRecentColumnIcons(seed);
  try {
    const parsed = JSON.parse(window.localStorage.getItem(columnIconRecentStorageKey) || '[]');
    return normalizeRecentColumnIcons([...seed, ...(Array.isArray(parsed) ? parsed : [])]);
  } catch {
    return normalizeRecentColumnIcons(seed);
  }
}

function writeRecentColumnIcons(icons: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(columnIconRecentStorageKey, JSON.stringify(normalizeRecentColumnIcons(icons)));
  } catch {
    // Recent icons are a UI convenience; choosing an icon should still work if storage is blocked.
  }
}

export function ColumnIconPopover({ column, currentIcon: currentIconProp, defaultIcon, ariaLabel = '图标', style, onPick }: { column?: RenderedColumn; currentIcon?: string; defaultIcon?: string; ariaLabel?: string; style: CSSProperties; onPick: (icon: string) => void }) {
  const [iconSearch, setIconSearch] = useState('');
  const iconResults = useMemo(() => {
    const q = iconSearch.trim().toLowerCase();
    if (!q) return columnIconPickerOptions;
    return columnIconPickerOptions.filter((icon) => {
      const haystack = [icon.label, icon.id, ...(icon.keywords || [])].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [iconSearch]);
  const customIcon = currentIconProp ?? column?.column?.icon ?? '';
  const customPickerIcon = columnIconPickerOptions.some((item) => item.id === customIcon) ? customIcon : '';
  const currentIcon = customPickerIcon || defaultIcon || defaultColumnIconID(column?.column);
  const [recentIcons, setRecentIcons] = useState(() => readRecentColumnIcons(customPickerIcon || defaultIcon || 'notion_alien'));
  useEffect(() => {
    setRecentIcons((icons) => normalizeRecentColumnIcons([customPickerIcon || defaultIcon || 'notion_alien', ...icons]));
  }, [customPickerIcon, defaultIcon]);
  const pickIcon = (icon: string) => {
    if (icon) {
      const nextRecent = normalizeRecentColumnIcons([icon, ...recentIcons]);
      setRecentIcons(nextRecent);
      writeRecentColumnIcons(nextRecent);
    }
    onPick(icon);
  };
  const randomIcon = () => {
    const options = notionColumnIconOptions;
    const next = options[Math.floor(Math.random() * options.length)];
    if (next) pickIcon(next.id);
  };
  return (
    <div className="akdb-column-icon-popover" role="dialog" aria-label={ariaLabel} style={style} onPointerDown={(event) => event.stopPropagation()}>
      <div className="akdb-column-icon-tabs">
        <button type="button" className="is-active">图标</button>
        <button type="button" onClick={() => pickIcon('')}>移除</button>
      </div>
      <div className="akdb-column-icon-toolbar">
        <div className="akdb-column-icon-search">
          <Search size={13} />
          <input
            value={iconSearch}
            onChange={(event) => setIconSearch(event.currentTarget.value)}
            placeholder="筛选..."
            aria-label="筛选图标"
            autoFocus
          />
        </div>
        <button type="button" className="akdb-column-icon-random" aria-label="随机" onClick={randomIcon}>
          <ColumnIconGlyph icon="notion_shuffle" />
        </button>
      </div>
      <div className="akdb-column-icon-scroll">
      <div className="akdb-column-icon-section-title">最近</div>
      <div className="akdb-column-icon-recent">
        {recentIcons.map((recentIcon) => {
          const recent = columnIconPickerOptions.find((item) => item.id === recentIcon);
          return (
            <button
              key={recentIcon}
              type="button"
              role="option"
              className={`akdb-column-icon-choice ${currentIcon === recentIcon ? 'is-active' : ''}`}
              onClick={() => pickIcon(recentIcon)}
              title={recent?.label || '最近'}
              aria-label={recent?.label || '最近'}
            >
              <ColumnIconGlyph icon={recentIcon} />
            </button>
          );
        })}
      </div>
      <div className="akdb-column-icon-section-title">图标</div>
      <div className="akdb-column-icon-grid" role="listbox">
        {iconResults.map((item) => (
          <button
            type="button"
            role="option"
            key={item.id}
            className={`akdb-column-icon-choice ${customPickerIcon === item.id ? 'is-active' : ''}`}
            onClick={() => pickIcon(item.id)}
            title={item.label}
            aria-label={item.label}
          >
            <ColumnIconGlyph icon={item.id} />
          </button>
        ))}
      </div>
      </div>
    </div>
  );
}

export function ColumnIconGlyph({ icon }: { icon: string }) {
  const option = columnIconOptions.find((item) => item.id === icon) || columnIconOptions[0];
  if (option.text) return <span className="akdb-column-icon-text">{option.text}</span>;
  const paths = option.paths || columnIconOptions[0].paths || [];
  return (
    <svg aria-hidden="true" viewBox={option.viewBox || '0 0 20 20'} className="akdb-column-icon-svg">
      {paths.map((path, index) => <path key={index} d={path} />)}
    </svg>
  );
}

const sourceColumnTypes: Array<{ type: DatabaseColumnType; label: string; icon: string }> = [
  { type: 'text', label: '文本', icon: 'type_text' },
  { type: 'number', label: '数字', icon: 'type_number' },
  { type: 'select', label: '选择', icon: 'type_select' },
  { type: 'multi_select', label: '多选', icon: 'type_multi_select' },
  { type: 'status', label: '状态', icon: 'type_status' },
  { type: 'date', label: '日期', icon: 'type_date' },
  { type: 'checkbox', label: '复选框', icon: 'type_checkbox' },
  { type: 'url', label: '网址', icon: 'type_url' },
  { type: 'formula', label: '公式', icon: 'type_formula' },
  { type: 'relation', label: '关联关系', icon: 'type_relation' },
];

const columnTypeMenuItems: Array<{ id: string; type: DatabaseColumnType; label: string; icon: string; help?: boolean }> = [
  { id: 'text', type: 'text', label: '文本', icon: 'type_text' },
  { id: 'number', type: 'number', label: '数字', icon: 'type_number' },
  { id: 'select', type: 'select', label: '选择', icon: 'type_select' },
  { id: 'multi_select', type: 'multi_select', label: '多选', icon: 'type_multi_select' },
  { id: 'status', type: 'status', label: '状态', icon: 'type_status' },
  { id: 'date', type: 'date', label: '日期', icon: 'type_date', help: true },
  { id: 'checkbox', type: 'checkbox', label: '复选框', icon: 'type_checkbox' },
  { id: 'url', type: 'url', label: '网址', icon: 'type_url' },
  { id: 'formula', type: 'formula', label: '公式', icon: 'type_formula' },
  { id: 'relation', type: 'relation', label: '关联关系', icon: 'type_relation' },
];

function defaultColumnName(type: DatabaseColumnType) {
  return sourceColumnTypes.find((item) => item.type === type)?.label || '新属性';
}

function defaultSourceColumnConfig(type: DatabaseColumnType) {
  if (type === 'formula') return { formula: '""' };
  if (type === 'date') return { date_format: 'chinese', time_format: 'none', timezone: 'GMT+8', date_content: 'date', include_time: false, hour12: false };
  return undefined;
}

const optionColorMap: Record<string, { bg: string; fg: string; border: string }> = {
  gray: { bg: '#f1f1ef', fg: '#5f5e5b', border: '#d9d9d6' },
  brown: { bg: '#f4eeee', fg: '#6f4e37', border: '#e1d1c7' },
  blue: { bg: '#e7f3ff', fg: '#0f5ca8', border: '#b8d8f4' },
  green: { bg: '#e6f4ea', fg: '#1f7a3a', border: '#b9dfc4' },
  yellow: { bg: '#fff4d6', fg: '#8a5a00', border: '#ead58f' },
  red: { bg: '#ffe8e8', fg: '#b42318', border: '#f0b8b8' },
  purple: { bg: '#f0e7ff', fg: '#6b3fb7', border: '#d3bff4' },
  pink: { bg: '#ffe8f3', fg: '#a8326f', border: '#efbad3' },
  orange: { bg: '#ffeedd', fg: '#a84f00', border: '#efc59e' },
};

const optionColorChoices = [
  { id: 'gray', label: '灰色' },
  { id: 'brown', label: '棕色' },
  { id: 'orange', label: '橙色' },
  { id: 'yellow', label: '黄色' },
  { id: 'green', label: '绿色' },
  { id: 'blue', label: '蓝色' },
  { id: 'purple', label: '紫色' },
  { id: 'pink', label: '粉色' },
  { id: 'red', label: '红色' },
];
const optionShapeChoices = [
  { id: 'plain', label: '无' },
  { id: 'rounded', label: '圆角' },
  { id: 'pill', label: '胶囊' },
];
const optionColorModeChoices = [
  { id: 'background', label: '背景' },
  { id: 'outline', label: '边框' },
];

function createOptionConfig(value: string, options: any[]) {
  const idBase = slugOptionID(value) || 'option';
  const existingIDs = new Set(options.map((option) => String(option.id || '')));
  let id = idBase;
  let index = 2;
  while (existingIDs.has(id)) {
    id = `${idBase}-${index}`;
    index += 1;
  }
  return {
    id,
    value,
    color: 'gray',
    icon: 'none',
    shape: 'plain',
    color_mode: 'background',
  };
}

function slugOptionID(value: string) {
  const normalized = value.trim().normalize('NFKC').toLowerCase();
  const ascii = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii) return ascii;
  let hash = 0;
  for (const char of normalized) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash ? `option-${hash.toString(36)}` : '';
}

export function OptionTag({ option, config, removable, onRemove }: { option: any; config: Record<string, any>; removable?: boolean; onRemove?: () => void }) {
  const color = optionColorMap[option.color || 'gray'] || optionColorMap.gray;
  const outline = (option.color_mode || config.color_mode) === 'outline';
  const shape = option.shape || config.option_shape || 'pill';
  const plain = shape === 'plain';
  return (
    <span
      className="akdb-option-tag"
      style={{
        color: color.fg,
        borderColor: plain ? 'transparent' : color.border,
        backgroundColor: plain || outline ? 'transparent' : color.bg,
        borderRadius: shape === 'pill' ? 999 : 4,
      }}
    >
      <OptionGlyph icon={option.icon || 'none'} color={color.fg} />
      <span>{option.value || option.id}</span>
      {removable && (
        <button
          type="button"
          className="akdb-option-tag-remove"
          aria-label="移除令牌"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onRemove?.();
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M15.692 5.192a.625.625 0 1 0-.884-.884L10 9.116 5.192 4.308a.625.625 0 1 0-.884.884L9.116 10l-4.808 4.808a.625.625 0 1 0 .884.884L10 10.884l4.808 4.808a.625.625 0 1 0 .884-.884L10.884 10z" />
          </svg>
        </button>
      )}
    </span>
  );
}

function StatusGroupEditMenu({ group, style, onRename, onDelete }: { group: any; style: CSSProperties; onRename: (name: string) => void; onDelete: () => void }) {
  const [name, setName] = useState(String(group.name || '未命名分组'));
  useEffect(() => setName(String(group.name || '未命名分组')), [group.id, group.name]);
  const commitName = () => {
    const next = name.trim();
    if (next && next !== group.name) onRename(next);
    if (!next) setName(String(group.name || '未命名分组'));
  };
  return (
    <div className="akdb-status-group-edit-menu" role="dialog" aria-label="编辑状态分组" style={style} onPointerDown={(event) => event.stopPropagation()}>
      <div className="akdb-status-group-name">
        <input
          value={name}
          aria-label="状态分组名称"
          onChange={(event) => setName(event.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
            if (event.key === 'Escape') setName(String(group.name || '未命名分组'));
          }}
          autoFocus
        />
      </div>
      <button type="button" className="akdb-status-group-delete" onClick={onDelete}>
        <Trash2 size={17} />
        <span>删除</span>
      </button>
    </div>
  );
}

function StatusPropertyTag({ option, config }: { option: any; config: Record<string, any> }) {
  const color = optionColorMap[option.color || 'gray'] || optionColorMap.gray;
  const shape = option.shape || config.option_shape || 'pill';
  const plain = shape === 'plain';
  return (
    <span
      className={`akdb-status-property-tag ${plain ? 'is-plain' : ''}`}
      style={{
        color: color.fg,
        backgroundColor: plain ? 'transparent' : color.bg,
        borderRadius: shape === 'pill' ? 999 : 4,
      }}
    >
      <span className="akdb-status-property-dot" style={{ backgroundColor: color.fg }} />
      <span>{option.value || option.id}</span>
    </span>
  );
}

function OptionGlyph({ icon, color }: { icon?: string; color: string }) {
  if (!icon || icon === 'none') return null;
  if (columnIconOptions.some((item) => item.id === icon)) {
    return <span className="akdb-option-column-icon" style={{ color }}><ColumnIconGlyph icon={icon} /></span>;
  }
  if (icon === 'solid_circle') return <span className="akdb-option-icon is-solid-circle" style={{ backgroundColor: color }} />;
  if (icon === 'ring') return <span className="akdb-option-icon is-ring" style={{ borderColor: color }} />;
  if (icon === 'square') return <span className="akdb-option-icon is-square" style={{ backgroundColor: color }} />;
  if (icon === 'triangle') return <span className="akdb-option-icon is-triangle" style={{ backgroundColor: color }} />;
  if (icon === 'hexagon') return <span className="akdb-option-icon is-hexagon" style={{ backgroundColor: color }} />;
  if (icon === 'spinner') return <span className="akdb-option-symbol" style={{ color }}>✺</span>;
  if (icon === 'sun') return <span className="akdb-option-symbol" style={{ color }}>☀</span>;
  if (icon === 'moon') return <span className="akdb-option-symbol" style={{ color }}>☾</span>;
  if (icon === 'man') return <span className="akdb-option-icon is-man" style={{ color }} />;
  if (icon === 'woman') return <span className="akdb-option-icon is-woman" style={{ color }} />;
  if (icon === 'child') return <span className="akdb-option-symbol" style={{ color }}>♙</span>;
  if (icon === 'phone') return <span className="akdb-option-symbol" style={{ color }}>☎</span>;
  if (icon === 'umbrella') return <span className="akdb-option-symbol" style={{ color }}>☂</span>;
  return <span className="akdb-option-icon is-solid-circle" style={{ backgroundColor: color }} />;
}
