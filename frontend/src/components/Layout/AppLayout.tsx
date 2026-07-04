import { useState, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { ClaudeChat } from '../ClaudeChat';
import { useUndoStore } from '../../stores/undoStore';
import { usePreferenceStore } from '../../stores/preferenceStore';

const DEFAULT_SIDEBAR_WIDTH = 270;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;

function clampSidebarWidth(width: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const toggle = () => setSidebarCollapsed(!sidebarCollapsed);
  const { undo, redo } = useUndoStore();
  const { isLoaded, preferences, setSidebarWidth: saveSidebarWidth } = usePreferenceStore();
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);

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

  useEffect(() => {
    if (!isLoaded || dragStateRef.current) return;
    const preferredWidth = preferences.sidebar_width;
    if (typeof preferredWidth === 'number') {
      setSidebarWidth(clampSidebarWidth(preferredWidth));
    } else {
      setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    }
  }, [isLoaded, preferences.sidebar_width]);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const handleResizeStart = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    dragStateRef.current = {
      startX: e.clientX,
      startWidth: sidebarWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      const nextWidth = clampSidebarWidth(dragState.startWidth + event.clientX - dragState.startX);
      setSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      if (dragStateRef.current) {
        saveSidebarWidth(clampSidebarWidth(sidebarWidthRef.current));
      }
      dragStateRef.current = null;
      setIsResizingSidebar(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="flex h-screen bg-notion-bg">
      <div
        className={`flex-shrink-0 overflow-hidden ${isResizingSidebar ? '' : 'transition-[width] duration-200 ease-in-out'}`}
        style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
      >
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggle} />
      </div>
      {!sidebarCollapsed && (
        <div
          className="w-1 cursor-col-resize bg-transparent transition-colors hover:bg-notion-border"
          onMouseDown={handleResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
        />
      )}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet context={{ sidebarCollapsed, toggleSidebar: toggle }} />
      </main>
      <ClaudeChat />
    </div>
  );
}
