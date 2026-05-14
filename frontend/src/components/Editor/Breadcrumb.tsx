import { ChevronRight, Menu, Landmark, FileText } from 'lucide-react';
import { useNavigate, useOutletContext, useLocation, useParams } from 'react-router-dom';
import { useSpaceStore } from '../../stores/spaceStore';
import { pagesApi, Page } from '../../api/pages';
import { Space } from '../../api/spaces';
import { useState, useRef, useEffect, Fragment } from 'react';

interface BreadcrumbProps {
  pageTitle?: string;
  spaceSlug: string;
  actions?: React.ReactNode;
}

const SUBMENU_WIDTH = 260;
const ROOT_CLOSE_DELAY = 500;
const SUBMENU_CLOSE_DELAY = 100;

function CascadingPageItem({ page, spaceSlug, onClose }: { page: Page; spaceSlug: string; onClose: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [showSubmenu, setShowSubmenu] = useState(false);
  const [flipLeft, setFlipLeft] = useState(false);
  const hasChildren = page.children && page.children.length > 0;
  const isActive = location.pathname.includes(`/p/${page.id}`);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showSubmenu && hasChildren && itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect();
      const spaceRight = window.innerWidth - rect.right;
      const spaceLeft = rect.left;

      if (spaceRight >= SUBMENU_WIDTH) {
        setFlipLeft(false);
      } else if (spaceLeft >= SUBMENU_WIDTH) {
        setFlipLeft(true);
      } else {
        setFlipLeft(spaceLeft > spaceRight);
      }
    }
  }, [showSubmenu, hasChildren]);

  const handleMouseEnter = () => {
    clearTimeout(timeoutRef.current);
    if (hasChildren) setShowSubmenu(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setShowSubmenu(false), SUBMENU_CLOSE_DELAY);
  };

  const handleClick = () => {
    navigate(`/s/${spaceSlug}/p/${page.id}`);
    onClose();
  };

  return (
    <div
      ref={itemRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        onClick={handleClick}
        className={`flex items-center h-[30px] px-3 cursor-pointer rounded-sm transition-colors text-left ${
          isActive ? 'bg-notion-hover' : 'hover:bg-notion-hover'
        }`}
      >
        <span className="flex items-center justify-center flex-shrink-0 mr-2" style={{ width: '22px', height: '18px' }}>
          {page.icon ? (
            <span className="text-[18px] leading-none" style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"' }}>{page.icon}</span>
          ) : (
            <FileText className="w-[18px] h-[18px] text-[#91918e]" strokeWidth={1.7} />
          )}
        </span>
        <span className={`text-sm font-medium truncate flex-1 ${isActive ? 'text-notion-text' : 'text-notion-sidebarText'}`}>
          {page.title || '未命名页面'}
        </span>
        {hasChildren && (
          <ChevronRight className={`w-3 h-3 text-[#ada9a3] ml-1 flex-shrink-0 transition-transform duration-150 ${flipLeft ? 'rotate-180' : ''}`} />
        )}
      </div>
      {hasChildren && showSubmenu && (
        <div
          className={`absolute top-0 w-[260px] bg-white border border-notion-border rounded-lg shadow-lg z-30 py-1 ${
            flipLeft ? 'right-full mr-0.5' : 'left-full ml-0.5'
          }`}
        >
          {page.children!.map(child => (
            <CascadingPageItem key={child.id} page={child} spaceSlug={spaceSlug} onClose={onClose} />
          ))}
        </div>
      )}
    </div>
  );
}

