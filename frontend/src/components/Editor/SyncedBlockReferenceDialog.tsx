import { useEffect, useState } from 'react';
import { Repeat2 } from 'lucide-react';

interface SyncedBlockReferenceDialogProps {
  onConfirm: (sourcePageId: string, sourceBlockId: string) => void;
  onClose: () => void;
}

export function SyncedBlockReferenceDialog({ onConfirm, onClose }: SyncedBlockReferenceDialogProps) {
  const [sourcePageId, setSourcePageId] = useState('');
  const [sourceBlockId, setSourceBlockId] = useState('');
  const canSubmit = sourcePageId.trim().length > 0 && sourceBlockId.trim().length > 0;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  return (
    <div className="sync-dialog-backdrop" onMouseDown={onClose}>
      <form
        className="sync-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onConfirm(sourcePageId.trim(), sourceBlockId.trim());
        }}
      >
        <div className="sync-dialog-title">
          <Repeat2 size={16} />
          <span>引用同步块</span>
        </div>
        <div className="sync-dialog-body">输入源页面 ID 和源同步块 ID。</div>
        <label className="mt-4 flex flex-col gap-1">
          <span className="text-xs text-notion-textSecondary">源页面 ID</span>
          <input
            value={sourcePageId}
            onChange={(event) => setSourcePageId(event.target.value)}
            className="rounded border border-notion-border px-2 py-1.5 text-sm text-notion-text outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300"
            autoFocus
          />
        </label>
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-xs text-notion-textSecondary">源同步块 ID</span>
          <input
            value={sourceBlockId}
            onChange={(event) => setSourceBlockId(event.target.value)}
            className="rounded border border-notion-border px-2 py-1.5 text-sm text-notion-text outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300"
          />
        </label>
        <div className="sync-dialog-actions">
          <button type="button" className="sync-dialog-secondary" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="sync-dialog-primary disabled:cursor-not-allowed disabled:opacity-40" disabled={!canSubmit}>
            确认
          </button>
        </div>
      </form>
    </div>
  );
}
