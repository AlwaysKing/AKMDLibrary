import { forwardRef, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import { createPortal } from 'react-dom';
import { Activity, ArrowLeft, ArrowUpDown, CalendarDays, Check, ChevronDown, Columns3, Copy, Database, Eye, Filter, GripVertical, Image, Info, Link, List, ListFilter, Map as MapIcon, MoreHorizontal, Palette, Pencil, PieChart, Plus, Search, SlidersHorizontal, Table2, Trash2, Workflow, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { databasesApi, type DatabaseColumn, type DatabaseSummary } from '../../api/databases';
import { useSpaceStore } from '../../stores/spaceStore';
import PageIcon from './PageIcon';
import DatabaseRenderer, { ColumnIconGlyph, ColumnIconPopover, defaultColumnIconID, requestDatabaseImmediateSync } from './database/DatabaseRenderer';
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
  const showRuleBar = !!activeView && ((activeView.filters || []).length > 0 || (activeView.sorts || []).length > 0) && !filterBarHidden;
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
  onUpdateSort: (id: string, patch: Partial<ViewSortRule>) => void;
  onRemoveSort: (id: string) => void;
}) {
  const byID = new Map(columns.map((column) => [column.id, column]));
  const activeFilter = (view.filters || []).find((filter) => filter.id === activeFilterId);
  const activeSort = (view.sorts || []).find((sort) => sort.id === activeSortId);
  const activeRuleRef = useRef<HTMLButtonElement | null>(null);
  const addFilterButtonRef = useRef<HTMLButtonElement | null>(null);
  const [addFilterOpen, setAddFilterOpen] = useState(false);
  const editorRect = useDropdownPosition(!!(activeFilter || activeSort), activeRuleRef, activeFilter ? 220 : 200, activeFilterId || activeSortId || '');
  const addFilterMenuRect = useDropdownPosition(addFilterOpen, addFilterButtonRef, 220);
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
      <div className="akdb-view-rule-bar">
        {(view.filters || []).map((filter) => {
          const column = byID.get(filter.property);
          const valueLabel = filterValueLabel(filter, column);
          const effective = isEffectiveFilter(filter, column);
          const active = activeFilterId === filter.id;
          return (
            <button key={filter.id} ref={active ? activeRuleRef : undefined} type="button" className={`akdb-view-rule-pill ${effective ? 'is-effective' : ''} ${active ? 'is-active' : ''}`} onClick={() => onActivateFilter(filter.id)}>
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
  const options = (column?.config?.options || []) as Array<{ id: string; value: string; color?: string }>;
  const selected = Array.isArray(filter.value) ? filter.value.map(String) : String(filter.value || '').split(',').filter(Boolean);
  const operators = filterOperatorsForColumn(column);
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
      {column?.type === 'select' || column?.type === 'status' || column?.type === 'multi_select' ? (
        <div className="akdb-view-rule-options">
          {options.length === 0 && <div className="akdb-filter-empty">暂无选项</div>}
          {options.map((option) => {
            const checked = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                className={`akdb-view-rule-option ${checked ? 'is-active' : ''}`}
                onClick={() => {
                  const next = checked ? selected.filter((id) => id !== option.id) : [...selected, option.id];
                  onUpdate({ value: next });
                }}
              >
                <span className="akdb-view-rule-check">{checked ? '✓' : ''}</span>
                <span className="akdb-view-rule-dot" style={{ background: option.color || '#9b9a97' }} />
                <span>{option.value}</span>
              </button>
            );
          })}
          <button type="button" className="akdb-view-rule-clear" onClick={() => onUpdate({ value: [] })}>清除选择</button>
        </div>
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
  if (column.type === 'select' || column.type === 'status' || column.type === 'multi_select' || column.type === 'checkbox') return 'equals';
  return 'contains';
}

function defaultFilterValue(column: DatabaseColumn) {
  if (column.type === 'select' || column.type === 'status' || column.type === 'multi_select') return [];
  if (column.type === 'checkbox') return true;
  return '';
}

function filterOperatorLabel(filter: ViewFilterRule, column?: DatabaseColumn) {
  if (column?.type === 'checkbox') return filter.value === false ? '未勾选' : '已勾选';
  if (column?.type === 'select' || column?.type === 'status' || column?.type === 'multi_select') return '是';
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
  if (column?.type === 'select' || column?.type === 'status' || column?.type === 'multi_select' || column?.type === 'checkbox') return [{ op: 'equals', label: '是' }];
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
