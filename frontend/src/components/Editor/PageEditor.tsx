import { useEffect, useState, useCallback, useRef } from 'react';
import { BlockNoteViewRaw, useCreateBlockNote, ComponentsContext, SuggestionMenuController } from '@blocknote/react';
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems } from '@blocknote/core';
import { getDefaultReactSlashMenuItems } from '@blocknote/react';
import { zh } from '@blocknote/core/locales';
import '@blocknote/react/style.css';
import { markdownToBlocks, blocksToMarkdown } from '../../utils/markdown';
import { blockNoteComponents, setBlockSelection, getSelectedBlockIds, isDragMenuOpen } from './BlockNoteComponents';
import { removeBlocksEnhanced } from './blockHelpers';
import { PageReferenceBlockSpec } from './PageReferenceBlock';
import { TextSelection } from '@tiptap/pm/state';
import { setClipboardData, getClipboardData } from './blockClipboardState';
import { BookmarkBlockSpec } from './BookmarkBlock';
import { SubpageBlockSpec } from './SubpageBlock';
import LinkPasteMenu from './LinkPasteMenu';
import { getBlockDragData, markDragHandled } from './blockDragState';
import { pagesApi } from '../../api/pages';
import { createMirror } from '../../services/mirrorStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { flushSync } from '../../services/syncModule';

// Custom schema: default blocks + pageReference + bookmark
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    pageReference: PageReferenceBlockSpec(),
    bookmark: BookmarkBlockSpec(),
    subpage: SubpageBlockSpec(),
  },
});

// Internal URL detection — match only URLs from this app's origin
const APP_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';
const INTERNAL_URL_RE = new RegExp(`^${APP_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/s/([^/]+)/p/([a-f0-9]{32})(?:$|/)`);
const URL_RE = /^https?:\/\/.+/;

// Override zh dictionary: reorganize groups + rename toggle headings
const customZh = {
  ...zh,
  slash_menu: {
    ...zh.slash_menu,
    heading: { ...zh.slash_menu.heading, group: '基础区块' },
    heading_2: { ...zh.slash_menu.heading_2, group: '基础区块' },
    heading_3: { ...zh.slash_menu.heading_3, group: '基础区块' },
    heading_4: { ...zh.slash_menu.heading_4, group: '基础区块' },
    toggle_heading: { ...zh.slash_menu.toggle_heading, group: '基础区块', title: '一级折叠标题' },
    toggle_heading_2: { ...zh.slash_menu.toggle_heading_2, group: '基础区块', title: '二级折叠标题' },
    toggle_heading_3: { ...zh.slash_menu.toggle_heading_3, group: '基础区块', title: '三级折叠标题' },
    quote: { ...zh.slash_menu.quote, group: '高级区块' },
    code_block: { ...zh.slash_menu.code_block, group: '高级区块' },
    divider: { ...zh.slash_menu.divider, group: '高级区块' },
    table: { ...zh.slash_menu.table, group: '高级区块' },
    toggle_list: { ...zh.slash_menu.toggle_list, group: '列表' },
    numbered_list: { ...zh.slash_menu.numbered_list, group: '列表' },
    bullet_list: { ...zh.slash_menu.bullet_list, group: '列表' },
    check_list: { ...zh.slash_menu.check_list, group: '列表' },
    paragraph: { ...zh.slash_menu.paragraph, group: '列表' },
  },
};

// Custom slash menu: default items filtered + subpage + toggle heading 4
// Desired order for 基础区块: heading → heading_2 → heading_3 → heading_4 → toggle_heading → toggle_heading_2 → toggle_heading_3 → toggle_heading_4(custom)
const BASE_BLOCK_ORDER: Record<string, number> = {
  heading: 0,
  heading_2: 1,
  heading_3: 2,
  heading_4: 3,
  toggle_heading: 4,
  toggle_heading_2: 5,
  toggle_heading_3: 6,
  toggle_heading_4: 7,
};

