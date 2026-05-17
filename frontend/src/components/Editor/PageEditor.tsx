import { useEffect, useState, useCallback, useRef } from 'react';
import { BlockNoteViewRaw, useCreateBlockNote, ComponentsContext } from '@blocknote/react';
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { zh } from '@blocknote/core/locales';
import '@blocknote/react/style.css';
import { markdownToBlocks, blocksToMarkdown } from '../../utils/markdown';
import { blockNoteComponents, setBlockSelection, getSelectedBlockIds, isDragMenuOpen } from './BlockNoteComponents';
import { removeBlocksEnhanced } from './blockHelpers';
import { PageReferenceBlockSpec } from './PageReferenceBlock';
import { BookmarkBlockSpec } from './BookmarkBlock';
import { SubpageBlockSpec } from './SubpageBlock';
import LinkPasteMenu from './LinkPasteMenu';
import { createMirror } from '../../services/mirrorStore';
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
    heading_5: { ...zh.slash_menu.heading_5, group: '基础区块' },
    heading_6: { ...zh.slash_menu.heading_6, group: '基础区块' },
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

  // Sync subpage blocks with sidebar create/delete events
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

    document.addEventListener('subpage-created', handleSubpageCreated);
    document.addEventListener('subpage-deleted', handleSubpageDeleted);
    return () => {
      document.removeEventListener('subpage-created', handleSubpageCreated);
      document.removeEventListener('subpage-deleted', handleSubpageDeleted);
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
      if (e.key !== 'Escape' && e.key !== 'Backspace' && e.key !== 'Delete') return;

      // If a floating menu is open, let it handle Escape first
      const hasOpenMenu = isDragMenuOpen();

      const ids = getSelectedBlockIds();
      if (ids.length > 0) {
        if (e.key === 'Escape') {
          if (hasOpenMenu) return; // Let menu handle it
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
    const handleBeforeUnload = () => {
      if (hasChangesRef.current && !readOnlyRef.current) {
        try {
          const currentBlocks = editor.document;
          const markdown = blocksToMarkdown(currentBlocks);
          const { spaceSlug, pageId } = identityRef.current;
          createMirror(spaceSlug, pageId, markdown);
        } catch {
          // Best effort — IndexedDB write may not complete in all browsers
        }
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
            slashMenu={true}
            sideMenu={true}
            formattingToolbar={true}
            linkToolbar={true}
          />
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
