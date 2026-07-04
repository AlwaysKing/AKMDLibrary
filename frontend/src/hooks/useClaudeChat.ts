import { useCallback, useEffect, useRef, useState } from 'react';
import { claudeApi } from '../api/claude';

export type ChatStatus = 'idle' | 'answering' | 'error';

export interface ChatMessage {
  id: string; // 用于 react key
  role: 'user' | 'assistant' | 'system';
  content: string;
  variant?: 'denied' | 'error'; // system 消息的子类型
  attachments?: { filename: string }[]; // 用户消息附带的文件名列表（仅 UI 展示）
}

/** 当前 UI 状态，发给后端拼装到 claude message 前置 block */
export interface ChatContext {
  activePageId?: string;
  selection?: string;
}

interface UseClaudeChatOptions {
  spaceSlug: string | null;
  enabled: boolean; // space 是否启用 claude
}

interface UseClaudeChatReturn {
  messages: ChatMessage[];
  status: ChatStatus;
  isConnected: boolean;
  sessionId: string | null;
  /** 发送消息：text + 可选 context + 可选附件列表 */
  send: (text: string, context?: ChatContext, attachments?: ChatAttachment[]) => void;
  /** 上传附件到当前 session，返回 attachmentId 与去重后的 filename */
  uploadAttachment: (file: File) => Promise<{ attachmentId: string; filename: string }>;
  reset: () => void;
}

/** 发送时引用的附件（前端把 attachmentId 与 filename 一起保留，便于 UI 显示） */
export interface ChatAttachment {
  attachmentId: string;
  filename: string;
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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // session_init 之前用户拖的文件暂存这里，session_init 后自动 flush
  const pendingQueueRef = useRef<Array<{
    file: File;
    resolve: (r: { attachmentId: string; filename: string }) => void;
    reject: (e: Error) => void;
  }>>([]);

  // WS 未连时入队的待发送消息，WS onopen 后 flush
  const pendingSendRef = useRef<Array<{ text: string; context?: ChatContext; attachments?: ChatAttachment[] }>>([]);

  // 在 connect 内读取最新 spaceSlug/enabled，避免把 connect 加进 useEffect deps
  const cfgRef = useRef({ spaceSlug, enabled });
  cfgRef.current = { spaceSlug, enabled };

  // 创建 WS 连接（lazy：仅在 send 时触发）
  const connect = useCallback(() => {
    if (wsRef.current) return; // 已经在连/已连
    const { spaceSlug: slug, enabled: en } = cfgRef.current;
    if (!en || !slug) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/spaces/${encodeURIComponent(slug)}/claude/ws?token=${encodeURIComponent(token)}`;
    console.log('[useClaudeChat] connecting to', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[useClaudeChat] WS open');
      if (wsRef.current !== ws) return;
      setIsConnected(true);
      // flush 队列中待发送的消息
      const queue = pendingSendRef.current;
      pendingSendRef.current = [];
      queue.forEach(m => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'user_message',
            content: m.text,
            context: m.context || {},
            attachments: m.attachments?.map(a => a.attachmentId) || [],
          }));
        }
      });
    };
    ws.onclose = (e) => {
      console.log('[useClaudeChat] WS close:', e.code, e.reason);
      // 只在自己仍是当前连接时才清，避免 StrictMode 双 mount 时
      // ws1 的异步 onclose 把 ws2 的 wsRef 引用清掉导致 send 静默失败
      if (wsRef.current === ws) {
        wsRef.current = null;
        setIsConnected(false);
        setSessionId(null);
      }
    };
    ws.onerror = (e) => {
      console.error('[useClaudeChat] WS error:', e);
      if (wsRef.current === ws) setStatus('error');
    };
    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.type) {
        case 'session_init':
          console.log('[useClaudeChat] session_init', msg.session_id);
          if (wsRef.current === ws) {
            setSessionId(msg.session_id);
            flushPendingUploads(msg.session_id);
          }
          break;
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
  }, []);

  // 切 space / enabled 变化 / 卸载：关闭 WS 并重置
  // 注意：这里不 auto-connect，由 send 触发 lazy connect
  useEffect(() => {
    setMessages([]);
    setStatus('idle');
    setSessionId(null);
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
      setSessionId(null);
      pendingSendRef.current = [];
    };
  }, [spaceSlug, enabled]);

  const send = useCallback((text: string, context?: ChatContext, attachments?: ChatAttachment[]) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (status === 'answering') return;

    // 用户消息 bubble 上附带附件文件名（仅 UI 展示用，后端会通过 attachmentId 解析）
    const fileMeta = attachments?.map(a => ({ filename: a.filename })) || [];
    setMessages(prev => [...prev, {
      id: nextId(),
      role: 'user',
      content: trimmed,
      attachments: fileMeta.length > 0 ? fileMeta : undefined,
    }]);

    // WS 未连：入队 + 触发 lazy connect，等 onopen flush
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      pendingSendRef.current.push({ text: trimmed, context, attachments });
      connect();
      return;
    }

    wsRef.current.send(JSON.stringify({
      type: 'user_message',
      content: trimmed,
      context: context || {},
      attachments: attachments?.map(a => a.attachmentId) || [],
    }));
  }, [status, connect]);

  const uploadAttachment = useCallback(async (file: File) => {
    if (!spaceSlug) {
      throw new Error('space 未就绪，无法上传');
    }
    // session 没 ready：把文件加入 pending 队列，返回 Promise
    // 等 session_init 触发后自动 flush 上传并 resolve
    if (!sessionId) {
      console.log('[useClaudeChat] session 未就绪，文件入队:', file.name);
      return new Promise<{ attachmentId: string; filename: string }>((resolve, reject) => {
        pendingQueueRef.current.push({ file, resolve, reject });
      });
    }
    return claudeApi.uploadAttachment(spaceSlug, sessionId, file);
  }, [spaceSlug, sessionId]);

  // session_init 后 flush 队列
  const flushPendingUploads = (sid: string) => {
    if (!spaceSlug) return;
    const queue = pendingQueueRef.current;
    if (queue.length === 0) return;
    console.log(`[useClaudeChat] flush ${queue.length} 个待上传文件`);
    pendingQueueRef.current = [];
    queue.forEach(async ({ file, resolve, reject }) => {
      try {
        const r = await claudeApi.uploadAttachment(spaceSlug, sid, file);
        resolve(r);
      } catch (e: any) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  };

  const reset = useCallback(() => {
    setMessages([]);
    setStatus('idle');
  }, []);

  return { messages, status, isConnected, sessionId, send, uploadAttachment, reset };
}
