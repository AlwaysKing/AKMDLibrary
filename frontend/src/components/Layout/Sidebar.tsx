import { Settings, ChevronsLeft, Trash2, ArrowLeft, Users, Database, User, Image, ChevronDown, ChevronRight, Plus, LogOut } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import SpaceSelector from '../Sidebar/SpaceSelector';
import PageTree from '../Sidebar/PageTree';
import PageTreeItem from '../Sidebar/PageTreeItem';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { usePageStore } from '../../stores/pageStore';
import { useState, useRef, useEffect } from 'react';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ onToggle }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const { currentSpace } = useSpaceStore();
  const createPage = usePageStore((state) => state.createPage);
  const isAdmin = location.pathname.startsWith('/admin');
  const isAdminRole = user?.role === 'admin';
  const adminTab = new URLSearchParams(location.search).get('tab') || (isAdminRole ? 'users' : 'profile');

  const { starredPages, recentPages } = useSpaceStore();
  const [sectionsCollapsed, setSectionsCollapsed] = useState<Record<string, boolean>>({});
  const [sidebarExpandedIds, setSidebarExpandedIds] = useState<Set<string>>(new Set());
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showUserMenu) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [showUserMenu]);

  const handleAdminBack = () => {
    const slug = currentSpace?.slug || useSpaceStore.getState().spaces[0]?.slug;
    if (slug) {
      navigate(`/s/${slug}`);
    } else {
      navigate('/');
    }
  };

  // 管理面板侧边栏
  if (isAdmin) {
    return (
      <aside className="w-[270px] bg-notion-sidebarBg h-screen flex flex-col border-r border-notion-border flex-shrink-0 select-none">
        <div className="px-3 py-3 flex items-center gap-2">
          <button
            onClick={handleAdminBack}
            className="p-1 hover:bg-notion-hover rounded transition-colors flex-shrink-0"
            title="返回"
          >
            <ArrowLeft size={16} className="text-notion-textSecondary" />
          </button>
          <span className="text-sm font-medium text-notion-text">设置</span>
        </div>
        <div className="border-t border-notion-border/60 mx-2" />
        <nav className="px-2 py-2 space-y-0.5">
          {/* 设置组 */}
          <p className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-notion-sidebarSecHeader uppercase tracking-wider">设置</p>
          {isAdminRole && (
            <button
              onClick={() => navigate('/admin?tab=site')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors ${
                adminTab === 'site'
                  ? 'bg-notion-hover text-notion-text font-medium'
                  : 'text-notion-text hover:bg-notion-hover'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>站点设置</span>
            </button>
          )}
          <button
            onClick={() => navigate('/admin?tab=profile')}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors ${
              adminTab === 'profile'
                ? 'bg-notion-hover text-notion-text font-medium'
                : 'text-notion-text hover:bg-notion-hover'
            }`}
          >
            <User className="w-4 h-4" />
            <span>个人设置</span>
          </button>

          {/* 管理组 */}
          <p className="px-2 pt-3 pb-0.5 text-[11px] font-medium text-notion-sidebarSecHeader uppercase tracking-wider">管理</p>
          {isAdminRole && (
            <>
              <button
                onClick={() => navigate('/admin?tab=users')}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors ${
                  adminTab === 'users'
                    ? 'bg-notion-hover text-notion-text font-medium'
                    : 'text-notion-text hover:bg-notion-hover'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>用户管理</span>
              </button>
              <button
                onClick={() => navigate('/admin?tab=spaces')}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors ${
                  adminTab === 'spaces'
                    ? 'bg-notion-hover text-notion-text font-medium'
                    : 'text-notion-text hover:bg-notion-hover'
                }`}
              >
                <Database className="w-4 h-4" />
                <span>空间管理</span>
              </button>
            </>
          )}
          <button
            onClick={() => navigate('/admin?tab=resources')}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors ${
              adminTab === 'resources'
                ? 'bg-notion-hover text-notion-text font-medium'
                : 'text-notion-text hover:bg-notion-hover'
            }`}
          >
            <Image className="w-4 h-4" />
            <span>资源管理</span>
          </button>
        </nav>
      </aside>
    );
  }

  const handleSidebarToggleExpand = (pageId: string, expanded: boolean) => {
    setSidebarExpandedIds(prev => {
      const next = new Set(prev);
      if (expanded) next.add(pageId); else next.delete(pageId);
      return next;
    });
  };

  const toggleSection = (key: string) => {
    setSectionsCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleNewRootPage = async () => {
    if (!currentSpace) return;
    try {
      const newPage = await createPage(currentSpace.slug, '未命名页面');
      navigate(`/s/${currentSpace.slug}/p/${newPage.id}`);
    } catch (error) {
      console.error('Failed to create page:', error);
    }
  };

  const SectionHeader = ({ title, sectionKey, onAdd }: { title: string; sectionKey: string; onAdd?: () => void }) => (
    <div className="w-full flex items-center h-[30px] px-2 rounded-md hover:bg-notion-hover transition-colors group">
      <button
        onClick={() => toggleSection(sectionKey)}
        className="flex items-center flex-1 min-w-0"
      >
        <span className="text-xs font-medium leading-none text-notion-sidebarSecHeader">{title}</span>
        <span className="flex-shrink-0 ml-1 opacity-0 group-hover:opacity-100">
          {sectionsCollapsed[sectionKey] ? (
            <ChevronRight className="w-3 h-3 text-notion-sidebarSecHeader" />
          ) : (
            <ChevronDown className="w-3 h-3 text-notion-sidebarSecHeader" />
          )}
        </span>
      </button>
      {onAdd && (
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          className="flex items-center justify-center w-5 h-5 hover:bg-notion-border rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
          title="新建页面"
        >
          <Plus className="w-4 h-4 text-[#8e8b86]" />
        </button>
      )}
    </div>
  );

  return (
    <aside className="w-[270px] bg-notion-sidebarBg h-screen flex flex-col border-r border-notion-border flex-shrink-0 select-none">
      {/* Space selector header */}
      <div className="px-2 flex items-center h-11 gap-1">
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-notion-hover transition-colors text-lg"
            title="用户菜单"
          >
            {user?.avatar_url || '👤'}
          </button>
          {showUserMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-notion-border rounded-lg shadow-lg p-1 z-50 min-w-[160px]">
              <button
                onClick={() => { useAuthStore.getState().logout(); navigate('/login'); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-notion-text hover:bg-notion-hover transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>退出登录</span>
              </button>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <SpaceSelector />
        </div>
        <button
          onClick={onToggle}
          className="p-1 hover:bg-notion-hover rounded transition-colors flex-shrink-0"
          title="Collapse sidebar"
        >
          <ChevronsLeft size={16} className="text-notion-textSecondary" />
        </button>
      </div>

      {/* Three sections: 最近 / 最爱 / 文档 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-1">
        {/* 最近 */}
        {currentSpace && (
          <div className="mb-3">
            <SectionHeader title="最近" sectionKey="recent" />
            {!sectionsCollapsed['recent'] && (
              <div>
                {recentPages.length === 0 ? (
                  <div className="text-xs text-notion-textSecondary px-2 py-1.5">暂无最近访问</div>
                ) : (
                  <>
                    {(showAllRecent ? recentPages.slice(0, 20) : recentPages.slice(0, 5)).map(p => (
                      <PageTreeItem key={p.id} page={p} level={0} expandedPageIds={sidebarExpandedIds} onToggleExpand={handleSidebarToggleExpand} />
                    ))}
                    {!showAllRecent && recentPages.length > 5 && (
                      <button
                        onClick={() => setShowAllRecent(true)}
                        className="w-full flex items-center h-[30px] rounded-md hover:bg-notion-hover transition-colors text-left"
                        style={{ paddingLeft: '16px', paddingRight: '8px' }}
                      >
                        <span className="flex items-center justify-center flex-shrink-0 mr-2" style={{ width: '22px', height: '18px' }}>
                          <span className="text-sm font-medium text-notion-textSecondary">…</span>
                        </span>
                        <span className="text-sm font-medium text-notion-textSecondary">显示更多</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* 最爱 */}
        {currentSpace && (
          <div className="mb-3">
            <SectionHeader title="最爱" sectionKey="starred" />
            {!sectionsCollapsed['starred'] && (
              <div>
                {starredPages.length === 0 ? (
                  <div className="text-xs text-notion-textSecondary px-2 py-1.5">暂无收藏页面</div>
                ) : (
                  starredPages.map(p => (
                    <PageTreeItem key={p.id} page={p} level={0} expandedPageIds={sidebarExpandedIds} onToggleExpand={handleSidebarToggleExpand} />
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* 文档 */}
        <div>
          <SectionHeader title="文档" sectionKey="docs" onAdd={handleNewRootPage} />
          {!sectionsCollapsed['docs'] && (
            <div>
              <PageTree />
            </div>
          )}
        </div>
      </div>

      {/* Bottom actions */}
      <div className="border-t border-notion-border/60">
        <div className="py-1">
          <button
            onClick={() => navigate(`/s/${currentSpace?.slug}/trash`)}
            disabled={!currentSpace}
            className="w-full flex items-center h-[30px] rounded-md hover:bg-notion-hover transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ paddingLeft: '16px', paddingRight: '8px' }}
          >
            <span className="flex items-center justify-center flex-shrink-0 mr-2" style={{ width: '22px', height: '18px' }}>
              <Trash2 className="w-[18px] h-[18px] text-[#91918e]" strokeWidth={1.7} />
            </span>
            <span className="text-sm font-medium text-notion-sidebarText">回收站</span>
          </button>
          <button
            onClick={() => navigate('/admin?tab=profile')}
            className="w-full flex items-center h-[30px] rounded-md hover:bg-notion-hover transition-colors text-left"
            style={{ paddingLeft: '16px', paddingRight: '8px' }}
          >
            <span className="flex items-center justify-center flex-shrink-0 mr-2" style={{ width: '22px', height: '18px' }}>
              <Settings className="w-[18px] h-[18px] text-[#91918e]" strokeWidth={1.7} />
            </span>
            <span className="text-sm font-medium text-notion-sidebarText">设置</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
