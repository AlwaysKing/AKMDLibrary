import { useEffect, useState, useCallback, useRef } from 'react';
import { BlockNoteViewRaw, useCreateBlockNote, ComponentsContext } from '@blocknote/react';
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { zh } from '@blocknote/core/locales';
import '@blocknote/react/style.css';
import { markdownToBlocks, blocksToMarkdown } from '../../utils/markdown';
import { blockNoteComponents, clearBlockSelection } from './BlockNoteComponents';
import { PageReferenceBlockSpec } from './PageReferenceBlock';
import { BookmarkBlockSpec } from './BookmarkBlock';
import LinkPasteMenu from './LinkPasteMenu';

// Custom schema: default blocks + pageReference + bookmark
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    pageReference: PageReferenceBlockSpec(),
    bookmark: BookmarkBlockSpec(),
  },
});

// Internal URL detection — match only URLs from this app's origin
const APP_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';
const INTERNAL_URL_RE = new RegExp(`^${APP_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/s/([^/]+)/p/(\\d+)(?:$|/)`);
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
  onSave: (content: string) => void | Promise<void>;
  onSyncStatusChange?: (status: 'syncing' | 'synced') => void;
  readOnly?: boolean;
}

export function PageEditor({ initialContent, onSave, onSyncStatusChange, readOnly = false }: PageEditorProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const editorRef = useRef<HTMLDivElement>(null);

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
  });

  const triggerSave = useCallback(async () => {
    if (!hasChanges || isSaving || readOnly) return;

    setIsSaving(true);
    onSyncStatusChange?.('syncing');
    try {
      const currentBlocks = editor.document;
      const markdown = blocksToMarkdown(currentBlocks);
      await onSave(markdown);
      setHasChanges(false);
      onSyncStatusChange?.('synced');
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  }, [editor, hasChanges, isSaving, onSave, readOnly]);

  const handleChange = useCallback(() => {
    setHasChanges(true);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      triggerSave();
    }, 2000);
  }, [triggerSave]);

  // Paste handler
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain').trim();
    if (!URL_RE.test(text)) return; // Not a URL, let default paste handle it

    e.preventDefault();

    // Check if internal URL
    const internalMatch = text.match(INTERNAL_URL_RE);
    if (internalMatch) {
      const pageId = internalMatch[2];
      // Insert page reference block
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
  }, [editor]);

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

  // Block selection: click on empty space or use Escape to deselect
  useEffect(() => {
    const container = editorRef.current;
    if (!container || readOnly) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearBlockSelection();
      }
    };

    container.addEventListener('click', () => clearBlockSelection());
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('click', () => clearBlockSelection());
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [readOnly]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (hasChanges && !readOnly) {
        triggerSave();
      }
    };
  }, [hasChanges, readOnly, triggerSave]);

  return (
    <div className="relative" ref={editorRef}>
      <ComponentsContext.Provider value={blockNoteComponents as any}>
        <div onPaste={handlePaste}>
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
