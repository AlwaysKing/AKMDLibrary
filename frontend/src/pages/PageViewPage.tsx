import { useEffect, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { usePageStore } from '../stores/pageStore';
import { useSpaceStore } from '../stores/spaceStore';
import { usePreferenceStore } from '../stores/preferenceStore';
import Breadcrumb from '../components/Editor/Breadcrumb';
import CoverImage from '../components/Editor/CoverImage';
import PageIcon from '../components/Editor/PageIcon';
import PageEditor from '../components/Editor/PageEditor';
import { getLatestMirror } from '../services/mirrorStore';
import { onSyncStatusChange, flushSync } from '../services/syncModule';
import { gitApi, GitRepoState } from '../api/git';
import { MoreHorizontal, Loader2, Check, Lock, UploadCloud, Save } from 'lucide-react';

// 页面不存在时的提示
function PageNotFound() {
  return (
    <div className="flex-1 flex items-center justify-center bg-notion-bg">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-notion-textSecondary mb-2">404</h1>
        <p className="text-notion-textSecondary">页面不存在或已被删除</p>
      </div>
    </div>
  );
}

export default function PageViewPage() {
  const { spaceSlug, pageId } = useParams<{ spaceSlug: string; pageId: string }>();
  const navigate = useNavigate();
  const { currentPage, currentContent, fetchPage, isLoading, error, refreshPageTree, updateMetadata } = usePageStore();
  const { setCurrentSpace } = useSpaceStore();
  const codeTheme = usePreferenceStore((state) => state.getCodeTheme());

  useEffect(() => {
    if (!spaceSlug || !pageId) return;
    const controller = new AbortController();
    // 延迟到下一个微任务，让导航先生效；如果组件已卸载则不发出请求
    const timer = setTimeout(async () => {
      await fetchPage(spaceSlug, pageId, controller.signal);
      // fetchRecent 在 fetchPage 完成后调用，确保 TouchAccess 已更新
      useSpaceStore.getState().fetchRecent(spaceSlug);
    }, 0);
    const spaces = useSpaceStore.getState().spaces;
    const space = spaces.find((s) => s.slug === spaceSlug);
    if (space) {
      setCurrentSpace(space);
    }
    usePreferenceStore.getState().setLastViewedPage(spaceSlug, pageId);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [spaceSlug, pageId, fetchPage, setCurrentSpace]);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const pageMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [showPageMenu, setShowPageMenu] = useState(false);
  const [pageMenuPosition, setPageMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [syncStatus, setSyncStatus] = useState<'unsaved' | 'syncing' | 'synced' | null>(null);
  const [lastSyncDate, setLastSyncDate] = useState<Date | null>(null);
  const [gitState, setGitState] = useState<GitRepoState | null>(null);
  const [committing, setCommitting] = useState(false);
  const [, setTick] = useState(0);

  // Refresh git state for the current space. Called on page mount, after
  // successful sync (page content may now be on disk as a dirty file), and
  // after a commit (file should no longer be in the dirty list).
  // Skip entirely when the space has git disabled — backend returns 403 and
  // we want the feature to look fully absent.
  const refreshGit = useCallback(async () => {
    if (!spaceSlug) return;
    const space = useSpaceStore.getState().spaces.find((s) => s.slug === spaceSlug);
    if (!space?.feature_flags?.git) {
      setGitState(null);
      return;
    }
    try {
      const s = await gitApi.state(spaceSlug);
      setGitState(s);
    } catch {
      // Not a git repo / network error — leave gitState as-is (or null).
    }
  }, [spaceSlug]);

  useEffect(() => {
    refreshGit();
  }, [refreshGit]);

  // Scroll to a block referenced by a permanent block id in the URL.
  // BlockNote renders blocks synchronously on mount, but large pages take a
  // few frames to commit; poll for up to 2s, then give up silently (stale
  // link, block deleted, etc.). scrollIntoView walks up to the nearest
  // scrollable ancestor (.page-content-scroll), so we don't need to target
  // the container manually.
  const scrollToBlockHash = useCallback(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const rawBlockId = hash.slice(1);
    const blockId = decodeURIComponent(rawBlockId);
    if (!blockId.startsWith('akb_')) return;
    if (!blockId) return;
    const deadline = Date.now() + 2000;
    let raf = 0;
    let highlightTimer = 0;
    let settleTimer = 0;

    const flashBlock = (blockOuter: HTMLElement) => {
      const rect = blockOuter.getBoundingClientRect();
      document.querySelectorAll('.bn-block-link-flash-overlay').forEach((node) => node.remove());
      const overlay = document.createElement('div');
      overlay.className = 'bn-block-link-flash-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.position = 'fixed';
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.boxSizing = 'border-box';
      overlay.style.border = '0';
      overlay.style.background = 'rgba(35, 131, 226, 0)';
      overlay.style.borderRadius = '4px';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '10000';
      document.body.appendChild(overlay);
      overlay.animate([
        { background: 'rgba(35, 131, 226, 0)' },
        { background: 'rgba(35, 131, 226, 0.06)', offset: 0.12 },
        { background: 'rgba(35, 131, 226, 0.01)', offset: 0.28 },
        { background: 'rgba(35, 131, 226, 0.06)', offset: 0.42 },
        { background: 'rgba(35, 131, 226, 0.025)', offset: 0.68 },
        { background: 'rgba(35, 131, 226, 0)' },
      ], { duration: 1200, easing: 'ease-out' });
      highlightTimer = window.setTimeout(() => {
        overlay.remove();
      }, 1300);
    };

    const findScrollParent = (element: HTMLElement): HTMLElement | Window => {
      let parent = element.parentElement;
      while (parent) {
        const style = window.getComputedStyle(parent);
        const overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && parent.scrollHeight > parent.clientHeight) {
          return parent;
        }
        parent = parent.parentElement;
      }
      return window;
    };

    const flashAfterScrollSettles = (blockOuter: HTMLElement, scrollParent: HTMLElement | Window) => {
      let flashed = false;
      const flashOnce = () => {
        if (flashed) return;
        flashed = true;
        window.clearTimeout(settleTimer);
        requestAnimationFrame(() => requestAnimationFrame(() => flashBlock(blockOuter)));
      };

      scrollParent.addEventListener('scrollend', flashOnce, { once: true });
      settleTimer = window.setTimeout(flashOnce, 650);
    };

    const tryScroll = () => {
      // CSS.escape guards against characters that would break the attribute
      // selector (e.g. brackets). BlockNote UUIDs are plain hex+dash so this
      // is belt-and-braces.
      const el = document.querySelector(`[data-id="${CSS.escape(blockId)}"]`) as HTMLElement | null;
      if (el) {
        const scrollParent = findScrollParent(el);
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const blockOuter = (el.closest('.bn-block-outer') as HTMLElement | null) || el;
        flashAfterScrollSettles(blockOuter, scrollParent);
        return;
      }
      if (Date.now() < deadline) {
        raf = requestAnimationFrame(tryScroll);
      }
    };
    tryScroll();
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(highlightTimer);
      window.clearTimeout(settleTimer);
    };
  }, []);

  // Cross-page navigation: fetchPage resolves → currentPage.id changes →
  // PageEditor (keyed by id) remounts → effect fires after a tick.
  useEffect(() => {
    if (!currentPage) return;
    // Delay one frame so BlockNote has actually painted the blocks.
    const id = setTimeout(scrollToBlockHash, 50);
    return () => clearTimeout(id);
  }, [currentPage?.id, scrollToBlockHash]);

  // Same-page clicks on a hash link don't change the route — React
  // Router doesn't re-render, so we need a hashchange listener.
  useEffect(() => {
    window.addEventListener('hashchange', scrollToBlockHash);
    return () => window.removeEventListener('hashchange', scrollToBlockHash);
  }, [scrollToBlockHash]);

  // When a sync completes, the file on disk has changed → git state may have
  // new dirty entries. Refresh so the per-page commit button appears.
  useEffect(() => {
    if (syncStatus === 'synced') {
      refreshGit();
    }
  }, [syncStatus, refreshGit]);

  const handleCommitPage = useCallback(async () => {
    if (!spaceSlug || !currentPage?.file_path || committing) return;
    setCommitting(true);
    try {
      // Strip "<spaceSlug>/" prefix — git paths are relative to repo root,
      // not docsDir. See pageDirty derivation above.
      const relPath = currentPage.file_path.startsWith(`${spaceSlug}/`)
        ? currentPage.file_path.slice(spaceSlug.length + 1)
        : currentPage.file_path;
      await gitApi.commit(spaceSlug, `Update ${currentPage.title || relPath}`, [relPath]);
      await refreshGit();
    } catch (e: any) {
      console.error('single-page commit failed:', e);
    } finally {
      setCommitting(false);
    }
  }, [spaceSlug, currentPage, committing, refreshGit]);

  // page.file_path is relative to docsDir (e.g. "DLPPlus/重要通知.md"), but
  // git status paths are relative to the repo root (= spaceDir, e.g. just
  // "重要通知.md"). Strip the "<spaceSlug>/" prefix so they're comparable.
  const repoRelative = currentPage?.file_path && spaceSlug
    && currentPage.file_path.startsWith(`${spaceSlug}/`)
    ? currentPage.file_path.slice(spaceSlug.length + 1)
    : currentPage?.file_path;
  const pageDirty = !!(gitState?.is_repo && repoRelative
    && (gitState.files ?? []).some(f => f.path === repoRelative));

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

  const handleSyncStatusChange = useCallback((status: 'unsaved' | 'syncing' | 'synced') => {
    // Only handle 'unsaved' from editor — 'syncing'/'synced' come from syncModule subscription
    if (status === 'unsaved') {
      setSyncStatus('unsaved');
    }
  }, []);

  // Subscribe to syncModule events for syncing/synced status
  useEffect(() => {
    const pageIdStr = pageId || '';
    if (!spaceSlug || !pageIdStr) return;

    const unsubscribe = onSyncStatusChange((event) => {
      if (event.spaceSlug === spaceSlug && event.pageId === pageIdStr) {
        if (event.type === 'syncing') {
          setSyncStatus('syncing');
        } else if (event.type === 'synced') {
          setSyncStatus('synced');
          setLastSyncDate(new Date());
        }
      }
    });
    return unsubscribe;
  }, [spaceSlug, pageId]);

  // On page load: check for pending mirrors from previous sessions
  useEffect(() => {
    if (!spaceSlug || !pageId) return;
    getLatestMirror(spaceSlug, pageId).then(mirror => {
      if (mirror && !mirror.synced) {
        // There is unsynced content from a previous session — trigger immediate sync
        flushSync();
        setSyncStatus('syncing');
      }
    });
  }, [spaceSlug, pageId]);

  const handleFullPageToggle = useCallback(async () => {
    if (!spaceSlug || !pageId || !currentPage || currentPage.is_locked) return;
    const newFullPage = !currentPage.full_page;
    await updateMetadata(spaceSlug, pageId, { full_page: newFullPage });
  }, [spaceSlug, pageId, currentPage, updateMetadata]);

  const handleLockedToggle = useCallback(async () => {
    if (!spaceSlug || !pageId || !currentPage) return;
    const newLocked = !currentPage.is_locked;
    await updateMetadata(spaceSlug, pageId, { is_locked: newLocked });
    if (newLocked) {
      titleRef.current?.blur();
    }
  }, [spaceSlug, pageId, currentPage, updateMetadata]);

  const syncPageMenuPosition = useCallback(() => {
    const rect = pageMenuButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPageMenuPosition({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, []);

  const togglePageMenu = useCallback(() => {
    if (showPageMenu) {
      setShowPageMenu(false);
      return;
    }
    syncPageMenuPosition();
    setShowPageMenu(true);
  }, [showPageMenu, syncPageMenuPosition]);

  useEffect(() => {
    if (!showPageMenu) return;

    const handleWindowChange = () => syncPageMenuPosition();
    window.addEventListener('resize', handleWindowChange);
    window.addEventListener('scroll', handleWindowChange, true);
    return () => {
      window.removeEventListener('resize', handleWindowChange);
      window.removeEventListener('scroll', handleWindowChange, true);
    };
  }, [showPageMenu, syncPageMenuPosition]);

  const handleTitleBlur = useCallback(async () => {
    if (currentPage?.is_locked) return;
    const newTitle = titleRef.current?.textContent?.trim() || '';
    const currentTitle = usePageStore.getState().currentPage?.title;
    if (newTitle && newTitle !== currentTitle && spaceSlug && pageId) {
      await updateMetadata(spaceSlug, pageId, { title: newTitle });
      await refreshPageTree();
    } else if (!newTitle && titleRef.current) {
      titleRef.current.textContent = currentTitle || '未命名页面';
    }
  }, [currentPage?.is_locked, spaceSlug, pageId, updateMetadata, refreshPageTree]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (currentPage?.is_locked) return;
    // Cmd+A / Ctrl+A：默认会冒泡到 BlockNote 编辑器触发"选择所有 block"，
    // 这里拦截，让 Cmd+A 只选中标题文本
    if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      const el = titleRef.current;
      if (!el) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      titleRef.current?.blur();
      // 通知编辑器在顶部插入空 block 并聚焦（用户在标题按回车 = 想直接开始写正文）
      document.dispatchEvent(new CustomEvent('title-enter-pressed'));
    }
  }, [currentPage?.is_locked]);

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
    return <PageNotFound />;
  }

  if (!currentPage) {
    // No page and no error yet means the first fetch hasn't resolved.
    // Keep showing the loading state instead of flashing a false 404.
    if (!error) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-notion-border border-t-notion-text"></div>
        </div>
      );
    }

    // Not loading, no current page, and fetch already failed.
    return <PageNotFound />;
  }

  const showCover = !!currentPage.cover_url;
  const pageMenuPortal = showPageMenu && pageMenuPosition
    ? createPortal(
        <>
          <div className="fixed inset-0 z-[95]" onClick={() => setShowPageMenu(false)} />
          <div
            className="fixed bg-white border border-notion-border rounded-lg shadow-xl z-[100] min-w-[200px] py-1"
            style={{ top: pageMenuPosition.top, right: pageMenuPosition.right }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleFullPageToggle();
              }}
              disabled={!!currentPage.is_locked}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                currentPage.is_locked
                  ? 'text-notion-textSecondary cursor-not-allowed'
                  : 'text-notion-text hover:bg-notion-hover'
              }`}
            >
              <span>全宽页面</span>
              <div className={`w-8 h-4 rounded-full transition-colors relative ${currentPage.full_page ? 'bg-blue-500' : 'bg-gray-300'}`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${currentPage.full_page ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleLockedToggle();
              }}
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-notion-text hover:bg-notion-hover transition-colors"
            >
              <span>锁定页面</span>
              <div className={`w-8 h-4 rounded-full transition-colors relative ${currentPage.is_locked ? 'bg-blue-500' : 'bg-gray-300'}`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${currentPage.is_locked ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </button>
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-notion-bg">
      {/* Breadcrumb — 固定在顶部，不随内容滚动 */}
      <Breadcrumb
        pageTitle={currentPage.title}
        spaceSlug={spaceSlug!}
        actions={
          <div className="flex items-center gap-2">
            {syncStatus === 'unsaved' && (
              <>
                <span className="text-xs text-notion-textSecondary">
                  有内容尚未同步
                </span>
                <button
                  type="button"
                  onClick={() => { flushSync(); setSyncStatus('syncing'); }}
                  title="立即同步 (等同于 Cmd+S)"
                  className="p-1 hover:bg-notion-hover rounded transition-colors"
                >
                  <Save className="w-3.5 h-3.5 text-notion-textSecondary" />
                </button>
              </>
            )}
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
            {gitState?.is_repo && pageDirty && (
              <button
                type="button"
                onClick={handleCommitPage}
                disabled={committing}
                title={`提交此页面到 git (${currentPage?.file_path})`}
                className="p-1 hover:bg-notion-hover rounded transition-colors disabled:opacity-40"
              >
                {committing
                  ? <Loader2 className="w-3.5 h-3.5 text-notion-textSecondary animate-spin" />
                  : <UploadCloud className="w-3.5 h-3.5 text-notion-textSecondary" />}
              </button>
            )}
            <div className="relative">
              <button
                type="button"
                ref={pageMenuButtonRef}
                onClick={togglePageMenu}
                className="p-1 hover:bg-notion-hover rounded transition-colors"
              >
                <MoreHorizontal className="w-4 h-4 text-notion-textSecondary" />
              </button>
            </div>
          </div>
        }
      />
      {pageMenuPortal}

      {/* 可滚动的内容区域 — Breadcrumb 固定，只有这部分滚动 */}
      <div className="page-content-scroll flex-1 overflow-y-auto">

        {/* Cover image - full width at top */}
        {showCover && (
          <div className={currentPage.is_locked ? 'pointer-events-none' : ''}>
            <CoverImage
              coverUrl={currentPage.cover_url}
              coverOffset={currentPage.cover_offset}
              spaceSlug={spaceSlug!}
              pageId={currentPage.id}
            />
          </div>
        )}

        {/* Page content area — min-h-full fills scroll viewport so clickable area covers all whitespace */}
        <div className={`${currentPage.full_page ? 'w-full px-24' : 'max-w-[912px] mx-auto px-24'} min-h-full pb-32 ${!showCover ? (currentPage.icon ? (currentPage.icon_large ? 'pt-[125px]' : 'pt-[96px]') : 'pt-[64px]') : ''}`}>

          {/* Icon */}
          {currentPage.icon && (
            <div className={showCover ? `relative ml-2 ${currentPage.icon_large ? '-mt-[72px]' : '-mt-[42px]'}` : 'ml-2'}>
              <div className={currentPage.is_locked ? 'pointer-events-none' : ''}>
                <PageIcon
                  icon={currentPage.icon}
                  iconLarge={currentPage.icon_large}
                  spaceSlug={spaceSlug!}
                  pageId={currentPage.id}
                />
              </div>
              {/* Add cover button in icon-title gap, hover self to show */}
              {!showCover && !currentPage.is_locked && (
                <div className="h-0 translate-y-2 -ml-2 overflow-visible opacity-0 hover:opacity-100 transition-opacity duration-100">
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

          {/* Page controls - 添加图标/封面 buttons, hover self to show */}
          {!currentPage.icon && (
            <div className={`flex items-center gap-0.5 transition-opacity duration-100 py-3 ${currentPage.is_locked ? 'opacity-0 pointer-events-none' : 'opacity-0 hover:opacity-100'}`}>
              <PageIcon
                icon={currentPage.icon}
                spaceSlug={spaceSlug!}
                pageId={currentPage.id}
              />
              {!showCover && !currentPage.is_locked && (
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
            contentEditable={!currentPage.is_locked}
            suppressContentEditableWarning
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            className={`text-[40px] font-bold text-notion-text leading-[1.2] px-2 ${currentPage.is_locked ? 'cursor-default' : 'outline-none focus:outline-none'}`}
            data-placeholder="未命名页面"
          >
            {currentPage.title || '未命名页面'}
          </h1>

          {/* Editor */}
          <div className="mt-4">
            <PageEditor
              key={`${currentPage.id}:${codeTheme}`}
              initialContent={currentContent}
              pageIdentity={{ spaceSlug: spaceSlug!, pageId: currentPage.id }}
              onSyncStatusChange={handleSyncStatusChange}
              readOnly={!!currentPage.is_locked}
              codeTheme={codeTheme}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
