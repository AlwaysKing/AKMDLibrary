import { useEffect, useRef } from 'react';
import { ChatMessage, ChatStatus } from '../../hooks/useClaudeChat';

interface Props {
  messages: ChatMessage[];
  status: ChatStatus;
}

export function MessageList({ messages, status }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新消息或思考状态变化时滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, status]);

  if (messages.length === 0 && status !== 'answering') {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-notion-textSecondary">
        向 Agent 提问关于这个空间的问题
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
      {messages.map(m => {
        if (m.role === 'user') {
          return (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm whitespace-pre-wrap">
                {m.content}
                {m.attachments && m.attachments.length > 0 && (
                  <div className="mt-1 pt-1 border-t border-white/30 flex flex-wrap gap-1">
                    {m.attachments.map((a, i) => (
                      <span key={i} className="text-xs px-1 py-0.5 bg-white/20 rounded">
                        📎 {a.filename}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        }
        if (m.role === 'assistant') {
          return (
            <div key={m.id} className="flex">
              <div className="max-w-[90%] px-3 py-1.5 bg-white border border-notion-border rounded-lg text-sm text-notion-text whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          );
        }
        // system
        const cls = m.variant === 'error'
          ? 'bg-red-50 text-red-700 border-red-200'
          : 'bg-amber-50 text-amber-800 border-amber-200';
        return (
          <div key={m.id} className={`text-xs px-2 py-1 border rounded ${cls}`}>
            {m.content}
          </div>
        );
      })}
      {status === 'answering' && (
        <div className="flex">
          <div className="px-3 py-2.5 bg-white border border-notion-border rounded-lg inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-notion-textSecondary/60 animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-notion-textSecondary/60 animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-notion-textSecondary/60 animate-bounce" />
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
