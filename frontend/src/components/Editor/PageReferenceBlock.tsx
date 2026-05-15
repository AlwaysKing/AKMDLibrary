import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createReactBlockSpec } from '@blocknote/react';
import { FileText } from 'lucide-react';
import { useSpaceStore } from '../../stores/spaceStore';
import { pagesApi, Page } from '../../api/pages';

function findPageInTree(tree: Page[], pageId: number): Page | null {
  for (const page of tree) {
    if (page.id === pageId) return page;
    if (page.children) {
      const found = findPageInTree(page.children, pageId);
      if (found) return found;
    }
  }
  return null;
}

function PageReferenceComponent({ block, editor }: any) {
  const pageId = parseInt(block.props.pageId || '0');
  const navigate = useNavigate();
  const { currentSpace, pageTree } = useSpaceStore();
  const [page, setPage] = useState<Page | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!pageId) { setNotFound(true); return; }
    // Try pageTree first
    const found = findPageInTree(pageTree, pageId);
    if (found) {
      setPage(found);
      return;
    }
    // Fallback: fetch from API
    if (currentSpace?.slug) {
      pagesApi.get(currentSpace.slug, pageId)
        .then(p => { setPage(p); setNotFound(false); })
        .catch(() => setNotFound(true));
    }
  }, [pageId, pageTree, currentSpace?.slug]);

  // Keyboard: Backspace/Delete removes the block when selected
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const selected = document.querySelector('.ProseMirror-selectednode');
        if (selected && selected.contains(document.activeElement)) {
          // Check if it's our block
          const ref = selected.querySelector('[data-content-type="pageReference"]');
          if (ref && ref.getAttribute('data-page-id') === String(pageId)) {
            e.preventDefault();
            editor.removeBlocks([block]);
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [block, editor, pageId]);

  if (notFound || !pageId) {
    return (
      <div className="py-1">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-notion-sidebarBg text-notion-textSecondary text-sm">
          <FileText className="w-4 h-4 flex-shrink-0" strokeWidth={1.7} />
          <span>页面不存在或已删除</span>
        </div>
      </div>
    );
  }

  if (!page) {
    return (
      <div className="py-1">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-notion-sidebarBg text-notion-textSecondary text-sm animate-pulse">
          <FileText className="w-4 h-4 flex-shrink-0" strokeWidth={1.7} />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  const handleDoubleClick = () => {
    const slug = currentSpace?.slug;
    if (slug) {
      navigate(`/s/${slug}/p/${page.id}`);
    }
  };

  return (
    <div className="w-full">
      <div
        onDoubleClick={handleDoubleClick}
        className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-notion-hover cursor-pointer transition-colors w-full"
        title="双击打开页面"
      >
        <span className="flex-shrink-0" style={{ width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {page.icon ? (
            (page.icon.startsWith('/') || page.icon.startsWith('http')) ? (
              <img src={page.icon} alt="" className="w-[18px] h-[18px] object-contain" />
            ) : (
              <span className="text-[18px] leading-none" style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"' }}>{page.icon}</span>
            )
          ) : (
            <FileText className="w-[18px] h-[18px] text-[#91918e]" strokeWidth={1.7} />
          )}
        </span>
        <span className="text-sm font-medium text-notion-text">{page.title || '未命名页面'}</span>
      </div>
    </div>
  );
}

export const PageReferenceBlockSpec = createReactBlockSpec(
  {
    type: 'pageReference',
    propSchema: { pageId: { default: '0' } },
    content: 'none',
  },
  { render: PageReferenceComponent },
);
