import { Settings, PanelLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SpaceSelector from '../Sidebar/SpaceSelector';
import PageTree from '../Sidebar/PageTree';
import NewPageButton from '../Sidebar/NewPageButton';
import { useAuthStore } from '../../stores/authStore';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  if (collapsed) {
    return (
      <div className="w-10 bg-notion-sidebarBg h-screen flex flex-col items-center pt-3 gap-1 border-r border-notion-border">
        <button
          onClick={onToggle}
          className="p-1.5 hover:bg-notion-hover rounded transition-colors"
          title="Expand sidebar"
        >
          <PanelLeft size={18} className="text-notion-textSecondary" />
        </button>
      </div>
    );
  }

  return (
    <aside className="w-60 bg-notion-sidebarBg h-screen flex flex-col border-r border-notion-border flex-shrink-0">
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
        {user?.role === 'admin' && (
          <button
            onClick={() => navigate('/admin')}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-notion-hover transition-colors text-left text-notion-textSecondary"
          >
            <Settings className="w-4 h-4" />
            <span className="text-sm">设置</span>
          </button>
        )}
      </div>
    </aside>
  );
}
