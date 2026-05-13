import { useState, useRef, useEffect } from 'react';
import { ChevronRight, FileText, MoreHorizontal, Plus, Trash2, Edit3 } from 'lucide-react';
import { Page } from '../../api/pages';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { usePageStore } from '../../stores/pageStore';

interface PageTreeItemProps {
  page: Page;
  level: number;
}

export default function PageTreeItem({ page, level }: PageTreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(page.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { spaceSlug } = useParams<{ spaceSlug: string }>();
  const { createPage, deletePage, updateMetadata, refreshPageTree } = usePageStore();
  const hasChildren = page.children && page.children.length > 0;
  const isActive = location.pathname.includes(`/p/${page.id}`);

  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (showMenu) {
      const handler = (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
          setShowMenu(false);
        }
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
  }, [showMenu]);

  useEffect(() => {
    if (isRenaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [isRenaming]);

  const handleClick = () => {
    if (isRenaming) return;
    navigate(`/s/${spaceSlug}/p/${page.id}`);
  };

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.left - 140 });
    setShowMenu(true);
  };

  const handleAddSubPage = async () => {
    if (!spaceSlug) return;
    setShowMenu(false);
    try {
      const newPage = await createPage(spaceSlug, '未命名页面', page.id);
      await refreshPageTree();
      navigate(`/s/${spaceSlug}/p/${newPage.id}`);
    } catch (err) {
      console.error('Failed to create sub-page:', err);
    }
  };

  const handleDelete = async () => {
    if (!spaceSlug) return;
    setShowMenu(false);
    try {
      await deletePage(spaceSlug, page.id);
      await refreshPageTree();
      if (isActive) {
        navigate(`/s/${spaceSlug}`);
      }
    } catch (err) {
      console.error('Failed to delete page:', err);
    }
  };

  const handleRenameSubmit = async () => {
    if (!spaceSlug || !renameTitle.trim()) {
      setRenameTitle(page.title);
      setIsRenaming(false);
      return;
    }
    try {
      await updateMetadata(spaceSlug, page.id, { title: renameTitle.trim() });
      await refreshPageTree();
    } catch (err) {
      console.error('Failed to rename page:', err);
      setRenameTitle(page.title);
    }
    setIsRenaming(false);
  };

  return (
    <div>
      <div
        className={`w-full flex items-center gap-1 h-[30px] px-3 rounded hover:bg-notion-hover transition-colors text-left group ${
          isActive ? 'bg-notion-hover' : ''
        }`}
        style={{ paddingLeft: `${level * 16 + 12}px`, paddingRight: '8px' }}
      >
        {/* Icon/Chevron — shared position: icon by default, chevron on hover */}
        {page.icon ? (
          <button
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
            className="w-5 h-5 flex items-center justify-center flex-shrink-0 hover:bg-notion-border rounded transition-colors group/icon"
          >
            {(page.icon.startsWith('/') || page.icon.startsWith('http')) ? (
              <img src={page.icon} alt="" className="w-4 h-4 object-contain group-hover/icon:hidden" />
            ) : (
              <span className="text-sm group-hover/icon:hidden">{page.icon}</span>
            )}
            <ChevronRight className={`w-4 h-4 text-notion-textSecondary hidden group-hover/icon:block transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
            className="w-5 h-5 flex items-center justify-center flex-shrink-0 hover:bg-notion-border rounded transition-colors group/icon"
          >
            <FileText className="w-4 h-4 text-notion-textSecondary group-hover/icon:hidden" />
            <ChevronRight className={`w-4 h-4 text-notion-textSecondary hidden group-hover/icon:block transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          </button>
        )}

        {/* Title or rename input */}
        {isRenaming ? (
          <input
            ref={renameRef}
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') { setRenameTitle(page.title); setIsRenaming(false); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 text-sm text-notion-text bg-white border border-blue-400 rounded px-1 py-0 focus:outline-none min-w-0"
          />
        ) : (
          <span
            onClick={handleClick}
            className="text-sm font-medium text-notion-text truncate flex-1 cursor-pointer"
          >
            {page.title || '未命名页面'}
          </span>
        )}

        {/* Quick add sub-page button */}
        <button
          onClick={(e) => { e.stopPropagation(); handleAddSubPage(); }}
          className="p-0.5 hover:bg-notion-border rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
          title="添加子页面"
        >
          <Plus className="w-4 h-4 text-notion-textSecondary" />
        </button>

        {/* More menu button */}
        <button
          onClick={openMenu}
          className="p-0.5 hover:bg-notion-border rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
        >
          <MoreHorizontal className="w-4 h-4 text-notion-textSecondary" />
        </button>
      </div>

      {/* Context menu */}
      {showMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-white border border-notion-border rounded-lg shadow-xl py-1 min-w-[180px]"
          style={{ top: menuPos.top, left: menuPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleAddSubPage}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-notion-text hover:bg-notion-hover transition-colors"
          >
            <Plus className="w-4 h-4 text-notion-textSecondary" />
            添加子页面
          </button>
          <button
            onClick={() => { setShowMenu(false); setIsRenaming(true); }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-notion-text hover:bg-notion-hover transition-colors"
          >
            <Edit3 className="w-4 h-4 text-notion-textSecondary" />
            重命名
          </button>
          <hr className="my-1 border-notion-border" />
          <button
            onClick={handleDelete}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            移到回收站
          </button>
        </div>
      )}

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {page.children!.map((child) => (
            <PageTreeItem key={child.id} page={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
