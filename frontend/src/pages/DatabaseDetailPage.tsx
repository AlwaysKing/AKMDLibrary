import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react';
import { databasesApi, type DatabaseColumn, type DatabaseColumnType, type DatabaseDetail, type DatabaseSummary } from '../api/databases';
import DatabaseRenderer, { ColumnIconGlyph, ColumnIconPopover } from '../components/Editor/database/DatabaseRenderer';
import { defaultView } from '../components/Editor/database/viewConfig';

type DraftColumnType = DatabaseColumnType | 'secret';

const columnTypes: DraftColumnType[] = ['text', 'secret', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'status', 'formula', 'relation'];
const columnTypeLabels: Record<DraftColumnType, string> = {
  text: '文本',
  secret: '密文',
  number: '数字',
  select: '单选',
  multi_select: '多选',
  date: '日期',
  checkbox: '复选框',
  url: '链接',
  status: '状态',
  formula: '公式',
  relation: '关联',
  created_time: '创建时间',
  last_edited_time: '最后编辑时间',
  last_edited_user: '最后编辑人',
  linked: '反向关联',
};
const optionColors = [
  { id: 'gray', name: '灰色', bg: '#f1f1ef', fg: '#5f5e5b', border: '#d9d9d6' },
  { id: 'blue', name: '蓝色', bg: '#e7f3ff', fg: '#0f5ca8', border: '#b8d8f4' },
  { id: 'green', name: '绿色', bg: '#e6f4ea', fg: '#1f7a3a', border: '#b9dfc4' },
  { id: 'yellow', name: '黄色', bg: '#fff4d6', fg: '#8a5a00', border: '#ead58f' },
  { id: 'red', name: '红色', bg: '#ffe8e8', fg: '#b42318', border: '#f0b8b8' },
  { id: 'purple', name: '紫色', bg: '#f0e7ff', fg: '#6b3fb7', border: '#d3bff4' },
  { id: 'pink', name: '粉色', bg: '#ffe8f3', fg: '#a8326f', border: '#efbad3' },
  { id: 'orange', name: '橙色', bg: '#ffeedd', fg: '#a84f00', border: '#efc59e' },
];
function displayColumnType(column: DatabaseColumn): DraftColumnType {
  return column.type === 'text' && column.config?.secret ? 'secret' : column.type;
}

function persistColumnType(type: DraftColumnType): DatabaseColumnType {
  return type === 'secret' ? 'text' : type;
}

function displayColumnTypeLabel(column: DatabaseColumn) {
  return columnTypeLabels[displayColumnType(column)] || column.type;
}

