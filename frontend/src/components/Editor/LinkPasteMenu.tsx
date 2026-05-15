import { useState, useRef, useEffect } from 'react';
import { Link, Bookmark } from 'lucide-react';

interface LinkPasteMenuProps {
  url: string;
  position: { x: number; y: number };
  onInsertLink: (url: string, title: string) => void;
  onInsertBookmark: (url: string) => void;
  onClose: () => void;
}

export default function LinkPasteMenu({ url, position, onInsertLink, onInsertBookmark, onClose }: LinkPasteMenuProps) {
  const [mode, setMode] = useState<'menu' | 'link'>('menu');
  const [title, setTitle] = useState(url);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode === 'link' && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [mode]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Clamp position to viewport
  const menuWidth = 260;
  const menuHeight = 200;
  let left = position.x;
  let top = position.y;
  if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
  if (left < 8) left = 8;
  if (top + menuHeight > window.innerHeight - 8) top = window.innerHeight - menuHeight - 8;
  if (top < 8) top = 8;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white border border-notion-border rounded-lg shadow-xl py-1.5 px-1.5 min-w-[260px]"
      style={{ top, left }}
    >
      {mode === 'menu' && (
        <>
          <button
            onClick={() => setMode('link')}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-notion-text hover:bg-notion-hover rounded-md transition-colors"
          >
            <Link className="w-4 h-4 text-notion-textSecondary" />
            普通链接
          </button>
          <button
            onClick={() => onInsertBookmark(url)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-notion-text hover:bg-notion-hover rounded-md transition-colors"
          >
            <Bookmark className="w-4 h-4 text-notion-textSecondary" />
            书签卡片
          </button>
        </>
      )}
      {mode === 'link' && (
        <div className="px-1">
          <p className="text-xs text-notion-textSecondary mb-1.5">链接标题</p>
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onInsertLink(url, title || url);
              if (e.key === 'Escape') onClose();
            }}
            className="w-full text-sm text-notion-text bg-white border border-notion-border rounded px-2 py-1.5 focus:outline-none focus:border-blue-400 mb-1.5"
            placeholder="输入链接标题"
          />
          <div className="flex justify-end gap-1">
            <button
              onClick={() => setMode('menu')}
              className="text-xs px-2 py-1 text-notion-textSecondary hover:bg-notion-hover rounded transition-colors"
            >
              返回
            </button>
            <button
              onClick={() => onInsertLink(url, title || url)}
              className="text-xs px-2 py-1 bg-notion-text text-white rounded hover:bg-gray-700 transition-colors"
            >
              确认
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
