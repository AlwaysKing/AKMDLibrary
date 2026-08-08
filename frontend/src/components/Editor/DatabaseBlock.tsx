import { forwardRef, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import { createPortal } from 'react-dom';
import { Activity, ArrowLeft, ArrowUpDown, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Columns3, Copy, Database, Eye, Filter, GripVertical, Image, Info, Link, List, ListFilter, Map as MapIcon, MoreHorizontal, Palette, Pencil, PieChart, Plus, Search, SlidersHorizontal, Table2, Trash2, Workflow, X, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { databasesApi, type DatabaseColumn, type DatabaseSummary } from '../../api/databases';
import { useSpaceStore } from '../../stores/spaceStore';
import PageIcon from './PageIcon';
import DatabaseRenderer, { ColumnIconGlyph, ColumnIconPopover, OptionTag, defaultColumnIconID, requestDatabaseImmediateSync } from './database/DatabaseRenderer';
import { defaultView, parseDatabaseMarkdown, serializeDatabaseMarkdown, type DatabaseViewConfig, type DatabaseViewType, type ViewFilterRule, type ViewSortRule } from './database/viewConfig';
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
  const [filterBarHidden, setFilterBarHidden] = useState(false);
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [viewSettingsPane, setViewSettingsPane] = useState<'main' | 'visibility' | 'layout'>('main');
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
  }, '.akdb-view-settings-menu');

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
    return (activeView?.filters || []).some((filter) => isEffectiveFilter(filter, byID.get(filter.property)));
  }, [activeView?.filters, schemaColumns]);
  const hasFilterRules = (activeView?.filters || []).length > 0;
  const showRuleBar = !!activeView && !sourceControlsDisabled && !filterBarHidden;
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
          onBack={() => setViewSettingsPane('main')}
          onRename={(name) => updateView({ ...activeView, name })}
          onChangeIcon={(icon) => updateView({ ...activeView, icon: icon || undefined })}
          onChangeType={(type) => updateView({ ...activeView, type })}
          onChangeLayout={(patch) => updateView({ ...activeView, ...patch })}
          onToggle={toggleSourceColumnVisibility}
          onHideAll={hideAllSourceColumns}
          onReorder={reorderSourceColumns}
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
          {showDatabaseTitle && (
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
          {!showViewTabs && rowSelectionToolbar}
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
          onActivateFilter={(id) => {
            setActiveFilterId((current) => current === id ? null : id);
            setActiveSortId(null);
          }}
          onActivateSort={(id) => {
            setActiveSortId((current) => current === id ? null : id);
            setActiveFilterId(null);
          }}
          onAddFilter={() => {
            setFilterOpen(false);
            setSortOpen(false);
            setFilterQuery('');
          }}
          onFilterQueryChange={setFilterQuery}
          onPickFilter={addFilter}
          onClearActive={() => {
            setActiveFilterId(null);
            setActiveSortId(null);
          }}
          onUpdateFilter={updateFilter}
          onRemoveFilter={removeFilter}
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
  onActivateFilter,
  onActivateSort,
  onAddFilter,
  onFilterQueryChange,
  onPickFilter,
  onClearActive,
  onUpdateFilter,
  onRemoveFilter,
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
  onActivateFilter: (id: string) => void;
  onActivateSort: (id: string) => void;
  onAddFilter: () => void;
  onFilterQueryChange: (value: string) => void;
  onPickFilter: (column: DatabaseColumn) => void;
  onClearActive: () => void;
  onUpdateFilter: (id: string, patch: Partial<ViewFilterRule>) => void;
  onRemoveFilter: (id: string) => void;
  onReorderFilters: (sourceID: string, targetID: string) => void;
  onUpdateSort: (id: string, patch: Partial<ViewSortRule>) => void;
  onRemoveSort: (id: string) => void;
}) {
  const byID = new Map(columns.map((column) => [column.id, column]));
  const activeFilter = (view.filters || []).find((filter) => filter.id === activeFilterId);
  const activeSort = (view.sorts || []).find((sort) => sort.id === activeSortId);
  const ruleBarRef = useRef<HTMLDivElement | null>(null);
  const activeRuleRef = useRef<HTMLButtonElement | null>(null);
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
  const editorRect = useDropdownPosition(!!(activeFilter || activeSort), activeRuleRef, activeFilter ? 282 : 200, activeFilterId || activeSortId || '');
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
    if (!activeFilter && !activeSort) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest('.akdb-view-rule-editor')) return;
      if (target.closest('.akdb-view-rule-pill')) return;
      onClearActive();
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [activeFilter, activeSort, onClearActive]);
  return (
    <div className="akdb-view-rule-shell">
      <div ref={ruleBarRef} className={`akdb-view-rule-bar ${filterDragState ? 'is-filter-dragging' : ''}`}>
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

function FilterRuleEditor({ filter, column, style, onUpdate, onCommit, onRemove }: { filter: ViewFilterRule; column?: DatabaseColumn; style?: CSSProperties; onUpdate: (patch: Partial<ViewFilterRule>) => void; onCommit: () => void; onRemove: () => void }) {
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
    <div className="akdb-view-rule-editor" role="dialog" aria-label="筛选条件" style={style}>
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
                    onUpdate({ op: operator.op });
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
              <button type="button" role="menuitem" disabled>
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
  if (column.type === 'select' || column.type === 'status' || column.type === 'multi_select' || column.type === 'checkbox') return 'equals';
  return 'contains';
}

function defaultFilterValue(column: DatabaseColumn) {
  if (isDateFilterColumn(column)) return 'this_week';
  if (column.type === 'select' || column.type === 'status' || column.type === 'multi_select') return [];
  if (column.type === 'checkbox') return true;
  return '';
}

function filterOperatorLabel(filter: ViewFilterRule, column?: DatabaseColumn) {
  if (column?.type === 'checkbox') return filter.value === false ? '未勾选' : '已勾选';
  if (filter.op === 'relative_to_today') return '相对于今天';
  if (filter.op === 'equals') return '是';
  if (filter.op === 'not_equals') return '不是';
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
  if (column?.type === 'checkbox') return [{ op: 'equals', label: '是' }];
  if (isDateFilterColumn(column)) return [
    { op: 'relative_to_today', label: '相对于今天' },
    { op: 'equals', label: '是' },
    { op: 'not_equals', label: '不是' },
    { op: 'is_empty', label: '为空白' },
    { op: 'is_not_empty', label: '不为空白' },
  ];
  if (column?.type === 'select' || column?.type === 'status' || column?.type === 'multi_select') return [
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

function DateFilterEditor({ filter, onUpdate }: { filter: ViewFilterRule; onUpdate: (patch: Partial<ViewFilterRule>) => void }) {
  const [prefixOpen, setPrefixOpen] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const prefixRef = useRef<HTMLButtonElement | null>(null);
  const unitRef = useRef<HTMLButtonElement | null>(null);
  const prefixRect = useDropdownPosition(prefixOpen, prefixRef, 108);
  const unitRect = useDropdownPosition(unitOpen, unitRef, 108);
  const relative = parseDateRelativeValue(String(filter.value || 'this_week'));
  const range = dateRelativeRange(relative.prefix, relative.unit);
  const [viewMonth, setViewMonth] = useState(() => new Date(range.start.getFullYear(), range.start.getMonth(), 1));
  useDropdownOutsideClose(prefixOpen, prefixRef, () => setPrefixOpen(false), '.akdb-view-rule-dropdown-menu');
  useDropdownOutsideClose(unitOpen, unitRef, () => setUnitOpen(false), '.akdb-view-rule-dropdown-menu');
  useEffect(() => {
    setViewMonth(new Date(range.start.getFullYear(), range.start.getMonth(), 1));
  }, [filter.value]);
  const days = calendarDaysForMonth(viewMonth);
  const today = startOfLocalDay(new Date());
  const updateRelative = (patch: Partial<DateRelativeValue>) => {
    const next = { ...relative, ...patch };
    onUpdate({ op: 'relative_to_today', value: `${next.prefix}_${next.unit}` });
  };
  if (filter.op !== 'relative_to_today') {
    return (
      <input
        autoFocus
        className="akdb-view-rule-input"
        value={String(filter.value || '')}
        onChange={(event) => onUpdate({ value: event.currentTarget.value })}
        placeholder="输入日期..."
      />
    );
  }
  return (
    <div className="akdb-date-filter-panel">
      <div className="akdb-date-filter-controls">
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
      </div>
      <div className="akdb-date-filter-calendar">
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
            const inRange = day.date >= range.start && day.date <= range.end;
            const isStart = isSameLocalDate(day.date, range.start);
            const isEnd = isSameLocalDate(day.date, range.end);
            const isToday = isSameLocalDate(day.date, today);
            return (
              <span key={day.key} className={[!currentMonth ? 'is-muted' : '', inRange ? 'is-in-range' : '', isStart ? 'is-range-start' : '', isEnd ? 'is-range-end' : '', isToday ? 'is-today' : ''].filter(Boolean).join(' ')}>
                {day.date.getDate()}
              </span>
            );
          })}
        </div>
      </div>
      <div className="akdb-date-filter-help">筛选将根据当前日期更新</div>
    </div>
  );
}