function BreadcrumbPageItem({ page, siblings, spaceSlug, isLast, isOpen, onMouseEnter, onMouseLeave }: {
  page: Page;
  siblings: Page[];
  spaceSlug: string;
  isLast: boolean;
  isOpen: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div
      className="relative"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span
        onClick={() => navigate(`/s/${spaceSlug}/p/${page.id}`)}
        className={`flex items-center gap-1 text-sm px-1.5 py-0.5 rounded cursor-pointer hover:bg-notion-hover transition-colors truncate max-w-[200px] ${
          isLast ? 'text-notion-text font-medium' : 'text-notion-textSecondary'
        }`}
      >
        <span className="flex-shrink-0" style={{ fontSize: '14px', lineHeight: 1, fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"' }}>
          {page.icon || ''}
        </span>
        {!page.icon && <FileText className="w-3.5 h-3.5 text-[#91918e] flex-shrink-0" strokeWidth={1.7} />}
        <span className="truncate">{page.title || '未命名页面'}</span>
      </span>
      {isOpen && siblings.length > 0 && (
        <div className="absolute left-0 top-full mt-1 w-[240px] bg-white border border-notion-border rounded-lg shadow-lg z-20 py-1">
          {siblings.map(sibling => (
            <div
              key={sibling.id}
              onClick={() => navigate(`/s/${spaceSlug}/p/${sibling.id}`)}
              className={`flex items-center h-[30px] px-3 cursor-pointer rounded-sm transition-colors text-left ${
                location.pathname.includes(`/p/${sibling.id}`) ? 'bg-notion-hover' : 'hover:bg-notion-hover'
              }`}
            >
              <span className="flex items-center justify-center flex-shrink-0 mr-2" style={{ width: '22px', height: '18px' }}>
                {sibling.icon ? (
                  <span className="text-[18px] leading-none" style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"' }}>{sibling.icon}</span>
                ) : (
                  <FileText className="w-[18px] h-[18px] text-[#91918e]" strokeWidth={1.7} />
                )}
              </span>
              <span className={`text-sm font-medium truncate flex-1 ${
                location.pathname.includes(`/p/${sibling.id}`) ? 'text-notion-text' : 'text-notion-sidebarText'
              }`}>
                {sibling.title || '未命名页面'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SpaceMenuItem({ space, isCurrent, pageTree, onClose, isOpen, onMouseEnter }: {
  space: Space;
  isCurrent: boolean;
  pageTree: Page[];
  onClose: () => void;
  isOpen: boolean;
  onMouseEnter: () => void;
}) {
  const navigate = useNavigate();
  const [flipLeft, setFlipLeft] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect();
      const spaceRight = window.innerWidth - rect.right;
      const spaceLeft = rect.left;

      if (spaceRight >= SUBMENU_WIDTH) {
        setFlipLeft(false);
      } else if (spaceLeft >= SUBMENU_WIDTH) {
        setFlipLeft(true);
      } else {
        setFlipLeft(spaceLeft > spaceRight);
      }
    }
  }, [isOpen]);

  const handleClick = () => {
    navigate(`/s/${space.slug}`);
    onClose();
  };

  return (
    <div
      ref={itemRef}
      className="relative"
      onMouseEnter={onMouseEnter}
    >
      <div
        onClick={handleClick}
        className={`flex items-center h-[30px] px-3 cursor-pointer rounded-sm transition-colors text-left ${
          isCurrent ? 'bg-notion-hover' : 'hover:bg-notion-hover'
        }`}
      >
        <span className="flex items-center justify-center flex-shrink-0 mr-2" style={{ width: '22px', height: '18px' }}>
          {space.icon ? (
            <span className="text-[18px] leading-none" style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"' }}>{space.icon}</span>
          ) : (
            <Landmark className="w-[18px] h-[18px] text-[#91918e]" strokeWidth={1.7} />
          )}
        </span>
        <span className={`text-sm font-medium truncate flex-1 ${isCurrent ? 'text-notion-text' : 'text-notion-sidebarText'}`}>
          {space.name}
        </span>
        <ChevronRight className={`w-3 h-3 text-[#ada9a3] ml-1 flex-shrink-0 transition-transform duration-150 ${flipLeft ? 'rotate-180' : ''}`} />
      </div>
      {isOpen && (
        <div
          className={`absolute top-0 w-[260px] bg-white border border-notion-border rounded-lg shadow-lg z-30 py-1 ${
            flipLeft ? 'right-full mr-0.5' : 'left-full ml-0.5'
          }`}
        >
          {pageTree && pageTree.length > 0 ? (
            pageTree.map(page => (
              <CascadingPageItem key={page.id} page={page} spaceSlug={space.slug} onClose={onClose} />
            ))
          ) : (
            <div className="text-sm text-notion-textSecondary px-3 py-2">暂无页面</div>
          )}
        </div>
      )}
    </div>
  );
}

// Find path from root to target page in the tree
function findPagePath(pages: Page[], targetId: number, path: Page[] = []): Page[] | null {
  for (const page of pages) {
    const newPath = [...path, page];
    if (page.id === targetId) return newPath;
    if (page.children) {
      const result = findPagePath(page.children, targetId, newPath);
      if (result) return result;
    }
  }
  return null;
}

type ActiveItem = 'space' | number | null;

export default function Breadcrumb({ pageTitle, spaceSlug, actions }: BreadcrumbProps) {
  const navigate = useNavigate();
  const { currentSpace, pageTree, spaces } = useSpaceStore();
  const { sidebarCollapsed, toggleSidebar } = useOutletContext<{ sidebarCollapsed: boolean; toggleSidebar: () => void }>();
  const { pageId } = useParams<{ pageId: string }>();
  const currentPageId = pageId ? parseInt(pageId) : null;
  const pagePath = currentPageId ? findPagePath(pageTree, currentPageId) : null;
  const [activeItem, setActiveItem] = useState<ActiveItem>(null);
  const [activeSpaceId, setActiveSpaceId] = useState<number | null>(null);
  const showMenu = activeItem === 'space';
  const [spaceTrees, setSpaceTrees] = useState<Record<string, Page[]>>({});
  const menuRef = useRef<HTMLDivElement>(null);
  const fetchedSlugs = useRef<Set<string>>(new Set());
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const handleItemEnter = (item: ActiveItem) => {
    clearTimeout(closeTimeoutRef.current);
    setActiveItem(item);
  };

  const handleItemLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setActiveItem(null);
      setActiveSpaceId(null);
    }, ROOT_CLOSE_DELAY);
  };

  // Sync current space's pageTree into cache
  useEffect(() => {
    if (currentSpace && pageTree.length > 0) {
      fetchedSlugs.current.add(currentSpace.slug);
      setSpaceTrees(prev => {
        if (prev[currentSpace.slug] === pageTree) return prev;
        return { ...prev, [currentSpace.slug]: pageTree };
      });
    }
  }, [pageTree, currentSpace]);

  // Fetch page trees for all spaces when menu opens
  useEffect(() => {
    if (activeItem !== 'space') return;
    spaces.forEach(async (space) => {
      if (fetchedSlugs.current.has(space.slug)) return;
      fetchedSlugs.current.add(space.slug);
      try {
        const tree = await pagesApi.getTree(space.slug);
        setSpaceTrees(prev => ({ ...prev, [space.slug]: tree || [] }));
      } catch (err) {
        fetchedSlugs.current.delete(space.slug);
        console.error('Failed to fetch page tree:', err);
      }
    });
  }, [activeItem, spaces]);

  // Close on Escape
  useEffect(() => {
    if (activeItem === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveItem(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeItem]);

  return (
    <div className="flex items-center justify-between text-base text-notion-textSecondary h-11 px-4">
      <div className="flex items-center gap-1">
      {sidebarCollapsed && (
        <button
          onClick={toggleSidebar}
          className="hover:bg-notion-hover p-1 rounded transition-colors mr-1"
          title="展开侧边栏"
        >
          <Menu className="w-4 h-4" />
        </button>
      )}
      <div
        className="relative"
        ref={menuRef}
        onMouseEnter={() => handleItemEnter('space')}
        onMouseLeave={handleItemLeave}
      >
        <button
          className={`hover:bg-notion-hover px-1.5 py-0.5 rounded transition-colors flex items-center ${showMenu ? 'bg-notion-hover' : ''}`}
        >
          {currentSpace?.icon ? <span className="mr-1">{currentSpace.icon}</span> : <Landmark className="w-4 h-4 mr-1 text-notion-textSecondary" />}
          {currentSpace?.name || 'Space'}
        </button>

        {showMenu && (
          <div className="absolute left-0 top-full mt-1 w-[240px] bg-white border border-notion-border rounded-lg shadow-lg z-20 py-1">
            {spaces.map(space => (
              <SpaceMenuItem
                key={space.id}
                space={space}
                isCurrent={space.slug === currentSpace?.slug}
                pageTree={spaceTrees[space.slug] || []}
                onClose={() => setActiveItem(null)}
                isOpen={activeSpaceId === space.id}
                onMouseEnter={() => setActiveSpaceId(space.id)}
              />
            ))}
          </div>
        )}
      </div>
      {pagePath && pagePath.map((page, index) => (
        <Fragment key={page.id}>
          <ChevronRight className="w-4 h-4 flex-shrink-0" />
          <BreadcrumbPageItem
            page={page}
            siblings={index === 0 ? pageTree : (pagePath[index - 1].children || [])}
            spaceSlug={spaceSlug}
            isLast={index === pagePath.length - 1}
            isOpen={activeItem === index}
            onMouseEnter={() => handleItemEnter(index)}
            onMouseLeave={handleItemLeave}
          />
        </Fragment>
      ))}
      {!pagePath && pageTitle && (
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
