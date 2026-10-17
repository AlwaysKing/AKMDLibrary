import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Eye, EyeOff, Loader2, Maximize2, MessageSquare, MoreHorizontal, Pencil, Save, SlidersHorizontal, Trash2, UploadCloud, X } from 'lucide-react';
import { databasesApi, type DatabaseColumn, type DatabaseDetail, type DatabaseRow } from '../../../api/databases';
import { gitApi, type GitRepoState } from '../../../api/git';
import { usersApi } from '../../../api/users';
import { type User } from '../../../api/auth';
import { useSpaceStore } from '../../../stores/spaceStore';
import PageEditor from '../PageEditor';
import {
  buildFormulaProps,
  ColumnIconGlyph,
  OptionSelect,
  OptionMultiSelect,
  OptionTag,
  PersonSelect,
  PersonTag,
  createOptionConfig,
  defaultColumnIconID,
  parseMultiSelectValue,
  personColumnMultiple,
  personValueIDs,
} from './DatabaseRenderer';
import './database.css';

interface Props {
  spaceSlug: string;
  dbId: string;
  rowId: string;
  /** 非全屏打开时显示的“全局展开”入口 */
  onOpenFull?: () => void;
  /** 全屏页：左侧显示返回按钮 */
  onBack?: () => void;
  /** 浮层内：左侧显示关闭按钮 */
  onClose?: () => void;
  className?: string;
}

/**
 * 数据库行（subpage）页面 —— 定制版普通页面。
 * 顶部工具栏与普通页面一致（同步状态 / 立即同步 / git 提交 / 全宽 / 锁定），
 * 正文复用 PageEditor；差异仅在标题与正文之间插入了属性展示。
 * 居中弹层、右侧抽屉、全屏页三种打开方式共用这一份实现。
 */