type DateRelativePrefix = 'this' | 'last' | 'next';
type DateRelativeUnit = 'day' | 'week' | 'month' | 'year';
type DateRelativeValue = { prefix: DateRelativePrefix; unit: DateRelativeUnit };

const dateRelativePrefixChoices: Array<{ id: DateRelativePrefix; label: string }> = [
  { id: 'this', label: '本' },
  { id: 'last', label: '上' },
  { id: 'next', label: '下' },
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
  const [prefix, unit] = value.split('_');
  return {
    prefix: prefix === 'last' || prefix === 'next' ? prefix : 'this',
    unit: unit === 'day' || unit === 'month' || unit === 'year' ? unit : 'week',
  };
}

function dateRelativeLabel(value: string) {
  const parsed = parseDateRelativeValue(value);
  const prefix = dateRelativePrefixChoices.find((choice) => choice.id === parsed.prefix)?.label || '本';
  const unit = dateRelativeUnitChoices.find((choice) => choice.id === parsed.unit)?.label || '周';
  return `${prefix}${unit}`;
}

function dateRelativeRange(prefix: DateRelativePrefix, unit: DateRelativeUnit) {
  const today = startOfLocalDay(new Date());
  let start = today;
  let end = today;
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

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
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
  onBack,
  onRename,
  onChangeIcon,
  onChangeType,
  onChangeLayout,
  onToggle,
  onHideAll,
  onReorder,
  style,
}: {
  schemaName: string;
  columns: DatabaseColumn[];
  activeView: DatabaseViewConfig;
  pane: 'main' | 'visibility' | 'layout';
  focusNameRequest: number;
  onOpenLayout: () => void;
  onOpenVisibility: () => void;
  onBack: () => void;
  onRename: (name: string) => void;
  onChangeIcon: (icon: string) => void;
  onChangeType: (type: DatabaseViewType) => void;
  onChangeLayout: (patch: Partial<DatabaseViewConfig>) => void;
  onToggle: (column: DatabaseColumn) => void;
  onHideAll: () => void;
  onReorder: (orderedColumnIDs: string[]) => void;
  style: CSSProperties;
}) {
  const [query, setQuery] = useState('');
  const [nameDraft, setNameDraft] = useState(activeView.name || '视图名称');
  const [iconOpen, setIconOpen] = useState(false);
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
  const dragStateRef = useRef<typeof dragState>(null);
  const suppressVisibilityClickRef = useRef(false);
  const iconPickerRect = useDropdownPosition(iconOpen, iconButtonRef, 408);
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

  if (pane === 'main') {
    return (
      <div className="akdb-view-settings-menu" role="dialog" aria-label="查看设置" style={style}>
        <div className="akdb-view-settings-title">查看设置</div>
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
          <SettingsMenuItem icon={<Filter size={17} />} label="筛选" />
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
