import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useUndoStore } from '../../stores/undoStore';

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggle = () => setSidebarCollapsed(!sidebarCollapsed);
  const { undo, redo } = useUndoStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if focused on an input element
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || (e.target as HTMLElement).isContentEditable;
      if (isInput) return;

      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return (
    <div className="flex h-screen bg-notion-bg">
      <div
        className="flex-shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden"
        style={{ width: sidebarCollapsed ? 0 : 270 }}
      >
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggle} />
      </div>
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet context={{ sidebarCollapsed, toggleSidebar: toggle }} />
      </main>
    </div>
  );
}
