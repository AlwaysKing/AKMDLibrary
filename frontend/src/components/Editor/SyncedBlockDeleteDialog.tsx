import { AlertTriangle } from 'lucide-react';

type DeleteStrategy = 'cascade' | 'placeholder' | 'inline';

type Props = {
  quotedCount: number;
  onSelect: (strategy: DeleteStrategy) => void;
  onClose: () => void;
};

export function SyncedBlockDeleteDialog({ quotedCount, onSelect, onClose }: Props) {
  return (
    <div className="sync-dialog-backdrop" onMouseDown={onClose}>
      <div className="sync-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sync-dialog-title">
          <AlertTriangle size={16} />
          <span>删除同步块源？</span>
        </div>
        <div className="sync-dialog-body">
          这个源块正在被 {quotedCount} 处引用。请选择删除后引用位置的处理方式。
        </div>
        <div className="sync-delete-options">
          <button type="button" onClick={() => onSelect('cascade')}>
            <strong>级联删除</strong>
            <span>同时删除所有引用块</span>
          </button>
          <button type="button" onClick={() => onSelect('placeholder')}>
            <strong>保留占位</strong>
            <span>引用块显示源已消失</span>
          </button>
          <button type="button" onClick={() => onSelect('inline')}>
            <strong>转为普通内容</strong>
            <span>引用位置保留当前内容副本</span>
          </button>
        </div>
      </div>
    </div>
  );
}
