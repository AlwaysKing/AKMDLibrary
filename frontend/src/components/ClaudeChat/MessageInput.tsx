import { useRef, useState, KeyboardEvent, ChangeEvent, ClipboardEvent } from 'react';
import { Send, Paperclip, Loader2, X } from 'lucide-react';
import { ChatAttachment } from '../../hooks/useClaudeChat';

interface Props {
  onSend: (text: string, attachments?: ChatAttachment[]) => void;
  disabled: boolean;
  uploadAttachment: (file: File) => Promise<{ attachmentId: string; filename: string }>;
  // 由 ChatPanel 提升上来的附件状态（整个面板都是 drop target）
  pendings: PendingAttachment[];
  onRemovePending: (localId: string) => void;
  onFiles: (files: FileList | File[] | null) => void;
}

export const MAX_SIZE = 5 * 1024 * 1024; // 5MB

/** 单个附件在 UI 中的状态机：uploading → done | error */
export interface PendingAttachment {
  /** 前端临时 id，仅用于 react key */
  localId: string;
  filename: string;
  status: 'uploading' | 'done' | 'error';
  /** 上传成功后的后端 attachmentId（done 时有值） */
  attachmentId?: string;
  /** 失败时的错误信息 */
  error?: string;
}

let localIdCounter = 0;
export function nextLocalId() {
  localIdCounter += 1;
  return `pa_${Date.now()}_${localIdCounter}`;
}

export function MessageInput({ onSend, disabled, pendings, onRemovePending, onFiles }: Props) {
  const [text, setText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (!text.trim() || disabled) return;
    // 只取上传完成的附件，进行中的附件不阻塞发送（用户应等上传完再发）
    const ready = pendings.filter(p => p.status === 'done' && p.attachmentId);
    onSend(
      text,
      ready.length > 0 ? ready.map(p => ({ attachmentId: p.attachmentId!, filename: p.filename })) : undefined,
    );
    setText('');
    // pendings 由 ChatPanel 持有，发送后由 ChatPanel 清空
    // 这里通过 onRemovePending 逐个清掉
    pendings.forEach(p => onRemovePending(p.localId));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onFilePick = (e: ChangeEvent<HTMLInputElement>) => {
    onFiles(e.target.files);
    e.target.value = ''; // 允许重复选择同一文件
  };

  // 粘贴：仅处理图片（clipboard API 对文件类型有限支持，图片是最常见用例）
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) {
          // 浏览器给的粘贴文件名通常是 "image.png" 这种，重命名带时间戳避免冲突
          const ext = f.name.split('.').pop() || 'png';
          const renamed = new File([f], `pasted-${Date.now()}.${ext}`, { type: f.type });
          imageFiles.push(renamed);
        }
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault(); // 阻止默认粘贴（避免把图片二进制当文本插入）
      onFiles(imageFiles);
    }
  };

  const hasUploading = pendings.some(p => p.status === 'uploading');
  const canSend = !disabled && !hasUploading && (text.trim().length > 0 || pendings.some(p => p.status === 'done'));

  return (
    <div className="border-t border-notion-border px-3 py-2 flex flex-col gap-1">
      {pendings.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {pendings.map(p => (
            <AttachmentChip key={p.localId} attachment={p} onRemove={() => onRemovePending(p.localId)} />
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="p-2 text-notion-textSecondary hover:bg-notion-hover rounded disabled:opacity-30"
          title="上传附件"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onFilePick}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={1}
          placeholder={disabled ? 'Agent 正在回答...' : '输入消息，Enter 发送，拖拽/粘贴/点📎上传文件'}
          className="flex-1 px-2 py-1.5 border border-notion-border rounded text-sm resize-none max-h-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
          disabled={disabled}
        />
        <button
          onClick={submit}
          disabled={!canSend}
          className="p-2 bg-notion-text text-white rounded hover:bg-notion-text/90 disabled:opacity-30"
          title={hasUploading ? '附件上传中...' : '发送'}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/** 附件 chip：上传中显示 spinner，完成显示 📎+filename，失败显示错误 */
function AttachmentChip({ attachment, onRemove }: { attachment: PendingAttachment; onRemove: () => void }) {
  const base = 'text-xs px-1.5 py-0.5 rounded flex items-center gap-1 max-w-[180px]';
  if (attachment.status === 'uploading') {
    return (
      <span className={`${base} bg-blue-100 text-blue-700`}>
        <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
        <span className="truncate">{attachment.filename}</span>
      </span>
    );
  }
  if (attachment.status === 'error') {
    return (
      <span className={`${base} bg-red-100 text-red-700`} title={attachment.error}>
        <span className="truncate">⚠ {attachment.filename}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-red-500 hover:text-red-800 flex-shrink-0"
          title="移除"
        >
          <X className="w-3 h-3" />
        </button>
      </span>
    );
  }
  // done
  return (
    <span className={`${base} bg-blue-100 text-blue-800`}>
      <Paperclip className="w-3 h-3 flex-shrink-0" />
      <span className="truncate">{attachment.filename}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-blue-500 hover:text-blue-800 flex-shrink-0"
        title="移除"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
