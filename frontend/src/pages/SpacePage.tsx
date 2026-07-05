import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSpaceStore } from '../stores/spaceStore';
import { usePageStore } from '../stores/pageStore';
import { usePreferenceStore } from '../stores/preferenceStore';
import { Plus, Hash, Lock } from 'lucide-react';
import { Page } from '../api/pages';

// Recursively check if a page ID exists in the tree
function findPageInTree(pages: Page[], targetId: string): boolean {
  for (const page of pages) {
    if (page.id === targetId) return true;
    if (page.children && findPageInTree(page.children, targetId)) return true;
  }
  return false;
}

export default function SpacePage() {
  const { spaceSlug } = useParams<{ spaceSlug: string }>();
  const navigate = useNavigate();
  const { currentSpace, setCurrentSpace, pageTree, pageTreeSlug, error } = useSpaceStore();
  const { createPage } = usePageStore();

  useEffect(() => {
    if (spaceSlug && (!currentSpace || currentSpace.slug !== spaceSlug)) {
      useSpaceStore.getState().fetchSpaces().then(() => {
        const spaces = useSpaceStore.getState().spaces;
        const space = spaces.find((s) => s.slug === spaceSlug);
        if (space) {
          setCurrentSpace(space);
        }
      });
    }
  }, [spaceSlug, currentSpace, setCurrentSpace]);

  // Auto-navigate: prefer last viewed page, else first page.
  // 关键：必须等 pageTree 真正是为当前 slug 加载的（pageTreeSlug === spaceSlug），
  // 否则切换 space 期间会拿到上一个 space 的旧树，pageTree[0].id 属于别的 space，
  // 跳过去就是 404。
  useEffect(() => {
    if (!spaceSlug) return;
    if (pageTreeSlug !== spaceSlug) return; // 旧树或还没加载，不要用
    if (pageTree.length > 0) {
      const lastViewedId = usePreferenceStore.getState().getLastViewedPageId(spaceSlug);
      const pageExists = lastViewedId && findPageInTree(pageTree, lastViewedId);
      const targetId = pageExists ? lastViewedId! : pageTree[0].id;
      navigate(`/s/${spaceSlug}/p/${targetId}`, { replace: true });
    }
    // pageTree.length === 0 且已确认是当前 slug 的结果 → 落到下面的"空状态/创建第一个页面"UI
  }, [pageTree, pageTreeSlug, spaceSlug, navigate]);

  const handleCreateFirstPage = async () => {
    if (!spaceSlug) return;
    try {
      const newPage = await createPage(spaceSlug, '快速开始');
      navigate(`/s/${spaceSlug}/p/${newPage.id}`);
    } catch (error) {
      console.error('Failed to create page:', error);
    }
  };

  // 无权限提示
  if (error && error.includes('403')) {
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

  // 加载中：pageTree 还没确认是当前 slug 的结果（旧树或没数据），但后端在拉
  // 显示 spinner，避免闪现"此工作区暂无内容"
  if (pageTreeSlug !== spaceSlug && !error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-notion-border border-t-notion-text"></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="mb-6">
          <div className="w-16 h-16 bg-notion-sidebarBg rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Hash className="w-8 h-8 text-notion-textSecondary" />
          </div>
          <h1 className="text-2xl font-bold text-notion-text mb-1">
            {currentSpace?.name || 'Space'}
          </h1>
          <p className="text-notion-textSecondary text-sm">
            此工作区暂无内容
          </p>
        </div>

        <button
          onClick={handleCreateFirstPage}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-notion-text text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          创建第一个页面
        </button>
      </div>
    </div>
  );
}
