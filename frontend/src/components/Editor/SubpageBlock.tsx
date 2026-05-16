import { useState, useEffect, useRef } from 'react';
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

function SubpageComponent({ block, editor }: any) {
  const pageId = parseInt(block.props.pageId || '0');
  const navigate = useNavigate();
  const { currentSpace, pageTree } = useSpaceStore();
  const [page, setPage] = useState<Page | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Detect stack position (hooks must be before early returns)
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [stackPos, setStackPos] = useState<'first' | 'middle' | 'last' | null>(null);

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
          const ref = selected.querySelector('[data-content-type="subpage"]');
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

  // Check if adjacent blocks are also subpages → determine stack position
  useEffect(() => {
    if (wrapperRef.current) {
      const outer = wrapperRef.current.closest('.bn-block-outer');
      const prev = outer?.previousElementSibling;
      const next = outer?.nextElementSibling;
      const prevSub = !!prev?.querySelector('[data-content-type="subpage"]');
      const nextSub = !!next?.querySelector('[data-content-type="subpage"]');
      if (prevSub && nextSub) setStackPos('middle');
      else if (!prevSub && nextSub) setStackPos('first');
      else if (prevSub && !nextSub) setStackPos('last');
      else setStackPos(null);
    }
  });

  if (notFound || !pageId) {
    return (
      <div className="py-1">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-notion-sidebarBg text-notion-textSecondary text-sm">
          <FileText className="w-4 h-4 flex-shrink-0" strokeWidth={1.7} />
          <span>子页面不存在或已删除</span>
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

  const handleClick = () => {
    const slug = currentSpace?.slug;
    if (slug) {
      navigate(`/s/${slug}/p/${page.id}`);
    }
  };

  return (
    <div className="w-full" ref={wrapperRef} data-stack-pos={stackPos || undefined}>
      <div
        onClick={handleClick}
        className="flex items-center gap-1 py-0.5 rounded hover:bg-notion-hover cursor-pointer transition-colors w-full"
        style={{ marginLeft: '-2px', marginRight: '-2px', paddingLeft: '2px', paddingRight: '2px' }}
        title="点击打开页面"
      >
        <span className="flex-shrink-0 flex items-center justify-center" style={{ width: '24px', height: '24px' }}>
          {page.icon ? (
            (page.icon.startsWith('/') || page.icon.startsWith('http')) ? (
              <img src={page.icon} alt="" className="w-[20px] h-[20px] object-contain" />
            ) : (
              <span className="text-[20px] leading-none" style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"' }}>{page.icon}</span>
            )
          ) : (
            <svg viewBox="4.12 2.37 11.75 15.25" style={{ width: '19.8px', height: '19.8px', fill: '#91918e', overflow: 'visible', flexShrink: 0 }}>
              <path d="M13.3 14.25a.55.55 0 0 1-.55.55h-5.5a.55.55 0 1 1 0-1.1h5.5a.55.55 0 0 1 .55.55m-.55-1.95a.55.55 0 1 0 0-1.1h-5.5a.55.55 0 0 0 0 1.1z" />
              <path d="M6.25 2.375A2.125 2.125 0 0 0 4.125 4.5v11c0 1.174.951 2.125 2.125 2.125h7.5a2.125 2.125 0 0 0 2.125-2.125V8.121c0-.563-.224-1.104-.622-1.502L11.63 2.997a2.13 2.13 0 0 0-1.502-.622zM5.375 4.5c0-.483.392-.875.875-.875h3.7V6.25A2.05 2.05 0 0 0 12 8.3h2.625v7.2a.875.875 0 0 1-.875.875h-7.5a.875.875 0 0 1-.875-.875zm8.691 2.7H12a.95.95 0 0 1-.95-.95V4.184z" />
            </svg>
          )}
        </span>
        <span className="text-[16px] font-medium text-notion-text" style={{ lineHeight: 1.3, borderBottom: '1px solid rgba(55, 53, 47, 0.16)' }}>{page.title || '未命名页面'}</span>
      </div>
    </div>
  );
}

export const SubpageBlockSpec = createReactBlockSpec(
  {
    type: 'subpage',
    propSchema: { pageId: { default: '0' } },
    content: 'none',
  },
  { render: SubpageComponent },
);
