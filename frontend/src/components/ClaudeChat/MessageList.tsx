import { ChatMessage } from '../../hooks/useClaudeChat';

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-notion-textSecondary">
        向 Claude 提问关于这个空间的问题
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
    </div>
  );
}
