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

function PageReferenceComponent({ block }: any) {
  const pageId = parseInt(block.props.pageId || '0');
  const navigate = useNavigate();
  const { currentSpace, pageTree } = useSpaceStore();
  const [page, setPage] = useState<Page | null>(null);

  useEffect(() => {
    if (!pageId) return;
    // Try pageTree first
    const found = findPageInTree(pageTree, pageId);
    if (found) {
      setPage(found);
      return;
    }
    // Fallback: fetch from API
    if (currentSpace?.slug) {
      pagesApi.get(currentSpace.slug, pageId).then(p => setPage(p)).catch(() => {});
    }
  }, [pageId, pageTree, currentSpace?.slug]);

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

  const handleClick = () => {
    const slug = currentSpace?.slug;
    if (slug) {
      navigate(`/s/${slug}/p/${page.id}`);
    }
  };

  return (
    <div className="py-1">
      <div
        onClick={handleClick}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-notion-sidebarBg hover:bg-[#e8e7e3] cursor-pointer transition-colors max-w-fit"
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