export default function DatabaseRowView({ spaceSlug, dbId, rowId, onOpenFull, onBack, onClose, className }: Props) {
  const [schema, setSchema] = useState<DatabaseDetail | null>(null);
  const [row, setRow] = useState<DatabaseRow | null>(null);
  const [frontmatter, setFrontmatter] = useState('');
  const [body, setBody] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState<'unsaved' | 'syncing' | 'synced' | null>(null);
  const [locked, setLocked] = useState(false);
  const [fullPage, setFullPage] = useState(false);
  const [foldedPropertyIds, setFoldedPropertyIds] = useState<string[]>([]);
  const [revealFolded, setRevealFolded] = useState(false);
  const [propertyMenu, setPropertyMenu] = useState<{ columnId: string; top: number; left: number } | null>(null);
  const [pageMenu, setPageMenu] = useState<{ top: number; left: number } | null>(null);
  const [renamingColumnId, setRenamingColumnId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [gitState, setGitState] = useState<GitRepoState | null>(null);
  const [committing, setCommitting] = useState(false);
  const pageMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const rowPageRef = useRef<HTMLDivElement | null>(null);
  const markdownGetterRef = useRef<(() => string) | null>(null);
  /** 行页面在镜像/同步链路里的身份（与普通页面 pageId 区分，避免冲突） */
  const rowPageId = `${dbId}:${rowId}`;
  const frontmatterRef = useRef(frontmatter);
  frontmatterRef.current = frontmatter;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    Promise.all([
      databasesApi.get(spaceSlug, dbId),
      databasesApi.listRows(spaceSlug, dbId, { limit: 0 }),
      databasesApi.getRowPage(spaceSlug, dbId, rowId),
    ])
      .then(([detail, rowsRes, page]) => {
        if (!alive) return;
        setSchema(detail);
        setRow((rowsRes.rows || []).find((item) => item.uuid === rowId) || null);
        const split = splitFrontmatter(page.markdown);
        setFrontmatter(split.frontmatter);
        setBody(split.body);
        setLocked(readFrontmatterFlag(split.frontmatter, 'locked'));
        setFullPage(readFrontmatterFlag(split.frontmatter, 'full_page'));
        setFoldedPropertyIds(readFoldedProperties(split.frontmatter));
      })
      .catch((err) => {
        if (alive) setError(err?.response?.data?.error || '加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [spaceSlug, dbId, rowId]);

  useEffect(() => {
    let alive = true;
    usersApi.list().then((next) => { if (alive) setUsers(next || []); }).catch(() => { if (alive) setUsers([]); });
    return () => { alive = false; };
  }, []);

  // 浮层打开期间抬高 BlockNote 浮层基准层级：它把菜单/block handler 挂在 body 下，
  // 默认层级(20/80)会低于本行页面浮层(119/120)，导致菜单被盖住。
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.getPropertyValue('--bn-ui-base-z-index');
    root.style.setProperty('--bn-ui-base-z-index', '120');
    return () => {
      if (previous) root.style.setProperty('--bn-ui-base-z-index', previous);
      else root.style.removeProperty('--bn-ui-base-z-index');
    };
  }, []);

  const usersByUUID = useMemo(() => new Map(users.map((user) => [user.uuid, user])), [users]);
  const props = useMemo(
    () => buildFormulaProps(schema?.columns || [], row || { uuid: rowId, values: {} }),
    [schema?.columns, row, rowId],
  );
  const editableColumns = useMemo(
    () => (schema?.columns || []).filter((column) => !column.auto && column.type !== 'formula' && column.type !== 'created_time' && column.type !== 'last_edited_time' && column.type !== 'last_edited_user' && column.type !== 'linked'),
    [schema?.columns],
  );
  const titleColumn = useMemo(
    () => editableColumns.find((column) => column.type === 'text') || editableColumns[0],
    [editableColumns],
  );
  const titleValue = titleColumn ? String(row?.values?.[titleColumn.id] ?? '') : '';

  const foldedSet = useMemo(() => new Set(foldedPropertyIds), [foldedPropertyIds]);
  const foldedColumns = editableColumns.filter((column) => foldedSet.has(column.id));
  /** 折叠只控制“是否渲染”，顺序始终按 table 列顺序；展开后回到原位 */
  const displayColumns = revealFolded ? editableColumns : editableColumns.filter((column) => !foldedSet.has(column.id));

  /** 行页面文件在 git 仓库内的相对路径 */
  const rowRepoPath = schema?.dir_name ? `_database/${schema.dir_name}/subpages/${rowId}.md` : '';
  const rowDirty = !!(gitState?.is_repo && rowRepoPath && (gitState.files || []).some((file) => file.path === rowRepoPath));

  const refreshGit = useCallback(async () => {
    // 与普通页面一致：空间未开启 git 功能时不请求（避免无意义的 403）
    const space = useSpaceStore.getState().spaces.find((item) => item.slug === spaceSlug);
    if (!space?.feature_flags?.git) {
      setGitState(null);
      return;
    }
    try {
      setGitState(await gitApi.state(spaceSlug));
    } catch {
      setGitState(null);
    }
  }, [spaceSlug]);

  useEffect(() => { void refreshGit(); }, [refreshGit]);

  /**
   * 行页面自己的保存通道：直接 putRowPage 写回这个 subpage（frontmatter + 正文），
   * 不走普通页面的镜像/同步管道，避免影响到父页面。
   */
  const saveNow = useCallback(async (nextFrontmatter?: string) => {
    const fm = nextFrontmatter ?? frontmatterRef.current;
    const currentBody = markdownGetterRef.current?.() ?? body;
    setSyncStatus('syncing');
    try {
      await databasesApi.putRowPage(spaceSlug, dbId, rowId, `${fm}${currentBody}`);
      setSyncStatus('synced');
      void refreshGit();
    } catch {
      setSyncStatus('unsaved');
      setError('保存失败');
    }
  }, [spaceSlug, dbId, rowId, body, refreshGit]);

  const saveTimerRef = useRef<number | null>(null);
  /** 正文变化后延迟一点合并保存（等同普通页面的自动保存体验） */
  const scheduleSave = useCallback(() => {
    setSyncStatus('unsaved');
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveNow();
    }, 1200);
  }, [saveNow]);

  // 关掉浮层/切走时，把待保存内容立刻写掉
  useEffect(() => () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      void saveNow();
    }
  }, [saveNow]);

  // Cmd/Ctrl+S：立即保存（行页面走自己的通道）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      void saveNow();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [saveNow]);

  /** frontmatter 变更（折叠/全宽/锁定/标题）：带上当前正文一起写回 */
  const persistFrontmatter = (nextFrontmatter: string) => {
    setFrontmatter(nextFrontmatter);
    if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    void saveNow(nextFrontmatter);
  };

  // 属性是否可见（行页面）：折叠名单只属于这个行页面，存 subpage frontmatter
  const setPropertyFolded = (column: DatabaseColumn, folded: boolean) => {
    const current = new Set(foldedPropertyIds);
    if (folded) current.add(column.id);
    else current.delete(column.id);
    const nextIds = editableColumns.map((item) => item.id).filter((id) => current.has(id));
    setFoldedPropertyIds(nextIds);
    persistFrontmatter(writeFoldedProperties(frontmatterRef.current, nextIds));
  };

  const toggleFullPage = () => {
    const next = !fullPage;
    setFullPage(next);
    persistFrontmatter(writeFrontmatterFlag(frontmatterRef.current, 'full_page', next));
  };

  const toggleLocked = () => {
    const next = !locked;
    setLocked(next);
    persistFrontmatter(writeFrontmatterFlag(frontmatterRef.current, 'locked', next));
  };

  const commitTitle = async () => {
    const next = (titleRef.current?.innerText || '').trim();
    if (!titleColumn || next === titleValue) return;
    if (titleRef.current) titleRef.current.innerText = next || titleValue;
    await updateCell(titleColumn, next);
    persistFrontmatter(writeFrontmatterValue(frontmatterRef.current, 'title', next));
  };

  const updateCell = async (column: DatabaseColumn, value: string) => {
    if (locked || column.readonly) return;
    setRow((current) => current ? { ...current, values: { ...current.values, [column.id]: value } } : current);
    try {
      const next = await databasesApi.updateRow(spaceSlug, dbId, rowId, { [column.id]: value });
      setRow(next);
    } catch {
      setError('属性保存失败');
    }
  };

  // 选项类属性：新建选项要写回列 schema（config.options）
  const createOption = async (column: DatabaseColumn, label: string) => {
    const options = Array.isArray(column.config?.options) ? [...column.config!.options] : [];
    const option = createOptionConfig(label, options);
    options.push(option);
    const next = await databasesApi.updateColumn(spaceSlug, dbId, column.id, { config: { ...(column.config || {}), options } });
    setSchema(next);
    return option;
  };

  const commitRename = async (column: DatabaseColumn) => {
    const nextName = renameDraft.trim();
    setRenamingColumnId(null);
    if (!nextName || nextName === column.name) return;
    try {
      setSchema(await databasesApi.updateColumn(spaceSlug, dbId, column.id, { name: nextName }));
    } catch {
      setError('属性重命名失败');
    }
  };

  const deleteProperty = async (column: DatabaseColumn) => {
    try {
      setSchema(await databasesApi.deleteColumn(spaceSlug, dbId, column.id));
    } catch {
      setError('删除属性失败');
    }
  };

  const handleCommitRow = async () => {
    if (!rowRepoPath || committing) return;
    setCommitting(true);
    try {
      await gitApi.commit(spaceSlug, `Update ${titleValue || rowRepoPath}`, [rowRepoPath]);
      await refreshGit();
    } catch (e) {
      console.error('row page commit failed:', e);
    } finally {
      setCommitting(false);
    }
  };

  useEffect(() => {
    if (!propertyMenu) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.akdb-row-view-property-menu, .akdb-row-view-property-label')) return;
      setPropertyMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPropertyMenu(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [propertyMenu]);

  useEffect(() => {
    if (!pageMenu) return;
    const close = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('.akdb-row-view-page-menu, .akdb-row-view-tool-btn')) return;
      setPageMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pageMenu]);

  const togglePageMenu = () => {
    if (pageMenu) { setPageMenu(null); return; }
    const rect = pageMenuButtonRef.current?.getBoundingClientRect();
    if (rect) setPageMenu({ top: rect.bottom + 6, left: Math.max(8, rect.right - 200) });
  };

  const syncLabel = syncStatus === 'unsaved'
    ? '有内容尚未同步'
    : syncStatus === 'syncing'
      ? '同步中'
      : syncStatus === 'synced'
        ? '已同步'
        : '';

  return (
    <div className={`akdb-row-view ${className || ''}`.trim()}>
      <div className="akdb-row-view-toolbar">
        <div className="akdb-row-view-tool-left">
          {onBack && (
            <button type="button" className="akdb-row-view-tool-btn" aria-label="返回数据库" onClick={onBack}>
              <ArrowLeft size={16} strokeWidth={2} />
            </button>
          )}
          {onClose && (
            <button type="button" className="akdb-row-view-tool-btn" aria-label="关闭" onClick={onClose}>
              <X size={16} strokeWidth={2} />
            </button>
          )}
          {onOpenFull && (
            <button type="button" className="akdb-row-view-tool-btn" aria-label="全局展开" title="全局展开" onClick={onOpenFull}>
              <Maximize2 size={16} strokeWidth={2} />
            </button>
          )}
          {!onBack && !onOpenFull && <span className="akdb-row-view-tool-spacer" />}
        </div>
        <div className="akdb-row-view-tool-actions">
          {syncStatus === 'unsaved' && (
            <>
              <span className="akdb-row-view-sync-text">{syncLabel}</span>
              <button
                type="button"
                className="akdb-row-view-tool-btn"
                aria-label="立即同步"
                title="立即同步 (等同于 Cmd+S)"
                onClick={() => {
                  if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
                  void saveNow();
                }}
              >
                <Save size={15} strokeWidth={2} />
              </button>
            </>
          )}
          {syncStatus === 'syncing' && (
            <span className="akdb-row-view-sync-text"><Loader2 size={13} className="akdb-row-view-spin" />同步中</span>
          )}
          {syncStatus === 'synced' && (
            <span className="akdb-row-view-sync-text">已同步<Check size={13} strokeWidth={2} /></span>
          )}
          {gitState?.is_repo && rowDirty && (
            <button
              type="button"
              className="akdb-row-view-tool-btn"
              aria-label="提交此页面到 git"
              title={`提交此页面到 git (${rowRepoPath})`}
              disabled={committing}
              onClick={() => void handleCommitRow()}
            >
              {committing ? <Loader2 size={15} className="akdb-row-view-spin" /> : <UploadCloud size={15} strokeWidth={2} />}
            </button>
          )}
          <button
            ref={pageMenuButtonRef}
            type="button"
            className="akdb-row-view-tool-btn"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={!!pageMenu}
            onClick={togglePageMenu}
          >
            <MoreHorizontal size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      {error && <div className="akdb-row-view-error">{error}</div>}

      <div className="akdb-row-view-scroll overflow-y-auto">
        {loading ? (
          <div className="akdb-row-view-loading"><Loader2 size={16} />加载中…</div>
        ) : (
          <div className={`akdb-row-view-page ${fullPage ? 'is-full-page' : ''}`} ref={rowPageRef}>
            <h1
              key={titleValue}
              ref={titleRef}
              className="akdb-row-view-title"
              contentEditable={!locked}
              suppressContentEditableWarning
              spellCheck={false}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            >
              {titleValue || '未命名'}
            </h1>
            <div className="akdb-row-view-properties">
              {displayColumns.map((column) => (
                <div className="akdb-row-view-property" key={column.id}>
                  <span className="akdb-row-view-property-name">
                    <button
                      type="button"
                      className="akdb-row-view-property-label"
                      aria-label={`${column.name} 属性菜单`}
                      aria-haspopup="menu"
                      aria-expanded={propertyMenu?.columnId === column.id}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setPropertyMenu({ columnId: column.id, top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 248) });
                      }}
                    >
                      <span className="akdb-row-view-property-icon"><ColumnIconGlyph icon={column.icon || defaultColumnIconID(column)} /></span>
                      <span className="akdb-row-view-property-grip" aria-hidden="true" />
                      <span className="akdb-row-view-property-label-text">{column.name}</span>
                    </button>
                  </span>
                  <span className="akdb-row-view-property-value">
                    <PropertyValue
                      column={column}
                      value={row?.values?.[column.id] ?? ''}
                      formulaValue={props[column.id]}
                      usersByUUID={usersByUUID}
                      locked={locked}
                      onChange={(value) => void updateCell(column, value)}
                      onCreateOption={(label) => createOption(column, label)}
                    />
                  </span>
                </div>
              ))}
            </div>
            {foldedColumns.length > 0 && (
              <button type="button" className="akdb-row-view-more" onClick={() => setRevealFolded((value) => !value)}>
                {revealFolded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {revealFolded ? '收起' : '显示'} {foldedColumns.length} 个折叠属性
              </button>
            )}
            <div className="akdb-row-view-divider" />
            <PageEditor
              key={rowPageId}
              initialContent={body}
              pageIdentity={{ spaceSlug, pageId: rowPageId }}
              onSyncStatusChange={(status) => { if (status === 'unsaved') scheduleSave(); }}
              registerMarkdownGetter={(getter) => { markdownGetterRef.current = getter; }}
              disableMirror
              readOnly={locked}
            />
          </div>
        )}
      </div>

      {pageMenu && createPortal(
        <div
          className="akdb-view-settings-menu akdb-row-view-page-menu"
          role="menu"
          style={{ position: 'fixed', zIndex: 150, top: pageMenu.top, left: pageMenu.left, width: 200 }}
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={fullPage}
            className="akdb-row-view-page-menu-item"
            onClick={() => { toggleFullPage(); setPageMenu(null); }}
          >
            <span>全宽页面</span>
            <span className={`akdb-row-view-switch ${fullPage ? 'is-on' : ''}`}><span /></span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={locked}
            className="akdb-row-view-page-menu-item"
            onClick={() => { toggleLocked(); setPageMenu(null); }}
          >
            <span>锁定页面</span>
            <span className={`akdb-row-view-switch ${locked ? 'is-on' : ''}`}><span /></span>
          </button>
        </div>,
        document.body,
      )}

      {propertyMenu && (() => {
        const column = editableColumns.find((item) => item.id === propertyMenu.columnId);
        if (!column) return null;
        const folded = foldedSet.has(column.id);
        return createPortal(
          <div
            className="akdb-view-settings-menu akdb-row-view-property-menu"
            role="menu"
            style={{ position: 'fixed', zIndex: 150, top: propertyMenu.top, left: propertyMenu.left, width: 240 }}
          >
            {renamingColumnId === column.id ? (
              <div className="akdb-row-view-rename">
                <Pencil size={16} strokeWidth={2} />
                <input
                  autoFocus
                  value={renameDraft}
                  aria-label="属性名称"
                  onChange={(event) => setRenameDraft(event.currentTarget.value)}
                  onBlur={() => void commitRename(column)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void commitRename(column);
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setRenamingColumnId(null);
                    }
                  }}
                />
              </div>
            ) : (
              <button
                type="button"
                className="akdb-row-context-item"
                role="menuitem"
                onClick={() => { setRenameDraft(column.name); setRenamingColumnId(column.id); }}
              >
                <Pencil size={16} strokeWidth={2} />
                <span>重命名</span>
              </button>
            )}
            <button type="button" className="akdb-row-context-item" role="menuitem" onClick={() => setPropertyMenu(null)}>
              <SlidersHorizontal size={16} strokeWidth={2} />
              <span>编辑属性</span>
            </button>
            <button type="button" className="akdb-row-context-item" role="menuitem" onClick={() => setPropertyMenu(null)}>
              <MessageSquare size={16} strokeWidth={2} />
              <span>评论</span>
            </button>
            <div className="akdb-row-view-property-menu-sep" />
            <button
              type="button"
              className="akdb-row-context-item"
              role="menuitemcheckbox"
              aria-checked={!folded}
              onClick={() => { setPropertyFolded(column, !folded); setPropertyMenu(null); }}
            >
              {folded ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
              <span>属性是否可见</span>
            </button>
            <button
              type="button"
              className="akdb-row-context-item is-danger"
              role="menuitem"
              onClick={() => { setPropertyMenu(null); void deleteProperty(column); }}
            >
              <Trash2 size={16} strokeWidth={2} />
              <span>删除属性</span>
            </button>
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}

function PropertyValue({ column, value, formulaValue, usersByUUID, locked, onChange, onCreateOption }: {
  column: DatabaseColumn;
  value: string;
  formulaValue?: any;
  usersByUUID: Map<string, User>;
  locked?: boolean;
  onChange: (value: string) => void;
  onCreateOption: (label: string) => Promise<any | null>;
}) {
  const [draft, setDraft] = useState(value);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => { setDraft(value); }, [value]);

  if (column.type === 'formula') {
    const text = String(formulaValue ?? '');
    return <span className="akdb-row-view-text">{text || <Empty />}</span>;
  }
  if (column.type === 'checkbox') {
    const checked = value === 'true';
    return (
      <button
        type="button"
        className="akdb-row-view-checkbox-btn"
        aria-label={checked ? '取消勾选' : '勾选'}
        disabled={locked}
        onClick={() => onChange(checked ? 'false' : 'true')}
      >
        {checked ? <Check size={15} strokeWidth={2} className="akdb-row-view-check" /> : <span className="akdb-row-view-checkbox" />}
      </button>
    );
  }
  if (column.type === 'select' || column.type === 'status') {
    if (locked) return value ? <OptionTag option={optionByID(column, value)} config={column.config || {}} /> : <Empty />;
    return (
      <span ref={anchorRef} className="akdb-row-view-editor">
        <OptionSelect
          value={value}
          options={(column.config?.options || []) as any[]}
          config={column.config || {}}
          isStatus={column.type === 'status'}
          anchorRef={anchorRef}
          onCreate={onCreateOption}
          onChange={onChange}
        />
      </span>
    );
  }
  if (column.type === 'multi_select') {
    const ids = parseMultiSelectValue(value);
    if (locked) return ids.length ? <>{ids.map((id) => <OptionTag key={id} option={optionByID(column, id)} config={column.config || {}} />)}</> : <Empty />;
    return (
      <span ref={anchorRef} className="akdb-row-view-editor">
        <OptionMultiSelect
          ids={ids}
          options={(column.config?.options || []) as any[]}
          config={column.config || {}}
          anchorRef={anchorRef}
          onCreate={onCreateOption}
          onChange={(nextIDs) => onChange(JSON.stringify(nextIDs))}
        />
      </span>
    );
  }
  if (column.type === 'person') {
    const multiple = personColumnMultiple(column);
    const ids = personValueIDs(value);
    const displayStyle = (column.config?.display_style || 'icon_name') as 'icon' | 'name' | 'icon_name';
    if (locked) return ids.length ? <>{ids.map((id) => <PersonTag key={id} value={id} user={usersByUUID.get(id)} displayStyle={displayStyle} />)}</> : <Empty />;
    return (
      <span ref={anchorRef} className="akdb-row-view-editor">
        <PersonSelect
          value={multiple ? '' : (ids[0] || '')}
          ids={ids}
          userMap={usersByUUID}
          multiple={multiple}
          displayStyle={displayStyle}
          anchorRef={anchorRef}
          onChange={(nextIDs) => onChange(multiple ? JSON.stringify(nextIDs) : (nextIDs[0] || ''))}
        />
      </span>
    );
  }
  if (column.type === 'date' || column.type === 'created_time' || column.type === 'last_edited_time') {
    const text = formatDateValue(value);
    return <span className="akdb-row-view-text">{text || <Empty />}</span>;
  }
  if (column.type === 'url') {
    return value
      ? <a className="akdb-row-view-link" href={value} target="_blank" rel="noreferrer">{value}</a>
      : <Empty />;
  }
  return (
    <input
      className="akdb-row-view-input"
      value={draft}
      placeholder="空"
      readOnly={locked}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => { if (!locked && draft !== value) onChange(draft); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (!locked && draft !== value) onChange(draft);
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function optionByID(column: DatabaseColumn, id: string) {
  const options = (column.config?.options || []) as Array<{ id: string; value: string }>;
  return options.find((option) => option.id === id) || { id, value: id };
}

function formatDateValue(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

/** 把行页面的 frontmatter 与正文拆开：正文进编辑器，frontmatter 保存时原样带回。 */
function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  if (!match) return { frontmatter: '', body: markdown };
  return { frontmatter: match[0], body: markdown.slice(match[0].length) };
}

/** 读取行页面 frontmatter 里的 folded_properties（YAML 列表）。 */
function readFoldedProperties(frontmatter: string): string[] {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => /^folded_properties:/.test(line));
  if (start === -1) return [];
  const inline = lines[start].replace(/^folded_properties:\s*/, '').trim();
  if (inline && inline !== '[]') {
    return inline.replace(/^\[|\]$/g, '').split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  const ids: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const match = /^\s*-\s*(.+?)\s*$/.exec(lines[i]);
    if (!match) break;
    ids.push(match[1].replace(/^["']|["']$/g, ''));
  }
  return ids;
}

function readFrontmatterFlag(frontmatter: string, key: string): boolean {
  return new RegExp(`^${key}:\\s*true\\s*$`, 'm').test(frontmatter);
}

/** 重写 frontmatter：删除某个 key（含其后的 YAML 列表项），再按需追加新值。 */
function rewriteFrontmatter(frontmatter: string, key: string, appended: string[]): string {
  const newline = frontmatter.includes('\r\n') ? '\r\n' : '\n';
  const opening = frontmatter.match(/^---\r?\n/);
  if (!opening) return frontmatter;
  const closingIndex = frontmatter.lastIndexOf(`${newline}---`);
  if (closingIndex === -1) return frontmatter;
  const bodyLines = frontmatter.slice(opening[0].length, closingIndex).split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < bodyLines.length; i++) {
    if (new RegExp(`^${key}:`).test(bodyLines[i])) {
      while (i + 1 < bodyLines.length && /^\s*-\s/.test(bodyLines[i + 1])) i += 1;
      continue;
    }
    kept.push(bodyLines[i]);
  }
  kept.push(...appended);
  return `---${newline}${kept.join(newline)}${newline}---${newline}`;
}

/** 写入 folded_properties：空数组时删除该键。 */
function writeFoldedProperties(frontmatter: string, ids: string[]): string {
  return rewriteFrontmatter(frontmatter, 'folded_properties', ids.length ? ['folded_properties:', ...ids.map((id) => `  - ${id}`)] : []);
}

/** 写入布尔开关（full_page / locked）：false 时删除该键。 */
function writeFrontmatterFlag(frontmatter: string, key: string, value: boolean): string {
  return rewriteFrontmatter(frontmatter, key, value ? [`${key}: true`] : []);
}

/** 写入标题。 */
function writeFrontmatterValue(frontmatter: string, key: string, value: string): string {
  return rewriteFrontmatter(frontmatter, key, [`${key}: ${JSON.stringify(value)}`]);
}

function Empty() {
  return <span className="akdb-row-view-empty">空</span>;
}
