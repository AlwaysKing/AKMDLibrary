import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, X, ChevronDown, ChevronRight, FileText, Hash, ListFilter } from 'lucide-react';
import { SearchHit, SearchMode, streamSearch } from '../../api/search';
import { Page, pagesApi } from '../../api/pages';

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  spaceSlug: string;
}

// PageTreePicker — nested page list shown in the subtree dropdown. Each row
// is selectable; clicking a row sets subtree to that page's file_path (which
// the backend resolves to "this page + all descendants"). Rows with children
// have an expand/collapse chevron.
function PageTreePicker({ pages, selectedPath, onSelect }: {
  pages: Page[];
  selectedPath: string;
  onSelect: (filePath: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderNode = (page: Page, depth: number): React.ReactNode => {
    const hasChildren = !!(page.children && page.children.length > 0);
    const isSelected = selectedPath === page.file_path;
    return (
      <div key={page.id}>
        <div
          onClick={() => onSelect(page.file_path)}
          className={`flex items-center gap-1 cursor-pointer rounded transition-colors h-[28px] text-xs ${
            isSelected
              ? 'bg-notion-hover font-medium text-notion-text'
              : 'text-notion-textSecondary hover:bg-notion-hover/60'
          }`}
          style={{ paddingLeft: `${12 + depth * 14}px`, paddingRight: '12px' }}
          title={page.title || '(未命名)'}
        >
          <span className="flex-shrink-0 w-4 flex items-center justify-center">
            {hasChildren ? (
              <button
                onClick={(e) => { e.stopPropagation(); toggle(page.id); }}
                className="p-0.5 hover:bg-notion-border rounded flex items-center justify-center"
              >
                {expanded.has(page.id)
                  ? <ChevronDown className="w-3 h-3" />
                  : <ChevronRight className="w-3 h-3" />}
              </button>
            ) : null}
          </span>
          {page.icon
            ? <span className="flex-shrink-0 text-sm leading-none">{page.icon}</span>
            : <FileText className="w-3 h-3 flex-shrink-0 text-notion-textSecondary" />}
          <span className="truncate flex-1">{page.title || '(未命名)'}</span>
        </div>
        {hasChildren && expanded.has(page.id) && (
          <div>{page.children!.map(c => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  return <div>{pages.map(p => renderNode(p, 0))}</div>;
}

export default function SearchOverlay({ open, onClose, spaceSlug }: SearchOverlayProps) {
  const navigate = useNavigate();

  // Query input. Each change resets the streaming session via useEffect below.
  const [query, setQuery] = useState('');
  // Filter toggle. When off (default), the filter row is hidden and we use
  // defaults: title-only search, whole-space scope.
  const [filterOn, setFilterOn] = useState(false);
  const [mode, setMode] = useState<SearchMode>('title');
  const [subtree, setSubtree] = useState<string>('');

  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Dropdown open state for the subtree dropdown.
  const [subtreeMenuOpen, setSubtreeMenuOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cache the page tree just once per open so we can populate the subtree
  // dropdown without re-fetching on every keystroke.
  const [pages, setPages] = useState<Page[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    pagesApi.getTree(spaceSlug).then(tree => {
      if (!cancelled) setPages(tree);
    }).catch(() => { /* tree load failure is non-fatal */ });
    return () => { cancelled = true; };
  }, [open, spaceSlug]);

  // Find selected page's title for the dropdown label by walking the tree.
  const findPageByPath = useCallback((list: Page[], path: string): Page | null => {
    for (const p of list) {
      if (p.file_path === path) return p;
      if (p.children?.length) {
        const found = findPageByPath(p.children, path);
        if (found) return found;
      }
    }
    return null;
  }, []);

  // Reset everything each time the overlay opens so previous session's
  // query/results don't leak in.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHits([]);
    setFilterOn(false);
    setMode('title');
    setSubtree('');
    setSelectedIdx(0);
    setSearching(false);
    // Focus input on next paint — overlay just mounted.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Streaming search effect. Fires when query/subtree/mode/filterOn/space
  // changes. Aborts any in-flight search before starting the next one.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearching(false);
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    // When filter is off we force title-only mode, regardless of the
    // dropdown value, to honor "default: 仅标题".
    const effectiveMode: SearchMode = filterOn ? mode : 'title';
    const effectiveSubtree = filterOn ? subtree : '';

    setHits([]);
    setSelectedIdx(0);
    setSearching(true);

    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;

    streamSearch({
      spaceSlug,
      query: q,
      subtree: effectiveSubtree,
      mode: effectiveMode,
      signal: ctrl.signal,
      onHit: (hit) => {
        setHits(prev => [...prev, hit]);
      },
    }).then(() => {
      setSearching(false);
    }).catch((e: unknown) => {
      // AbortError fires when user types a new char or closes the overlay;
      // not a real error.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setSearching(false);
    });

    return () => { ctrl.abort(); };
  }, [open, query, mode, subtree, filterOn, spaceSlug]);

  // Keyboard: Esc closes (caller also handles), arrows move selection, Enter
  // opens the selected hit. We bind to the input keydown so it doesn't
  // interfere with the page editor's shortcuts.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // IME composition (Chinese/Japanese/Korean input). Enter is used to
    // confirm the candidate; we must NOT treat it as "open selected hit".
    // Bail out so the IME gets the keypress, then a second Enter (after
    // composition ends) will hit the handlers below.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, Math.max(0, hits.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const target = hits[selectedIdx];
      if (target && target.page_id) {
        navigate(`/s/${spaceSlug}/p/${target.page_id}`);
        onClose();
      }
      return;
    }
  }, [hits, selectedIdx, navigate, onClose, spaceSlug]);

  const handleHitClick = useCallback((hit: SearchHit) => {
    if (!hit.page_id) return;
    navigate(`/s/${spaceSlug}/p/${hit.page_id}`);
    onClose();
  }, [navigate, onClose, spaceSlug]);

  // Click-outside closes the overlay. Clicks inside the panel stop propagation.
  const handleBackdropMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!open) return null;

  const subtreeLabel = subtree === ''
    ? '整个空间'
    : (findPageByPath(pages, subtree)?.title || subtree);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] bg-black/30 flex items-start justify-center pt-[12vh]"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[640px] max-w-[92vw] border border-notion-border"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Search bar row */}
        <div className="flex items-center gap-2 px-3 h-12 border-b border-notion-border/60 rounded-t-xl">
          <Search className="w-4 h-4 text-notion-textSecondary flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入搜索词..."
            className="flex-1 bg-transparent outline-none text-sm text-notion-text placeholder:text-notion-textSecondary"
          />
          <button
            onClick={() => setFilterOn(!filterOn)}
            className={`p-1.5 rounded-md transition-colors ${
              filterOn
                ? 'bg-[#4285F4] text-white'
                : 'text-notion-textSecondary hover:bg-notion-hover'
            }`}
            title="开启/关闭过滤"
          >
            <ListFilter className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-notion-hover rounded transition-colors"
            title="关闭 (Esc)"
          >
            <X className="w-3.5 h-3.5 text-notion-textSecondary" />
          </button>
        </div>

        {/* Filter row — only visible when 开启过滤 is on. Defaults hidden. */}
        {filterOn && (
          <div className="flex items-center gap-1 px-3 py-2 border-b border-notion-border/60">
            <button
              onClick={() => setMode(mode === 'title' ? 'all' : 'title')}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                mode === 'all'
                  ? 'bg-[#4285F4] text-white'
                  : 'text-notion-textSecondary hover:bg-notion-hover'
              }`}
              title={mode === 'all' ? '当前：标题+内容，点击切回仅标题' : '当前：仅标题，点击切到标题+内容'}
            >
              标题+内容
            </button>

            <div className="relative">
              <button
                onClick={() => setSubtreeMenuOpen(!subtreeMenuOpen)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-notion-hover transition-colors text-notion-text max-w-[240px] truncate"
              >
                {subtreeLabel}
                <ChevronDown className="w-3 h-3 flex-shrink-0" />
              </button>
              {subtreeMenuOpen && (
                <>
                  <div className="fixed inset-0 z-[210]" onClick={() => setSubtreeMenuOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 bg-white border border-notion-border rounded-md shadow-lg z-[211] py-1 min-w-[260px] max-w-[400px] max-h-[320px] overflow-y-auto">
                    <button
                      onClick={() => {
                        setSubtree('');
                        setSubtreeMenuOpen(false);
                      }}
                      className={`w-full flex items-center h-[28px] px-3 text-xs hover:bg-notion-hover transition-colors ${
                        subtree === '' ? 'bg-notion-hover font-medium text-notion-text' : 'text-notion-textSecondary'
                      }`}
                    >
                      整个空间
                    </button>
                    {pages.length > 0 && (
                      <div className="border-t border-notion-border/60 my-1" />
                    )}
                    <PageTreePicker
                      pages={pages}
                      selectedPath={subtree}
                      onSelect={(fp) => {
                        setSubtree(fp);
                        setSubtreeMenuOpen(false);
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Results — streaming list. Order matches filesystem walk order
            on the server; we don't sort so the earliest hits appear first. */}
        <div className="max-h-[55vh] overflow-y-auto">
          {hits.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-notion-textSecondary">
              {query.trim() === ''
                ? '输入关键词开始搜索'
                : searching
                  ? '搜索中...'
                  : '未找到匹配文档'}
            </div>
          ) : (
            <ul className="py-1">
              {hits.map((hit, idx) => (
                <li key={`${hit.path}:${idx}`}>
                  <button
                    onMouseEnter={() => setSelectedIdx(idx)}
                    onClick={() => handleHitClick(hit)}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors ${
                      idx === selectedIdx ? 'bg-notion-hover' : 'hover:bg-notion-hover/60'
                    } ${!hit.page_id ? 'cursor-default opacity-70' : 'cursor-pointer'}`}
                    disabled={!hit.page_id}
                  >
                    <div className="flex-shrink-0 pt-0.5">
                      {hit.match_type === 'content'
                        ? <Hash className="w-3.5 h-3.5 text-notion-textSecondary" />
                        : <FileText className="w-3.5 h-3.5 text-notion-textSecondary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-notion-text truncate">
                        {hit.title || '(未命名)'}
                      </div>
                      {hit.path && hit.path !== `${hit.title}.md` && (
                        <div className="text-xs text-notion-textSecondary truncate mt-0.5">
                          {hit.path}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-notion-border/60 px-3 py-1.5 flex items-center justify-between text-[11px] text-notion-textSecondary rounded-b-xl">
          <div className="flex items-center gap-3">
            <span><kbd className="px-1 py-0.5 bg-notion-hover rounded">↑↓</kbd> 选择</span>
            <span><kbd className="px-1 py-0.5 bg-notion-hover rounded">Enter</kbd> 跳转</span>
            <span><kbd className="px-1 py-0.5 bg-notion-hover rounded">Esc</kbd> 关闭</span>
          </div>
          {searching && <span className="text-notion-textSecondary">搜索中…</span>}
          {!searching && hits.length > 0 && (
            <span>找到 {hits.length} 个结果</span>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
