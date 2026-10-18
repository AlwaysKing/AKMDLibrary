import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createReactBlockSpec } from '@blocknote/react';
import { FileText } from 'lucide-react';
import { useSpaceStore } from '../../stores/spaceStore';
import { isPendingRestore } from './blockClipboardState';
import { pagesApi, Page } from '../../api/pages';
import { removeBlocksEnhanced } from './blockHelpers';
import { getEditorPageContext } from './EditorPageContext';

function findPageInTree(tree: Page[], pageId: string): Page | null {
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
  const pageId = block.props.pageId || '';
  const navigate = useNavigate();
  const { currentSpace, pageTree } = useSpaceStore();
  const pageContext = getEditorPageContext(editor);
  const activeSpaceSlug = pageContext?.spaceSlug || currentSpace?.slug;
  const activePageTree = (pageContext?.pageTree || pageTree) as Page[];
  const activeCurrentPageId = pageContext?.currentPageId
    || window.location.pathname.match(/\/p\/([^/]+)$/)?.[1]
    || '';
  const [page, setPage] = useState<Page | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [creating, setCreating] = useState(false);
  // 使用 useRef 作为 StrictMode 守卫：ref 更新是同步的，StrictMode 双重执行 effect 时能正确读到
  const creatingGuardRef = useRef(false);

  // Detect stack position (hooks must be before early returns)
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [stackPos, setStackPos] = useState<'first' | 'middle' | 'last' | null>(null);

  // Auto-create child page when pageId is empty (inserted from slash menu)
  useEffect(() => {
    if (pageId || creatingGuardRef.current) return;
    if (!activeSpaceSlug) return;
    if (!activeCurrentPageId) { setNotFound(true); return; }

    creatingGuardRef.current = true;
    setCreating(true);
    const createPage = pageContext?.createSubpage
      ? pageContext.createSubpage('未命名页面', activeCurrentPageId)
      : pagesApi.create(activeSpaceSlug, { title: '未命名页面', parent_id: activeCurrentPageId });
    createPage
      .then(async (newPage) => {
        editor.updateBlock(block.id, { type: 'subpage', props: { pageId: newPage.id } } as any);
        // Notify sidebar
        document.dispatchEvent(new CustomEvent('subpage-created', { detail: { pageId: newPage.id } }));
        if (pageContext?.refreshPageTree) {
          await pageContext.refreshPageTree();
        } else {
          await useSpaceStore.getState().refreshAll();
        }
      })
      .catch(() => {
        setNotFound(true);
        setCreating(false);
        creatingGuardRef.current = false;
      });
  }, [pageId, activeSpaceSlug, activeCurrentPageId, pageContext?.createSubpage, pageContext?.refreshPageTree]);

  useEffect(() => {
    if (!pageId) return;
    // Try pageTree first
    const found = findPageInTree(activePageTree, pageId);
    if (found) {
      setPage(found);
      setNotFound(false);
      return;
    }
    // If page is being restored (undo), skip API call — pageTree will update via refreshAll
    if (isPendingRestore(pageId)) return;
    // Fallback: fetch from API
    if (activeSpaceSlug) {
      let cancelled = false;
      const fetchPage = async (retries = 1) => {
        try {
          const p = await pagesApi.get(activeSpaceSlug, pageId);
          if (!cancelled) { setPage(p); setNotFound(false); }
        } catch {
          if (cancelled) return;
          if (retries > 0) {
            await new Promise(r => setTimeout(r, 500));
            fetchPage(retries - 1);
          } else {
            setNotFound(true);
          }
        }
      };
      fetchPage();
      return () => { cancelled = true; };
    }
  }, [pageId, activePageTree, activeSpaceSlug]);

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
            removeBlocksEnhanced(editor, [block]);
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

  if (!pageId && creating) {
    return (
      <div className="py-1">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-notion-sidebarBg text-notion-textSecondary text-sm animate-pulse">
          <FileText className="w-4 h-4 flex-shrink-0" strokeWidth={1.7} />
          <span>创建子页面中...</span>
        </div>
      </div>
    );
  }

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
    if (pageContext?.pagePath) navigate(pageContext.pagePath(page.id));
    else if (currentSpace?.slug) navigate(`/s/${currentSpace.slug}/p/${page.id}`);
  };

  return (
    <div className="w-full" ref={wrapperRef} data-stack-pos={stackPos || undefined} data-page-id={pageId || undefined}>
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
    propSchema: { pageId: { default: '' } },
    content: 'none',
  },
  { render: SubpageComponent },
);
