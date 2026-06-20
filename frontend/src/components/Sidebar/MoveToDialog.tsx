import { useState, useRef, useMemo, useCallback } from 'react';
import { FileText, ChevronRight, Search } from 'lucide-react';
import { Page } from '../../api/pages';

interface MoveToDialogProps {
  pageId: string;
  pageTree: Page[];
  onClose: () => void;
  onMove: (targetParentId: string | null) => void;
  position?: { top: number; left: number };
}

// Recursively collect IDs of a page and all its descendants
function collectDescendantIds(page: Page): string[] {
  const ids = [page.id];
  if (page.children) {
    for (const child of page.children) {
      ids.push(...collectDescendantIds(child));
    }
  }
  return ids;
}

function searchAllPages(pages: Page[], query: string, excludedIds: Set<string>): Page[] {
  const results: Page[] = [];
  const q = query.toLowerCase();
  for (const p of pages) {
    if (!excludedIds.has(p.id) && (p.title || '未命名页面').toLowerCase().includes(q)) {
      results.push(p);
    }
    if (p.children) {
      results.push(...searchAllPages(p.children, query, excludedIds));
    }
  }
  return results;
}

function renderIcon(icon?: string) {
  if (icon) {
    if (icon.startsWith('/') || icon.startsWith('http')) {
      return <img src={icon} alt="" className="w-[16px] h-[16px] object-contain" />;
    }
    return <span className="text-[16px] leading-none" style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"' }}>{icon}</span>;
  }
  return <FileText className="w-[16px] h-[16px] text-notion-textSecondary" strokeWidth={1.7} />;
}

