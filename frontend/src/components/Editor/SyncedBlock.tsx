import { useEffect, useMemo, useRef, useState } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import { AlertTriangle, ExternalLink, RefreshCw, Repeat2 } from 'lucide-react';
import { syncedBlocksApi, type SyncedBlockQuote } from '../../api/syncedBlocks';
import { useSpaceStore } from '../../stores/spaceStore';
import { markdownToBlocks, blocksToMarkdown } from '../../utils/markdown';

const pendingSyncedBlockSaves = new Map<string, () => Promise<void>>();

export async function flushPendingSyncedBlockSaves() {
  const saves = Array.from(pendingSyncedBlockSaves.values());
  if (saves.length === 0) return;
  await Promise.all(saves.map((save) => save()));
}

function shortId(id: string | undefined) {
  return id ? id.slice(0, 8) : '未设置';
}

function currentPageIdFromPath() {
  const match = window.location.pathname.match(/\/p\/([^/]+)/);
  return match?.[1] || '';
}

function SyncedBlockSourceComponent({ block }: any) {
  const quoted: SyncedBlockQuote[] = useMemo(() => {
    const raw = block.props?.quoted || '';
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [block.props?.quoted]);

  return (
    <div className="bn-synced-block bn-synced-block-source" contentEditable={false}>
      <div className="bn-synced-block-header">
        <div className="bn-synced-block-title">
          <Repeat2 size={14} />
          <span>同步块</span>
          <span className="bn-synced-block-muted">源 · {shortId(block.props?.syncId)}</span>
        </div>
        <span className="bn-synced-block-status">被 {quoted.length} 处引用</span>
      </div>
    </div>
  );
}

function SyncedBlockMirrorComponent({ block, editor: outerEditor }: any) {
  const { currentSpace } = useSpaceStore();
  const slug = currentSpace?.slug || '';
  const sourcePageId = block.props?.sourcePageId || '';
  const sourceBlockId = block.props?.sourceBlockId || '';
  const syncId = block.props?.syncId || '';
  const currentPageId = block.props?.pageId || currentPageIdFromPath();
  const [sourceTitle, setSourceTitle] = useState('');
  const [state, setState] = useState<'loading' | 'live' | 'saving' | 'saved' | 'broken' | 'error'>('loading');
  const loadedRef = useRef(false);
  const suppressChangeRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const blockChildrenKey = useMemo(() => JSON.stringify(block.children || []), [block.children]);
  const registryKey = `${sourcePageId}:${sourceBlockId}:${syncId}`;

  const load = () => {
    if (!slug || !sourcePageId || !sourceBlockId) {
      suppressChangeRef.current = true;
      try {
        outerEditor.updateBlock(block.id, {
          props: { ...block.props, syncLoaded: 'false', syncBroken: 'true' },
        } as any);
      } catch {
        // If the block disappeared while loading, there is nothing to mark.
      }
      requestAnimationFrame(() => {
        suppressChangeRef.current = false;
        loadedRef.current = false;
      });
      setState('broken');
      return;
    }
    setState('loading');
    syncedBlocksApi.get(slug, sourcePageId, sourceBlockId)
      .then((data) => {
        const blocks = markdownToBlocks(data.markdown);
        suppressChangeRef.current = true;
        outerEditor.updateBlock(block.id, {
          props: { ...block.props, syncLoaded: 'true', syncBroken: 'false' },
          children: blocks,
        } as any);
        requestAnimationFrame(() => {
          suppressChangeRef.current = false;
          loadedRef.current = true;
        });
        setSourceTitle(data.sourceTitle || '');
        setState('live');
        syncedBlocksApi.update(slug, sourcePageId, sourceBlockId, {
          markdown: data.markdown,
          addQuoted: [{ pageId: currentPageId, syncId }].filter((q) => q.pageId && q.syncId),
        }).catch(() => {});
      })
      .catch((err) => {
        if (err?.response?.status === 404) {
          suppressChangeRef.current = true;
          try {
            outerEditor.updateBlock(block.id, {
              props: { ...block.props, syncLoaded: 'false', syncBroken: 'true' },
            } as any);
          } catch {
            // If the block disappeared while loading, there is nothing to mark.
          }
          requestAnimationFrame(() => {
            suppressChangeRef.current = false;
            loadedRef.current = false;
          });
          setState('broken');
        } else {
          setState('error');
        }
      });
  };

  useEffect(() => {
    loadedRef.current = false;
    load();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      pendingSyncedBlockSaves.delete(registryKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, sourcePageId, sourceBlockId, block.id, registryKey]);

  useEffect(() => {
    if (!loadedRef.current || suppressChangeRef.current || state === 'loading') return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setState('saving');
    const save = async () => {
      if (saveInFlightRef.current) return saveInFlightRef.current;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      saveInFlightRef.current = (async () => {
        const liveBlock = outerEditor.getBlock(block.id);
        const children = liveBlock?.children || [];
        if (liveBlock?.props?.syncLoaded !== 'true' || liveBlock?.props?.syncBroken === 'true') {
          pendingSyncedBlockSaves.delete(registryKey);
          return;
        }
        const markdown = blocksToMarkdown(children as any[]);
        await syncedBlocksApi.update(slug, sourcePageId, sourceBlockId, {
          markdown,
          addQuoted: [{ pageId: currentPageId, syncId }].filter((q) => q.pageId && q.syncId),
        });
        pendingSyncedBlockSaves.delete(registryKey);
        setState('saved');
      })();
      try {
        await saveInFlightRef.current;
      } finally {
        saveInFlightRef.current = null;
      }
    };
    pendingSyncedBlockSaves.set(registryKey, save);
    saveTimerRef.current = setTimeout(() => {
      save().catch(() => setState('error'));
    }, 1200);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockChildrenKey]);

  const statusText = {
    loading: '加载中',
    live: '已连接',
    saving: '同步中',
    saved: '已同步',
    broken: '源已消失',
    error: '同步失败',
  }[state];

  return (
    <div className={`bn-synced-block bn-synced-block-mirror is-${state}`}>
      <div className="bn-synced-block-header" contentEditable={false}>
        <div className="bn-synced-block-title">
          <Repeat2 size={14} />
          <span>同步块</span>
          <span className="bn-synced-block-muted">引用 · {shortId(syncId)}</span>
        </div>
        <div className="bn-synced-block-actions">
          {sourceTitle && <span className="bn-synced-block-source-title">{sourceTitle}</span>}
          <span className="bn-synced-block-status">{statusText}</span>
          {(state === 'error' || state === 'broken') && (
            <button type="button" className="bn-synced-block-icon-btn" onClick={load} aria-label="重试">
              <RefreshCw size={13} />
            </button>
          )}
          {sourcePageId && (
            <button
              type="button"
              className="bn-synced-block-icon-btn"
              onClick={() => { if (slug) window.location.href = `/s/${slug}/p/${sourcePageId}`; }}
              aria-label="跳转到源页面"
            >
              <ExternalLink size={13} />
            </button>
          )}
        </div>
      </div>
      {state === 'broken' ? (
        <div className="bn-synced-block-placeholder" contentEditable={false}>
          <AlertTriangle size={15} />
          <span>同步块源内容不存在</span>
        </div>
      ) : (
        null
      )}
    </div>
  );
}

export const SyncedBlockSourceSpec = createReactBlockSpec(
  {
    type: 'syncedBlockSource',
    propSchema: {
      syncId: { default: '' },
      quoted: { default: '[]' },
    },
    content: 'none',
  },
  { render: SyncedBlockSourceComponent, meta: { isolating: true } },
);

export const SyncedBlockMirrorSpec = createReactBlockSpec(
  {
    type: 'syncedBlockMirror',
    propSchema: {
      syncId: { default: '' },
      sourcePageId: { default: '' },
      sourceBlockId: { default: '' },
      pageId: { default: '' },
      syncLoaded: { default: 'false' },
      syncBroken: { default: 'false' },
    },
    content: 'none',
  },
  { render: SyncedBlockMirrorComponent, meta: { isolating: true } },
);
