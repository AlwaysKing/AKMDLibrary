import { useState } from 'react';
import { FileText, ChevronRight, X } from 'lucide-react';
import { Page } from '../../api/pages';

interface MoveToDialogProps {
  pageId: number;
  pageTree: Page[];
  onClose: () => void;
  onMove: (targetParentId: number | null) => void;
}

// Recursively collect IDs of a page and all its descendants
function collectDescendantIds(page: Page): number[] {
  const ids = [page.id];
  if (page.children) {
    for (const child of page.children) {
      ids.push(...collectDescendantIds(child));
    }
  }
  return ids;
}

function TreeItem({
  page,
  excludedIds,
  level,
  onSelect,
}: {
  page: Page;
  excludedIds: Set<number>;
  level: number;
  onSelect: (pageId: number) => void;
}) {
  const [expanded, setExpanded] = useState(level < 2);
  const hasChildren = page.children && page.children.length > 0;

  if (excludedIds.has(page.id)) return null;

  return (
    <div>
      <button
        onClick={() => onSelect(page.id)}
        className="w-full flex items-center h-[32px] rounded-md hover:bg-notion-hover transition-colors text-left group"
        style={{ paddingLeft: `${level * 16 + 8}px`, paddingRight: '8px' }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="flex items-center justify-center flex-shrink-0 mr-1.5 hover:bg-notion-border rounded transition-colors"
            style={{ width: '20px', height: '18px' }}
          >
            <ChevronRight className={`w-3 h-3 text-notion-textSecondary transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <span className="flex-shrink-0 mr-1.5" style={{ width: '20px' }} />
        )}
        <span className="flex items-center justify-center flex-shrink-0 mr-2" style={{ width: '20px', height: '18px' }}>
          {page.icon ? (
            <span className="text-[16px] leading-none" style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"' }}>{page.icon}</span>
          ) : (
            <FileText className="w-[16px] h-[16px] text-notion-textSecondary" strokeWidth={1.7} />
          )}
        </span>
        <span className="text-sm text-notion-text truncate flex-1">{page.title || '未命名页面'}</span>
      </button>
      {hasChildren && expanded && (
        <div>
          {page.children!.map((child) => (
            <TreeItem
              key={child.id}
              page={child}
              excludedIds={excludedIds}
              level={level + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MoveToDialog({ pageId, pageTree, onClose, onMove }: MoveToDialogProps) {
  // Find the page being moved and collect all its descendant IDs
  const excludedIds = new Set<number>();
  function findAndCollect(pages: Page[], targetId: number): boolean {
    for (const p of pages) {
      if (p.id === targetId) {
        excludedIds.add(...collectDescendantIds(p));
        return true;
      }
      if (p.children && findAndCollect(p.children, targetId)) {
        return true;
      }
    }
    return false;
  }
  findAndCollect(pageTree, pageId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white rounded-xl shadow-2xl border border-notion-border w-[380px] max-h-[500px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-notion-border">
          <h3 className="text-sm font-semibold text-notion-text">移动到</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-notion-hover rounded transition-colors"
          >
            <X className="w-4 h-4 text-notion-textSecondary" />
          </button>
        </div>

        {/* Page tree */}
        <div className="flex-1 overflow-y-auto py-2 px-2">
          {pageTree.map((page) => (
            <TreeItem
              key={page.id}
              page={page}
              excludedIds={excludedIds}
              level={0}
              onSelect={(id) => onMove(id)}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-notion-border px-4 py-2">
          <button
            onClick={() => onMove(null)}
            className="w-full flex items-center justify-center h-[32px] rounded-md hover:bg-notion-hover transition-colors text-sm text-notion-textSecondary"
          >
            移到根目录
          </button>
        </div>
      </div>
    </div>
  );
}
