import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AgentIOEvent, ChatMessage, ChatStatus } from '../../hooks/useClaudeChat';

interface Props {
  messages: ChatMessage[];
  agentEvents: AgentIOEvent[];
  activeTurnId: string | null;
  status: ChatStatus;
}

type AgentEventSummary = {
  title: string;
  detail?: string;
  tone: 'normal' | 'success' | 'warning' | 'error';
};

function readPath(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  const value = input.file_path || input.path || input.command;
  return typeof value === 'string' ? value : undefined;
}

function compact(value: unknown, max = 180): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function summarizeContentBlocks(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap(block => {
    if (!block || typeof block !== 'object') return [];
    const item = block as Record<string, unknown>;
    if (item.type === 'text') {
      return compact(item.text);
    }
    if (item.type === 'tool_use') {
      const input = item.input && typeof item.input === 'object' ? item.input as Record<string, unknown> : undefined;
      const path = readPath(input);
      return `${item.name || '未知工具'}${path ? `: ${path}` : ''}`;
    }
    if (item.type === 'tool_result') {
      return compact(item.content) || `tool_use_id: ${item.tool_use_id || '未知'}`;
    }
    return String(item.type || '未知内容');
  }).filter(Boolean);
  return compact(parts.join(' | '), 240);
}

function summarizeEvent(event: AgentIOEvent): AgentEventSummary {
  if (event.direction === 'stderr') {
    return { title: 'Agent 标准错误输出', detail: event.content.trim(), tone: 'error' };
  }
  if (event.direction === 'system') {
    return { title: 'Session 状态', detail: event.content, tone: event.content.includes('error') ? 'error' : 'normal' };
  }

  try {
    const payload = JSON.parse(event.content);
    if (payload.type === 'control_request') {
      const tool = payload.request?.tool_name || '未知工具';
      const path = readPath(payload.request?.input);
      const inputPreview = compact(JSON.stringify(payload.request?.input || {}), 220);
      return { title: `权限请求：${tool}`, detail: path || inputPreview, tone: 'warning' };
    }
    if (payload.type === 'control_response') {
      const response = payload.response?.response;
      const allowed = response?.behavior === 'allow';
      const updatedInput = compact(JSON.stringify(response?.updatedInput || {}), 220);
      return {
        title: allowed ? '自动允许工具请求' : '自动拒绝工具请求',
        detail: allowed ? updatedInput : response?.message,
        tone: allowed ? 'success' : 'warning',
      };
    }
    if (payload.type === 'assistant') {
      const content = Array.isArray(payload.message?.content) ? payload.message.content : [];
      const tool = content.find((block: { type?: string }) => block.type === 'tool_use');
      if (tool) {
        return { title: `Agent 请求执行：${tool.name || '未知工具'}`, detail: readPath(tool.input), tone: 'normal' };
      }
      return { title: 'Agent 返回消息', detail: summarizeContentBlocks(content), tone: 'normal' };
    }
    if (payload.type === 'user') {
      const content = Array.isArray(payload.message?.content) ? payload.message.content : [];
      const result = content.find((block: { type?: string }) => block.type === 'tool_result');
      if (result) {
        return {
          title: result.is_error ? '工具执行失败' : '工具执行完成',
          detail: summarizeContentBlocks(content) || (result.is_error ? 'Agent 收到失败结果' : undefined),
          tone: result.is_error ? 'error' : 'success',
        };
      }
      return { title: '后端发送用户消息', detail: summarizeContentBlocks(content), tone: 'normal' };
    }
    if (payload.type === 'result') {
      const metrics = [
        payload.duration_ms ? `${Math.round(payload.duration_ms / 1000)}s` : undefined,
        payload.total_cost_usd ? `$${Number(payload.total_cost_usd).toFixed(4)}` : undefined,
        payload.num_turns ? `${payload.num_turns} turns` : undefined,
      ].filter(Boolean).join(' · ');
      return {
        title: 'Agent 本轮结束',
        detail: [payload.subtype ? `结果：${payload.subtype}` : undefined, metrics || undefined].filter(Boolean).join(' · '),
        tone: payload.is_error ? 'error' : 'success',
      };
    }
    if (payload.type === 'system') {
      const detail = [
        payload.subtype,
        payload.session_id ? `session: ${payload.session_id}` : undefined,
        summarizeContentBlocks(payload.message?.content),
      ].filter(Boolean).join(' · ');
      return { title: 'Agent 系统事件', detail, tone: 'normal' };
    }
    return {
      title: `${event.direction === 'stdin' ? '后端发送' : 'Agent 输出'}：${payload.type || '未知事件'}`,
      detail: compact(JSON.stringify(payload), 240),
      tone: 'normal',
    };
  } catch {
    return {
      title: event.direction === 'stdin' ? '后端发送原始内容' : 'Agent 原始输出',
      detail: event.content.trim(),
      tone: 'normal',
    };
  }
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf()) ? '时间未知' : date.toLocaleTimeString();
}

