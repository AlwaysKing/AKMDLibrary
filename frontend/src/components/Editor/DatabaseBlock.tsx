import { forwardRef, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import { createPortal } from 'react-dom';
import { Activity, ArrowLeft, ArrowUpDown, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Columns3, Copy, Database, Eye, Filter, GripVertical, Image, Info, Link, List, ListFilter, Map as MapIcon, MoreHorizontal, Palette, Pencil, PieChart, Plus, Search, SlidersHorizontal, Table2, Trash2, Workflow, X, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { databasesApi, type DatabaseColumn, type DatabaseSummary } from '../../api/databases';
import { useSpaceStore } from '../../stores/spaceStore';
import PageIcon from './PageIcon';
import DatabaseRenderer, { ColumnIconGlyph, ColumnIconPopover, OptionTag, defaultColumnIconID, requestDatabaseImmediateSync } from './database/DatabaseRenderer';
import { defaultView, parseDatabaseMarkdown, serializeDatabaseMarkdown, type DatabaseViewConfig, type DatabaseViewType, type ViewAdvancedFilterGroup, type ViewAdvancedFilterNode, type ViewFilterRule, type ViewSortRule } from './database/viewConfig';
import './database/database.css';

function DatabaseBlockComponent({ block, editor }: any) {
  const { currentSpace } = useSpaceStore();
  const slug = currentSpace?.slug || '';
  const navigate = useNavigate();
  const src = block.props?.src || '';
  const viewId = block.props?.viewId || '';
  const viewsText = block.props?.views || '';
  const title = block.props?.title || '数据库';
  const icon = block.props?.icon || '';
  const [sources, setSources] = useState<DatabaseSummary[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createRowRequest, setCreateRowRequest] = useState(0);
  const [draftTitle, setDraftTitle] = useState(title);
  const [sourceAvailable, setSourceAvailable] = useState(!!src);
  const [schemaColumns, setSchemaColumns] = useState<DatabaseColumn[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [sortQuery, setSortQuery] = useState('');
  const [activeFilterId, setActiveFilterId] = useState<string | null>(null);
  const [activeSortId, setActiveSortId] = useState<string | null>(null);
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(false);
  const [filterBarHidden, setFilterBarHidden] = useState(false);
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [viewSettingsPane, setViewSettingsPane] = useState<'main' | 'visibility' | 'layout' | 'filter'>('main');
  const [pendingBind, setPendingBind] = useState<DatabaseSummary | null>(null);
  const [binding, setBinding] = useState(false);
  const [selectedRowCount, setSelectedRowCount] = useState(0);
  const [iconPickerRequest, setIconPickerRequest] = useState(0);
  const [viewContextMenu, setViewContextMenu] = useState<{ viewId: string; top: number; left: number; pane: 'main' | 'source' } | null>(null);
  const [viewNameFocusRequest, setViewNameFocusRequest] = useState(0);
  const filterRef = useRef<HTMLDivElement | null>(null);
  const sortRef = useRef<HTMLDivElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const sortButtonRef = useRef<HTMLButtonElement | null>(null);
  const viewSettingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const viewContextMenuRef = useRef<HTMLDivElement | null>(null);
  const filterMenuRect = useDropdownPosition(filterOpen, filterButtonRef, 290);
  const sortMenuRect = useDropdownPosition(sortOpen, sortButtonRef, 290);
  const viewSettingsRect = useDropdownPosition(viewSettingsOpen, viewSettingsButtonRef, 292);

  const parsed = useMemo(() => parseDatabaseMarkdown(viewsText), [viewsText]);
  const activeView = parsed.views.find((v) => v.id === viewId) || parsed.views[0];
  const activeSource = activeView?.source || src;
  const viewLocked = !!activeView?.readonly;
  const showDatabaseTitle = activeView?.showSourceTitle !== false;

  useEffect(() => {
    if (!slug || (!pickerOpen && !viewContextMenu && src)) return;
    databasesApi.list(slug).then(setSources).catch(() => setSources([]));
  }, [slug, src, pickerOpen, viewContextMenu]);

  useEffect(() => {
    setDraftTitle(title);
  }, [title]);

  useEffect(() => {
    setSourceAvailable(!!activeSource);
  }, [activeSource]);

  useEffect(() => {
    const handleEditIcon = (event: Event) => {
      const detail = (event as CustomEvent<{ blockId?: string }>).detail;
      if (detail?.blockId !== block.id) return;
      setIconPickerRequest((value) => value + 1);
    };
    document.addEventListener('akdb-edit-database-icon', handleEditIcon);
    return () => document.removeEventListener('akdb-edit-database-icon', handleEditIcon);
  }, [block.id]);

  useEffect(() => {
    const handleToggleLock = (event: Event) => {
      const detail = (event as CustomEvent<{ blockId?: string }>).detail;
      if (detail?.blockId !== block.id || !activeView) return;
      updateView({ ...activeView, readonly: !activeView.readonly });
    };
    document.addEventListener('akdb-toggle-database-lock', handleToggleLock);
    return () => document.removeEventListener('akdb-toggle-database-lock', handleToggleLock);
  }, [activeView, block.id]);

  useEffect(() => {
    if (!slug || !activeSource) {
      setSchemaColumns([]);
      return;
    }
    databasesApi.get(slug, activeSource)
      .then((detail) => setSchemaColumns(detail.columns || []))
      .catch(() => setSchemaColumns([]));
  }, [slug, activeSource]);

  useEffect(() => {
    if (!filterOpen) return;
    const close = (event: globalThis.MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (filterRef.current?.contains(target)) return;
      if (target.closest('.akdb-filter-menu')) return;
      setFilterOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [filterOpen]);

  useEffect(() => {
    if (!sortOpen) return;
    const close = (event: globalThis.MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (sortRef.current?.contains(target)) return;
      if (target.closest('.akdb-filter-menu')) return;
      setSortOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [sortOpen]);

  useDropdownOutsideClose(viewSettingsOpen, viewSettingsButtonRef, () => {
    setViewSettingsOpen(false);
    setViewSettingsPane('main');
  }, '.akdb-view-settings-menu, .akdb-view-rule-editor, .akdb-view-rule-dropdown-menu, .akdb-view-rule-action-menu, .akdb-advanced-filter-editor, .akdb-advanced-filter-add-menu, .akdb-advanced-date-picker-menu, .akdb-date-shortcut-menu, .akdb-filter-menu');

  useEffect(() => {
    if (!viewContextMenu) return;
    const close = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (target && viewContextMenuRef.current?.contains(target)) return;
      setViewContextMenu(null);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setViewContextMenu(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [viewContextMenu]);

  const bind = (db: DatabaseSummary) => {
    setPendingBind(db);
    setPickerOpen(false);
  };

  const finishBind = async (db: DatabaseSummary, insertAllColumns: boolean) => {
    if (!slug || binding) return;
    setBinding(true);
    try {
      const view = insertAllColumns
        ? defaultView((await databasesApi.get(slug, db.id)).columns)
        : defaultView([]);
      editor.updateBlock(block.id, {
        type: 'database',
        props: { src: db.id, viewId: view.id, views: serializeDatabaseMarkdown([view]) },
      } as any);
      requestDatabaseImmediateSync();
      setPickerOpen(false);
      setPendingBind(null);
    } finally {
      setBinding(false);
    }
  };

  const cancelBind = () => {
    if (binding) return;
    setPendingBind(null);
  };

  const updateIcon = (nextIcon: string) => {
    editor.updateBlock(block.id, {
      props: { ...block.props, icon: nextIcon },
    } as any);
    requestDatabaseImmediateSync();
  };

  const create = async () => {
    if (!slug || !newName.trim()) return;
    setCreating(true);
    try {
      const db = await databasesApi.create(slug, { name: newName.trim(), icon: '🗃️' });
      const view = defaultView([]);
      editor.updateBlock(block.id, {
        type: 'database',
        props: { src: db.id, viewId: view.id, views: serializeDatabaseMarkdown([view]) },
      } as any);
      requestDatabaseImmediateSync();
      setPickerOpen(false);
      setNewName('');
    } finally {
      setCreating(false);
    }
  };

  const addView = (type: DatabaseViewType) => {
    const next: DatabaseViewConfig = { ...defaultView([]), type, name: viewName(type), source: activeSource && activeSource !== src ? activeSource : undefined };
    const views = [...parsed.views, next];
    editor.updateBlock(block.id, { props: { ...block.props, viewId: next.id, views: serializeDatabaseMarkdown(views) } } as any);
    requestDatabaseImmediateSync();
  };

  const switchView = (id: string) => {
    editor.updateBlock(block.id, { props: { ...block.props, viewId: id } } as any);
    requestDatabaseImmediateSync();
  };

  const updateView = (nextView: DatabaseViewConfig) => {
    const views = parsed.views.length ? parsed.views : [nextView];
    const nextViews = views.map((view) => view.id === nextView.id ? nextView : view);
    if (!nextViews.some((view) => view.id === nextView.id)) {
      nextViews.push(nextView);
    }
    editor.updateBlock(block.id, {
      props: {
        ...block.props,
        viewId: nextView.id,
        views: serializeDatabaseMarkdown(nextViews),
      },
    } as any);
    requestDatabaseImmediateSync();
  };

  const duplicateView = (targetView: DatabaseViewConfig) => {
    const nextView = {
      ...targetView,
      id: crypto.randomUUID(),
      name: `${targetView.name || viewName(targetView.type)} 副本`,
      columns: targetView.columns.map((column) => ({ ...column })),
      filters: (targetView.filters || []).map((filter) => ({ ...filter, id: crypto.randomUUID() })),
      sorts: (targetView.sorts || []).map((sort) => ({ ...sort, id: crypto.randomUUID() })),
    };
    const sourceIndex = parsed.views.findIndex((view) => view.id === targetView.id);
    const nextViews = [...parsed.views];
    nextViews.splice(sourceIndex >= 0 ? sourceIndex + 1 : nextViews.length, 0, nextView);
    editor.updateBlock(block.id, { props: { ...block.props, viewId: nextView.id, views: serializeDatabaseMarkdown(nextViews) } } as any);
    requestDatabaseImmediateSync();
  };

  const changeViewSource = async (targetView: DatabaseViewConfig, sourceId: string) => {
    if (!slug || !sourceId) return;
    const detail = await databasesApi.get(slug, sourceId);
    const nextColumns = defaultView(detail.columns || []).columns;
    const nextViews = parsed.views.map((view) => view.id === targetView.id ? {
      ...view,
      source: sourceId === src ? undefined : sourceId,
      columns: nextColumns,
      filters: [],
      sorts: [],
      groupBy: undefined,
      cover: undefined,
      date: undefined,
      startDate: undefined,
      endDate: undefined,
    } : view);
    editor.updateBlock(block.id, { props: { ...block.props, viewId: targetView.id, views: serializeDatabaseMarkdown(nextViews) } } as any);
    requestDatabaseImmediateSync();
    setViewContextMenu(null);
  };

  const deleteView = (targetView: DatabaseViewConfig) => {
    if (parsed.views.length <= 1) return;
    const nextViews = parsed.views.filter((view) => view.id !== targetView.id);
    const nextViewId = targetView.id === activeView?.id ? nextViews[0]?.id || '' : viewId;
    editor.updateBlock(block.id, { props: { ...block.props, viewId: nextViewId, views: serializeDatabaseMarkdown(nextViews) } } as any);
    requestDatabaseImmediateSync();
  };

  const openViewSettings = (pane: 'main' | 'visibility' | 'layout' = 'main') => {
    setFilterOpen(false);
    setSortOpen(false);
    setViewContextMenu(null);
    setViewSettingsPane(pane);
    setViewSettingsOpen(true);
  };

  const openViewTabContextMenu = (targetView: DatabaseViewConfig, event: MouseEvent<HTMLButtonElement>) => {
    if (!slug) return;
    event.preventDefault();
    event.stopPropagation();
    setFilterOpen(false);
    setSortOpen(false);
    setViewSettingsOpen(false);
    switchView(targetView.id);
    const width = 224;
    const left = Math.min(Math.max(event.clientX, 8), Math.max(8, window.innerWidth - width - 8));
    const top = Math.min(Math.max(event.clientY, 8), Math.max(8, window.innerHeight - 190));
    setViewContextMenu({ viewId: targetView.id, left, top, pane: 'main' });
  };

  const addFilter = (column: DatabaseColumn) => {
    if (!activeView) return;
    const nextFilter: ViewFilterRule = {
      id: crypto.randomUUID(),
      property: column.id,
      op: defaultFilterOperator(column),
      value: defaultFilterValue(column),
    };
    updateView({ ...activeView, filters: [...(activeView.filters || []), nextFilter] });
    setFilterOpen(false);
    setFilterQuery('');
    setFilterBarHidden(false);
    setActiveFilterId(nextFilter.id);
    setActiveSortId(null);
    return nextFilter.id;
  };

  const updateFilter = (id: string, patch: Partial<ViewFilterRule>) => {
    if (!activeView) return;
    updateView({
      ...activeView,
      filters: (activeView.filters || []).map((filter) => filter.id === id ? { ...filter, ...patch } : filter),
    });
  };

  const removeFilter = (id: string) => {
    if (!activeView) return;
    updateView({ ...activeView, filters: (activeView.filters || []).filter((filter) => filter.id !== id) });
    setActiveFilterId((current) => current === id ? null : current);
  };
  const ensureAdvancedFilter = () => {
    if (!activeView) return;
    const advancedFilter = activeView.advancedFilter || createAdvancedFilterGroup(schemaColumns);
    updateView({ ...activeView, advancedFilter });
    setFilterOpen(false);
    setSortOpen(false);
    setFilterBarHidden(false);
    setActiveFilterId(null);
    setActiveSortId(null);
    setAdvancedFilterOpen(true);
  };
  const updateAdvancedFilter = (advancedFilter?: ViewAdvancedFilterGroup) => {
    if (!activeView) return;
    updateView({ ...activeView, advancedFilter });
    if (!advancedFilter) setAdvancedFilterOpen(false);
  };
  const mergeFilterToAdvanced = (id: string) => {
    if (!activeView) return;
    const filter = (activeView.filters || []).find((rule) => rule.id === id);
    if (!filter) return;
    const advancedFilter = activeView.advancedFilter || createAdvancedFilterGroup(schemaColumns);
    const nextAdvanced = {
      ...advancedFilter,
      children: [...advancedFilter.children, { type: 'rule' as const, rule: { ...filter, id: crypto.randomUUID() } }],
    };
    updateView({
      ...activeView,
      filters: (activeView.filters || []).filter((rule) => rule.id !== id),
      advancedFilter: nextAdvanced,
    });
    setActiveFilterId(null);
    setActiveSortId(null);
    setAdvancedFilterOpen(true);
  };
  const reorderFilters = (sourceID: string, targetID: string) => {
    if (!activeView || sourceID === targetID) return;
    const filters = activeView.filters || [];
    const sourceIndex = filters.findIndex((filter) => filter.id === sourceID);
    const targetIndex = filters.findIndex((filter) => filter.id === targetID);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const nextFilters = [...filters];
    const [moved] = nextFilters.splice(sourceIndex, 1);
    nextFilters.splice(targetIndex, 0, moved);
    updateView({ ...activeView, filters: nextFilters });
  };

  const addSort = (column: DatabaseColumn) => {
    if (!activeView) return;
    const nextSort: ViewSortRule = { id: crypto.randomUUID(), property: column.id, dir: 'asc' };
    updateView({ ...activeView, sorts: [...(activeView.sorts || []), nextSort] });
    setSortOpen(false);
    setSortQuery('');
    setActiveSortId(nextSort.id);
    setActiveFilterId(null);
  };

  const updateSort = (id: string, patch: Partial<ViewSortRule>) => {
    if (!activeView) return;
    updateView({
      ...activeView,
      sorts: (activeView.sorts || []).map((sort) => sort.id === id ? { ...sort, ...patch } : sort),
    });
  };

  const removeSort = (id: string) => {
    if (!activeView) return;
    updateView({ ...activeView, sorts: (activeView.sorts || []).filter((sort) => sort.id !== id) });
    setActiveSortId((current) => current === id ? null : current);
  };

  const toggleSourceColumnVisibility = (column: DatabaseColumn) => {
    if (!activeView) return;
    const matchingRules = activeView.columns.filter((rule) => rule.property === column.id);
    const hasVisible = matchingRules.some((rule) => !rule.hidden);
    if (hasVisible) {
      updateView({
        ...activeView,
        columns: activeView.columns.map((rule) => rule.property === column.id ? { ...rule, hidden: true } : rule),
      });
      return;
    }
    const hasHidden = matchingRules.some((rule) => rule.hidden);
    if (hasHidden) {
      let restored = false;
      updateView({
        ...activeView,
        columns: activeView.columns.map((rule) => {
          if (rule.property !== column.id || !rule.hidden) return rule;
          if (restored) return rule;
          restored = true;
          return { ...rule, hidden: false };
        }),
      });
      return;
    }
    updateView({
      ...activeView,
      columns: [...activeView.columns, { property: column.id, width: 150 }],
    });
  };

  const hideAllSourceColumns = () => {
    if (!activeView) return;
    updateView({
      ...activeView,
      columns: activeView.columns.map((rule) => rule.property ? { ...rule, hidden: true } : rule),
    });
  };

  const reorderSourceColumns = (orderedColumnIDs: string[]) => {
    if (!activeView) return;
    const ruleByProperty = new Map(activeView.columns.filter((rule) => rule.property).map((rule) => [rule.property!, rule]));
    const nextSourceRules = orderedColumnIDs.map((id) => ruleByProperty.get(id) || { property: id, hidden: true, width: 150 });
    const nonSourceRules = activeView.columns.filter((rule) => !rule.property);
    updateView({
      ...activeView,
      columns: [...nextSourceRules, ...nonSourceRules],
    });
  };

  const renameTitle = (value: string) => {
    const nextTitle = value.trim() || '数据库';
    if (nextTitle === title) return;
    editor.updateBlock(block.id, { props: { ...block.props, title: nextTitle } } as any);
    requestDatabaseImmediateSync();
  };
  const sourceControlsDisabled = !activeSource || !sourceAvailable;
  const controlsDisabled = sourceControlsDisabled || viewLocked;
  const filterColumns = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    const columns = schemaColumns.filter((column) => !column.readonly && column.type !== 'linked');
    if (!query) return columns;
    return columns.filter((column) => column.name.toLowerCase().includes(query) || column.type.toLowerCase().includes(query));
  }, [filterQuery, schemaColumns]);
  const sortColumns = useMemo(() => {
    const query = sortQuery.trim().toLowerCase();
    const columns = schemaColumns.filter((column) => column.type !== 'linked');
    if (!query) return columns;
    return columns.filter((column) => column.name.toLowerCase().includes(query) || column.type.toLowerCase().includes(query));
  }, [sortQuery, schemaColumns]);
  const hasEffectiveFilters = useMemo(() => {
    const byID = new Map(schemaColumns.map((column) => [column.id, column]));
    return (activeView?.filters || []).some((filter) => isEffectiveFilter(filter, byID.get(filter.property))) || !!activeView?.advancedFilter;
  }, [activeView?.filters, schemaColumns]);
  const hasFilterRules = (activeView?.filters || []).length > 0 || !!activeView?.advancedFilter;
  const hasViewRules = hasFilterRules || (activeView?.sorts || []).length > 0;
  const showRuleBar = !!activeView && hasViewRules && !sourceControlsDisabled && !filterBarHidden;
  const contextView = viewContextMenu ? parsed.views.find((view) => view.id === viewContextMenu.viewId) : null;
  const sourceName = sources.find((source) => source.id === activeSource)?.name || title;
  const stopEditorTableHandles = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };
  const stopEditorTableHandlesAndEndSelection = (event: MouseEvent<HTMLDivElement>) => {
    document.dispatchEvent(new CustomEvent('akdb-pointer-up'));
    event.stopPropagation();
  };

  const emptyState = (kind: 'unbound' | 'missing') => (
    <DatabaseEmptyState
      kind={kind}
      pickerOpen={pickerOpen}
      sources={sources}
      newName={newName}
      creating={creating}
      onOpenPicker={() => setPickerOpen(true)}
      onNewNameChange={setNewName}
      onCreate={create}
      onBind={bind}
      onClosePicker={() => setPickerOpen(false)}
    />
  );
  useEffect(() => {
    const preventDatabaseChromeContextMenu = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest([
        '.akdb-block-header',
        '.akdb-view-row',
        '.akdb-view-rule-shell',
        '.akdb-filter-menu',
        '.akdb-view-settings-menu',
        '.akdb-view-rule-editor',
        '.akdb-view-rule-dropdown-menu',
        '.akdb-view-rule-action-menu',
        '.akdb-advanced-filter-editor',
        '.akdb-advanced-filter-add-menu',
        '.akdb-advanced-date-picker-menu',
        '.akdb-date-shortcut-menu',
      ].join(','))) return;
      event.preventDefault();
    };
    document.addEventListener('contextmenu', preventDatabaseChromeContextMenu, true);
    return () => document.removeEventListener('contextmenu', preventDatabaseChromeContextMenu, true);
  }, []);
  const actions = (
    <div className="akdb-block-actions">
      <div className="akdb-filter-anchor" ref={filterRef}>
        <button
          ref={filterButtonRef}
          className={`akdb-ghost-icon ${filterOpen ? 'is-active' : ''} ${hasEffectiveFilters ? 'is-effective' : ''}`}
          type="button"
          aria-label="筛选"
          aria-haspopup="dialog"
          aria-expanded={filterOpen}
          disabled={controlsDisabled}
          onClick={() => {
            setSortOpen(false);
            setViewSettingsOpen(false);
            if (hasFilterRules) {
              setFilterOpen(false);
              setFilterBarHidden((hidden) => !hidden);
              setActiveFilterId(null);
              setActiveSortId(null);
              setAdvancedFilterOpen(false);
              return;
            }
            setFilterBarHidden(false);
            setFilterOpen((open) => !open);
            setFilterQuery('');
          }}
        >
          <Filter size={18} />
        </button>
        {filterOpen && filterMenuRect && createPortal(
          <FilterPropertyMenu
            query={filterQuery}
            columns={filterColumns}
            style={filterMenuRect}
            onQueryChange={setFilterQuery}
            onPick={addFilter}
            footer={<button type="button" className="akdb-filter-advanced" onClick={ensureAdvancedFilter}>
              <svg aria-hidden="true" viewBox="0 0 20 20" className="akdb-filter-plus"><path d="M10 3.59a.66.66 0 0 1 .66.66v5.09h5.09a.66.66 0 0 1 0 1.32h-5.09v5.09a.66.66 0 0 1-1.32 0v-5.09H4.25a.66.66 0 0 1 0-1.32h5.09V4.25a.66.66 0 0 1 .66-.66"></path></svg>
              <span>{activeView.advancedFilter ? '编辑筛选条件' : '添加高级筛选'}</span>
            </button>}
          />,
          document.body,
        )}
      </div>
      <div className="akdb-filter-anchor" ref={sortRef}>
        <button
          ref={sortButtonRef}
          className={`akdb-ghost-icon ${sortOpen ? 'is-active' : ''}`}
          type="button"
          aria-label="排序"
          aria-haspopup="dialog"
          aria-expanded={sortOpen}
          disabled={controlsDisabled}
          onClick={() => {
            setFilterOpen(false);
            setViewSettingsOpen(false);
            setSortOpen((open) => !open);
            setSortQuery('');
          }}
        >
          <ArrowUpDown size={18} />
        </button>
        {sortOpen && sortMenuRect && createPortal(
          <FilterPropertyMenu
            label="排序属性"
            placeholder="排序方式..."
            query={sortQuery}
            columns={sortColumns}
            style={sortMenuRect}
            onQueryChange={setSortQuery}
            onPick={addSort}
            footer={null}
          />,
          document.body,
        )}
      </div>
      <button className="akdb-ghost-icon" type="button" aria-label="搜索" disabled={controlsDisabled}><Search size={18} /></button>
      <button
        ref={viewSettingsButtonRef}
        className={`akdb-ghost-icon ${viewSettingsOpen ? 'is-active' : ''}`}
        type="button"
        aria-label="视图设置"
        aria-haspopup="dialog"
        aria-expanded={viewSettingsOpen}
        disabled={controlsDisabled}
        onClick={() => {
          if (viewSettingsOpen && viewSettingsPane === 'main') {
            setViewSettingsOpen(false);
            return;
          }
          openViewSettings('main');
        }}
      >
        <SlidersHorizontal size={18} />
      </button>
      {viewSettingsOpen && viewSettingsRect && activeView && createPortal(
        <ViewSettingsMenu
          schemaName={sourceName}
          columns={schemaColumns}
          activeView={activeView}
          pane={viewSettingsPane}
          focusNameRequest={viewNameFocusRequest}
          onOpenLayout={() => setViewSettingsPane('layout')}
          onOpenVisibility={() => setViewSettingsPane('visibility')}
          onOpenFilter={() => {
            setViewSettingsPane('filter');
            setFilterOpen(false);
            setSortOpen(false);
            setFilterQuery('');
            setActiveFilterId(null);
            setActiveSortId(null);
            setAdvancedFilterOpen(false);
          }}
          onBack={() => setViewSettingsPane('main')}
          onClose={() => {
            setViewSettingsOpen(false);
            setViewSettingsPane('main');
          }}
          onRename={(name) => updateView({ ...activeView, name })}
          onChangeIcon={(icon) => updateView({ ...activeView, icon: icon || undefined })}
          onChangeType={(type) => updateView({ ...activeView, type })}
          onChangeLayout={(patch) => updateView({ ...activeView, ...patch })}
          onToggle={toggleSourceColumnVisibility}
          onHideAll={hideAllSourceColumns}
          onReorder={reorderSourceColumns}
          filterQuery={filterQuery}
          filterColumns={filterColumns}
          onAddFilter={() => {
            setFilterQuery('');
            setActiveFilterId(null);
            setActiveSortId(null);
            setAdvancedFilterOpen(false);
          }}
          onFilterQueryChange={setFilterQuery}
          onPickFilter={addFilter}
          onClearActive={() => {
            setActiveFilterId(null);
            setActiveSortId(null);
            setAdvancedFilterOpen(false);
          }}
          onUpdateFilter={updateFilter}
          onRemoveFilter={removeFilter}
          onMergeFilterToAdvanced={mergeFilterToAdvanced}
          onUpdateAdvancedFilter={updateAdvancedFilter}
          onReorderFilters={reorderFilters}
          style={viewSettingsRect}
        />,
        document.body,
      )}
      <button className="akdb-primary-btn" type="button" disabled={controlsDisabled} onClick={() => setCreateRowRequest((value) => value + 1)}>
        <span>新建</span>
      </button>
      <button className="akdb-primary-chevron" type="button" aria-label="新建选项" disabled={controlsDisabled}><ChevronDown size={18} /></button>
    </div>
  );
  const rowSelectionToolbar = selectedRowCount > 0 ? <RowSelectionToolbar blockId={block.id} count={selectedRowCount} /> : null;
  const showViewTabs = parsed.views.length > 1 || !showDatabaseTitle;
  const showBlockHeader = showDatabaseTitle;

  return (
    <div
      className="akdb-block-shell"
      contentEditable={false}
      onMouseMoveCapture={stopEditorTableHandles}
      onMouseUpCapture={stopEditorTableHandlesAndEndSelection}
    >
      {showBlockHeader && (
        <div className="akdb-block-header">
          {!showViewTabs && rowSelectionToolbar ? rowSelectionToolbar : showDatabaseTitle && (
            <div className="akdb-block-titlebar">
              <div className={`akdb-block-page-icon ${icon ? 'has-icon' : ''}`}>
                <PageIcon
                  icon={icon || null}
                  compact
                  autoOpen={iconPickerRequest}
                  emojiOnly
                  triggerClassName="akdb-database-icon-trigger"
                  onSelect={updateIcon}
                />
              </div>
              <div className={`akdb-block-title ${draftTitle.trim() ? 'has-title' : ''}`}>
                <input
                  value={draftTitle}
                  aria-label="数据库块名称"
                  style={{ width: `${Math.max(draftTitle.length || 0, 3)}em` }}
                  onChange={(event) => setDraftTitle(event.currentTarget.value)}
                  onBlur={(event) => renameTitle(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                />
              </div>
              {parsed.views.length <= 1 && <button className="akdb-ghost-icon" type="button" disabled={controlsDisabled} onClick={() => addView('table')} aria-label="新增表格视图"><Plus size={19} /></button>}
            </div>
          )}
          {!showViewTabs && actions}
        </div>
      )}

      {showViewTabs && (
        <div className={`akdb-view-row ${!showDatabaseTitle && parsed.views.length <= 1 ? 'is-title-replacement' : ''}`}>
          {rowSelectionToolbar || (
            <div className="akdb-view-tabs">
              {parsed.views.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  disabled={!slug}
                  onClick={() => switchView(v.id)}
                  onContextMenu={(event) => openViewTabContextMenu(v, event)}
                  className={v.id === activeView?.id ? 'is-active' : ''}
                >
                  {v.icon && <span className="akdb-view-tab-icon"><ColumnIconGlyph icon={v.icon} /></span>}
                  <span>{v.name}</span>
                </button>
              ))}
              <button type="button" disabled={controlsDisabled} onClick={() => addView('table')}><Plus size={15} /></button>
            </div>
          )}
          {actions}
        </div>
      )}

      {showRuleBar && activeView && (
        <ViewRuleBar
          view={activeView}
          columns={schemaColumns}
          filterQuery={filterQuery}
          filterColumns={filterColumns}
          activeFilterId={activeFilterId}
          activeSortId={activeSortId}
          advancedFilterOpen={advancedFilterOpen}
          onActivateFilter={(id) => {
            setActiveFilterId((current) => current === id ? null : id);
            setActiveSortId(null);
            setAdvancedFilterOpen(false);
          }}
          onActivateSort={(id) => {
            setActiveSortId((current) => current === id ? null : id);
            setActiveFilterId(null);
            setAdvancedFilterOpen(false);
          }}
          onActivateAdvancedFilter={() => {
            if (!activeView.advancedFilter) ensureAdvancedFilter();
            else {
              setAdvancedFilterOpen((open) => !open);
              setActiveFilterId(null);
              setActiveSortId(null);
            }
          }}
          onAddFilter={() => {
            setFilterOpen(false);
            setSortOpen(false);
            setFilterQuery('');
            setAdvancedFilterOpen(false);
          }}
          onFilterQueryChange={setFilterQuery}
          onPickFilter={addFilter}
          onClearActive={() => {
            setActiveFilterId(null);
            setActiveSortId(null);
            setAdvancedFilterOpen(false);
          }}
          onUpdateFilter={updateFilter}
          onRemoveFilter={removeFilter}
          onMergeFilterToAdvanced={mergeFilterToAdvanced}
          onUpdateAdvancedFilter={updateAdvancedFilter}
          onReorderFilters={reorderFilters}
          onUpdateSort={updateSort}
          onRemoveSort={removeSort}
        />
      )}

      {!activeSource && emptyState('unbound')}
      {slug && activeSource && (
        <DatabaseRenderer
          spaceSlug={slug}
          dbId={activeSource}
          blockId={block.id}
          view={activeView}
          readonly={viewLocked}
          onViewChange={updateView}
          createRequest={createRowRequest}
          missingState={emptyState('missing')}
          onAvailabilityChange={setSourceAvailable}
          onSchemaChange={setSchemaColumns}
          onSelectionChange={setSelectedRowCount}
          onOpenViewSettings={openViewSettings}
          onAddFilterColumn={addFilter}
          onAddSortColumn={addSort}
          onOpenRow={(rowId) => navigate(`/s/${slug}/db/${activeSource}/row/${rowId}`)}
        />
      )}
      {pendingBind && createPortal(
        <BindColumnsDialog
          source={pendingBind}
          loading={binding}
          onCancel={cancelBind}
          onBindEmpty={() => finishBind(pendingBind, false)}
          onBindAll={() => finishBind(pendingBind, true)}
        />,
        document.body,
      )}
      {viewContextMenu && contextView && createPortal(
        <ViewTabContextMenu
          ref={viewContextMenuRef}
          sources={sources}
          currentSourceId={contextView.source || src}
          canDelete={parsed.views.length > 1}
          pane={viewContextMenu.pane}
          style={{ top: viewContextMenu.top, left: viewContextMenu.left }}
          onRename={() => {
            setViewContextMenu(null);
            setViewNameFocusRequest((value) => value + 1);
            openViewSettings('main');
          }}
          onEdit={() => openViewSettings('main')}
          onOpenSource={() => setViewContextMenu((current) => current ? { ...current, pane: 'source' } : current)}
          onBack={() => setViewContextMenu((current) => current ? { ...current, pane: 'main' } : current)}
          onPickSource={(sourceId) => void changeViewSource(contextView, sourceId)}
          onDuplicate={() => {
            duplicateView(contextView);
            setViewContextMenu(null);
          }}
          onDelete={() => {
            deleteView(contextView);
            setViewContextMenu(null);
          }}
          onClose={() => setViewContextMenu(null)}
        />,
        document.body,
      )}
    </div>
  );
}

function RowSelectionToolbar({ blockId, count }: { blockId: string; count: number }) {
  return (
    <div className="akdb-row-selection-toolbar" role="toolbar" aria-label="行操作">
      <span className="akdb-row-selection-count">已选择 {count} 个</span>
      <span className="akdb-row-selection-divider" aria-hidden="true" />
      <button
        type="button"
        aria-label="删除选中行"
        onClick={() => {
          document.dispatchEvent(new CustomEvent('akdb-delete-selected-rows', {
            detail: { blockId },
          }));
        }}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

const databaseViewTypeChoices: Array<{ type: DatabaseViewType; label: string; icon: ReactNode }> = [
  { type: 'table', label: '表格', icon: <Table2 size={17} /> },
  { type: 'board', label: '看板', icon: <Columns3 size={17} /> },
  { type: 'timeline', label: '时间轴', icon: <Workflow size={17} /> },
  { type: 'calendar', label: '日历', icon: <CalendarDays size={17} /> },
  { type: 'list', label: '列表', icon: <List size={17} /> },
  { type: 'gallery', label: '画廊', icon: <Image size={17} /> },
  { type: 'chart', label: '图表', icon: <PieChart size={17} /> },
  { type: 'activity', label: '动态', icon: <Activity size={17} /> },
  { type: 'map', label: '地图', icon: <MapIcon size={17} /> },
];

function ViewTypeIcon({ type }: { type: DatabaseViewType }) {
  return databaseViewTypeChoices.find((choice) => choice.type === type)?.icon || <Table2 size={17} />;
}

const ViewTabContextMenu = forwardRef<HTMLDivElement, {
  sources: DatabaseSummary[];
  currentSourceId: string;
  canDelete: boolean;
  pane: 'main' | 'source';
  style: CSSProperties;
  onRename: () => void;
  onEdit: () => void;
  onOpenSource: () => void;
  onBack: () => void;
  onPickSource: (sourceId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}>(({ sources, currentSourceId, canDelete, pane, style, onRename, onEdit, onOpenSource, onBack, onPickSource, onDuplicate, onDelete, onClose }, ref) => {
  const currentSource = sources.find((source) => source.id === currentSourceId);
  return (
    <div
      ref={ref}
      className="akdb-view-tab-context-menu"
      role="dialog"
      aria-label="视图菜单"
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {pane === 'source' ? (
        <>
          <div className="akdb-view-tab-context-section">
            <button type="button" className="akdb-view-tab-context-item" onClick={onBack}>
              <ArrowLeft size={17} />
              <span>来源</span>
            </button>
          </div>
          <div className="akdb-view-tab-context-section akdb-view-tab-source-list">
            {sources.length === 0 ? (
              <div className="akdb-view-tab-context-empty">暂无数据源</div>
            ) : sources.map((source) => (
              <button
                key={source.id}
                type="button"
                className={`akdb-view-tab-context-item ${source.id === currentSourceId ? 'is-active' : ''}`}
                onClick={() => onPickSource(source.id)}
              >
                <Database size={17} />
                <span>{source.name}</span>
                {source.id === currentSourceId && <Check size={16} />}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="akdb-view-tab-context-section">
          <button type="button" className="akdb-view-tab-context-item" onClick={onRename}>
            <Pencil size={17} />
            <span>重命名</span>
          </button>
        <button type="button" className="akdb-view-tab-context-item" onClick={() => {
          onClose();
          onEdit();
        }}>
          <SlidersHorizontal size={17} />
          <span>编辑视图</span>
        </button>
        <button type="button" className="akdb-view-tab-context-item" onClick={onOpenSource}>
          <Database size={17} />
          <span>来源</span>
          <span className="akdb-view-tab-context-detail">{currentSource?.name || '未绑定'}</span>
        </button>
      </div>
      <div className="akdb-view-tab-context-section">
        <button type="button" className="akdb-view-tab-context-item" onClick={() => {
          onClose();
          onDuplicate();
        }}>
          <Copy size={17} />
          <span>创建视图副本</span>
        </button>
        <button type="button" className="akdb-view-tab-context-item" disabled={!canDelete} onClick={() => {
          if (!canDelete) return;
          onClose();
          onDelete();
        }}>
          <Trash2 size={17} />
          <span>删除视图</span>
        </button>
      </div>
        </>
      )}
    </div>
  );
});

function FilterPropertyMenu({
  label = '筛选属性',
  placeholder = '筛选方式...',
  style,
  compact = false,
  query,
  columns,
  onQueryChange,
  onPick,
  footer,
}: {
  label?: string;
  placeholder?: string;
  style?: CSSProperties;
  compact?: boolean;
  query: string;
  columns: DatabaseColumn[];
  onQueryChange: (value: string) => void;
  onPick: (column: DatabaseColumn) => void;
  footer?: ReactNode;
}) {
  return (
    <div className={`akdb-filter-menu ${compact ? 'is-compact' : ''}`} role="dialog" aria-label={label} style={style}>
      <input
        autoFocus
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        placeholder={placeholder}
      />
      <div className="akdb-filter-list">
        {columns.length === 0 ? (
          <div className="akdb-filter-empty">没有匹配的属性</div>
        ) : columns.map((column) => (
          <button key={column.id} type="button" className="akdb-filter-property" onClick={() => onPick(column)}>
            <span className="akdb-filter-type"><ColumnIconGlyph icon={defaultColumnIconID(column)} /></span>
            <span>{column.name}</span>
          </button>
        ))}
      </div>
      {footer === null ? null : footer || <button type="button" className="akdb-filter-advanced">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="akdb-filter-plus"><path d="M10 3.59a.66.66 0 0 1 .66.66v5.09h5.09a.66.66 0 0 1 0 1.32h-5.09v5.09a.66.66 0 0 1-1.32 0v-5.09H4.25a.66.66 0 0 1 0-1.32h5.09V4.25a.66.66 0 0 1 .66-.66"></path></svg>
        <span>添加高级筛选</span>
      </button>}
    </div>
  );
}

function ViewRuleBar({
  view,
  columns,
  filterQuery,
  filterColumns,
  activeFilterId,
  activeSortId,
  advancedFilterOpen,
  onActivateFilter,
  onActivateSort,
  onActivateAdvancedFilter,
  onAddFilter,
  onFilterQueryChange,
  onPickFilter,
  onClearActive,
  onUpdateFilter,
  onRemoveFilter,
  onMergeFilterToAdvanced,
  onUpdateAdvancedFilter,
  onReorderFilters,
  onUpdateSort,
  onRemoveSort,
}: {
  view: DatabaseViewConfig;
  columns: DatabaseColumn[];
  filterQuery: string;
  filterColumns: DatabaseColumn[];
  activeFilterId: string | null;
  activeSortId: string | null;
  advancedFilterOpen: boolean;
  onActivateFilter: (id: string) => void;
  onActivateSort: (id: string) => void;
  onActivateAdvancedFilter: () => void;
  onAddFilter: () => void;
  onFilterQueryChange: (value: string) => void;
  onPickFilter: (column: DatabaseColumn) => void;
  onClearActive: () => void;
  onUpdateFilter: (id: string, patch: Partial<ViewFilterRule>) => void;
  onRemoveFilter: (id: string) => void;
  onMergeFilterToAdvanced: (id: string) => void;
  onUpdateAdvancedFilter: (advancedFilter?: ViewAdvancedFilterGroup) => void;
  onReorderFilters: (sourceID: string, targetID: string) => void;
  onUpdateSort: (id: string, patch: Partial<ViewSortRule>) => void;
  onRemoveSort: (id: string) => void;
}) {
  const byID = new Map(columns.map((column) => [column.id, column]));
  const activeFilter = (view.filters || []).find((filter) => filter.id === activeFilterId);
  const activeSort = (view.sorts || []).find((sort) => sort.id === activeSortId);
  const activeFilterColumn = activeFilter ? byID.get(activeFilter.property) : undefined;
  const ruleBarRef = useRef<HTMLDivElement | null>(null);
  const activeRuleRef = useRef<HTMLButtonElement | null>(null);
  const advancedRuleRef = useRef<HTMLButtonElement | null>(null);
  const addFilterButtonRef = useRef<HTMLButtonElement | null>(null);
  const [filterDragState, setFilterDragState] = useState<{
    sourceID: string;
    targetID: string;
    sourceIndex: number;
    targetIndex: number;
    pointerOffset: number;
    minLeft: number;
    maxLeft: number;
    initialLeft: number;
    currentLeft: number;
    step: number;
    centers: number[];
    dragging: boolean;
  } | null>(null);
  const filterDragStateRef = useRef<typeof filterDragState>(null);
  const suppressRuleClickRef = useRef(false);
  const [addFilterOpen, setAddFilterOpen] = useState(false);
  const editorRect = useDropdownPosition(!!(activeFilter || activeSort), activeRuleRef, activeFilter ? (isDateFilterColumn(activeFilterColumn) ? 260 : 282) : 200, activeFilterId || activeSortId || '');
  const advancedRect = useDropdownPosition(advancedFilterOpen && !!view.advancedFilter, advancedRuleRef, 0, 'advanced-filter');
  const addFilterMenuRect = useDropdownPosition(addFilterOpen, addFilterButtonRef, 220);
  const beginFilterDrag = (filterID: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || (view.filters || []).length < 2) return;
    const bar = ruleBarRef.current;
    const pill = event.currentTarget;
    if (!bar) return;
    const rows = Array.from(bar.querySelectorAll<HTMLElement>('[data-filter-rule-id]'));
    const sourceIndex = rows.findIndex((row) => row.dataset.filterRuleId === filterID);
    if (sourceIndex < 0) return;
    const barRect = bar.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const rowRects = rows.map((row) => row.getBoundingClientRect());
    const gap = rowRects.length > 1 ? Math.max(0, rowRects[1].left - rowRects[0].right) : 0;
    const pillLeft = pillRect.left - barRect.left + bar.scrollLeft;
    const pillWidth = pillRect.width;
    const baseState = {
      sourceID: filterID,
      targetID: filterID,
      sourceIndex,
      targetIndex: sourceIndex,
      pointerOffset: event.clientX - pillRect.left,
      minLeft: Math.max(0, rowRects[0].left - barRect.left + bar.scrollLeft),
      maxLeft: Math.max(0, rowRects[rowRects.length - 1].right - barRect.left + bar.scrollLeft - pillWidth),
      initialLeft: pillLeft,
      currentLeft: pillLeft,
      step: pillWidth + gap,
      centers: rowRects.map((rect) => rect.left - barRect.left + bar.scrollLeft + rect.width / 2),
      dragging: false,
    };
    filterDragStateRef.current = baseState;
    const updateTarget = (clientX: number) => {
      setFilterDragState((current) => {
        const state = current || filterDragStateRef.current;
        if (!state) return current;
        const currentLeft = Math.min(state.maxLeft, Math.max(state.minLeft, clientX - barRect.left + bar.scrollLeft - state.pointerOffset));
        const moved = Math.abs(currentLeft - state.initialLeft);
        const movingRight = currentLeft >= state.initialLeft;
        const leadingEdge = movingRight ? currentLeft + pillWidth : currentLeft;
        const targetIndex = movingRight
          ? state.centers.reduce((target, center, index) => leadingEdge >= center ? index : target, 0)
          : state.centers.findIndex((center) => leadingEdge <= center);
        const nextTargetIndex = targetIndex === -1 ? state.centers.length - 1 : targetIndex;
        const targetID = rows[nextTargetIndex]?.dataset.filterRuleId || state.targetID;
        const next = {
          ...state,
          currentLeft,
          targetIndex: nextTargetIndex,
          targetID,
          dragging: state.dragging || moved > 4,
        };
        filterDragStateRef.current = next;
        return next.dragging ? next : current;
      });
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateTarget(moveEvent.clientX);
      if (filterDragStateRef.current?.dragging) moveEvent.preventDefault();
    };
    const handlePointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      const finalState = filterDragStateRef.current;
      filterDragStateRef.current = null;
      setFilterDragState(null);
      if (finalState?.dragging) {
        suppressRuleClickRef.current = true;
        window.setTimeout(() => { suppressRuleClickRef.current = false; }, 0);
        onClearActive();
        if (finalState.sourceID !== finalState.targetID) onReorderFilters(finalState.sourceID, finalState.targetID);
      }
      try {
        pill.releasePointerCapture(upEvent.pointerId);
      } catch {
        // Pointer capture may already be released if the drag ends outside the pill.
      }
    };
    pill.setPointerCapture(event.pointerId);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };
  useEffect(() => {
    if (!addFilterOpen) return;
    const close = (event: globalThis.MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (addFilterButtonRef.current?.contains(target)) return;
      if (target.closest('.akdb-filter-menu')) return;
      setAddFilterOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [addFilterOpen]);
  useEffect(() => {
    if (!activeFilter && !activeSort && !advancedFilterOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest('.akdb-view-rule-editor')) return;
      if (target.closest('.akdb-advanced-filter-editor')) return;
      if (target.closest('.akdb-advanced-filter-add-menu')) return;
      if (target.closest('.akdb-view-rule-dropdown-menu')) return;
      if (target.closest('.akdb-advanced-date-picker-menu')) return;
      if (target.closest('.akdb-date-shortcut-menu')) return;
      if (target.closest('.akdb-view-rule-pill')) return;
      onClearActive();
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [activeFilter, activeSort, advancedFilterOpen, onClearActive]);
  return (
    <div className="akdb-view-rule-shell">
      <div ref={ruleBarRef} className={`akdb-view-rule-bar ${filterDragState ? 'is-filter-dragging' : ''}`}>
        {view.advancedFilter && (
          <button
            ref={advancedRuleRef}
            type="button"
            className={`akdb-view-rule-pill is-effective ${advancedFilterOpen ? 'is-active' : ''}`}
            onClick={onActivateAdvancedFilter}
          >
            <ListFilter size={14} />
            <span>{countAdvancedFilterRules(view.advancedFilter)} 条规则</span>
            <ChevronDown size={14} />
          </button>
        )}
        {(view.filters || []).map((filter) => {
          const column = byID.get(filter.property);
          const valueLabel = filterValueLabel(filter, column);
          const effective = isEffectiveFilter(filter, column);
          const active = activeFilterId === filter.id;
          const index = (view.filters || []).findIndex((item) => item.id === filter.id);
          const isDragging = filterDragState?.sourceID === filter.id;
          let translateX = 0;
          if (filterDragState && index >= 0) {
            if (isDragging) translateX = filterDragState.currentLeft - filterDragState.initialLeft;
            else if (filterDragState.sourceIndex < filterDragState.targetIndex && index > filterDragState.sourceIndex && index <= filterDragState.targetIndex) translateX = -filterDragState.step;
            else if (filterDragState.targetIndex < filterDragState.sourceIndex && index >= filterDragState.targetIndex && index < filterDragState.sourceIndex) translateX = filterDragState.step;
          }
          return (
            <button
              key={filter.id}
              ref={active ? activeRuleRef : undefined}
              type="button"
              data-filter-rule-id={filter.id}
              className={`akdb-view-rule-pill ${effective ? 'is-effective' : ''} ${active ? 'is-active' : ''} ${isDragging ? 'is-dragging' : ''}`}
              style={{ transform: translateX ? `translateX(${translateX}px)` : undefined }}
              onPointerDown={(event) => beginFilterDrag(filter.id, event)}
              onClick={() => {
                if (suppressRuleClickRef.current) return;
                onActivateFilter(filter.id);
              }}
            >
              <span className="akdb-view-rule-icon"><ColumnIconGlyph icon={defaultColumnIconID(column)} /></span>
              <span>
                {effective ? (
                  <>
                    <span className="akdb-view-rule-field">{column?.name || '属性'}</span>: <span>{valueLabel}</span>
                  </>
                ) : (
                  column?.name || '属性'
                )}
              </span>
              <ChevronDown size={14} />
            </button>
          );
        })}
        {(view.sorts || []).map((sort) => {
          const column = byID.get(sort.property);
          const active = activeSortId === sort.id;
          return (
            <button key={sort.id} ref={active ? activeRuleRef : undefined} type="button" className={`akdb-view-rule-pill ${active ? 'is-active' : ''}`} onClick={() => onActivateSort(sort.id)}>
              <ArrowUpDown size={14} />
              <span>{column?.name || '属性'}</span>
              <span>{sort.dir === 'asc' ? '升序' : '降序'}</span>
              <ChevronDown size={14} />
            </button>
          );
        })}
        <div className="akdb-filter-anchor">
          <button
            ref={addFilterButtonRef}
            type="button"
            className="akdb-view-rule-add"
            aria-haspopup="dialog"
            aria-expanded={addFilterOpen}
            onClick={() => {
              onAddFilter();
              onClearActive();
              setAddFilterOpen((open) => !open);
            }}
          >
            <svg aria-hidden="true" viewBox="2.74 0 10.52 16" className="akdb-plus-small"><path d="M8 2.74a.66.66 0 0 1 .66.66v3.94h3.94a.66.66 0 0 1 0 1.32H8.66v3.94a.66.66 0 0 1-1.32 0V8.66H3.4a.66.66 0 0 1 0-1.32h3.94V3.4A.66.66 0 0 1 8 2.74"></path></svg>
            筛选
          </button>
          {addFilterOpen && addFilterMenuRect && createPortal(
            <FilterPropertyMenu
              query={filterQuery}
              columns={filterColumns}
              style={addFilterMenuRect}
              compact
              onQueryChange={onFilterQueryChange}
              onPick={(column) => {
                onPickFilter(column);
                setAddFilterOpen(false);
              }}
              footer={<button
                type="button"
                className="akdb-filter-advanced"
                onClick={() => {
                  setAddFilterOpen(false);
                  onActivateAdvancedFilter();
                }}
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" className="akdb-filter-plus"><path d="M10 3.59a.66.66 0 0 1 .66.66v5.09h5.09a.66.66 0 0 1 0 1.32h-5.09v5.09a.66.66 0 0 1-1.32 0v-5.09H4.25a.66.66 0 0 1 0-1.32h5.09V4.25a.66.66 0 0 1 .66-.66"></path></svg>
                <span>{view.advancedFilter ? '编辑筛选条件' : '添加高级筛选'}</span>
              </button>}
            />,
            document.body,
          )}
        </div>
      </div>
      {activeFilter && editorRect && createPortal(
        <FilterRuleEditor
          filter={activeFilter}
          column={byID.get(activeFilter.property)}
          style={editorRect}
          onUpdate={(patch) => onUpdateFilter(activeFilter.id, patch)}
          onCommit={onClearActive}
          onRemove={() => onRemoveFilter(activeFilter.id)}
          onMergeToAdvanced={() => onMergeFilterToAdvanced(activeFilter.id)}
        />,
        document.body,
      )}
      {view.advancedFilter && advancedFilterOpen && advancedRect && createPortal(
        <AdvancedFilterEditor
          group={view.advancedFilter}
          columns={columns}
          style={advancedRect}
          onChange={onUpdateAdvancedFilter}
          onRemove={() => onUpdateAdvancedFilter(undefined)}
        />,
        document.body,
      )}
      {activeSort && editorRect && createPortal(
        <SortRuleEditor
          sort={activeSort}
          column={byID.get(activeSort.property)}
          style={editorRect}
          onUpdate={(patch) => onUpdateSort(activeSort.id, patch)}
          onRemove={() => onRemoveSort(activeSort.id)}
        />,
        document.body,
      )}
    </div>
  );
}

function FilterRuleEditor({ filter, column, style, onUpdate, onCommit, onRemove, onMergeToAdvanced }: { filter: ViewFilterRule; column?: DatabaseColumn; style?: CSSProperties; onUpdate: (patch: Partial<ViewFilterRule>) => void; onCommit: () => void; onRemove: () => void; onMergeToAdvanced?: () => void }) {
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const options = (column?.config?.options || []) as Array<{ id: string; value: string; color?: string }>;
  const selected = Array.isArray(filter.value) ? filter.value.map(String) : String(filter.value || '').split(',').filter(Boolean);
  const selectedSet = new Set(selected);
  const selectedOptions = selected.map((id) => options.find((option) => option.id === id)).filter(Boolean);
  const filteredOptions = query.trim()
    ? options.filter((option) => String(option.value || option.id || '').toLowerCase().includes(query.trim().toLowerCase()))
    : options;
  const optionGroups = groupedFilterOptions(column, filteredOptions);
  const operators = filterOperatorsForColumn(column);
  const valueDisabled = filter.op === 'is_empty' || filter.op === 'is_not_empty';
  const isOptionColumn = column?.type === 'select' || column?.type === 'status' || column?.type === 'multi_select';
  useEffect(() => {
    if (!isOptionColumn || valueDisabled) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [isOptionColumn, valueDisabled]);
  const toggleOption = (optionID: string) => {
    const next = selectedSet.has(optionID)
      ? selected.filter((id) => id !== optionID)
      : [...selected, optionID];
    onUpdate({ value: next });
  };
  const toggleGroup = (groupOptions: Array<{ id: string; value: string; color?: string }>) => {
    const groupIDs = groupOptions.map((option) => option.id);
    if (!groupIDs.length) return;
    const allSelected = groupIDs.every((id) => selectedSet.has(id));
    const groupIDSet = new Set(groupIDs);
    const next = allSelected
      ? selected.filter((id) => !groupIDSet.has(id))
      : Array.from(new Set([...selected, ...groupIDs]));
    onUpdate({ value: next });
  };
  const clearSelected = () => {
    onUpdate({ value: [] });
    setQuery('');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };
  return (
    <div className={`akdb-view-rule-editor ${isDateFilterColumn(column) ? 'is-date' : ''}`} role="dialog" aria-label="筛选条件" style={style}>
      <div className="akdb-view-rule-editor-head">
        <button type="button">{column?.name || '属性'}</button>
        <div className="akdb-view-rule-dropdown">
          <button type="button" aria-haspopup="menu" aria-expanded={operatorOpen} onClick={() => setOperatorOpen((open) => !open)}>{filterOperatorLabel(filter, column)} <ChevronDown size={14} /></button>
          {operatorOpen && (
            <div className="akdb-view-rule-dropdown-menu" role="menu">
              {operators.map((operator) => (
                <button
                  key={operator.op}
                  type="button"
                  role="menuitem"
                  className={filter.op === operator.op ? 'is-active' : ''}
                  onClick={() => {
                    onUpdate(nextFilterOperatorPatch(operator.op, column, filter.value));
                    setOperatorOpen(false);
                  }}
                >
                  {operator.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="akdb-view-rule-more-wrap">
          <button type="button" className="akdb-view-rule-more" aria-label="筛选操作" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><MoreHorizontal size={16} /></button>
          {moreOpen && (
            <div className="akdb-view-rule-action-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  onRemove();
                }}
              >
                <Trash2 size={18} />
                <span>删除筛选</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!onMergeToAdvanced}
                onClick={() => {
                  setMoreOpen(false);
                  onMergeToAdvanced?.();
                }}
              >
                <ListFilter size={18} />
                <span>合并到高级筛选中</span>
              </button>
            </div>
          )}
        </div>
      </div>
      {isOptionColumn ? (
        <div className="akdb-view-rule-options">
          <div className={`akdb-filter-value-combobox ${valueDisabled ? 'is-disabled' : ''} ${selectedOptions.length ? 'has-value' : ''}`} onClick={() => inputRef.current?.focus()}>
            {!valueDisabled && selectedOptions.map((option: any) => (
              <OptionTag
                key={option.id}
                option={option}
                config={column?.config || {}}
                removable
                onRemove={() => onUpdate({ value: selected.filter((id) => id !== option.id) })}
              />
            ))}
            <input
              ref={inputRef}
              value={query}
              disabled={valueDisabled}
              placeholder={valueDisabled ? '无需选择选项' : selectedOptions.length ? '' : '选择一个或多个选项...'}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  onCommit();
                }
                if (event.key === 'Backspace' && !query && selected.length) {
                  onUpdate({ value: selected.slice(0, -1) });
                }
                if (event.key === 'Enter' && filteredOptions[0]) {
                  event.preventDefault();
                  toggleOption(filteredOptions[0].id);
                }
              }}
            />
            {!valueDisabled && (selected.length > 0 || query) && (
              <button type="button" className="akdb-filter-value-clear" aria-label="清除筛选值" onClick={clearSelected}>
                <X size={14} />
              </button>
            )}
          </div>
          {!valueDisabled && filteredOptions.length === 0 && <div className="akdb-filter-empty">暂无选项</div>}
          {!valueDisabled && optionGroups.map((group) => (
            <div key={group.key} className={`akdb-view-rule-option-group ${group.label ? 'has-title' : ''}`}>
              {group.label && (() => {
                const selectedCount = group.options.filter((option) => selectedSet.has(option.id)).length;
                const allSelected = selectedCount > 0 && selectedCount === group.options.length;
                const partialSelected = selectedCount > 0 && !allSelected;
                return (
                  <button
                    type="button"
                    className={`akdb-view-rule-option-group-title ${allSelected ? 'is-active' : ''} ${partialSelected ? 'is-partial' : ''}`}
                    onClick={() => toggleGroup(group.options)}
                  >
                    <span className="akdb-view-rule-check">
                      {allSelected ? <Check size={13} strokeWidth={2.4} /> : partialSelected ? <span className="akdb-view-rule-check-mixed" /> : null}
                    </span>
                    <span>{group.label}</span>
                  </button>
                );
              })()}
              {group.options.map((option) => {
                const checked = selectedSet.has(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`akdb-view-rule-option ${checked ? 'is-active' : ''}`}
                    onClick={() => toggleOption(option.id)}
                  >
                    <span className="akdb-view-rule-check">{checked ? <Check size={13} strokeWidth={2.4} /> : null}</span>
                    <OptionTag option={option} config={column?.config || {}} />
                  </button>
                );
              })}
            </div>
          ))}
          {!valueDisabled && selected.length > 0 && <button type="button" className="akdb-view-rule-clear" onClick={clearSelected}>清除选择</button>}
        </div>
      ) : isDateFilterColumn(column) ? (
        <DateFilterEditor filter={filter} onUpdate={onUpdate} />
      ) : column?.type === 'checkbox' ? (
        <div className="akdb-view-rule-options">
          <button type="button" className={`akdb-view-rule-option ${filter.value === true ? 'is-active' : ''}`} onClick={() => onUpdate({ value: true })}><span className="akdb-view-rule-check">{filter.value === true ? '✓' : ''}</span><span>已勾选</span></button>
          <button type="button" className={`akdb-view-rule-option ${filter.value === false ? 'is-active' : ''}`} onClick={() => onUpdate({ value: false })}><span className="akdb-view-rule-check">{filter.value === false ? '✓' : ''}</span><span>未勾选</span></button>
        </div>
      ) : (
        <input
          autoFocus
          className="akdb-view-rule-input"
          value={String(filter.value || '')}
          onChange={(event) => onUpdate({ value: event.currentTarget.value })}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            onCommit();
          }}
          placeholder="输入一个值..."
        />
      )}
    </div>
  );
}

function AdvancedFilterEditor({ group, columns, style, onChange, onRemove }: { group: ViewAdvancedFilterGroup; columns: DatabaseColumn[]; style?: CSSProperties; onChange: (group: ViewAdvancedFilterGroup) => void; onRemove: () => void }) {
  const filterableColumns = columns.filter((column) => !column.readonly && column.type !== 'linked');
  const byID = new Map(columns.map((column) => [column.id, column]));
  const updateAtPath = (path: number[], updater: (node: ViewAdvancedFilterNode) => ViewAdvancedFilterNode | null) => {
    const next = updateAdvancedNodeAtPath(group, path, updater);
    if (next?.type === 'group') onChange(next);
  };
  const updateGroupAtPath = (path: number[], updater: (target: ViewAdvancedFilterGroup) => ViewAdvancedFilterGroup) => {
    if (!path.length) {
      onChange(updater(group));
      return;
    }
    updateAtPath(path, (node) => node.type === 'group' ? updater(node) : node);
  };
  const addChild = (path: number[], child: ViewAdvancedFilterNode) => {
    updateGroupAtPath(path, (target) => ({ ...target, children: [...target.children, child] }));
  };
  const removeAtPath = (path: number[]) => {
    if (!path.length) {
      onRemove();
      return;
    }
    const next = removeAdvancedNodeAtPath(group, path);
    if (next.children.length) onChange(next);
    else onRemove();
  };
  const duplicateAtPath = (path: number[]) => {
    if (!path.length) return;
    const next = duplicateAdvancedNodeAtPath(group, path);
    if (next) onChange(next);
  };
  const convertRuleToGroupAtPath = (path: number[]) => {
    const next = updateAdvancedNodeAtPath(group, path, (node) => node.type === 'rule'
      ? {
        type: 'group',
        id: crypto.randomUUID(),
        op: 'and',
        children: [cloneAdvancedFilterNode(node)],
      }
      : node);
    if (next?.type === 'group') onChange(next);
  };
  const convertGroupToRuleAtPath = (path: number[]) => {
    const next = updateAdvancedNodeAtPath(group, path, (node) => node.type === 'group' && node.children.length === 1 ? cloneAdvancedFilterNode(node.children[0]) : node);
    if (next?.type === 'group') onChange(next);
  };
  const wrapGroupAtPath = (path: number[]) => {
    const next = updateAdvancedNodeAtPath(group, path, (node) => node.type === 'group'
      ? {
        type: 'group',
        id: crypto.randomUUID(),
        op: 'and',
        children: [cloneAdvancedFilterNode(node)],
      }
      : node);
    if (next?.type === 'group') onChange(next);
  };
  return (
    <div className="akdb-advanced-filter-editor" role="dialog" aria-label="高级筛选" style={style}>
      <AdvancedFilterGroupEditor
        group={group}
        path={[]}
        level={0}
        columns={filterableColumns}
        byID={byID}
        onUpdateRule={(path, patch) => updateAtPath(path, (node) => node.type === 'rule' ? { ...node, rule: { ...node.rule, ...patch } } : node)}
        onToggleGroupOp={(path, op) => updateGroupAtPath(path, (target) => ({ ...target, op }))}
        onAddRule={(path) => addChild(path, { type: 'rule', rule: createDefaultFilterRule(filterableColumns) })}
        onAddGroup={(path) => addChild(path, createAdvancedFilterGroup(filterableColumns))}
        onRemove={removeAtPath}
        onDuplicate={duplicateAtPath}
        onConvertRuleToGroup={convertRuleToGroupAtPath}
        onConvertGroupToRule={convertGroupToRuleAtPath}
        onWrapGroup={wrapGroupAtPath}
      />
      <button type="button" className="akdb-advanced-filter-delete" onClick={onRemove}>
        <Trash2 size={16} />
        <span>删除筛选</span>
      </button>
    </div>
  );
}

function AdvancedFilterGroupEditor({
  group,
  path,
  level,
  columns,
  byID,
  onUpdateRule,
  onToggleGroupOp,
  onAddRule,
  onAddGroup,
  onRemove,
  onDuplicate,
  onConvertRuleToGroup,
  onConvertGroupToRule,
  onWrapGroup,
}: {
  group: ViewAdvancedFilterGroup;
  path: number[];
  level: number;
  columns: DatabaseColumn[];
  byID: Map<string, DatabaseColumn>;
  onUpdateRule: (path: number[], patch: Partial<ViewFilterRule>) => void;
  onToggleGroupOp: (path: number[], op: 'and' | 'or') => void;
  onAddRule: (path: number[]) => void;
  onAddGroup: (path: number[]) => void;
  onRemove: (path: number[]) => void;
  onDuplicate: (path: number[]) => void;
  onConvertRuleToGroup: (path: number[]) => void;
  onConvertGroupToRule: (path: number[]) => void;
  onWrapGroup: (path: number[]) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [opOpen, setOpOpen] = useState(false);
  const opButtonRef = useRef<HTMLButtonElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const opRect = useDropdownPosition(opOpen, opButtonRef, 170, `advanced-filter-op:${group.id}`);
  const addRect = useDropdownPosition(addOpen, addButtonRef, 210, `advanced-filter-add:${group.id}`);
  useDropdownOutsideClose(opOpen, opButtonRef, () => setOpOpen(false), '.akdb-view-rule-dropdown-menu');
  useDropdownOutsideClose(addOpen, addButtonRef, () => setAddOpen(false), '.akdb-advanced-filter-add-menu');
  return (
    <div className={`akdb-advanced-filter-group ${level > 0 ? 'is-nested' : ''}`}>
      {group.children.map((node, index) => {
        const nodePath = [...path, index];
        const prefix = index === 0 ? '当' : group.op === 'or' ? '或' : '与';
        const prefixControl = index === 0 ? (
          <span className="akdb-advanced-filter-prefix is-static">当</span>
        ) : index === 1 ? (
          <button ref={opButtonRef} type="button" className="akdb-advanced-filter-prefix" aria-haspopup="menu" aria-expanded={opOpen} onClick={() => setOpOpen((open) => !open)}>
            {prefix} <ChevronDown size={12} />
          </button>
        ) : (
          <span className="akdb-advanced-filter-prefix is-static">{prefix}</span>
        );
        if (node.type === 'group') {
          return (
            <div key={node.id} className="akdb-advanced-filter-node">
              <div className="akdb-advanced-filter-group-row">
                {prefixControl}
                <AdvancedFilterGroupEditor
                  group={node}
                  path={nodePath}
                  level={level + 1}
                  columns={columns}
                  byID={byID}
                  onUpdateRule={onUpdateRule}
                  onToggleGroupOp={onToggleGroupOp}
                  onAddRule={onAddRule}
                  onAddGroup={onAddGroup}
                  onRemove={onRemove}
                  onDuplicate={onDuplicate}
                  onConvertRuleToGroup={onConvertRuleToGroup}
                  onConvertGroupToRule={onConvertGroupToRule}
                  onWrapGroup={onWrapGroup}
                />
                <AdvancedFilterMoreButton
                  path={nodePath}
                  nodeType="group"
                  canConvertGroupToRule={node.children.length === 1}
                  onRemove={onRemove}
                  onDuplicate={onDuplicate}
                  onConvertRuleToGroup={onConvertRuleToGroup}
                  onConvertGroupToRule={onConvertGroupToRule}
                  onWrapGroup={onWrapGroup}
                />
              </div>
            </div>
          );
        }
        return (
          <div key={node.rule.id} className="akdb-advanced-filter-row">
            {prefixControl}
            <AdvancedFilterRuleControls
              rule={node.rule}
              columns={columns}
              column={byID.get(node.rule.property)}
              onUpdate={(patch) => onUpdateRule(nodePath, patch)}
            />
            <AdvancedFilterMoreButton
              path={nodePath}
              nodeType="rule"
              onRemove={onRemove}
              onDuplicate={onDuplicate}
              onConvertRuleToGroup={onConvertRuleToGroup}
              onConvertGroupToRule={onConvertGroupToRule}
              onWrapGroup={onWrapGroup}
            />
          </div>
        );
      })}
      {opOpen && opRect && createPortal(
        <div className="akdb-view-rule-dropdown-menu akdb-advanced-filter-op-menu" role="menu" style={opRect}>
          <button type="button" role="menuitem" className={group.op === 'and' ? 'is-active' : ''} onClick={() => { onToggleGroupOp(path, 'and'); setOpOpen(false); }}>
            <span>与</span>
            <small>必须满足所有筛选</small>
          </button>
          <button type="button" role="menuitem" className={group.op === 'or' ? 'is-active' : ''} onClick={() => { onToggleGroupOp(path, 'or'); setOpOpen(false); }}>
            <span>或</span>
            <small>必须满足至少一个筛选</small>
          </button>
        </div>,
        document.body,
      )}
      <div className="akdb-advanced-filter-add-wrap">
        <button ref={addButtonRef} type="button" className="akdb-advanced-filter-add" aria-haspopup="menu" aria-expanded={addOpen} onClick={() => setAddOpen((open) => !open)}>
          <Plus size={15} />
          <span>添加筛选规则</span>
          <ChevronDown size={13} />
        </button>
        {addOpen && addRect && createPortal(
          <div className="akdb-advanced-filter-add-menu" role="menu" style={addRect}>
            <button type="button" onClick={() => { setAddOpen(false); onAddRule(path); }}><Plus size={15} /><span>添加筛选规则</span></button>
            <button type="button" onClick={() => { setAddOpen(false); onAddGroup(path); }}><Copy size={15} /><span>添加筛选分组</span></button>
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}

function AdvancedFilterMoreButton({
  path,
  nodeType,
  canConvertGroupToRule = false,
  onRemove,
  onDuplicate,
  onConvertRuleToGroup,
  onConvertGroupToRule,
  onWrapGroup,
}: {
  path: number[];
  nodeType: 'rule' | 'group';
  canConvertGroupToRule?: boolean;
  onRemove: (path: number[]) => void;
  onDuplicate: (path: number[]) => void;
  onConvertRuleToGroup: (path: number[]) => void;
  onConvertGroupToRule: (path: number[]) => void;
  onWrapGroup: (path: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRect = useDropdownPosition(open, buttonRef, 160, `advanced-filter-more:${path.join('.')}`);
  useDropdownOutsideClose(open, buttonRef, () => setOpen(false), '.akdb-view-rule-dropdown-menu');
  return (
    <>
      <button ref={buttonRef} type="button" className="akdb-advanced-filter-more" aria-label="更多操作" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <MoreHorizontal size={16} />
      </button>
      {open && menuRect && createPortal(
        <div className="akdb-view-rule-dropdown-menu akdb-advanced-filter-more-menu" role="menu" style={menuRect}>
          <button type="button" role="menuitem" className="is-danger" onClick={() => { setOpen(false); onRemove(path); }}>
            <Trash2 size={16} />
            <span>移除</span>
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onDuplicate(path); }}>
            <Copy size={16} />
            <span>创建副本</span>
          </button>
          {nodeType === 'rule' && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onConvertRuleToGroup(path); }}>
              <Workflow size={16} />
              <span>转换成分组</span>
            </button>
          )}
          {nodeType === 'group' && canConvertGroupToRule && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onConvertGroupToRule(path); }}>
              <Workflow size={16} />
              <span>转成筛选</span>
            </button>
          )}
          {nodeType === 'group' && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onWrapGroup(path); }}>
              <Workflow size={16} />
              <span>包装成组</span>
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function AdvancedFilterRuleControls({ rule, columns, column, onUpdate }: { rule: ViewFilterRule; columns: DatabaseColumn[]; column?: DatabaseColumn; onUpdate: (patch: Partial<ViewFilterRule>) => void }) {
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [valueOpen, setValueOpen] = useState(false);
  const propertyRef = useRef<HTMLButtonElement | null>(null);
  const operatorRef = useRef<HTMLButtonElement | null>(null);
  const valueRef = useRef<HTMLButtonElement | null>(null);
  const propertyRect = useDropdownPosition(propertyOpen, propertyRef, 220, `advanced-property:${rule.id}`);
  const operatorRect = useDropdownPosition(operatorOpen, operatorRef, 160, `advanced-operator:${rule.id}`);
  const valueRect = useDropdownPosition(valueOpen, valueRef, isDateFilterColumn(column) ? 260 : 240, `advanced-value:${rule.id}`);
  const operators = filterOperatorsForColumn(column);
  const valueDisabled = rule.op === 'is_empty' || rule.op === 'is_not_empty';
  const options = (column?.config?.options || []) as Array<{ id: string; value: string; color?: string }>;
  const selected = Array.isArray(rule.value) ? rule.value.map(String) : String(rule.value || '').split(',').filter(Boolean);
  const selectedSet = new Set(selected);
  const selectedOptions = selected.map((id) => options.find((option) => option.id === id)).filter(Boolean);
  const isOptionColumn = column?.type === 'select' || column?.type === 'status' || column?.type === 'multi_select';
  const optionGroups = groupedFilterOptions(column, options);
  const dropdownSelector = '.akdb-view-rule-dropdown-menu, .akdb-advanced-date-picker-menu, .akdb-date-shortcut-menu';
  useDropdownOutsideClose(propertyOpen, propertyRef, () => setPropertyOpen(false), '.akdb-view-rule-dropdown-menu');
  useDropdownOutsideClose(operatorOpen, operatorRef, () => setOperatorOpen(false), '.akdb-view-rule-dropdown-menu');
  useDropdownOutsideClose(valueOpen, valueRef, () => setValueOpen(false), dropdownSelector);
  const updateProperty = (property: string) => {
    const nextColumn = columns.find((item) => item.id === property);
    if (!nextColumn) return;
    onUpdate({ property, op: defaultFilterOperator(nextColumn), value: defaultFilterValue(nextColumn) });
  };
  const toggleOption = (optionID: string) => {
    onUpdate({ value: selectedSet.has(optionID) ? selected.filter((id) => id !== optionID) : [...selected, optionID] });
  };
  const toggleGroup = (groupOptions: Array<{ id: string; value: string; color?: string }>) => {
    const groupIDs = groupOptions.map((option) => option.id);
    if (!groupIDs.length) return;
    const allSelected = groupIDs.every((id) => selectedSet.has(id));
    const groupIDSet = new Set(groupIDs);
    onUpdate({ value: allSelected ? selected.filter((id) => !groupIDSet.has(id)) : Array.from(new Set([...selected, ...groupIDs])) });
  };
  const clearSelectedOptions = () => onUpdate({ value: [] });
  const valueLabel = (() => {
    if (valueDisabled) return '无需填写';
    if (isOptionColumn) return selectedOptions.length ? selectedOptions.map((option: any) => option.value).join(', ') : '选择选项';
    if (column?.type === 'checkbox') return rule.value === false ? '未勾选' : '已勾选';
    if (isDateFilterColumn(column) && rule.op === 'relative_to_today') return dateRelativeLabel(String(rule.value || 'this_week'));
    return String(rule.value || '') || '值';
  })();
  return (
    <>
      <button ref={propertyRef} type="button" className="akdb-advanced-filter-control is-property" aria-haspopup="menu" aria-expanded={propertyOpen} onClick={() => { setPropertyOpen((open) => !open); setOperatorOpen(false); setValueOpen(false); }}>
        <span className="akdb-view-rule-icon"><ColumnIconGlyph icon={defaultColumnIconID(column)} /></span>
        <span>{column?.name || '属性'}</span>
        <ChevronDown size={13} />
      </button>
      {propertyOpen && propertyRect && createPortal(
        <div className="akdb-view-rule-dropdown-menu akdb-advanced-filter-dropdown" role="menu" style={propertyRect}>
          {columns.map((item) => (
            <button key={item.id} type="button" role="menuitem" className={item.id === rule.property ? 'is-active' : ''} onClick={() => { updateProperty(item.id); setPropertyOpen(false); }}>
              <span className="akdb-view-rule-icon"><ColumnIconGlyph icon={defaultColumnIconID(item)} /></span>
              <span>{item.name}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
      <button ref={operatorRef} type="button" className="akdb-advanced-filter-control is-op" aria-haspopup="menu" aria-expanded={operatorOpen} onClick={() => { setOperatorOpen((open) => !open); setPropertyOpen(false); setValueOpen(false); }}>
        <span>{filterOperatorLabel(rule, column)}</span>
        <ChevronDown size={13} />
      </button>
      {operatorOpen && operatorRect && createPortal(
        <div className="akdb-view-rule-dropdown-menu akdb-advanced-filter-dropdown is-operator" role="menu" style={operatorRect}>
          {operators.map((operator) => (
            <button key={operator.op} type="button" role="menuitem" className={operator.op === rule.op ? 'is-active' : ''} onClick={() => { onUpdate(nextFilterOperatorPatch(operator.op, column, rule.value)); setOperatorOpen(false); }}>
              <span>{operator.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
      {!valueDisabled && isOptionColumn ? (
        <>
          <button ref={valueRef} type="button" className={`akdb-advanced-filter-control is-value ${selectedOptions.length ? 'has-value' : ''}`} aria-haspopup="menu" aria-expanded={valueOpen} onClick={() => { setValueOpen((open) => !open); setPropertyOpen(false); setOperatorOpen(false); }}>
            {selectedOptions.length ? (
              <span className="akdb-advanced-filter-tags">
                {selectedOptions.map((option: any) => (
                  <OptionTag key={option.id} option={option} config={column?.config || {}} />
                ))}
              </span>
            ) : (
              <span>{valueLabel}</span>
            )}
            <ChevronDown size={13} />
          </button>
          {valueOpen && valueRect && createPortal(
            <div className="akdb-view-rule-dropdown-menu akdb-advanced-filter-dropdown is-value" role="menu" style={valueRect}>
              {isOptionColumn && (
                <div className={`akdb-filter-value-combobox akdb-advanced-filter-value-combobox ${selectedOptions.length ? 'has-value' : ''}`}>
                  {selectedOptions.map((option: any) => (
                    <OptionTag
                      key={option.id}
                      option={option}
                      config={column?.config || {}}
                      removable
                      onRemove={() => onUpdate({ value: selected.filter((id) => id !== option.id) })}
                    />
                  ))}
                  {!selectedOptions.length && <span className="akdb-advanced-filter-value-placeholder">选择选项</span>}
                  {selectedOptions.length > 0 && (
                    <button type="button" className="akdb-filter-value-clear" aria-label="清除筛选值" onClick={clearSelectedOptions}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              )}
              {optionGroups.map((group) => (
                <div key={group.key} className={`akdb-view-rule-option-group ${group.label ? 'has-title' : ''}`}>
                  {group.label && (() => {
                    const selectedCount = group.options.filter((option) => selectedSet.has(option.id)).length;
                    const allSelected = selectedCount > 0 && selectedCount === group.options.length;
                    const partialSelected = selectedCount > 0 && !allSelected;
                    return (
                      <button type="button" className={`akdb-view-rule-option-group-title ${allSelected ? 'is-active' : ''} ${partialSelected ? 'is-partial' : ''}`} onClick={() => toggleGroup(group.options)}>
                        <span className="akdb-view-rule-check">
                          {allSelected ? <Check size={13} strokeWidth={2.4} /> : partialSelected ? <span className="akdb-view-rule-check-mixed" /> : null}
                        </span>
                        <span>{group.label}</span>
                      </button>
                    );
                  })()}
                  {group.options.map((option) => {
                    const checked = selectedSet.has(option.id);
                    return (
                      <button key={option.id} type="button" className={`akdb-view-rule-option ${checked ? 'is-active' : ''}`} onClick={() => toggleOption(option.id)}>
                        <span className="akdb-view-rule-check">{checked ? <Check size={13} strokeWidth={2.4} /> : null}</span>
                        <OptionTag option={option} config={column?.config || {}} />
                      </button>
                    );
                  })}
                </div>
              ))}
              {!options.length && <div className="akdb-filter-empty">暂无选项</div>}
            </div>,
            document.body,
          )}
        </>
      ) : !valueDisabled && isDateFilterColumn(column) ? (
        <AdvancedDateFilterValueControls
          rule={rule}
          valueRef={valueRef}
          valueOpen={valueOpen}
          valueRect={valueRect}
          onOpenChange={(open) => {
            setValueOpen(open);
            if (open) {
              setPropertyOpen(false);
              setOperatorOpen(false);
            }
          }}
          onUpdate={onUpdate}
        />
      ) : !valueDisabled && column?.type === 'checkbox' ? (
        <>
          <button ref={valueRef} type="button" className="akdb-advanced-filter-control is-value is-checkbox-value" aria-haspopup="menu" aria-expanded={valueOpen} onClick={() => { setValueOpen((open) => !open); setPropertyOpen(false); setOperatorOpen(false); }}>
            <span className={`akdb-advanced-filter-checkbox-preview ${rule.value === false ? 'is-unchecked' : ''}`}>
              {rule.value === false ? null : <Check size={15} strokeWidth={2.4} />}
            </span>
            <ChevronDown size={13} />
          </button>
          {valueOpen && valueRect && createPortal(
            <div className="akdb-view-rule-dropdown-menu akdb-advanced-filter-dropdown is-value" role="menu" style={valueRect}>
              {[true, false].map((value) => (
                <button key={String(value)} type="button" className={rule.value === value ? 'is-active' : ''} onClick={() => { onUpdate({ value }); setValueOpen(false); }}>
                  <span className="akdb-view-rule-check">{rule.value === value ? <Check size={13} strokeWidth={2.4} /> : null}</span>
                  <span>{value ? '已勾选' : '未勾选'}</span>
                </button>
              ))}
            </div>,
            document.body,
          )}
        </>
      ) : !valueDisabled ? (
        <input className="akdb-advanced-filter-input" value={String(rule.value || '')} placeholder="值" onChange={(event) => onUpdate({ value: event.currentTarget.value })} />
      ) : (
        <span className="akdb-advanced-filter-value is-spacer" aria-hidden="true" />
      )}
    </>
  );
}

function AdvancedDateFilterValueControls({
  rule,
  valueRef,
  valueOpen,
  valueRect,
  onOpenChange,
  onUpdate,
}: {
  rule: ViewFilterRule;
  valueRef: RefObject<HTMLButtonElement>;
  valueOpen: boolean;
  valueRect: CSSProperties | null;
  onOpenChange: (open: boolean) => void;
  onUpdate: (patch: Partial<ViewFilterRule>) => void;
}) {
  if (rule.op === 'relative_to_today') {
    return <AdvancedDateRelativeControls value={String(rule.value || 'this_week')} onChange={(value) => onUpdate({ value })} />;
  }
  const label = advancedDateValueLabel(rule);
  return (
    <>
      <button ref={valueRef} type="button" className={`akdb-advanced-filter-control is-value ${label ? 'has-value' : ''}`} aria-haspopup="dialog" aria-expanded={valueOpen} onClick={() => onOpenChange(!valueOpen)}>
        <span>{label || '选择日期'}</span>
        <ChevronDown size={13} />
      </button>
      {valueOpen && valueRect && createPortal(
        <div className="akdb-advanced-date-picker-menu" role="dialog" aria-label="选择日期筛选值" style={valueRect}>
          <DateFilterEditor filter={rule} onUpdate={onUpdate} />
        </div>,
        document.body,
      )}
    </>
  );
}

function AdvancedDateRelativeControls({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [prefixOpen, setPrefixOpen] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const prefixRef = useRef<HTMLButtonElement | null>(null);
  const unitRef = useRef<HTMLButtonElement | null>(null);
  const prefixRect = useDropdownPosition(prefixOpen, prefixRef, 108, `advanced-date-prefix:${value}`);
  const unitRect = useDropdownPosition(unitOpen, unitRef, 108, `advanced-date-unit:${value}`);
  const relative = parseDateRelativeValue(value);
  useDropdownOutsideClose(prefixOpen, prefixRef, () => setPrefixOpen(false), '.akdb-view-rule-dropdown-menu');
  useDropdownOutsideClose(unitOpen, unitRef, () => setUnitOpen(false), '.akdb-view-rule-dropdown-menu');
  const update = (patch: Partial<DateRelativeValue>) => {
    onChange(formatDateRelativeValue({ ...relative, ...patch }));
  };
  return (
    <div className={`akdb-advanced-date-relative-controls ${relative.prefix === 'past' || relative.prefix === 'future' ? 'has-count' : ''}`}>
      <div className="akdb-view-rule-dropdown">
        <button ref={prefixRef} type="button" className="akdb-advanced-filter-control akdb-advanced-date-relative-control" aria-haspopup="menu" aria-expanded={prefixOpen} onClick={() => { setPrefixOpen((open) => !open); setUnitOpen(false); }}>
          <span>{dateRelativePrefixChoices.find((choice) => choice.id === relative.prefix)?.label || '本'}</span>
          <ChevronDown size={13} />
        </button>
        {prefixOpen && prefixRect && createPortal(
          <div className="akdb-view-rule-dropdown-menu akdb-advanced-filter-dropdown" role="menu" style={prefixRect}>
            {dateRelativePrefixChoices.map((choice) => (
              <button key={choice.id} type="button" role="menuitem" className={relative.prefix === choice.id ? 'is-active' : ''} onClick={() => { update({ prefix: choice.id }); setPrefixOpen(false); }}>
                <span>{choice.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>
      {(relative.prefix === 'past' || relative.prefix === 'future') && (
        <input
          className="akdb-advanced-date-relative-count"
          value={String(relative.count || 1)}
          inputMode="numeric"
          onChange={(event) => update({ count: Math.max(1, Number(event.currentTarget.value.replace(/\D/g, '')) || 1) })}
        />
      )}
      <div className="akdb-view-rule-dropdown">
        <button ref={unitRef} type="button" className="akdb-advanced-filter-control akdb-advanced-date-relative-control" aria-haspopup="menu" aria-expanded={unitOpen} onClick={() => { setUnitOpen((open) => !open); setPrefixOpen(false); }}>
          <span>{dateRelativeUnitChoices.find((choice) => choice.id === relative.unit)?.label || '周'}</span>
          <ChevronDown size={13} />
        </button>
        {unitOpen && unitRect && createPortal(
          <div className="akdb-view-rule-dropdown-menu akdb-advanced-filter-dropdown" role="menu" style={unitRect}>
            {dateRelativeUnitChoices.map((choice) => (
              <button key={choice.id} type="button" role="menuitem" className={relative.unit === choice.id ? 'is-active' : ''} onClick={() => { update({ unit: choice.id }); setUnitOpen(false); }}>
                <span>{choice.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}

function advancedDateValueLabel(rule: ViewFilterRule) {
  if (rule.op === 'between') {
    const values = Array.isArray(rule.value) ? rule.value : String(rule.value || '').split(',').filter(Boolean);
    return values.length >= 2 ? `${formatCompactDateFilterLabel(String(values[0]))} - ${formatCompactDateFilterLabel(String(values[1]))}` : '';
  }
  return formatDateFilterLabel(String(rule.value || ''));
}

function SortRuleEditor({ sort, column, style, onUpdate, onRemove }: { sort: ViewSortRule; column?: DatabaseColumn; style?: CSSProperties; onUpdate: (patch: Partial<ViewSortRule>) => void; onRemove: () => void }) {
  return (
    <div className="akdb-view-rule-editor is-sort" role="dialog" aria-label="排序条件" style={style}>
      <div className="akdb-view-rule-editor-head">
        <button type="button">{column?.name || '属性'}</button>
        <button type="button" onClick={() => onUpdate({ dir: sort.dir === 'asc' ? 'desc' : 'asc' })}>{sort.dir === 'asc' ? '升序' : '降序'} <ChevronDown size={14} /></button>
        <button type="button" className="akdb-view-rule-more" aria-label="移除排序" onClick={onRemove}><MoreHorizontal size={16} /></button>
      </div>
    </div>
  );
}

function defaultFilterOperator(column: DatabaseColumn) {
  if (isDateFilterColumn(column)) return 'relative_to_today';
  if (column.type === 'multi_select') return 'contains';
  if (column.type === 'select' || column.type === 'status' || column.type === 'checkbox') return 'equals';
  return 'contains';
}

function defaultFilterValue(column: DatabaseColumn) {
  if (isDateFilterColumn(column)) return 'this_week';
  if (column.type === 'select' || column.type === 'status' || column.type === 'multi_select') return [];
  if (column.type === 'checkbox') return true;
  return '';
}

function filterOperatorLabel(filter: ViewFilterRule, column?: DatabaseColumn) {
  if (filter.op === 'relative_to_today') return '相对于今天';
  if (filter.op === 'equals') return '是';
  if (filter.op === 'not_equals') return '不是';
  if (filter.op === 'before') return '早于';
  if (filter.op === 'after') return '晚于';
  if (filter.op === 'on_or_before') return '不晚于';
  if (filter.op === 'on_or_after') return '不早于';
  if (filter.op === 'between') return '介于';
  if (filter.op === 'not_contains') return '不包含';
  if (filter.op === 'starts_with') return '开头是';
  if (filter.op === 'ends_with') return '结尾是';
  if (filter.op === 'is_empty') return '为空白';
  if (filter.op === 'is_not_empty') return '不为空白';
  return '包含';
}

function isEffectiveFilter(filter: ViewFilterRule, column?: DatabaseColumn) {
  if (filter.op === 'is_empty' || filter.op === 'is_not_empty') return true;
  if (column?.type === 'checkbox') return typeof filter.value === 'boolean';
  if (Array.isArray(filter.value)) return filter.value.length > 0;
  return String(filter.value ?? '').trim().length > 0;
}

function filterValueLabel(filter: ViewFilterRule, column?: DatabaseColumn) {
  if (filter.op === 'is_empty') return '为空白';
  if (filter.op === 'is_not_empty') return '不为空白';
  if (filter.op === 'relative_to_today' && isDateFilterColumn(column)) return dateRelativeLabel(String(filter.value || 'this_week'));
  if (filter.op === 'between' && isDateFilterColumn(column)) {
    const values = Array.isArray(filter.value) ? filter.value : String(filter.value || '').split(',').filter(Boolean);
    return values.length >= 2 ? `${formatCompactDateFilterLabel(String(values[0]))} - ${formatCompactDateFilterLabel(String(values[1]))}` : '';
  }
  if (isDateFilterColumn(column)) return formatDateFilterLabel(String(filter.value || ''));
  if (column?.type === 'checkbox') return filter.value === false ? '未勾选' : '已勾选';
  const options = (column?.config?.options || []) as Array<{ id: string; value: string }>;
  const optionByID = new Map(options.map((option) => [option.id, option.value]));
  const values = Array.isArray(filter.value) ? filter.value : String(filter.value || '').split(',').filter(Boolean);
  if (column?.type === 'select' || column?.type === 'status' || column?.type === 'multi_select') {
    return values.map((id) => optionByID.get(String(id)) || String(id)).join(', ');
  }
  return String(filter.value ?? '');
}

function filterOperatorsForColumn(column?: DatabaseColumn): Array<{ op: ViewFilterRule['op']; label: string }> {
  if (column?.type === 'checkbox') return [{ op: 'equals', label: '是' }, { op: 'not_equals', label: '不是' }];
  if (isDateFilterColumn(column)) return [
    { op: 'equals', label: '是' },
    { op: 'before', label: '早于' },
    { op: 'after', label: '晚于' },
    { op: 'on_or_before', label: '不晚于' },
    { op: 'on_or_after', label: '不早于' },
    { op: 'between', label: '介于' },
    { op: 'relative_to_today', label: '相对于今天' },
    { op: 'is_empty', label: '为空白' },
    { op: 'is_not_empty', label: '不为空白' },
  ];
  if (column?.type === 'multi_select') return [
    { op: 'contains', label: '包含' },
    { op: 'not_contains', label: '不包含' },
    { op: 'is_empty', label: '为空白' },
    { op: 'is_not_empty', label: '不为空白' },
  ];
  if (column?.type === 'select' || column?.type === 'status') return [
    { op: 'equals', label: '是' },
    { op: 'not_equals', label: '不是' },
    { op: 'is_empty', label: '为空白' },
    { op: 'is_not_empty', label: '不为空白' },
  ];
  return [
    { op: 'equals', label: '是' },
    { op: 'not_equals', label: '不是' },
    { op: 'contains', label: '包含' },
    { op: 'not_contains', label: '不包含' },
    { op: 'starts_with', label: '开头是' },
    { op: 'ends_with', label: '结尾是' },
    { op: 'is_empty', label: '为空白' },
    { op: 'is_not_empty', label: '不为空白' },
  ];
}

function nextFilterOperatorPatch(op: ViewFilterRule['op'], column: DatabaseColumn | undefined, currentValue: ViewFilterRule['value']): Partial<ViewFilterRule> {
  if (!isDateFilterColumn(column)) return { op };
  if (op === 'is_empty' || op === 'is_not_empty') return { op, value: '' };
  if (op === 'relative_to_today') return { op, value: formatDateRelativeValue(parseDateRelativeValue(String(currentValue || 'this_week'))) };
  if (op === 'between') {
    const values = Array.isArray(currentValue) ? currentValue.map(String) : String(currentValue || '').split(',').filter(Boolean);
    const start = parseDateInputValue(String(values[0] || ''));
    const end = parseDateInputValue(String(values[1] || ''));
    return { op, value: [start ? formatDateInputValue(start) : '', end ? formatDateInputValue(end) : ''] };
  }
  const currentDate = parseDateInputValue(String(Array.isArray(currentValue) ? currentValue[0] || '' : currentValue || ''));
  return { op, value: currentDate ? formatDateInputValue(currentDate) : '' };
}

function DateFilterEditor({ filter, onUpdate }: { filter: ViewFilterRule; onUpdate: (patch: Partial<ViewFilterRule>) => void }) {
  const [prefixOpen, setPrefixOpen] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const [activeBetweenIndex, setActiveBetweenIndex] = useState<0 | 1>(0);
  const prefixRef = useRef<HTMLButtonElement | null>(null);
  const unitRef = useRef<HTMLButtonElement | null>(null);
  const prefixRect = useDropdownPosition(prefixOpen, prefixRef, 108);
  const unitRect = useDropdownPosition(unitOpen, unitRef, 108);
  const relative = parseDateRelativeValue(String(filter.value || 'this_week'));
  const range = dateRelativeRange(relative.prefix, relative.unit, relative.count);
  const selectedDate = parseDateInputValue(String(Array.isArray(filter.value) ? filter.value[0] || '' : filter.value || ''));
  const betweenValues = Array.isArray(filter.value) ? filter.value.map(String) : String(filter.value || '').split(',').filter(Boolean);
  const betweenStart = parseDateInputValue(String(betweenValues[0] || ''));
  const betweenEnd = parseDateInputValue(String(betweenValues[1] || ''));
  const highlightRange = filter.op === 'relative_to_today'
    ? range
    : filter.op === 'between' && betweenStart && betweenEnd
      ? { start: betweenStart, end: betweenEnd }
      : selectedDate
        ? { start: selectedDate, end: selectedDate }
        : { start: startOfLocalDay(new Date()), end: startOfLocalDay(new Date()) };
  const [viewMonth, setViewMonth] = useState(() => new Date(highlightRange.start.getFullYear(), highlightRange.start.getMonth(), 1));
  useDropdownOutsideClose(prefixOpen, prefixRef, () => setPrefixOpen(false), '.akdb-view-rule-dropdown-menu');
  useDropdownOutsideClose(unitOpen, unitRef, () => setUnitOpen(false), '.akdb-view-rule-dropdown-menu');
  useEffect(() => {
    setViewMonth(new Date(highlightRange.start.getFullYear(), highlightRange.start.getMonth(), 1));
  }, [filter.value]);
  useEffect(() => {
    if (filter.op !== 'between') setActiveBetweenIndex(0);
  }, [filter.op]);
  const days = calendarDaysForMonth(viewMonth);
  const today = startOfLocalDay(new Date());
  const updateRelative = (patch: Partial<DateRelativeValue>) => {
    const next = { ...relative, ...patch };
    onUpdate({ op: 'relative_to_today', value: formatDateRelativeValue(next) });
  };
  const updateSingleDate = (value: string) => onUpdate({ value });
  const updateBetweenDate = (index: 0 | 1, value: string) => {
    const next = [String(betweenValues[0] || ''), String(betweenValues[1] || '')];
    next[index] = value;
    onUpdate({ value: next });
  };
  const selectCalendarDate = (date: Date) => {
    const value = formatDateInputValue(date);
    if (filter.op === 'between') {
      const next = [String(betweenValues[0] || ''), String(betweenValues[1] || '')];
      next[activeBetweenIndex] = value;
      onUpdate({ value: next });
      setActiveBetweenIndex(activeBetweenIndex === 0 ? 1 : 0);
      return;
    }
    if (filter.op !== 'relative_to_today') updateSingleDate(value);
  };
  const showCalendar = filter.op !== 'is_empty' && filter.op !== 'is_not_empty';
  return (
    <div className="akdb-date-filter-panel">
      {filter.op === 'relative_to_today' ? <div className={`akdb-date-filter-controls ${relative.prefix === 'past' || relative.prefix === 'future' ? 'has-count' : ''}`}>
        <div className="akdb-view-rule-dropdown">
          <button ref={prefixRef} type="button" aria-haspopup="menu" aria-expanded={prefixOpen} onClick={() => { setPrefixOpen((open) => !open); setUnitOpen(false); }}>
            {dateRelativePrefixChoices.find((choice) => choice.id === relative.prefix)?.label || '本'} <ChevronDown size={14} />
          </button>
          {prefixOpen && prefixRect && createPortal(
            <div className="akdb-view-rule-dropdown-menu" role="menu" style={prefixRect}>
              {dateRelativePrefixChoices.map((choice) => (
                <button key={choice.id} type="button" role="menuitem" className={relative.prefix === choice.id ? 'is-active' : ''} onClick={() => { updateRelative({ prefix: choice.id }); setPrefixOpen(false); }}>
                  {choice.label}
                </button>
              ))}
            </div>,
            document.body,
          )}
        </div>
        {(relative.prefix === 'past' || relative.prefix === 'future') && (
          <input
            className="akdb-date-filter-count"
            value={String(relative.count || 1)}
            inputMode="numeric"
            onChange={(event) => updateRelative({ count: Math.max(1, Number(event.currentTarget.value.replace(/\D/g, '')) || 1) })}
          />
        )}
        <div className="akdb-view-rule-dropdown">
          <button ref={unitRef} type="button" aria-haspopup="menu" aria-expanded={unitOpen} onClick={() => { setUnitOpen((open) => !open); setPrefixOpen(false); }}>
            {dateRelativeUnitChoices.find((choice) => choice.id === relative.unit)?.label || '周'} <ChevronDown size={14} />
          </button>
          {unitOpen && unitRect && createPortal(
            <div className="akdb-view-rule-dropdown-menu" role="menu" style={unitRect}>
              {dateRelativeUnitChoices.map((choice) => (
                <button key={choice.id} type="button" role="menuitem" className={relative.unit === choice.id ? 'is-active' : ''} onClick={() => { updateRelative({ unit: choice.id }); setUnitOpen(false); }}>
                  {choice.label}
                </button>
              ))}
            </div>,
            document.body,
          )}
        </div>
      </div> : filter.op === 'between' ? (
        <div className="akdb-date-filter-range-inputs">
          <DateFilterInput value={String(betweenValues[0] || '')} placeholder="开始日期" shortcuts={false} compact active={activeBetweenIndex === 0} onActivate={() => setActiveBetweenIndex(0)} onChange={(value) => updateBetweenDate(0, value)} />
          <DateFilterInput value={String(betweenValues[1] || '')} placeholder="结束日期" shortcuts={false} compact active={activeBetweenIndex === 1} onActivate={() => setActiveBetweenIndex(1)} onChange={(value) => updateBetweenDate(1, value)} />
        </div>
      ) : showCalendar ? (
        <DateFilterInput value={String(filter.value || '')} placeholder="选择或输入日期" onChange={updateSingleDate} />
      ) : null}
      {showCalendar && <div className="akdb-date-filter-calendar">
        <div className="akdb-date-filter-calendar-head">
          <strong>{viewMonth.getFullYear()}年{viewMonth.getMonth() + 1}月</strong>
          <button type="button" aria-label="上个月" onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
          <button type="button" aria-label="下个月" onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
        </div>
        <div className="akdb-date-filter-grid is-weekdays">
          {['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="akdb-date-filter-grid">
          {days.map((day) => {
            const currentMonth = day.date.getMonth() === viewMonth.getMonth();
            const rangeStart = highlightRange.start <= highlightRange.end ? highlightRange.start : highlightRange.end;
            const rangeEnd = highlightRange.start <= highlightRange.end ? highlightRange.end : highlightRange.start;
            const inRange = day.date >= rangeStart && day.date <= rangeEnd;
            const isStart = isSameLocalDate(day.date, rangeStart);
            const isEnd = isSameLocalDate(day.date, rangeEnd);
            const isToday = isSameLocalDate(day.date, today);
            return (
              <button type="button" key={day.key} className={[!currentMonth ? 'is-muted' : '', inRange ? 'is-in-range' : '', isStart ? 'is-range-start' : '', isEnd ? 'is-range-end' : '', isToday ? 'is-today' : ''].filter(Boolean).join(' ')} onClick={() => selectCalendarDate(day.date)}>
                {day.date.getDate()}
              </button>
            );
          })}
        </div>
      </div>}
      {filter.op === 'relative_to_today' && <div className="akdb-date-filter-help">筛选将根据当前日期更新</div>}
    </div>
  );
}

function DateFilterInput({ value, placeholder, shortcuts: shortcutsEnabled = true, compact = false, active = false, onActivate, onChange }: { value: string; placeholder: string; shortcuts?: boolean; compact?: boolean; active?: boolean; onActivate?: () => void; onChange: (value: string) => void }) {
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const shortcutRect = useDropdownPosition(shortcutOpen, wrapRef, 0, value);
  useDropdownOutsideClose(shortcutOpen, wrapRef, () => setShortcutOpen(false), '.akdb-date-shortcut-menu');
  const shortcuts = [
    { value: 'date_shortcut:today', label: '今天' },
    { value: 'date_shortcut:tomorrow', label: '明天' },
    { value: 'date_shortcut:yesterday', label: '昨天' },
    { value: 'date_shortcut:last_week', label: '一周前' },
    { value: 'date_shortcut:next_week', label: '一周后' },
    { value: 'date_shortcut:last_month', label: '一个月前' },
    { value: 'date_shortcut:next_month', label: '一个月后' },
  ];
  const activeShortcut = shortcuts.find((shortcut) => shortcut.value === value);
  return (
    <div ref={wrapRef} className={`akdb-date-filter-input-wrap ${shortcutsEnabled ? '' : 'no-shortcuts'} ${active ? 'is-active' : ''}`}>
      <input value={compact ? formatCompactDateFilterLabel(value) : formatDateFilterLabel(value)} placeholder={placeholder} onFocus={onActivate} onPointerDown={onActivate} onChange={(event) => onChange(event.currentTarget.value)} />
      {value && <button type="button" className="akdb-date-filter-clear" aria-label="清除日期" onClick={() => onChange('')}><X size={14} /></button>}
      {shortcutsEnabled && <button type="button" className="akdb-date-filter-shortcut-trigger" aria-label="选择相对日期" aria-haspopup="menu" aria-expanded={shortcutOpen} onClick={() => setShortcutOpen((open) => !open)}>
        <ChevronDown size={14} />
      </button>}
      {shortcutsEnabled && shortcutOpen && shortcutRect && createPortal(
        <div className="akdb-date-shortcut-menu" role="menu" style={shortcutRect}>
          {shortcuts.map((shortcut) => {
            const active = value === shortcut.value;
            return (
              <button key={shortcut.value} type="button" role="menuitem" className={active ? 'is-active' : ''} onClick={() => { onChange(shortcut.value); setShortcutOpen(false); }}>
                <span>{shortcut.label}</span>
                {active ? <Check size={13} strokeWidth={2.4} /> : null}
              </button>
            );
          })}
          <button type="button" role="menuitem" className={!activeShortcut ? 'is-active' : ''} onClick={() => setShortcutOpen(false)}>
            <span>自定义日期</span>
            {!activeShortcut ? <Check size={13} strokeWidth={2.4} /> : null}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

type DateRelativePrefix = 'this' | 'last' | 'next' | 'past' | 'future';
type DateRelativeUnit = 'day' | 'week' | 'month' | 'year';
type DateRelativeValue = { prefix: DateRelativePrefix; unit: DateRelativeUnit; count: number };

const dateRelativePrefixChoices: Array<{ id: DateRelativePrefix; label: string }> = [
  { id: 'past', label: '过去' },
  { id: 'future', label: '未来' },
  { id: 'this', label: '本' },
];
const dateRelativeUnitChoices: Array<{ id: DateRelativeUnit; label: string }> = [
  { id: 'day', label: '天' },
  { id: 'week', label: '周' },
  { id: 'month', label: '月' },
  { id: 'year', label: '年' },
];

function isDateFilterColumn(column?: DatabaseColumn) {
  return column?.type === 'date' || column?.type === 'created_time' || column?.type === 'last_edited_time';
}

function parseDateRelativeValue(value: string): DateRelativeValue {
  const parts = value.split('_');
  const prefix = parts[0];
  const hasCount = /^\d+$/.test(parts[1] || '');
  const count = hasCount ? Number(parts[1]) : 1;
  const unit = hasCount ? parts[2] : parts[1];
  return {
    prefix: prefix === 'last' || prefix === 'next' || prefix === 'past' || prefix === 'future' ? prefix : 'this',
    unit: unit === 'day' || unit === 'month' || unit === 'year' ? unit : 'week',
    count: Math.max(1, count || 1),
  };
}

function formatDateRelativeValue(value: DateRelativeValue) {
  return value.prefix === 'past' || value.prefix === 'future'
    ? `${value.prefix}_${Math.max(1, value.count || 1)}_${value.unit}`
    : `${value.prefix}_${value.unit}`;
}

function dateRelativeLabel(value: string) {
  const parsed = parseDateRelativeValue(value);
  const prefix = dateRelativePrefixChoices.find((choice) => choice.id === parsed.prefix)?.label || '本';
  const unit = dateRelativeUnitChoices.find((choice) => choice.id === parsed.unit)?.label || '周';
  return parsed.prefix === 'past' || parsed.prefix === 'future' ? `${prefix} ${parsed.count} ${unit}` : `${prefix}${unit}`;
}

function dateRelativeRange(prefix: DateRelativePrefix, unit: DateRelativeUnit, count = 1) {
  const today = startOfLocalDay(new Date());
  let start = today;
  let end = today;
  if (prefix === 'past') return { start: addLocalDays(today, -relativeDateUnitDays(unit, count)), end: today };
  if (prefix === 'future') return { start: today, end: addLocalDays(today, relativeDateUnitDays(unit, count)) };
  if (unit === 'week') {
    const offset = (today.getDay() + 6) % 7;
    start = addLocalDays(today, -offset);
    end = addLocalDays(start, 6);
  } else if (unit === 'month') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  } else if (unit === 'year') {
    start = new Date(today.getFullYear(), 0, 1);
    end = new Date(today.getFullYear(), 11, 31);
  }
  const shift = prefix === 'last' ? -1 : prefix === 'next' ? 1 : 0;
  if (shift && unit === 'day') {
    start = addLocalDays(start, shift);
    end = start;
  } else if (shift && unit === 'week') {
    start = addLocalDays(start, 7 * shift);
    end = addLocalDays(end, 7 * shift);
  } else if (shift && unit === 'month') {
    start = new Date(start.getFullYear(), start.getMonth() + shift, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  } else if (shift && unit === 'year') {
    start = new Date(start.getFullYear() + shift, 0, 1);
    end = new Date(start.getFullYear(), 11, 31);
  }
  return { start, end };
}

function relativeDateUnitDays(unit: DateRelativeUnit, count: number) {
  if (unit === 'day') return count;
  if (unit === 'month') return 31 * count;
  if (unit === 'year') return 366 * count;
  return 7 * count;
}

function parseDateInputValue(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const shortcut = resolveDateShortcutValue(raw);
  if (shortcut) return shortcut;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const zh = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (zh) return new Date(Number(zh[1]), Number(zh[2]) - 1, Number(zh[3]));
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateFilterLabel(value: string) {
  const shortcut = dateShortcutLabel(value);
  if (shortcut) return shortcut;
  const date = parseDateInputValue(value);
  return date ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日` : value;
}

function formatCompactDateFilterLabel(value: string) {
  const date = parseDateInputValue(value);
  return date ? `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}` : value;
}

function dateShortcutLabel(value: string) {
  if (value === 'date_shortcut:today') return '今天';
  if (value === 'date_shortcut:tomorrow') return '明天';
  if (value === 'date_shortcut:yesterday') return '昨天';
  if (value === 'date_shortcut:last_week') return '一周前';
  if (value === 'date_shortcut:next_week') return '一周后';
  if (value === 'date_shortcut:last_month') return '一个月前';
  if (value === 'date_shortcut:next_month') return '一个月后';
  return '';
}

function resolveDateShortcutValue(value: string) {
  const today = startOfLocalDay(new Date());
  if (value === 'date_shortcut:today') return today;
  if (value === 'date_shortcut:tomorrow') return addLocalDays(today, 1);
  if (value === 'date_shortcut:yesterday') return addLocalDays(today, -1);
  if (value === 'date_shortcut:last_week') return addLocalDays(today, -7);
  if (value === 'date_shortcut:next_week') return addLocalDays(today, 7);
  if (value === 'date_shortcut:last_month') return addLocalMonths(today, -1);
  if (value === 'date_shortcut:next_month') return addLocalMonths(today, 1);
  return null;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addLocalMonths(date: Date, months: number) {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), maxDay));
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

function isSameLocalDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function groupedFilterOptions(column: DatabaseColumn | undefined, options: Array<{ id: string; value: string; color?: string }>) {
  if (column?.type !== 'status') return [{ key: 'all', label: '', options }];
  const groups = Array.isArray(column.config?.groups) ? column.config.groups : [];
  if (!groups.length) return [{ key: 'all', label: '', options }];
  const optionByID = new Map(options.map((option) => [option.id, option]));
  const used = new Set<string>();
  const out = groups.map((group: any, index: number) => {
    const groupOptions = (Array.isArray(group.option_ids) ? group.option_ids : [])
      .map((id: string) => optionByID.get(id))
      .filter(Boolean) as Array<{ id: string; value: string; color?: string }>;
    groupOptions.forEach((option) => used.add(option.id));
    return {
      key: String(group.id || group.name || `status-group-${index}`),
      label: String(group.name || '未命名分组'),
      options: groupOptions,
    };
  }).filter((group) => group.options.length);
  const rest = options.filter((option) => !used.has(option.id));
  if (rest.length) out.push({ key: 'ungrouped', label: '未分组', options: rest });
  return out.length ? out : [{ key: 'all', label: '', options }];
}

function createAdvancedFilterGroup(columns: DatabaseColumn[] = []): ViewAdvancedFilterGroup {
  return {
    type: 'group',
    id: crypto.randomUUID(),
    op: 'and',
    children: [{ type: 'rule', rule: createDefaultFilterRule(columns) }],
  };
}

function createDefaultFilterRule(columns: DatabaseColumn[] = []): ViewFilterRule {
  const column = columns.find((item) => !item.readonly && item.type !== 'linked') || columns[0];
  return {
    id: crypto.randomUUID(),
    property: column?.id || '',
    op: column ? defaultFilterOperator(column) : 'contains',
    value: column ? defaultFilterValue(column) : '',
  };
}

function countAdvancedFilterRules(group: ViewAdvancedFilterGroup): number {
  return group.children.reduce((count, node) => count + (node.type === 'group' ? countAdvancedFilterRules(node) : 1), 0);
}

function updateAdvancedNodeAtPath(group: ViewAdvancedFilterGroup, path: number[], updater: (node: ViewAdvancedFilterNode) => ViewAdvancedFilterNode | null): ViewAdvancedFilterGroup | null {
  if (!path.length) {
    const next = updater(group);
    return next?.type === 'group' ? next : null;
  }
  const [index, ...rest] = path;
  return {
    ...group,
    children: group.children.map((child, childIndex) => {
      if (childIndex !== index) return child;
      if (!rest.length) return updater(child);
      return child.type === 'group' ? updateAdvancedNodeAtPath(child, rest, updater) : child;
    }).filter(Boolean) as ViewAdvancedFilterNode[],
  };
}

function duplicateAdvancedNodeAtPath(group: ViewAdvancedFilterGroup, path: number[]): ViewAdvancedFilterGroup | null {
  if (!path.length) return null;
  const [index, ...rest] = path;
  if (!rest.length) {
    const source = group.children[index];
    if (!source) return group;
    const children = [...group.children];
    children.splice(index + 1, 0, cloneAdvancedFilterNode(source));
    return { ...group, children };
  }
  return {
    ...group,
    children: group.children.map((child, childIndex) => childIndex === index && child.type === 'group'
      ? duplicateAdvancedNodeAtPath(child, rest) || child
      : child),
  };
}

function cloneAdvancedFilterNode(node: ViewAdvancedFilterNode): ViewAdvancedFilterNode {
  if (node.type === 'rule') {
    return {
      type: 'rule',
      rule: {
        ...node.rule,
        id: crypto.randomUUID(),
        value: Array.isArray(node.rule.value) ? [...node.rule.value] : node.rule.value,
      },
    };
  }
  return {
    ...node,
    id: crypto.randomUUID(),
    children: node.children.map(cloneAdvancedFilterNode),
  };
}

function removeAdvancedNodeAtPath(group: ViewAdvancedFilterGroup, path: number[]): ViewAdvancedFilterGroup {
  if (!path.length) return group;
  const [index, ...rest] = path;
  if (!rest.length) return { ...group, children: group.children.filter((_, childIndex) => childIndex !== index) };
  return {
    ...group,
    children: group.children.map((child, childIndex) => childIndex === index && child.type === 'group'
      ? removeAdvancedNodeAtPath(child, rest)
      : child).filter((child) => child.type !== 'group' || child.children.length > 0),
  };
}

function columnTypeIcon(column: DatabaseColumn) {
  if (column.type === 'text') return column.config?.secret ? '***' : 'Aa';
  if (column.type === 'number') return '#';
  if (column.type === 'select') return '▾';
  if (column.type === 'multi_select') return '▾▾';
  if (column.type === 'status') return '≡';
  if (column.type === 'date') return '@';
  if (column.type === 'checkbox') return '☑';
  if (column.type === 'url') return '↗';
  if (column.type === 'relation') return '→';
  if (column.type === 'created_time' || column.type === 'last_edited_time') return '@';
  return 'Aa';
}

function ViewSettingsMenu({
  schemaName,
  columns,
  activeView,
  pane,
  focusNameRequest,
  onOpenLayout,
  onOpenVisibility,
  onOpenFilter,
  onBack,
  onClose,
  onRename,
  onChangeIcon,
  onChangeType,
  onChangeLayout,
  onToggle,
  onHideAll,
  onReorder,
  filterQuery,
  filterColumns,
  onAddFilter,
  onFilterQueryChange,
  onPickFilter,
  onClearActive,
  onUpdateFilter,
  onRemoveFilter,
  onMergeFilterToAdvanced,
  onUpdateAdvancedFilter,
  onReorderFilters,
  style,
}: {
  schemaName: string;
  columns: DatabaseColumn[];
  activeView: DatabaseViewConfig;
  pane: 'main' | 'visibility' | 'layout' | 'filter';
  focusNameRequest: number;
  onOpenLayout: () => void;
  onOpenVisibility: () => void;
  onOpenFilter: () => void;
  onBack: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
  onChangeIcon: (icon: string) => void;
  onChangeType: (type: DatabaseViewType) => void;
  onChangeLayout: (patch: Partial<DatabaseViewConfig>) => void;
  onToggle: (column: DatabaseColumn) => void;
  onHideAll: () => void;
  onReorder: (orderedColumnIDs: string[]) => void;
  filterQuery: string;
  filterColumns: DatabaseColumn[];
  onAddFilter: () => void;
  onFilterQueryChange: (value: string) => void;
  onPickFilter: (column: DatabaseColumn) => string | void;
  onClearActive: () => void;
  onUpdateFilter: (id: string, patch: Partial<ViewFilterRule>) => void;
  onRemoveFilter: (id: string) => void;
  onMergeFilterToAdvanced: (id: string) => void;
  onUpdateAdvancedFilter: (advancedFilter?: ViewAdvancedFilterGroup) => void;
  onReorderFilters: (sourceID: string, targetID: string) => void;
  style: CSSProperties;
}) {
  const [query, setQuery] = useState('');
  const [nameDraft, setNameDraft] = useState(activeView.name || '视图名称');
  const [iconOpen, setIconOpen] = useState(false);
  const [settingsActiveFilterID, setSettingsActiveFilterID] = useState<string | null>(null);
  const [settingsAdvancedOpen, setSettingsAdvancedOpen] = useState(false);
  const [settingsAddFilterOpen, setSettingsAddFilterOpen] = useState(false);
  const [filterSettingsDragState, setFilterSettingsDragState] = useState<{
    sourceID: string;
    targetID: string;
    sourceIndex: number;
    targetIndex: number;
    initialTop: number;
    currentTop: number;
    itemHeight: number;
    pointerOffset: number;
    minTop: number;
    maxTop: number;
    centers: number[];
  } | null>(null);
  const [dragState, setDragState] = useState<{
    sourceIndex: number;
    targetIndex: number;
    initialTop: number;
    currentTop: number;
    itemHeight: number;
    pointerOffset: number;
    minTop: number;
    maxTop: number;
    centers: number[];
  } | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const iconButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsActiveFilterRef = useRef<HTMLButtonElement | null>(null);
  const settingsAdvancedFilterRef = useRef<HTMLButtonElement | null>(null);
  const settingsAddFilterRef = useRef<HTMLButtonElement | null>(null);
  const filterSettingsDragStateRef = useRef<typeof filterSettingsDragState>(null);
  const dragStateRef = useRef<typeof dragState>(null);
  const suppressSettingsFilterClickRef = useRef(false);
  const suppressVisibilityClickRef = useRef(false);
  const iconPickerRect = useDropdownPosition(iconOpen, iconButtonRef, 408);
  const columnByID = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns]);
  const settingsActiveFilter = (activeView.filters || []).find((filter) => filter.id === settingsActiveFilterID);
  const settingsActiveFilterColumn = settingsActiveFilter ? columnByID.get(settingsActiveFilter.property) : undefined;
  const settingsFilterEditorRect = useDropdownPosition(!!settingsActiveFilter, settingsActiveFilterRef, settingsActiveFilter ? (isDateFilterColumn(settingsActiveFilterColumn) ? 260 : 282) : 282, settingsActiveFilterID || '');
  const settingsAdvancedRect = useDropdownPosition(settingsAdvancedOpen && !!activeView.advancedFilter, settingsAdvancedFilterRef, 0, 'view-settings-advanced-filter');
  const settingsAddFilterRect = useDropdownPosition(settingsAddFilterOpen, settingsAddFilterRef, 260);
  useDropdownOutsideClose(iconOpen, iconButtonRef, () => setIconOpen(false), '.akdb-column-icon-popover');
  const search = query.trim().toLowerCase();
  const visibleSourceIDs = new Set(
    activeView.columns
      .filter((rule) => rule.property && !rule.hidden)
      .map((rule) => rule.property),
  );
  const orderedColumns = useMemo(() => {
    const byID = new Map(columns.map((column) => [column.id, column]));
    const used = new Set<string>();
    const fromView = activeView.columns
      .map((rule) => rule.property ? byID.get(rule.property) : undefined)
      .filter((column): column is DatabaseColumn => {
        if (!column || used.has(column.id)) return false;
        used.add(column.id);
        return true;
      });
    const rest = columns.filter((column) => !used.has(column.id));
    return [...fromView, ...rest];
  }, [activeView.columns, columns]);
  const filteredColumns = orderedColumns.filter((column) => !search || column.name.toLowerCase().includes(search) || column.type.toLowerCase().includes(search));
  const visibleCount = columns.filter((column) => visibleSourceIDs.has(column.id)).length;
  const filterRuleCount = (activeView.filters || []).length + (activeView.advancedFilter ? countAdvancedFilterRules(activeView.advancedFilter) : 0);
  const showDatabaseTitle = activeView.showSourceTitle !== false;
  const showVerticalLines = activeView.showVerticalLines !== false;
  const wrapContent = !!activeView.wrapContent;

  useEffect(() => {
    setNameDraft(activeView.name || '视图名称');
  }, [activeView.id, activeView.name]);

  useEffect(() => {
    if (!focusNameRequest || pane !== 'main') return;
    window.setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 0);
  }, [focusNameRequest, pane]);

  useEffect(() => {
    if (pane !== 'filter') {
      setSettingsActiveFilterID(null);
      setSettingsAdvancedOpen(false);
      setSettingsAddFilterOpen(false);
    }
  }, [pane]);

  const commitName = () => {
    const nextName = nameDraft.trim() || viewName(activeView.type);
    setNameDraft(nextName);
    if (nextName !== activeView.name) onRename(nextName);
  };

  const beginVisibilityDrag = (index: number, event: ReactPointerEvent<HTMLSpanElement>) => {
    if (search) return;
    const row = event.currentTarget.closest('.akdb-column-visibility-item') as HTMLButtonElement | null;
    const list = event.currentTarget.closest('.akdb-column-visibility-list') as HTMLDivElement | null;
    if (!row || !list || filteredColumns.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    suppressVisibilityClickRef.current = true;
    const rows = Array.from(list.querySelectorAll<HTMLButtonElement>('.akdb-column-visibility-item'));
    const listRect = list.getBoundingClientRect();
    const rowRects = rows.map((item) => item.getBoundingClientRect());
    const rowRect = row.getBoundingClientRect();
    const itemHeight = rowRect.height;
    const firstRect = rowRects[0];
    const lastRect = rowRects[rowRects.length - 1];
    const baseState = {
      sourceIndex: index,
      targetIndex: index,
      initialTop: rowRect.top - listRect.top,
      currentTop: rowRect.top - listRect.top,
      itemHeight,
      pointerOffset: event.clientY - rowRect.top,
      minTop: firstRect.top - listRect.top,
      maxTop: lastRect.bottom - listRect.top - itemHeight,
      centers: rowRects.map((rect) => rect.top - listRect.top + rect.height / 2),
    };
    dragStateRef.current = baseState;
    setDragState(baseState);
    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      setDragState((current) => {
        if (!current) return current;
        const currentTop = Math.min(current.maxTop, Math.max(current.minTop, moveEvent.clientY - listRect.top - current.pointerOffset));
        const currentCenter = currentTop + current.itemHeight / 2;
        const targetIndex = current.centers.findIndex((center) => currentCenter <= center);
        const next = {
          ...current,
          currentTop,
          targetIndex: targetIndex === -1 ? current.centers.length - 1 : targetIndex,
        };
        dragStateRef.current = next;
        return next;
      });
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      const finalState = dragStateRef.current;
      dragStateRef.current = null;
      setDragState(null);
      window.setTimeout(() => {
        suppressVisibilityClickRef.current = false;
      }, 0);
      if (!finalState || finalState.sourceIndex === finalState.targetIndex) return;
      const next = [...filteredColumns];
      const [moved] = next.splice(finalState.sourceIndex, 1);
      next.splice(finalState.targetIndex, 0, moved);
      onReorder(next.map((column) => column.id));
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const visibilityDragTransform = (index: number) => {
    const state = dragState;
    if (!state) return undefined;
    if (index === state.sourceIndex) return `translateY(${state.currentTop - state.initialTop}px)`;
    if (state.sourceIndex < state.targetIndex && index > state.sourceIndex && index <= state.targetIndex) return `translateY(${-state.itemHeight}px)`;
    if (state.targetIndex < state.sourceIndex && index >= state.targetIndex && index < state.sourceIndex) return `translateY(${state.itemHeight}px)`;
    return undefined;
  };

  const beginSettingsFilterDrag = (filterID: string, event: ReactPointerEvent<HTMLSpanElement>) => {
    const filters = activeView.filters || [];
    if (event.button !== 0 || filters.length < 2) return;
    const row = event.currentTarget.closest('.akdb-view-settings-filter-row') as HTMLButtonElement | null;
    const list = event.currentTarget.closest('.akdb-view-settings-filter-list') as HTMLDivElement | null;
    if (!row || !list) return;
    event.preventDefault();
    event.stopPropagation();
    suppressSettingsFilterClickRef.current = true;
    setSettingsActiveFilterID(null);
    setSettingsAdvancedOpen(false);
    setSettingsAddFilterOpen(false);
    const rows = Array.from(list.querySelectorAll<HTMLButtonElement>('[data-settings-filter-id]'));
    const sourceIndex = rows.findIndex((item) => item.dataset.settingsFilterId === filterID);
    if (sourceIndex < 0) return;
    const listRect = list.getBoundingClientRect();
    const rowRects = rows.map((item) => item.getBoundingClientRect());
    const rowRect = row.getBoundingClientRect();
    const itemHeight = rowRect.height;
    const firstRect = rowRects[0];
    const lastRect = rowRects[rowRects.length - 1];
    const baseState = {
      sourceID: filterID,
      targetID: filterID,
      sourceIndex,
      targetIndex: sourceIndex,
      initialTop: rowRect.top - listRect.top,
      currentTop: rowRect.top - listRect.top,
      itemHeight,
      pointerOffset: event.clientY - rowRect.top,
      minTop: firstRect.top - listRect.top,
      maxTop: lastRect.bottom - listRect.top - itemHeight,
      centers: rowRects.map((rect) => rect.top - listRect.top + rect.height / 2),
    };
    filterSettingsDragStateRef.current = baseState;
    setFilterSettingsDragState(baseState);
    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      setFilterSettingsDragState((current) => {
        if (!current) return current;
        const currentTop = Math.min(current.maxTop, Math.max(current.minTop, moveEvent.clientY - listRect.top - current.pointerOffset));
        const currentCenter = currentTop + current.itemHeight / 2;
        const targetIndex = current.centers.findIndex((center) => currentCenter <= center);
        const nextTargetIndex = targetIndex === -1 ? current.centers.length - 1 : targetIndex;
        const targetID = rows[nextTargetIndex]?.dataset.settingsFilterId || current.targetID;
        const next = {
          ...current,
          currentTop,
          targetIndex: nextTargetIndex,
          targetID,
        };
        filterSettingsDragStateRef.current = next;
        return next;
      });
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      const finalState = filterSettingsDragStateRef.current;
      filterSettingsDragStateRef.current = null;
      setFilterSettingsDragState(null);
      window.setTimeout(() => {
        suppressSettingsFilterClickRef.current = false;
      }, 0);
      if (!finalState || finalState.sourceID === finalState.targetID) return;
      onReorderFilters(finalState.sourceID, finalState.targetID);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const settingsFilterDragTransform = (filterID: string, index: number) => {
    const state = filterSettingsDragState;
    if (!state) return undefined;
    if (filterID === state.sourceID) return `translateY(${state.currentTop - state.initialTop}px)`;
    if (state.sourceIndex < state.targetIndex && index > state.sourceIndex && index <= state.targetIndex) return `translateY(${-state.itemHeight}px)`;
    if (state.targetIndex < state.sourceIndex && index >= state.targetIndex && index < state.sourceIndex) return `translateY(${state.itemHeight}px)`;
    return undefined;
  };

  if (pane === 'main') {
    return (
      <div className="akdb-view-settings-menu" role="dialog" aria-label="查看设置" style={style}>
        <div className="akdb-view-settings-title">
          <span>查看设置</span>
          <button type="button" aria-label="关闭查看设置" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="akdb-view-settings-name">
          <button
            ref={iconButtonRef}
            type="button"
            className="akdb-view-settings-icon-button"
            aria-label="切换视图图标"
            aria-haspopup="dialog"
            aria-expanded={iconOpen}
            onClick={() => setIconOpen((open) => !open)}
          >
            {activeView.icon ? <ColumnIconGlyph icon={activeView.icon} /> : <ViewTypeIcon type={activeView.type} />}
          </button>
          <input
            ref={nameInputRef}
            value={nameDraft}
            aria-label="视图名称"
            onChange={(event) => setNameDraft(event.currentTarget.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setNameDraft(activeView.name || '视图名称');
                event.currentTarget.blur();
              }
            }}
          />
          <Info size={14} />
        </div>
        {iconOpen && iconPickerRect && createPortal(
          <ColumnIconPopover
            currentIcon={activeView.icon || ''}
            defaultIcon="notion_grid_rectangle_2x2"
            ariaLabel="视图图标"
            style={{ ...iconPickerRect, zIndex: 133 }}
            onPick={(icon) => {
              onChangeIcon(icon);
              setIconOpen(false);
            }}
          />,
          document.body,
        )}
        <div className="akdb-view-settings-section">
          <ViewLayoutSwitch label="显示数据库标题" checked={showDatabaseTitle} onChange={() => onChangeLayout({ showSourceTitle: !showDatabaseTitle })} />
          <SettingsMenuItem icon={<ViewTypeIcon type={activeView.type} />} label="布局" detail={viewName(activeView.type)} onClick={onOpenLayout} />
          <SettingsMenuItem icon={<Eye size={17} />} label="属性是否可见" detail={String(visibleCount)} onClick={onOpenVisibility} />
          <SettingsMenuItem icon={<Filter size={17} />} label="筛选" detail={filterRuleCount ? String(filterRuleCount) : undefined} onClick={onOpenFilter} />
          <SettingsMenuItem icon={<ArrowUpDown size={17} />} label="排序" />
          <SettingsMenuItem icon={<Columns3 size={17} />} label="分组" />
          <SettingsMenuItem icon={<Palette size={17} />} label="条件颜色" />
          <SettingsMenuItem icon={<Link size={17} />} label="拷贝视图链接" trailing={false} />
        </div>
        <div className="akdb-view-settings-section">
          <div className="akdb-view-settings-section-title">数据源设置</div>
          <SettingsMenuItem icon={<Database size={17} />} label="来源" detail={schemaName} disabled />
          <SettingsMenuItem icon={<List size={17} />} label="编辑属性" />
          <SettingsMenuItem icon={<Zap size={17} />} label="自动化" />
          <SettingsMenuItem icon={<MoreHorizontal size={17} />} label="更多设置" />
        </div>
      </div>
    );
  }

  if (pane === 'layout') {
    return (
      <div className="akdb-view-settings-menu akdb-view-layout-menu" role="dialog" aria-label="布局" style={style}>
        <div className="akdb-column-visibility-head">
          <button type="button" aria-label="返回查看设置" onClick={onBack}><ArrowLeft size={17} /></button>
          <span>布局</span>
        </div>
        <div className="akdb-view-layout-grid">
          {databaseViewTypeChoices.map((choice) => {
            const active = activeView.type === choice.type;
            return (
              <button
                key={choice.type}
                type="button"
                className={`akdb-view-layout-card ${active ? 'is-active' : ''}`}
                aria-pressed={active}
                onClick={() => {
                  onChangeType(choice.type);
                }}
              >
                <span className="akdb-view-layout-card-icon">{choice.icon}</span>
                <span>{choice.label}</span>
              </button>
            );
          })}
        </div>
        <div className="akdb-view-layout-options">
          <ViewLayoutSwitch label="显示垂直线" checked={showVerticalLines} onChange={() => onChangeLayout({ showVerticalLines: !showVerticalLines })} />
          <ViewLayoutSwitch label="显示页面图标" checked={activeView.showPageIcon !== false} disabled onChange={() => {}} />
          <ViewLayoutSwitch label="所有内容换行显示" checked={wrapContent} onChange={() => onChangeLayout({ wrapContent: !wrapContent })} />
          <ViewLayoutItem label="打开页面方式" detail="侧边预览" disabled />
          <ViewLayoutNumber label="加载限制" value={activeView.limit || 50} onChange={(limit) => onChangeLayout({ limit })} />
        </div>
      </div>
    );
  }

  if (pane === 'filter') {
    const filters = activeView.filters || [];
    const activeAdvanced = !!activeView.advancedFilter && settingsAdvancedOpen;
    return (
      <div className="akdb-view-settings-menu akdb-view-settings-filter-menu" role="dialog" aria-label="筛选" style={style}>
        <div className="akdb-column-visibility-head akdb-view-settings-filter-head">
          <button type="button" aria-label="返回查看设置" onClick={onBack}><ArrowLeft size={17} /></button>
          <span>筛选</span>
          <button type="button" className="akdb-view-settings-filter-close" aria-label="关闭筛选菜单" onClick={onClose}><X size={15} /></button>
        </div>
        <div className={`akdb-view-settings-filter-list ${filterSettingsDragState ? 'is-filter-dragging' : ''}`}>
          {activeView.advancedFilter && (
            <button
              ref={activeAdvanced ? settingsAdvancedFilterRef : undefined}
              type="button"
              className={`akdb-view-settings-filter-row ${activeAdvanced ? 'is-active' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={activeAdvanced}
              onClick={() => {
                setSettingsAdvancedOpen((open) => !open);
                setSettingsActiveFilterID(null);
                setSettingsAddFilterOpen(false);
                onClearActive();
              }}
            >
              <span className="akdb-view-settings-filter-handle"><GripVertical size={15} /></span>
              <span className="akdb-view-rule-icon"><ListFilter size={14} /></span>
              <span className="akdb-view-settings-filter-label akdb-view-settings-filter-pill is-effective">
                <span>{countAdvancedFilterRules(activeView.advancedFilter)} 条规则</span>
                <ChevronDown size={14} />
              </span>
            </button>
          )}
          {filters.map((filter, index) => {
            const column = columnByID.get(filter.property);
            const valueLabel = filterValueLabel(filter, column);
            const effective = isEffectiveFilter(filter, column);
            const active = settingsActiveFilterID === filter.id;
            return (
              <button
                key={filter.id}
                ref={active ? settingsActiveFilterRef : undefined}
                type="button"
                data-settings-filter-id={filter.id}
                className={`akdb-view-settings-filter-row ${active ? 'is-active' : ''}`}
                style={{
                  transform: settingsFilterDragTransform(filter.id, index),
                  transition: filterSettingsDragState?.sourceID === filter.id ? 'none' : undefined,
                }}
                aria-haspopup="dialog"
                aria-expanded={active}
                onClick={() => {
                  if (suppressSettingsFilterClickRef.current) return;
                  setSettingsActiveFilterID((current) => current === filter.id ? null : filter.id);
                  setSettingsAdvancedOpen(false);
                  setSettingsAddFilterOpen(false);
                  onClearActive();
                }}
              >
                <span
                  className="akdb-view-settings-filter-handle"
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => beginSettingsFilterDrag(filter.id, event)}
                >
                  <GripVertical size={15} />
                </span>
                {!effective && <span className="akdb-view-rule-icon"><ColumnIconGlyph icon={defaultColumnIconID(column)} /></span>}
                <span className={`akdb-view-settings-filter-label ${effective ? 'akdb-view-settings-filter-pill is-effective' : ''}`}>
                  {effective ? (
                    <>
                      <span className="akdb-view-rule-icon"><ColumnIconGlyph icon={defaultColumnIconID(column)} /></span>
                      <span className="akdb-view-rule-field">{column?.name || '属性'}</span>: <span>{valueLabel}</span>
                      <ChevronDown size={14} />
                    </>
                  ) : (
                    column?.name || '属性'
                  )}
                </span>
                {!effective && <ChevronDown size={14} />}
              </button>
            );
          })}
          <button
            ref={settingsAddFilterRef}
            type="button"
            className={`akdb-view-settings-filter-row akdb-view-settings-filter-add ${settingsAddFilterOpen ? 'is-active' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={settingsAddFilterOpen}
            onClick={() => {
              onAddFilter();
              onClearActive();
              setSettingsActiveFilterID(null);
              setSettingsAdvancedOpen(false);
              setSettingsAddFilterOpen((open) => !open);
            }}
          >
            <span className="akdb-view-settings-filter-add-icon"><Plus size={15} /></span>
            <span className="akdb-view-settings-filter-label">添加筛选</span>
          </button>
        </div>
        {settingsAddFilterOpen && settingsAddFilterRect && createPortal(
          <FilterPropertyMenu
            query={filterQuery}
            columns={filterColumns}
            style={{ ...settingsAddFilterRect, zIndex: 100 }}
            compact
            onQueryChange={onFilterQueryChange}
            onPick={(column) => {
              const pickedID = onPickFilter(column);
              if (pickedID) setSettingsActiveFilterID(pickedID);
              setSettingsAddFilterOpen(false);
              setSettingsAdvancedOpen(false);
              onClearActive();
            }}
            footer={<button
              type="button"
              className="akdb-filter-advanced"
              onClick={() => {
                const advancedFilter = activeView.advancedFilter || createAdvancedFilterGroup(columns);
                onUpdateAdvancedFilter(advancedFilter);
                setSettingsAddFilterOpen(false);
                setSettingsActiveFilterID(null);
                setSettingsAdvancedOpen(true);
                onClearActive();
              }}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="akdb-filter-plus"><path d="M10 3.59a.66.66 0 0 1 .66.66v5.09h5.09a.66.66 0 0 1 0 1.32h-5.09v5.09a.66.66 0 0 1-1.32 0v-5.09H4.25a.66.66 0 0 1 0-1.32h5.09V4.25a.66.66 0 0 1 .66-.66"></path></svg>
              <span>{activeView.advancedFilter ? '编辑筛选条件' : '添加高级筛选'}</span>
            </button>}
          />,
          document.body,
        )}
        {settingsActiveFilter && settingsFilterEditorRect && createPortal(
          <FilterRuleEditor
            filter={settingsActiveFilter}
            column={settingsActiveFilterColumn}
            style={{ ...settingsFilterEditorRect, zIndex: 100 }}
            onUpdate={(patch) => onUpdateFilter(settingsActiveFilter.id, patch)}
            onCommit={() => setSettingsActiveFilterID(null)}
            onRemove={() => {
              onRemoveFilter(settingsActiveFilter.id);
              setSettingsActiveFilterID(null);
            }}
            onMergeToAdvanced={() => {
              onMergeFilterToAdvanced(settingsActiveFilter.id);
              setSettingsActiveFilterID(null);
              setSettingsAdvancedOpen(true);
            }}
          />,
          document.body,
        )}
        {activeView.advancedFilter && settingsAdvancedOpen && settingsAdvancedRect && createPortal(
          <AdvancedFilterEditor
            group={activeView.advancedFilter}
            columns={columns}
            style={{ ...settingsAdvancedRect, zIndex: 100 }}
            onChange={onUpdateAdvancedFilter}
            onRemove={() => {
              onUpdateAdvancedFilter(undefined);
              setSettingsAdvancedOpen(false);
            }}
          />,
          document.body,
        )}
      </div>
    );
  }

  return (
    <div className="akdb-view-settings-menu akdb-column-visibility-menu" role="dialog" aria-label="属性可见性" style={style}>
      <div className="akdb-column-visibility-head">
        <button type="button" aria-label="返回查看设置" onClick={onBack}><ArrowLeft size={17} /></button>
        <span>属性可见性</span>
      </div>
      <div className="akdb-column-visibility-search">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="搜索属性..."
        />
      </div>
      <div className="akdb-column-visibility-subhead">
        <span>在表格中显示</span>
        <button type="button" onClick={onHideAll}>全部隐藏</button>
      </div>
      <div className="akdb-column-visibility-list">
        {filteredColumns.length === 0 && <div className="akdb-add-column-empty">没有匹配的字段</div>}
        {filteredColumns.map((column, index) => {
          const visible = visibleSourceIDs.has(column.id);
          return (
            <button
              type="button"
              key={column.id}
              className={`akdb-column-visibility-item ${visible ? 'is-visible' : ''}`}
              style={{
                transform: visibilityDragTransform(index),
                transition: dragState?.sourceIndex === index ? 'none' : undefined,
              }}
              onClick={() => {
                if (suppressVisibilityClickRef.current) return;
                onToggle(column);
              }}
            >
              <span
                className="akdb-column-visibility-handle"
                onPointerDown={(event) => beginVisibilityDrag(index, event)}
                onClick={(event) => event.stopPropagation()}
                aria-label="拖拽调整属性顺序"
              >
                <GripVertical size={15} />
              </span>
              <span className="akdb-add-column-icon">{columnTypeIcon(column)}</span>
              <span className="akdb-column-visibility-name">{column.name}</span>
              <Eye size={15} className="akdb-column-visibility-eye" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SettingsMenuItem({ icon, label, detail, disabled, trailing = true, onClick }: { icon: ReactNode; label: string; detail?: string; disabled?: boolean; trailing?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="akdb-view-settings-item" disabled={disabled} onClick={onClick}>
      <span className="akdb-view-settings-icon">{icon}</span>
      <span className="akdb-view-settings-label">{label}</span>
      {detail && <span className="akdb-view-settings-detail">{detail}</span>}
      {trailing && <ChevronDown size={15} className="akdb-view-settings-chevron" />}
    </button>
  );
}

function ViewLayoutSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button type="button" className="akdb-view-layout-row" role="switch" aria-checked={checked} disabled={disabled} onClick={onChange}>
      <span>{label}</span>
      <span className={`akdb-column-property-switch ${checked ? 'is-active' : ''}`} aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

function ViewLayoutItem({ label, detail, disabled, onClick }: { label: string; detail?: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="akdb-view-layout-row" disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      {detail && <span className="akdb-view-layout-row-detail">{detail}</span>}
      <ChevronDown size={15} />
    </button>
  );
}

function ViewLayoutNumber({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  const commit = () => {
    const next = Math.max(1, Math.min(500, Math.round(Number(draft) || value || 50)));
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <label className="akdb-view-layout-row akdb-view-layout-number">
      <span>{label}</span>
      <input
        value={draft}
        inputMode="numeric"
        aria-label={label}
        onChange={(event) => setDraft(event.currentTarget.value.replace(/[^\d]/g, ''))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function useDropdownPosition(open: boolean, buttonRef: RefObject<HTMLElement>, minWidth = 220, positionKey: unknown = '') {
  const [rect, setRect] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const update = () => {
      const buttonRect = buttonRef.current?.getBoundingClientRect();
      if (!buttonRect) return;
      const viewportPadding = 16;
      const dropdownWidth = Math.max(minWidth, buttonRect.width);
      const maxLeft = Math.max(viewportPadding, window.innerWidth - dropdownWidth - viewportPadding);
      const left = Math.min(Math.max(buttonRect.left, viewportPadding), maxLeft);
      setRect({
        position: 'fixed',
        left,
        top: buttonRect.bottom + 6,
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
  }, [open, buttonRef, minWidth, positionKey]);
  return rect;
}

function useDropdownOutsideClose(open: boolean, buttonRef: RefObject<HTMLElement>, onClose: () => void, menuSelector: string) {
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

function DatabaseEmptyState({
  kind,
  pickerOpen,
  sources,
  newName,
  creating,
  onOpenPicker,
  onNewNameChange,
  onCreate,
  onBind,
  onClosePicker,
}: {
  kind: 'unbound' | 'missing';
  pickerOpen: boolean;
  sources: DatabaseSummary[];
  newName: string;
  creating: boolean;
  onOpenPicker: () => void;
  onNewNameChange: (value: string) => void;
  onCreate: () => void;
  onBind: (db: DatabaseSummary) => void;
  onClosePicker: () => void;
}) {
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const close = (event: globalThis.MouseEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) return;
      onClosePicker();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClosePicker, pickerOpen]);

  return (
    <div className="akdb-table-placeholder">
      <div className="akdb-placeholder-copy">
        <div className="akdb-placeholder-title">{kind === 'missing' ? '源数据已被删除' : '尚未绑定源数据'}</div>
        <div className="akdb-placeholder-desc">绑定已有数据源，或创建一个新的数据源来开始使用数据库视图。</div>
      </div>
      <div className="akdb-placeholder-actions">
        <button className="akdb-dark-action" type="button" onClick={onOpenPicker}>绑定数据源</button>
      </div>
      {pickerOpen && (
        <div className="akdb-picker-panel" ref={pickerRef}>
          <div className="akdb-picker-create">
            <input value={newName} onChange={(e) => onNewNameChange(e.target.value)} placeholder="新数据源名称" />
            <button disabled={creating || !newName.trim()} onClick={onCreate}>创建</button>
          </div>
          <div className="akdb-picker-list">
            {sources.length === 0 ? (
              <div className="akdb-picker-empty">暂无可绑定的数据源</div>
            ) : sources.map((db) => (
              <button key={db.id} type="button" onClick={() => onBind(db)}>{db.icon || '🗃️'} {db.name}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BindColumnsDialog({
  source,
  loading,
  onCancel,
  onBindEmpty,
  onBindAll,
}: {
  source: DatabaseSummary;
  loading: boolean;
  onCancel: () => void;
  onBindEmpty: () => void;
  onBindAll: () => void;
}) {
  return (
    <div className="akdb-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="akdb-bind-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="akdb-bind-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="akdb-bind-dialog-title" id="akdb-bind-dialog-title">绑定数据源</div>
        <div className="akdb-bind-dialog-body">
          <span>是否插入「{source.name}」中的字段？</span>
          <span>不插入时只绑定数据源，当前视图保持为空。</span>
        </div>
        <div className="akdb-bind-dialog-actions">
          <button type="button" className="akdb-dialog-ghost" disabled={loading} onClick={onCancel}>取消</button>
          <button type="button" className="akdb-dialog-secondary" disabled={loading} onClick={onBindEmpty}>不插入</button>
          <button type="button" className="akdb-dialog-primary" disabled={loading} onClick={onBindAll}>
            {loading ? '绑定中...' : '插入'}
          </button>
        </div>
      </div>
    </div>
  );
}

function viewName(type: DatabaseViewType) {
  return ({ table: '表格', board: '看板', timeline: '时间轴', calendar: '日历', list: '列表', gallery: '画廊', chart: '图表', activity: '动态', map: '地图' } as Record<DatabaseViewType, string>)[type];
}

export const DatabaseBlockSpec = createReactBlockSpec(
  {
    type: 'database',
    propSchema: {
      src: { default: '' },
      viewId: { default: '' },
      views: { default: '' },
      title: { default: '数据库' },
      icon: { default: '' },
    },
    content: 'none',
  },
  {
    render: DatabaseBlockComponent,
  }
);
