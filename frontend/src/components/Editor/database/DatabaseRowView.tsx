import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Eye, EyeOff, Loader2, Maximize2, MessageSquare, MoreHorizontal, Pencil, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { databasesApi, type DatabaseColumn, type DatabaseDetail, type DatabaseRow } from '../../../api/databases';
import { usersApi } from '../../../api/users';
import { type User } from '../../../api/auth';
import {
  buildFormulaProps,
  ColumnIconGlyph,
  OptionSelect,
  OptionMultiSelect,
  PersonSelect,
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
  /** 全屏路由：左侧显示返回而不是展开 */
  className?: string;
}

/**
 * 数据库行（subpage）页面。
 * 顶部工具栏（左侧全局展开 / 右侧保存与菜单）+ 标题 + 属性列表 + 正文，
 * 居中弹层、右侧抽屉、全屏页三种打开方式共用这一份实现。
 */
export default function DatabaseRowView({ spaceSlug, dbId, rowId, onOpenFull, onBack, onClose, className }: Props) {
  const [schema, setSchema] = useState<DatabaseDetail | null>(null);
  const [row, setRow] = useState<DatabaseRow | null>(null);
  const [pageTitle, setPageTitle] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [frontmatter, setFrontmatter] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  /** 被折叠进“更多”的属性（只影响这个行页面的展示，存 subpage frontmatter） */
  const [foldedPropertyIds, setFoldedPropertyIds] = useState<string[]>([]);
  const [revealFolded, setRevealFolded] = useState(false);
  const [propertyMenu, setPropertyMenu] = useState<{ columnId: string; top: number; left: number } | null>(null);
  const [renamingColumnId, setRenamingColumnId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setDirty(false);
    Promise.all([
      databasesApi.get(spaceSlug, dbId),
      databasesApi.listRows(spaceSlug, dbId, { limit: 0 }),
      databasesApi.getRowPage(spaceSlug, dbId, rowId),
    ])
      .then(([detail, rowsRes, page]) => {
        if (!alive) return;
        setSchema(detail);
        setRow((rowsRes.rows || []).find((item) => item.uuid === rowId) || null);
        setPageTitle(page.title);
        const split = splitFrontmatter(page.markdown);
        setFrontmatter(split.frontmatter);
        setMarkdown(split.body);
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

  const usersByUUID = useMemo(() => new Map(users.map((user) => [user.uuid, user])), [users]);
  const props = useMemo(
    () => buildFormulaProps(schema?.columns || [], row || { uuid: rowId, values: {} }),
    [schema?.columns, row, rowId],
  );
  const editableColumns = useMemo(
    () => (schema?.columns || []).filter((column) => !column.auto && column.type !== 'formula' && column.type !== 'created_time' && column.type !== 'last_edited_time' && column.type !== 'last_edited_user' && column.type !== 'linked'),
    [schema?.columns],
  );
  const foldedSet = useMemo(() => new Set(foldedPropertyIds), [foldedPropertyIds]);
  const foldedColumns = editableColumns.filter((column) => foldedSet.has(column.id));
  // 折叠只控制“是否渲染”，属性顺序始终按 table 的列顺序；展开后回到原位。
  const displayColumns = revealFolded ? editableColumns : editableColumns.filter((column) => !foldedSet.has(column.id));
  const titleValue = editableColumns[0] ? String(row?.values?.[editableColumns[0].id] || '') : '';

  const save = async () => {
    if (saving || loading) return;
    setSaving(true);
    try {
      // 保留 frontmatter，只回写正文
      await databasesApi.putRowPage(spaceSlug, dbId, rowId, frontmatter + markdown);
      setDirty(false);
      setError('');
    } catch (err: any) {
      setError(err?.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const updateCell = async (column: DatabaseColumn, value: string) => {
    if (column.readonly) return;
    setRow((current) => current ? { ...current, values: { ...current.values, [column.id]: value } } : current);
    try {
      const next = await databasesApi.updateRow(spaceSlug, dbId, rowId, { [column.id]: value });
      setRow(next);
    } catch {
      setError('属性保存失败');
    }
  };

  // 选项类属性：新建选项要写回列 schema（config.options）。
  const createOption = async (column: DatabaseColumn, label: string) => {
    const options = Array.isArray(column.config?.options) ? [...column.config!.options] : [];
    const option = createOptionConfig(label, options);
    options.push(option);
    const next = await databasesApi.updateColumn(spaceSlug, dbId, column.id, { config: { ...(column.config || {}), options } });
    setSchema(next);
    return option;
  };

  // 属性是否可见（行页面）：折叠名单只属于这个行页面，存 subpage frontmatter（folded_properties）。
  const setPropertyFolded = (column: DatabaseColumn, folded: boolean) => {
    const current = new Set(foldedPropertyIds);
    if (folded) current.add(column.id);
    else current.delete(column.id);
    const nextIds = editableColumns.map((item) => item.id).filter((id) => current.has(id));
    const nextFrontmatter = writeFoldedProperties(frontmatter, nextIds);
    setFoldedPropertyIds(nextIds);
    setFrontmatter(nextFrontmatter);
    void databasesApi.putRowPage(spaceSlug, dbId, rowId, nextFrontmatter + markdown).catch(() => setError('属性显示设置保存失败'));
  };

  const commitRename = async (column: DatabaseColumn) => {
    const nextName = renameDraft.trim();
    setRenamingColumnId(null);
    if (!nextName || nextName === column.name) return;
    try {
      const next = await databasesApi.updateColumn(spaceSlug, dbId, column.id, { name: nextName });
      setSchema(next);
    } catch {
      setError('属性重命名失败');
    }
  };

  const deleteProperty = async (column: DatabaseColumn) => {
    try {
      const next = await databasesApi.deleteColumn(spaceSlug, dbId, column.id);
      setSchema(next);
    } catch {
      setError('删除属性失败');
    }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('.akdb-row-view-menu, .akdb-row-view-menu-btn')) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!propertyMenu) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.akdb-row-view-property-menu, .akdb-row-view-property-menu-btn')) return;
      setPropertyMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPropertyMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [propertyMenu]);

  const toggleMenu = () => {
    if (menuOpen) { setMenuOpen(false); return; }
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (rect) setMenuRect({ top: rect.bottom + 6, left: Math.max(8, rect.right - 220) });
    setMenuOpen(true);
  };

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
          <button type="button" className="akdb-row-view-save" disabled={saving || loading || !dirty} onClick={() => void save()}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button
            ref={menuButtonRef}
            type="button"
            className="akdb-row-view-tool-btn akdb-row-view-menu-btn"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={toggleMenu}
          >
            <MoreHorizontal size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      {error && <div className="akdb-row-view-error">{error}</div>}

      <div className="akdb-row-view-scroll">
        {loading ? (
          <div className="akdb-row-view-loading"><Loader2 size={16} />加载中…</div>
        ) : (
          <div className="akdb-row-view-page">
            <h1 className="akdb-row-view-title">{titleValue || pageTitle || '未命名'}</h1>
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
                        setPropertyMenu({ columnId: column.id, top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 228) });
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
            <textarea
              className="akdb-row-view-body"
              aria-label="行页面正文"
              value={markdown}
              onChange={(event) => { setMarkdown(event.currentTarget.value); setDirty(true); }}
              spellCheck={false}
            />
          </div>
        )}
      </div>

      {menuOpen && menuRect && createPortal(
        <div className="akdb-view-settings-menu akdb-row-view-menu" role="menu" style={{ position: 'fixed', top: menuRect.top, left: menuRect.left, width: 220 }}>
          <button type="button" className="akdb-row-context-item" role="menuitem" onClick={() => { setMenuOpen(false); void save(); }}>
            <Check size={16} strokeWidth={2} />
            <span>保存</span>
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
                onClick={() => {
                  setRenameDraft(column.name);
                  setRenamingColumnId(column.id);
                }}
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

function PropertyValue({ column, value, formulaValue, usersByUUID, onChange, onCreateOption }: {
  column: DatabaseColumn;
  value: string;
  formulaValue?: any;
  usersByUUID: Map<string, User>;
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
    return value === 'true'
      ? <button type="button" className="akdb-row-view-checkbox-btn" aria-label="取消勾选" onClick={() => onChange('false')}><Check size={15} strokeWidth={2} className="akdb-row-view-check" /></button>
      : <button type="button" className="akdb-row-view-checkbox-btn" aria-label="勾选" onClick={() => onChange('true')}><span className="akdb-row-view-checkbox" /></button>;
  }
  if (column.type === 'select' || column.type === 'status') {
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
    return (
      <span ref={anchorRef} className="akdb-row-view-editor">
        <OptionMultiSelect
          ids={parseMultiSelectValue(value)}
          options={(column.config?.options || []) as any[]}
          config={column.config || {}}
          anchorRef={anchorRef}
          onCreate={onCreateOption}
          onChange={(ids) => onChange(JSON.stringify(ids))}
        />
      </span>
    );
  }
  if (column.type === 'person') {
    const multiple = personColumnMultiple(column);
    const ids = personValueIDs(value);
    return (
      <span ref={anchorRef} className="akdb-row-view-editor">
        <PersonSelect
          value={multiple ? '' : (ids[0] || '')}
          ids={ids}
          userMap={usersByUUID}
          multiple={multiple}
          displayStyle={column.config?.display_style || 'icon_name'}
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
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => { if (draft !== value) onChange(draft); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (draft !== value) onChange(draft);
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

function formatDateValue(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

/** 把行页面的 frontmatter 与正文拆开：正文进编辑区，frontmatter 保存时原样带回。 */
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

/** 写入 folded_properties：空数组时删除该键。 */
function writeFoldedProperties(frontmatter: string, ids: string[]): string {
  const newline = frontmatter.includes('\r\n') ? '\r\n' : '\n';
  const opening = frontmatter.match(/^---\r?\n/);
  if (!opening) return frontmatter;
  const closingIndex = frontmatter.lastIndexOf(`${newline}---`);
  if (closingIndex === -1) return frontmatter;
  const bodyLines = frontmatter.slice(opening[0].length, closingIndex).split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < bodyLines.length; i++) {
    if (/^folded_properties:/.test(bodyLines[i])) {
      while (i + 1 < bodyLines.length && /^\s*-\s/.test(bodyLines[i + 1])) i += 1;
      continue;
    }
    kept.push(bodyLines[i]);
  }
  if (ids.length) {
    kept.push('folded_properties:', ...ids.map((id) => `  - ${id}`));
  }
  return `---${newline}${kept.join(newline)}${newline}---${newline}`;
}

function Empty() {
  return <span className="akdb-row-view-empty">空</span>;
}
