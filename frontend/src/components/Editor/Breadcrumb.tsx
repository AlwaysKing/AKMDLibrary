import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSpaceStore } from '../../stores/spaceStore';

interface BreadcrumbProps {
  pageTitle?: string;
  spaceSlug: string;
  actions?: React.ReactNode;
}

export default function Breadcrumb({ pageTitle, spaceSlug, actions }: BreadcrumbProps) {
  const navigate = useNavigate();
  const { currentSpace } = useSpaceStore();

  return (
    <div className="flex items-center justify-between text-base text-notion-textSecondary h-11 px-4">
      <div className="flex items-center gap-1">
      <button
        onClick={() => navigate(`/s/${spaceSlug}`)}
        className="hover:bg-notion-hover px-1.5 py-0.5 rounded transition-colors"
      >
        {currentSpace?.icon && <span className="mr-1">{currentSpace.icon}</span>}
        {currentSpace?.name || 'Space'}
      </button>
      {pageTitle && (
        <>
          <ChevronRight className="w-4 h-4 flex-shrink-0" />
          <span className="text-notion-text px-1.5 py-0.5">{pageTitle}</span>
        </>
      )}
      </div>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}
