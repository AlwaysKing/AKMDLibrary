import { useEffect, useState, useRef, useCallback } from 'react';
import { Copy, ChevronDown, Check } from 'lucide-react';
import { LANGUAGES } from './languages';

interface BlockInfo {
  selectEl: HTMLSelectElement;
  codeBlockEl: HTMLElement;
  lastLang: string;
}

export default function CodeBlockToolbar({
  editorContainer,
}: {
  editorContainer: HTMLDivElement | null;
}) {
  // Track code block DOM references (not in state — stable across renders)
  const blockMap = useRef<Map<string, BlockInfo>>(new Map());
  // State: list of block IDs that currently have toolbars
  const [blockIds, setBlockIds] = useState<string[]>([]);
  // State: positions for each toolbar (relative to editorContainer)
  const [positions, setPositions] = useState<Record<string, { top: number; right: number }>>({});
  // State: current languages (updated on scan to detect external changes like undo)
  const [langs, setLangs] = useState<Record<string, string>>({});
  // UI state
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ---- Hover coordination: code block ↔ toolbar ----
  // Delay before hiding toolbar so user can move from block to toolbar
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  // Track mouse position globally so we can check it in handleHide
  const mousePos = useRef({ x: 0, y: 0 });

  const handleShow = useCallback((blockId: string) => {
    clearTimeout(hideTimeoutRef.current);
    setHoveredId(blockId);
  }, []);

  const handleHide = useCallback((blockId: string) => {
    clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => {
      // Check if mouse is currently over the toolbar for this block
      const toolbarEl = document.querySelector(
        `.cb-toolbar[data-block-id="${blockId}"]`,
      );
      if (toolbarEl) {
        const rect = toolbarEl.getBoundingClientRect();
        const { x, y } = mousePos.current;
        if (
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom
        ) {
          // Mouse is over the toolbar — don't hide
          return;
        }
      }
      setHoveredId((prev) => (prev === blockId ? null : prev));
    }, 150);
  }, []);

  // ---- Scan: find code blocks, read languages ----
  const scan = useCallback(() => {
    if (!editorContainer) return;

    const codeBlockEls = editorContainer.querySelectorAll(
      '[data-content-type="codeBlock"]',
    );
    const newIds: string[] = [];
    const newLangs: Record<string, string> = {};
    const currentIds = new Set<string>();

    codeBlockEls.forEach((el) => {
      const id = el.closest('[data-id]')?.getAttribute('data-id');
      const select = el.querySelector('select');
      if (!id || !select) return;

      currentIds.add(id);
      newIds.push(id);
      const lang = (select as HTMLSelectElement).value;
      newLangs[id] = lang;

      const existing = blockMap.current.get(id);
      if (existing && existing.selectEl === select) {
        // Update language tracking
        existing.lastLang = lang;
      } else {
        // New or changed element — attach hover listeners
        const blockOuter = el.closest('.bn-block-outer') as HTMLElement;
        if (blockOuter) {
          blockOuter.addEventListener('mouseenter', () => handleShow(id));
          blockOuter.addEventListener('mouseleave', () => handleHide(id));
        }
        blockMap.current.set(id, {
          selectEl: select as HTMLSelectElement,
          codeBlockEl: el as HTMLElement,
          lastLang: lang,
        });
      }
    });

    // Clean up removed blocks
    for (const id of blockMap.current.keys()) {
      if (!currentIds.has(id)) {
        blockMap.current.delete(id);
      }
    }

    setBlockIds((prev) => {
      if (prev.length === newIds.length && prev.every((id, i) => id === newIds[i]))
        return prev;
      return newIds;
    });
    setLangs((prev) => {
      let changed = false;
      for (const id of newIds) {
        if (prev[id] !== newLangs[id]) { changed = true; break; }
      }
      if (!changed) return prev;
      return newLangs;
    });
  }, [editorContainer]);

  // ---- Update positions (called frequently on scroll/resize) ----
  const updatePositions = useCallback(() => {
    if (!editorContainer) return;
    const containerRect = editorContainer.getBoundingClientRect();
    const newPositions: Record<string, { top: number; right: number }> = {};

    for (const [id, info] of blockMap.current) {
      const blockRect = info.codeBlockEl.getBoundingClientRect();
      newPositions[id] = {
        top: blockRect.top - containerRect.top,
        right: containerRect.right - blockRect.right,
      };
    }

    setPositions((prev) => {
      let changed = false;
      for (const id in newPositions) {
        if (
          !prev[id] ||
          Math.abs(prev[id].top - newPositions[id].top) > 0.5 ||
          Math.abs(prev[id].right - newPositions[id].right) > 0.5
        ) {
          changed = true;
          break;
        }
      }
      if (!changed && Object.keys(prev).length === Object.keys(newPositions).length)
        return prev;
      return newPositions;
    });
  }, [editorContainer]);

  // Combined refresh: scan + update positions
  const refresh = useCallback(() => {
    scan();
    updatePositions();
  }, [scan, updatePositions]);

  // ---- Track mouse position globally ----
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // ---- Initial scan + observers ----
  useEffect(() => {
    if (!editorContainer) return;
    refresh();

    // MutationObserver — detects code blocks added/removed
    let rafId = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(refresh);
    });
    observer.observe(editorContainer, { childList: true, subtree: true });

    // Scroll listener — update positions when scrolling
    const scrollParent = editorContainer.closest('.overflow-y-auto');
    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updatePositions);
    };
    scrollParent?.addEventListener('scroll', onScroll, { passive: true });

    // Resize observer — update positions when editor resizes
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updatePositions);
    });
    resizeObserver.observe(editorContainer);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
      scrollParent?.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
    };
  }, [editorContainer, refresh, updatePositions]);

  // ---- Click outside to close dropdown ----
  useEffect(() => {
    if (!openId) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.cb-dropdown, .cb-lang-btn')) {
        setOpenId(null);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openId]);

  // ---- Escape to close dropdown ----
  useEffect(() => {
    if (!openId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpenId(null);
        setSearch('');
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [openId]);

  // ---- Actions ----
  const selectLanguage = (blockId: string, langId: string) => {
    const info = blockMap.current.get(blockId);
    if (!info) return;
    info.selectEl.value = langId;
    info.selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    info.lastLang = langId;
    setOpenId(null);
    setSearch('');
    // Update language state immediately
    setLangs((prev) => ({ ...prev, [blockId]: langId }));
  };

  const copyCode = async (blockId: string) => {
    const info = blockMap.current.get(blockId);
    if (!info) return;
    const code = info.codeBlockEl.querySelector('code')?.textContent || '';
    await navigator.clipboard.writeText(code);
    setCopiedId(blockId);
    setTimeout(
      () => setCopiedId((prev) => (prev === blockId ? null : prev)),
      2000,
    );
  };

  // ---- Render ----
  const filtered = search
    ? LANGUAGES.filter(
        ([id, name]) =>
          id.toLowerCase().includes(search.toLowerCase()) ||
          name.toLowerCase().includes(search.toLowerCase()),
      )
    : LANGUAGES;

  return (
    <>
      {blockIds.map((blockId) => {
        const pos = positions[blockId];
        if (!pos) return null;
        const currentLang = langs[blockId] || 'text';
        const langName =
          LANGUAGES.find(([id]) => id === currentLang)?.[1] || currentLang;

        const isVisible = hoveredId === blockId || openId === blockId;

        return (
          <div
            key={blockId}
            data-block-id={blockId}
            className={`cb-toolbar${isVisible ? ' cb-toolbar-visible' : ''}`}
            style={{
              position: 'absolute',
              top: pos.top + 4,
              right: pos.right + 8,
              zIndex: 10,
            }}
            onMouseEnter={() => handleShow(blockId)}
            onMouseLeave={() => handleHide(blockId)}
          >
            <button
              className="cb-lang-btn"
              onClick={(e) => {
                e.stopPropagation();
                setOpenId(openId === blockId ? null : blockId);
                setSearch('');
              }}
            >
              {langName}
              <ChevronDown size={12} />
            </button>
            <button
              className="cb-copy-btn"
              onClick={(e) => {
                e.stopPropagation();
                copyCode(blockId);
              }}
            >
              {copiedId === blockId ? <Check size={14} /> : <Copy size={14} />}
            </button>
            {openId === blockId && (
              <div
                className="cb-dropdown"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  className="cb-search"
                  placeholder="搜索语言..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
                <div className="cb-lang-list">
                  {filtered.map(([id, name]) => (
                    <button
                      key={id}
                      className={`cb-lang-item${id === currentLang ? ' selected' : ''}`}
                      onClick={() => selectLanguage(blockId, id)}
                    >
                      <span>{name}</span>
                      {id === currentLang && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
