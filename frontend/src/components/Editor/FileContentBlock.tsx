import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import { createExtension } from '@blocknote/core';
import {
  FileCode,
  FileSearch,
  Download,
  Copy,
  Check,
  ChevronDown,
} from 'lucide-react';
import { useSpaceStore } from '../../stores/spaceStore';
import { usePreferenceStore } from '../../stores/preferenceStore';
import { readSpaceFile, saveSpaceFileAs, displayFilePath } from '../../api/files';
import { FilePickerMenu } from './FilePickerMenu';
import { LANGUAGES, languageDisplayName } from './languages';
import { renderFileContentHighlightLines } from './fileContentHighlight';

/**
 * fileContent block
 *
 * Visual style mirrors the existing code block. The block references a file
 * under <space>/_files/, displays its content inline, and writes edits back
 * to the file on page save (handled by the backend maintainFileContentBlocks
 * step in PageService.Update).
 *
 * - Empty state (path === ''): shows "点击引用文件" placeholder that opens
 *   the file picker.
 * - With path: header bar (path + action buttons) + editable code area. The
 *   header only appears on hover so it doesn't crowd the page at rest.
 *
 * Action buttons (hover only):
 *   - Language selector dropdown (same list as code block)
 *   - Copy content
 *   - Change file (reopens picker)
 *   - Download file
 *
 * "Unbind" lives in the picker tab bar (mirrors cover menu's "移除").
 *
 * Serialization (see utils/markdown.ts):
 *   <!-- file: <path> -->
 *   ```<lang>
 *   <content>
 *   ```
 *
 * Note: BlockNote requires contentRef to always be mounted for
 * content='inline' blocks; the empty-state overlay hides the content area
 * visually but keeps the ref attached.
 */

// fileContent 块异步 hydration 注册表：标记某个块正在从磁盘加载内容。
// PageEditor.persistFileContentBlocks 据此跳过"加载中"的块（不写文件、
// 不记 baseline），避免打开页面后在内容加载完成前保存，把空内容/用户
// 在空白块里输入的片段写回覆盖原文件。
const hydratingFileContentBlocks = new Set<string>();

export function markFileContentHydrating(blockId: string, hydrating: boolean) {
  if (hydrating) hydratingFileContentBlocks.add(blockId);
  else hydratingFileContentBlocks.delete(blockId);
}

export function isFileContentHydrating(blockId: string) {
  return hydratingFileContentBlocks.has(blockId);
}

function inferLangFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    go: 'go',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    jsx: 'jsx',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c', h: 'c',
    cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    sh: 'bash', bash: 'bash', zsh: 'zsh',
    ps1: 'powershell',
    sql: 'sql',
    json: 'json',
    yaml: 'yaml', yml: 'yaml',
    toml: 'toml',
    xml: 'xml', html: 'html', svg: 'svg',
    css: 'css', scss: 'scss', less: 'less',
    md: 'markdown', markdown: 'markdown',
  };
  if (!ext) {
    const base = path.split('/').pop()?.toLowerCase() ?? '';
    if (base === 'dockerfile') return 'docker';
    if (base === 'makefile') return 'make';
    return 'text';
  }
  return map[ext] ?? 'text';
}

const FileContentKeyboardShortcuts = createExtension({
  key: 'file-content-keyboard-shortcuts',
  keyboardShortcuts: {
    Enter: ({ editor }) => {
      return editor.transact((tr) => {
        const { block, nextBlock } = editor.getTextCursorPosition();
        if (block.type !== 'fileContent') {
          return false;
        }
        const { $from } = tr.selection;

        const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2;
        const endsWithDoubleNewline = $from.parent.textContent.endsWith('\n\n');

        if (isAtEnd && endsWithDoubleNewline) {
          tr.delete($from.pos - 2, $from.pos);

          if (nextBlock) {
            editor.setTextCursorPosition(nextBlock, 'start');
            return true;
          }

          const [newBlock] = editor.insertBlocks(
            [{ type: 'paragraph' }],
            block,
            'after',
          );
          editor.setTextCursorPosition(newBlock, 'start');
          return true;
        }

        tr.insertText('\n');
        return true;
      });
    },
    'Shift-Enter': ({ editor }) => {
      return editor.transact(() => {
        const { block } = editor.getTextCursorPosition();
        if (block.type !== 'fileContent') {
          return false;
        }

        const [newBlock] = editor.insertBlocks(
          [{ type: 'paragraph' }],
          block,
          'after',
        );
        editor.setTextCursorPosition(newBlock, 'start');
        return true;
      });
    },
  },
});

