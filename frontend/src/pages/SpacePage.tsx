import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSpaceStore } from '../stores/spaceStore';
import { usePageStore } from '../stores/pageStore';

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

  const handleCreateFirstPage = async () => {
    if (!spaceSlug) return;
    try {
      const newPage = await createPage(spaceSlug, 'Welcome');
      navigate(`/s/${spaceSlug}/p/${newPage.id}`);
    } catch (error) {
      console.error('Failed to create page:', error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <div className="text-center">
        {currentSpace?.icon && (
          <div className="text-6xl mb-4">{currentSpace.icon}</div>
        )}
        <h1 className="text-3xl font-semibold text-notion-text mb-2">
          {currentSpace?.name || 'Space'}
        </h1>
        <p className="text-notion-textSecondary mb-8">
          {currentSpace?.description || 'Your knowledge base'}
        </p>

        {pageTree.length === 0 ? (
          <div className="space-y-4">
            <p className="text-notion-textSecondary">
              This space is empty. Create your first page to get started.
            </p>
            <button
              onClick={handleCreateFirstPage}
              className="px-4 py-2 bg-notion-text text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Create first page
            </button>
          </div>
        ) : (
          <div className="text-left">
            <h2 className="text-lg font-medium text-notion-text mb-4">Pages</h2>
            <div className="space-y-2">
              {pageTree.map((page) => (
                <button
                  key={page.id}
                  onClick={() => navigate(`/s/${spaceSlug}/p/${page.id}`)}
                  className="w-full text-left px-4 py-3 rounded-lg hover:bg-notion-hover transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {page.icon && <span>{page.icon}</span>}
                    <span className="text-notion-text">{page.title}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
