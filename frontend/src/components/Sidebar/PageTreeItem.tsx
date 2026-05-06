import { useState } from 'react';
import { ChevronRight, FileText, ChevronDown } from 'lucide-react';
import { Page } from '../../api/pages';
import { useNavigate, useLocation, useParams } from 'react-router-dom';

interface PageTreeItemProps {
  page: Page;
  level: number;
}

export default function PageTreeItem({ page, level }: PageTreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const { spaceSlug } = useParams<{ spaceSlug: string }>();
  const hasChildren = page.children && page.children.length > 0;
  const isActive = location.pathname.includes(`/p/${page.id}`);

  const handleClick = () => {
    navigate(`/s/${spaceSlug}/p/${page.id}`);
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-1 px-2 py-1 rounded hover:bg-notion-hover transition-colors text-left group ${
          isActive ? 'bg-notion-hover' : ''
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="p-0.5 hover:bg-notion-border rounded transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-notion-textSecondary" />
            ) : (
              <ChevronRight className="w-4 h-4 text-notion-textSecondary" />
            )}
          </button>
        ) : (
          <span className="w-6" />
        )}

        {page.icon ? (
          <span className="text-sm">{page.icon}</span>
        ) : (
          <FileText className="w-4 h-4 text-notion-textSecondary" />
        )}

        <span className="text-sm text-notion-text truncate flex-1">{page.title}</span>
      </button>

      {hasChildren && isExpanded && (
        <div className="mt-0.5">
          {page.children!.map((child) => (
            <PageTreeItem key={child.id} page={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
