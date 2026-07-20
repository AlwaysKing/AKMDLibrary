import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type TdHTMLAttributes } from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowUpDown,
  CalendarDays,
  Check,
  ChevronRight,
  Columns3,
  GripVertical,
  Filter,
  HelpCircle,
  Image,
  Info,
  List,
  Lock,
  MoreHorizontal,
  Plus,
  Repeat2,
  Search,
  SlidersHorizontal,
  Trash2,
  Workflow,
  EyeOff,
} from 'lucide-react';
import { databasesApi, type DatabaseColumn, type DatabaseColumnType, type DatabaseDetail, type DatabaseRow, type DatabaseSummary } from '../../../api/databases';
import { evalFormula } from '../../../formula/evaluator';
import { defaultView, type DatabaseViewConfig, type ViewColumnRule } from './viewConfig';
import { notionColumnIconOptions, type ColumnIconOption } from './columnIcons';
import './database.css';

interface Props {
  spaceSlug: string;
  dbId: string;
  view?: DatabaseViewConfig;
  readonly?: boolean;
  columnControls?: boolean;
  createRequest?: number;
  missingState?: ReactNode;
  onAvailabilityChange?: (available: boolean) => void;
  onOpenRow?: (rowId: string) => void;
  onViewChange?: (view: DatabaseViewConfig) => void;
  onOpenViewSettings?: (pane: 'main' | 'visibility') => void;
}

