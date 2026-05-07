import { useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { usePageStore } from '../stores/pageStore';
import { useSpaceStore } from '../stores/spaceStore';
import Breadcrumb from '../components/Editor/Breadcrumb';
import CoverImage from '../components/Editor/CoverImage';
import PageIcon from '../components/Editor/PageIcon';
import PageEditor from '../components/Editor/PageEditor';

export default function PageViewPage() {
  const { spaceSlug, pageId } = useParams<{ spaceSlug: string; pageId: string }>();
  const { currentPage, currentContent, fetchPage, isLoading, error, savePage, refreshPageTree } = usePageStore();
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-notion-border border-t-notion-text"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-notion-textSecondary mb-2">页面加载失败</p>
          <p className="text-sm text-notion-textSecondary/60">{error}</p>
        </div>
      </div>
    );
  }

  if (!currentPage) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-notion-border border-t-notion-text"></div>
      </div>
    );
  }

  const showCover = !!currentPage.cover_url;

  return (
    <div className="min-h-screen bg-notion-bg flex flex-col">
      {/* Breadcrumb */}
      <Breadcrumb pageTitle={currentPage.title} spaceSlug={spaceSlug!} />

      {/* Cover image - full width at top */}
      {showCover && (
        <CoverImage
          coverUrl={currentPage.cover_url}
          spaceSlug={spaceSlug!}
          pageId={currentPage.id}
        />
      )}

      {/* Page content area */}
      <div className="max-w-[720px] mx-auto w-full px-12 pb-32">
        {/* Hover action bar - shows add hints when no cover/icon */}
        {!showCover && (
          <div className="mt-1 mb-1 opacity-0 hover:opacity-100 transition-opacity duration-200">
            <CoverImage
              coverUrl={currentPage.cover_url}
              spaceSlug={spaceSlug!}
              pageId={currentPage.id}
            />
          </div>
        )}

        {/* Icon - single render */}
        <div className={showCover ? '-mt-8 mb-2' : 'mb-2'}>
          <PageIcon
            icon={currentPage.icon}
            spaceSlug={spaceSlug!}
            pageId={currentPage.id}
          />
        </div>

        {/* Title */}
        <h1 className="text-[40px] font-bold text-notion-text leading-tight mb-1 outline-none">
          {currentPage.title || '未命名页面'}
        </h1>

        {/* Editor */}
        <PageEditor
          key={currentPage.id}
          initialContent={currentContent}
          onSave={handleSave}
          readOnly={false}
        />
      </div>
    </div>
  );
}