export default function DatabaseDetailPage() {
  const { spaceSlug, dbId } = useParams<{ spaceSlug: string; dbId: string }>();
  const navigate = useNavigate();
  const [db, setDb] = useState<DatabaseDetail | null>(null);
  const [sources, setSources] = useState<DatabaseSummary[]>([]);
  const [tab, setTab] = useState<'data' | 'schema' | 'relations'>('data');
  const [jsonText, setJsonText] = useState('');
  const [definitionMode, setDefinitionMode] = useState<'visual' | 'source'>('visual');
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [creatingColumn, setCreatingColumn] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftType, setDraftType] = useState<DraftColumnType>('text');
  const [draftConfig, setDraftConfig] = useState<Record<string, any>>({});
  const [savingColumn, setSavingColumn] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [columnDeleteTarget, setColumnDeleteTarget] = useState<DatabaseColumn | null>(null);
  const [deletingColumn, setDeletingColumn] = useState(false);
  const view = useMemo(() => db ? defaultView(db.columns) : undefined, [db]);
  const selectedColumn = useMemo(
    () => editingColId && db ? db.columns.find((column) => column.id === editingColId) || null : null,
    [db, editingColId],
  );

  const refresh = async () => {
    if (!spaceSlug || !dbId) return;
    const [detail, allSources] = await Promise.all([
      databasesApi.get(spaceSlug, dbId),
      databasesApi.list(spaceSlug),
    ]);
    setDb(detail);
    setSources(allSources);
    setJsonText(JSON.stringify(detail.columns, null, 2));
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [spaceSlug, dbId]);

  const deleteColumn = async (colId: string) => {
    if (!spaceSlug || !dbId) return;
    setDeletingColumn(true);
    try {
      await databasesApi.deleteColumn(spaceSlug, dbId, colId);
      if (editingColId === colId) setEditingColId(null);
      setColumnDeleteTarget(null);
      await refresh();
    } finally {
      setDeletingColumn(false);
    }
  };

  const startEditColumn = (column: DatabaseColumn) => {
    if (column.readonly) return;
    setCreatingColumn(false);
    setEditingColId(column.id);
    setDraftName(column.name);
    setDraftType(displayColumnType(column));
    setDraftConfig(normalizeColumnConfig(column));
  };

  const startCreateColumn = () => {
    setCreatingColumn(true);
    setEditingColId(null);
    setDraftName('');
    setDraftType('text');
    setDraftConfig(defaultConfig('text'));
  };

  const createColumn = async () => {
    if (!spaceSlug || !dbId || !draftName.trim()) return;
    setSavingColumn(true);
    try {
      const nextDb = await databasesApi.addColumn(spaceSlug, dbId, {
        name: draftName.trim(),
        type: persistColumnType(draftType),
        config: draftConfig,
      });
      setDb(nextDb);
      setJsonText(JSON.stringify(nextDb.columns, null, 2));
      const created = [...nextDb.columns].reverse().find((column) => column.name === draftName.trim() && !column.readonly);
      setCreatingColumn(false);
      setEditingColId(created?.id || null);
    } finally {
      setSavingColumn(false);
    }
  };

  const saveColumn = async (column: DatabaseColumn) => {
    if (!spaceSlug || !dbId || !draftName.trim()) return;
    setSavingColumn(true);
    try {
      await databasesApi.updateColumn(spaceSlug, dbId, column.id, {
        name: draftName.trim(),
        type: persistColumnType(draftType),
        config: draftConfig,
      });
      await refresh();
    } finally {
      setSavingColumn(false);
    }
  };

  useEffect(() => {
    if (creatingColumn) return;
    if (!selectedColumn || selectedColumn.readonly || savingColumn) return;
    const nextType = persistColumnType(draftType);
    const sameName = selectedColumn.name === draftName.trim();
    const sameType = selectedColumn.type === nextType;
    const sameConfig = JSON.stringify(normalizeColumnConfig(selectedColumn)) === JSON.stringify(draftConfig);
    if (!draftName.trim() || (sameName && sameType && sameConfig)) return;
    const timer = window.setTimeout(() => { saveColumn(selectedColumn); }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatingColumn, draftName, draftType, draftConfig, selectedColumn?.id, savingColumn]);

  const closeDeleteDialog = () => {
    if (deleting) return;
    setDeleteOpen(false);
    setDeleteName('');
    setDeleteError(null);
  };

  const confirmDeleteDatabase = async () => {
    if (!spaceSlug || !dbId || !db || deleteName !== db.name) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await databasesApi.delete(spaceSlug, dbId);
      navigate(`/s/${spaceSlug}/databases`, { replace: true });
    } catch (err: any) {
      setDeleteError(err?.response?.data || err?.message || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  if (!db) return <div className="flex-1 p-8 text-notion-textSecondary">加载中...</div>;
  const newColumnDraft: DatabaseColumn = { id: '__new__', name: draftName, type: persistColumnType(draftType), config: draftConfig };

  return (
    <div className="flex-1 overflow-auto bg-notion-bg">
      <div className="max-w-6xl mx-auto px-8 py-6">
        <button className="flex items-center gap-1 text-sm text-notion-textSecondary hover:text-notion-text mb-4" onClick={() => navigate(`/s/${spaceSlug}/databases`)}><ArrowLeft size={15} />返回</button>
        <div className="flex items-center justify-between mb-5">
          <div><h1 className="text-2xl font-semibold text-notion-text">{db.icon || '🗃️'} {db.name}</h1><p className="text-sm text-notion-textSecondary">{db.description || '无描述'}</p></div>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="inline-flex items-center justify-center w-8 h-8 rounded hover:bg-red-50 text-red-600 transition-colors"
            title="删除数据源"
          >
            <Trash2 size={17} />
          </button>
        </div>
        <div className="flex gap-1 border-b border-notion-border mb-4">
          {(['data', 'schema', 'relations'] as const).map((t) => <button key={t} className={`px-3 py-2 text-sm ${tab === t ? 'border-b-2 border-notion-text text-notion-text' : 'text-notion-textSecondary'}`} onClick={() => setTab(t)}>{t === 'data' ? '数据' : t === 'schema' ? '定义' : '关联'}</button>)}
        </div>
        {tab === 'data' && spaceSlug && dbId && <DatabaseRenderer spaceSlug={spaceSlug} dbId={dbId} view={view} columnControls={false} onOpenRow={(rowId) => navigate(`/s/${spaceSlug}/db/${dbId}/row/${rowId}`)} />}
        {tab === 'schema' && (
          <div className="border border-notion-border rounded-md bg-white overflow-hidden">
            <div className="px-3 py-2 border-b border-notion-border text-sm font-medium flex items-center justify-between">
              <span>列定义</span>
              <div className="inline-flex rounded border border-notion-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setDefinitionMode('visual')}
                  className={`px-2.5 py-1 text-xs ${definitionMode === 'visual' ? 'bg-notion-hover text-notion-text' : 'text-notion-textSecondary hover:bg-notion-hover'}`}
                >
                  可视化
                </button>
                <button
                  type="button"
                  onClick={() => setDefinitionMode('source')}
                  className={`px-2.5 py-1 text-xs border-l border-notion-border ${definitionMode === 'source' ? 'bg-notion-hover text-notion-text' : 'text-notion-textSecondary hover:bg-notion-hover'}`}
                >
                  源码
                </button>
              </div>
            </div>
            {definitionMode === 'visual' ? (
              <div className="grid h-[calc(100vh-310px)] min-h-[360px] grid-cols-1 overflow-hidden lg:grid-cols-[minmax(240px,280px)_1fr]">
                <div className="min-h-0 overflow-y-auto border-r border-notion-border bg-white">
                  <div className="px-3 py-2 border-b border-notion-border text-xs font-medium text-notion-textSecondary">字段</div>
                  <div className="divide-y divide-notion-border">
                    {db.columns.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => startEditColumn(c)}
                        className={`w-full grid grid-cols-[1fr_auto] gap-2 px-3 py-2.5 text-left transition-colors ${editingColId === c.id ? 'bg-notion-hover' : 'hover:bg-notion-hover'} ${c.readonly ? 'opacity-70' : ''}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-notion-text">{c.name}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="rounded bg-[#f1f1ef] px-2 py-0.5 text-xs text-notion-textSecondary">{displayColumnTypeLabel(c)}</span>
                          {c.readonly && <span className="text-xs text-notion-textSecondary">只读</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-notion-border p-3">
                    <button
                      type="button"
                      onClick={startCreateColumn}
                      className={`inline-flex w-full items-center justify-center gap-1 px-3 py-1.5 rounded text-sm transition-colors ${creatingColumn ? 'bg-notion-text text-white' : 'text-notion-text hover:bg-notion-hover'}`}
                    >
                      <Plus size={14} />新增字段
                    </button>
                  </div>
                </div>
                <div className="min-h-0 bg-white">
                  {creatingColumn ? (
                      <ColumnEditor
                        column={newColumnDraft}
                        mode="create"
                        draftName={draftName}
                        setDraftName={setDraftName}
                        draftType={draftType}
                        setDraftType={setDraftType}
                        draftConfig={draftConfig}
                        setDraftConfig={setDraftConfig}
                        sources={sources.filter((source) => source.id !== db.id)}
                        saving={savingColumn}
                        onCreate={createColumn}
                      />
                  ) : selectedColumn && !selectedColumn.readonly ? (
                      <ColumnEditor
                        column={selectedColumn}
                        mode="edit"
                        draftName={draftName}
                        setDraftName={setDraftName}
                        draftType={draftType}
                        setDraftType={setDraftType}
                        draftConfig={draftConfig}
                        setDraftConfig={setDraftConfig}
                        sources={sources.filter((source) => source.id !== db.id)}
                        saving={savingColumn}
                        onDelete={() => setColumnDeleteTarget(selectedColumn)}
                      />
                  ) : (
                    <div className="flex h-full min-h-[420px] items-center justify-center p-8 text-center">
                      <div>
                        <p className="text-sm font-medium text-notion-text">选择一个可编辑字段</p>
                        <p className="mt-1 text-sm text-notion-textSecondary">在左侧选择字段后，可编辑名称、类型和类型配置。</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <textarea className="w-full min-h-[520px] p-3 font-mono text-xs outline-none" value={jsonText} onChange={(e) => setJsonText(e.target.value)} readOnly />
            )}
          </div>
        )}
        {tab === 'relations' && (
          <div className="border border-notion-border rounded-md bg-white p-4 text-sm">
            {db.columns.filter((c) => c.type === 'relation' || c.type === 'linked').length === 0 ? <p className="text-notion-textSecondary">暂无关联列</p> : db.columns.filter((c) => c.type === 'relation' || c.type === 'linked').map((c) => <div key={c.id} className="py-2 border-b border-notion-border"><b>{c.name}</b><span className="ml-2 text-notion-textSecondary">{c.type}</span><pre className="mt-1 text-xs bg-notion-hover p-2 rounded overflow-auto">{JSON.stringify(c.config || {}, null, 2)}</pre></div>)}
          </div>
        )}
      </div>
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="w-[420px] max-w-[calc(100vw-32px)] rounded-md border border-notion-border bg-white shadow-xl">
            <div className="px-4 py-3 border-b border-notion-border">
              <h2 className="text-base font-semibold text-notion-text">删除数据源</h2>
            </div>
            <div className="px-4 py-4 space-y-3">
              <p className="text-sm text-notion-textSecondary">
                此操作会删除数据源 <span className="font-medium text-notion-text">{db.name}</span> 的配置、所有行数据和行正文，删除后无法在应用内恢复。
              </p>
              <label className="block text-sm text-notion-text">
                请输入数据源名称以确认删除
                <input
                  className="mt-2 w-full border border-notion-border rounded px-3 py-2 text-sm outline-none focus:border-notion-text"
                  value={deleteName}
                  onChange={(e) => setDeleteName(e.target.value)}
                  placeholder={db.name}
                  autoFocus
                />
              </label>
              {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
            </div>
            <div className="px-4 py-3 border-t border-notion-border flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded text-sm text-notion-text hover:bg-notion-hover"
                onClick={closeDeleteDialog}
                disabled={deleting}
              >
                取消
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded text-sm bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={confirmDeleteDatabase}
                disabled={deleting || deleteName !== db.name}
              >
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
      {columnDeleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="w-[360px] max-w-[calc(100vw-32px)] rounded-md border border-notion-border bg-white shadow-xl">
            <div className="px-4 py-3 border-b border-notion-border">
              <h2 className="text-base font-semibold text-notion-text">删除字段</h2>
            </div>
            <div className="px-4 py-4">
              <p className="text-sm text-notion-textSecondary">
                确认删除字段 <span className="font-medium text-notion-text">{columnDeleteTarget.name}</span> 吗？该字段对应的数据也会被移除。
              </p>
            </div>
            <div className="px-4 py-3 border-t border-notion-border flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded text-sm text-notion-text hover:bg-notion-hover"
                onClick={() => setColumnDeleteTarget(null)}
                disabled={deletingColumn}
              >
                取消
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded text-sm bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => deleteColumn(columnDeleteTarget.id)}
                disabled={deletingColumn}
              >
                {deletingColumn ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function defaultConfig(type: DraftColumnType) {
  if (type === 'text') return { max_length: 0, secret: false };
  if (type === 'secret') return { max_length: 0, secret: true };
  if (type === 'select' || type === 'multi_select') return { options: [] };
  if (type === 'status') return { groups: [], options: [] };
  if (type === 'number') return { sign_mode: 'both', precision: -1, unit: '', min: '', max: '' };
  if (type === 'date') return { date_format: 'chinese', time_format: 'none', timezone: 'GMT+8', date_content: 'date', include_time: false, hour12: false };
  if (type === 'formula') return { formula: '""' };
  if (type === 'relation') return { target_db_id: '', target_db_name: '', multi: true };
  return {};
}

function normalizeColumnConfig(column: DatabaseColumn) {
  return { ...defaultConfig(column.type), ...(column.config || {}) };
}

type DropdownOption = { value: string | number; label: string };

function CustomSelect({
  value,
  options,
  onChange,
  placeholder = '请选择',
  compact = false,
  disabled = false,
}: {
  value: string | number;
  options: DropdownOption[];
  onChange: (value: string | number) => void;
  placeholder?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuStyle = useMetadataDropdownPosition(open, buttonRef);
  useMetadataDropdownOutsideClose(open, buttonRef, menuRef, () => setOpen(false));
  const selected = options.find((option) => option.value === value);

  return (
    <div className={`relative ${compact ? '' : 'mt-1'}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setOpen((next) => !next)}
        className="flex w-full items-center justify-between gap-2 rounded border border-notion-border bg-white px-2 py-1.5 text-left text-sm text-notion-text outline-none transition-colors hover:bg-notion-hover focus:border-notion-text disabled:cursor-not-allowed disabled:bg-notion-bg disabled:text-notion-textSecondary disabled:hover:bg-notion-bg"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected ? 'truncate' : 'truncate text-notion-textSecondary'}>{selected?.label || placeholder}</span>
        <ChevronDown size={15} className={`shrink-0 text-notion-textSecondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && !disabled && menuStyle && createPortal(
        <div
          ref={menuRef}
          className="z-[80] max-h-64 overflow-y-auto rounded-md border border-notion-border bg-white p-1 shadow-lg"
          style={menuStyle}
          role="listbox"
          tabIndex={-1}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${active ? 'bg-notion-hover text-notion-text' : 'text-notion-text hover:bg-notion-hover'}`}
              >
                <span className="flex w-4 shrink-0 justify-center">{active && <Check size={14} />}</span>
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

function useMetadataDropdownPosition(open: boolean, anchorRef: React.RefObject<HTMLElement>, minWidth?: number) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setStyle(null);
      return;
    }
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 8;
      const width = Math.max(minWidth || rect.width, rect.width);
      const left = Math.min(Math.max(rect.left, viewportPadding), Math.max(viewportPadding, window.innerWidth - width - viewportPadding));
      const maxTop = Math.max(viewportPadding, window.innerHeight - 260 - viewportPadding);
      setStyle({
        position: 'fixed',
        left,
        top: Math.min(rect.bottom + 4, maxTop),
        width,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, anchorRef, minWidth]);
  return style;
}

function useMetadataDropdownOutsideClose(
  open: boolean,
  anchorRef: React.RefObject<HTMLElement>,
  menuRef: React.RefObject<HTMLElement> | null,
  onClose: () => void,
  ignoreSelector?: string,
) {
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (
          anchorRef.current?.contains(target) ||
          menuRef?.current?.contains(target) ||
          (ignoreSelector && target instanceof Element && target.closest(ignoreSelector))
        )
      ) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, anchorRef, menuRef, onClose, ignoreSelector]);
}

function ColumnEditor({
  column,
  mode,
  draftName,
  setDraftName,
  draftType,
  setDraftType,
  draftConfig,
  setDraftConfig,
  sources,
  saving,
  onCreate,
  onDelete,
}: {
  column: DatabaseColumn;
  mode: 'create' | 'edit';
  draftName: string;
  setDraftName: (value: string) => void;
  draftType: DraftColumnType;
  setDraftType: (value: DraftColumnType) => void;
  draftConfig: Record<string, any>;
  setDraftConfig: (value: Record<string, any>) => void;
  sources: DatabaseSummary[];
  saving: boolean;
  onCreate?: () => void;
  onDelete?: () => void;
}) {
  const patchConfig = (patch: Record<string, any>) => setDraftConfig({ ...draftConfig, ...patch });
  const draftColumn = { ...column, type: persistColumnType(draftType), config: draftConfig };
  const changeType = (nextType: DraftColumnType) => {
    setDraftType(nextType);
    setDraftConfig(defaultConfig(nextType));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
        <section className="space-y-3 border-b border-notion-border pb-6">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-notion-text">基础信息</h4>
            {mode === 'create' && onCreate ? (
              <button
                type="button"
                onClick={onCreate}
                className="inline-flex items-center gap-1 rounded bg-notion-text px-2.5 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={saving || !draftName.trim()}
              >
                <Check size={14} />创建
              </button>
            ) : mode === 'edit' && onDelete && (
              <button type="button" onClick={onDelete} className="inline-flex h-8 w-8 items-center justify-center rounded text-red-600 hover:bg-red-50" disabled={saving} title="删除字段" aria-label="删除字段">
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-notion-textSecondary">
              字段名称
              <input
                className="mt-1 w-full border border-notion-border rounded px-2 py-1.5 text-sm bg-white text-notion-text outline-none focus:border-notion-text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
              />
            </label>
            <label className="text-xs text-notion-textSecondary">
              字段类型
              <CustomSelect
                value={draftType}
                options={columnTypes.map((type) => ({ value: type, label: columnTypeLabels[type] }))}
                onChange={(value) => changeType(value as DraftColumnType)}
              />
            </label>
          </div>
        </section>

        <ColumnConfigEditor
          column={draftColumn}
          config={draftConfig}
          setConfig={setDraftConfig}
          patchConfig={patchConfig}
          sources={sources}
        />
      </div>
    </div>
  );
}

function ColumnConfigEditor({
  column,
  config,
  setConfig,
  patchConfig,
  sources,
}: {
  column: DatabaseColumn;
  config: Record<string, any>;
  setConfig: (value: Record<string, any>) => void;
  patchConfig: (patch: Record<string, any>) => void;
  sources: DatabaseSummary[];
}) {
  if (column.type === 'select' || column.type === 'multi_select') {
    return <OptionsEditor config={config} setConfig={setConfig} defaultShape="plain" />;
  }
  if (column.type === 'status') {
    return <StatusEditor config={config} setConfig={setConfig} />;
  }
  if (column.type === 'text') {
    return (
      <ConfigSection title={config.secret ? '密文设置' : '文本设置'}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs text-notion-textSecondary">
            最大长度（0 表示不限）
            <input
              type="number"
              min={0}
              className="mt-1 w-full border border-notion-border rounded px-2 py-1.5 text-sm bg-white text-notion-text outline-none focus:border-notion-text"
              value={config.max_length ?? 0}
              onChange={(e) => patchConfig({ max_length: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
        </div>
      </ConfigSection>
    );
  }
  if (column.type === 'number') {
    return (
      <ConfigSection title="数字设置">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs text-notion-textSecondary">
            正负规则
            <CustomSelect
              value={config.sign_mode || 'both'}
              options={[
                { value: 'both', label: '正负均可' },
                { value: 'non_negative', label: '不允许负数' },
                { value: 'positive', label: '仅正数' },
                { value: 'negative', label: '仅负数' },
              ]}
              onChange={(value) => patchConfig({ sign_mode: value })}
            />
          </label>
          <label className="text-xs text-notion-textSecondary">
            小数位数
            <CustomSelect
              value={config.precision ?? -1}
              options={[
                { value: -1, label: '不限' },
                { value: 0, label: '整数' },
                { value: 1, label: '1 位' },
                { value: 2, label: '2 位' },
                { value: 3, label: '3 位' },
                { value: 4, label: '4 位' },
                { value: 5, label: '5 位' },
                { value: 6, label: '6 位' },
              ]}
              onChange={(value) => patchConfig({ precision: Number(value) })}
            />
          </label>
          <label className="text-xs text-notion-textSecondary">
            单位
            <input
              className="mt-1 w-full border border-notion-border rounded px-2 py-1.5 text-sm bg-white text-notion-text outline-none focus:border-notion-text"
              value={config.unit || ''}
              onChange={(e) => patchConfig({ unit: e.target.value })}
              placeholder="例如：元、kg、%"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-notion-textSecondary">
              最小值
              <input
                type="number"
                className="mt-1 w-full border border-notion-border rounded px-2 py-1.5 text-sm bg-white text-notion-text outline-none focus:border-notion-text"
                value={config.min ?? ''}
                onChange={(e) => patchConfig({ min: e.target.value })}
                placeholder="不限"
              />
            </label>
            <label className="text-xs text-notion-textSecondary">
              最大值
              <input
                type="number"
                className="mt-1 w-full border border-notion-border rounded px-2 py-1.5 text-sm bg-white text-notion-text outline-none focus:border-notion-text"
                value={config.max ?? ''}
                onChange={(e) => patchConfig({ max: e.target.value })}
                placeholder="不限"
              />
            </label>
          </div>
        </div>
      </ConfigSection>
    );
  }
  if (column.type === 'date') {
    return (
      <ConfigSection title="日期格式">
        <label className="inline-flex items-center gap-2 text-sm text-notion-text">
          <input
            type="checkbox"
            checked={!!config.include_time}
            onChange={(e) => patchConfig({ include_time: e.target.checked })}
          />
          包含时间
        </label>
      </ConfigSection>
    );
  }
  if (column.type === 'formula') {
    return (
      <ConfigSection title="公式设置">
        <label className="text-xs text-notion-textSecondary">
          公式表达式
          <textarea
            className="mt-1 min-h-[120px] w-full resize-y rounded border border-notion-border bg-white px-2 py-1.5 font-mono text-sm text-notion-text outline-none focus:border-notion-text"
            value={config.formula ?? ''}
            onChange={(e) => patchConfig({ formula: e.target.value })}
            placeholder={'例如：prop("数量") * prop("单价")'}
          />
        </label>
        <p className="text-xs text-notion-textSecondary">
          公式结果只在显示时计算，不写入 data.csv。
        </p>
      </ConfigSection>
    );
  }
  if (column.type === 'relation') {
    return (
      <ConfigSection title="关联设置">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs text-notion-textSecondary">
            目标数据源
            <CustomSelect
              value={config.target_db_id || ''}
              options={[
                { value: '', label: '请选择' },
                ...sources.map((source) => ({ value: source.id, label: `${source.icon || '🗃️'} ${source.name}` })),
              ]}
              placeholder="请选择"
              onChange={(value) => {
                const target = sources.find((source) => source.id === value);
                patchConfig({ target_db_id: target?.id || '', target_db_name: target?.name || '' });
              }}
            />
          </label>
          <label className="inline-flex items-end gap-2 text-sm text-notion-text pb-1">
            <input
              type="checkbox"
              checked={config.multi !== false}
              onChange={(e) => patchConfig({ multi: e.target.checked })}
            />
            允许多选
          </label>
        </div>
      </ConfigSection>
    );
  }
  return <ConfigSection title="类型配置"><p className="text-xs text-notion-textSecondary">该类型没有额外配置。</p></ConfigSection>;
}

function ConfigSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-notion-border pb-6">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-notion-text">{title}</h4>
        {action}
      </div>
      <div>{children}</div>
    </section>
  );
}

type OptionListItem = {
  key: string;
  option: any;
};

function OptionsEditor({ config, setConfig, defaultShape = 'pill' }: { config: Record<string, any>; setConfig: (value: Record<string, any>) => void; defaultShape?: 'plain' | 'rounded' | 'pill' }) {
  const options = Array.isArray(config.options) ? config.options : [];
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
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
  const [dragState, setDragState] = useState<{
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
  const updateOption = (index: number, patch: Record<string, any>) => {
    setConfig({ ...config, options: options.map((option: any, i: number) => i === index ? { ...option, ...patch } : option) });
  };
  const moveOption = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= options.length || to >= options.length) return;
    const next = [...options];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setConfig({ ...config, options: next });
  };
  const beginOptionDrag = (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
    const list = listRef.current;
    const row = event.currentTarget.closest('[data-option-row="true"]') as HTMLElement | null;
    if (!list || !row || options.length < 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-option-row="true"]'));
    const rowRects = rows.map((item) => item.getBoundingClientRect());
    const gap = rowRects.length > 1 ? Math.max(0, rowRects[1].top - rowRects[0].bottom) : 6;
    const rowTop = rowRect.top - listRect.top;
    const rowHeight = rowRect.height;
    const centers = rowRects.map((rect) => rect.top - listRect.top + rect.height / 2);
    const baseState = {
      sourceIndex: index,
      targetIndex: index,
      pointerOffset: event.clientY - rowRect.top,
      minTop: 0,
      maxTop: Math.max(0, listRect.height - rowHeight),
      initialTop: rowTop,
      currentTop: rowTop,
      rowHeight,
      step: rowHeight + gap,
      centers,
    };
    dragStateRef.current = baseState;
    setDragState(baseState);

    const updateDrag = (clientY: number) => {
      setDragState((current) => {
        if (!current) return current;
        const currentTop = Math.min(current.maxTop, Math.max(current.minTop, clientY - listRect.top - current.pointerOffset));
        const currentCenter = currentTop + current.rowHeight / 2;
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
    const handlePointerMove = (moveEvent: PointerEvent) => updateDrag(moveEvent.clientY);
    const handlePointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      const finalSource = dragStateRef.current?.sourceIndex ?? index;
      const finalTarget = dragStateRef.current?.targetIndex ?? index;
      flushSync(() => {
        dragStateRef.current = null;
        setDragState(null);
        if (finalSource !== finalTarget) moveOption(finalSource, finalTarget);
      });
      try {
        event.currentTarget.releasePointerCapture(upEvent.pointerId);
      } catch {
        // Pointer capture may already be released if the drag ends outside the button.
      }
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };
  const deleteOption = (index: number) => {
    const optionID = options[index]?.id;
    setConfig({
      ...config,
      options: options.filter((_: any, i: number) => i !== index),
      groups: Array.isArray(config.groups)
        ? config.groups.map((group: any) => ({ ...group, option_ids: (group.option_ids || []).filter((id: string) => id !== optionID) }))
        : config.groups,
    });
  };
  const addOption = () => {
    setConfig({
      ...config,
      options: [...options, { id: crypto.randomUUID(), value: '新选项', color: 'gray', icon: 'none', shape: defaultShape, color_mode: 'background' }],
    });
  };
  return (
    <div className="space-y-4">
      <ConfigSection title="选项">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs text-notion-textSecondary">每行一个选项，可直接预览最终效果。</p>
          <button type="button" onClick={addOption} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-notion-hover"><Plus size={12} />新增选项</button>
        </div>
        <OptionRowsEditor
          items={options.map((option: any, index: number) => ({ key: option.id || String(index), option }))}
          config={config}
          emptyText="暂无选项"
          listRef={listRef}
          dragState={dragState}
          beginOptionDrag={beginOptionDrag}
          updateOption={updateOption}
          deleteOption={deleteOption}
        />
      </ConfigSection>
    </div>
  );
}

function OptionRowsEditor({
  items,
  config,
  emptyText,
  listRef,
  dragState,
  beginOptionDrag,
  updateOption,
  deleteOption,
}: {
  items: OptionListItem[];
  config: Record<string, any>;
  emptyText: string;
  listRef: React.RefObject<HTMLDivElement>;
  dragState: {
    sourceIndex: number;
    targetIndex: number;
    initialTop: number;
    currentTop: number;
    step: number;
  } | null;
  beginOptionDrag: (index: number, event: React.PointerEvent<HTMLButtonElement>) => void;
  updateOption: (index: number, patch: Record<string, any>) => void;
  deleteOption: (index: number) => void;
}) {
  return (
    <div ref={listRef} className="relative space-y-1.5 overflow-hidden">
      {items.length === 0 ? <p className="text-xs text-notion-textSecondary">{emptyText}</p> : items.map((item, index) => {
        const shape = item.option.shape || config.option_shape || 'pill';
        const isDragging = dragState?.sourceIndex === index;
        let translateY = 0;
        if (dragState) {
          if (isDragging) translateY = dragState.currentTop - dragState.initialTop;
          else if (dragState.sourceIndex < dragState.targetIndex && index > dragState.sourceIndex && index <= dragState.targetIndex) translateY = -dragState.step;
          else if (dragState.targetIndex < dragState.sourceIndex && index >= dragState.targetIndex && index < dragState.sourceIndex) translateY = dragState.step;
        }
        return (
          <OptionEditorRow
            key={item.key}
            option={item.option}
            index={index}
            shape={shape}
            config={config}
            dragging={isDragging}
            translateY={translateY}
            beginOptionDrag={beginOptionDrag}
            updateOption={updateOption}
            deleteOption={deleteOption}
          />
        );
      })}
    </div>
  );
}

function OptionEditorRow({
  option,
  index,
  shape,
  config,
  dragging,
  translateY,
  beginOptionDrag,
  updateOption,
  deleteOption,
}: {
  option: any;
  index: number;
  shape: string;
  config: Record<string, any>;
  dragging: boolean;
  translateY: number;
  beginOptionDrag: (index: number, event: React.PointerEvent<HTMLButtonElement>) => void;
  updateOption: (index: number, patch: Record<string, any>) => void;
  deleteOption: (index: number) => void;
}) {
  return (
    <div
      data-option-row="true"
      className={`grid grid-cols-[24px_minmax(150px,1fr)_64px_132px_112px_112px_32px] items-center gap-2 rounded border border-notion-border bg-white px-2 py-2 ${dragging ? 'relative z-10 shadow-lg' : ''}`}
      style={{
        transform: translateY ? `translateY(${translateY}px)` : undefined,
      }}
    >
      <button
        type="button"
        onPointerDown={(event) => beginOptionDrag(index, event)}
        className="flex h-8 w-6 cursor-grab touch-none select-none items-center justify-center rounded text-notion-textSecondary hover:bg-notion-hover active:cursor-grabbing"
        title="拖拽排序"
        aria-label="拖拽排序"
      >
        <GripVertical size={14} />
      </button>
      <OptionNameInput option={option} config={config} onChange={(value) => updateOption(index, { value })} />
      <OptionIconDropdown value={option.icon || 'none'} onChange={(icon) => updateOption(index, { icon })} />
      <CustomSelect
        compact
        value={shape}
        options={[
          { value: 'plain', label: '无' },
          { value: 'rounded', label: '圆角' },
          { value: 'pill', label: '胶囊' },
        ]}
        onChange={(value) => updateOption(index, { shape: value })}
      />
      <OptionColorDropdown value={option.color || 'gray'} onChange={(color) => updateOption(index, { color })} />
      <CustomSelect
        compact
        disabled={shape === 'plain'}
        value={option.color_mode || config.color_mode || 'background'}
        options={[
          { value: 'background', label: '背景' },
          { value: 'outline', label: '边框' },
        ]}
        onChange={(value) => updateOption(index, { color_mode: value })}
      />
      <button type="button" onClick={() => deleteOption(index)} className="flex h-8 w-8 items-center justify-center rounded text-red-600 hover:bg-red-50"><Trash2 size={13} /></button>
    </div>
  );
}

function OptionNameInput({ option, config, onChange }: { option: any; config: Record<string, any>; onChange: (value: string) => void }) {
  const color = optionColors.find((item) => item.id === (option.color || 'gray')) || optionColors[0];
  const outline = (option.color_mode || config.color_mode || 'background') === 'outline';
  const shape = option.shape || config.option_shape || 'pill';
  const value = option.value || '';
  const hasIcon = option.icon && option.icon !== 'none';
  const width = optionInputWidth(value, !!hasIcon);
  const plain = shape === 'plain';
  return (
    <span
      className="inline-flex max-w-full justify-self-start items-center gap-1 border px-2 py-0.5 text-xs transition-shadow focus-within:ring-2 focus-within:ring-blue-100"
      style={{
        color: color.fg,
        borderColor: plain ? 'transparent' : color.border,
        backgroundColor: plain || outline ? 'transparent' : color.bg,
        borderRadius: shape === 'pill' ? 999 : 4,
        width,
      }}
    >
      {hasIcon && <OptionGlyph icon={option.icon} color={color.fg} />}
      <input
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs outline-none placeholder:text-current placeholder:opacity-60"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="选项名称"
      />
    </span>
  );
}

function optionInputWidth(value: string, hasIcon = false) {
  const text = value || '选项名称';
  const visualUnits = Array.from(text).reduce((total, char) => {
    if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(char)) return total + 1;
    if (/[A-Z0-9]/.test(char)) return total + 0.68;
    if (/[a-z]/.test(char)) return total + 0.56;
    return total + 0.5;
  }, 0);
  const minWidth = hasIcon ? 42 : 28;
  const extraWidth = hasIcon ? 34 : 18;
  return `clamp(${minWidth}px, calc(${Math.min(visualUnits, 18).toFixed(2)}em + ${extraWidth}px), 16rem)`;
}

function OptionGlyph({ icon, color }: { icon?: string; color: string }) {
  if (!icon || icon === 'none') return null;
  const wrap = (node: React.ReactNode) => <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center">{node}</span>;
  const common = { color, borderColor: color, backgroundColor: color };
  if (icon.startsWith('notion_') || icon.startsWith('type_')) {
    return wrap(<ColumnIconGlyph icon={icon} />);
  }
  if (icon === 'solid_circle') return wrap(<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />);
  if (icon === 'ring') return wrap(<span className="h-2.5 w-2.5 rounded-full border-2 bg-transparent" style={{ borderColor: color }} />);
  if (icon === 'square') return wrap(<span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: color }} />);
  if (icon === 'triangle') return wrap(<span className="h-3 w-3" style={{ backgroundColor: color, clipPath: 'polygon(50% 8%, 96% 90%, 4% 90%)' }} />);
  if (icon === 'hexagon') return wrap(<span className="h-3 w-3" style={{ backgroundColor: color, clipPath: 'polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%)' }} />);
  if (icon === 'spinner') return wrap(<span className="text-center text-[12px] leading-none" style={{ color }}>✺</span>);
  if (icon === 'sun') return wrap(<span className="text-center text-[12px] leading-none" style={{ color }}>☀</span>);
  if (icon === 'moon') return wrap(<span className="text-center text-[12px] leading-none" style={{ color }}>☾</span>);
  if (icon === 'man') return wrap(<GenderGlyph type="man" color={color} />);
  if (icon === 'woman') return wrap(<GenderGlyph type="woman" color={color} />);
  if (icon === 'child') return wrap(<span className="text-center text-[12px] leading-none" style={{ color }}>♙</span>);
  if (icon === 'phone') return wrap(<span className="text-center text-[12px] leading-none" style={{ color }}>☎</span>);
  if (icon === 'umbrella') return wrap(<span className="text-center text-[12px] leading-none" style={{ color }}>☂</span>);
  return wrap(<span className="h-2.5 w-2.5 rounded-full" style={common} />);
}

function GenderGlyph({ type, color }: { type: 'man' | 'woman'; color: string }) {
  if (type === 'man') {
    return (
      <span className="relative block h-3 w-3">
        <span className="absolute left-0.5 bottom-0 h-2 w-2 rounded-full border-[1.8px]" style={{ borderColor: color }} />
        <span className="absolute right-0 top-0 h-1.5 w-1.5 border-r-[1.8px] border-t-[1.8px]" style={{ borderColor: color }} />
        <span className="absolute right-[2px] top-[1px] h-1.5 w-[1.8px] rotate-45 rounded-full" style={{ backgroundColor: color }} />
      </span>
    );
  }
  return (
    <span className="relative block h-3 w-3">
      <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full border-[1.8px]" style={{ borderColor: color }} />
      <span className="absolute left-1/2 bottom-0 h-1.5 w-[1.8px] -translate-x-1/2 rounded-full" style={{ backgroundColor: color }} />
      <span className="absolute bottom-[2px] left-1/2 h-[1.8px] w-2 -translate-x-1/2 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

function OptionIconDropdown({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuStyle = useMetadataDropdownPosition(open, buttonRef, 408);
  useMetadataDropdownOutsideClose(open, buttonRef, null, () => setOpen(false), '.akdb-column-icon-popover');
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((next) => !next)}
        className="flex w-full items-center justify-between gap-1 rounded border border-notion-border bg-white px-2 py-1.5 text-left text-sm text-notion-text outline-none hover:bg-notion-hover focus:border-notion-text"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center justify-center">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
            <OptionGlyph icon={value || 'none'} color="#5f5e5b" />
          </span>
        </span>
        <ChevronDown size={15} className={`shrink-0 text-notion-textSecondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && menuStyle && createPortal(
        <ColumnIconPopover
          currentIcon={value || ''}
          defaultIcon="notion_circle"
          ariaLabel="选项图标"
          style={{ ...menuStyle, zIndex: 121 }}
          onPick={(icon) => {
            onChange(icon || 'none');
            setOpen(false);
          }}
        />,
        document.body,
      )}
    </div>
  );
}

function OptionColorDropdown({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuStyle = useMetadataDropdownPosition(open, buttonRef);
  useMetadataDropdownOutsideClose(open, buttonRef, menuRef, () => setOpen(false));
  const selected = optionColors.find((color) => color.id === value) || optionColors[0];
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((next) => !next)}
        className="flex w-full items-center justify-between gap-2 rounded border border-notion-border bg-white px-2 py-1.5 text-left text-sm text-notion-text outline-none hover:bg-notion-hover focus:border-notion-text"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-4 w-4 shrink-0 rounded-full border" style={{ backgroundColor: selected.bg, borderColor: selected.border }} />
          <span className="truncate">{selected.name}</span>
        </span>
        <ChevronDown size={15} className={`shrink-0 text-notion-textSecondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && menuStyle && createPortal(
        <div ref={menuRef} className="z-[80] max-h-64 overflow-y-auto rounded-md border border-notion-border bg-white p-1 shadow-lg" style={menuStyle} role="listbox" tabIndex={-1}>
          {optionColors.map((color) => {
            const active = color.id === value;
            return (
              <button
                key={color.id}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(color.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${active ? 'bg-notion-hover text-notion-text' : 'text-notion-text hover:bg-notion-hover'}`}
              >
                <span className="flex w-4 shrink-0 justify-center">{active && <Check size={14} />}</span>
                <span className="h-4 w-4 shrink-0 rounded-full border" style={{ backgroundColor: color.bg, borderColor: color.border }} />
                <span className="truncate">{color.name}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

function StatusEditor({ config, setConfig }: { config: Record<string, any>; setConfig: (value: Record<string, any>) => void }) {
  const options = Array.isArray(config.options) ? config.options : [];
  const groups = Array.isArray(config.groups) ? config.groups : [];
  const groupListRef = useRef<HTMLDivElement | null>(null);
  const groupDragStateRef = useRef<{
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
  const [groupDragState, setGroupDragState] = useState<{
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
  const updateGroup = (index: number, patch: Record<string, any>) => {
    setConfig({ ...config, groups: groups.map((group: any, i: number) => i === index ? { ...group, ...patch } : group) });
  };
  const moveGroup = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= groups.length || to >= groups.length) return;
    const next = [...groups];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setConfig({ ...config, groups: next });
  };
  const beginGroupDrag = (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
    const list = groupListRef.current;
    const row = event.currentTarget.closest('[data-status-group-row="true"]') as HTMLElement | null;
    if (!list || !row || groups.length < 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-status-group-row="true"]'));
    const rowRects = rows.map((item) => item.getBoundingClientRect());
    const gap = rowRects.length > 1 ? Math.max(0, rowRects[1].top - rowRects[0].bottom) : 12;
    const rowTop = rowRect.top - listRect.top;
    const rowHeight = rowRect.height;
    const centers = rowRects.map((rect) => rect.top - listRect.top + rect.height / 2);
    const baseState = {
      sourceIndex: index,
      targetIndex: index,
      pointerOffset: event.clientY - rowRect.top,
      minTop: 0,
      maxTop: Math.max(0, listRect.height - rowHeight),
      initialTop: rowTop,
      currentTop: rowTop,
      rowHeight,
      step: rowHeight + gap,
      centers,
    };
    groupDragStateRef.current = baseState;
    setGroupDragState(baseState);

    const updateDrag = (clientY: number) => {
      setGroupDragState((current) => {
        if (!current) return current;
        const currentTop = Math.min(current.maxTop, Math.max(current.minTop, clientY - listRect.top - current.pointerOffset));
        const currentCenter = currentTop + current.rowHeight / 2;
        const targetIndex = current.centers.findIndex((center) => currentCenter <= center);
        const next = {
          ...current,
          currentTop,
          targetIndex: targetIndex === -1 ? current.centers.length - 1 : targetIndex,
        };
        groupDragStateRef.current = next;
        return next;
      });
    };
    const handlePointerMove = (moveEvent: PointerEvent) => updateDrag(moveEvent.clientY);
    const handlePointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      const finalSource = groupDragStateRef.current?.sourceIndex ?? index;
      const finalTarget = groupDragStateRef.current?.targetIndex ?? index;
      flushSync(() => {
        groupDragStateRef.current = null;
        setGroupDragState(null);
        if (finalSource !== finalTarget) moveGroup(finalSource, finalTarget);
      });
      try {
        event.currentTarget.releasePointerCapture(upEvent.pointerId);
      } catch {
        // Pointer capture may already be released if the drag ends outside the button.
      }
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };
  const addGroup = () => {
    setConfig({ ...config, groups: [...groups, { id: crypto.randomUUID(), name: '新主分组', option_ids: [] }] });
  };
  const deleteGroup = (index: number) => {
    const deletingIDs = new Set(groups[index]?.option_ids || []);
    const nextGroups = groups.filter((_: any, i: number) => i !== index);
    const remainingIDs = new Set(nextGroups.flatMap((group: any) => group.option_ids || []));
    setConfig({
      ...config,
      groups: nextGroups,
      options: options.filter((option: any) => !deletingIDs.has(option.id) || remainingIDs.has(option.id)),
    });
  };
  const optionByID = new Map(options.map((option: any) => [option.id, option]));
  const addGroupOption = (groupIndex: number) => {
    const id = crypto.randomUUID();
    const group = groups[groupIndex];
    const current = Array.isArray(group.option_ids) ? group.option_ids : [];
    setConfig({
      ...config,
      options: [...options, { id, value: '新状态', color: 'gray', icon: 'none', shape: 'pill', color_mode: 'background' }],
      groups: groups.map((item: any, i: number) => i === groupIndex ? { ...item, option_ids: [...current, id] } : item),
    });
  };
  return (
    <ConfigSection
      title="状态主分组"
      action={<button type="button" onClick={addGroup} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-notion-hover"><Plus size={12} />新增主分组</button>}
    >
      <div ref={groupListRef} className="relative space-y-3 overflow-hidden">
        {groups.length === 0 ? <p className="text-xs text-notion-textSecondary">暂无主分组</p> : groups.map((group: any, groupIndex: number) => {
          const groupOptionIDs = Array.isArray(group.option_ids) ? group.option_ids : [];
          const groupOptions = groupOptionIDs.map((id: string) => optionByID.get(id)).filter(Boolean);
          const isDragging = groupDragState?.sourceIndex === groupIndex;
          let translateY = 0;
          if (groupDragState) {
            if (isDragging) translateY = groupDragState.currentTop - groupDragState.initialTop;
            else if (groupDragState.sourceIndex < groupDragState.targetIndex && groupIndex > groupDragState.sourceIndex && groupIndex <= groupDragState.targetIndex) translateY = -groupDragState.step;
            else if (groupDragState.targetIndex < groupDragState.sourceIndex && groupIndex >= groupDragState.targetIndex && groupIndex < groupDragState.sourceIndex) translateY = groupDragState.step;
          }
          return (
          <div
            key={group.id || groupIndex}
            data-status-group-row="true"
            className={`rounded border border-notion-border bg-white ${isDragging ? 'relative z-10 shadow-lg' : ''}`}
            style={{ transform: translateY ? `translateY(${translateY}px)` : undefined }}
          >
            <div className="flex items-center gap-2 border-b border-notion-border px-3 py-2">
              <button
                type="button"
                onPointerDown={(event) => beginGroupDrag(groupIndex, event)}
                className="flex h-8 w-6 cursor-grab touch-none select-none items-center justify-center rounded text-notion-textSecondary hover:bg-notion-hover active:cursor-grabbing"
                title="拖拽排序"
                aria-label="拖拽排序"
              >
                <GripVertical size={14} />
              </button>
              <input
                className="min-w-0 flex-1 border-0 bg-transparent text-sm font-medium text-notion-text outline-none"
                value={group.name || ''}
                onChange={(e) => updateGroup(groupIndex, { name: e.target.value })}
                placeholder="主分组名称"
              />
              <button type="button" onClick={() => addGroupOption(groupIndex)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-notion-hover"><Plus size={12} />新增状态</button>
              <button type="button" onClick={() => deleteGroup(groupIndex)} className="flex h-8 w-8 items-center justify-center rounded text-red-600 hover:bg-red-50"><Trash2 size={13} /></button>
            </div>
            <div className="p-2">
              <StatusGroupOptions
                config={config}
                groupIndex={groupIndex}
                groupOptionIDs={groupOptionIDs}
                options={groupOptions}
                allOptions={options}
                groups={groups}
                setConfig={setConfig}
              />
            </div>
          </div>
        );})}
      </div>
    </ConfigSection>
  );
}

function StatusGroupOptions({
  config,
  groupIndex,
  groupOptionIDs,
  options,
  allOptions,
  groups,
  setConfig,
}: {
  config: Record<string, any>;
  groupIndex: number;
  groupOptionIDs: string[];
  options: any[];
  allOptions: any[];
  groups: any[];
  setConfig: (value: Record<string, any>) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
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
  const [dragState, setDragState] = useState<{
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
  const updateOption = (index: number, patch: Record<string, any>) => {
    const optionID = options[index]?.id;
    if (!optionID) return;
    setConfig({
      ...config,
      options: allOptions.map((option: any) => option.id === optionID ? { ...option, ...patch } : option),
    });
  };
  const moveOption = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= groupOptionIDs.length || to >= groupOptionIDs.length) return;
    const nextIDs = [...groupOptionIDs];
    const [item] = nextIDs.splice(from, 1);
    nextIDs.splice(to, 0, item);
    setConfig({
      ...config,
      groups: groups.map((group: any, i: number) => i === groupIndex ? { ...group, option_ids: nextIDs } : group),
    });
  };
  const beginOptionDrag = (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
    const list = listRef.current;
    const row = event.currentTarget.closest('[data-option-row="true"]') as HTMLElement | null;
    if (!list || !row || options.length < 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-option-row="true"]'));
    const rowRects = rows.map((item) => item.getBoundingClientRect());
    const gap = rowRects.length > 1 ? Math.max(0, rowRects[1].top - rowRects[0].bottom) : 6;
    const rowTop = rowRect.top - listRect.top;
    const rowHeight = rowRect.height;
    const centers = rowRects.map((rect) => rect.top - listRect.top + rect.height / 2);
    const baseState = {
      sourceIndex: index,
      targetIndex: index,
      pointerOffset: event.clientY - rowRect.top,
      minTop: 0,
      maxTop: Math.max(0, listRect.height - rowHeight),
      initialTop: rowTop,
      currentTop: rowTop,
      rowHeight,
      step: rowHeight + gap,
      centers,
    };
    dragStateRef.current = baseState;
    setDragState(baseState);

    const updateDrag = (clientY: number) => {
      setDragState((current) => {
        if (!current) return current;
        const currentTop = Math.min(current.maxTop, Math.max(current.minTop, clientY - listRect.top - current.pointerOffset));
        const currentCenter = currentTop + current.rowHeight / 2;
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
    const handlePointerMove = (moveEvent: PointerEvent) => updateDrag(moveEvent.clientY);
    const handlePointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      const finalSource = dragStateRef.current?.sourceIndex ?? index;
      const finalTarget = dragStateRef.current?.targetIndex ?? index;
      flushSync(() => {
        dragStateRef.current = null;
        setDragState(null);
        if (finalSource !== finalTarget) moveOption(finalSource, finalTarget);
      });
      try {
        event.currentTarget.releasePointerCapture(upEvent.pointerId);
      } catch {
        // Pointer capture may already be released if the drag ends outside the button.
      }
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };
  const deleteOption = (index: number) => {
    const optionID = options[index]?.id;
    if (!optionID) return;
    setConfig({
      ...config,
      options: allOptions.filter((option: any) => option.id !== optionID),
      groups: groups.map((group: any) => ({ ...group, option_ids: (group.option_ids || []).filter((id: string) => id !== optionID) })),
    });
  };
  return (
    <OptionRowsEditor
      items={options.map((option: any, index: number) => ({ key: option.id || String(index), option }))}
      config={config}
      emptyText="这个主分组还没有状态"
      listRef={listRef}
      dragState={dragState}
      beginOptionDrag={beginOptionDrag}
      updateOption={updateOption}
      deleteOption={deleteOption}
    />
  );
}
