import { useState, useRef, useEffect } from 'react';
import { ChevronRight, FileText, MoreHorizontal, Plus, Trash2, Edit3, Star, Link, Copy, FolderInput } from 'lucide-react';
import { Page } from '../../api/pages';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { usePageStore } from '../../stores/pageStore';
import { useSpaceStore } from '../../stores/spaceStore';
import MoveToDialog from './MoveToDialog';

interface PageTreeItemProps {
  page: Page;
  level: number;
  expandedPageIds: Set<number>;
  onToggleExpand: (pageId: number, expanded: boolean) => void;
}

export default function PageTreeItem({ page, level, expandedPageIds, onToggleExpand }: PageTreeItemProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(page.title);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { spaceSlug } = useParams<{ spaceSlug: string }>();
  const { createPage, deletePage, updateMetadata, refreshPageTree, duplicatePage, movePage } = usePageStore();
  const hasChildren = page.children && page.children.length > 0;
  const isActive = location.pathname.includes(`/p/${page.id}`);
  const isExpanded = expandedPageIds.has(page.id);

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

  const handleToggleStar = async () => {
    if (!spaceSlug) return;
    setShowMenu(false);
    try {
      await updateMetadata(spaceSlug, page.id, { is_starred: !page.is_starred });
      await refreshPageTree();
      useSpaceStore.getState().fetchStarred(spaceSlug);
    } catch (err) {
      console.error('Failed to toggle star:', err);
    }
  };

  const handleCopyLink = async () => {
    if (!spaceSlug) return;
    setShowMenu(false);
    const url = `${window.location.origin}/s/${spaceSlug}/p/${page.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const handleDuplicate = async () => {
    if (!spaceSlug) return;
    setShowMenu(false);
    try {
      await duplicatePage(spaceSlug, page.id);
      await refreshPageTree();
    } catch (err) {
      console.error('Failed to duplicate page:', err);
    }
  };

  const handleMove = async (targetParentId: number | null) => {
    if (!spaceSlug) return;
    setShowMoveDialog(false);
    try {
      await movePage(spaceSlug, page.id, targetParentId);
      await refreshPageTree();
    } catch (err) {
      console.error('Failed to move page:', err);
    }
  };

  return (
    <div>
      <div
        className={`w-full flex items-center h-[30px] rounded-md hover:bg-notion-hover transition-colors text-left group ${
          isActive ? 'bg-notion-hover' : ''
        }`}
        style={{ paddingLeft: `${level * 16 + 16}px`, paddingRight: '8px' }}
      >
        {/* Icon/Chevron — icon by default, chevron on row hover */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleExpand(page.id, !isExpanded); }}
          className="flex items-center justify-center flex-shrink-0 mr-2 rounded transition-colors"
          style={{ width: '22px', height: '18px' }}
        >
          {page.icon ? (
            (page.icon.startsWith('/') || page.icon.startsWith('http')) ? (
              <img src={page.icon} alt="" className="w-[18px] h-[18px] object-contain group-hover:hidden" />
            ) : (
              <span className="text-[18px] leading-none group-hover:hidden" style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"' }}>{page.icon}</span>
            )
          ) : (
            <FileText className="w-[18px] h-[18px] text-[#91918e] group-hover:hidden" strokeWidth={1.7} />
          )}
          <ChevronRight className={`w-3 h-3 text-[#ada9a3] hidden group-hover:block transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        </button>

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
            className={`text-sm font-medium truncate flex-1 cursor-pointer ${isActive ? 'text-notion-text' : 'text-notion-sidebarText'}`}
          >
            {page.title || '未命名页面'}
          </span>
        )}

        {/* Copy feedback toast */}
        {copyFeedback && (
          <span className="text-xs text-green-600 flex-shrink-0 mr-1">已复制</span>
        )}

        {/* More menu button */}
        <button
          onClick={openMenu}
          className="flex items-center justify-center w-5 h-5 hover:bg-notion-border rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
        >
          <MoreHorizontal className="w-4 h-4 text-[#8e8b86]" />
        </button>

        {/* Quick add sub-page button */}
        <button
          onClick={(e) => { e.stopPropagation(); handleAddSubPage(); }}
          className="flex items-center justify-center w-5 h-5 hover:bg-notion-border rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 ml-1"
          title="添加子页面"
        >
          <Plus className="w-4 h-4 text-[#8e8b86]" />
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
            onClick={handleToggleStar}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-notion-text hover:bg-notion-hover transition-colors"
          >
            <Star className={`w-4 h-4 ${page.is_starred ? 'fill-yellow-400 text-yellow-400' : 'text-notion-textSecondary'}`} />
            {page.is_starred ? '取消收藏' : '添加收藏'}
          </button>
          <button
            onClick={() => { setShowMenu(false); setIsRenaming(true); }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-notion-text hover:bg-notion-hover transition-colors"
          >
            <Edit3 className="w-4 h-4 text-notion-textSecondary" />
            重命名
          </button>
          <button
            onClick={handleCopyLink}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-notion-text hover:bg-notion-hover transition-colors"
          >
            <Link className="w-4 h-4 text-notion-textSecondary" />
            拷贝链接
          </button>
          <button
            onClick={handleDuplicate}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-notion-text hover:bg-notion-hover transition-colors"
          >
            <Copy className="w-4 h-4 text-notion-textSecondary" />
            创建副本
          </button>
          <button
            onClick={() => { setShowMenu(false); setShowMoveDialog(true); }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-notion-text hover:bg-notion-hover transition-colors"
          >
            <FolderInput className="w-4 h-4 text-notion-textSecondary" />
            移动到
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

      {/* Move-to dialog */}
      {showMoveDialog && (
        <MoveToDialog
          pageId={page.id}
          pageTree={useSpaceStore.getState().pageTree}
          onClose={() => setShowMoveDialog(false)}
          onMove={handleMove}
        />
      )}

      {/* Children or empty state */}
      {isExpanded && (
        hasChildren ? (
          <div>
            {page.children!.map((child) => (
              <PageTreeItem key={child.id} page={child} level={level + 1} expandedPageIds={expandedPageIds} onToggleExpand={onToggleExpand} />
            ))}
          </div>
        ) : (
          <div
            className="flex items-center h-[30px] rounded-md text-left"
            style={{ paddingLeft: `${level * 16 + 32}px`, paddingRight: '8px' }}
          >
            <span className="text-sm font-semibold text-notion-textSecondary">内无页面</span>
          </div>
        )
      )}
    </div>
  );
}