function TurnEvents({ events }: { events: AgentIOEvent[] }) {
  return (
    <div className="mx-1 mb-2 border-l-2 border-notion-border pl-3 space-y-2">
      {events.map(event => {
        const summary = summarizeEvent(event);
        const toneClass = {
          normal: 'text-notion-text',
          success: 'text-emerald-700',
          warning: 'text-amber-700',
          error: 'text-red-700',
        }[summary.tone];
        return (
          <details key={event.id} className="group">
            <summary className="cursor-pointer list-none text-xs leading-5">
              <span className="mr-1 text-notion-textSecondary">{formatTime(event.timestamp)}</span>
              <span className={toneClass}>{summary.title}</span>
              {summary.detail && <span className="ml-1 text-notion-textSecondary">{summary.detail}</span>}
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-notion-border bg-notion-hover p-2 text-xs text-notion-text">
              {event.content}
            </pre>
          </details>
        );
      })}
    </div>
  );
}

export function MessageList({ messages, agentEvents, activeTurnId, status }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(new Set());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, agentEvents.length, activeTurnId, status, expandedTurns]);

  if (messages.length === 0 && agentEvents.length === 0 && status !== 'answering') {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-notion-textSecondary">
        向 Agent 提问关于这个空间的问题
      </div>
    );
  }

  const eventsByTurn = agentEvents.reduce<Map<string, AgentIOEvent[]>>((grouped, event) => {
    if (!event.turnId) return grouped;
    const events = grouped.get(event.turnId) || [];
    events.push(event);
    grouped.set(event.turnId, events);
    return grouped;
  }, new Map());

  const toggleTurn = (turnId: string) => {
    setExpandedTurns(prev => {
      const next = new Set(prev);
      if (next.has(turnId)) {
        next.delete(turnId);
      } else {
        next.add(turnId);
      }
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
      {messages.map(message => {
        const turnEvents = message.role === 'user' ? eventsByTurn.get(message.id) || [] : [];
        const isActiveTurn = message.id === activeTurnId && status === 'answering';
        const expanded = expandedTurns.has(message.id);

        return (
          <div key={message.id}>
            {message.role === 'user' && (
              <>
                <div className="flex justify-end">
                  <div className="max-w-[85%] px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm whitespace-pre-wrap">
                    {message.content}
                    {message.attachments && message.attachments.length > 0 && (
                      <div className="mt-1 pt-1 border-t border-white/30 flex flex-wrap gap-1">
                        {message.attachments.map((attachment, index) => (
                          <span key={index} className="text-xs px-1 py-0.5 bg-white/20 rounded">
                            📎 {attachment.filename}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {(isActiveTurn || turnEvents.length > 0) && (
                  <div className="mt-2 flex">
                    <button
                      type="button"
                      onClick={() => toggleTurn(message.id)}
                      className="inline-flex items-center gap-1 px-1 text-xs text-notion-textSecondary hover:text-notion-text"
                    >
                      {expanded ? '收起执行详情' : `查看执行详情 (${turnEvents.length})`}
                      <ChevronDown className={`w-3 h-3 transition-transform${expanded ? ' rotate-180' : ''}`} />
                    </button>
                  </div>
                )}

                {expanded && turnEvents.length > 0 && <TurnEvents events={turnEvents} />}

                {isActiveTurn && (
                  <div className="mt-2 flex">
                    <div className="px-3 py-2.5 bg-white border border-notion-border rounded-lg inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-notion-textSecondary/60 animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-notion-textSecondary/60 animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-notion-textSecondary/60 animate-bounce" />
                    </div>
                  </div>
                )}
              </>
            )}

            {message.role === 'assistant' && (
              <div className="flex">
                <div className="max-w-[90%] px-3 py-1.5 bg-white border border-notion-border rounded-lg text-sm text-notion-text whitespace-pre-wrap">
                  {message.content}
                </div>
              </div>
            )}

            {message.role === 'system' && (
              <div className={`text-xs px-2 py-1 border rounded ${
                message.variant === 'error'
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}>
                {message.content}
              </div>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