// Recursive tree item for the move dialog
function MoveToTreeItem({
  page,
  level,
  expandedIds,
  onToggleExpand,
  onMoveTo,
  excludedIds,
}: {
  page: Page;
  level: number;
  expandedIds: Set<string>;
  onToggleExpand: (pageId: string) => void;
  onMoveTo: (pageId: string) => void;
  excludedIds: Set<string>;
}) {
  const hasChildren = page.children && page.children.length > 0 &&
    page.children.some(c => !excludedIds.has(c.id));
  const isExpanded = expandedIds.has(page.id);

  return (
    <>
      <div
        className="w-full flex items-center h-[30px] rounded-md hover:bg-notion-hover transition-colors text-left"
        style={{ paddingLeft: `${level * 16 + 8}px`, paddingRight: '8px' }}
      >
        {/* Chevron or spacer */}
        <button
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggleExpand(page.id); }}
          className="flex items-center justify-center flex-shrink-0 rounded transition-colors hover:bg-black/[0.08]"
          style={{ width: '20px', height: '18px' }}
        >
          {hasChildren ? (
            <ChevronRight className={`w-3 h-3 text-[#ada9a3] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          ) : null}
        </button>

        {/* Icon + Title row: clicking moves the page here */}
        <div
          className="flex items-center flex-1 min-w-0 cursor-pointer h-full rounded"
          onClick={() => onMoveTo(page.id)}
        >
          <span className="flex items-center justify-center flex-shrink-0 mr-1.5" style={{ width: '18px', height: '18px' }}>
            {renderIcon(page.icon)}
          </span>
          <span className="text-sm text-notion-sidebarText truncate">
            {page.title || '未命名页面'}
          </span>
        </div>
      </div>

      {/* Expanded children */}
      {isExpanded && hasChildren && (
        page.children!
          .filter(child => !excludedIds.has(child.id))
          .map(child => (
            <MoveToTreeItem
              key={child.id}
              page={child}
              level={level + 1}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onMoveTo={onMoveTo}
              excludedIds={excludedIds}
            />
          ))
      )}
    </>
  );
}

export default function MoveToDialog({ pageId, pageTree, onClose, onMove, position }: MoveToDialogProps) {
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  // Collect excluded IDs (self + descendants)
  const excludedIds = useMemo(() => {
    const ids = new Set<string>();
    function findAndCollect(pages: Page[], targetId: string): boolean {
      for (const p of pages) {
        if (p.id === targetId) {
          for (const id of collectDescendantIds(p)) ids.add(id);
          return true;
        }
        if (p.children && findAndCollect(p.children, targetId)) return true;
      }
      return false;
    }
    findAndCollect(pageTree, pageId);
    return ids;
  }, [pageTree, pageId]);

  const searchResults = useMemo(() =>
    search ? searchAllPages(pageTree, search, excludedIds) : [],
    [pageTree, search, excludedIds]
  );

  // Filter root-level pages (excluding self + descendants)
  const rootPages = useMemo(() =>
    pageTree.filter(p => !excludedIds.has(p.id)),
    [pageTree, excludedIds]
  );

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleMoveTo = useCallback((targetId: string) => {
    onMove(targetId);
  }, [onMove]);

  // Calculate position with viewport clamping
  const dialogStyle: React.CSSProperties = position
    ? { position: 'fixed', top: position.top, left: position.left, zIndex: 50 }
    : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 50 };

  if (position) {
    const dialogWidth = 380;
    const dialogHeight = 400;
    let top = position.top;
    let left = position.left;
    if (left + dialogWidth > window.innerWidth - 8) left = window.innerWidth - dialogWidth - 8;
    if (left < 8) left = 8;
    if (top + dialogHeight > window.innerHeight - 8) top = window.innerHeight - dialogHeight - 8;
    if (top < 8) top = 8;
    dialogStyle.top = top;
    dialogStyle.left = left;
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div style={dialogStyle} className="bg-white rounded-xl shadow-2xl border border-notion-border w-[380px] max-h-[400px] flex flex-col overflow-hidden">
        {/* Search input */}
        <div className="px-3 pt-3 pb-1">
          <div className="flex items-center gap-2 px-2 py-1.5 bg-notion-bg rounded-md border border-notion-border focus-within:border-blue-400">
            <Search className="w-3.5 h-3.5 text-notion-textSecondary flex-shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索页面..."
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-notion-textSecondary"
              onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
              autoFocus
            />
          </div>
        </div>

        {/* Tree list or search results */}
        <div className="flex-1 overflow-y-auto py-0.5 px-1.5 min-h-0">
          {search ? (
            // Search mode: flat list of matching pages
            searchResults.length === 0 ? (
              <div className="text-sm text-notion-textSecondary px-3 py-4 text-center">
                没有找到匹配的页面
              </div>
            ) : (
              searchResults.map(page => (
                <div
                  key={page.id}
                  onClick={() => handleMoveTo(page.id)}
                  className="flex items-center h-[30px] rounded-md hover:bg-notion-hover transition-colors cursor-pointer px-2"
                >
                  <span className="flex items-center justify-center flex-shrink-0 mr-2" style={{ width: '18px', height: '18px' }}>
                    {renderIcon(page.icon)}
                  </span>
                  <span className="text-sm text-notion-sidebarText truncate">{page.title || '未命名页面'}</span>
                </div>
              ))
            )
          ) : (
            // Tree mode: hierarchical page tree with expand/collapse
            rootPages.length === 0 ? (
              <div className="text-sm text-notion-textSecondary px-3 py-4 text-center">
                没有可移动的目标页面
              </div>
            ) : (
              rootPages.map(page => (
                <MoveToTreeItem
                  key={page.id}
                  page={page}
                  level={0}
                  expandedIds={expandedIds}
                  onToggleExpand={handleToggleExpand}
                  onMoveTo={handleMoveTo}
                  excludedIds={excludedIds}
                />
              ))
            )
          )}
        </div>

        {/* Root level option */}
        {!search && (
          <div className="border-t border-notion-border/60 px-2 py-1">
            <button
              onClick={() => onMove(null)}
              className="w-full flex items-center h-[30px] rounded-md hover:bg-notion-hover transition-colors text-sm text-notion-textSecondary justify-center"
            >
              移到根目录
            </button>
          </div>
        )}
      </div>
    </>
  );
}
