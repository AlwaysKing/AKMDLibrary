import { Bot } from 'lucide-react';

export function FloatingButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-notion-text text-white shadow-lg opacity-50 hover:opacity-100 transition-opacity flex items-center justify-center"
      title="Agent 助手"
    >
      <Bot className="w-6 h-6" />
    </button>
  );
}
