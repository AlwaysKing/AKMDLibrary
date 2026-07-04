import { useCallback, useEffect, useRef, useState } from 'react';

export type ChatStatus = 'idle' | 'answering' | 'error';

export interface ChatMessage {
  id: string; // 用于 react key
  role: 'user' | 'assistant' | 'system';
  content: string;
  variant?: 'denied' | 'error'; // system 消息的子类型
}

interface UseClaudeChatOptions {
  spaceSlug: string | null;
  enabled: boolean; // space 是否启用 claude
}

interface UseClaudeChatReturn {
  messages: ChatMessage[];
  status: ChatStatus;
  isConnected: boolean;
  send: (text: string) => void;
  reset: () => void;
}

let msgIdCounter = 0;
function nextId() {
  msgIdCounter += 1;
  return `m${Date.now()}_${msgIdCounter}`;
}

export function useClaudeChat({ spaceSlug, enabled }: UseClaudeChatOptions): UseClaudeChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // 切换 space 或 enabled 变化 → 重置
  useEffect(() => {
    if (!enabled || !spaceSlug) {
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) return;

    setMessages([]);
    setStatus('idle');

    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/spaces/${encodeURIComponent(spaceSlug)}/claude/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;
    };
    ws.onerror = () => setStatus('error');
    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.type) {
        case 'status':
          setStatus(msg.status === 'answering' ? 'answering' : 'idle');
          break;
        case 'assistant_message':
          setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: msg.content }]);
          setStatus('idle');
          break;
        case 'permission_denied':
          setMessages(prev => [...prev, {
            id: nextId(),
            role: 'system',
            variant: 'denied' as const,
            content: `已拒绝 ${msg.tool}${msg.path ? ' ' + msg.path : ''} — ${msg.reason}`,
          }]);
          break;
        case 'error':
          setMessages(prev => [...prev, {
            id: nextId(),
            role: 'system',
            variant: 'error' as const,
            content: msg.message,
          }]);
          setStatus('error');
          break;
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [spaceSlug, enabled]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (status === 'answering') return;
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: trimmed }]);
    wsRef.current.send(JSON.stringify({ type: 'user_message', content: trimmed }));
  }, [status]);

  const reset = useCallback(() => {
    setMessages([]);
    setStatus('idle');
  }, []);

  return { messages, status, isConnected, send, reset };
}
