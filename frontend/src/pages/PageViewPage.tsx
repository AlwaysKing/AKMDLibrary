import { useEffect, useCallback, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePageStore } from '../stores/pageStore';
import { useSpaceStore } from '../stores/spaceStore';
import Breadcrumb from '../components/Editor/Breadcrumb';
import CoverImage from '../components/Editor/CoverImage';
import PageIcon from '../components/Editor/PageIcon';
import PageEditor from '../components/Editor/PageEditor';
import { MoreHorizontal } from 'lucide-react';

// Separate component so useEffect runs in its own render cycle
function PageNotFound({ spaceSlug }: { spaceSlug?: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (spaceSlug) {
      navigate(`/s/${spaceSlug}`, { replace: true });
    }
  }, [spaceSlug, navigate]);
  return null;
}

export default function PageViewPage() {
  const { spaceSlug, pageId } = useParams<{ spaceSlug: string; pageId: string }>();
  const navigate = useNavigate();
  const { currentPage, currentContent, fetchPage, isLoading, error, savePage, refreshPageTree, updateMetadata } = usePageStore();
  const { setCurrentSpace } = useSpaceStore();

  useEffect(() => {
    if (spaceSlug && pageId) {
      fetchPage(spaceSlug, parseInt(pageId));
      const spaces = useSpaceStore.getState().spaces;
      const space = spaces.find((s) => s.slug === spaceSlug);
      if (space) {
        setCurrentSpace(space);
      }
    }
  }, [spaceSlug, pageId, fetchPage, setCurrentSpace]);

  const handleSave = useCallback(async (content: string) => {
    if (!spaceSlug || !pageId) return;
    await savePage(spaceSlug, parseInt(pageId), content);
    await refreshPageTree();
  }, [spaceSlug, pageId, savePage, refreshPageTree]);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const [showPageMenu, setShowPageMenu] = useState(false);

  const handleFullPageToggle = useCallback(async () => {
    if (!spaceSlug || !pageId || !currentPage) return;
    const newFullPage = !currentPage.full_page;
    await updateMetadata(spaceSlug, parseInt(pageId), { full_page: newFullPage });
  }, [spaceSlug, pageId, currentPage, updateMetadata]);

  const handleTitleBlur = useCallback(async () => {
    const newTitle = titleRef.current?.textContent?.trim() || '';
    const currentTitle = usePageStore.getState().currentPage?.title;
    if (newTitle && newTitle !== currentTitle && spaceSlug && pageId) {
      await updateMetadata(spaceSlug, parseInt(pageId), { title: newTitle });
      await refreshPageTree();
    } else if (!newTitle && titleRef.current) {
      titleRef.current.textContent = currentTitle || '未命名页面';
    }
  }, [spaceSlug, pageId, updateMetadata, refreshPageTree]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      titleRef.current?.blur();
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-notion-border border-t-notion-text"></div>
      </div>
    );
  }

  if (error) {
    return <PageNotFound spaceSlug={spaceSlug} />;
  }

  if (!currentPage) {
    // Not loading, no error, but no page — page was deleted or doesn't exist
    if (spaceSlug) {
      navigate(`/s/${spaceSlug}`, { replace: true });
    }
    return null;
  }

  const showCover = !!currentPage.cover_url;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-notion-bg">
      {/* Breadcrumb — 固定在顶部，不随内容滚动 */}
      <Breadcrumb
        pageTitle={currentPage.title}
        spaceSlug={spaceSlug!}
        actions={
          <div className="relative">
            <button
              onClick={() => setShowPageMenu(!showPageMenu)}
              className="p-1 hover:bg-notion-hover rounded transition-colors"
            >
              <MoreHorizontal className="w-4 h-4 text-notion-textSecondary" />
            </button>
            {showPageMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowPageMenu(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-notion-border rounded-lg shadow-xl z-50 min-w-[200px] py-1">
                  <button
                    onClick={handleFullPageToggle}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-notion-text hover:bg-notion-hover transition-colors"
                  >
                    <span>全宽页面</span>
                    <div className={`w-8 h-4 rounded-full transition-colors relative ${currentPage.full_page ? 'bg-blue-500' : 'bg-gray-300'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${currentPage.full_page ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        }
      />

      {/* 可滚动的内容区域 — Breadcrumb 固定，只有这部分滚动 */}
      <div className="flex-1 overflow-y-auto">

        {/* Cover image - full width at top */}
        {showCover && (
          <CoverImage
            coverUrl={currentPage.cover_url}
            spaceSlug={spaceSlug!}
            pageId={currentPage.id}
          />
        )}

        {/* Page content area */}
        <div className={`${currentPage.full_page ? 'w-full' : 'max-w-[720px]'} mx-auto w-full pb-32 relative group/page-header ${!showCover ? 'pt-[80px]' : ''}`}>

          {/* Icon - large display, overlaps cover when cover exists (Notion: margin-top: -42px) */}
          {currentPage.icon && (
            <div className={showCover ? 'relative -mt-[42px] mb-[40px] ml-2' : 'mb-[40px] ml-2'}>
              <PageIcon
                icon={currentPage.icon}
                spaceSlug={spaceSlug!}
                pageId={currentPage.id}
              />
            </div>
          )}

          {/* Page controls - 添加图标/添加封面 buttons, hidden by default, visible on hover (Notion: opacity 0, pointer-events none) */}
          {(!currentPage.icon || !showCover) && (
            <div className="flex items-center gap-0.5 opacity-0 pointer-events-none group-hover/page-header:opacity-100 group-hover/page-header:pointer-events-auto transition-opacity duration-100 py-2">
              {!currentPage.icon && (
                <PageIcon
                  icon={currentPage.icon}
                  spaceSlug={spaceSlug!}
                  pageId={currentPage.id}
                />
              )}
              {!showCover && (
                <CoverImage
                  coverUrl={currentPage.cover_url}
                  spaceSlug={spaceSlug!}
                  pageId={currentPage.id}
                />
              )}
            </div>
          )}

          {/* Title */}
          <h1
            key={`title-${currentPage.id}`}
            ref={titleRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            className="text-[40px] font-bold text-notion-text leading-[1.2] outline-none focus:outline-none px-2"
            data-placeholder="未命名页面"
          >
            {currentPage.title || '未命名页面'}
          </h1>

          {/* Editor */}
          <div className="mt-4">
            <PageEditor
              key={currentPage.id}
              initialContent={currentContent}
              onSave={handleSave}
              readOnly={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
