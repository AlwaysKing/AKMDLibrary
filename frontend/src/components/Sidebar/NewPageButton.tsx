import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePageStore } from '../../stores/pageStore';
import { useSpaceStore } from '../../stores/spaceStore';

export default function NewPageButton() {
  const navigate = useNavigate();
  const createPage = usePageStore((state) => state.createPage);
  const { currentSpace } = useSpaceStore();

  const handleNewPage = async () => {
    if (!currentSpace) return;

    try {
      const newPage = await createPage(currentSpace.slug, '未命名页面');
      navigate(`/s/${currentSpace.slug}/p/${newPage.id}`);
    } catch (error) {
      console.error('Failed to create page:', error);
    }
  };

  return (
    <button
      onClick={handleNewPage}
      disabled={!currentSpace}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-notion-hover transition-colors text-left text-notion-textSecondary disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Plus className="w-4 h-4" />
      <span className="text-sm">新建页面</span>
    </button>
  );
}
