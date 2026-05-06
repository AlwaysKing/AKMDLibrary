import { Menu } from 'lucide-react';
import SpaceSelector from '../Sidebar/SpaceSelector';
import PageTree from '../Sidebar/PageTree';
import NewPageButton from '../Sidebar/NewPageButton';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  if (collapsed) {
    return (
      <div className="w-10 bg-notion-sidebarBg h-screen flex flex-col items-center pt-3 border-r border-notion-border">
        <button
          onClick={onToggle}
          className="p-1.5 hover:bg-notion-hover rounded transition-colors"
          title="Expand sidebar"
        >
          <Menu size={18} className="text-notion-textSecondary" />
        </button>
      </div>
    );
  }

  return (
    <aside className="w-60 bg-notion-sidebarBg h-screen flex flex-col border-r border-notion-border flex-shrink-0">
      <div className="p-3 border-b border-notion-border flex items-center justify-between">
        <SpaceSelector />
        <button
          onClick={onToggle}
          className="p-1 hover:bg-notion-hover rounded transition-colors"
          title="Collapse sidebar"
        >
          <Menu size={16} className="text-notion-textSecondary" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2">
        <PageTree />
      </div>
      <div className="p-3 border-t border-notion-border">
        <NewPageButton />
      </div>
    </aside>
  );
}
