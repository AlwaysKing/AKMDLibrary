import { Repeat2 } from 'lucide-react';

type Props = {
  sourceMarkdown: string;
  onCreateSynced: () => void;
  onPasteNormal: () => void;
  onClose: () => void;
};

export function SyncedBlockPasteDialog({ sourceMarkdown, onCreateSynced, onPasteNormal, onClose }: Props) {
  const preview = sourceMarkdown.trim().slice(0, 220);

  return (
    <div className="sync-dialog-backdrop" onMouseDown={onClose}>
      <div className="sync-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sync-dialog-title">
          <Repeat2 size={16} />
          <span>创建同步块？</span>
        </div>
        <div className="sync-dialog-body">
          检测到来自其他页面的连续内容。可以保持普通副本，也可以创建多端同步的黄色同步块。
        </div>
        <pre className="sync-dialog-preview">{preview || '空内容'}</pre>
        <div className="sync-dialog-actions">
          <button type="button" className="sync-dialog-secondary" onClick={onPasteNormal}>
            普通粘贴
          </button>
          <button type="button" className="sync-dialog-primary" onClick={onCreateSynced}>
            创建为同步块
          </button>
        </div>
      </div>
    </div>
  );
}
