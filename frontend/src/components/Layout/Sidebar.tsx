import { Settings, PanelLeft, Trash2, ArrowLeft, Users, Database, LogOut, User } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import SpaceSelector from '../Sidebar/SpaceSelector';
import PageTree from '../Sidebar/PageTree';
import NewPageButton from '../Sidebar/NewPageButton';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const { currentSpace } = useSpaceStore();
  const isAdmin = location.pathname.startsWith('/admin');
  const isAdminRole = user?.role === 'admin';
  const adminTab = new URLSearchParams(location.search).get('tab') || (isAdminRole ? 'users' : 'profile');

  const handleAdminBack = () => {
    const slug = currentSpace?.slug || useSpaceStore.getState().spaces[0]?.slug;
    if (slug) {
      navigate(`/s/${slug}`);
    } else {
      navigate('/');
    }
  };

  if (collapsed) {
    return (
      <div className="w-10 bg-notion-sidebarBg h-screen flex flex-col items-center pt-3 gap-1 border-r border-notion-border flex-shrink-0">
        <button
          onClick={isAdmin ? handleAdminBack : onToggle}
          className="p-1.5 hover:bg-notion-hover rounded transition-colors"
          title={isAdmin ? '返回' : 'Expand sidebar'}
        >
          {isAdmin ? (
            <ArrowLeft size={18} className="text-notion-textSecondary" />
          ) : (
            <PanelLeft size={18} className="text-notion-textSecondary" />
          )}
        </button>
      </div>
    );
  }

  // 管理面板侧边栏
  if (isAdmin) {
    return (
      <aside className="w-[270px] bg-notion-sidebarBg h-screen flex flex-col border-r border-notion-border flex-shrink-0">
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
        </nav>
        <div className="mt-auto border-t border-notion-border/60 mx-2 pb-2">
          <button
            onClick={() => { useAuthStore.getState().logout(); navigate('/login'); }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm text-notion-text hover:bg-notion-hover transition-colors mt-1"
          >
            <LogOut className="w-4 h-4" />
            <span>退出登录</span>
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-[270px] bg-notion-sidebarBg h-screen flex flex-col border-r border-notion-border flex-shrink-0">
      {/* Space selector header */}
      <div className="px-2 py-2 flex items-center justify-between">
        <div className="flex-1">
          <SpaceSelector />
        </div>
        <button
          onClick={onToggle}
          className="p-1 hover:bg-notion-hover rounded transition-colors flex-shrink-0"
          title="Collapse sidebar"
        >
          <PanelLeft size={16} className="text-notion-textSecondary" />
        </button>
      </div>

      {/* Page tree */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-1.5 py-1">
        <PageTree />
      </div>

      {/* Bottom actions */}
      <div className="px-2 py-2 border-t border-notion-border/60 space-y-0.5">
        <NewPageButton />
        <button
          onClick={() => navigate(`/s/${currentSpace?.slug}/trash`)}
          disabled={!currentSpace}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-notion-hover transition-colors text-left text-notion-textSecondary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-4 h-4" />
          <span className="text-sm">回收站</span>
        </button>
        <button
          onClick={() => navigate('/admin?tab=profile')}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-notion-hover transition-colors text-left text-notion-textSecondary"
        >
          <Settings className="w-4 h-4" />
          <span className="text-sm">设置</span>
        </button>
      </div>
    </aside>
  );
}