function FileContentComponent({ block, editor, contentRef }: any) {
  const path: string = block.props.path || '';
  const language: string = block.props.language || 'text';
  const { currentSpace } = useSpaceStore();
  const codeTheme = usePreferenceStore((state) => state.getCodeTheme());
  const slug = currentSpace?.slug;
  const inlineText = (block.content ?? [])
    .map((c: any) => c?.text ?? '')
    .join('');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [langSearch, setLangSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const langBtnRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousLinesRef = useRef<string[]>([]);
  const highlightGenerationRef = useRef(0);

  const handleCodeScroll = useCallback(() => {
    const overlay = overlayRef.current;
    const pre = wrapperRef.current?.querySelector('.bn-file-content-pre') as HTMLElement | null;
    if (!overlay || !pre) return;
    overlay.scrollLeft = pre.scrollLeft;
    overlay.scrollTop = pre.scrollTop;
  }, []);

  useEffect(() => {
    const pre = wrapperRef.current?.querySelector('.bn-file-content-pre') as HTMLElement | null;
    if (!pre) return;
    pre.addEventListener('scroll', handleCodeScroll, { passive: true });
    handleCodeScroll();
    return () => pre.removeEventListener('scroll', handleCodeScroll);
  }, [handleCodeScroll]);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    if (!path || loading || !inlineText) {
      overlay.replaceChildren();
      previousLinesRef.current = [];
      return;
    }

    const nextLines = inlineText.split('\n');
    const previousLines = previousLinesRef.current;
    const isInitialRender = previousLines.length === 0;

    let prefix = 0;
    while (
      prefix < previousLines.length
      && prefix < nextLines.length
      && previousLines[prefix] === nextLines[prefix]
    ) {
      prefix += 1;
    }

    let previousEnd = previousLines.length;
    let nextEnd = nextLines.length;
    while (
      previousEnd > prefix
      && nextEnd > prefix
      && previousLines[previousEnd - 1] === nextLines[nextEnd - 1]
    ) {
      previousEnd -= 1;
      nextEnd -= 1;
    }

    while (overlay.children.length < nextLines.length) {
      const line = document.createElement('div');
      line.className = 'bn-file-content-highlight-line';
      overlay.appendChild(line);
    }
    while (overlay.children.length > nextLines.length) {
      overlay.lastElementChild?.remove();
    }

    // Keep existing token DOM while the next highlight frame is pending. Only
    // brand-new/empty lines need a plain placeholder before their first paint.
    for (let i = prefix; i < nextEnd; i += 1) {
      const line = overlay.children[i] as HTMLElement | undefined;
      if (line && (isInitialRender || line.childNodes.length === 0)) {
        line.textContent = nextLines[i] ?? '';
      }
    }
    previousLinesRef.current = nextLines;

    const generation = ++highlightGenerationRef.current;
    const frame = window.requestAnimationFrame(() => {
      void renderFileContentHighlightLines(inlineText, language, codeTheme).then((renderedLines) => {
        if (
          generation !== highlightGenerationRef.current
          || overlayRef.current !== overlay
        ) {
          return;
        }
        for (let i = prefix; i < nextEnd; i += 1) {
          const line = overlay.children[i] as HTMLElement | undefined;
          if (line) line.innerHTML = renderedLines[i] ?? '';
        }
        handleCodeScroll();
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [codeTheme, handleCodeScroll, inlineText, language, loading, path]);

  // When a path is set but the block content is empty, hydrate by reading
  // the file. (Backend normally injects content during page load via
  // enrichFileContentBlocks, so this is a fallback.)
  useEffect(() => {
    if (!path || !slug) return;
    const inlineText = (block.content ?? [])
      .map((c: any) => c?.text ?? '')
      .join('');
    if (inlineText.length > 0) {
      setMissing(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // 注册加载状态：期间 persistFileContentBlocks 跳过该块，防止把空
    // 内容/用户在空白块里的输入写回文件。
    markFileContentHydrating(block.id, true);
    readSpaceFile(slug, path)
      .then((text) => {
        if (cancelled) return;
        if (text === null || text === undefined) {
          setMissing(true);
          return;
        }
        // 加载期间用户可能已经输入了内容——复查块是否仍为空，非空则
        // 放弃 hydration，避免覆盖用户输入。
        const live = editor.getBlock(block.id);
        const liveText = (live?.content ?? [])
          .map((c: any) => c?.text ?? '')
          .join('');
        if (liveText.length > 0) {
          setMissing(false);
          return;
        }
        // Hydration fills ONLY content. Leave props (incl. language) alone —
        // language is the value parsed from markdown (set either by
        // handlePick's path-based inference for newly-bound files, or by the
        // user's manual selection). Overriding it here would clobber the
        // user's choice on every reload (e.g. a .plist the user set to
        // 'xml' would snap back to 'text').
        editor.transact((tr: any) => {
          tr.setMeta('addToHistory', false);
          editor.updateBlock(block.id, {
            type: 'fileContent',
            content: [{ type: 'text', text, styles: {} }],
          } as any);
          return tr;
        });
        setMissing(false);
      })
      .catch(() => !cancelled && setMissing(true))
      .finally(() => {
        if (!cancelled) setLoading(false);
        markFileContentHydrating(block.id, false);
      });
    return () => {
      cancelled = true;
      markFileContentHydrating(block.id, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, slug]);

  // Close the language dropdown on outside click
  useEffect(() => {
    if (!langOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (langBtnRef.current?.contains(t)) return;
      if (wrapperRef.current?.contains(t) && !langBtnRef.current?.contains(t)) {
        setLangOpen(false);
        setLangSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [langOpen]);

  // Close the language dropdown on Escape
  useEffect(() => {
    if (!langOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setLangOpen(false);
        setLangSearch('');
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [langOpen]);

  const handlePick = useCallback(
    (pickedPath: string) => {
      setPickerOpen(false);
      if (!pickedPath) return;
      editor.updateBlock(block.id, {
        type: 'fileContent',
        props: {
          path: pickedPath,
          language: inferLangFromPath(pickedPath),
        },
        content: [{ type: 'text', text: '', styles: {} }],
      } as any);
      setMissing(false);
    },
    [block.id, editor]
  );

  const handleDetach = useCallback(() => {
    editor.updateBlock(block.id, {
      type: 'fileContent',
      props: { path: '', language: 'text' },
    } as any);
  }, [block.id, editor]);

  const handleDownload = useCallback(async () => {
    if (!slug || !path) return;
    try {
      await saveSpaceFileAs(slug, path);
    } catch (err) {
      console.error('download failed', err);
    }
  }, [slug, path]);

  const handleSelectLanguage = useCallback(
    (langId: string) => {
      editor.updateBlock(block.id, {
        type: 'fileContent',
        props: { ...block.props, language: langId },
      } as any);
      setLangOpen(false);
      setLangSearch('');
    },
    [block.id, block.props, editor]
  );

  const handleCopy = useCallback(async () => {
    const text = (block.content ?? [])
      .map((c: any) => c?.text ?? '')
      .join('');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('copy failed', err);
    }
  }, [block.content]);

  const handleOuterPickClick = useCallback(() => {
    if (!path) setPickerOpen(true);
  }, [path]);

  const filteredLangs = langSearch
    ? LANGUAGES.filter(
        ([id, name]) =>
          id.toLowerCase().includes(langSearch.toLowerCase()) ||
          name.toLowerCase().includes(langSearch.toLowerCase())
      )
    : LANGUAGES;

  return (
    <div
      ref={wrapperRef}
      className={`bn-file-content-block${path ? '' : ' is-empty'}`}
      onClick={handleOuterPickClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setLangOpen(false);
        setLangSearch('');
      }}
    >
      {path && (
        <div className="bn-file-content-header" contentEditable={false}>
          <div className="bn-file-content-path" title={displayFilePath(path)}>
            <FileCode size={13} />
            <span className="bn-file-content-path-text">{displayFilePath(path)}</span>
            {missing && (
              <span className="bn-file-content-warning">（文件不存在）</span>
            )}
            {loading && <span className="bn-file-content-loading">加载中…</span>}
          </div>
          <div
            className={`bn-file-content-actions${hovered || langOpen ? ' is-visible' : ''}`}
          >
            <div className="bn-file-content-lang" ref={langBtnRef}>
              <button
                type="button"
                className="cb-lang-btn"
                title="切换语言"
                onClick={(e) => {
                  e.stopPropagation();
                  setLangOpen((v) => !v);
                  setLangSearch('');
                }}
              >
                {languageDisplayName(language)}
                <ChevronDown size={12} />
              </button>
              {langOpen && (
                <div
                  className="cb-dropdown"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    className="cb-search"
                    placeholder="搜索语言..."
                    value={langSearch}
                    onChange={(e) => setLangSearch(e.target.value)}
                    autoFocus
                  />
                  <div className="cb-lang-list">
                    {filteredLangs.map(([id, name]) => (
                      <button
                        key={id}
                        className={`cb-lang-item${id === language ? ' selected' : ''}`}
                        onClick={() => handleSelectLanguage(id)}
                      >
                        <span>{name}</span>
                        {id === language && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              className="cb-copy-btn"
              title="复制内容"
              onClick={(e) => {
                e.stopPropagation();
                handleCopy();
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <button
              type="button"
              className="cb-copy-btn"
              title="更换文件"
              onClick={(e) => {
                e.stopPropagation();
                setPickerOpen(true);
              }}
            >
              <FileSearch size={14} />
            </button>
            <button
              type="button"
              className="cb-copy-btn"
              title="下载文件"
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
              disabled={!slug}
            >
              <Download size={14} />
            </button>
          </div>
        </div>
      )}
      <div className="bn-file-content-body">
        {/* contentRef must always be mounted for inline content blocks.
            Hidden while loading (display:none) so the not-yet-hydrated empty
            area is not clickable/editable — prevents partial input from
            replacing file content on save. */}
        <pre
          className={`bn-inline-content bn-file-content-pre${path && !loading ? '' : ' is-hidden'}`}
          data-language={language}
          ref={contentRef}
          spellCheck={false}
        />
        <div
          ref={overlayRef}
          className="bn-file-content-highlight-overlay"
          aria-hidden="true"
        />
      </div>
      {!path && (
        <div className="bn-file-content-placeholder" contentEditable={false}>
          <FileCode size={20} />
          <span>点击引用文件</span>
        </div>
      )}
      {pickerOpen && slug && (
        <FilePickerMenu
          slug={slug}
          onClose={() => setPickerOpen(false)}
          onPick={handlePick}
          onUnbind={path ? handleDetach : undefined}
          currentPath={path}
          anchorRef={wrapperRef}
        />
      )}
    </div>
  );
}

export const FileContentBlockSpec = createReactBlockSpec(
  {
    type: 'fileContent',
    propSchema: {
      path: { default: '' },
      language: { default: 'text' },
    },
    content: 'inline',
  },
  {
    // `code: true` is mandatory for the highlighter to align with the
    // document. Without it, BlockNote's text inserter converts every `\n`
    // into a `hardBreak` node (blocks-UU7EM-QM.js). hardBreak contributes 0
    // chars to `node.textContent` but consumes a position in the doc, so
    // prosemirror-highlight (which parses `textContent` and walks
    // `from += 1` per line) drifts by N positions after N newlines — every
    // line of the rendered file ends up shifted one span further left,
    // which is exactly the "颜色不对" symptom we saw. Mirrors what
    // BlockNote's built-in codeBlock sets.
    meta: {
      code: true,
      defining: true,
      isolating: false,
    },
    render: FileContentComponent,
  },
  [FileContentKeyboardShortcuts],
);