function getCustomSlashMenuItems(editor: any) {
  const defaults = getDefaultReactSlashMenuItems(editor);
  // Remove heading_5, heading_6 from defaults
  const filtered = defaults.filter((item: any) =>
    item.key !== 'heading_5' && item.key !== 'heading_6'
  );
  // Sort 基础区块 items to: headings first, then toggle headings
  filtered.sort((a: any, b: any) => {
    const aOrder = BASE_BLOCK_ORDER[a.key];
    const bOrder = BASE_BLOCK_ORDER[b.key];
    if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
    return 0;
  });
  return [
    ...filtered,
    {
      title: '四级折叠标题',
      subtext: '可折叠的四级标题',
      aliases: ['toggle_heading_4', 'toggle4'],
      group: '基础区块',
      icon: <svg viewBox="0 0 24 24" style={{ width: '18px', height: '18px', fill: 'currentColor' }}><path d="M12.8 5.6H4v2h7.2l-1.6 1.6L11 10.8l3.8-3.8-3.8-3.8-1.4 1.4 1.2 1zM4 14h8.8l-1.6 1.6L12.6 17l3.8-3.8-3.8-3.8-1.4 1.4 1.2 1H4v2z"/></svg>,
      onItemClick: () => {
        const currentBlock = editor.getTextCursorPosition().block;
        if (currentBlock.content === undefined) return;
        const blockContent = currentBlock.content;
        const isSlashOnly = Array.isArray(blockContent) && blockContent.length === 1 &&
          blockContent[0].type === 'text' && blockContent[0].text === '/';
        const isEmpty = Array.isArray(blockContent) && blockContent.length === 0;
        if (isSlashOnly || isEmpty) {
          editor.updateBlock(currentBlock, { type: 'heading', props: { level: 4, isToggleable: true } });
        } else {
          editor.insertBlocks([{ type: 'heading', props: { level: 4, isToggleable: true } }], currentBlock, 'after');
        }
        const nextBlock = editor.getTextCursorPosition().nextBlock;
        if (nextBlock) editor.setTextCursorPosition(nextBlock, 'end');
      },
    },
    {
      title: '子页面',
      subtext: '创建并链接到子页面',
      aliases: ['subpage', 'page', '子页面', '页面'],
      group: '高级区块',
      icon: <svg viewBox="4.12 2.37 11.75 15.25" style={{ width: '18px', height: '18px', fill: 'currentColor', overflow: 'visible' }}><path d="M13.3 14.25a.55.55 0 0 1-.55.55h-5.5a.55.55 0 1 1 0-1.1h5.5a.55.55 0 0 1 .55.55m-.55-1.95a.55.55 0 1 0 0-1.1h-5.5a.55.55 0 0 0 0 1.1z" /><path d="M6.25 2.375A2.125 2.125 0 0 0 4.125 4.5v11c0 1.174.951 2.125 2.125 2.125h7.5a2.125 2.125 0 0 0 2.125-2.125V8.121c0-.563-.224-1.104-.622-1.502L11.63 2.997a2.13 2.13 0 0 0-1.502-.622zM5.375 4.5c0-.483.392-.875.875-.875h3.7V6.25A2.05 2.05 0 0 0 12 8.3h2.625v7.2a.875.875 0 0 1-.875.875h-7.5a.875.875 0 0 1-.875-.875zm8.691 2.7H12a.95.95 0 0 1-.95-.95V4.184z" /></svg>,
      onItemClick: () => {
        const currentBlock = editor.getTextCursorPosition().block;
        if (currentBlock.content === undefined) return;
        const blockContent = currentBlock.content;
        const isSlashOnly = Array.isArray(blockContent) && blockContent.length === 1 &&
          blockContent[0].type === 'text' && blockContent[0].text === '/';
        const isEmpty = Array.isArray(blockContent) && blockContent.length === 0;
        if (isSlashOnly || isEmpty) {
          editor.updateBlock(currentBlock, { type: 'subpage', props: { pageId: '' } });
        } else {
          editor.insertBlocks([{ type: 'subpage', props: { pageId: '' } }], currentBlock, 'after');
        }
        // Move cursor to next editable block
        const nextBlock = editor.getTextCursorPosition().nextBlock;
        if (nextBlock) editor.setTextCursorPosition(nextBlock, 'end');
      },
    },
  ];
}

interface PageEditorProps {
  initialContent: string;
  pageIdentity: { spaceSlug: string; pageId: string };
  onSyncStatusChange?: (status: 'unsaved' | 'syncing' | 'synced') => void;
  readOnly?: boolean;
}

