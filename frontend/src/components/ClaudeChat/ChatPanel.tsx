import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { useClaudeChat } from '../../hooks/useClaudeChat';

interface Props {
  spaceSlug: string;
  onClose: () => void;
}

export function ChatPanel({ spaceSlug, onClose }: Props) {
  const { messages, status, send } = useClaudeChat({ spaceSlug, enabled: true });
  const [pos, setPos] = useState({ x: window.innerWidth - 400, y: window.innerHeight - 560 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // 拖拽
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 380, e.clientX - dragRef.current.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragRef.current.dy)),
      });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  };

  return (
    <div
      className="fixed z-50 w-[380px] h-[520px] bg-notion-bg border border-notion-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        onMouseDown={startDrag}
        className="px-3 py-2 bg-notion-text text-white flex items-center justify-between cursor-move select-none"
      >
        <span className="text-sm font-medium">Claude</span>
        <button onClick={onClose} className="p-1 hover:bg-white/20 rounded" title="关闭">
          <X className="w-4 h-4" />
        </button>
      </div>
      {status === 'answering' && (
        <div className="px-3 py-1 text-xs text-notion-textSecondary bg-notion-hover border-b border-notion-border">
          Claude 正在思考...
        </div>
      )}
      <MessageList messages={messages} />
      <MessageInput onSend={send} disabled={status === 'answering'} />
    </div>
  );
}
