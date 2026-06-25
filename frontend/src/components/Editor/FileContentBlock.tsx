import { useEffect, useRef, useState, useCallback } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import {
  FileCode,
  FileSearch,
  Download,
  Copy,
  Check,
  ChevronDown,
} from 'lucide-react';
import { useSpaceStore } from '../../stores/spaceStore';
import { readSpaceFile, saveSpaceFileAs, displayFilePath } from '../../api/files';
import { FilePickerMenu } from './FilePickerMenu';
import { LANGUAGES, languageDisplayName } from './languages';

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

function FileContentComponent({ block, editor, contentRef }: any) {
  const path: string = block.props.path || '';
  const language: string = block.props.language || 'text';
  const { currentSpace } = useSpaceStore();
  const slug = currentSpace?.slug;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [langSearch, setLangSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const langBtnRef = useRef<HTMLDivElement>(null);

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
    readSpaceFile(slug, path)
      .then((text) => {
        if (cancelled) return;
        if (text === null || text === undefined) {
          setMissing(true);
          return;
        }
        // Hydration fills ONLY content. Leave props (incl. language) alone —
        // language is the value parsed from markdown (set either by
        // handlePick's path-based inference for newly-bound files, or by the
        // user's manual selection). Overriding it here would clobber the
        // user's choice on every reload (e.g. a .plist the user set to
        // 'xml' would snap back to 'text').
        editor.updateBlock(block.id, {
          type: 'fileContent',
          content: [{ type: 'text', text, styles: {} }],
        } as any);
        setMissing(false);
      })
      .catch(() => !cancelled && setMissing(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
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
      {/* contentRef must always be mounted for inline content blocks */}
      <pre
        className={`bn-file-content-pre${path ? '' : ' is-hidden'}`}
        data-language={language}
        ref={contentRef}
        spellCheck={false}
      />
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
  }
);
