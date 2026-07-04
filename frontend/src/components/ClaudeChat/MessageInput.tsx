import { useState, KeyboardEvent } from 'react';
import { Send } from 'lucide-react';

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function MessageInput({ onSend, disabled }: Props) {
  const [text, setText] = useState('');

  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-notion-border p-2 flex items-end gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder={disabled ? 'Claude 正在回答...' : '输入消息，Enter 发送'}
        className="flex-1 px-2 py-1.5 border border-notion-border rounded text-sm resize-none max-h-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
        disabled={disabled}
      />
      <button
        onClick={submit}
        disabled={disabled || !text.trim()}
        className="p-2 bg-notion-text text-white rounded hover:bg-notion-text/90 disabled:opacity-30"
        title="发送"
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  );
}
