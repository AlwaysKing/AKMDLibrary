import { useEffect, useState } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { useSpaceStore } from '../../stores/spaceStore';
import { Space } from '../../api/spaces';
import { useNavigate, useParams } from 'react-router-dom';

export default function SpaceSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const { spaces, currentSpace, fetchSpaces, setCurrentSpace } = useSpaceStore();
  const navigate = useNavigate();
  const { spaceSlug } = useParams<{ spaceSlug: string }>();

  useEffect(() => {
    fetchSpaces();
  }, [fetchSpaces]);

  // Set current space based on URL slug
  useEffect(() => {
    if (spaces.length > 0 && spaceSlug) {
      const spaceFromUrl = spaces.find(s => s.slug === spaceSlug);
      if (spaceFromUrl && (!currentSpace || currentSpace.slug !== spaceSlug)) {
        setCurrentSpace(spaceFromUrl);
      }
    } else if (spaces.length > 0 && !currentSpace && !spaceSlug) {
      setCurrentSpace(spaces[0]);
    }
  }, [spaces, spaceSlug, currentSpace, setCurrentSpace]);

  const handleSelectSpace = (space: Space) => {
    setCurrentSpace(space);
    setIsOpen(false);
    navigate(`/s/${space.slug}`);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-notion-hover transition-colors text-left"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {currentSpace?.icon && <span className="text-lg">{currentSpace.icon}</span>}
          <span className="font-medium text-notion-text truncate">{currentSpace?.name || '选择空间'}</span>
        </div>
        <ChevronDown className="w-4 h-4 text-notion-textSecondary flex-shrink-0" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 top-full mt-1 w-full bg-white border border-notion-border rounded-lg shadow-lg z-20 max-h-96 overflow-auto">
            {spaces.map((space) => (
              <button
                key={space.id}
                onClick={() => handleSelectSpace(space)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-notion-hover transition-colors text-left"
              >
                {space.icon && <span className="text-lg">{space.icon}</span>}
                <span className="text-notion-text">{space.name}</span>
              </button>
            ))}
            <button
              onClick={() => setIsOpen(false)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-notion-hover transition-colors text-left text-notion-textSecondary"
            >
              <MoreHorizontal className="w-4 h-4" />
              <span>管理空间</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