export function PageEditor({ initialContent, pageIdentity, onSyncStatusChange, readOnly = false }: PageEditorProps) {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const editorRef = useRef<HTMLDivElement>(null);

  // Refs for values read inside callbacks — avoid stale closures
  const hasChangesRef = useRef(false);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const identityRef = useRef(pageIdentity);
  identityRef.current = pageIdentity;
  const onSyncStatusChangeRef = useRef(onSyncStatusChange);
  onSyncStatusChangeRef.current = onSyncStatusChange;

  // Paste menu state
  const [pasteMenu, setPasteMenu] = useState<{
    url: string;
    position: { x: number; y: number };
  } | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useCreateBlockNote({
    schema,
    initialContent: markdownToBlocks(initialContent) as any,
    dictionary: customZh as any,
    trailingBlock: false,
  } as any);

  // Sync subpage blocks with sidebar create/delete/reorder events
  useEffect(() => {
    if (readOnly) return;

    const handleSubpageCreated = (e: Event) => {
      const { pageId } = (e as CustomEvent).detail;
      // Guard: skip if block already exists (prevent duplicate from event or backend)
      const exists = editor.document.some((b: any) => b.type === 'subpage' && b.props?.pageId === pageId);
      if (exists) return;
      // Insert subpage block at the end of the document
      const blocks = editor.document;
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock) {
        editor.insertBlocks([{ type: 'subpage', props: { pageId } } as any], lastBlock, 'after');
      }
    };

    const handleSubpageDeleted = (e: Event) => {
      const { pageId } = (e as CustomEvent).detail;
      // Find and remove ALL subpage blocks with matching pageId (in case of duplicates)
      const targets = editor.document.filter((b: any) => b.type === 'subpage' && b.props?.pageId === pageId);
      if (targets.length > 0) {
        editor.removeBlocks(targets);
      }
    };

    const handleSubpageReordered = (e: Event) => {
      const { parentId, movedPageId, afterId } = (e as CustomEvent).detail;

      // Find the moved page's subpage block in the editor
      const movedBlock = editor.document.find(
        (b: any) => b.type === 'subpage' && b.props?.pageId === movedPageId,
      );
      if (!movedBlock) return;

      // Save block data for re-insertion (deep clone to avoid stale refs)
      const blockData = JSON.parse(JSON.stringify(movedBlock));

      // Find the reference block BEFORE removing the moved block
      let referenceBlockId: string | null = null;
      if (afterId) {
        const refBlock = editor.document.find(
          (b: any) => b.type === 'subpage' && b.props?.pageId === afterId,
        );
        if (refBlock) referenceBlockId = refBlock.id;
      }

      // Remove the moved block from its old position
      editor.removeBlocks([movedBlock]);

      // Insert at the correct new position
      if (!afterId) {
        // afterId=null means insert at the beginning: before the first subpage block
        const firstSubpage = editor.document.find(
          (b: any) => b.type === 'subpage' && b.props?.pageId,
        );
        if (firstSubpage) {
          editor.insertBlocks([blockData], firstSubpage, 'before');
        } else {
          // No other subpage blocks exist, insert at end of document
          const doc = editor.document;
          const lastBlock = doc[doc.length - 1];
          if (lastBlock) {
            editor.insertBlocks([blockData], lastBlock, 'after');
          }
        }
      } else {
        // Insert after the reference block
        const refBlock = editor.document.find((b: any) => b.id === referenceBlockId);
        if (refBlock) {
          editor.insertBlocks([blockData], refBlock, 'after');
        }
      }
    };

    document.addEventListener('subpage-created', handleSubpageCreated);
    document.addEventListener('subpage-deleted', handleSubpageDeleted);
    document.addEventListener('subpage-reordered', handleSubpageReordered);
    return () => {
      document.removeEventListener('subpage-created', handleSubpageCreated);
      document.removeEventListener('subpage-deleted', handleSubpageDeleted);
      document.removeEventListener('subpage-reordered', handleSubpageReordered);
    };
  }, [editor, readOnly]);

  // Subpage block drop target: allow dropping blocks onto subpage blocks to move content
  useEffect(() => {
    const container = editorRef.current;
    if (!container || readOnly) return;

    let lastHighlight: HTMLElement | null = null;

    const clearHighlight = () => {
      if (lastHighlight) {
        lastHighlight.classList.remove('subpage-drop-target');
        lastHighlight = null;
      }
      // Restore ProseMirror dropcursor if it was hidden
      container.querySelectorAll('.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline')
        .forEach(el => { (el as HTMLElement).style.display = ''; });
    };

    const handleDragOver = (e: DragEvent) => {
      const dragData = getBlockDragData();
      if (!dragData || dragData.blocks.length === 0) return;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const subpageEl = (el as HTMLElement)?.closest('[data-content-type="subpage"]') as HTMLElement | null;

      if (subpageEl && subpageEl.dataset.pageId) {
        const targetPageId = subpageEl.dataset.pageId;
        // Block: don't allow dropping a subpage onto itself
        const isSelfDrop = dragData.blocks.some(
          b => b.type === 'subpage' && b.props.pageId === targetPageId
        );
        if (isSelfDrop) { clearHighlight(); return; }

        // Only intercept if cursor is in the CENTER zone of the subpage block (middle 50%)
        // Edge zones (top/bottom 25%) are for BlockNote's before/after reorder
        const rect = subpageEl.getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height; // 0..1
        const isInCenter = relY > 0.25 && relY < 0.75;

        if (isInCenter) {
          e.preventDefault();
          e.stopPropagation(); // Prevent DropCursor dragover handler from updating
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

          // Hide ProseMirror's dropcursor (blue line) — it may persist from edge zone
          container.querySelectorAll('.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline')
            .forEach(el => { (el as HTMLElement).style.display = 'none'; });

          if (lastHighlight !== subpageEl) {
            clearHighlight();
            subpageEl.classList.add('subpage-drop-target');
            lastHighlight = subpageEl;
          }
        } else {
          clearHighlight();
        }
      } else {
        clearHighlight();
      }
    };

    const handleDrop = async (e: DragEvent) => {
      clearHighlight();

      const dragData = getBlockDragData();
      if (!dragData || dragData.blocks.length === 0) return;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const subpageEl = (el as HTMLElement)?.closest('[data-content-type="subpage"]') as HTMLElement | null;
      if (!subpageEl) return; // Normal drop — let BlockNote handle

      const targetPageId = subpageEl.dataset.pageId;
      if (!targetPageId) return;

      // Only intercept if cursor is in the CENTER zone (same logic as dragover)
      const rect = subpageEl.getBoundingClientRect();
      const relY = (e.clientY - rect.top) / rect.height;
      const isInCenter = relY > 0.25 && relY < 0.75;
      if (!isInCenter) return; // Edge drop — let BlockNote handle reorder

      // Separate subpage blocks from content blocks
      const subpageBlocks = dragData.blocks.filter(b => b.type === 'subpage' && b.props.pageId && b.props.pageId !== targetPageId);
      const contentBlocks = dragData.blocks.filter(b => b.type !== 'subpage');

      if (subpageBlocks.length === 0 && contentBlocks.length === 0) return;

      e.preventDefault();
      e.stopPropagation();

      // Sync: mark handled before any async (so handleNativeDragEnd removes blocks from editor)
      markDragHandled();

      const { spaceSlug } = identityRef.current;

      try {
        // 1. Move subpage blocks → target becomes their parent
        for (const block of subpageBlocks) {
          const pageId = block.props.pageId as string;
          try {
            await pagesApi.move(spaceSlug, pageId, targetPageId, null);
          } catch (err) {
            console.error('[PageEditor] Failed to move subpage into target:', err);
          }
        }

        // 2. Append content blocks to target page
        if (contentBlocks.length > 0) {
          const markdown = blocksToMarkdown(contentBlocks as any);
          const targetPage = await pagesApi.get(spaceSlug, targetPageId);
          const existing = targetPage.content || '';
          const newContent = existing
            ? existing.trimEnd() + '\n\n' + markdown
            : markdown;
          await pagesApi.update(spaceSlug, targetPageId, newContent);
        }
      } catch (err) {
        console.error('[PageEditor] Failed to handle subpage drop:', err);
      }

      // Refresh sidebar to reflect new page hierarchy
      useSpaceStore.getState().refreshAll();
    };

    const handleDragLeave = (e: DragEvent) => {
      if (!container.contains(e.relatedTarget as Node)) {
        clearHighlight();
      }
    };

    container.addEventListener('dragover', handleDragOver, true);
    container.addEventListener('drop', handleDrop, true);
    container.addEventListener('dragleave', handleDragLeave);
    return () => {
      container.removeEventListener('dragover', handleDragOver, true);
      container.removeEventListener('drop', handleDrop, true);
      container.removeEventListener('dragleave', handleDragLeave);
      clearHighlight();
    };
  }, [editor, readOnly]);

  // Write mirror to IndexedDB — fast, local, no network
  const triggerMirror = useCallback(() => {
    if (!hasChangesRef.current || readOnlyRef.current) return;

    const currentBlocks = editor.document;
    const markdown = blocksToMarkdown(currentBlocks);
    const { spaceSlug, pageId } = identityRef.current;
    createMirror(spaceSlug, pageId, markdown);

    hasChangesRef.current = false;
    onSyncStatusChangeRef.current?.('syncing');
  }, [editor]);

  // Cmd+S / Ctrl+S: immediate mirror + flush sync
  useEffect(() => {
    if (readOnly) return;
    const handleSaveShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();

        const currentBlocks = editor.document;
        const markdown = blocksToMarkdown(currentBlocks);
        const { spaceSlug, pageId } = identityRef.current;
        createMirror(spaceSlug, pageId, markdown);

        hasChangesRef.current = false;
        onSyncStatusChangeRef.current?.('syncing');
        flushSync();
      }
    };
    document.addEventListener('keydown', handleSaveShortcut);
    return () => document.removeEventListener('keydown', handleSaveShortcut);
  }, [editor, readOnly]);

  // Slash menu: only trigger on empty blocks; "//" cancels
  useEffect(() => {
    const container = editorRef.current;
    if (!container || readOnly) return;

    const handleSlashKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return;

      // Check if current block is empty
      const currentBlock = editor.getTextCursorPosition().block;
      const content = currentBlock.content;
      const isEmpty = !content || (Array.isArray(content) && content.length === 0);

      if (!isEmpty) {
        // Block has content — let "/" be typed normally, but close the slash menu
        // before the next paint so the user never sees it
        requestAnimationFrame(() => {
          const pmEl = container.querySelector('.ProseMirror');
          if (pmEl) {
            pmEl.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true,
            }));
          }
        });
      }
    };

    container.addEventListener('keydown', handleSlashKey, true);
    return () => container.removeEventListener('keydown', handleSlashKey, true);
  }, [editor, readOnly]);

  const handleChange = useCallback(() => {
    hasChangesRef.current = true;
    onSyncStatusChangeRef.current?.('unsaved');

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      triggerMirror();
    }, 1000);
  }, [triggerMirror]);

  // Paste handler — capture phase to intercept before BlockNote/ProseMirror processes
  useEffect(() => {
    const container = editorRef.current;
    if (!container || readOnly) return;

    const handlePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain')?.trim();
      if (!text || !URL_RE.test(text)) return; // Not a URL, let default paste handle it

      e.preventDefault();
      e.stopPropagation();

      // Check if internal URL
      const internalMatch = text.match(INTERNAL_URL_RE);
      if (internalMatch) {
        const pageId = internalMatch[2];
        const currentBlock = editor.getTextCursorPosition().block;
        const isEmpty = !currentBlock.content || (Array.isArray(currentBlock.content) && currentBlock.content.length === 0);

        const newBlock: any = { type: 'pageReference', props: { pageId } };

        if (isEmpty) {
          editor.updateBlock(currentBlock, newBlock);
        } else {
          editor.insertBlocks([newBlock], currentBlock, 'after');
        }
        return;
      }

      // External URL: show menu
      const selection = window.getSelection();
      let x = 100, y = 100;
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        x = rect.left;
        y = rect.bottom + 4;
      }
      setPasteMenu({ url: text, position: { x, y } });
    };

    container.addEventListener('paste', handlePaste, true); // capture phase
    return () => container.removeEventListener('paste', handlePaste, true);
  }, [editor, readOnly]);

  const handleInsertLink = useCallback((url: string, title: string) => {
    setPasteMenu(null);
    // Insert inline link in current block
    const currentBlock = editor.getTextCursorPosition().block;
    const isEmpty = !currentBlock.content || (Array.isArray(currentBlock.content) && currentBlock.content.length === 0);

    if (isEmpty) {
      // Replace empty block with a paragraph containing the link
      editor.updateBlock(currentBlock, {
        type: 'paragraph',
        content: [{ type: 'text', text: title, styles: {}, link: url } as any],
      } as any);
    } else {
      // Insert inline link text at cursor
      editor.insertInlineContent([{ type: 'text', text: title, styles: {}, link: url } as any] as any);
    }
  }, [editor]);

  const handleInsertBookmark = useCallback((url: string) => {
    setPasteMenu(null);
    const currentBlock = editor.getTextCursorPosition().block;
    const isEmpty = !currentBlock.content || (Array.isArray(currentBlock.content) && currentBlock.content.length === 0);

    const newBlock: any = { type: 'bookmark', props: { url } };

    if (isEmpty) {
      editor.updateBlock(currentBlock, newBlock);
    } else {
      editor.insertBlocks([newBlock], currentBlock, 'after');
    }
  }, [editor]);

  // Block selection: Escape toggles, click deselects, drag selects multiple
  const dragOccurredRef = useRef(false);

  useEffect(() => {
    const container = editorRef.current;
    if (!container || readOnly) return;

    let selectedIds: string[] = [];
    let isDragging = false;
    let dragOccurred = false;
    let startX = 0;
    let startY = 0;
    let selectionRect: HTMLDivElement | null = null;

    function updateSelection(ids: string[]) {
      selectedIds = ids;
      setBlockSelection(ids.length > 0 ? ids : null);
    }

    // Keyboard: Escape toggles selection, Delete/Backspace removes selected blocks
    // Uses module-level getSelectedBlockIds() to avoid stale closure issues
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+A / Ctrl+A: two-step select all (block text → all blocks)
      if (e.key === 'a' && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();

        // If already in block selection mode → select all blocks
        const ids = getSelectedBlockIds();
        if (ids.length > 0) {
          const allBlockIds = editor.document.map((b: any) => b.id as string);
          updateSelection(allBlockIds);
          return;
        }

        const currentBlock = editor.getTextCursorPosition().block;

        // Check if current block has text content
        const hasText = Array.isArray(currentBlock.content) && currentBlock.content.length > 0;

        if (hasText) {
          // Check if all text in current block is already selected
          const pmView = (editor as any).prosemirrorView;
          const pmState = pmView.state;
          const { from, to } = pmState.selection;
          const $from = pmState.doc.resolve(from);
          const $to = pmState.doc.resolve(to);

          // Find the block content range: the blockContainer node that wraps this block
          // Walk up from $from to find the blockContainer
          let blockDepth = $from.depth;
          while (blockDepth > 0 && pmState.doc.resolve($from.before(blockDepth)).nodeAfter?.type.name !== 'blockContainer') {
            blockDepth--;
          }

          // Check if selection already covers the entire block content
          const blockStart = $from.start(blockDepth);
          const blockEnd = $from.end(blockDepth);
          const isBlockFullySelected = from <= blockStart && to >= blockEnd;

          if (!isBlockFullySelected) {
            // Select all text in current block using ProseMirror transaction
            // (must use PM API so state stays in sync for the second Cmd+A)
            const tr = pmState.tr.setSelection(TextSelection.create(pmState.doc, blockStart, blockEnd));
            pmView.dispatch(tr);
            return;
          }
        }

        // Block has no text or text is fully selected → block-level select all
        const allBlockIds = editor.document.map((b: any) => b.id as string);
        updateSelection(allBlockIds);
        // Exit editing mode — blur editor and clear text selection
        const pmEl = container?.querySelector('.ProseMirror') as HTMLElement;
        if (pmEl) pmEl.blur();
        window.getSelection()?.removeAllRanges();
        return;
      }

      // Cmd+C / Cmd+X: copy/cut selected blocks (block selection mode only)
      if ((e.key === 'c' || e.key === 'x') && (e.metaKey || e.ctrlKey) && !e.altKey) {
        const ids = getSelectedBlockIds();
        if (ids.length === 0) return; // Let BlockNote handle text-level copy/cut
        e.preventDefault();
        e.stopImmediatePropagation();

        const isCut = e.key === 'x';

        // Collect selected block data (deep clone to avoid references to editor blocks)
        const selectedBlocks = JSON.parse(JSON.stringify(
          editor.document.filter((b: any) => ids.includes(b.id))
        ));
        const markdown = blocksToMarkdown(selectedBlocks as any);
        setClipboardData(selectedBlocks, markdown, isCut);

        // Also write to system clipboard for external paste
        navigator.clipboard.writeText(markdown).catch(() => {});

        if (isCut) {
          // Cut: delete selected blocks after copying
          removeBlocksEnhanced(editor, ids.map(id => ({ id } as any)));
          updateSelection([]);
          (document.activeElement as HTMLElement)?.blur?.();
          document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          editor.focus();
        }
        return;
      }

      // Cmd+V: paste blocks from internal clipboard
      if (e.key === 'v' && (e.metaKey || e.ctrlKey) && !e.altKey) {
        const clipData = getClipboardData();
        if (!clipData) return; // No internal clipboard data — let BlockNote handle normal paste

        e.preventDefault();
        e.stopImmediatePropagation();

        const ids = getSelectedBlockIds();
        if (ids.length > 0) {
          // Block selection mode: replace selected blocks with clipboard content
          removeBlocksEnhanced(editor, ids.map(id => ({ id } as any)));
          updateSelection([]);
        }

        // Insert clipboard blocks at cursor position
        const currentBlock = editor.getTextCursorPosition().block;

        // Handle async: duplicate subpage pages for copy, then insert blocks
        (async () => {
          const { spaceSlug, pageId: currentPageId } = identityRef.current;
          // For copy (not cut): duplicate subpage pages so paste doesn't share the same page
          if (!clipData.isCut) {
            const subpageBlocks = clipData.blocks.filter((b: any) => b.type === 'subpage' && b.props?.pageId);
            for (const block of subpageBlocks) {
              try {
                const newPage = await pagesApi.duplicate(spaceSlug, block.props.pageId, currentPageId);
                block.props.pageId = newPage.id;
              } catch (err) {
                console.error('[PageEditor] Failed to duplicate subpage:', err);
              }
            }
          }

          // If current block is empty, replace it instead of inserting after it
          const isEmpty = !currentBlock.content || (Array.isArray(currentBlock.content) && currentBlock.content.length === 0);

          // Strip block IDs so BlockNote creates fresh ones
          const blocksToInsert = clipData.blocks.map((b: any) => {
            const { id, ...rest } = b;
            return rest;
          });
          if (isEmpty) {
            editor.replaceBlocks([currentBlock], blocksToInsert as any);
          } else {
            editor.insertBlocks(blocksToInsert as any, currentBlock, 'after');
          }
          editor.focus();

          // Save immediately so backend maintainSubpageBlocks can fix sort_order before sidebar refresh
          const markdown = blocksToMarkdown(editor.document);
          await createMirror(spaceSlug, currentPageId, markdown);
          hasChangesRef.current = false;
          await flushSync();
          await useSpaceStore.getState().refreshAll();
        })();
        return;
      }

      if (e.key !== 'Escape' && e.key !== 'Backspace' && e.key !== 'Delete') return;

      // If a floating menu is open (drag menu or slash menu), let it handle Escape first
      const hasOpenMenu = isDragMenuOpen() || !!document.getElementById('bn-suggestion-menu');
      if (e.key === 'Escape' && hasOpenMenu) return;

      const ids = getSelectedBlockIds();
      if (ids.length > 0) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          updateSelection([]);
          setBlockSelection(null);
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          e.stopImmediatePropagation();
          removeBlocksEnhanced(editor, ids.map(id => ({ id } as any)));
          updateSelection([]);
          // Clean up: blur focused buttons and dismiss floating menus
          (document.activeElement as HTMLElement)?.blur?.();
          document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          editor.focus();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        const currentBlock = editor.getTextCursorPosition().block;
        updateSelection([currentBlock.id as string]);
        // Exit editing mode — blur editor to hide cursor
        const pmEl = container?.querySelector('.ProseMirror') as HTMLElement;
        if (pmEl) pmEl.blur();
      } else if (e.key === 'Backspace') {
        // Allow deleting empty first block (BlockNote default doesn't support this)
        const blocks = editor.document;
        if (blocks.length > 1) {
          const currentBlock = editor.getTextCursorPosition().block;
          const isFirstBlock = blocks[0].id === currentBlock.id;
          const isEmpty = !currentBlock.content || (Array.isArray(currentBlock.content) && currentBlock.content.length === 0);
          if (isFirstBlock && isEmpty) {
            e.preventDefault();
            e.stopImmediatePropagation();
            removeBlocksEnhanced(editor, [{ id: currentBlock.id } as any]);
            editor.focus();
          }
        }
      }
    };

    // Mousedown on non-block area: start drag selection
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;

      // Only start in the scrollable content area (covers side whitespace too)
      const scrollableArea = container.closest('.overflow-y-auto');
      if (!scrollableArea || !scrollableArea.contains(target)) return;

      if (target.closest('.bn-block-outer')) return;
      if (target.closest('button, a, input, [contenteditable="true"]')) return;

      e.preventDefault(); // prevent browser text selection during drag
      isDragging = true;
      dragOccurred = false;
      dragOccurredRef.current = false;
      startX = e.clientX;
      startY = e.clientY;
    };

    // Mousemove: update selection rectangle + highlight intersecting blocks
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (dist < 5) return;

      if (!dragOccurred) {
        dragOccurred = true;
        dragOccurredRef.current = true;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'default';
        selectionRect = document.createElement('div');
        selectionRect.style.cssText =
          'position:fixed;pointer-events:none;z-index:9999;' +
          'background:rgba(35,131,226,0.1);border-radius:2px;';
        document.body.appendChild(selectionRect);
      }

      const left = Math.min(startX, e.clientX);
      const top = Math.min(startY, e.clientY);
      const width = Math.abs(e.clientX - startX);
      const height = Math.abs(e.clientY - startY);

      if (selectionRect) {
        selectionRect.style.left = `${left}px`;
        selectionRect.style.top = `${top}px`;
        selectionRect.style.width = `${width}px`;
        selectionRect.style.height = `${height}px`;
      }

      // Find intersecting blocks
      const selRect = { left, top, right: left + width, bottom: top + height };
      const blockOuters = container.querySelectorAll('.bn-block-outer');
      const intersecting: string[] = [];

      blockOuters.forEach(outer => {
        const blockEl = outer.querySelector('[data-id]');
        if (!blockEl) return;
        const r = outer.getBoundingClientRect();
        if (selRect.left < r.right && selRect.right > r.left &&
            selRect.top < r.bottom && selRect.bottom > r.top) {
          intersecting.push(blockEl.getAttribute('data-id')!);
        }
      });

      updateSelection(intersecting);
    };

    // Mouseup: clean up drag
    const handleMouseUp = () => {
      if (selectionRect) {
        selectionRect.remove();
        selectionRect = null;
      }
      if (dragOccurred) {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
      isDragging = false;
    };

    // Click: clear selection (unless after drag, on side menu, or floating menu is open)
    // Uses getSelectedBlockIds() to also catch selections from drag handle click
    const handleClick = (e: MouseEvent) => {
      if (dragOccurred) {
        dragOccurred = false;
        return;
      }
      // Don't clear selection when clicking side menu (drag handle, add button)
      if ((e.target as HTMLElement).closest('.bn-side-menu, [data-floating-ui-focusable]')) return;
      // If a floating menu is open, this click just closes the menu — don't deselect yet
      const hasOpenMenu = isDragMenuOpen();
      if (hasOpenMenu) return;
      if (getSelectedBlockIds().length > 0) {
        updateSelection([]);
        setBlockSelection(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('click', handleClick);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('click', handleClick);
      selectionRect?.remove();
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [editor, readOnly]);

  // Side menu hover zone: only show side menu when mouse is within restricted horizontal area
  // Notion behavior: buttons visible from blockLeft - 150px to blockLeft + blockWidth * 0.7
  useEffect(() => {
    if (readOnly) return;
    const container = editorRef.current;
    if (!container) return;

    const handleSideMenuZone = (e: MouseEvent) => {
      // When drag menu is open, keep side menu visible regardless of mouse position
      if (isDragMenuOpen()) return;

      // Find hovered block by y coordinate
      const blockOuters = container.querySelectorAll('.bn-block-outer');
      let hoveredOuter: HTMLElement | null = null;
      for (const outer of blockOuters) {
        const r = outer.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) {
          hoveredOuter = outer as HTMLElement;
          break;
        }
      }

      if (!hoveredOuter) {
        document.body.classList.remove('side-menu-visible');
        return;
      }

      // Get block content boundaries
      const blockContent = hoveredOuter.querySelector('[data-id]') || hoveredOuter;
      const contentRect = blockContent.getBoundingClientRect();

      // Notion's hover zone: left boundary = blockLeft - 150px, right boundary = blockLeft + blockWidth * 0.7
      const leftBound = contentRect.left - 150;
      const rightBound = contentRect.left + contentRect.width * 0.7;

      if (e.clientX >= leftBound && e.clientX <= rightBound) {
        document.body.classList.add('side-menu-visible');
      } else {
        document.body.classList.remove('side-menu-visible');
      }
    };

    document.addEventListener('mousemove', handleSideMenuZone);
    return () => document.removeEventListener('mousemove', handleSideMenuZone);
  }, [editor, readOnly]);

  // Helper: check if a block outer element is input-capable (has editable text content)
  // Blocks with .bn-inline-content are input-capable (paragraph, heading, list, etc.)
  // Blocks without it (subpage, bookmark, pageReference, divider, image) are not
  const isInputBlock = useCallback((blockOuter: HTMLElement): boolean => {
    return !!blockOuter.querySelector('.bn-inline-content');
  }, []);

  // Helper: find nearest input-capable block in given direction
  const findNearestInputBlock = useCallback((startOuter: HTMLElement, direction: 'above' | 'below'): HTMLElement | null => {
    const container = editorRef.current;
    if (!container) return null;

    const blockOuters = Array.from(container.querySelectorAll('.bn-block-outer'));
    const startIndex = blockOuters.indexOf(startOuter);
    if (startIndex === -1) return null;

    if (direction === 'above') {
      for (let i = startIndex - 1; i >= 0; i--) {
        if (isInputBlock(blockOuters[i] as HTMLElement)) return blockOuters[i] as HTMLElement;
      }
    } else {
      for (let i = startIndex + 1; i < blockOuters.length; i++) {
        if (isInputBlock(blockOuters[i] as HTMLElement)) return blockOuters[i] as HTMLElement;
      }
    }
    return null;
  }, [isInputBlock]);

  // Helper: find block nearest to y coordinate
  const findBlockByY = useCallback((y: number): HTMLElement | null => {
    const container = editorRef.current;
    if (!container) return null;

    const blockOuters = container.querySelectorAll('.bn-block-outer');
    let nearest: HTMLElement | null = null;
    let minDist = Infinity;

    for (const outer of blockOuters) {
      const r = outer.getBoundingClientRect();
      // Check if y is within block bounds (with some tolerance for padding)
      const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (dist < minDist) {
        minDist = dist;
        nearest = outer as HTMLElement;
      }
    }

    // Only return if within reasonable distance (block height or 25px tolerance)
    if (nearest && minDist <= 25) return nearest;
    return nearest; // still return nearest even if a bit far
  }, []);


  // Click below editor content: insert new empty paragraph and focus
  const handleClickBelow = useCallback(() => {
    if (readOnly) return;
    if (dragOccurredRef.current) {
      dragOccurredRef.current = false;
      return;
    }
    const blocks = editor.document;
    if (blocks.length === 0) return;

    const lastDocBlock = blocks[blocks.length - 1];
    const content = lastDocBlock.content;
    const lastIsEmpty = !content || (Array.isArray(content) && content.length === 0);

    // Check if the last block is input-capable (has editable text)
    // Non-input blocks like subpage, bookmark, pageReference can't receive cursor
    const container = editorRef.current;
    const blockOuters = container?.querySelectorAll('.bn-block-outer');
    const lastOuter = blockOuters?.[blockOuters.length - 1];
    const lastIsInput = lastOuter ? isInputBlock(lastOuter as HTMLElement) : false;

    if (lastIsEmpty && lastIsInput) {
      editor.setTextCursorPosition(lastDocBlock, 'end');
    } else {
      // Last block is non-input (subpage, bookmark, etc.) or has content → insert new paragraph after it
      const inserted = editor.insertBlocks([{ type: 'paragraph' } as any], lastDocBlock, 'after');
      if (inserted.length > 0) {
        editor.setTextCursorPosition(inserted[0], 'start');
      }
    }
    editor.focus();
  }, [editor, readOnly, isInputBlock]);

  // Listen for clicks on the scroll container's empty space below editor
  useEffect(() => {
    if (readOnly) return;
    const container = editorRef.current;
    if (!container) return;

    const scrollArea = container.closest('.overflow-y-auto');
    if (!scrollArea) return;

    const handleScrollAreaClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.bn-block-outer, button, a, input, [contenteditable="true"]')) return;
      if (target.closest('[data-floating-ui-focusable]')) return;

      // Click below editor content → append new paragraph
      const editorBottom = container.getBoundingClientRect().bottom;
      if (e.clientY >= editorBottom - 10) {
        handleClickBelow();
        return;
      }

      // Click in whitespace around blocks → focus nearest input-capable block
      const clickedBlock = findBlockByY(e.clientY);
      if (!clickedBlock) return;

      if (isInputBlock(clickedBlock)) {
        // Input block: focus it directly
        const blockEl = clickedBlock.querySelector('[data-id]');
        const blockId = blockEl?.getAttribute('data-id');
        if (blockId) {
          editor.setTextCursorPosition(blockId as any, 'end');
          editor.focus();
        }
        return;
      }

      // Non-input block (subpage, image, etc.): determine left or right
      const blockContent = clickedBlock.querySelector('.bn-block-content') || clickedBlock.querySelector('[data-id]');
      if (!blockContent) return;
      const contentRect = blockContent.getBoundingClientRect();

      let targetBlock: HTMLElement | null;
      if (e.clientX < contentRect.left) {
        // Left side → above nearest input block
        targetBlock = findNearestInputBlock(clickedBlock, 'above');
      } else {
        // Right side → below nearest input block
        targetBlock = findNearestInputBlock(clickedBlock, 'below');
      }

      if (targetBlock) {
        const blockEl = targetBlock.querySelector('[data-id]');
        const blockId = blockEl?.getAttribute('data-id');
        if (blockId) {
          editor.setTextCursorPosition(blockId as any, 'end');
          editor.focus();
          // Scroll target into view if needed
          const targetRect = targetBlock.getBoundingClientRect();
          if (targetRect.top < 0 || targetRect.bottom > window.innerHeight) {
            targetBlock.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }
    };

    scrollArea.addEventListener('click', handleScrollAreaClick);
    return () => scrollArea.removeEventListener('click', handleScrollAreaClick);
  }, [readOnly, handleClickBelow, findBlockByY, isInputBlock, findNearestInputBlock, editor]);

  // Unmount: write final mirror if there are unsaved changes
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (hasChangesRef.current && !readOnlyRef.current) {
        try {
          const currentBlocks = editor.document;
          const markdown = blocksToMarkdown(currentBlocks);
          const { spaceSlug, pageId } = identityRef.current;
          createMirror(spaceSlug, pageId, markdown);
        } catch (error) {
          console.error('Failed to create mirror on unmount:', error);
        }
      }
    };
  }, [editor]);

  // Browser/tab close: write final mirror
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasChangesRef.current && !readOnlyRef.current) {
        try {
          const currentBlocks = editor.document;
          const markdown = blocksToMarkdown(currentBlocks);
          const { spaceSlug, pageId } = identityRef.current;
          createMirror(spaceSlug, pageId, markdown);
        } catch {
          // Best effort — IndexedDB write may not complete in all browsers
        }
        // Trigger browser confirmation dialog
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editor]);

  return (
    <div className="relative" ref={editorRef}>
      <ComponentsContext.Provider value={blockNoteComponents as any}>
        <div>
          <BlockNoteViewRaw
            editor={editor}
            editable={!readOnly}
            onChange={handleChange}
            theme="light"
            slashMenu={false}
            sideMenu={true}
            formattingToolbar={true}
            linkToolbar={true}
          >
            {/* Custom slash menu with subpage support */}
            {!readOnly && (
              <SuggestionMenuController
                triggerCharacter="/"
                getItems={async (query: string) => filterSuggestionItems(getCustomSlashMenuItems(editor), query)}
              />
            )}
          </BlockNoteViewRaw>
        </div>
      </ComponentsContext.Provider>
      {/* Clickable area below editor — click to append new paragraph */}
      {!readOnly && (
        <div
          className="w-full cursor-text"
          style={{ minHeight: '5vh' }}
          onClick={handleClickBelow}
        />
      )}
      {pasteMenu && (
        <LinkPasteMenu
          url={pasteMenu.url}
          position={pasteMenu.position}
          onInsertLink={handleInsertLink}
          onInsertBookmark={handleInsertBookmark}
          onClose={() => setPasteMenu(null)}
        />
      )}
    </div>
  );
}

export default PageEditor;
