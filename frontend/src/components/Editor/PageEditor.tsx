import { useEffect, useState, useCallback, useRef } from 'react';
import { BlockNoteViewRaw, useCreateBlockNote, ComponentsContext } from '@blocknote/react';
import { BlockNoteEditor } from '@blocknote/core';
import '@blocknote/react/style.css';
import { markdownToBlocks, blocksToMarkdown } from '../../utils/markdown';
import { blockNoteComponents, clearBlockSelection } from './BlockNoteComponents';

interface PageEditorProps {
  initialContent: string;
  onSave: (content: string) => void | Promise<void>;
  readOnly?: boolean;
}

export function PageEditor({ initialContent, onSave, readOnly = false }: PageEditorProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const editorRef = useRef<HTMLDivElement>(null);

  const editor: BlockNoteEditor = useCreateBlockNote({
    initialContent: markdownToBlocks(initialContent),
  });

  const triggerSave = useCallback(async () => {
    if (!hasChanges || isSaving || readOnly) return;

    setIsSaving(true);
    try {
      const currentBlocks = editor.document;
      const markdown = blocksToMarkdown(currentBlocks);
      await onSave(markdown);
      setHasChanges(false);
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
      {(hasChanges || isSaving) && (
        <div className="fixed top-4 right-4 z-50 bg-white px-3 py-1.5 rounded-lg shadow-md border border-gray-200 text-sm">
          {isSaving ? (
            <span className="flex items-center gap-2 text-gray-600">
              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-600" />
              保存中...
            </span>
          ) : (
            <span className="text-gray-500">未保存的更改...</span>
          )}
        </div>
      )}

      <ComponentsContext.Provider value={blockNoteComponents}>
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
      </ComponentsContext.Provider>
    </div>
  );
}

export default PageEditor;
