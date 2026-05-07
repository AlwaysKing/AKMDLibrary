import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSpaceStore } from '../stores/spaceStore';
import { usePageStore } from '../stores/pageStore';
import { Plus, Hash } from 'lucide-react';

export default function SpacePage() {
  const { spaceSlug } = useParams<{ spaceSlug: string }>();
  const navigate = useNavigate();
  const { currentSpace, setCurrentSpace, pageTree } = useSpaceStore();
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

  // Auto-navigate to first page if available
  useEffect(() => {
    if (pageTree.length > 0 && spaceSlug) {
      navigate(`/s/${spaceSlug}/p/${pageTree[0].id}`, { replace: true });
    }
  }, [pageTree, spaceSlug, navigate]);

  const handleCreateFirstPage = async () => {
    if (!spaceSlug) return;
    try {
      const newPage = await createPage(spaceSlug, '快速开始');
      navigate(`/s/${spaceSlug}/p/${newPage.id}`);
    } catch (error) {
      console.error('Failed to create page:', error);
    }
  };

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