export default function DatabaseRenderer({ spaceSlug, dbId, view, readonly, columnControls = true, createRequest = 0, missingState, onAvailabilityChange, onOpenRow, onViewChange, onOpenViewSettings }: Props) {
  const [schema, setSchema] = useState<DatabaseDetail | null>(null);
  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [columnMenuIndex, setColumnMenuIndex] = useState<number | null>(null);
  const [columnMenuTypeOpen, setColumnMenuTypeOpen] = useState(false);
  const [pendingDeleteColumn, setPendingDeleteColumn] = useState<DatabaseColumn | null>(null);
  const [deletingColumn, setDeletingColumn] = useState(false);
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
  const resizeColumnRef = useRef<{ id: string; startX: number; startWidth: number } | null>(null);
  const addColumnButtonRef = useRef<HTMLButtonElement | null>(null);
  const columnMenuAnchorRef = useRef<HTMLElement | null>(null);
  const suppressNextHeaderClickRef = useRef(false);
  const activeView = useMemo(() => view || defaultView(schema?.columns || []), [view, schema?.columns]);
  const addColumnMenuRect = useDropdownPosition(addColumnOpen, addColumnButtonRef, 360);
  const columnMenuRect = useDropdownPosition(columnMenuIndex !== null, columnMenuAnchorRef, 220);
  const showColumnControls = !readonly && columnControls;
  const showFillColumn = !readonly;
  useDropdownOutsideClose(addColumnOpen, addColumnButtonRef, () => setAddColumnOpen(false), '.akdb-add-column-menu');
  useDropdownOutsideClose(columnMenuIndex !== null, columnMenuAnchorRef, () => closeColumnMenu(), '.akdb-column-menu, .akdb-column-icon-popover, .akdb-column-type-submenu');

  const refresh = async () => {
    setLoading(true);
    try {
      const [detail, rowRes] = await Promise.all([
        databasesApi.get(spaceSlug, dbId),
        databasesApi.listRows(spaceSlug, dbId, { limit: 0 }),
      ]);
      setSchema(detail);
      setRows(rowRes.rows || []);
      onAvailabilityChange?.(true);
    } catch {
      setSchema(null);
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

  const createRow = async (defaults: Record<string, string> = {}) => {
    if (readonly) return;
    await databasesApi.createRow(spaceSlug, dbId, defaults);
    await refresh();
  };

  useEffect(() => {
    if (createRequest > 0) createRow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequest]);

  const updateCell = async (rowId: string, col: DatabaseColumn | undefined, value: string) => {
    if (readonly || !col || col.readonly || col.type === 'formula') return;
    await databasesApi.updateRow(spaceSlug, dbId, rowId, { [col.id]: value });
    setRows((prev) => prev.map((r) => r.uuid === rowId ? { ...r, values: { ...r.values, [col.id]: value } } : r));
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
    setSchema(nextSchema);
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
    setSchema(nextSchema);
  };

  const updateColumnOption = async (col: DatabaseColumn, optionID: string, patch: Record<string, any>) => {
    if (readonly || col.readonly || (col.type !== 'select' && col.type !== 'status' && col.type !== 'multi_select')) return;
    const options = Array.isArray(col.config?.options) ? col.config.options : [];
    const nextOptions = options.map((option: any) => option.id === optionID ? { ...option, ...patch } : option);
    const nextConfig = { ...(col.config || {}), options: nextOptions };
    const nextSchema = await databasesApi.updateColumn(spaceSlug, dbId, col.id, { config: nextConfig });
    setSchema(nextSchema);
  };

  const deleteColumnOption = async (col: DatabaseColumn, optionID: string) => {
    if (readonly || col.readonly || (col.type !== 'select' && col.type !== 'status')) return;
    const options = Array.isArray(col.config?.options) ? col.config.options : [];
    const nextOptions = options.filter((option: any) => option.id !== optionID);
    const nextConfig = { ...(col.config || {}), options: nextOptions };
    const nextSchema = await databasesApi.updateColumn(spaceSlug, dbId, col.id, { config: nextConfig });
    const affectedRows = rows.filter((row) => row.values?.[col.id] === optionID);
    await Promise.all(affectedRows.map((row) => databasesApi.updateRow(spaceSlug, dbId, row.uuid, { [col.id]: '' })));
    setSchema(nextSchema);
    if (affectedRows.length) {
      const affectedIDs = new Set(affectedRows.map((row) => row.uuid));
      setRows((prev) => prev.map((row) => affectedIDs.has(row.uuid) ? { ...row, values: { ...row.values, [col.id]: '' } } : row));
    }
  };

  const updateColumnOptionConfig = async (col: DatabaseColumn, patch: Record<string, any>) => {
    if (readonly || col.readonly || (col.type !== 'select' && col.type !== 'status' && col.type !== 'multi_select')) return;
    const nextConfig = { ...(col.config || {}), ...patch };
    const nextSchema = await databasesApi.updateColumn(spaceSlug, dbId, col.id, { config: nextConfig });
    setSchema(nextSchema);
  };

  const closeColumnMenu = () => {
    setColumnMenuIndex(null);
    setColumnMenuTypeOpen(false);
    columnMenuAnchorRef.current = null;
  };

  const openColumnMenu = (index: number, anchor: HTMLElement) => {
    if (readonly) return;
    columnMenuAnchorRef.current = anchor;
    setColumnMenuIndex(index);
    setColumnMenuTypeOpen(false);
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
    const nextConfig = type === 'date' ? { include_time: false, hour12: false, ...(config || {}) } : config;
    const nextSchema = await databasesApi.addColumn(spaceSlug, dbId, { name: title, type, config: nextConfig });
    setSchema(nextSchema);
    const created = [...nextSchema.columns].reverse().find((column) => column.name === title && column.type === type) || nextSchema.columns[nextSchema.columns.length - 1];
    if (created) {
      appendViewColumn({ property: created.id, width: 150 });
    }
    setAddColumnOpen(false);
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
    setSchema(nextSchema);
    closeColumnMenu();
  };

  const changeColumnIcon = async (index: number, icon: string) => {
    const target = visibleColumns[index];
    if (!target?.column || readonly || target.column.readonly) return;
    const nextSchema = await databasesApi.updateColumn(spaceSlug, dbId, target.column.id, { icon });
    setSchema(nextSchema);
  };

  const changeColumnName = async (index: number, name: string) => {
    const target = visibleColumns[index];
    const nextName = name.trim();
    if (!target?.column || readonly || target.column.readonly || !nextName || nextName === target.column.name) return;
    const nextSchema = await databasesApi.updateColumn(spaceSlug, dbId, target.column.id, { name: nextName });
    setSchema(nextSchema);
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
      setSchema(nextSchema);
      onViewChange?.(removeColumnFromView(activeView, pendingDeleteColumn.id));
      setPendingDeleteColumn(null);
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
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp, { once: true });
  };
  const tableMinWidth = visibleColumns.reduce((total, column, index) => total + columnWidth(column, index), showColumnControls ? 64 : 0);
  const columnMenuColumn = columnMenuIndex == null ? undefined : visibleColumns[columnMenuIndex];

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

  return (
    <div className="akdb-frame">
      <div className="akdb-table-wrap">
        <table className="akdb-table" style={{ minWidth: tableMinWidth }}>
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
                  className={[columnDragState?.sourceIndex === index ? 'is-dragging' : '', columnAlignClass(c.rule)].filter(Boolean).join(' ') || undefined}
                  style={{ transform: columnDragTransform(index), transition: columnDragState?.sourceIndex === index ? 'none' : undefined }}
                  onPointerDown={showColumnControls ? (event) => beginColumnDrag(index, event) : undefined}
                  onClick={showColumnControls ? (event) => handleColumnHeaderClick(index, event) : undefined}
                  onContextMenu={showColumnControls ? (event) => handleColumnHeaderContextMenu(index, event) : undefined}
                >
                  <span className="akdb-col-head">
                    <span className="akdb-col-type"><ColumnIconGlyph icon={columnIconID(c.column)} /></span>
                    <span>{c.name}</span>
                  </span>
                  {showColumnControls && <span className="akdb-col-resizer" role="separator" aria-orientation="vertical" onPointerDown={(event) => resizeColumn(event, c, index)} />}
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
            {visibleColumns.length > 0 && displayRows.map(({ row, display }) => (
              <tr key={row.uuid}>
                {visibleColumns.map((c, index) => (
                  <EditableCell
                    key={c.id}
                    value={String(display[c.id] ?? '')}
                    column={c.column}
                    align={c.rule.align}
                    readonly={readonly || c.column?.type === 'formula' || !!c.rule.readonly}
                    onChange={(v) => updateCell(row.uuid, c.column, v)}
                    onCreateOption={(label) => c.column ? createColumnOption(c.column, label) : Promise.resolve(null)}
                    onReorderOption={(sourceID, targetID) => c.column ? reorderColumnOption(c.column, sourceID, targetID) : Promise.resolve()}
                    onUpdateOption={(optionID, patch) => c.column ? updateColumnOption(c.column, optionID, patch) : Promise.resolve()}
                    onDeleteOption={(optionID) => c.column ? deleteColumnOption(c.column, optionID) : Promise.resolve()}
                    onUpdateOptionConfig={(patch) => c.column ? updateColumnOptionConfig(c.column, patch) : Promise.resolve()}
                    onEditProperty={(anchor) => openColumnMenu(index, anchor)}
                    cellProps={{
                      className: columnDragState?.sourceIndex === index ? 'is-dragging' : undefined,
                      style: {
                        transform: columnDragTransform(index),
                        transition: columnDragState?.sourceIndex === index ? 'none' : undefined,
                      },
                    }}
                  />
                ))}
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
        {columnMenuColumn && columnMenuRect && createPortal(
          <ColumnHeaderMenu
            column={columnMenuColumn}
            index={columnMenuIndex!}
            typeOpen={columnMenuTypeOpen}
            style={columnMenuRect}
            onOpenType={() => setColumnMenuTypeOpen(true)}
            onCloseType={() => setColumnMenuTypeOpen(false)}
            onChangeType={(type) => changeColumnType(columnMenuIndex!, type)}
            onChangeIcon={(icon) => changeColumnIcon(columnMenuIndex!, icon)}
            onChangeName={(name) => changeColumnName(columnMenuIndex!, name)}
            onFilter={() => closeColumnMenu()}
            onSort={() => closeColumnMenu()}
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
  if (!filters.length) return items;
  const byID = new Map(columns.map((column) => [column.id, column]));
  return items.filter((item) => filters.every((filter) => {
    const column = byID.get(filter.property);
    const raw = item.props[filter.property] ?? item.row.values[filter.property] ?? '';
    return matchesViewFilter(raw, column, filter.op, filter.value);
  }));
}

function matchesViewFilter(raw: unknown, column: DatabaseColumn | undefined, op: string, value: unknown) {
  const text = String(raw ?? '').trim();
  if (op === 'is_empty') return !text;
  if (op === 'is_not_empty') return !!text;
  if (column?.type === 'checkbox') {
    return String(value) === 'true' ? text === 'true' : text !== 'true';
  }
  if (column?.type === 'select' || column?.type === 'status') {
    const selected = Array.isArray(value) ? value.map(String) : String(value || '').split(',').filter(Boolean);
    if (!selected.length) return true;
    return selected.includes(text);
  }
  if (column?.type === 'multi_select') {
    const selected = Array.isArray(value) ? value.map(String) : String(value || '').split(',').filter(Boolean);
    if (!selected.length) return true;
    const values = parseMultiSelectValue(text);
    return selected.some((id) => values.includes(id));
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
  style,
  onOpenType,
  onCloseType,
  onChangeType,
  onChangeIcon,
  onChangeName,
  onFilter,
  onSort,
  onToggleReadonly,
  onChangeAlign,
  onHide,
  onDelete,
}: {
  column: RenderedColumn;
  index: number;
  typeOpen: boolean;
  style: CSSProperties;
  onOpenType: () => void;
  onCloseType: () => void;
  onChangeType: (type: DatabaseColumnType) => void;
  onChangeIcon: (icon: string) => void;
  onChangeName: (name: string) => void;
  onFilter: () => void;
  onSort: () => void;
  onToggleReadonly: () => void;
  onChangeAlign: (align: ViewColumnRule['align']) => void;
  onHide: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(column.name);
  const [iconOpen, setIconOpen] = useState(false);
  const iconButtonRef = useRef<HTMLButtonElement | null>(null);
  const typeButtonRef = useRef<HTMLButtonElement | null>(null);
  const iconPickerRect = useDropdownPosition(iconOpen, iconButtonRef, 408);
  const typeMenuRect = useSubmenuPosition(typeOpen, typeButtonRef, 220, 340);
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
            onMouseLeave={onCloseType}
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
        <button type="button" className="akdb-column-menu-item" onMouseEnter={onCloseType} onFocus={onCloseType} onClick={onFilter}>
          <Filter size={16} />
          <span>筛选</span>
        </button>
        <button type="button" className="akdb-column-menu-item" onMouseEnter={onCloseType} onFocus={onCloseType} onClick={onSort}>
          <ArrowUpDown size={16} />
          <span>排序</span>
        </button>
        <button type="button" className="akdb-column-menu-item" onMouseEnter={onCloseType} onFocus={onCloseType} onClick={onToggleReadonly}>
          <Lock size={16} />
          <span>{column.rule.readonly ? '取消只读' : '只读'}</span>
        </button>
        <div className="akdb-column-menu-align" onMouseEnter={onCloseType} onFocus={onCloseType}>
          <button type="button" className={`akdb-column-menu-item ${column.rule.align === 'left' || !column.rule.align ? 'is-active' : ''}`} onClick={() => onChangeAlign('left')}>
            <AlignLeft size={16} />
            <span>左对齐</span>
            {(column.rule.align === 'left' || !column.rule.align) && <Check size={16} />}
          </button>
          <button type="button" className={`akdb-column-menu-item ${column.rule.align === 'center' ? 'is-active' : ''}`} onClick={() => onChangeAlign('center')}>
            <AlignCenter size={16} />
            <span>居中</span>
            {column.rule.align === 'center' && <Check size={16} />}
          </button>
          <button type="button" className={`akdb-column-menu-item ${column.rule.align === 'right' ? 'is-active' : ''}`} onClick={() => onChangeAlign('right')}>
            <AlignRight size={16} />
            <span>右对齐</span>
            {column.rule.align === 'right' && <Check size={16} />}
          </button>
        </div>
        <button type="button" className="akdb-column-menu-item" onMouseEnter={onCloseType} onFocus={onCloseType} onClick={onHide}>
          <EyeOff size={16} />
          <span>隐藏</span>
        </button>
      </div>
      <div className="akdb-column-menu-section">
        <button type="button" className="akdb-column-menu-item is-danger" onMouseEnter={onCloseType} onFocus={onCloseType} onClick={onDelete}>
          <Trash2 size={16} />
          <span>删除</span>
        </button>
      </div>
    </div>
  );
}

function EditableCell({ value, column, align, readonly, onChange, onCreateOption, onReorderOption, onUpdateOption, onDeleteOption, onUpdateOptionConfig, onEditProperty, cellProps }: { value: string; column?: DatabaseColumn; align?: ViewColumnRule['align']; readonly?: boolean; onChange: (value: string) => void; onCreateOption?: (label: string) => Promise<any | null>; onReorderOption?: (sourceID: string, targetID: string) => Promise<void>; onUpdateOption?: (optionID: string, patch: Record<string, any>) => Promise<void>; onDeleteOption?: (optionID: string) => Promise<void>; onUpdateOptionConfig?: (patch: Record<string, any>) => Promise<void>; onEditProperty?: (anchor: HTMLElement) => void; cellProps?: TdHTMLAttributes<HTMLTableCellElement> }) {
  const [local, setLocal] = useState(value);
  const [focusRect, setFocusRect] = useState<CSSProperties | null>(null);
  const cellRef = useRef<HTMLTableCellElement | null>(null);
  useEffect(() => setLocal(value), [value]);
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
  useEffect(() => {
    if (!focusRect) return;
    const update = () => updateFocusRect();
    const preventScroll = (event: WheelEvent | TouchEvent) => {
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
  }, [focusRect]);
  const tdProps = (className?: string): TdHTMLAttributes<HTMLTableCellElement> => ({
    ...cellProps,
    className: [cellProps?.className, className, columnAlignClass({ align })].filter(Boolean).join(' ') || undefined,
  });
  const focusOverlay = focusRect ? createPortal(<div className="akdb-cell-focus-overlay" style={focusRect} />, document.body) : null;
  if (!column || readonly || column.readonly) return <td {...tdProps('akdb-readonly')}>{formatValue(value, column)}</td>;
  if (column.type === 'checkbox') return <td {...tdProps('akdb-checkbox-cell')}><input type="checkbox" checked={local === 'true'} onChange={(e) => { const v = String(e.target.checked); setLocal(v); onChange(v); }} /></td>;
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
          onUpdateConfig={onUpdateOptionConfig}
          onEditProperty={onEditProperty ? () => {
            if (cellRef.current) onEditProperty(cellRef.current);
          } : undefined}
          onChange={(next) => {
            setLocal(next);
            onChange(next);
          }}
        />
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
          onUpdateConfig={onUpdateOptionConfig}
          onChange={changeIDs}
        />
      </td>
    );
  }
  if (column.type === 'date') {
    const includeTime = !!column.config?.include_time;
    return (
      <td {...tdProps('akdb-editable-cell')} ref={cellRef}>
        <input
          value={dateInputValue(local, column)}
          type={includeTime ? 'datetime-local' : 'date'}
          onFocus={updateFocusRect}
          onBlur={() => setFocusRect(null)}
          onChange={(e) => {
            const next = timestampFromDateInput(e.currentTarget.value, includeTime);
            setLocal(next);
            onChange(next);
          }}
        />
        {focusOverlay}
      </td>
    );
  }
  const maxLength = column.type === 'text' && Number(column.config?.max_length) > 0 ? Number(column.config?.max_length) : undefined;
  const inputType = column.type === 'text' && column.config?.secret ? 'password' : 'text';
  const numberInputProps = column.type === 'number' ? getNumberInputProps(column) : {};
  const commitValue = () => {
    const next = column.type === 'number' ? normalizeNumberValue(local, column) : local;
    if (next !== local) setLocal(next);
    if (next !== value) onChange(next);
  };
  return <td {...tdProps('akdb-editable-cell')} ref={cellRef}><input value={local} type={inputType} maxLength={maxLength} {...numberInputProps} onFocus={updateFocusRect} onChange={(e) => setLocal(e.target.value)} onBlur={() => { commitValue(); setFocusRect(null); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />{focusOverlay}</td>;
}

function OptionSelect({ value, options, config, isStatus, anchorRef, onChange, onCreate, onReorder, onUpdateOption, onDeleteOption, onUpdateConfig, onEditProperty }: { value: string; options: any[]; config: Record<string, any>; isStatus?: boolean; anchorRef?: RefObject<HTMLElement>; onChange: (value: string) => void; onCreate?: (label: string) => Promise<any | null>; onReorder?: (sourceID: string, targetID: string) => Promise<void>; onUpdateOption?: (optionID: string, patch: Record<string, any>) => Promise<void>; onDeleteOption?: (optionID: string) => Promise<void>; onUpdateConfig?: (patch: Record<string, any>) => Promise<void>; onEditProperty?: () => void }) {
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
  const [editingOptionID, setEditingOptionID] = useState<string | null>(null);
  const menuRect = useDropdownPosition(open, anchorRef || buttonRef, 300, 'overlay');
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
                if (event.key === 'Escape') setOpen(false);
                if (event.key === 'Backspace' && !query && selected) onChange('');
              }}
            />
          </div>
          {!isStatus && <div className="akdb-option-menu-title">选择或创建一个选项</div>}
          <div ref={listRef} className="akdb-option-list" role="listbox">
            {!flatOptions.length && <div className="akdb-option-menu-empty">没有匹配的选项</div>}
            {groupedOptions.map((group) => (
              <div key={group.key} className="akdb-option-menu-section">
                {group.label && <div className="akdb-option-menu-group">{group.label}</div>}
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
              <OptionTag option={{ value: query.trim(), color: nextOptionColor(options) }} config={config} />
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
              onUpdateConfig={onUpdateConfig}
              onDelete={async () => {
                await onDeleteOption?.(editingOption.id);
                setEditingOptionID(null);
              }}
            />,
            document.body,
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function OptionMultiSelect({ ids, options, config, anchorRef, onChange, onCreate, onReorder, onUpdateOption, onDeleteOption, onUpdateConfig }: { ids: string[]; options: any[]; config: Record<string, any>; anchorRef?: RefObject<HTMLElement>; onChange: (ids: string[]) => void; onCreate?: (label: string) => Promise<any | null>; onReorder?: (sourceID: string, targetID: string) => Promise<void>; onUpdateOption?: (optionID: string, patch: Record<string, any>) => Promise<void>; onDeleteOption?: (optionID: string) => Promise<void>; onUpdateConfig?: (patch: Record<string, any>) => Promise<void> }) {
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
                if (event.key === 'Escape') setOpen(false);
                if (event.key === 'Backspace' && !query && ids.length) onChange(ids.slice(0, -1));
              }}
            />
          </div>
          <div className="akdb-option-menu-title">选择或创建多个选项</div>
          <div ref={listRef} className="akdb-option-list" role="listbox" aria-multiselectable="true">
            {groupedOptions.map((group) => (
              <div key={group.key} className="akdb-option-menu-section">
                {group.label && <div className="akdb-option-menu-group">{group.label}</div>}
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
              <OptionTag option={{ value: query.trim(), color: nextOptionColor(options) }} config={config} />
            </button>
          )}
          {editingOption && editMenuRect && createPortal(
            <OptionEditMenu
              option={editingOption}
              config={config}
              style={editMenuRect}
              onUpdate={(patch) => onUpdateOption?.(editingOption.id, patch)}
              onUpdateConfig={onUpdateConfig}
              onDelete={async () => {
                await onDeleteOption?.(editingOption.id);
                setEditingOptionID(null);
              }}
            />,
            document.body,
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function OptionEditMenu({ option, config, style, onUpdate, onUpdateConfig, onDelete }: { option: any; config: Record<string, any>; style: CSSProperties; onUpdate?: (patch: Record<string, any>) => void | Promise<void>; onUpdateConfig?: (patch: Record<string, any>) => void | Promise<void>; onDelete?: () => void | Promise<void> }) {
  const [name, setName] = useState(String(option.value || option.id || ''));
  const [colorOpen, setColorOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const iconButtonRef = useRef<HTMLButtonElement | null>(null);
  const iconPickerRect = useDropdownPosition(iconOpen, iconButtonRef, 408);
  useEffect(() => setName(String(option.value || option.id || '')), [option.id, option.value]);
  useEffect(() => setColorOpen(false), [option.id]);
  useEffect(() => setIconOpen(false), [option.id]);
  useDropdownOutsideClose(iconOpen, iconButtonRef, () => setIconOpen(false), '.akdb-column-icon-popover');
  const currentShape = config.option_shape || 'pill';
  const currentColor = option.color || 'gray';
  const currentColorMode = option.color_mode || config.color_mode || 'background';
  const currentColorTokens = optionColorMap[currentColor] || optionColorMap.gray;
  const colorDisabled = currentShape === 'plain';
  useEffect(() => {
    if (colorDisabled) setColorOpen(false);
  }, [colorDisabled]);
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
              <button key={choice.id} type="button" className={`akdb-option-preview-btn ${active ? 'is-active' : ''}`} onClick={() => void onUpdateConfig?.({ option_shape: choice.id })}>
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
              disabled={colorDisabled}
              onClick={() => {
                if (!colorDisabled) setColorOpen((next) => !next);
              }}
            >
              <span className="akdb-option-color-square" aria-hidden="true" style={{ '--akdb-option-dot-bg': currentColorTokens.bg, '--akdb-option-dot-fg': currentColorTokens.fg, '--akdb-option-dot-border': currentColorTokens.border } as CSSProperties} />
            </button>
          </div>
          {colorOpen && !colorDisabled && (
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
              disabled={colorDisabled}
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

function useDropdownPosition(open: boolean, buttonRef: RefObject<HTMLElement>, minWidth = 220, placement: 'below' | 'overlay' = 'below') {
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
      const dropdownWidth = Math.max(minWidth, buttonRect.width);
      const maxLeft = Math.max(viewportPadding, window.innerWidth - dropdownWidth - viewportPadding);
      const left = Math.min(Math.max(buttonRect.left, viewportPadding), maxLeft);
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
  }, [open, buttonRef, minWidth, placement]);
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
  if (column.type === 'number') return formatNumberValue(value, column);
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
  const includeTime = !!column?.config?.include_time || column?.type === 'created_time' || column?.type === 'last_edited_time';
  const includeSeconds = !!column?.config?.include_seconds;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? {
      hour: '2-digit',
      minute: '2-digit',
      ...(includeSeconds ? { second: '2-digit' as const } : {}),
      hour12: !!column?.config?.hour12,
    } : {}),
  }).format(date);
}

function dateInputValue(value: string, column: DatabaseColumn) {
  const date = parseDateValue(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  if (!column.config?.include_time) return `${year}-${month}-${day}`;
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function timestampFromDateInput(value: string, includeTime: boolean) {
  if (!value) return '';
  const date = includeTime ? new Date(value) : (() => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  })();
  const seconds = Math.floor(date.getTime() / 1000);
  return Number.isFinite(seconds) ? String(seconds) : '';
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
  const unit = typeof column.config?.unit === 'string' ? column.config.unit.trim() : '';
  const text = Number.isInteger(precision) && precision >= 0 ? Number(normalized).toFixed(precision) : normalized;
  return unit ? `${text} ${unit}` : text;
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
  if (type === 'date') return { include_time: false, hour12: false };
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

const optionColorOrder = ['gray', 'blue', 'green', 'yellow', 'red', 'purple', 'pink', 'orange'];
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
    color: nextOptionColor(options),
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

function nextOptionColor(options: any[]) {
  return optionColorOrder[options.length % optionColorOrder.length];
}

function OptionTag({ option, config, removable, onRemove }: { option: any; config: Record<string, any>; removable?: boolean; onRemove?: () => void }) {
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
