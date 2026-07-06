import { useEffect, useMemo, useRef, useState } from 'react';
import { createReactBlockSpec, BlockNoteViewRaw, useCreateBlockNote } from '@blocknote/react';
import { AlertTriangle, ExternalLink, RefreshCw, Repeat2 } from 'lucide-react';
import { syncedBlocksApi, type SyncedBlockQuote } from '../../api/syncedBlocks';
import { useSpaceStore } from '../../stores/spaceStore';
import { markdownToBlocks, blocksToMarkdown } from '../../utils/markdown';

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

  const innerEditor = useCreateBlockNote({
    schema: outerEditor.schema,
    initialContent: [{ type: 'paragraph', content: [{ type: 'text', text: '', styles: {} }] }],
    trailingBlock: false,
  } as any);

  const load = () => {
    if (!slug || !sourcePageId || !sourceBlockId) {
      setState('broken');
      return;
    }
    setState('loading');
    syncedBlocksApi.get(slug, sourcePageId, sourceBlockId)
      .then((data) => {
        const blocks = markdownToBlocks(data.markdown);
        suppressChangeRef.current = true;
        innerEditor.replaceBlocks(innerEditor.document, blocks as any);
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
        if (err?.response?.status === 404) setState('broken');
        else setState('error');
      });
  };

  useEffect(() => {
    loadedRef.current = false;
    load();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, sourcePageId, sourceBlockId]);

  const handleChange = () => {
    if (!loadedRef.current || suppressChangeRef.current || state === 'loading') return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setState('saving');
    saveTimerRef.current = setTimeout(() => {
      const markdown = blocksToMarkdown(innerEditor.document);
      syncedBlocksApi.update(slug, sourcePageId, sourceBlockId, {
        markdown,
        addQuoted: [{ pageId: currentPageId, syncId }].filter((q) => q.pageId && q.syncId),
      })
        .then(() => setState('saved'))
        .catch(() => setState('error'));
    }, 1200);
  };

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
        <div className="bn-synced-block-inner">
          <BlockNoteViewRaw editor={innerEditor as any} editable={true} onChange={handleChange} theme="light" />
        </div>
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
    },
    content: 'none',
  },
  { render: SyncedBlockMirrorComponent, meta: { isolating: true } },
);
