import { useEffect, useCallback, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePageStore } from '../stores/pageStore';
import { useSpaceStore } from '../stores/spaceStore';
import Breadcrumb from '../components/Editor/Breadcrumb';
import CoverImage from '../components/Editor/CoverImage';
import PageIcon from '../components/Editor/PageIcon';
import PageEditor from '../components/Editor/PageEditor';
import { MoreHorizontal, Loader2, Check, Lock } from 'lucide-react';

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
  const [syncStatus, setSyncStatus] = useState<'syncing' | 'synced' | null>(null);
  const [lastSyncDate, setLastSyncDate] = useState<Date | null>(null);
  const [, setTick] = useState(0);

  // 每分钟刷新一次相对时间显示
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  const formatSyncTime = useCallback((date: Date) => {
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60) return '同步于: 刚刚';
    if (diff < 3600) return `同步于: ${Math.floor(diff / 60)} 分钟前`;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `同步于: ${y}/${m}/${d} ${h}:${min}`;
  }, []);

  const handleSyncStatusChange = useCallback((status: 'syncing' | 'synced') => {
    setSyncStatus(status);
    if (status === 'synced') {
      setLastSyncDate(new Date());
    }
  }, []);

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
    // 403 = 无权限访问
    if (error.includes('403') || error.includes('Forbidden')) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-notion-sidebarBg rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-notion-textSecondary" />
            </div>
            <h1 className="text-2xl font-bold text-notion-text mb-1">没有访问权限</h1>
            <p className="text-notion-textSecondary text-sm mb-6">
              你不是该空间的成员，无法访问此内容。
            </p>
            <button
              onClick={() => navigate('/')}
              className="px-5 py-2.5 bg-notion-text text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
            >
              返回首页
            </button>
          </div>
        </div>
      );
    }
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
          <div className="flex items-center gap-2">
            {syncStatus === 'syncing' && (
              <span className="flex items-center gap-1 text-xs text-notion-textSecondary">
                <Loader2 className="w-3 h-3 animate-spin" />
                同步中
              </span>
            )}
            {syncStatus === 'synced' && lastSyncDate && (
              <span className="flex items-center gap-1 text-xs text-notion-textSecondary">
                {formatSyncTime(lastSyncDate)}
                <Check className="w-3 h-3" />
              </span>
            )}
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
          </div>
        }
      />

      {/* 可滚动的内容区域 — Breadcrumb 固定，只有这部分滚动 */}
      <div className="flex-1 overflow-y-auto">

        {/* Cover image - full width at top */}
        {showCover && (
          <CoverImage
            coverUrl={currentPage.cover_url}
            coverOffset={currentPage.cover_offset}
            spaceSlug={spaceSlug!}
            pageId={currentPage.id}
          />
        )}

        {/* Page content area */}
        <div className={`${currentPage.full_page ? 'w-full px-24' : 'max-w-[912px] mx-auto px-24'} pb-32 relative group/page-header ${!showCover ? (currentPage.icon ? (currentPage.icon_large ? 'pt-[125px]' : 'pt-[96px]') : 'pt-[64px]') : ''}`}>

          {/* Icon */}
          {currentPage.icon && (
            <div className={showCover ? `relative ml-2 ${currentPage.icon_large ? '-mt-[72px]' : '-mt-[42px]'}` : 'ml-2'}>
              <PageIcon
                icon={currentPage.icon}
                iconLarge={currentPage.icon_large}
                spaceSlug={spaceSlug!}
                pageId={currentPage.id}
              />
              {/* Add cover button in icon-title gap, only on hover, no layout impact */}
              {!showCover && (
                <div className="h-0 translate-y-2 -ml-2 overflow-visible opacity-0 pointer-events-none group-hover/page-header:opacity-100 group-hover/page-header:pointer-events-auto transition-opacity duration-100">
                  <CoverImage
                    coverUrl={currentPage.cover_url}
                    coverOffset={currentPage.cover_offset}
                    spaceSlug={spaceSlug!}
                    pageId={currentPage.id}
                  />
                </div>
              )}
              <div className="h-10" />
            </div>
          )}

          {/* Page controls - 添加图标/封面 buttons, hidden by default, visible on hover */}
          {/* No icon: controls in flow (takes space like Notion) */}
          {!currentPage.icon && (
            <div className="flex items-center gap-0.5 opacity-0 pointer-events-none group-hover/page-header:opacity-100 group-hover/page-header:pointer-events-auto transition-opacity duration-100 py-3">
              <PageIcon
                icon={currentPage.icon}
                spaceSlug={spaceSlug!}
                pageId={currentPage.id}
              />
              {!showCover && (
                <CoverImage
                  coverUrl={currentPage.cover_url}
                  coverOffset={currentPage.cover_offset}
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
              onSyncStatusChange={handleSyncStatusChange}
              readOnly={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
