import { useEffect, useState, useCallback, useRef, useMemo, type ChangeEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BlockNoteViewRaw, useCreateBlockNote, ComponentsContext, SuggestionMenuController, FormattingToolbar, FormattingToolbarController, BasicTextStyleButton, ColorStyleButton, CreateLinkButton, BlockTypeSelect, FilePanelController, useBlockNoteEditor, useEditorState, useComponentsContext } from '@blocknote/react';
import { CellSelection, TableMap, addColumnBefore, addColumnAfter, deleteColumn, addRowBefore, addRowAfter, deleteRow, toggleHeader } from 'prosemirror-tables';
import { Fragment as PMFragment } from 'prosemirror-model';
import CustomLinkToolbar from './CustomLinkToolbar';
import TableCellMenu from './TableCellMenu';
import LinkPreviewCard from './LinkPreviewCard';
import { BlockNoteSchema, defaultBlockSpecs, createCodeBlockSpec, blockToNode } from '@blocknote/core';
import { getDefaultReactSlashMenuItems } from '@blocknote/react';
import { zh } from '@blocknote/core/locales';
import '@blocknote/react/style.css';
import { markdownToBlocks, blocksToMarkdown } from '../../utils/markdown';
import { blockNoteComponents, setBlockSelection, getSelectedBlockIds, isDragMenuOpen, setSyntheticDragHandleTarget, GROUP_ORDER, ColorListContent, findBlockDeep, SLASH_MENU_ENGLISH } from './BlockNoteComponents';
import { removeBlocksEnhanced } from './blockHelpers';
import { PageReferenceBlockSpec } from './PageReferenceBlock';
import { TextSelection, NodeSelection } from '@tiptap/pm/state';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension } from '@tiptap/core';
import { addPendingRestore, removePendingRestore, setSubpageUndoAction, getSubpageUndoAction, clearSubpageUndoAction, writeAkmdClipboard, readAkmdClipboard, type ClipboardPayload } from './blockClipboardState';
import { BookmarkBlockSpec } from './BookmarkBlock';
import { SubpageBlockSpec } from './SubpageBlock';
import { ColumnListBlockSpec, ColumnBlockSpec, redistributeColumnRatios, redistributeColumnRatiosFromWidths, updateColumnListRatios } from './ColumnListBlock';
import { MarkBlockSpec } from './MarkBlock';
import { FileContentBlockSpec } from './FileContentBlock';
import { SyncedBlockSourceSpec, SyncedBlockMirrorSpec, flushPendingSyncedBlockSaves, isPageChangeSuppressed } from './SyncedBlock';
import { SyncedBlockPasteDialog } from './SyncedBlockPasteDialog';
import { SyncedBlockDeleteDialog } from './SyncedBlockDeleteDialog';
import { createFileContentHighlightExtension } from './FileContentHighlightExtension';
import LinkPasteMenu from './LinkPasteMenu';
import CodeBlockToolbar from './CodeBlockToolbar';
import { FindReplaceExtension } from './FindReplaceExtension';
import FindReplacePanel from './FindReplacePanel';
import './findReplace.css';
import { getBlockDragData, markDragHandled } from './blockDragState';
import { pageMetaCache } from './PageMetaCache';
import { mentionMetaCache } from './MentionMetaCache';
import { pagesApi } from '../../api/pages';
import { syncedBlocksApi } from '../../api/syncedBlocks';
import { uploadApi } from '../../api/upload';
import { writeSpaceFile } from '../../api/files';
import { createMirror } from '../../services/mirrorStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useEditorFlushStore } from '../../stores/editorFlushStore';
import { flushSync } from '../../services/syncModule';
import { clearHeaderHandleLock, getHeaderHandleLock, isHeaderMenuOpen, setHeaderHandleLock, setHeaderMenuOpen } from './tableHandleState';
import { showToast } from '../Toast';
import { getCodeThemeRegistration, normalizeCodeTheme, type CodeThemeValue } from '../../utils/codeTheme';
import { normalizeInternalPageLink, parseInternalPageLink } from '../../utils/internalLinks';

// Supported languages for code block syntax highlighting
// Keys must match Shiki bundled language IDs (https://shiki.style/languages)
const SUPPORTED_LANGUAGES: Record<string, { name: string; aliases?: string[] }> = {
  text: { name: '纯文本' },
  bash: { name: 'Bash', aliases: ['sh', 'shell', 'zsh'] },
  c: { name: 'C' },
  cpp: { name: 'C++', aliases: ['c++'] },
  csharp: { name: 'C#', aliases: ['c#', 'cs'] },
  css: { name: 'CSS' },
  dart: { name: 'Dart' },
  diff: { name: 'Diff' },
  docker: { name: 'Dockerfile', aliases: ['dockerfile'] },
  go: { name: 'Go', aliases: ['golang'] },
  graphql: { name: 'GraphQL' },
  html: { name: 'HTML' },
  java: { name: 'Java' },
  javascript: { name: 'JavaScript', aliases: ['js'] },
  json: { name: 'JSON' },
  kotlin: { name: 'Kotlin', aliases: ['kt'] },
  latex: { name: 'LaTeX', aliases: ['tex'] },
  lua: { name: 'Lua' },
  make: { name: 'Makefile' },
  markdown: { name: 'Markdown', aliases: ['md'] },
  matlab: { name: 'MATLAB' },
  'objective-c': { name: 'Objective-C', aliases: ['objc', 'objectivec'] },
  perl: { name: 'Perl' },
  php: { name: 'PHP' },
  powershell: { name: 'PowerShell', aliases: ['ps1'] },
  python: { name: 'Python', aliases: ['py'] },
  r: { name: 'R' },
  ruby: { name: 'Ruby', aliases: ['rb'] },
  rust: { name: 'Rust', aliases: ['rs'] },
  scala: { name: 'Scala' },
  sql: { name: 'SQL' },
  swift: { name: 'Swift' },
  toml: { name: 'TOML' },
  typescript: { name: 'TypeScript', aliases: ['ts'] },
  xml: { name: 'XML' },
  yaml: { name: 'YAML', aliases: ['yml'] },
};

// Shiki language IDs used for loading (exclude 'text' which has no highlighter)
const SHIKI_LANG_IDS = Object.keys(SUPPORTED_LANGUAGES).filter((l) => l !== 'text');

function createCodeBlockSpecWithHighlight(codeTheme: CodeThemeValue) {
  const themeRegistration = getCodeThemeRegistration(codeTheme);
  return createCodeBlockSpec({
    defaultLanguage: 'text',
    supportedLanguages: SUPPORTED_LANGUAGES,
    createHighlighter: async () => {
      const { createHighlighter: createShikiHighlighter } = await import('shiki');
      return createShikiHighlighter({
        themes: [themeRegistration],
        langs: SHIKI_LANG_IDS,
      });
    },
  });
}

function createEditorSchema(codeTheme: CodeThemeValue) {
  const codeBlockSpec = createCodeBlockSpecWithHighlight(codeTheme);
  return BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      codeBlock: codeBlockSpec as any,
      pageReference: PageReferenceBlockSpec(),
      bookmark: BookmarkBlockSpec(),
      mark: MarkBlockSpec(),
      subpage: SubpageBlockSpec(),
      column_list: ColumnListBlockSpec(),
      column: ColumnBlockSpec(),
      fileContent: FileContentBlockSpec(),
      syncedBlockSource: SyncedBlockSourceSpec(),
      syncedBlockMirror: SyncedBlockMirrorSpec(),
    },
  });
}

const URL_RE = /^https?:\/\/.+/;

function newSyncId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function flattenBlocks(blocks: any[]): any[] {
  const out: any[] = [];
  for (const block of blocks || []) {
    out.push(block);
    if (block.children?.length) out.push(...flattenBlocks(block.children));
  }
  return out;
}

function findBlockPath(blocks: any[], blockId: string, path: any[] = []): any[] | null {
  for (const block of blocks || []) {
    const nextPath = [...path, block];
    if (block.id === blockId) return nextPath;
    if (block.children?.length) {
      const childPath = findBlockPath(block.children, blockId, nextPath);
      if (childPath) return childPath;
    }
  }
  return null;
}

function isEmptyTextBlock(block: any): boolean {
  const content = block?.content;
  return !content || (Array.isArray(content) && content.length === 0);
}

function getSyncedBlockChildDeleteTarget(blocks: any[], blockId: string) {
  const path = findBlockPath(blocks, blockId);
  if (!path || path.length < 2) return null;
  const parent = path[path.length - 2];
  if (parent?.type !== 'syncedBlockSource' && parent?.type !== 'syncedBlockMirror') return null;
  const siblings = Array.isArray(parent.children) ? parent.children : [];
  const index = siblings.findIndex((block: any) => block.id === blockId);
  if (index < 0) return null;
  const focusBlock = siblings[index - 1] || siblings[index + 1] || null;
  return { parent, block: path[path.length - 1], focusBlock };
}

function getSyncedBlockChildEnterTarget(blocks: any[], blockId: string) {
  const path = findBlockPath(blocks, blockId);
  if (!path || path.length < 2) return null;
  const parent = path[path.length - 2];
  if (parent?.type !== 'syncedBlockSource' && parent?.type !== 'syncedBlockMirror') return null;
  return { parent, block: path[path.length - 1] };
}

function blocksForIds(editor: any, ids: string[]): any[] {
  const idSet = new Set(ids);
  return flattenBlocks(editor.document).filter((block) => idSet.has(block.id));
}

function hasSyncedBlock(blocks: any[]): boolean {
  return flattenBlocks(blocks).some((block) => block.type === 'syncedBlockSource' || block.type === 'syncedBlockMirror');
}

async function flushSyncedBlockMirrorsFromDocument(blocks: any[], spaceSlug: string, pageId: string) {
  if (!spaceSlug) return;

  const mirrorsBySource = new Map<string, { sourcePageId: string; sourceBlockId: string; markdown: string; quotes: Map<string, { pageId: string; syncId: string }> }>();

  for (const block of flattenBlocks(blocks)) {
    if (block.type !== 'syncedBlockMirror') continue;

    const sourcePageId = String(block.props?.sourcePageId || '');
    const sourceBlockId = String(block.props?.sourceBlockId || '');
    const syncId = String(block.props?.syncId || '');
    if (!sourcePageId || !sourceBlockId) continue;
    if (block.props?.syncLoaded !== 'true') continue;
    if (block.props?.syncBroken === 'true') continue;
    if (!Array.isArray(block.children)) continue;

    const key = `${sourcePageId}:${sourceBlockId}`;
    const quotes = mirrorsBySource.get(key)?.quotes || new Map<string, { pageId: string; syncId: string }>();
    if (pageId && syncId) {
      quotes.set(`${pageId}:${syncId}`, { pageId, syncId });
    }

    mirrorsBySource.set(key, {
      sourcePageId,
      sourceBlockId,
      markdown: blocksToMarkdown((block.children || []) as any[]),
      quotes,
    });
  }

  for (const mirror of mirrorsBySource.values()) {
    try {
      await syncedBlocksApi.update(spaceSlug, mirror.sourcePageId, mirror.sourceBlockId, {
        markdown: mirror.markdown,
        addQuoted: Array.from(mirror.quotes.values()),
      });
    } catch (err: any) {
      if (err?.response?.status === 404) continue;
      throw err;
    }
  }
}

async function flushAllSyncedBlockSaves(blocks: any[], spaceSlug: string, pageId: string) {
  await flushPendingSyncedBlockSaves();
  await flushSyncedBlockMirrorsFromDocument(blocks, spaceSlug, pageId);
}

type SyncedMirrorRegistration = {
  sourcePageId: string;
  sourceBlockId: string;
  pageId: string;
  syncId: string;
};

function createSyncedMirrorBlock(sourcePageId: string, sourceBlockId: string, pageId: string): { block: any; registration: SyncedMirrorRegistration } | null {
  if (!sourcePageId || !sourceBlockId || !pageId) return null;
  const syncId = newSyncId();
  return {
    block: {
      type: 'syncedBlockMirror',
      props: {
        syncId,
        sourcePageId,
        sourceBlockId,
        pageId,
      },
    },
    registration: {
      sourcePageId,
      sourceBlockId,
      pageId,
      syncId,
    },
  };
}

function prepareCopiedBlocksForPaste(
  blocks: any[],
  sourcePageId: string,
  targetPageId: string,
): { blocks: any[]; mirrorRegistrations: SyncedMirrorRegistration[] } {
  const mirrorRegistrations: SyncedMirrorRegistration[] = [];

  const visit = (block: any): any => {
    if (block?.type === 'syncedBlockSource') {
      const mirror = createSyncedMirrorBlock(sourcePageId, String(block.props?.syncId || ''), targetPageId);
      if (mirror) {
        mirrorRegistrations.push(mirror.registration);
        return mirror.block;
      }
    }

    if (block?.type === 'syncedBlockMirror') {
      const mirror = createSyncedMirrorBlock(
        String(block.props?.sourcePageId || ''),
        String(block.props?.sourceBlockId || ''),
        targetPageId,
      );
      if (mirror) {
        mirrorRegistrations.push(mirror.registration);
        return mirror.block;
      }
    }

    const next = { ...block };
    if (Array.isArray(block?.children)) {
      next.children = block.children.map(visit);
    }
    return next;
  };

  return { blocks: blocks.map(visit), mirrorRegistrations };
}

async function registerSyncedMirrorQuotes(spaceSlug: string, registrations: SyncedMirrorRegistration[]) {
  for (const registration of registrations) {
    const source = await syncedBlocksApi.get(spaceSlug, registration.sourcePageId, registration.sourceBlockId);
    await syncedBlocksApi.update(spaceSlug, registration.sourcePageId, registration.sourceBlockId, {
      markdown: source.markdown,
      addQuoted: [{ pageId: registration.pageId, syncId: registration.syncId }],
    });
  }
}

function parseQuotedCount(block: any): number {
  try {
    const quoted = JSON.parse(block?.props?.quoted || '[]');
    return Array.isArray(quoted) ? quoted.length : 0;
  } catch {
    return 0;
  }
}

function getDomSelectedBlockIds(container: HTMLElement): string[] {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  const ids: string[] = [];
  const seen = new Set<string>();
  const forcedSyncedBlockIds = new Set<string>();
  container.querySelectorAll('.bn-block-outer').forEach((outer) => {
    if (!range.intersectsNode(outer)) return;
    const blockEl = outer.querySelector('[data-id]');
    const id = blockEl?.getAttribute('data-id') || '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
    const syncRenderer = outer.querySelector(
      ':scope > .bn-block > .react-renderer.node-syncedBlockSource, :scope > .bn-block > .react-renderer.node-syncedBlockMirror'
    );
    if (syncRenderer && range.intersectsNode(syncRenderer)) {
      forcedSyncedBlockIds.add(id);
    }
  });
  return normalizeSyncedBlockSelection(ids, container, forcedSyncedBlockIds);
}

function getCopyCandidateIds(container: HTMLElement, editor: any): string[] {
  const selected = getSelectedBlockIds();
  if (selected.length > 0) return normalizeSyncedBlockSelection(selected, container);
  const domIds = getDomSelectedBlockIds(container);
  if (domIds.length > 0) return normalizeSyncedBlockSelection(domIds, container);
  const bnSelection = editor.getSelection?.();
  const bnIds = bnSelection?.blocks?.map((b: any) => b.id).filter(Boolean) || [];
  return normalizeSyncedBlockSelection(bnIds, container);
}

function getDirectBlockId(outer: Element | null): string | null {
  const block = outer?.querySelector(':scope > .bn-block[data-id]');
  return block?.getAttribute('data-id') || null;
}

function getSelectedDescendantIds(containerOuter: Element): string[] {
  return Array.from(containerOuter.querySelectorAll(':scope > .bn-block > .bn-block-group .bn-block-outer'))
    .map((childOuter) => getDirectBlockId(childOuter))
    .filter((id): id is string => !!id);
}

function getBlockOuterById(container: HTMLElement, blockId: string): Element | null {
  return container.querySelector(`.bn-block[data-id="${CSS.escape(blockId)}"]`)?.closest('.bn-block-outer') || null;
}

function isSyncedBlockOuterActive(syncOuter: Element): boolean {
  return !!syncOuter.querySelector(
    '.react-renderer.node-syncedBlockSource[data-sync-source-active="true"], .react-renderer.node-syncedBlockMirror[data-sync-source-active="true"]'
  );
}

function normalizeSyncedBlockSelection(
  ids: string[],
  container: HTMLElement,
  forcedSyncedBlockIds: Set<string> = new Set(),
): string[] {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 1) {
    const blockOuter = getBlockOuterById(container, uniqueIds[0]);
    const syncOuter = blockOuter?.closest(
      '.bn-block-outer:has(> .bn-block > .react-renderer.node-syncedBlockSource), .bn-block-outer:has(> .bn-block > .react-renderer.node-syncedBlockMirror)'
    );
    if (
      syncOuter &&
      blockOuter &&
      syncOuter !== blockOuter
    ) {
      // broken mirror（源已消失）的提示内容无法单独删除，选中其内部时归一化为删整个 mirror。
      // 其他情况保持 active 检查（光标在 source/正常 mirror 内时允许编辑内部内容）。
      const isBrokenMirror = !!syncOuter.querySelector('.bn-synced-block-mirror.is-broken');
      if (isBrokenMirror || !isSyncedBlockOuterActive(syncOuter)) {
        const syncId = getDirectBlockId(syncOuter);
        if (syncId) return [syncId];
      }
    }
    return uniqueIds;
  }

  const selected = new Set(uniqueIds);
  const syncOuters = Array.from(
    container.querySelectorAll([
      '.bn-block-outer:has(> .bn-block > .react-renderer.node-syncedBlockSource)',
      '.bn-block-outer:has(> .bn-block > .react-renderer.node-syncedBlockMirror)',
    ].join(', '))
  );

  for (const syncOuter of syncOuters) {
    const syncId = getDirectBlockId(syncOuter);
    if (!syncId) continue;

    const descendantIds = getSelectedDescendantIds(syncOuter);
    const selectedDescendantIds = descendantIds.filter((id) => selected.has(id));
    if (selectedDescendantIds.length === 0) continue;

    const descendantIdSet = new Set(descendantIds);
    const hasSelectionOutsideThisSync = Array.from(selected).some(
      (id) => id !== syncId && !descendantIdSet.has(id)
    );

    const isBrokenMirror = !!syncOuter.querySelector('.bn-synced-block-mirror.is-broken');
    // broken mirror 的提示内容无法单独删除，选中其内部 subblock 时提升为整个 mirror。
    if (forcedSyncedBlockIds.has(syncId) || hasSelectionOutsideThisSync || isBrokenMirror) {
      selected.add(syncId);
      for (const id of selectedDescendantIds) selected.delete(id);
    } else {
      selected.delete(syncId);
    }
  }

  return uniqueIds.filter((id) => selected.has(id));
}

function resolvePageAssetUrl(rawUrl: string | undefined, spaceSlug?: string, pageId?: string): string {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  if (
    url.startsWith('/api/') ||
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('blob:') ||
    url.startsWith('data:')
  ) {
    return url;
  }
  if (!spaceSlug || !pageId) return url;

  let assetPath = url;
  if (assetPath.startsWith('./_assets/')) {
    assetPath = assetPath.slice('./_assets/'.length);
  } else if (assetPath.startsWith('_assets/')) {
    assetPath = assetPath.slice('_assets/'.length);
  } else if (assetPath.startsWith('/_assets/')) {
    assetPath = assetPath.slice('/_assets/'.length);
  } else if (assetPath.startsWith('/')) {
    return assetPath;
  }

  return `/api/spaces/${spaceSlug}/pages/${pageId}/assets/${assetPath}`;
}

function createDefaultInternalPageIcon() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'mention-badge-page-icon');

  const paths = [
    'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
    'M14 2v4a2 2 0 0 0 2 2h4',
    'M10 9H8',
    'M16 13H8',
    'M16 17H8',
  ];

  paths.forEach((d) => {
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  });

  return svg;
}

// Override zh dictionary: reorganize groups + rename toggle headings
const customZh = {
  ...zh,
  slash_menu: {
    ...zh.slash_menu,
    heading: { ...zh.slash_menu.heading, group: '基础区块', title: '标题 1' },
    heading_2: { ...zh.slash_menu.heading_2, group: '基础区块', title: '标题 2' },
    heading_3: { ...zh.slash_menu.heading_3, group: '基础区块', title: '标题 3' },
    heading_4: { ...zh.slash_menu.heading_4, group: '基础区块', title: '标题 4' },
    toggle_heading: { ...zh.slash_menu.toggle_heading, group: '基础区块', title: '折叠标题 1' },
    toggle_heading_2: { ...zh.slash_menu.toggle_heading_2, group: '基础区块', title: '折叠标题 2' },
    toggle_heading_3: { ...zh.slash_menu.toggle_heading_3, group: '基础区块', title: '折叠标题 3' },
    quote: { ...zh.slash_menu.quote, group: '高级区块' },
    code_block: { ...zh.slash_menu.code_block, group: '高级区块' },
    divider: { ...zh.slash_menu.divider, group: '高级区块' },
    table: { ...zh.slash_menu.table, group: '高级区块' },
    toggle_list: { ...zh.slash_menu.toggle_list, group: '列表' },
    numbered_list: { ...zh.slash_menu.numbered_list, group: '列表' },
    bullet_list: { ...zh.slash_menu.bullet_list, group: '列表' },
    check_list: { ...zh.slash_menu.check_list, group: '列表' },
    paragraph: { ...zh.slash_menu.paragraph, group: '基础区块' },
  },
};

// Notion SVG paths for heading icons (viewBox 0 0 20 20, same as Turn Into menu)
const NOTION_HEADING_PATHS: Record<number, string> = {
  1: 'M4.1 4.825a.625.625 0 0 0-1.25 0v10.35a.625.625 0 0 0 1.25 0V10.4h6.4v4.775a.625.625 0 0 0 1.25 0V4.825a.625.625 0 1 0-1.25 0V9.15H4.1zM17.074 8.45a.6.6 0 0 1 .073.362q.003.03.003.063v6.3a.625.625 0 1 1-1.25 0V9.802l-1.55.846a.625.625 0 1 1-.6-1.098l2.476-1.35a.625.625 0 0 1 .848.25',
  2: 'M3.65 4.825a.625.625 0 1 0-1.25 0v10.35a.625.625 0 0 0 1.25 0V10.4h6.4v4.775a.625.625 0 0 0 1.25 0V4.825a.625.625 0 1 0-1.25 0V9.15h-6.4zm10.104 5.164c.19-.457.722-.84 1.394-.84.89 0 1.48.627 1.48 1.238 0 .271-.104.53-.302.746l-3.837 3.585a.625.625 0 0 0 .427 1.082h4.5a.625.625 0 1 0 0-1.25H14.5l2.695-2.518.027-.028c.406-.43.657-.994.657-1.617 0-1.44-1.299-2.488-2.731-2.488-1.128 0-2.145.643-2.548 1.608a.625.625 0 0 0 1.154.482',
  3: 'M2.877 4.2c.346 0 .625.28.625.625V9.15h6.4V4.825a.625.625 0 0 1 1.25 0v10.35a.625.625 0 0 1-1.25 0V10.4h-6.4v4.775a.625.625 0 0 1-1.25 0V4.825c0-.345.28-.625.625-.625M14.93 9.37c-.692 0-1.183.34-1.341.671a.625.625 0 1 1-1.128-.539c.416-.87 1.422-1.382 2.47-1.382.686 0 1.33.212 1.818.584.487.373.843.932.843 1.598 0 .629-.316 1.162-.76 1.533l.024.018c.515.389.892.972.892 1.669 0 .696-.377 1.28-.892 1.668s-1.198.61-1.926.61c-1.1 0-2.143-.514-2.599-1.389a.625.625 0 0 1 1.109-.578c.187.36.728.717 1.49.717.482 0 .895-.148 1.174-.358s.394-.453.394-.67-.116-.46-.394-.67c-.28-.21-.692-.358-1.174-.358h-.461a.625.625 0 0 1 0-1.25h.357a1 1 0 0 1 .104-.01c.437 0 .81-.135 1.06-.326s.351-.41.351-.605-.101-.415-.351-.606-.623-.327-1.06-.327',
  4: 'M15.43 8.22c.663-.622 1.779-.162 1.779.776v3.644h.513a.625.625 0 0 1 0 1.25h-.513v1.329a.625.625 0 0 1-1.25 0v-1.33H12.75a.625.625 0 0 1-.625-.624v-.008a.55.55 0 0 1 .092-.347l3.072-4.524.01-.015.027-.039.02-.025.02-.026.012-.011zm-1.7 4.42h2.229V9.357zM10.527 4.2c.345 0 .625.28.625.625v4.94l.001.01v5.4a.626.626 0 0 1-1.25 0V10.4h-6.4v4.775a.626.626 0 0 1-1.251 0V4.825a.626.626 0 0 1 1.25 0V9.15h6.4V4.825c0-.345.28-.625.625-.625',
};

// Notion SVG paths for toggle heading icons (viewBox 0 0 20 20)
const NOTION_TOGGLE_HEADING_PATHS: Record<number, string> = {
  1: 'M7.085 5.4a.577.577 0 1 0-1.154 0v9.2a.577.577 0 1 0 1.154 0v-4.223h5.646V14.6a.577.577 0 1 0 1.154 0V5.4a.577.577 0 0 0-1.154 0v3.823H7.085zm11.506 3.225a.55.55 0 0 1 .064.32l.003.055v5.6a.55.55 0 1 1-1.1 0V9.815l-1.386.756a.55.55 0 1 1-.527-.966l2.2-1.2a.55.55 0 0 1 .746.22M.961 11.14c0 .455.496.735.886.502l1.9-1.14a.585.585 0 0 0 0-1.003l-1.9-1.14a.585.585 0 0 0-.886.5z',
  2: 'M7.085 5.4a.577.577 0 0 0-1.154 0v9.2a.577.577 0 1 0 1.154 0v-4.223h5.646V14.6a.577.577 0 1 0 1.154 0V5.4a.577.577 0 0 0-1.154 0v3.823H7.085zm8.955 4.588c.17-.409.645-.75 1.244-.75.793 0 1.322.559 1.322 1.106a.98.98 0 0 1-.271.667l-3.41 3.187a.55.55 0 0 0 .375.952h4a.55.55 0 1 0 0-1.1h-2.606l2.406-2.248.024-.024a2.08 2.08 0 0 0 .582-1.434c0-1.277-1.151-2.206-2.422-2.206-1 0-1.902.57-2.26 1.426a.55.55 0 1 0 1.016.424M.961 11.14c0 .455.496.735.886.502l1.9-1.14a.585.585 0 0 0 0-1.003l-1.9-1.14a.585.585 0 0 0-.886.5z',
  3: 'M6.508 4.823c.318 0 .577.258.577.577v3.823h5.645V5.4a.577.577 0 0 1 1.154 0v9.2a.577.577 0 1 1-1.154 0v-4.223H7.086V14.6a.577.577 0 1 1-1.154 0V5.4c0-.319.258-.577.577-.577m10.775 4.415c-.644 0-1.105.316-1.256.631a.55.55 0 1 1-.992-.474c.377-.79 1.292-1.257 2.248-1.257.626 0 1.214.193 1.657.532s.765.846.765 1.45c0 .58-.297 1.072-.715 1.41l.05.036c.468.353.81.883.81 1.514 0 .63-.342 1.16-.81 1.514-.47.354-1.093.556-1.757.556-1.005 0-1.953-.47-2.368-1.264a.55.55 0 1 1 .976-.508c.178.341.685.672 1.392.672.448 0 .833-.138 1.094-.334.26-.197.372-.427.372-.636s-.111-.44-.372-.636c-.26-.196-.646-.334-1.094-.334h-.424a.55.55 0 0 1 0-1.1h.33a1 1 0 0 1 .094-.008c.406 0 .754-.127.989-.306.234-.18.333-.388.333-.576s-.099-.397-.333-.576c-.235-.18-.583-.306-.99-.306M.962 11.14c0 .455.495.735.885.502l1.9-1.14a.585.585 0 0 0 0-1.003l-1.9-1.14a.585.585 0 0 0-.885.5z',
  4: 'M7.085 5.4a.577.577 0 0 0-1.154 0v9.2a.577.577 0 1 0 1.154 0v-4.223h5.646V14.6a.577.577 0 1 0 1.154 0V5.4a.577.577 0 0 0-1.154 0v3.823H7.085zm8.955 4.588c.17-.409.645-.75 1.244-.75.793 0 1.322.559 1.322 1.106a.98.98 0 0 1-.271.667l-3.41 3.187a.55.55 0 0 0 .375.952h4a.55.55 0 1 0 0-1.1h-2.606l2.406-2.248.024-.024a2.08 2.08 0 0 0 .582-1.434c0-1.277-1.151-2.206-2.422-2.206-1 0-1.902.57-2.26 1.426a.55.55 0 1 0 1.016.424M.961 11.14c0 .455.496.735.886.502l1.9-1.14a.585.585 0 0 0 0-1.003l-1.9-1.14a.585.585 0 0 0-.886.5z',
};

// Notion heading icon — uses exact Notion SVG paths (viewBox 0 0 20 20)
// 渲染尺寸 18px，与 BlockNote 默认 slash menu 图标 (react-icons size:18) 一致
function NotionHeadingIcon({ level }: { level: number }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
      <path d={NOTION_HEADING_PATHS[level]} />
    </svg>
  );
}

// Notion toggle heading icon — uses exact Notion SVG paths (viewBox 0 0 20 20)
// 渲染尺寸 18px，与 BlockNote 默认 slash menu 图标 (react-icons size:18) 一致
function NotionToggleHeadingIcon({ level }: { level: number }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
      <path d={NOTION_TOGGLE_HEADING_PATHS[level]} />
    </svg>
  );
}

// Custom slash menu: default items filtered + subpage + toggle heading 4
// Desired order for 基础区块: paragraph → heading → heading_2 → heading_3 → heading_4 → toggle_heading → toggle_heading_2 → toggle_heading_3 → toggle_heading_4(custom)
const BASE_BLOCK_ORDER: Record<string, number> = {
  paragraph: 0,
  heading: 1,
  heading_2: 2,
  heading_3: 3,
  heading_4: 4,
  toggle_heading: 5,
  toggle_heading_2: 6,
  toggle_heading_3: 7,
  toggle_heading_4: 8,
};

function getCustomSlashMenuItems(editor: any) {
  const defaults = getDefaultReactSlashMenuItems(editor);
  // Remove heading_5, heading_6 from defaults
  const filtered = defaults.filter((item: any) =>
    item.key !== 'heading_5' && item.key !== 'heading_6'
  );
  // Override heading icons with Notion SVG paths
  const headingLevels: Record<string, number> = {
    heading: 1,
    heading_2: 2,
    heading_3: 3,
    heading_4: 4,
  };
  const toggleHeadingLevels: Record<string, number> = {
    toggle_heading: 1,
    toggle_heading_2: 2,
    toggle_heading_3: 3,
  };
  for (const item of filtered) {
    const hLevel = headingLevels[(item as any).key];
    if (hLevel !== undefined) {
      (item as any).icon = <NotionHeadingIcon level={hLevel} />;
    }
    const tLevel = toggleHeadingLevels[(item as any).key];
    if (tLevel !== undefined) {
      (item as any).icon = <NotionToggleHeadingIcon level={tLevel} />;
    }
  }
  // Sort 基础区块 items to: paragraph → heading → heading_2 → heading_3 → heading_4 → toggle_heading → ...
  // Comparator must be total/consistent: items not in BASE_BLOCK_ORDER are treated as Infinity
  // so they sort after all ordered items, preserving their original relative order (stable sort).
  filtered.sort((a: any, b: any) => {
    const aOrder = BASE_BLOCK_ORDER[a.key];
    const bOrder = BASE_BLOCK_ORDER[b.key];
    if (aOrder === undefined && bOrder === undefined) return 0;
    if (aOrder === undefined) return 1;
    if (bOrder === undefined) return -1;
    return aOrder - bOrder;
  });
  const allItems = [
    ...filtered,
    {
      title: '折叠标题 4',
      subtext: '可折叠的四级标题',
      key: 'toggle_heading_4',
      aliases: ['toggle_heading_4', 'toggle4'],
      group: '基础区块',
      icon: <NotionToggleHeadingIcon level={4} />,
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
      title: '强调',
      subtext: '带颜色边条和背景的强调块',
      key: 'mark',
      aliases: ['mark', '强调'],
      group: '高级区块',
      icon: <svg viewBox="0 0 18 18" style={{ width: '18px', height: '18px', fill: 'none', overflow: 'visible' }}><rect x="2" y="2" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.25" /><path d="M4.75 3.5v11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M7.5 6.5h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /><path d="M7.5 9.5h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>,
      onItemClick: () => {
        const currentBlock = editor.getTextCursorPosition().block;
        if (currentBlock.content === undefined) return;
        const blockContent = currentBlock.content;
        const isSlashOnly = Array.isArray(blockContent) && blockContent.length === 1 &&
          blockContent[0].type === 'text' && blockContent[0].text === '/';
        const isEmpty = Array.isArray(blockContent) && blockContent.length === 0;
        if (isSlashOnly || isEmpty) {
          editor.updateBlock(currentBlock, { type: 'mark', props: { color: 'blue' } });
        } else {
          editor.insertBlocks([{ type: 'mark', props: { color: 'blue' } }], currentBlock, 'after');
        }
        const nextBlock = editor.getTextCursorPosition().nextBlock;
        if (nextBlock) editor.setTextCursorPosition(nextBlock, 'end');
      },
    },
    {
      title: '同步块',
      subtext: '创建可被其他页面引用的同步内容',
      key: 'syncedBlockSource',
      aliases: ['sync', 'synced', '同步块', '同步'],
      group: '高级区块',
      icon: <svg viewBox="0 0 18 18" style={{ width: '18px', height: '18px', fill: 'none', stroke: 'currentColor', strokeWidth: 1.45 }}><path d="M5.2 6.2h6.4a3 3 0 0 1 0 6H10" /><path d="M12.8 11.8H6.4a3 3 0 0 1 0-6H8" /><path d="M7 3.8 8.8 5.6 7 7.4" /><path d="M11 10.6 9.2 12.4 11 14.2" /></svg>,
      onItemClick: () => {
        const currentBlock = editor.getTextCursorPosition().block;
        const blockContent = currentBlock.content;
        const isSlashOnly = Array.isArray(blockContent) && blockContent.length === 1 &&
          blockContent[0].type === 'text' && blockContent[0].text === '/';
        const isEmpty = Array.isArray(blockContent) && blockContent.length === 0;
        const newBlock = {
          type: 'syncedBlockSource',
          props: { syncId: newSyncId(), quoted: '[]' },
          children: [{ type: 'paragraph', content: [{ type: 'text', text: '', styles: {} }] }],
        };
        if (isSlashOnly || isEmpty) {
          editor.replaceBlocks([currentBlock], [newBlock as any]);
        } else {
          editor.insertBlocks([newBlock as any], currentBlock, 'after');
        }
      },
    },
    {
      title: '同步块引用',
      subtext: '引用其他页面的同步块',
      key: 'syncedBlockMirror',
      aliases: ['sync ref', 'synced ref', '同步引用'],
      group: '高级区块',
      icon: <svg viewBox="0 0 18 18" style={{ width: '18px', height: '18px', fill: 'none', stroke: 'currentColor', strokeWidth: 1.45 }}><path d="M4.5 4.2h6.5a2.5 2.5 0 0 1 0 5H9.5" /><path d="M13.5 13.8H7a2.5 2.5 0 0 1 0-5h1.5" /><path d="M12.5 2.8h2.8v2.8" /><path d="m15.2 2.9-4.4 4.4" /></svg>,
      onItemClick: () => {
        const sourcePageId = window.prompt('源页面 ID');
        if (!sourcePageId) return;
        const sourceBlockId = window.prompt('源同步块 ID');
        if (!sourceBlockId) return;
        const currentBlock = editor.getTextCursorPosition().block;
        const blockContent = currentBlock.content;
        const isSlashOnly = Array.isArray(blockContent) && blockContent.length === 1 &&
          blockContent[0].type === 'text' && blockContent[0].text === '/';
        const isEmpty = Array.isArray(blockContent) && blockContent.length === 0;
        const newBlock = {
          type: 'syncedBlockMirror',
          props: { syncId: newSyncId(), sourcePageId, sourceBlockId },
        };
        if (isSlashOnly || isEmpty) {
          editor.updateBlock(currentBlock, newBlock as any);
        } else {
          editor.insertBlocks([newBlock as any], currentBlock, 'after');
        }
      },
    },
    {
      title: '子页面',
      subtext: '创建并链接到子页面',
      key: 'subpage',
      aliases: ['subpage', 'page', '子页面', '页面'],
      group: '高级区块',
      icon: <svg viewBox="0 0 18 18" style={{ width: '18px', height: '18px', fill: 'currentColor', overflow: 'visible' }}><g transform="translate(3.64 0.61) scale(1.1) translate(-4.125 -2.375)"><path d="M13.3 14.25a.55.55 0 0 1-.55.55h-5.5a.55.55 0 1 1 0-1.1h5.5a.55.55 0 0 1 .55.55m-.55-1.95a.55.55 0 1 0 0-1.1h-5.5a.55.55 0 0 0 0 1.1z" /><path d="M6.25 2.375A2.125 2.125 0 0 0 4.125 4.5v11c0 1.174.951 2.125 2.125 2.125h7.5a2.125 2.125 0 0 0 2.125-2.125V8.121c0-.563-.224-1.104-.622-1.502L11.63 2.997a2.13 2.13 0 0 0-1.502-.622zM5.375 4.5c0-.483.392-.875.875-.875h3.7V6.25A2.05 2.05 0 0 0 12 8.3h2.625v7.2a.875.875 0 0 1-.875.875h-7.5a.875.875 0 0 1-.875-.875zm8.691 2.7H12a.95.95 0 0 1-.95-.95V4.184z" /></g></svg>,
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
    {
      title: '文件内容',
      subtext: '引用 space 共享文件并以代码块展示',
      key: 'fileContent',
      aliases: ['fileContent', 'file', '文件', '文件内容'],
      group: '高级区块',
      icon: <svg viewBox="0 0 18 18" style={{ width: '18px', height: '18px', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }}><path d="M4 2.5h6l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" /><path d="M10 2.5v4h4" /><path d="M6 10h6M6 12.5h6" strokeLinecap="round" /></svg>,
      onItemClick: () => {
        const currentBlock = editor.getTextCursorPosition().block;
        const blockContent = currentBlock.content;
        const isSlashOnly = Array.isArray(blockContent) && blockContent.length === 1 &&
          blockContent[0].type === 'text' && blockContent[0].text === '/';
        const isEmpty = Array.isArray(blockContent) && blockContent.length === 0;
        const newBlock = {
          type: 'fileContent',
          props: { path: '', language: 'text' },
          content: [{ type: 'text', text: '', styles: {} }],
        };
        if (isSlashOnly || isEmpty) {
          editor.updateBlock(currentBlock, newBlock as any);
        } else {
          editor.insertBlocks([newBlock as any], currentBlock, 'after');
        }
      },
    },
    {
      title: '多列布局',
      subtext: '创建多列排版布局',
      key: 'columns',
      aliases: ['columns', 'column', '多列', '分栏'],
      group: '高级区块',
      icon: <svg viewBox="0 0 18 18" style={{ width: '18px', height: '18px', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }}><rect x="2" y="2" width="6.25" height="14" rx="1.5" /><rect x="9.75" y="2" width="6.25" height="14" rx="1.5" /></svg>,
      onItemClick: () => {
        const currentBlock = editor.getTextCursorPosition().block;
        const blockContent = currentBlock.content;
        const isSlashOnly = Array.isArray(blockContent) && blockContent.length === 1 &&
          blockContent[0].type === 'text' && blockContent[0].text === '/';
        const isEmpty = Array.isArray(blockContent) && blockContent.length === 0;
        const columnListBlock = {
          type: 'column_list',
          props: { columnRatios: '50,50' },
          children: [
            { type: 'column', props: { widthRatio: 50 }, children: [{ type: 'paragraph' }] },
            { type: 'column', props: { widthRatio: 50 }, children: [{ type: 'paragraph' }] },
          ],
        };
        if (isSlashOnly || isEmpty) {
          editor.updateBlock(currentBlock, columnListBlock as any);
        } else {
          editor.insertBlocks([columnListBlock as any], currentBlock, 'after');
        }
        // Move cursor into first column
        setTimeout(() => {
          try {
            const doc = editor.document;
            for (const b of doc) {
              if (b.type === 'column_list' && b.children?.length > 0) {
                const firstCol = b.children[0];
                if (firstCol.children?.length > 0) {
                  editor.setTextCursorPosition(firstCol.children[0].id, 'end');
                }
                break;
              }
            }
          } catch {}
        }, 50);
      },
    },
  ];
  // Sort by GROUP_ORDER so visual order matches array index (fixes keyboard navigation)
  allItems.sort((a: any, b: any) => {
    const aIdx = GROUP_ORDER.indexOf(a.group);
    const bIdx = GROUP_ORDER.indexOf(b.group);
    const aOrder = aIdx === -1 ? GROUP_ORDER.length : aIdx;
    const bOrder = bIdx === -1 ? GROUP_ORDER.length : bIdx;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return 0; // stable sort preserves intra-group order
  });
  return allItems;
}

function getSlashMenuEnglish(item: any): string {
  const english = SLASH_MENU_ENGLISH[item.key];
  if (english) return english;
  if (Array.isArray(item.aliases) && item.aliases.length > 0) {
    return String(item.aliases[0] ?? '');
  }
  return '';
}

function filterSlashMenuItems(items: any[], query: string) {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) return items;

  return items.filter((item) => {
    const english = getSlashMenuEnglish(item).toLowerCase();
    return english.includes(trimmedQuery);
  });
}

// Mutable ref so the TipTap extension can access the BlockNote editor
const bnEditorRef: { current: any } = { current: null };

/**
 * BlockNote built-in input rules vs our slash menu shortcuts:
 *   ✅ # → heading, `` ``` `` → code, --- → divider, -/+/* → bullet,
 *      [] → check, 1. → numbered
 *   ❌ #> → toggle heading, > → quote, || → table
 *
 * This TipTap extension fills the gaps by intercepting space/enter
 * after these patterns and converting the current paragraph.
 */
const CustomInputRules = Extension.create({
  name: 'customInputRules',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('customInputRules'),
        props: {
          handleKeyDown(view, event) {
            if (!bnEditorRef.current) return false;
            // Trigger on Space (for most patterns) or Enter (for ||)
            if (event.key !== ' ' && event.key !== 'Enter') return false;

            const { from, to } = view.state.selection;
            if (from !== to) return false;

            const $from = view.state.doc.resolve(from);
            const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n');
            const block = bnEditorRef.current.getTextCursorPosition().block;
            if (block.type !== 'paragraph') return false;

            // --- Toggle heading: #>, ##>, ###>, ####> ---
            const toggleMatch = textBefore.match(/^(#{1,4})>$/);
            if (toggleMatch && event.key === ' ') {
              const level = toggleMatch[1].length;
              event.preventDefault();
              const tr = view.state.tr.deleteRange(from - (level + 1), from);
              view.dispatch(tr);
              bnEditorRef.current.updateBlock(block, {
                type: 'heading',
                props: { level, isToggleable: true },
              });
              return true;
            }

            // --- Quote: > ---
            if (textBefore === '>' && event.key === ' ') {
              event.preventDefault();
              const tr = view.state.tr.deleteRange(from - 1, from);
              view.dispatch(tr);
              bnEditorRef.current.updateBlock(block, { type: 'quote' });
              return true;
            }

            // --- Table: || ---
            if (textBefore === '||' && event.key === ' ') {
              event.preventDefault();
              const tr = view.state.tr.deleteRange(from - 2, from);
              view.dispatch(tr);
              bnEditorRef.current.insertBlocks(
                [{ type: 'table', content: { type: 'tableContent', rows: [{ cells: ['', '', ''] }, { cells: ['', '', ''] }] } }],
                block,
                'after',
              );
              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});

/**
 * TipTap extension that fixes BlockNote's numbered list indexing on init.
 *
 * BlockNote's built-in numbered-list-indexing-decorations plugin has a bug:
 * its init() calls rr(tr, {decorations: empty}) where tr.changedRange() is null
 * (no steps on initial transaction), causing it to skip all decoration creation.
 * This results in numberedListItem elements rendering without data-index,
 * which makes CSS ::before show just "." instead of "1.", "2.", etc.
 *
 * This extension adds a ProseMirror plugin that provides the correct data-index
 * decorations on init, and steps aside once BlockNote's own plugin starts working
 * (after the first document change triggers its apply()).
 */
const NumberedListIndexFix = Extension.create({
  name: 'numberedListIndexFix',

  addProseMirrorPlugins() {
    const pluginKey = new PluginKey('numbered-list-index-fix');

    return [
      new Plugin({
        key: pluginKey,
        state: {
          init(_, state) {
            return buildNumberedIndexDecorations(state.doc);
          },
          apply(tr, oldValue, _oldState, newState) {
            // If the document didn't change, keep existing decorations
            if (!tr.docChanged) return oldValue;
            // Rebuild for the new document state
            return buildNumberedIndexDecorations(newState.doc);
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

/**
 * Global state for column drag-and-drop.
 * dragover writes to this, PM plugin's handleDOMEvents.drop reads it.
 * Necessary because PM's handleDOMEvents runs BEFORE DOM addEventListener handlers,
 * so our regular drop listener never fires for blocknote/html drags.
 */
type ColumnDragTargetInfo = {
  type: string;
  columnListId?: string;
  blockId: string;
  side: 'left' | 'right';
  blockOuter: HTMLElement;
  position?: 'above' | 'below';
  columnBlockId?: string;
  insertWidth?: number;
};

const columnDragState: {
  target: ColumnDragTargetInfo | null;
  onDrop: ((target: ColumnDragTargetInfo, pmView: any) => boolean) | null;
  dragHandled: boolean;
} = { target: null, onDrop: null, dragHandled: false };

/**
 * PM plugin that intercepts drop events for column operations.
 */
const ColumnDropPlugin = Extension.create({
  name: 'columnDropInterceptor',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('columnDropInterceptor'),
        props: {
          handleDOMEvents: {
            drop(view: any, event: any) {
              if (columnDragState.dragHandled) {
                columnDragState.dragHandled = false;
                return true;
              }
              if (!columnDragState.target) return false;
              if (!event.dataTransfer?.types?.includes('blocknote/html')) return false;
              const target = columnDragState.target;
              columnDragState.target = null;
              if (columnDragState.onDrop) {
                const handled = columnDragState.onDrop(target, view);
                if (handled) { event.preventDefault(); return true; }
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});

/**
 * Build a DecorationSet that adds data-index to every numberedListItem in the document.
 * Uses the same logic as BlockNote's nr() function:
 * - Walk document top-down, tracking sequential numberedListItem sequences
 * - Reset index to 1 when the previous sibling is not a numberedListItem
 * - Handle both top-level blocks and nested block groups
 */
function buildNumberedIndexDecorations(doc: any): DecorationSet {
  const decorations: Decoration[] = [];
  // Track sequence index and state per parent blockGroup.
  // This ensures nested blockGroups (e.g., toggle heading children) have
  // independent numbering sequences from the parent level.
  const indexByParent = new Map<any, number>();
  const prevWasNumberedByParent = new Map<any, boolean>();

  doc.descendants((node: any, pos: number, parent: any) => {
    if (node.type.name !== 'blockContainer') return;
    const firstChild = node.firstChild;
    const isNumbered = firstChild && firstChild.type.name === 'numberedListItem';

    if (!isNumbered) {
      prevWasNumberedByParent.set(parent, false);
      return;
    }

    const prevWasNumbered = prevWasNumberedByParent.get(parent) ?? false;
    let index = indexByParent.get(parent) ?? 0;

    if (!prevWasNumbered) {
      const startAttr = firstChild.attrs?.start;
      index = startAttr ? startAttr - 1 : 0;
    }
    index++;

    indexByParent.set(parent, index);
    prevWasNumberedByParent.set(parent, true);

    // Decoration targets the numberedListItem node inside the blockContainer.
    // pos is the start of blockContainer, +1 for its opening.
    const from = pos + 1;
    const to = from + firstChild.nodeSize;
    decorations.push(
      Decoration.node(from, to, { 'data-index': index.toString() }),
    );
  });

  return DecorationSet.create(doc, decorations);
}

// ==================== Internal Link Badge ====================
// ProseMirror plugin that renders internal page links as inline badges
// (icon + title + ↗ arrow) instead of regular hyperlinks.

let _badgeEditorView: any = null;

const internalLinkBadgeKey = new PluginKey('internalLinkBadge');

const InternalLinkBadge = Extension.create({
  name: 'internalLinkBadge',

  addProseMirrorPlugins() {
    const spaceSlug = () => {
      try {
        const m = window.location.pathname.match(/^\/s\/([^/]+)/);
        return m ? m[1] : '';
      } catch { return ''; }
    };

    return [
      new Plugin({
        key: internalLinkBadgeKey,
        state: {
          init(_, state) {
            return buildInternalLinkDecorations(state.doc, spaceSlug(), _badgeEditorView);
          },
          apply(tr, oldValue, _oldState, newState) {
            // Only rebuild when doc changed or async mention meta arrived
            if (!tr.docChanged && !tr.getMeta('mentionMetaReady')) return oldValue;
            return buildInternalLinkDecorations(newState.doc, spaceSlug(), _badgeEditorView);
          },
        },
        props: {
          decorations(state) {
            return internalLinkBadgeKey.getState(state) ?? DecorationSet.empty;
          },
          handleKeyDown(view, event) {
            // Fix: arrow-key navigation past a mention whose link text is
            // display:none.  When the cursor sits right after the hidden mention
            // text, pressing Left would normally try every position inside the
            // hidden <a>, fail to render any of them, and fall through to the
            // previous block.  We intercept here: insert a zero-width space
            // before the mention so the browser has a real text node to anchor
            // the cursor to, then place the selection there.
            if (event.key !== 'ArrowLeft') return false;

            const { from } = view.state.selection;
            if (!view.state.selection.empty) return false;

            const $head = view.state.selection.$head;
            const nodeBefore = $head.nodeBefore;
            if (!nodeBefore?.isText) return false;

            const linkMark = nodeBefore.marks?.find(
              (m: any) => m.type.name === 'link'
            );
            const MENTION_PREFIX = '​​';
            if (!linkMark || !nodeBefore.text?.startsWith(MENTION_PREFIX)) return false;

            const mentionStart = from - nodeBefore.nodeSize;

            // Check if there's already a zero-width space right before the mention
            const $ms = view.state.doc.resolve(mentionStart);
            const prev = $ms.nodeBefore;
            const hasExistingZWS = prev?.isText && prev.text === '​';

            if (!hasExistingZWS) {
              // Insert a zero-width space anchor before the mention
              const tr = view.state.tr.insertText('​', mentionStart);
              const $pos = tr.doc.resolve(mentionStart);
              tr.setSelection(TextSelection.near($pos));
              view.dispatch(tr);
            } else {
              // Already have a ZWS anchor — move cursor into it
              const $pos = view.state.doc.resolve(mentionStart - 1);
              view.dispatch(
                view.state.tr.setSelection(TextSelection.near($pos))
              );
            }

            // ProseMirror's DOM selection sync fails for positions near a
            // contenteditable=false widget decoration — domAtPos() returns the
            // parent <p> element with an offset that lands between the badge
            // span and the hidden <a>, where no visible cursor can render.
            // Fix: find the ZWS text node directly in the DOM and place the
            // browser selection inside it.
            const ms = mentionStart;
            setTimeout(() => {
              try {
                // Resolve the paragraph's DOM node via its start position
                const $p = view.state.doc.resolve(
                  hasExistingZWS ? ms - 1 : ms
                );
                const paraStart = ms - $p.parentOffset;
                const dom = view.domAtPos(paraStart);
                const pNode = dom.node;
                if (pNode) {
                  // Walk children to find the ZWS text node
                  for (const child of pNode.childNodes) {
                    if (
                      child.nodeType === 3 &&
                      child.textContent === '​'
                    ) {
                      const range = document.createRange();
                      range.setStart(child, 0);
                      range.collapse(true);
                      const sel = window.getSelection();
                      if (sel) {
                        sel.removeAllRanges();
                        sel.addRange(range);
                      }
                      break;
                    }
                  }
                }
              } catch { /* ignore */ }
            }, 0);
            return true;
          },
        },
        view(view) {
          _badgeEditorView = view;
          return {};
        },
      }),
    ];
  },
});

// ---- Table colgroup fix ----
// Removed: BlockNote's renderHTML was patched in chunk-JZ4PHHCU.js to handle colspan correctly,
// and prosemirror-tables' updateColumnsOnResize (chunk-FM6HLF7F.js) already handles colspan properly.
// The MutationObserver approach was causing conflicts by overriding colgroup on every DOM change.

// ---- Fix: allow empty table rows for merged cells ----
// Patched in chunk-SG4YPLUU.js: changed tableRow content from "+" to "*"
// to allow empty rows when mergeCells removes all cells from a row covered by rowspan.

// ---- Fix: rowspan cells height when rows are empty ----
// When mergeCells makes a row completely empty (all cells have rowspan>1),
// border-collapse tables give that <tr> 0 height. Fix is in globals.css:
// tr:empty::before creates an anonymous table-cell with min height.

// ---- Table cell active highlight ----
// Uses ProseMirror Decoration to add .cell-active class to the td containing the cursor,
// and .table-active class to the ancestor table node.
// Supports both single-cell (TextSelection) and multi-cell (CellSelection) highlights.
// Decorations survive DOM recreation (ProseMirror rebuilds td elements on click).
const TableCellHighlight = Extension.create({
  name: 'tableCellHighlight',

  addProseMirrorPlugins() {
    const pluginKey = new PluginKey('tableCellHighlight');

    return [
      new Plugin({
        key: pluginKey,
        state: {
          // Store { primary: number, all: number[] }
          // primary = the cell that shows the notch (last-selected / $headCell)
          // all = all highlighted cells
          init() { return null as { primary: number; all: number[] } | null; },
          apply(_tr, _value, _oldState, newState) {
            const sel = newState.selection as any;

            // CellSelection (multi-cell drag): highlight ALL selected cells
            // Use duck-typing ($anchorCell/$headCell) instead of instanceof
            // because BlockNote bundles its own prosemirror-tables instance.
            // CellSelection covers a rectangular region of cells between
            // $anchorCell and $headCell. Use forEachCell to collect ALL of them,
            // not just the two endpoints.
            if (sel.$anchorCell && sel.$headCell) {
              const all: number[] = [];

              // $headCell is the "primary" cell (last selected) — notch goes here
              const primary = (sel.$headCell as ReturnType<typeof newState.doc.resolve>).pos;

              // forEachCell iterates every cell in the rectangular selection region
              sel.forEachCell((node: any, pos: number) => {
                if (node && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) {
                  all.push(pos);
                }
              });

              return all.length > 0 ? { primary, all } : null;
            }

            // TextSelection: highlight single cell containing cursor
            const $head = sel.$head;
            for (let d = $head.depth; d > 0; d--) {
              const node = $head.node(d);
              if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
                const pos = $head.before(d);
                return { primary: pos, all: [pos] };
              }
            }
            return null;
          },
        },
        props: {
          decorations(state) {
            const data = pluginKey.getState(state) as { primary: number; all: number[] } | null;
            if (!data || data.all.length === 0) return DecorationSet.empty;

            const decorations: ReturnType<typeof Decoration.node>[] = [];

            for (const cellPos of data.all) {
              const cellNode = state.doc.nodeAt(cellPos);
              if (!cellNode) continue;
              const isPrimary = cellPos === data.primary;
              decorations.push(
                Decoration.node(cellPos, cellPos + cellNode.nodeSize, {
                  class: isPrimary ? 'cell-active cell-primary' : 'cell-active',
                }),
              );
            }

            // Find the ancestor table node and add .table-active class to it
            const $first = state.doc.resolve(data.all[0]);
            for (let d = $first.depth; d > 0; d--) {
              const node = $first.node(d);
              if (node.type.name === 'table') {
                const tablePos = $first.before(d);
                decorations.push(
                  Decoration.node(tablePos, tablePos + node.nodeSize, {
                    class: 'table-active',
                  }),
                );
                break;
              }
            }

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

// ---- Table column/row header indicators ----
// ---- Table Header Handles (notch-style indicators at column top / row left) ----
// ---- Table Action Menu (shown when clicking row/column indicator) ----
function getTableBlockIdFromDom(node: HTMLElement | null): string {
  return node?.closest('[data-id]')?.getAttribute('data-id') || '';
}

function getHeaderSelectionInfo(view: any): { tableId: string; type: 'col' | 'row'; index: number } | null {
  const sel = view.state.selection as any;
  if (!sel?.$anchorCell || !sel?.$headCell) return null;

  const $anchorCell = sel.$anchorCell as ReturnType<typeof view.state.doc.resolve>;
  let tableDepth = -1;
  for (let d = $anchorCell.depth; d > 0; d--) {
    if ($anchorCell.node(d).type.name === 'table') {
      tableDepth = d;
      break;
    }
  }
  if (tableDepth < 0) return null;

  const tableNode = $anchorCell.node(tableDepth);
  const tablePos = $anchorCell.before(tableDepth);
  const tableStart = tablePos + 1;
  const tableMap = TableMap.get(tableNode);
  const rect = tableMap.rectBetween(sel.$anchorCell.pos - tableStart, sel.$headCell.pos - tableStart);
  const isSingleCol = rect.right - rect.left === 1;
  const isSingleRow = rect.bottom - rect.top === 1;
  const isFullCol = rect.top === 0 && rect.bottom === tableMap.height && isSingleCol;
  const isFullRow = rect.left === 0 && rect.right === tableMap.width && isSingleRow;
  if (!isFullCol && !isFullRow) return null;

  const tableDom = view.nodeDOM(tablePos) as HTMLElement | null;
  const tableId = getTableBlockIdFromDom(tableDom);
  if (!tableId) return null;

  return {
    tableId,
    type: isFullCol ? 'col' : 'row',
    index: isFullCol ? rect.left : rect.top,
  };
}

function syncHeaderHandleLock(view: any) {
  const lock = getHeaderHandleLock();
  if (!lock) return;
  const current = getHeaderSelectionInfo(view);
  if (!current || current.tableId !== lock.tableId || current.type !== lock.type || current.index !== lock.index) {
    clearHeaderHandleLock();
  }
}

function getSelectedTableDimension(view: any): {
  tablePos: number;
  tableStart: number;
  tableNode: any;
  tableId: string;
  type: 'col' | 'row';
  index: number;
  cells: Array<{ pos: number; node: any; row: number; col: number }>;
} | null {
  const current = getHeaderSelectionInfo(view);
  if (!current) return null;

  const selection = view.state.selection as any;
  const $anchorCell = selection?.$anchorCell;
  if (!$anchorCell) return null;

  let tableDepth = -1;
  for (let d = $anchorCell.depth; d > 0; d--) {
    if ($anchorCell.node(d).type.name === 'table') {
      tableDepth = d;
      break;
    }
  }
  if (tableDepth < 0) return null;

  const tablePos = $anchorCell.before(tableDepth);
  const tableNode = $anchorCell.node(tableDepth);
  const tableStart = tablePos + 1;
  const tableMap = TableMap.get(tableNode);
  const seen = new Set<number>();
  const cells: Array<{ pos: number; node: any; row: number; col: number }> = [];

  if (current.type === 'col') {
    for (let row = 0; row < tableMap.height; row++) {
      const offset = tableMap.positionAt(row, current.index, tableNode);
      if (seen.has(offset)) continue;
      seen.add(offset);
      const node = tableNode.nodeAt(offset);
      if (!node) continue;
      cells.push({ pos: tableStart + offset, node, row, col: current.index });
    }
  } else {
    for (let col = 0; col < tableMap.width; col++) {
      const offset = tableMap.positionAt(current.index, col, tableNode);
      if (seen.has(offset)) continue;
      seen.add(offset);
      const node = tableNode.nodeAt(offset);
      if (!node) continue;
      cells.push({ pos: tableStart + offset, node, row: current.index, col });
    }
  }

  return {
    tablePos,
    tableStart,
    tableNode,
    tableId: current.tableId,
    type: current.type,
    index: current.index,
    cells,
  };
}

function resetTableCellContent(tr: any, pos: number, node: any) {
  const from = pos + 1;
  const to = pos + node.nodeSize - 1;
  const emptyParagraph = tr.doc.type.schema.nodes.tableParagraph.create();
  tr.replaceWith(from, to, emptyParagraph);
}

function copyTableCell(tr: any, targetPos: number, sourceNode: any) {
  const currentTargetNode = tr.doc.nodeAt(targetPos);
  if (!currentTargetNode) return;
  const clonedNode = sourceNode.type.create({ ...sourceNode.attrs }, sourceNode.content, sourceNode.marks);
  tr.replaceWith(targetPos, targetPos + currentTargetNode.nodeSize, clonedNode);
}

function getFileBlockType(file: File): 'image' | 'video' | 'audio' | 'file' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'file';
}

function clearSelectedTableDimension(view: any) {
  const selected = getSelectedTableDimension(view);
  if (!selected) return;

  const tr = view.state.tr;
  const cells = selected.cells.slice().sort((a, b) => b.pos - a.pos);
  for (const cell of cells) {
    resetTableCellContent(tr, cell.pos, cell.node);
    tr.setNodeMarkup(cell.pos, undefined, { ...cell.node.attrs, textColor: 'default', backgroundColor: 'default' });
  }
  view.dispatch(tr);
}

function setSelectedTableDimensionBgColor(view: any, colorKey: string) {
  const selected = getSelectedTableDimension(view);
  if (!selected) return;

  const tr = view.state.tr;
  for (const cell of selected.cells) {
    tr.setNodeMarkup(cell.pos, undefined, { ...cell.node.attrs, backgroundColor: colorKey });
  }
  view.dispatch(tr);
}

function setSelectedTableDimensionTextColor(view: any, colorKey: string) {
  const selected = getSelectedTableDimension(view);
  if (!selected) return;

  const tr = view.state.tr;
  for (const cell of selected.cells) {
    tr.setNodeMarkup(cell.pos, undefined, { ...cell.node.attrs, textColor: colorKey });
  }
  view.dispatch(tr);
}

function duplicateSelectedTableDimension(view: any) {
  const selected = getSelectedTableDimension(view);
  if (!selected) return;

  const command = selected.type === 'col' ? addColumnAfter : addRowAfter;
  let nextTr: any = null;
  if (!command(view.state, (tr: any) => { nextTr = tr; })) return;
  if (!nextTr) return;

  const mappedTablePos = nextTr.mapping.map(selected.tablePos);
  const newTableNode = nextTr.doc.nodeAt(mappedTablePos);
  if (!newTableNode || newTableNode.type.name !== 'table') {
    view.dispatch(nextTr);
    return;
  }

  const newTableStart = mappedTablePos + 1;
  const newMap = TableMap.get(newTableNode);
  const cellsWithTargets = selected.cells.map((cell) => {
    const targetOffset = selected.type === 'col'
      ? newMap.positionAt(cell.row, selected.index + 1, newTableNode)
      : newMap.positionAt(selected.index + 1, cell.col, newTableNode);
    return { cell, targetPos: newTableStart + targetOffset };
  }).sort((a, b) => b.targetPos - a.targetPos);

  for (const { cell, targetPos } of cellsWithTargets) {
    copyTableCell(nextTr, targetPos, cell.node);
  }

  const finalTableNode = nextTr.doc.nodeAt(mappedTablePos);
  if (finalTableNode && finalTableNode.type.name === 'table') {
    const finalMap = TableMap.get(finalTableNode);
    const anchorPos = selected.type === 'col'
      ? newTableStart + finalMap.positionAt(0, selected.index + 1, finalTableNode)
      : newTableStart + finalMap.positionAt(selected.index + 1, 0, finalTableNode);
    const headPos = selected.type === 'col'
      ? newTableStart + finalMap.positionAt(finalMap.height - 1, selected.index + 1, finalTableNode)
      : newTableStart + finalMap.positionAt(selected.index + 1, finalMap.width - 1, finalTableNode);
    const newSelection = selected.type === 'col'
      ? CellSelection.colSelection(nextTr.doc.resolve(anchorPos), nextTr.doc.resolve(headPos))
      : CellSelection.rowSelection(nextTr.doc.resolve(anchorPos), nextTr.doc.resolve(headPos));
    nextTr.setSelection(newSelection);
  }
  setHeaderHandleLock({
    tableId: selected.tableId,
    type: selected.type,
    index: selected.index + 1,
  });
  view.dispatch(nextTr);
}

function getSelectedTableDimensionColors(view: any): { textColor: string; bgColor: string } {
  const firstCellAttrs = getSelectedTableDimension(view)?.cells[0]?.node?.attrs;
  return {
    textColor: firstCellAttrs?.textColor || 'default',
    bgColor: firstCellAttrs?.backgroundColor || 'default',
  };
}

function isSelectedTableDimensionHeaderEnabled(view: any): boolean {
  const selected = getSelectedTableDimension(view);
  if (!selected) return false;
  return selected.cells.length > 0 && selected.cells.every((cell) => cell.node.type.name === 'tableHeader');
}

function showTableActionMenu(view: any, type: 'col' | 'row', _index: number, anchorRect: DOMRect) {
  // Remove any existing menu
  const existing = document.querySelector('.table-action-menu');
  if (existing) existing.remove();
  setHeaderMenuOpen(true);
  let colorSubmenuRoot: Root | null = null;

  const menu = document.createElement('div');
  menu.className = 'table-action-menu';
  const selectedDimension = getSelectedTableDimension(view);
  const showHeaderToggle = !!selectedDimension && selectedDimension.index === 0;
  const isHeaderEnabled = showHeaderToggle ? isSelectedTableDimensionHeaderEnabled(view) : false;

  // Prevent mousedown from blurring the editor (keeps CellSelection active)
  menu.addEventListener('mousedown', (e) => e.preventDefault());

  const iconMap: Record<string, string> = {
    color: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h5a2 2 0 0 1 0 4h-1v5a2 2 0 1 1-2-2h1v-3h-3a2 2 0 1 1 0-4Z"/><path d="M9.5 3h4"/></svg>`,
    insertColBefore: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8H3"/><path d="m6.5 4.5-3.5 3.5 3.5 3.5"/><path d="M13 3v10"/></svg>`,
    insertColAfter: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10"/><path d="m9.5 4.5 3.5 3.5-3.5 3.5"/><path d="M3 3v10"/></svg>`,
    insertRowAbove: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3"/><path d="m4.5 6.5 3.5-3.5 3.5 3.5"/><path d="M3 13h10"/></svg>`,
    insertRowBelow: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v10"/><path d="m4.5 9.5 3.5 3.5 3.5-3.5"/><path d="M3 3h10"/></svg>`,
    duplicate: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 10V4.5A1.5 1.5 0 0 1 4.5 3H10"/></svg>`,
    clear: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12.5h10"/><path d="m5.5 10.5 5-5"/><path d="M11.5 12.5 13 4.5H8.5"/></svg>`,
    deleteCol: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 4.5h9"/><path d="M6 2.5h4"/><path d="M5 6v5.5"/><path d="M8 6v5.5"/><path d="M11 6v5.5"/><path d="M4.5 4.5v7a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-7"/></svg>`,
    deleteRow: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 4.5h9"/><path d="M6 2.5h4"/><path d="M5 6v5.5"/><path d="M8 6v5.5"/><path d="M11 6v5.5"/><path d="M4.5 4.5v7a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-7"/></svg>`,
    headerToggle: `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.25"/><path d="M2.75 8.25h14.5"/><path d="M7.75 8.25v8"/></svg>`,
  };

  const items = type === 'col'
    ? [
        { label: '颜色', action: 'color', submenu: true },
        { label: '在左侧插入', action: 'insertColBefore' },
        { label: '在右侧插入', action: 'insertColAfter' },
        { label: '创建副本', action: 'duplicate' },
        { label: '清除内容', action: 'clear' },
        { label: '删除', action: 'deleteCol', danger: true },
      ]
    : [
        { label: '颜色', action: 'color', submenu: true },
        { label: '在上方插入', action: 'insertRowAbove' },
        { label: '在下方插入', action: 'insertRowBelow' },
        { label: '创建副本', action: 'duplicate' },
        { label: '清除内容', action: 'clear' },
        { label: '删除', action: 'deleteRow', danger: true },
      ];

  if (showHeaderToggle) {
    const headerItem = document.createElement('div');
    headerItem.className = 'table-action-toggle-item';
    headerItem.innerHTML = `
      <span class="table-action-toggle-icon">${iconMap.headerToggle}</span>
      <span class="table-action-toggle-label">${type === 'col' ? '标题列' : '标题行'}</span>
      <span class="table-action-toggle-switch${isHeaderEnabled ? ' is-active' : ''}">
        <span class="table-action-toggle-knob"></span>
      </span>
    `;
    headerItem.addEventListener('click', () => {
      const state = view.state;
      const dispatch = view.dispatch.bind(view);
      const command = toggleHeader(type === 'col' ? 'column' : 'row');
      command(state, dispatch);
      closeMenu();
      view.focus();
    });
    menu.appendChild(headerItem);

    const divider = document.createElement('div');
    divider.className = 'table-action-menu-divider';
    menu.appendChild(divider);
  }

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = `table-action-menu-item${item.danger ? ' danger' : ''}`;
    div.innerHTML = `
      <span class="table-action-menu-item-icon">${iconMap[item.action] || iconMap.color}</span>
      <span class="table-action-menu-item-label">${item.label}</span>
      ${item.submenu ? '<span class="table-action-menu-item-arrow">›</span>' : ''}
    `;
    if (item.submenu) {
      const submenu = document.createElement('div');
      submenu.className = 'table-action-color-submenu';
      const { textColor, bgColor } = getSelectedTableDimensionColors(view);
      colorSubmenuRoot = createRoot(submenu);
      colorSubmenuRoot.render(
        <ColorListContent
          currentTextColor={textColor}
          currentBgColor={bgColor}
          onTextColor={(color) => {
            setSelectedTableDimensionTextColor(view, color);
            closeMenu();
            view.focus();
          }}
          onBgColor={(color) => {
            setSelectedTableDimensionBgColor(view, color);
            closeMenu();
            view.focus();
          }}
        />,
      );

      div.appendChild(submenu);
      div.addEventListener('mouseenter', () => div.classList.add('submenu-open'));
      div.addEventListener('mouseleave', () => div.classList.remove('submenu-open'));
      menu.appendChild(div);
      return;
    }

    div.addEventListener('click', () => {
      const state = view.state;
      const dispatch = view.dispatch.bind(view);
      switch (item.action) {
        case 'insertColBefore': addColumnBefore(state, dispatch); break;
        case 'insertColAfter': addColumnAfter(state, dispatch); break;
        case 'duplicate': duplicateSelectedTableDimension(view); break;
        case 'clear': clearSelectedTableDimension(view); break;
        case 'deleteCol': deleteColumn(state, dispatch); break;
        case 'insertRowAbove': addRowBefore(state, dispatch); break;
        case 'insertRowBelow': addRowAfter(state, dispatch); break;
        case 'deleteRow': deleteRow(state, dispatch); break;
      }
      closeMenu();
      view.focus();
    });
    menu.appendChild(div);
  });

  // Position: fixed, near the indicator
  menu.style.cssText = `
    position: fixed;
    left: ${anchorRect.left + anchorRect.width / 2}px;
    top: ${anchorRect.bottom + 4}px;
    transform: translateX(-50%);
    z-index: 40;
  `;
  document.body.appendChild(menu);

  // Close handler — also remove visual cell selection
  const closeMenu = () => {
    colorSubmenuRoot?.unmount();
    colorSubmenuRoot = null;
    menu.remove();
    document.removeEventListener('mousedown', closeHandler);
    setHeaderMenuOpen(false);
    syncHeaderHandleLock(view);
    setTimeout(() => renderTableHeaderHandles(view), 0);
  };

  const closeHandler = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('.table-action-menu') && !(e.target as HTMLElement).closest('.table-header-indicator')) {
      closeMenu();
    }
  };
  setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);
}

function renderTableHeaderHandles(view: any) {
  // Store view reference for click handlers
  (window as any).__pmView = view;
  const root = (view.dom as HTMLElement).closest('.bn-editor');
  if (!root) return;

  root.querySelectorAll('[data-content-type="table"]').forEach((block) => {
    const wrapper = (block as HTMLElement).querySelector('.tableWrapper');
    const tableEl = wrapper?.querySelector('table');
    if (!wrapper || !tableEl) return;

    const isActive = (block as HTMLElement).classList.contains('table-active');
    let container = (wrapper as HTMLElement).querySelector('.table-header-handles') as HTMLElement | null;

    if (!isActive) {
      if (container) container.remove();
      return;
    }

    // Find active cell
    const activeCell = tableEl.querySelector('td.cell-active, th.cell-active') as HTMLElement | null;
    if (!activeCell) {
      if (container) container.innerHTML = '';
      return;
    }

    if (!container) {
      container = document.createElement('div');
      container.className = 'table-header-handles';
      container.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:35;';
      (wrapper as HTMLElement).appendChild(container);
    }

    const tableBlockId = getTableBlockIdFromDom(block as HTMLElement);
    const lock = getHeaderHandleLock();

    // Determine column and row index
    const activeRow = activeCell.parentElement as HTMLElement;
    const rows = tableEl.querySelectorAll('tr');
    let rowIndex = -1;
    rows.forEach((row, i) => { if (row === activeRow) rowIndex = i; });

    let colIndex = 0;
    let sibling = activeCell.previousElementSibling as HTMLElement | null;
    while (sibling) {
      colIndex += parseInt(sibling.getAttribute('colspan') || '1', 10);
      sibling = sibling.previousElementSibling as HTMLElement | null;
    }

    if (rowIndex < 0) { container.innerHTML = ''; return; }

    const tableRect = tableEl.getBoundingClientRect();
    const wrapperRect = (wrapper as HTMLElement).getBoundingClientRect();

    const cols = tableEl.querySelectorAll('colgroup col');
    const parts: string[] = [];

    // Column handle: centered at top border of the active column
    let cumX = 0;
    for (let i = 0; i < colIndex && i < cols.length; i++) {
      cumX += (cols[i] as HTMLElement).getBoundingClientRect().width || parseFloat((cols[i] as HTMLElement).style.width) || 100;
    }
    const cellColSpan = parseInt(activeCell.getAttribute('colspan') || '1', 10);
    let spanWidth = 0;
    for (let i = colIndex; i < colIndex + cellColSpan && i < cols.length; i++) {
      spanWidth += (cols[i] as HTMLElement).getBoundingClientRect().width || parseFloat((cols[i] as HTMLElement).style.width) || 100;
    }
    const colCenterX = tableRect.left + cumX + spanWidth / 2 - wrapperRect.left;
    const colCenterY = tableRect.top - wrapperRect.top;
    const isLockedCol = !!lock && lock.tableId === tableBlockId && lock.type === 'col' && lock.index === colIndex;
    parts.push(`<div class="table-header-indicator${isLockedCol ? ' is-active' : ''}" data-type="col" data-index="${colIndex}" style="pointer-events:auto;left:${colCenterX}px;top:${colCenterY}px;transform:translate(-50%,-50%)"></div>`);

    // Row handle: centered at left border of the active row
    const activeRowEl = rows[rowIndex];
    const rowRect = activeRowEl.getBoundingClientRect();
    const rowCenterX = tableRect.left - wrapperRect.left;
    const rowCenterY = rowRect.top + rowRect.height / 2 - wrapperRect.top;
    const isLockedRow = !!lock && lock.tableId === tableBlockId && lock.type === 'row' && lock.index === rowIndex;
    parts.push(`<div class="table-header-indicator${isLockedRow ? ' is-active' : ''}" data-type="row" data-index="${rowIndex}" style="pointer-events:auto;left:${rowCenterX}px;top:${rowCenterY}px;transform:translate(-50%,-50%)"></div>`);

    container.innerHTML = parts.join('');

    // Click handlers: select entire row/column, then show action menu
    container.querySelectorAll('.table-header-indicator').forEach((ind) => {
      // Prevent mousedown from moving focus away from the editor.
      // Combined with the ProseMirror plugin's handleDOMEvents.blur guard,
      // this ensures the CellSelection survives when the user clicks the indicator.
      ind.addEventListener('pointerdown', (e) => e.preventDefault());
      ind.addEventListener('mousedown', (e) => e.preventDefault());

      ind.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = (ind as HTMLElement).getAttribute('data-type') as 'col' | 'row' | null;
        if (!type) return;
        const view = (window as any).__pmView || null;
        if (!view) return;

        const state = view.state;
        const doc = state.doc;

        // Find the table node position in the document
        let tablePos = -1;
        let tableNode: any = null;
        doc.descendants((node: any, pos: number) => {
          if (node.type.name === 'table' && tablePos === -1) {
            // Verify this table contains the active cell
            const dom = view.nodeDOM(pos) as HTMLElement | null;
            if (dom && dom.querySelector('td.cell-active, th.cell-active')) {
              tablePos = pos;
              tableNode = node;
              return false;
            }
          }
        });
        if (tablePos === -1 || !tableNode) return;
        const tableMap = TableMap.get(tableNode);
        const tableStart = tablePos + 1;
        const anchorPos = type === 'col'
          ? tableStart + tableMap.positionAt(0, colIndex, tableNode)
          : tableStart + tableMap.positionAt(rowIndex, 0, tableNode);
        const headPos = type === 'col'
          ? tableStart + tableMap.positionAt(tableMap.height - 1, colIndex, tableNode)
          : tableStart + tableMap.positionAt(rowIndex, tableMap.width - 1, tableNode);
        const selection = type === 'col'
          ? CellSelection.colSelection(doc.resolve(anchorPos), doc.resolve(headPos))
          : CellSelection.rowSelection(doc.resolve(anchorPos), doc.resolve(headPos));
        view.dispatch(state.tr.setSelection(selection));
        setHeaderHandleLock({
          tableId: tableBlockId,
          type,
          index: type === 'col' ? colIndex : rowIndex,
        });
        setTimeout(() => renderTableHeaderHandles(view), 0);

        // Show action menu near the clicked indicator.
        // The menu's operations will use colIndex/rowIndex directly.
        const indRect = (ind as HTMLElement).getBoundingClientRect();
        showTableActionMenu(view, type, type === 'col' ? colIndex : rowIndex, indRect);
      });
    });
  });
}

function syncTableExtendButtonVisibility(root: HTMLElement) {
  type MatchedTable = { wrapper: HTMLElement; table: HTMLTableElement };
  const findHorizontalScrollContainer = (start: HTMLElement): HTMLElement | null => {
    let current: HTMLElement | null = start;
    while (current) {
      const style = window.getComputedStyle(current);
      const overflowX = style.overflowX;
      const canScrollX = overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay';
      if (canScrollX && current.scrollWidth - current.clientWidth > 0.5) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  };

  const columnButtons = Array.from(document.querySelectorAll('.bn-extend-button-add-remove-columns')) as HTMLElement[];
  if (columnButtons.length === 0) return;
  const tableBlocks = Array.from(root.querySelectorAll('[data-content-type="table"]')) as HTMLElement[];

  columnButtons.forEach((button) => {
    const buttonRect = button.getBoundingClientRect();
    const buttonCenterY = buttonRect.top + buttonRect.height / 2;
    let matchedTable: MatchedTable | null = null;
    let bestDistance = Infinity;

    tableBlocks.forEach((block) => {
      const wrapper = block.querySelector('.tableWrapper') as HTMLElement | null;
      const table = wrapper?.querySelector('table') as HTMLTableElement | null;
      if (!wrapper || !table) return;

      const tableRect = table.getBoundingClientRect();
      const verticalOverlap = buttonCenterY >= tableRect.top - 1 && buttonCenterY <= tableRect.bottom + 1;
      if (!verticalOverlap) return;

      const distance = Math.abs(buttonRect.left - tableRect.right);
      if (distance < bestDistance) {
        bestDistance = distance;
        matchedTable = { wrapper, table };
      }
    });

    let hideColumnButton = false;
    if (matchedTable) {
      const matched = matchedTable as MatchedTable;
      const scrollContainer = findHorizontalScrollContainer(matched.wrapper);
      if (scrollContainer) {
        const hasHorizontalOverflow = scrollContainer.scrollWidth - scrollContainer.clientWidth > 0.5;
        const scrolledToEnd = scrollContainer.scrollLeft + scrollContainer.clientWidth >= scrollContainer.scrollWidth - 0.5;
        hideColumnButton = hasHorizontalOverflow && !scrolledToEnd;
      }
    }

    button.classList.toggle('is-table-content-clipped', hideColumnButton);
  });
}

const TableHeaderIndicators = Extension.create({
  name: 'tableHeaderIndicators',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tableHeaderIndicators'),
        props: {
          // When the table action menu is open, block ProseMirror from processing
          // the editor's blur event. This prevents ProseMirror from removing
          // `.ProseMirror-focused` and replacing CellSelection with TextSelection
          // when the user clicks outside the contenteditable (on the indicator/menu).
          handleDOMEvents: {
            blur(_view: any, _event: Event) {
              if (document.querySelector('.table-action-menu')) {
                return true; // "handled" — ProseMirror skips its blur handling
              }
              return false;
            },
          },
        },
        view() {
          let currentView: any = null;
          let dragFrame = 0;
          let dragTracking = false;

          const stopDragTracking = () => {
            dragTracking = false;
            cancelAnimationFrame(dragFrame);
            dragFrame = 0;
            if (currentView && !isHeaderMenuOpen()) {
              renderTableHeaderHandles(currentView);
            }
          };

          const trackDragFrame = () => {
            if (!dragTracking || !currentView) return;
            renderTableHeaderHandles(currentView);
            const root = (currentView.dom as HTMLElement).closest('.bn-editor') as HTMLElement | null;
            if (root) syncTableExtendButtonVisibility(root);
            if (!root?.querySelector('td.column-resize-dragging, th.column-resize-dragging')) {
              stopDragTracking();
              return;
            }
            dragFrame = requestAnimationFrame(trackDragFrame);
          };

          const syncDragTracking = (view: any) => {
            currentView = view;
            const root = (view.dom as HTMLElement).closest('.bn-editor');
            const isDragging = !!root?.querySelector('td.column-resize-dragging, th.column-resize-dragging');
            if (isDragging === dragTracking) return;
            if (isDragging) {
              dragTracking = true;
              cancelAnimationFrame(dragFrame);
              dragFrame = requestAnimationFrame(trackDragFrame);
            } else {
              stopDragTracking();
            }
          };

          document.addEventListener('mouseup', stopDragTracking, true);

          return {
            update(view: any) {
              currentView = view;
              syncHeaderHandleLock(view);
              syncDragTracking(view);
              const root = (view.dom as HTMLElement).closest('.bn-editor') as HTMLElement | null;
              if (root) {
                setTimeout(() => syncTableExtendButtonVisibility(root), 0);
              }
              if (isHeaderMenuOpen()) return;
              setTimeout(() => renderTableHeaderHandles(view), 0);
            },
            destroy() {
              document.removeEventListener('mouseup', stopDragTracking, true);
              stopDragTracking();
              setHeaderMenuOpen(false);
              clearHeaderHandleLock();
              document.querySelectorAll('.table-header-handles').forEach((el) => el.remove());
              document.querySelectorAll('.bn-extend-button-add-remove-columns').forEach((el) => {
                el.classList.remove('is-table-content-clipped');
              });
            },
          };
        },
      }),
    ];
  },
});

function buildInternalLinkDecorations(doc: any, spaceSlug: string, _editorView?: any): DecorationSet {
  const decorations: Decoration[] = [];
  const schema = doc.type.schema;
  const linkMarkType = schema.marks.link;
  if (!linkMarkType) return DecorationSet.empty;

  doc.descendants((node: any, pos: number) => {
    if (!node.isInline) return;
    const linkMark = node.marks.find((m: any) => m.type === linkMarkType);
    if (!linkMark) return;

    const href: string = linkMark.attrs?.href || '';
    const nodeText: string = node.text || '';

    // Mention link: detected by zero-width space prefix in text
    const MENTION_PREFIX = '​​';
    const isMention = nodeText.startsWith(MENTION_PREFIX);

    if (isMention) {
      const mentionUrl = normalizeInternalPageLink(href);
      const mentionMatch = parseInternalPageLink(mentionUrl);
      const meta = mentionMetaCache.get(mentionUrl);

      // Always hide original text and show badge
      decorations.push(
        Decoration.inline(pos, pos + node.nodeSize, { class: 'is-mention-link' })
      );

      const badge = document.createElement('span');
      badge.className = 'mention-badge';
      badge.setAttribute('contenteditable', 'false');
      badge.setAttribute('data-href', mentionUrl);

      if (meta) {
        const iconWrap = document.createElement('span');
        iconWrap.className = `mention-badge-icon-wrap${meta.is_internal ? ' is-internal' : ''}`;

        if (meta.favicon_url) {
          if (meta.is_internal && !(meta.favicon_url.startsWith('/') || meta.favicon_url.startsWith('http'))) {
            const iconEmoji = document.createElement('span');
            iconEmoji.className = 'mention-badge-emoji-icon';
            iconEmoji.textContent = meta.favicon_url;
            iconWrap.appendChild(iconEmoji);
          } else {
            const img = document.createElement('img');
            img.className = 'mention-badge-icon';
            img.src = meta.favicon_url;
            img.alt = '';
            img.onerror = () => {
              const fallback = document.createElement('span');
              fallback.className = 'mention-badge-fallback-icon';
              fallback.textContent = '🔗';
              iconWrap.replaceChildren(fallback);
            };
            iconWrap.appendChild(img);
          }
        } else {
          if (meta.is_internal) {
            iconWrap.appendChild(createDefaultInternalPageIcon());
          } else {
            const icon = document.createElement('span');
            icon.className = 'mention-badge-fallback-icon';
            icon.textContent = '🔗';
            iconWrap.appendChild(icon);
          }
        }

        if (meta.is_internal) {
          const marker = document.createElement('span');
          marker.className = 'mention-badge-internal-arrow';
          marker.textContent = '↗';
          iconWrap.appendChild(marker);
        }

        badge.appendChild(iconWrap);
        const titleEl = document.createElement('span');
        titleEl.className = 'mention-badge-title';
        titleEl.textContent = meta.title;
        badge.appendChild(titleEl);
      } else {
        // No meta yet: show URL, fetch in background
        const iconWrap = document.createElement('span');
        iconWrap.className = 'mention-badge-icon-wrap';
        const icon = document.createElement('span');
        icon.className = 'mention-badge-fallback-icon';
        icon.textContent = '🔗';
        iconWrap.appendChild(icon);
        badge.appendChild(iconWrap);
        const titleEl = document.createElement('span');
        titleEl.className = 'mention-badge-title mention-badge-loading';
        titleEl.textContent = mentionUrl;
        badge.appendChild(titleEl);

        mentionMetaCache.getOrFetch(mentionUrl).then(() => {
          const view = _badgeEditorView;
          if (view && !view.isDestroyed) {
            try {
              const tr = view.state.tr.setMeta('mentionMetaReady', true);
              view.dispatch(tr);
            } catch {}
          }
        });
      }

      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (meta?.is_internal || mentionMatch) {
          if (e.metaKey) {
            window.open(mentionUrl, '_blank', 'noopener,noreferrer');
          } else {
            window.location.href = mentionUrl;
          }
          return;
        }
        window.open(mentionUrl, '_blank', 'noopener,noreferrer');
      });

      decorations.push(Decoration.widget(pos, badge, { side: -1 }));
      return;
    }

    // Internal page link
    const match = parseInternalPageLink(href);
    if (!match) return;

    const pageId = match.pageId;
    const meta = pageMetaCache.get(pageId);

    // Add class to hide original <a> text
    decorations.push(
      Decoration.inline(pos, pos + node.nodeSize, { class: 'is-internal-link' })
    );

    // Inject badge widget at link start
    const badge = document.createElement('span');
    badge.className = 'internal-page-badge';
    badge.setAttribute('data-page-id', pageId);
    badge.setAttribute('contenteditable', 'false');

    const icon = document.createElement('span');
    icon.className = 'internal-page-badge-icon';
    icon.textContent = meta?.icon || '📄';

    const title = document.createElement('span');
    title.className = 'internal-page-badge-title';
    title.textContent = meta?.title || '加载中...';

    const arrow = document.createElement('span');
    arrow.className = 'internal-page-badge-arrow';
    arrow.textContent = '↗';

    badge.appendChild(icon);
    badge.appendChild(title);
    badge.appendChild(arrow);

    // Click handler for navigation
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = match.relativePath;
    });

    decorations.push(Decoration.widget(pos, badge, { side: -1 }));

    // If meta not cached, fetch and trigger re-render
    if (!meta && spaceSlug) {
      pageMetaCache.getOrFetch(pageId, match.spaceSlug || spaceSlug).then(() => {
        // Force a re-render by dispatching an empty transaction
        // The decoration will be rebuilt with the cached data
      });
    }
  });

  return DecorationSet.create(doc, decorations);
}

interface PageEditorProps {
  initialContent: string;
  pageIdentity: { spaceSlug: string; pageId: string };
  onSyncStatusChange?: (status: 'unsaved' | 'syncing' | 'synced') => void;
  readOnly?: boolean;
  codeTheme?: CodeThemeValue;
}

type FileUploadVisualState = {
  progress: number;
  status: 'uploading' | 'error';
  objectUrl?: string;
};

const IMAGE_TOOLBAR_ICONS = {
  alignLeft: `<svg viewBox="1.77 0 12.45 16" fill="currentColor"><path d="M2.4 2.175a.625.625 0 1 0 0 1.25h11.2a.625.625 0 1 0 0-1.25zm1.2 2A1.825 1.825 0 0 0 1.775 6v4c0 1.008.817 1.825 1.825 1.825H8A1.825 1.825 0 0 0 9.825 10V6A1.825 1.825 0 0 0 8 4.175zM3.025 6c0-.318.258-.575.575-.575H8c.318 0 .575.257.575.575v4a.575.575 0 0 1-.575.575H3.6A.575.575 0 0 1 3.025 10zM2.4 12.575a.625.625 0 1 0 0 1.25h11.2a.625.625 0 1 0 0-1.25z"></path></svg>`,
  alignCenter: `<svg viewBox="1.77 0 12.45 16" fill="currentColor"><path d="M2.4 2.175a.625.625 0 1 0 0 1.25h11.2a.625.625 0 1 0 0-1.25zm3.4 2h4.4c1.008 0 1.825.817 1.825 1.825v4a1.825 1.825 0 0 1-1.825 1.825H5.8A1.825 1.825 0 0 1 3.975 10V6c0-1.008.817-1.825 1.825-1.825M5.225 6v4c0 .318.258.575.575.575h4.4a.575.575 0 0 0 .575-.575V6a.575.575 0 0 0-.575-.575H5.8A.575.575 0 0 0 5.225 6M2.4 12.575a.625.625 0 1 0 0 1.25h11.2a.625.625 0 1 0 0-1.25z"></path></svg>`,
  alignRight: `<svg viewBox="1.77 0 12.45 16" fill="currentColor"><path d="M2.4 2.175a.625.625 0 1 0 0 1.25h11.2a.625.625 0 1 0 0-1.25zm5.6 2A1.825 1.825 0 0 0 6.175 6v4c0 1.008.817 1.825 1.825 1.825h4.4A1.825 1.825 0 0 0 14.225 10V6A1.825 1.825 0 0 0 12.4 4.175zM7.425 6c0-.318.257-.575.575-.575h4.4c.318 0 .575.257.575.575v4a.575.575 0 0 1-.575.575H8A.575.575 0 0 1 7.425 10zM2.4 12.575a.625.625 0 1 0 0 1.25h11.2a.625.625 0 1 0 0-1.25z"></path></svg>`,
  caption: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5h8"/><path d="M4 8h8"/><path d="M6 11.5h4"/></svg>`,
  fullscreen: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5H3.5V5"/><path d="M10 2.5h2.5V5"/><path d="M6 13.5H3.5V11"/><path d="M10 13.5h2.5V11"/></svg>`,
  download: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v7"/><path d="M5.5 7.5L8 10l2.5-2.5"/><path d="M3 12.5h10"/></svg>`,
  replace: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 10.5L5 13l2.5-2.5"/><path d="M5 3v10"/><path d="M13.5 5.5L11 3 8.5 5.5"/><path d="M11 13V3"/></svg>`,
};

export function PageEditor({ initialContent, pageIdentity, onSyncStatusChange, readOnly = false, codeTheme }: PageEditorProps) {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [editorEl, setEditorEl] = useState<HTMLDivElement | null>(null);
  // Stable callback ref — avoids React calling null→element on every re-render
  const editorRefCallback = useCallback((el: HTMLDivElement | null) => {
    editorRef.current = el;
    setEditorEl(el);
  }, []);

  // Refs for values read inside callbacks — avoid stale closures
  const hasChangesRef = useRef(false);
  // Baseline content for each fileContent block (blockId -> last persisted
  // text). Used by triggerMirror to write only blocks whose content actually
  // changed since the last successful PUT. A block that has never been
  // persisted is recorded as baseline-on-first-see (no write) so freshly
  // hydrated content from the API doesn't get redundantly written back.
  const fileContentBaselineRef = useRef<Map<string, string>>(new Map());
  const isNormalizingColumnsRef = useRef(false);
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
  const [syncedPaste, setSyncedPaste] = useState<ClipboardPayload | null>(null);
  const [syncedDelete, setSyncedDelete] = useState<{ block: any; quotedCount: number } | null>(null);
  const [fileUploadStates, setFileUploadStates] = useState<Record<string, FileUploadVisualState>>({});
  const [imageLightbox, setImageLightbox] = useState<{ url: string; name: string; type?: 'image' | 'video' } | null>(null);
  const imageReplaceInputRef = useRef<HTMLInputElement | null>(null);
  const imageReplaceTargetRef = useRef<string | null>(null);
  const resolvedCodeTheme = normalizeCodeTheme(codeTheme);
  const schema = useMemo(() => createEditorSchema(resolvedCodeTheme), [resolvedCodeTheme]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useCreateBlockNote({
    schema,
    initialContent: markdownToBlocks(initialContent) as any,
    dictionary: customZh as any,
    trailingBlock: false,
    uploadFile: async (file: File) => {
      const { spaceSlug, pageId } = identityRef.current;
      const result = await uploadApi.upload(file, { pageId, spaceSlug });
      return result.path;
    },
    _tiptapOptions: { extensions: [CustomInputRules, NumberedListIndexFix, InternalLinkBadge, TableCellHighlight, TableHeaderIndicators, ColumnDropPlugin, FindReplaceExtension, createFileContentHighlightExtension(resolvedCodeTheme)] },
  } as any);

  // Wire up the editor ref for ToggleHeadingInputRules
  useEffect(() => {
    bnEditorRef.current = editor;
  }, [editor]);

  // Find & Replace panel state
  const [findReplace, setFindReplace] = useState<{ open: boolean; mode: 'find' | 'replace' }>({
    open: false,
    mode: 'find',
  });

  // Global keyboard shortcuts: Ctrl/Cmd+F opens find, Ctrl/Cmd+H opens replace,
  // Escape closes the find/replace panel if it is open.
  // We preventDefault so the browser's native find dialog never appears.
  // A ref tracks the panel open state so this listener can be registered once
  // and still react to the current state.
  const findReplaceOpenRef = useRef(false);
  findReplaceOpenRef.current = findReplace.open;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Escape closes the panel first, before any editor-level handling.
      if (e.key === 'Escape') {
        if (findReplaceOpenRef.current) {
          e.preventDefault();
          e.stopPropagation();
          setFindReplace((s) => ({ ...s, open: false }));
          return;
        }
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        setFindReplace({ open: true, mode: 'find' });
      } else if (key === 'h') {
        e.preventDefault();
        setFindReplace({ open: true, mode: 'replace' });
      }
    };
    // Use capture phase so we intercept Escape before the editor can act on it.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Populate page metadata cache from pageTree
  useEffect(() => {
    const { pageTree } = useSpaceStore.getState();
    pageMetaCache.populateFromTree(pageTree);
    const unsub = useSpaceStore.subscribe((state) => {
      pageMetaCache.populateFromTree(state.pageTree);
    });
    return unsub;
  }, []);

  // Sync subpage blocks with sidebar create/delete/reorder events
  useEffect(() => {
    if (readOnly) return;

    const handleSubpageCreated = (e: Event) => {
      const { pageId, afterId, fromParentId } = (e as CustomEvent).detail;
      // Guard: skip if block already exists (prevent duplicate from event or backend)
      const exists = editor.document.some((b: any) => b.type === 'subpage' && b.props?.pageId === pageId);
      if (exists) return;

      const newBlock = { type: 'subpage', props: { pageId } };

      if (!afterId) {
        // No afterId: insert before the first existing subpage block
        const firstSubpage = editor.document.find(
          (b: any) => b.type === 'subpage' && b.props?.pageId,
        );
        if (firstSubpage) {
          editor.insertBlocks([newBlock] as any, firstSubpage, 'before');
        } else {
          // No subpage blocks exist, insert at end of document
          const doc = editor.document;
          const lastBlock = doc[doc.length - 1];
          if (lastBlock) {
            editor.insertBlocks([newBlock] as any, lastBlock, 'after');
          }
        }
      } else {
        // Insert after the specified sibling
        const refBlock = editor.document.find(
          (b: any) => b.type === 'subpage' && b.props?.pageId === afterId,
        );
        if (refBlock) {
          editor.insertBlocks([newBlock] as any, refBlock, 'after');
        } else {
          // Fallback: insert at end
          const doc = editor.document;
          const lastBlock = doc[doc.length - 1];
          if (lastBlock) {
            editor.insertBlocks([newBlock] as any, lastBlock, 'after');
          }
        }
      }

      // Record undo action: if moved from another parent, undo should move back
      if (fromParentId) {
        const slug = useSpaceStore.getState().currentSpace?.slug;
        if (slug) {
          setSubpageUndoAction(pageId, { action: 'moveBack', spaceSlug: slug, fromParentId });
        }
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
      const { parentId: _parentId, movedPageId, afterId } = (e as CustomEvent).detail;

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

    // 标题按 Enter：在页面顶部插入空 paragraph 并聚焦（用户想直接开始写正文）
    const handleTitleEnter = () => {
      const doc = editor.document;
      const firstBlock = doc[0];
      if (!firstBlock) return;
      // 已经是空 paragraph 就直接复用，避免每次 Enter 都堆一个新空 block
      const isEmptyParagraph = firstBlock.type === 'paragraph'
        && !(firstBlock.content as any)?.length;
      const targetId = isEmptyParagraph
        ? firstBlock.id
        : editor.insertBlocks([{ type: 'paragraph' } as any], firstBlock, 'before')[0].id;
      editor.focus();
      editor.setTextCursorPosition(targetId as any, 'start');
    };
    document.addEventListener('title-enter-pressed', handleTitleEnter);

    return () => {
      document.removeEventListener('subpage-created', handleSubpageCreated);
      document.removeEventListener('subpage-deleted', handleSubpageDeleted);
      document.removeEventListener('subpage-reordered', handleSubpageReordered);
      document.removeEventListener('title-enter-pressed', handleTitleEnter);
    };
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editorEl) return;

    editorEl.querySelectorAll('.bn-upload-progress-overlay').forEach((node) => {
      const overlay = node as HTMLElement;
      const blockEl = overlay.closest('[data-id]') as HTMLElement | null;
      const blockId = blockEl?.getAttribute('data-id') || '';
      if (!blockId || !fileUploadStates[blockId]) {
        overlay.remove();
      }
    });

    Object.entries(fileUploadStates).forEach(([blockId, state]) => {
      const blockEl = editorEl.querySelector(`[data-id="${blockId}"]`) as HTMLElement | null;
      if (!blockEl) return;

      const wrapper = (blockEl.querySelector('.bn-visual-media-wrapper') ||
        blockEl.querySelector('.bn-file-block-content-wrapper')) as HTMLElement | null;
      if (!wrapper) return;

      if (getComputedStyle(wrapper).position === 'static') {
        wrapper.style.position = 'relative';
      }

      let overlay = wrapper.querySelector('.bn-upload-progress-overlay') as HTMLElement | null;
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'bn-upload-progress-overlay';
        wrapper.appendChild(overlay);
      }

      overlay.textContent = state.status === 'error' ? '上传失败' : `${state.progress}%`;
      overlay.dataset.status = state.status;
    });
  }, [editorEl, fileUploadStates]);

  const getBlockById = useCallback((blockId: string) => {
    return findBlockDeep(editor.document, blockId) || null;
  }, [editor]);

  const uploadImageReplacement = useCallback(async (blockId: string, file: File) => {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      showToast('请选择图片或视频文件');
      return;
    }

    const block = getBlockById(blockId);
    if (!block) return;

    const previousProps = { ...(block.props as any) };
    const objectUrl = URL.createObjectURL(file);

    editor.updateBlock(block, {
      props: {
        ...previousProps,
        name: file.name,
        url: objectUrl,
      },
    } as any);

    setFileUploadStates((prev) => ({
      ...prev,
      [blockId]: {
        progress: 0,
        status: 'uploading',
        objectUrl,
      },
    }));

    try {
      const { spaceSlug, pageId } = identityRef.current;
      const uploadedPath = await uploadApi.uploadWithProgress(file, {
        pageId,
        spaceSlug,
        onProgress: (progress) => {
          setFileUploadStates((prev) => {
            const current = prev[blockId];
            if (!current) return prev;
            return {
              ...prev,
              [blockId]: {
                ...current,
                progress,
              },
            };
          });
        },
      });

      editor.updateBlock(block, {
        props: {
          ...previousProps,
          name: file.name,
          url: uploadedPath.path,
        },
      } as any);

      setFileUploadStates((prev) => {
        const next = { ...prev };
        if (next[blockId]?.objectUrl) {
          URL.revokeObjectURL(next[blockId].objectUrl!);
        }
        delete next[blockId];
        return next;
      });
    } catch {
      editor.updateBlock(block, {
        props: previousProps,
      } as any);
      setFileUploadStates((prev) => {
        const next = { ...prev };
        if (next[blockId]?.objectUrl) {
          URL.revokeObjectURL(next[blockId].objectUrl!);
        }
        delete next[blockId];
        return next;
      });
      showToast('图片上传失败');
    }
  }, [editor, getBlockById]);

  const triggerImageReplace = useCallback((blockId: string) => {
    imageReplaceTargetRef.current = blockId;
    imageReplaceInputRef.current?.click();
  }, []);

  const handleImageReplaceInput = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const blockId = imageReplaceTargetRef.current;
    e.target.value = '';
    imageReplaceTargetRef.current = null;
    if (!file || !blockId) return;
    await uploadImageReplacement(blockId, file);
  }, [uploadImageReplacement]);

  const saveImageCaption = useCallback((blockId: string, caption: string) => {
    const block = getBlockById(blockId);
    if (!block) return;
    editor.updateBlock(block, {
      props: {
        ...(block.props as any),
        caption,
      },
    } as any);
  }, [editor, getBlockById]);

  const setImageAlignment = useCallback((blockId: string, textAlignment: 'left' | 'center' | 'right') => {
    const block = getBlockById(blockId);
    if (!block) return;
    editor.updateBlock(block, {
      props: {
        ...(block.props as any),
        textAlignment,
      },
    } as any);
  }, [editor, getBlockById]);

  const downloadImageBlock = useCallback((blockId: string) => {
    const block = getBlockById(blockId);
    const { spaceSlug, pageId } = identityRef.current;
    const url = resolvePageAssetUrl((block?.props as any)?.url, spaceSlug, pageId);
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = (block?.props as any)?.name || 'image';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [getBlockById]);

  const duplicateImageBlock = useCallback((blockId: string) => {
    const block = getBlockById(blockId);
    if (!block) return;
    editor.insertBlocks([{
      type: block.type,
      props: { ...(block.props as any) },
      content: block.content,
      children: block.children,
    } as any], block, 'after');
  }, [editor, getBlockById]);

  const deleteImageBlock = useCallback((blockId: string) => {
    removeBlocksEnhanced(editor, [{ id: blockId } as any]);
  }, [editor]);

  const openImageFullscreen = useCallback((blockId: string) => {
    const block = getBlockById(blockId);
    const { spaceSlug, pageId } = identityRef.current;
    const url = resolvePageAssetUrl((block?.props as any)?.url, spaceSlug, pageId);
    if (!url) return;
    setImageLightbox({
      url,
      name: String((block?.props as any)?.name || 'media'),
      type: block?.type === 'video' ? 'video' : 'image',
    });
  }, [getBlockById]);

  useEffect(() => {
    if (!imageLightbox) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setImageLightbox(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [imageLightbox]);

  useEffect(() => {
    if (readOnly || !editorEl) return;

    const closeImageMenus = () => {
      editorEl.querySelectorAll('.bn-file-block-content-wrapper').forEach((node) => {
        const wrapper = node as HTMLElement;
        wrapper.querySelector('.bn-image-toolbar-menu')?.remove();
      });
    };

    const activateImageBlockSelection = (blockId: string, wrapper: HTMLElement) => {
      editor.focus();
      editor.setTextCursorPosition(blockId as any);
      setBlockSelection([blockId]);
      editorEl.querySelectorAll('.bn-image-shell.is-selected').forEach((node) => {
        if (node !== wrapper) {
          node.classList.remove('is-selected');
        }
      });
      wrapper.classList.add('is-selected');
    };

    const syncImageBlocks = () => {
      const selectedIds = new Set(getSelectedBlockIds());
      const imageBlocks = Array.from(editorEl.querySelectorAll('.bn-block-content[data-content-type="image"], .bn-block-content[data-content-type="video"]')) as HTMLElement[];

      imageBlocks.forEach((blockContent) => {
        const blockId = blockContent.closest('[data-id]')?.getAttribute('data-id');
        if (!blockId) return;

        const block = getBlockById(blockId);
        const blockProps = (block?.props as any) || {};
        const currentAlignment = (blockProps.textAlignment || 'center') as 'left' | 'center' | 'right';
        const resolvedMediaUrl = resolvePageAssetUrl(blockProps.url, identityRef.current.spaceSlug, identityRef.current.pageId);
        const wrapper = blockContent.querySelector('.bn-file-block-content-wrapper') as HTMLElement | null;
        const mediaWrapper = blockContent.querySelector('.bn-visual-media-wrapper') as HTMLElement | null;
        const imageEl = blockContent.querySelector('img.bn-visual-media') as HTMLImageElement | null;
        const videoEl = blockContent.querySelector('video.bn-visual-media') as HTMLVideoElement | null;
        if (!wrapper || !mediaWrapper || (!imageEl && !videoEl)) return;

        const currentMediaSrc = imageEl?.getAttribute('src') || videoEl?.getAttribute('src') || '';
        const mediaSrcChanged = !!resolvedMediaUrl && currentMediaSrc !== resolvedMediaUrl;

        if (imageEl && mediaSrcChanged) {
          imageEl.setAttribute('src', resolvedMediaUrl);
        }
        if (videoEl && mediaSrcChanged) {
          videoEl.setAttribute('src', resolvedMediaUrl);
          videoEl.load();
        }

        if (mediaSrcChanged) {
          blockContent.removeAttribute('data-media-broken');
          mediaWrapper.querySelector('.bn-media-broken-placeholder')?.remove();
        }

        // === Broken media detection ===
        const isImage = !!imageEl;
        const isBroken = isImage
          ? (imageEl!.complete && imageEl!.naturalWidth === 0 && !!imageEl!.src)
          : (videoEl!.error !== null && !!videoEl!.src); // videoEl.error is null when OK, MediaError when broken

        // Keep broken state in sync with later load/error events after src rewriting.
        if (!mediaWrapper.dataset.mediaStateBound) {
          mediaWrapper.dataset.mediaStateBound = 'true';
          if (isImage) {
            imageEl!.addEventListener('error', () => {
              mediaWrapper.closest('.bn-block-content')?.setAttribute('data-media-broken', 'true');
              syncImageBlocks();
            });
            imageEl!.addEventListener('load', () => {
              mediaWrapper.closest('.bn-block-content')?.removeAttribute('data-media-broken');
              syncImageBlocks();
            });
          } else if (videoEl) {
            videoEl.addEventListener('error', () => {
              mediaWrapper.closest('.bn-block-content')?.setAttribute('data-media-broken', 'true');
              syncImageBlocks();
            });
            videoEl.addEventListener('loadeddata', () => {
              mediaWrapper.closest('.bn-block-content')?.removeAttribute('data-media-broken');
              syncImageBlocks();
            });
          }
        }

        if (isBroken) {
          blockContent.setAttribute('data-media-broken', 'true');
        }

        // Show/hide broken placeholder
        let placeholder = mediaWrapper.querySelector('.bn-media-broken-placeholder') as HTMLElement | null;
        if (isBroken) {
          if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.className = 'bn-media-broken-placeholder';
            placeholder.contentEditable = 'false';
            placeholder.draggable = false;
            placeholder.innerHTML = `
              <div class="bn-media-broken-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <path d="M21 15l-5-5L5 21"/>
                </svg>
              </div>
              <div class="bn-media-broken-text">${isImage ? '图片' : '视频'}资源丢失</div>
            `;
            mediaWrapper.appendChild(placeholder);
          }
        } else {
          blockContent.removeAttribute('data-media-broken');
          placeholder?.remove();
        }

        const captionFocused = !!wrapper.querySelector('.bn-image-caption:focus');
        const captionOpen = wrapper.dataset.captionOpen === 'true';
        const alignMenuOpen = wrapper.dataset.alignOpen === 'true';
        const isSelected = !captionFocused && !captionOpen && !alignMenuOpen && (blockContent.classList.contains('ProseMirror-selectednode') || selectedIds.has(blockId));
        wrapper.classList.add('bn-image-shell');
        mediaWrapper.classList.add('bn-image-media-shell');
        imageEl?.classList.add('bn-image-media');
        videoEl?.classList.add('bn-image-media');
        wrapper.classList.toggle('is-selected', isSelected);

        if (!wrapper.dataset.selectionBound) {
          wrapper.dataset.selectionBound = 'true';
          wrapper.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            if (target.closest('.bn-image-toolbar, .bn-image-toolbar-menu, .bn-image-caption, .bn-resize-handle')) {
              return;
            }
            activateImageBlockSelection(blockId, wrapper);
          });
          wrapper.addEventListener('dblclick', (event) => {
            const target = event.target as HTMLElement;
            if (target.closest('.bn-image-toolbar, .bn-image-toolbar-menu, .bn-image-caption, .bn-resize-handle')) {
              return;
            }
            activateImageBlockSelection(blockId, wrapper);
            openImageFullscreen(blockId);
          });
        }

        let toolbar = wrapper.querySelector('.bn-image-toolbar') as HTMLElement | null;
        if (!toolbar) {
          toolbar = document.createElement('div');
          toolbar.className = 'bn-image-toolbar';
          toolbar.draggable = false;
          toolbar.contentEditable = 'false';
          toolbar.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
          });
          wrapper.appendChild(toolbar);
        }

        const ensureButton = (
          key: string,
          label: string,
          icon: string | null,
          className: string,
          onClick: () => void,
          skipBlockSelection?: boolean,
        ) => {
          let button = toolbar!.querySelector(`.bn-image-toolbar-button[data-key="${key}"]`) as HTMLButtonElement | null;
          if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            button.draggable = false;
            button.contentEditable = 'false';
            button.className = `bn-image-toolbar-button ${className}`;
            button.dataset.key = key;
            button.onpointerdown = (event) => {
              if (!skipBlockSelection) {
                activateImageBlockSelection(blockId, wrapper);
              }
              event.preventDefault();
              event.stopPropagation();
              onClick();
            };
            toolbar!.appendChild(button);
          }
          button.innerHTML = `${icon ? `<span class="bn-image-toolbar-icon">${icon}</span>` : ''}${label ? `<span class="bn-image-toolbar-label">${label}</span>` : ''}`;
          button.onmousedown = (event) => {
            event.preventDefault();
            event.stopPropagation();
          };
          return button;
        };

        ensureButton('replace', '', IMAGE_TOOLBAR_ICONS.replace, '', () => triggerImageReplace(blockId));
        const currentAlignIcon = currentAlignment === 'left'
          ? IMAGE_TOOLBAR_ICONS.alignLeft
          : currentAlignment === 'right'
            ? IMAGE_TOOLBAR_ICONS.alignRight
            : IMAGE_TOOLBAR_ICONS.alignCenter;
        ensureButton('align', '', currentAlignIcon, '', () => {
          imageBlocks.forEach((otherBlock) => {
            const otherWrapper = otherBlock.querySelector('.bn-file-block-content-wrapper') as HTMLElement | null;
            if (otherWrapper && otherWrapper !== wrapper) {
              otherWrapper.dataset.alignOpen = 'false';
              otherWrapper.querySelector('.bn-image-align-menu')?.remove();
            }
          });
          wrapper.dataset.alignOpen = wrapper.dataset.alignOpen === 'true' ? 'false' : 'true';
          syncImageBlocks();
        }, true); // skipBlockSelection - don't activate NodeSelection for align button
        ensureButton('caption', '', IMAGE_TOOLBAR_ICONS.caption, '', () => {
          wrapper.dataset.captionOpen = 'true';
          syncImageBlocks();
          requestAnimationFrame(() => {
            const captionEl = wrapper.querySelector('.bn-image-caption') as HTMLInputElement | null;
            if (!captionEl) return;
            captionEl.focus();
            captionEl.setSelectionRange(captionEl.value.length, captionEl.value.length);
          });
        }, true); // skipBlockSelection - don't activate NodeSelection for caption button
        ensureButton('fullscreen', '', IMAGE_TOOLBAR_ICONS.fullscreen, '', () => openImageFullscreen(blockId));
        ensureButton('download', '', IMAGE_TOOLBAR_ICONS.download, '', () => downloadImageBlock(blockId));
        let alignMenu = wrapper.querySelector('.bn-image-align-menu') as HTMLElement | null;
        if (wrapper.dataset.alignOpen === 'true') {
          if (!alignMenu) {
            alignMenu = document.createElement('div');
            alignMenu.className = 'bn-image-align-menu';
            alignMenu.draggable = false;
            alignMenu.contentEditable = 'false';
            alignMenu.addEventListener('mousedown', (event) => {
              event.preventDefault();
              event.stopPropagation();
            });
            wrapper.appendChild(alignMenu);
          }

          const items = [
            { key: 'left', icon: IMAGE_TOOLBAR_ICONS.alignLeft },
            { key: 'center', icon: IMAGE_TOOLBAR_ICONS.alignCenter },
            { key: 'right', icon: IMAGE_TOOLBAR_ICONS.alignRight },
          ] as const;
          alignMenu.innerHTML = '';
          items.forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.draggable = false;
            button.contentEditable = 'false';
            button.className = `bn-image-align-menu-item${currentAlignment === item.key ? ' is-active' : ''}`;
            button.innerHTML = `<span class="bn-image-align-menu-icon">${item.icon}</span>`;
            button.onpointerdown = (event) => {
              event.preventDefault();
              event.stopPropagation();
              setImageAlignment(blockId, item.key);
              wrapper.dataset.alignOpen = 'false';
              setBlockSelection(null);
              syncImageBlocks();
            };
            button.onmousedown = (event) => {
              event.preventDefault();
              event.stopPropagation();
            };
            alignMenu!.appendChild(button);
          });
        } else {
          alignMenu?.remove();
        }

        let caption = wrapper.querySelector('.bn-image-caption') as HTMLInputElement | null;
        const captionValue = String(blockProps.caption || '');
        const shouldShowCaption = wrapper.dataset.captionOpen === 'true' || !!captionValue.trim();
        if (shouldShowCaption) {
          if (!caption) {
            caption = document.createElement('input');
            caption.type = 'text';
            caption.className = 'bn-image-caption';
            caption.placeholder = '写一个标题…';
            caption.draggable = false;
            wrapper.appendChild(caption);
            // Prevent ProseMirror's capture-phase mousedown on editor from stealing focus
            caption.addEventListener('mousedown', (event) => {
              event.stopPropagation();
            });
            caption.addEventListener('keydown', (event) => {
              event.stopPropagation();
              if (event.key === 'Enter') {
                event.preventDefault();
                (event.currentTarget as HTMLInputElement).blur();
              }
            });
            caption.addEventListener('focus', () => {
              // Clear ProseMirror NodeSelection so it doesn't intercept typing
              // Without this, ProseMirror still thinks the image block is "selected"
              // and will replace it with text when user types
              try {
                const pmView = (editor as any).prosemirrorView;
                if (pmView && pmView.state.selection instanceof NodeSelection) {
                  const $end = pmView.state.doc.resolve(pmView.state.doc.content.size);
                  pmView.dispatch(pmView.state.tr.setSelection(
                    TextSelection.near($end)
                  ));
                }
              } catch {}
            });
            caption.addEventListener('blur', (event) => {
              saveImageCaption(blockId, (event.currentTarget as HTMLInputElement).value || '');
              if (!(event.currentTarget as HTMLInputElement).value.trim()) {
                wrapper.dataset.captionOpen = 'false';
                syncImageBlocks();
              }
            });
          }
          const inputEl = caption as HTMLInputElement;
          if (inputEl.value !== captionValue && document.activeElement !== inputEl) {
            inputEl.value = captionValue;
          }
        } else {
          caption?.remove();
        }
      });

      // Handle file blocks: bind click to open download URL in new tab
      const fileBlocks = Array.from(editorEl.querySelectorAll('.bn-block-content[data-content-type="file"]')) as HTMLElement[];
      fileBlocks.forEach((blockContent) => {
        const wrapper = blockContent.querySelector('.bn-file-block-content-wrapper') as HTMLElement | null;
        if (!wrapper) return;
        wrapper.style.cursor = 'pointer';
        if (wrapper.dataset.fileClickBound) return;
        wrapper.dataset.fileClickBound = 'true';
        wrapper.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const blockContainer = blockContent.closest('[data-id]');
          const blockId = blockContainer?.getAttribute('data-id');
          if (!blockId) return;
          const block = findBlockDeep(editor.document, blockId!);
          if (!block) return;
          const { spaceSlug, pageId } = identityRef.current;
          const url = resolvePageAssetUrl((block.props as any)?.url, spaceSlug, pageId);
          if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        });
      });
    };

    const scheduleSync = () => requestAnimationFrame(syncImageBlocks);
    const observer = new MutationObserver(scheduleSync);

    observer.observe(editorEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-url', 'data-name'],
    });

    editorEl.addEventListener('scroll', scheduleSync, true);
    window.addEventListener('resize', scheduleSync);
    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest?.('.bn-image-toolbar, .bn-image-toolbar-menu, .bn-image-align-menu, .bn-image-caption, .bn-resize-handle')) return;
      closeImageMenus();
      editorEl.querySelectorAll('.bn-file-block-content-wrapper').forEach((node) => {
        const wrapper = node as HTMLElement;
        if (wrapper.dataset.alignOpen === 'true') {
          wrapper.dataset.alignOpen = 'false';
        }
      });
    };
    document.addEventListener('mousedown', handleDocumentMouseDown, true);

    // Guard: intercept beforeinput and composition events targeting caption input at document
    // level (capture phase), BEFORE ProseMirror's capture-phase handler on the editor element.
    // Do NOT intercept keydown/mousedown — the input needs those events (Enter to finish,
    // click to focus). ProseMirror replaces the image block via beforeinput, not keydown.
    const captionEventGuard = (event: Event) => {
      const target = event.target as HTMLElement;
      if (target && target.closest?.('.bn-image-caption')) {
        event.stopPropagation();
      }
    };
    document.addEventListener('beforeinput', captionEventGuard, true);
    document.addEventListener('compositionstart', captionEventGuard, true);
    document.addEventListener('compositionupdate', captionEventGuard, true);
    document.addEventListener('compositionend', captionEventGuard, true);

    // File block clicks are handled inside syncImageBlocks (direct DOM binding)

    scheduleSync();
    const delayedSyncA = window.setTimeout(syncImageBlocks, 200);
    const delayedSyncB = window.setTimeout(syncImageBlocks, 900);

    return () => {
      observer.disconnect();
      editorEl.removeEventListener('scroll', scheduleSync, true);
      window.removeEventListener('resize', scheduleSync);
      document.removeEventListener('mousedown', handleDocumentMouseDown, true);
      document.removeEventListener('beforeinput', captionEventGuard, true);
      document.removeEventListener('compositionstart', captionEventGuard, true);
      document.removeEventListener('compositionupdate', captionEventGuard, true);
      document.removeEventListener('compositionend', captionEventGuard, true);
      window.clearTimeout(delayedSyncA);
      window.clearTimeout(delayedSyncB);
    };
  }, [
    editorEl,
    readOnly,
    getBlockById,
    triggerImageReplace,
    openImageFullscreen,
    downloadImageBlock,
    duplicateImageBlock,
    deleteImageBlock,
    saveImageCaption,
    setImageAlignment,
  ]);

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

  // Empty toggle heading/list drop target: allow dropping blocks into toggle blocks with no children
  // Pattern follows subpage drop target above (lines 2373-2510)
  useEffect(() => {
    const container = editorRef.current;
    if (!container || readOnly) return;

    // Overlay elements — live outside React tree so re-renders won't destroy them
    let overlayEl: HTMLDivElement | null = null;
    let insertLineEl: HTMLDivElement | null = null;

    const createOverlay = () => {
      if (!overlayEl) {
        overlayEl = document.createElement('div');
        overlayEl.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;border-radius:4px;background:rgba(35,131,226,0.08);display:none;';
        document.body.appendChild(overlayEl);
      }
      if (!insertLineEl) {
        insertLineEl = document.createElement('div');
        insertLineEl.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;height:5px;background:rgba(35,131,226,0.35);border-radius:2px;display:none;';
        document.body.appendChild(insertLineEl);
      }
    };

    const clearToggleHighlight = () => {
      if (overlayEl) overlayEl.style.display = 'none';
      if (insertLineEl) insertLineEl.style.display = 'none';
      // Restore ProseMirror dropcursor if it was hidden
      container.querySelectorAll('.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline')
        .forEach(el => { (el as HTMLElement).style.display = ''; });
    };

    const removeOverlay = () => {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      if (insertLineEl) { insertLineEl.remove(); insertLineEl = null; }
    };

    /** Detect if cursor is over an empty expanded toggle block */
    const findEmptyToggleTarget = (clientX: number, clientY: number): { blockOuter: HTMLElement; toggleBlockId: string } | null => {
      const el = document.elementFromPoint(clientX, clientY);
      if (!el) return null;

      const htmlEl = el as HTMLElement;
      // Must be inside a toggle wrapper (expanded) or the "add block" button
      const toggleWrapper = htmlEl.closest('.bn-toggle-wrapper');
      const addBlockBtn = htmlEl.closest('.bn-toggle-add-block-button');
      const targetEl = toggleWrapper || (addBlockBtn ? addBlockBtn.closest('.bn-block-content') : null);
      if (!targetEl) return null;

      const blockContent = targetEl.closest('.bn-block-content');
      if (!blockContent) return null;

      // Must be a toggleable block (has toggle wrapper and is expanded)
      if (!blockContent.querySelector('.bn-toggle-wrapper')) return null;

      const blockOuter = blockContent.closest('.bn-block-outer') as HTMLElement | null;
      if (!blockOuter) return null;

      // Must have no children (no block group in DOM)
      if (blockOuter.querySelector('.bn-block-group')) return null;

      // Must be expanded (data-show-children="true") — only intercept when user can see the empty area
      const wrapper = blockOuter.querySelector('.bn-toggle-wrapper');
      if (wrapper?.getAttribute('data-show-children') !== 'true') return null;

      const toggleBlockId = blockOuter.querySelector('[data-id]')?.getAttribute('data-id');
      if (!toggleBlockId) return null;

      return { blockOuter, toggleBlockId };
    };

    const positionOverlay = (blockOuter: HTMLElement) => {
      createOverlay();
      const blockContent = blockOuter.querySelector('.bn-block-content');
      if (!blockContent) return;

      const blockRect = blockContent.getBoundingClientRect();
      // Blue overlay: cover the entire toggle area with 2px inset
      const inset = 2;
      overlayEl!.style.left = (blockRect.left + inset) + 'px';
      overlayEl!.style.top = (blockRect.top + inset) + 'px';
      overlayEl!.style.width = (blockRect.width - inset * 2) + 'px';
      overlayEl!.style.height = (blockRect.height - inset * 2) + 'px';
      overlayEl!.style.display = 'block';

      // Blue insertion line: between the toggle heading and "空的切换区" button
      // Left edge aligns with toggle content (not the arrow/heading), right edge to block right
      const inlineContent = blockOuter.querySelector('.bn-inline-content');
      const wrapper = blockOuter.querySelector('.bn-toggle-wrapper');
      if (wrapper) {
        const wrapperRect = wrapper.getBoundingClientRect();
        const contentLeft = inlineContent ? inlineContent.getBoundingClientRect().left : wrapperRect.left + 24;
        insertLineEl!.style.left = contentLeft + 'px';
        insertLineEl!.style.top = wrapperRect.bottom + 'px';
        insertLineEl!.style.width = (blockRect.right - contentLeft - inset) + 'px';
        insertLineEl!.style.display = 'block';
      }
    };

    const handleToggleDragOver = (e: DragEvent) => {
      const dragData = getBlockDragData();
      if (!dragData || dragData.blocks.length === 0) return;

      const target = findEmptyToggleTarget(e.clientX, e.clientY);
      if (!target) {
        clearToggleHighlight();
        return;
      }

      // Prevent dropping on self
      if (dragData.blockIds.includes(target.toggleBlockId)) {
        clearToggleHighlight();
        return;
      }

      // Intercept: prevent ProseMirror default handling
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

      // Hide ProseMirror's dropcursor
      container.querySelectorAll('.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline')
        .forEach(el => { (el as HTMLElement).style.display = 'none'; });

      // Position overlay over the target (re-position every time since layout may change)
      positionOverlay(target.blockOuter);
    };

    const handleToggleDrop = (e: DragEvent) => {
      clearToggleHighlight();

      const dragData = getBlockDragData();
      if (!dragData || dragData.blocks.length === 0) return;

      const target = findEmptyToggleTarget(e.clientX, e.clientY);
      if (!target) return;

      // Prevent dropping on self
      if (dragData.blockIds.includes(target.toggleBlockId)) return;

      // Intercept the drop
      e.preventDefault();
      e.stopPropagation();

      // Add dragged blocks as children of the toggle block
      const children = dragData.blocks.map(b => ({
        type: b.type,
        props: b.props,
        content: b.content,
        children: b.children,
      }));

      try {
        editor.updateBlock(target.toggleBlockId as any, { children } as any);
        // Mark as handled only after successful update, so handleNativeDragEnd removes originals
        markDragHandled();
      } catch (err) {
        console.error('[PageEditor] Failed to drop blocks into empty toggle:', err);
        // updateBlock failed — blocks remain at original positions
      }
    };

    const handleToggleDragLeave = (e: DragEvent) => {
      if (!container.contains(e.relatedTarget as Node)) {
        clearToggleHighlight();
      }
    };

    container.addEventListener('dragover', handleToggleDragOver, true);
    container.addEventListener('drop', handleToggleDrop, true);
    container.addEventListener('dragleave', handleToggleDragLeave);
    return () => {
      container.removeEventListener('dragover', handleToggleDragOver, true);
      container.removeEventListener('drop', handleToggleDrop, true);
      container.removeEventListener('dragleave', handleToggleDragLeave);
      clearToggleHighlight();
      removeOverlay();
    };
  }, [editor, readOnly]);

  // Drag-to-create columns: drag a block to the left/right edge of another block
  useEffect(() => {
    const container = editorRef.current;
    if (!container || readOnly) return;

    let columnLineEl: HTMLDivElement | null = null;
    let lastDragTarget: ColumnDropTarget | null = null;

    const createColumnLine = () => {
      if (!columnLineEl) {
        columnLineEl = document.createElement('div');
        // Base styles only — orientation-specific styles set in handleColumnDragOver
        columnLineEl.style.cssText =
          'position:fixed;z-index:9999;pointer-events:none;display:none;border-radius:2px;';
        document.body.appendChild(columnLineEl);
      }
    };

    const clearColumnHighlight = () => {
      if (columnLineEl) columnLineEl.style.display = 'none';
      lastDragTarget = null;
      // Restore BN's dropcursor visibility so BN can manage it.
      showBNDropCursors();
    };

    const removeColumnLine = () => {
      if (columnLineEl) { columnLineEl.remove(); columnLineEl = null; }
    };

    const DROP_CURSOR_SELECTOR =
      '.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline, ' +
      '.prosemirror-dropcursor-block-horizontal, .prosemirror-dropcursor-block-vertical-left, ' +
      '.prosemirror-dropcursor-block-vertical-right, .prosemirror-dropcursor-vertical';

    /** Hide BlockNote's DropCursor elements (instead of removing, to preserve BN's internal state) */
    const hideBNDropCursors = () => {
      // Use document, not container — BN appends dropcursor to PM view's offsetParent,
      // which may be outside the container element.
      document.querySelectorAll(DROP_CURSOR_SELECTOR)
        .forEach(el => { (el as HTMLElement).style.display = 'none'; });
    };

    /** Restore BlockNote's DropCursor elements that were previously hidden */
    const showBNDropCursors = () => {
      document.querySelectorAll(DROP_CURSOR_SELECTOR)
        .forEach(el => { (el as HTMLElement).style.display = ''; });
    };

    /** Permanently remove BN dropcursor elements (only for drop/dragend/cleanup) */
    const removeBNDropCursors = () => {
      document.querySelectorAll(DROP_CURSOR_SELECTOR)
        .forEach(el => el.remove());
    };

    interface ColumnDropTarget {
      type: 'create' | 'addColumn' | 'insertAround' | 'insertInColumn' | 'moveBlock';
      blockId: string;
      blockOuter: HTMLElement;
      side: 'left' | 'right';
      position?: 'above' | 'below';   // for insertAround / insertInColumn
      columnListId?: string;           // for addColumn / insertAround
      columnBlockId?: string;          // for insertInColumn: the column block to insert relative to
      insertWidth?: number;            // for insertInColumn: width of the indicator line
    }

    const cloneDraggedBlocks = (blocks: Array<{ type: string; props: Record<string, any>; content: any; children: any }>) => (
      blocks.map((block) => JSON.parse(JSON.stringify({
        type: block.type,
        props: block.props,
        content: block.content,
        children: block.children || [],
      })))
    );

    const removeDraggedBlocksFromEditor = (blockIds: string[]) => {
      const existingBlocks = blockIds
        .map((id) => findBlockDeep(editor.document, id))
        .filter(Boolean);
      if (existingBlocks.length > 0) {
        editor.removeBlocks(existingBlocks as any);
      }
    };

    const getTargetVisualKey = (target: ColumnDropTarget | null): string | null => {
      if (!target) return null;

      const rect = target.blockOuter.getBoundingClientRect();
      if (target.type === 'insertAround') {
        const y = Math.round(target.position === 'above' ? rect.top : rect.bottom);
        return `h:around:${target.columnListId}:${y}:${Math.round(rect.left)}:${Math.round(rect.width)}`;
      }
      if (target.type === 'insertInColumn' || target.type === 'moveBlock') {
        const lineW = Math.round(target.insertWidth || rect.width);
        const centerX = Math.round(rect.left + rect.width / 2);
        const y = Math.round(target.position === 'above' ? rect.top : rect.bottom);
        return `h:column:${target.columnListId}:${y}:${centerX}:${lineW}`;
      }

      return `v:${target.type}:${target.blockId}:${target.side}`;
    };

    const stabilizeColumnDropTarget = (target: ColumnDropTarget | null): ColumnDropTarget | null => {
      if (!target || !lastDragTarget) return target;
      const nextKey = getTargetVisualKey(target);
      const prevKey = getTargetVisualKey(lastDragTarget);
      return nextKey && prevKey && nextKey === prevKey ? lastDragTarget : target;
    };

    const getRootLevelBoundaryTarget = (clientX: number, clientY: number): ColumnDropTarget | null => {
      const rootBlocks = Array.from(
        document.querySelectorAll('.bn-editor > .bn-block-group > .bn-block-outer')
      ) as HTMLElement[];
      const BOUNDARY_ZONE_PX = 10;

      for (let i = 0; i < rootBlocks.length - 1; i++) {
        const upper = rootBlocks[i];
        const lower = rootBlocks[i + 1];
        const upperType = upper.querySelector('[data-content-type]')?.getAttribute('data-content-type');
        const lowerType = lower.querySelector('[data-content-type]')?.getAttribute('data-content-type');

        if (upperType !== 'column_list' && lowerType !== 'column_list') continue;
        if (upperType === 'column_list' && lowerType === 'column_list') continue;

        const upperRect = upper.getBoundingClientRect();
        const lowerRect = lower.getBoundingClientRect();
        const boundaryY = (upperRect.bottom + lowerRect.top) / 2;
        if (Math.abs(clientY - boundaryY) > BOUNDARY_ZONE_PX) continue;

        const horizontalLeft = Math.min(upperRect.left, lowerRect.left) - 4;
        const horizontalRight = Math.max(upperRect.right, lowerRect.right) + 4;
        if (clientX < horizontalLeft || clientX > horizontalRight) continue;

        if (lowerType === 'column_list') {
          const columnListId = lower.querySelector('[data-id]')?.getAttribute('data-id');
          if (!columnListId) return null;
          return {
            type: 'insertAround',
            blockId: columnListId,
            blockOuter: lower,
            side: 'left',
            position: 'above',
            columnListId,
          };
        }

        const columnListId = upper.querySelector('[data-id]')?.getAttribute('data-id');
        if (!columnListId) return null;
        return {
          type: 'insertAround',
          blockId: columnListId,
          blockOuter: upper,
          side: 'right',
          position: 'below',
          columnListId,
        };
      }

      return null;
    };

    const findColumnDropTarget = (clientX: number, clientY: number): ColumnDropTarget | null => {
      const rootBoundaryTarget = getRootLevelBoundaryTarget(clientX, clientY);
      if (rootBoundaryTarget) return rootBoundaryTarget;

      const el = document.elementFromPoint(clientX, clientY);
      if (!el) return null;

      const htmlEl = el as HTMLElement;
      const blockOuter = htmlEl.closest('.bn-block-outer') as HTMLElement;

      // ── Phase 1: We hit a .bn-block-outer ──
      if (blockOuter) {
        const blockContent = blockOuter.querySelector('[data-content-type]');
        if (!blockContent) {
          // No content type — try phase 2 (gap/padding area)
          return findColumnDropTargetPhase2(clientX, clientY);
        }
        const contentType = blockContent.getAttribute('data-content-type');
        const blockId = blockOuter.querySelector('[data-id]')?.getAttribute('data-id');
        if (!blockId) return null;

        // ── Case 1: Hit column_list outer ──
        if (contentType === 'column_list') {
          const clRect = blockOuter.getBoundingClientRect();
          const COL_EDGE_PX = 40;
          // Left/right edge → addColumn
          if (clientX <= clRect.left + COL_EDGE_PX) {
            return { type: 'addColumn', blockId: blockId, blockOuter, side: 'left', columnListId: blockId };
          }
          if (clientX >= clRect.right - COL_EDGE_PX) {
            return { type: 'addColumn', blockId: blockId, blockOuter, side: 'right', columnListId: blockId };
          }
          // Top/bottom area → insertAround
          if (clientY <= clRect.top + 12) {
            return { type: 'insertAround', blockId, blockOuter, side: 'left', position: 'above', columnListId: blockId };
          }
          if (clientY >= clRect.bottom - 12) {
            return { type: 'insertAround', blockId, blockOuter, side: 'right', position: 'below', columnListId: blockId };
          }
          // Middle area → let Phase 2 handle gap detection
          return findColumnDropTargetPhase2(clientX, clientY);
        }

        // ── Case 2: Hit a column outer (data-content-type="column") ──
        // This means we're in the column's padding area (24px top/bottom)
        if (contentType === 'column') {
          // Find parent column_list
          const colListOuter = findAncestorColumnListOuter(blockOuter);
          if (!colListOuter) return null;
          const colListId = colListOuter.querySelector('[data-id]')?.getAttribute('data-id');
          if (!colListId) return null;

          // Check if cursor is in the column's top/bottom padding
          const colRect = blockOuter.getBoundingClientRect();
          const contentBlocks = blockOuter.querySelectorAll('.bn-block-group > .bn-block-outer');
          const paddingSize = 12; // matches CSS padding-top/bottom

          // Determine if we're in the top or bottom padding zone
          const inTopPadding = clientY < colRect.top + paddingSize;
          const inBottomPadding = clientY > colRect.bottom - paddingSize;

          if (inTopPadding || inBottomPadding) {
            const pos: 'above' | 'below' = inTopPadding ? 'above' : 'below';
            // Two-layer split: outer half of padding → insertAround, inner half → insertInColumn
            // Distance from column edge vs distance from content
            const distFromEdge = inTopPadding
              ? clientY - colRect.top
              : colRect.bottom - clientY;
            const distFromContent = contentBlocks.length > 0
              ? (inTopPadding
                ? contentBlocks[0].getBoundingClientRect().top - clientY
                : clientY - contentBlocks[contentBlocks.length - 1].getBoundingClientRect().bottom)
              : paddingSize; // empty column: all padding

            if (distFromEdge <= distFromContent) {
              // Closer to column edge → insertAround (full-width horizontal line)
              return {
                type: 'insertAround', blockId: colListId, blockOuter: colListOuter,
                side: pos === 'above' ? 'left' : 'right', position: pos, columnListId: colListId,
              };
            } else {
              // Closer to content → insertInColumn (single-column width horizontal line)
              if (contentBlocks.length > 0) {
                const refBlock = pos === 'above' ? contentBlocks[0] : contentBlocks[contentBlocks.length - 1];
                const refBlockId = refBlock.querySelector('[data-id]')?.getAttribute('data-id');
                if (refBlockId) {
                  return {
                    type: 'insertInColumn', blockId: colListId, blockOuter: refBlock as HTMLElement,
                    side: pos === 'above' ? 'left' : 'right', position: pos,
                    columnListId: colListId, columnBlockId: refBlockId,
                    insertWidth: colRect.width,
                  };
                }
              }
              // Empty column or no content blocks found
              return {
                type: 'insertInColumn', blockId: colListId, blockOuter,
                side: pos === 'above' ? 'left' : 'right', position: pos,
                columnListId: colListId, columnBlockId: blockId,
                insertWidth: colRect.width,
              };
            }
          }
          // Inside column content area but no content block hit → let BN handle
          return null;
        }

        // ── Case 3: Hit a content block inside a column ──
        {
          const colListOuter = findAncestorColumnListOuter(blockOuter);
          if (colListOuter) {
            const colListId = colListOuter.querySelector('[data-id]')?.getAttribute('data-id');

            // Check if cursor is near the LEFT or RIGHT edge of the column_list.
            // Since elementFromPoint always hits content blocks inside columns,
            // Phase 2's edge detection never fires. We must detect edges here.
            const clRect = colListOuter.getBoundingClientRect();
            const COL_EDGE_PX = 20;
            if (clientX <= clRect.left + COL_EDGE_PX) {
              return {
                type: 'addColumn', blockId: colListId!, blockOuter: colListOuter,
                side: 'left', columnListId: colListId!,
              };
            }
            if (clientX >= clRect.right - COL_EDGE_PX) {
              return {
                type: 'addColumn', blockId: colListId!, blockOuter: colListOuter,
                side: 'right', columnListId: colListId!,
              };
            }

            // Also check if cursor is in the gap between two columns.
            // The gap is the region between one column's right edge and the next
            // column's left edge.
            const group = colListOuter.querySelector('.bn-block-group');
            if (group) {
              const columnOuters = group.querySelectorAll(':scope > .bn-block-outer');
              const columnRects = Array.from(columnOuters).map(
                el => (el as HTMLElement).getBoundingClientRect()
              );
              for (let i = 0; i < columnRects.length - 1; i++) {
                if (clientX > columnRects[i].right && clientX < columnRects[i + 1].left) {
                  return {
                    type: 'addColumn', blockId: colListId!, blockOuter: colListOuter,
                    side: 'right', columnListId: colListId!,
                  };
                }
              }
            }

            const bRect = blockOuter.getBoundingClientRect();
            const relY = (clientY - bRect.top) / bRect.height;

            // Use a dead-zone at the boundary: if cursor is very close to the
            // edge, snap to the edge position instead of toggling above/below.
            // This prevents two adjacent lines flickering when cursor is on the
            // boundary between two blocks.
            const DEAD_ZONE = 0.15;
            let pos: 'above' | 'below';
            if (relY < 0.5 - DEAD_ZONE) {
              pos = 'above';
            } else if (relY > 0.5 + DEAD_ZONE) {
              pos = 'below';
            } else {
              // In dead zone — keep the previous position to avoid flickering
              pos = lastDragTarget?.type === 'insertInColumn' && lastDragTarget.position
                ? lastDragTarget.position
                : (relY < 0.5 ? 'above' : 'below');
            }

            // Column-internal insert: move block within the column
            return {
              type: 'insertInColumn',
              blockId: colListId!,
              blockOuter,
              side: pos === 'above' ? 'left' : 'right',
              position: pos,
              columnListId: colListId!,
              columnBlockId: blockId,
              insertWidth: bRect.width,
            };
          }
        }

        // ── Case 4: Normal root-level block ──
        // Inside the block → let BN handle up/down reorder.
        // Front/back insert only triggers when cursor is OUTSIDE the block,
        // handled by Phase 2b below.
        return null;
      }

      // ── Phase 2: No .bn-block-outer hit — check gap/padding of column_list ──
      const p2Result = findColumnDropTargetPhase2(clientX, clientY);
      if (p2Result) return p2Result;

      // ── Phase 2b: Cursor outside any block — check root block edges ──
      // Trigger create when cursor is past a root block's edge.
      // BUT: if the adjacent sibling is a column_list, convert to addColumn instead.
      {
        const rootBlocks = document.querySelectorAll(
          '.bn-editor > .bn-block-group > .bn-block-outer'
        );
        const EDGE_PX = 30; // trigger within 30px outside the block edge
        for (const rOuter of rootBlocks) {
          const bEl = rOuter as HTMLElement;
          const bR = bEl.getBoundingClientRect();
          if (clientY < bR.top || clientY > bR.bottom) continue;

          // Check if this block is a column_list
          const thisContentType = bEl.querySelector('[data-content-type]')?.getAttribute('data-content-type');
          const thisBlockId = bEl.querySelector('[data-id]')?.getAttribute('data-id');

          if (clientX < bR.left - EDGE_PX) {
            const bId = thisBlockId;
            if (!bId) continue;
            // If this block itself is a column_list, addColumn
            if (thisContentType === 'column_list') {
              return { type: 'addColumn', blockId: bId, blockOuter: bEl, side: 'left', columnListId: bId };
            }
            // If adjacent sibling (left side → previous sibling) is column_list, addColumn to it
            // But cursor is to the LEFT of current block, so the column_list would be the previous sibling
            // Actually cursor is to the LEFT of current block's left edge → no sibling there
            // This means cursor is in the gutter → create on this block
            return { type: 'create', blockId: bId, blockOuter: bEl, side: 'left' };
          }
          if (clientX > bR.right + EDGE_PX) {
            const bId = thisBlockId;
            if (!bId) continue;
            if (thisContentType === 'column_list') {
              return { type: 'addColumn', blockId: bId, blockOuter: bEl, side: 'right', columnListId: bId };
            }
            return { type: 'create', blockId: bId, blockOuter: bEl, side: 'right' };
          }
          // Cursor is within the block's horizontal range but elementFromPoint didn't hit a blockOuter.
          // This means we're in the block's padding/margin area.
          // Check if cursor is near the left/right edge of the block.
          if (thisContentType === 'column_list' && thisBlockId) {
            const COL_EDGE_PX = 40;
            if (clientX <= bR.left + COL_EDGE_PX) {
              return { type: 'addColumn', blockId: thisBlockId, blockOuter: bEl, side: 'left', columnListId: thisBlockId };
            }
            if (clientX >= bR.right - COL_EDGE_PX) {
              return { type: 'addColumn', blockId: thisBlockId, blockOuter: bEl, side: 'right', columnListId: thisBlockId };
            }
          }
        }
      }

      return null;
    };

    /** Helper: find the column_list's .bn-block-outer ancestor of a given block */
    const findAncestorColumnListOuter = (blockOuter: HTMLElement): HTMLElement | null => {
      let ancestor = blockOuter.parentElement;
      while (ancestor) {
        const parentOuter = ancestor.closest('.bn-block-outer') as HTMLElement;
        if (parentOuter && parentOuter !== blockOuter) {
          const parentCT = parentOuter.querySelector('[data-content-type]')?.getAttribute('data-content-type');
          if (parentCT === 'column_list') return parentOuter;
        }
        ancestor = parentOuter?.parentElement || ancestor.parentElement;
      }
      return null;
    };

    /** Phase 2: geometric scan when elementFromPoint hits nothing useful (padding/gap zones) */
    const findColumnDropTargetPhase2 = (clientX: number, clientY: number): ColumnDropTarget | null => {
      // Use document (not container) because BlockNote may portal content outside container
      const columnListOuters = document.querySelectorAll(
        '.bn-block-outer:has(.column-list-inner)'
      );

      for (const clOuter of columnListOuters) {
        const colListOuter = clOuter as HTMLElement;
        const clRect = colListOuter.getBoundingClientRect();
        const colListId = colListOuter.querySelector('[data-id]')?.getAttribute('data-id');
        if (!colListId) continue;

        // Check if cursor is within or near the column_list bounds
        if (clientX < clRect.left - 10 || clientX > clRect.right + 10) continue;
        if (clientY < clRect.top - 10 || clientY > clRect.bottom + 10) continue;

        // Get the flex row group (direct child)
        const group = colListOuter.querySelector('.bn-block-group');
        if (!group) continue;
        const groupRect = group.getBoundingClientRect();

        // Get column outers inside the group
        const columnOuters = group.querySelectorAll(':scope > .bn-block-outer');
        if (columnOuters.length === 0) continue;
        const columnRects = Array.from(columnOuters).map(
          el => (el as HTMLElement).getBoundingClientRect()
        );

        // ── Above/below column_list → insertAround (full-width horizontal line) ──
        if (clientY < groupRect.top) {
          return {
            type: 'insertAround', blockId: colListId, blockOuter: colListOuter,
            side: 'left', position: 'above', columnListId: colListId,
          };
        }
        if (clientY > groupRect.bottom) {
          return {
            type: 'insertAround', blockId: colListId, blockOuter: colListOuter,
            side: 'right', position: 'below', columnListId: colListId,
          };
        }

        // ── Check gap between columns → addColumn ──
        for (let i = 0; i < columnRects.length - 1; i++) {
          if (clientX >= columnRects[i].right && clientX <= columnRects[i + 1].left) {
            return {
              type: 'addColumn', blockId: colListId, blockOuter: colListOuter,
              side: 'right', columnListId: colListId,
            };
          }
        }

        // ── Check left/right edge of column_list → addColumn ──
        if (clientX < columnRects[0].left && clientX >= clRect.left) {
          return {
            type: 'addColumn', blockId: colListId, blockOuter: colListOuter,
            side: 'left', columnListId: colListId,
          };
        }
        const lastColRect = columnRects[columnRects.length - 1];
        if (clientX > lastColRect.right && clientX <= clRect.right) {
          return {
            type: 'addColumn', blockId: colListId, blockOuter: colListOuter,
            side: 'right', columnListId: colListId,
          };
        }

        // ── Check if inside a column's padding area → two-layer split ──
        for (let i = 0; i < columnRects.length; i++) {
          const colRect = columnRects[i];
          if (clientX >= colRect.left && clientX <= colRect.right) {
            // Horizontally inside this column
            const contentBlocks = columnOuters[i].querySelectorAll('.bn-block-group > .bn-block-outer');
            const paddingSize = 12;
            if (contentBlocks.length === 0) {
              // Empty column → split by half
              const pos: 'above' | 'below' = clientY < colRect.top + colRect.height / 2 ? 'above' : 'below';
              const distFromEdge = pos === 'above' ? clientY - colRect.top : colRect.bottom - clientY;
              if (distFromEdge < paddingSize / 2) {
                // Outer half → insertAround
                return { type: 'insertAround', blockId: colListId, blockOuter: colListOuter, side: pos === 'above' ? 'left' : 'right', position: pos, columnListId: colListId };
              }
              // Inner half → insertInColumn
              const colBlockId = columnOuters[i].querySelector('[data-id]')?.getAttribute('data-id');
              if (colBlockId) {
                return { type: 'insertInColumn', blockId: colListId, blockOuter: columnOuters[i] as HTMLElement, side: pos === 'above' ? 'left' : 'right', position: pos, columnListId: colListId, columnBlockId: colBlockId, insertWidth: colRect.width };
              }
              return null;
            }
            const firstContentRect = contentBlocks[0].getBoundingClientRect();
            const lastContentRect = contentBlocks[contentBlocks.length - 1].getBoundingClientRect();
            if (clientY < firstContentRect.top) {
              // Above first content block → top padding → two-layer
              const distFromEdge = clientY - colRect.top;
              const distFromContent = firstContentRect.top - clientY;
              const pos = 'above' as const;
              if (distFromEdge <= distFromContent) {
                // Closer to edge → insertAround
                return { type: 'insertAround', blockId: colListId, blockOuter: colListOuter, side: 'left', position: pos, columnListId: colListId };
              }
              const firstContentId = contentBlocks[0].querySelector('[data-id]')?.getAttribute('data-id');
              if (firstContentId) {
                return { type: 'insertInColumn', blockId: colListId, blockOuter: contentBlocks[0] as HTMLElement, side: 'left', position: pos, columnListId: colListId, columnBlockId: firstContentId, insertWidth: colRect.width };
              }
              return null;
            }
            if (clientY > lastContentRect.bottom) {
              // Below last content block → bottom padding → two-layer
              const distFromEdge = colRect.bottom - clientY;
              const distFromContent = clientY - lastContentRect.bottom;
              const pos = 'below' as const;
              if (distFromEdge <= distFromContent) {
                // Closer to edge → insertAround
                return { type: 'insertAround', blockId: colListId, blockOuter: colListOuter, side: 'right', position: pos, columnListId: colListId };
              }
              const lastContentId = contentBlocks[contentBlocks.length - 1].querySelector('[data-id]')?.getAttribute('data-id');
              if (lastContentId) {
                return { type: 'insertInColumn', blockId: colListId, blockOuter: contentBlocks[contentBlocks.length - 1] as HTMLElement, side: 'right', position: pos, columnListId: colListId, columnBlockId: lastContentId, insertWidth: colRect.width };
              }
              return null;
            }
            // Inside content area (between two blocks) → find the nearest content block
            // This prevents BN from drawing its own dropcursor alongside ours
            for (let j = 0; j < contentBlocks.length; j++) {
              const cbRect = contentBlocks[j].getBoundingClientRect();
              if (clientY < cbRect.bottom) {
                // Cursor is above the bottom of this block → insert above it
                const cbId = contentBlocks[j].querySelector('[data-id]')?.getAttribute('data-id');
                if (cbId) {
                  return { type: 'insertInColumn', blockId: colListId, blockOuter: contentBlocks[j] as HTMLElement, side: 'left', position: 'above', columnListId: colListId, columnBlockId: cbId, insertWidth: colRect.width };
                }
                break;
              }
              // Cursor is below this block → check if there's a next block
              if (j < contentBlocks.length - 1) {
                const nextRect = contentBlocks[j + 1].getBoundingClientRect();
                if (clientY < nextRect.top) {
                  // Cursor is in the gap between this block and the next → insert below this block
                  const cbId = contentBlocks[j].querySelector('[data-id]')?.getAttribute('data-id');
                  if (cbId) {
                    return { type: 'insertInColumn', blockId: colListId, blockOuter: contentBlocks[j] as HTMLElement, side: 'right', position: 'below', columnListId: colListId, columnBlockId: cbId, insertWidth: colRect.width };
                  }
                  break;
                }
              } else {
                // Last block, cursor is below it → insert below
                const cbId = contentBlocks[j].querySelector('[data-id]')?.getAttribute('data-id');
                if (cbId) {
                  return { type: 'insertInColumn', blockId: colListId, blockOuter: contentBlocks[j] as HTMLElement, side: 'right', position: 'below', columnListId: colListId, columnBlockId: cbId, insertWidth: colRect.width };
                }
              }
            }
            return null;
          }
        }
      }

      return null;
    };

    const handleColumnDragOver = (e: DragEvent) => {
      const dragData = getBlockDragData();
      if (!dragData || dragData.blocks.length === 0) {
        clearColumnHighlight();
        return;
      }

      const target = stabilizeColumnDropTarget(findColumnDropTarget(e.clientX, e.clientY));
      if (!target) {
        clearColumnHighlight();
        // Not a column drop target — let BN handle it
        columnDragState.target = null;
        return;
      }

      // Don't drop on self (for create type)
      if (target.type === 'create' && dragData.blockIds.includes(target.blockId)) {
        clearColumnHighlight();
        columnDragState.target = null;
        return;
      }

      // For create type: don't allow if target is inside a column
      if (target.type === 'create') {
        const isInsideColumn = !!target.blockOuter.closest('[data-content-type="column"]');
        if (isInsideColumn) {
          clearColumnHighlight();
          columnDragState.target = null;
          return;
        }
      }

      e.preventDefault();
      e.stopPropagation(); // Prevent BN from interfering with our drop target
      lastDragTarget = target;

      // Feed target info to the PM plugin so it can intercept the drop
      if (target.type === 'addColumn' || target.type === 'create' || target.type === 'insertAround'
          || target.type === 'insertInColumn' || target.type === 'moveBlock') {
        columnDragState.target = {
          type: target.type,
          columnListId: target.columnListId,
          blockId: target.blockId,
          side: target.side,
          blockOuter: target.blockOuter,
          position: target.position,
          columnBlockId: target.columnBlockId,
          insertWidth: target.insertWidth,
        } as any;
      } else {
        columnDragState.target = null;
      }
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

      // Hide BN's dropcursor visuals (we show our own indicator)
      hideBNDropCursors();

      // Show indicator line
      createColumnLine();

      if (target.type === 'insertAround') {
        // Horizontal blue line (Notion-style: full-width of column_list, 4px high)
        const rect = target.blockOuter.getBoundingClientRect();
        columnLineEl!.style.width = rect.width + 'px';
        columnLineEl!.style.height = '4px';
        columnLineEl!.style.background = '#ddeeff';
        columnLineEl!.style.left = rect.left + 'px';
        columnLineEl!.style.top = (target.position === 'above' ? rect.top - 2 : rect.bottom + 2) + 'px';
        columnLineEl!.style.display = 'block';
      } else if (target.type === 'insertInColumn' || target.type === 'moveBlock') {
        // Horizontal blue line at the block's edge.
        // Use the same Y position for above/below at the boundary between blocks
        // to avoid flickering when elementFromPoint alternates between blocks.
        const rect = target.blockOuter.getBoundingClientRect();
        const lineW = target.insertWidth || rect.width;
        const centerX = rect.left + rect.width / 2;
        // Both 'above' and 'below' use the same edge: rect.top for above, rect.bottom for below.
        // Since blocks are flush (block_A.bottom === block_B.top), both render at the same Y.
        const lineY = target.position === 'above' ? rect.top : rect.bottom;
        columnLineEl!.style.width = lineW + 'px';
        columnLineEl!.style.height = '4px';
        columnLineEl!.style.background = '#ddeeff';
        columnLineEl!.style.left = (centerX - lineW / 2) + 'px';
        columnLineEl!.style.top = (lineY - 2) + 'px'; // center the 4px line on the edge
        columnLineEl!.style.display = 'block';
      } else {
        // Vertical blue line (create / addColumn)
        const rect = target.blockOuter.getBoundingClientRect();
        columnLineEl!.style.width = '3px';
        columnLineEl!.style.height = rect.height + 'px';
        columnLineEl!.style.background = '#ddeeff';
        columnLineEl!.style.left = (target.side === 'left' ? rect.left - 2 : rect.right + 2) + 'px';
        columnLineEl!.style.top = rect.top + 'px';
        columnLineEl!.style.display = 'block';
      }
    };

    // ── Column drop logic ──
    // This runs inside the ProseMirror handleDOMEvents.drop hook (via ColumnDropPlugin),
    // NOT as a DOM addEventListener. PM's handleDOMEvents runs before DOM listeners,
    // so our previous DOM-level drop handler never fired for blocknote/html drags.
    columnDragState.onDrop = (target: ColumnDragTargetInfo, _pmView: any): boolean => {
      removeColumnLine();

      const dragData = getBlockDragData();
      if (!dragData || dragData.blocks.length === 0) return false;

      const draggedBlocks = cloneDraggedBlocks(dragData.blocks);
      const draggedBlockIds = [...dragData.blockIds];
      const draggedBlockId = draggedBlockIds[0];

      try {
        if (target.type === 'addColumn') {
          // ── Add column to existing column_list ──
          const columnListBlock = findBlockDeep(editor.document, target.columnListId!);
          if (!columnListBlock) return false;

          // Don't allow dragging from inside the same column_list
          if (dragData.blockIds.includes(target.columnListId!)) return false;

          const currentChildren = columnListBlock.children || [];
          const currentCount = currentChildren.length;
          if (currentCount >= 5) return false; // max 5 columns

          // Calculate new widths: new column gets 1/(n+1), others scale proportionally
          // IMPORTANT: Do NOT call updateBlock on existing columns — it corrupts their structure.
          const newCount = currentCount + 1;
          const newColumnWidth = Math.round(100 / newCount);
          const scaleFactor = (100 - newColumnWidth) / 100;

          // Calculate new ratios (CSS will handle the visual width, we just store the props)
          let remaining = 100 - newColumnWidth;
          const allRatios: number[] = [];
          currentChildren.forEach((child: any, i: number) => {
            const oldRatio = child.props?.widthRatio || Math.round(100 / currentCount);
            let newRatio: number;
            if (i < currentChildren.length - 1) {
              newRatio = Math.max(15, Math.round(oldRatio * scaleFactor));
              remaining -= newRatio;
            } else {
              newRatio = Math.max(15, remaining);
            }
            allRatios.push(newRatio);
          });

          // Use editor.transact() to run a PM transaction through BN's pipeline.
          // BN's exec() expects a BN command, not a PM callback.
          // transact() gives us the PM transaction directly.
          (editor as any).transact((tr: any) => {
            const colListId = target.columnListId!;
            const schema = tr.doc.type.schema;
            const blockContainerType = schema.nodes['blockContainer'];
            const blockGroupType = schema.nodes['blockGroup'];
            const columnType = schema.nodes['column'];
            if (!blockContainerType || !blockGroupType || !columnType) {
              return;
            }

            // Find the column_list's blockContainer by data-id
            let colListBCPos = -1;
            let colListBCNode: any = null;
            tr.doc.descendants((node: any, pos: number) => {
              if (colListBCNode) return false;
              if (node.type === blockContainerType && node.attrs.id === colListId) {
                colListBCPos = pos;
                colListBCNode = node;
                return false;
              }
            });
            if (!colListBCNode) {
              return;
            }

            // Find the blockGroup child (contains the column blockContainers)
            let colListGroupNode: any = null;
            let groupNodePos = -1;
            colListBCNode.content.forEach((child: any, offset: number) => {
              if (child.type === blockGroupType) {
                colListGroupNode = child;
                groupNodePos = colListBCPos + 1 + offset;
              }
            });
            if (!colListGroupNode || groupNodePos < 0) {
              return;
            }

            // Build new column:
            // blockContainer[data-id] > column + blockGroup > blockContainer > paragraph
            const newColId = crypto.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).substring(2));
            const childNodes = draggedBlocks.map((block) =>
              blockToNode(block as any, schema, (editor as any).schema.styleSchema),
            );
            const innerGroup = blockGroupType.create(null, childNodes);
            const columnNode = columnType.create({ id: '', widthRatio: newColumnWidth });
            const newColBC = blockContainerType.create({ id: newColId }, PMFragment.from([columnNode, innerGroup]));

            // Insert into blockGroup at correct position
            const insertOffset = target.side === 'left' ? 0 : colListGroupNode.content.size;
            tr.insert(groupNodePos + 1 + insertOffset, newColBC);

            // Update column_list columnRatios attr
            const columnListNode = colListBCNode.firstChild;
            const columnListPos = colListBCPos + 1;
            tr.setNodeMarkup(columnListPos, undefined, {
              ...columnListNode.attrs,
              columnRatios: allRatios.join(','),
            });

            // Also delete the original dragged block within the same transaction
            const draggedPositions: Array<{ pos: number; size: number }> = [];
            tr.doc.descendants((node: any, pos: number) => {
              if (node.type === blockContainerType && draggedBlockIds.includes(node.attrs.id)) {
                draggedPositions.push({ pos, size: node.nodeSize });
              }
            });
            draggedPositions
              .sort((a, b) => b.pos - a.pos)
              .forEach(({ pos, size }) => tr.delete(pos, pos + size));

          });

          markDragHandled();
        } else if (target.type === 'insertAround') {
          // ── Insert around column_list: place block above or below as root-level block ──
          const columnListBlock = findBlockDeep(editor.document, target.columnListId!);
          if (!columnListBlock) return false;

          // Don't allow dragging from inside the same column_list
          if (dragData.blockIds.includes(target.columnListId!)) return false;

          const placement = target.position === 'above' ? 'before' : 'after';
          editor.insertBlocks(draggedBlocks as any, columnListBlock, placement);

          removeDraggedBlocksFromEditor(draggedBlockIds);

          markDragHandled();
        } else if (target.type === 'insertInColumn') {
          // ── Insert within a column: move block before/after the target content block ──
          const targetBlock = findBlockDeep(editor.document, target.columnBlockId!);
          if (!targetBlock) return false;

          // Don't drop on self
          if (dragData.blockIds.includes(target.columnBlockId!)) return false;

          const placement = target.position === 'above' ? 'before' : 'after';
          editor.insertBlocks(draggedBlocks as any, targetBlock, placement);

          removeDraggedBlocksFromEditor(draggedBlockIds);

          markDragHandled();
        } else if (target.type === 'moveBlock') {
          // ── Move block before/after the target block (normal block-to-block) ──
          const targetBlock = findBlockDeep(editor.document, target.blockId);
          if (!targetBlock) return false;

          // Don't drop on self
          if (dragData.blockIds.includes(target.blockId)) return false;

          const placement = target.position === 'above' ? 'before' : 'after';
          editor.insertBlocks(draggedBlocks as any, targetBlock, placement);

          removeDraggedBlocksFromEditor(draggedBlockIds);

          markDragHandled();
        } else {
          // ── Create new column_list — BUT check if adjacent to an existing column_list first ──
          if (dragData.blockIds.includes(target.blockId)) return false;

          const isInsideColumn = !!target.blockOuter.closest('[data-content-type="column"]');
          if (isInsideColumn) return false;

          // Check if an adjacent sibling block is a column_list.
          // If so, we should addColumn to it instead of creating a new column_list.
          const targetBlockInDoc = findBlockDeep(editor.document, target.blockId);
          if (targetBlockInDoc) {
            // Find the parent block group's children to locate siblings
            const siblingIds = editor.document
              .filter(() => true) // root-level blocks
              .map((b: any) => b.id);
            const targetIdx = siblingIds.indexOf(target.blockId);

            // Check adjacent block
            const adjacentIdx = target.side === 'left' ? targetIdx - 1 : targetIdx + 1;
            if (adjacentIdx >= 0 && adjacentIdx < siblingIds.length) {
              const adjacentBlock = findBlockDeep(editor.document, siblingIds[adjacentIdx]);
              if (adjacentBlock && adjacentBlock.type === 'column_list') {
                // Redirect: addColumn to the adjacent column_list instead of creating new
                // Redirect: addColumn to the adjacent column_list instead of creating new
                const currentChildren = adjacentBlock.children || [];
                const newCount = currentChildren.length + 1;
                const newColumnWidth = Math.round(100 / newCount);
                const scaleFactor = (100 - newColumnWidth) / 100;

                let remaining = 100 - newColumnWidth;
                const allRatios: number[] = [];
                currentChildren.forEach((child: any, i: number) => {
                  const oldRatio = child.props?.widthRatio || Math.round(100 / currentChildren.length);
                  let newRatio: number;
                  if (i < currentChildren.length - 1) {
                    newRatio = Math.max(15, Math.round(oldRatio * scaleFactor));
                    remaining -= newRatio;
                  } else {
                    newRatio = Math.max(15, remaining);
                  }
                  allRatios.push(newRatio);
                });

                const colListId = adjacentBlock.id;
                (editor as any).transact((tr: any) => {
                  const schema = tr.doc.type.schema;
                  const blockContainerType = schema.nodes['blockContainer'];
                  const blockGroupType = schema.nodes['blockGroup'];
                  const columnType = schema.nodes['column'];
                  if (!blockContainerType || !blockGroupType || !columnType) return;

                  let colListBCPos = -1;
                  let colListBCNode: any = null;
                  tr.doc.descendants((node: any, pos: number) => {
                    if (colListBCNode) return false;
                    if (node.type === blockContainerType && node.attrs.id === colListId) {
                      colListBCPos = pos;
                      colListBCNode = node;
                      return false;
                    }
                  });
                  if (!colListBCNode) return;

                  let colListGroupNode: any = null;
                  let groupNodePos = -1;
                  colListBCNode.content.forEach((child: any, offset: number) => {
                    if (child.type === blockGroupType) {
                      colListGroupNode = child;
                      groupNodePos = colListBCPos + 1 + offset;
                    }
                  });
                  if (!colListGroupNode || groupNodePos < 0) return;

                  const newColId = crypto.randomUUID?.() || Date.now().toString(36);
                  const childNodes = draggedBlocks.map((block) =>
                    blockToNode(block as any, schema, (editor as any).schema.styleSchema),
                  );
                  const innerGroup = blockGroupType.create(null, childNodes);
                  const columnNode = columnType.create({ id: '', widthRatio: newColumnWidth });
                  const newColBC = blockContainerType.create({ id: newColId }, PMFragment.from([columnNode, innerGroup]));

                  const insertOffset = target.side === 'left' ? 0 : colListGroupNode.content.size;
                  tr.insert(groupNodePos + 1 + insertOffset, newColBC);

                  const columnListNode = colListBCNode.firstChild;
                  const columnListPos = colListBCPos + 1;
                  tr.setNodeMarkup(columnListPos, undefined, {
                    ...columnListNode.attrs,
                    columnRatios: allRatios.join(','),
                  });

                  const draggedPositions: Array<{ pos: number; size: number }> = [];
                  tr.doc.descendants((node: any, pos: number) => {
                    if (node.type === blockContainerType && draggedBlockIds.includes(node.attrs.id)) {
                      draggedPositions.push({ pos, size: node.nodeSize });
                    }
                  });
                  draggedPositions
                    .sort((a, b) => b.pos - a.pos)
                    .forEach(({ pos, size }) => tr.delete(pos, pos + size));
                });

                markDragHandled();
                removeBNDropCursors();
                lastDragTarget = null;
                return true;
              }
            }
          }

          // Build the two column children (normal create behavior)
          const makeColumnChild = (block: any) => ({
            type: 'column',
            props: { widthRatio: 50 },
            children: Array.isArray(block) ? block : [block],
          });

          const leftChild = target.side === 'left'
            ? makeColumnChild(draggedBlocks)
            : makeColumnChild(findBlockDeep(editor.document, target.blockId));
          const rightChild = target.side === 'left'
            ? makeColumnChild(findBlockDeep(editor.document, target.blockId))
            : makeColumnChild(draggedBlocks);

          // Insert the column_list before the target block
          editor.insertBlocks([{
            type: 'column_list' as any,
            props: { columnRatios: '50,50' } as any,
            children: [leftChild, rightChild],
          } as any], target.blockId, 'before');

          // Remove the original blocks
          editor.removeBlocks([findBlockDeep(editor.document, target.blockId)!]);
          if (draggedBlockId !== target.blockId) {
            removeDraggedBlocksFromEditor(draggedBlockIds);
          }

          markDragHandled();
        }

        // Remove BN dropcursors after successful column operation
        removeBNDropCursors();
        lastDragTarget = null;
        return true; // Handled — tell PM to stop processing this drop
      } catch (err) {
        console.error('[PageEditor] Failed to create/modify column layout:', err);
        return false;
      }
    };

    const handleColumnDragLeave = (e: DragEvent) => {
      if (!container.contains(e.relatedTarget as Node)) {
        clearColumnHighlight();
      }
    };

    // dragover: registered on window (capture phase) so it fires before BN's handlers.
    // drop: handled by ColumnDropPlugin (PM handleDOMEvents), NOT via DOM addEventListener,
    // because PM's handleDOMEvents.drop runs before any DOM addEventListener('drop').
    window.addEventListener('dragover', handleColumnDragOver, true);
    document.addEventListener('dragleave', handleColumnDragLeave);
    const handleColumnDragEnd = () => { removeColumnLine(); removeBNDropCursors(); columnDragState.target = null; };
    document.addEventListener('dragend', handleColumnDragEnd);
    return () => {
      window.removeEventListener('dragover', handleColumnDragOver, true);
      document.removeEventListener('dragleave', handleColumnDragLeave);
      document.removeEventListener('dragend', handleColumnDragEnd);
      columnDragState.onDrop = null;
      columnDragState.target = null;
      clearColumnHighlight();
      removeColumnLine();
      removeBNDropCursors();
    };
  }, [editor, readOnly]);

  useEffect(() => {
    if (readOnly) return;

    const handleFileDragOver = (e: DragEvent) => {
      if (getBlockDragData()) return;
      const hasFiles = !!e.dataTransfer?.types?.includes('Files');
      if (!hasFiles) return;

      // 落点在 Claude 聊天面板上：放行，让聊天面板处理
      const overEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (overEl?.closest('[data-claude-chat="true"]')) return;

      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleFileDrop = async (e: DragEvent) => {
      if (getBlockDragData()) return;

      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) return;

      // 落点在 Claude 聊天面板上：放行，让聊天面板处理
      const dropTarget = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (dropTarget?.closest('[data-claude-chat="true"]')) return;

      e.preventDefault();
      e.stopPropagation();

      const targetBlockEl = dropTarget?.closest('[data-id]') as HTMLElement | null;
      const targetBlockId = targetBlockEl?.getAttribute('data-id') || null;

      let referenceBlock: any = null;
      let placement: 'before' | 'after' = 'after';

      if (targetBlockId) {
        referenceBlock = findBlockDeep(editor.document, targetBlockId) || null;
        if (referenceBlock && targetBlockEl) {
          const rect = targetBlockEl.getBoundingClientRect();
          placement = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        }
      }

      if (!referenceBlock) {
        referenceBlock = editor.document[editor.document.length - 1] || null;
      }

      for (const file of files) {
        const fileType = getFileBlockType(file);
        const objectUrl = (fileType === 'image' || fileType === 'video') ? URL.createObjectURL(file) : undefined;
        const newBlock: any = {
          type: fileType,
          props: {
            name: file.name,
            ...(fileType === 'image' || fileType === 'video' ? { textAlignment: 'center' } : {}),
            ...(objectUrl ? { url: objectUrl } : {}),
          },
        };

        let insertedBlock: any = null;
        if (
          referenceBlock &&
          Array.isArray(referenceBlock.content) &&
          referenceBlock.content.length === 0
        ) {
          insertedBlock = editor.updateBlock(referenceBlock, newBlock);
        } else if (referenceBlock) {
          insertedBlock = editor.insertBlocks([newBlock], referenceBlock, placement)[0];
        } else {
          insertedBlock = editor.insertBlocks([newBlock], editor.document[0], 'before')[0];
        }

        setFileUploadStates((prev) => ({
          ...prev,
          [insertedBlock.id]: {
            progress: 0,
            status: 'uploading',
            objectUrl,
          },
        }));

        try {
          const { spaceSlug, pageId } = identityRef.current;
          const uploadedPath = await uploadApi.uploadWithProgress(file, {
            pageId,
            spaceSlug,
            onProgress: (progress) => {
              setFileUploadStates((prev) => {
                const current = prev[insertedBlock.id];
                if (!current) return prev;
                return {
                  ...prev,
                  [insertedBlock.id]: {
                    ...current,
                    progress,
                  },
                };
              });
            },
          });

          editor.updateBlock(insertedBlock, {
            props: {
              name: file.name,
              url: uploadedPath.path,
            },
          } as any);

          setFileUploadStates((prev) => {
            const next = { ...prev };
            const current = next[insertedBlock.id];
            if (current?.objectUrl) {
              URL.revokeObjectURL(current.objectUrl);
            }
            delete next[insertedBlock.id];
            return next;
          });
        } catch (error) {
          console.error('[FileDrop] upload FAILED', error);
          setFileUploadStates((prev) => ({
            ...prev,
            [insertedBlock.id]: {
              progress: prev[insertedBlock.id]?.progress ?? 0,
              status: 'error',
              objectUrl,
            },
          }));
        }

        referenceBlock = insertedBlock;
        placement = 'after';
      }
    };

    window.addEventListener('dragover', handleFileDragOver, true);
    window.addEventListener('drop', handleFileDrop, true);
    return () => {
      window.removeEventListener('dragover', handleFileDragOver, true);
      window.removeEventListener('drop', handleFileDrop, true);
    };
  }, [editor, readOnly]);

  // Persist fileContent block edits to <space>/_files/ via the files API.
  // Only blocks whose text content differs from the recorded baseline are
  // written; blocks observed for the first time are recorded as baseline
  // without a write (so freshly-hydrated content from the API doesn't get
  // redundantly pushed back). Returns when all writes have settled.
  //
  // MUST be awaited before createMirror so that, by the time syncModule
  // pushes the page markdown, the referenced files are already up to date.
  const persistFileContentBlocks = useCallback(
    async (blocks: any[], spaceSlug: string) => {
      if (!spaceSlug) return;
      const baseline = fileContentBaselineRef.current;
      // Stale entries (block deleted) — drop them so the map doesn't grow
      // without bound across edits.
      const liveIds = new Set(blocks.filter((b) => b?.id).map((b) => b.id));
      for (const id of Array.from(baseline.keys())) {
        if (!liveIds.has(id)) baseline.delete(id);
      }
      await Promise.all(
        blocks
          .filter((b) => b?.type === 'fileContent' && b?.props?.path)
          .map(async (b) => {
            const text = (b.content ?? [])
              .map((c: any) => c?.text ?? '')
              .join('');
            const prev = baseline.get(b.id);
            if (prev === undefined) {
              // First time we see this block — record baseline, don't write.
              // (Content was either just hydrated from disk or just bound
              // to an uploaded file; in both cases the file already matches.)
              baseline.set(b.id, text);
              return;
            }
            if (text === prev) return;
            try {
              await writeSpaceFile(spaceSlug, b.props.path, text);
              baseline.set(b.id, text);
            } catch (err) {
              console.error('[fileContent] write failed', b.props.path, err);
              // Leave baseline untouched so the next attempt retries.
            }
          })
      );
    },
    []
  );

  // Write mirror to IndexedDB — fast, local, no network
  const triggerMirror = useCallback(async () => {
    if (!hasChangesRef.current || readOnlyRef.current) return;

    const currentBlocks = editor.document;
    const { spaceSlug, pageId } = identityRef.current;
    await flushAllSyncedBlockSaves(currentBlocks, spaceSlug, pageId);
    // Push fileContent edits to the backend first so files are up to date
    // before syncModule ships the page markdown that references them.
    await persistFileContentBlocks(currentBlocks, spaceSlug);
    const markdown = blocksToMarkdown(currentBlocks);
    await createMirror(spaceSlug, pageId, markdown);

    hasChangesRef.current = false;
    onSyncStatusChangeRef.current?.('syncing');
  }, [editor, persistFileContentBlocks]);

  // Cmd+S / Ctrl+S: immediate mirror + flush sync
  useEffect(() => {
    if (readOnly) return;
    const handleSaveShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();

        const currentBlocks = editor.document;
        const { spaceSlug, pageId } = identityRef.current;
        void (async () => {
          try {
            await flushAllSyncedBlockSaves(currentBlocks, spaceSlug, pageId);
            // Persist fileContent edits before serializing markdown so files
            // and page stay consistent on the backend.
            await persistFileContentBlocks(currentBlocks, spaceSlug);
            const markdown = blocksToMarkdown(editor.document);
            await createMirror(spaceSlug, pageId, markdown);
            hasChangesRef.current = false;
            onSyncStatusChangeRef.current?.('syncing');
            await flushSync();
          } catch (err) {
            hasChangesRef.current = true;
            onSyncStatusChangeRef.current?.('unsaved');
            console.error('[PageEditor] Save failed:', err);
            showToast('保存失败，请稍后重试');
          }
        })();
      }
    };
    document.addEventListener('keydown', handleSaveShortcut);
    return () => document.removeEventListener('keydown', handleSaveShortcut);
  }, [editor, readOnly, persistFileContentBlocks]);

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
    // mirror 的 load() 在 hydrate 期间触发的 updateBlock 不应视为用户编辑
    if (isPageChangeSuppressed()) return;
    // Normalize column layouts after deletion:
    // 1. remove empty columns
    // 2. dissolve column_list when only one non-empty column remains
    // 3. remove empty column_list skeletons
    if (!isNormalizingColumnsRef.current) {
      isNormalizingColumnsRef.current = true;
      try {
        const doc = editor.document;
        for (const block of doc) {
          if (block.type !== 'column_list') continue;

          const liveBlock = editor.getBlock(block.id);
          if (!liveBlock) continue;
          const liveChildren = (liveBlock?.children || []) as any[];
          if (liveChildren.length === 0) {
            editor.removeBlocks([liveBlock]);
            break;
          }

          const nonEmptyColumns = liveChildren.filter(
            (col: any) => Array.isArray(col.children) && col.children.length > 0
          );

          if (nonEmptyColumns.length === liveChildren.length) continue;

          if (nonEmptyColumns.length === 0) {
            editor.removeBlocks([liveBlock]);
            break;
          }

          if (nonEmptyColumns.length === 1) {
            const liftedBlocks = (nonEmptyColumns[0].children || []).map((child: any) => ({
              type: child.type,
              props: child.props,
              content: child.content,
              children: child.children || [],
            }));
            if (liftedBlocks.length > 0) {
              editor.insertBlocks(liftedBlocks as any, liveBlock, 'after');
            }
            editor.removeBlocks([liveBlock]);
            break;
          }

          const emptyColumns = liveChildren.filter(
            (col: any) => !Array.isArray(col.children) || col.children.length === 0
          );
          if (emptyColumns.length === 0) continue;

          const emptyColumnIds = new Set(emptyColumns.map((col: any) => col.id));
          const liveProps = liveBlock.props as any;
          const ratiosFromProps = typeof liveProps?.columnRatios === 'string'
            ? (liveProps.columnRatios as string).split(',').map(Number)
            : [];
          const fallbackRatio = Math.round(100 / liveChildren.length);
          const sourceRatios = liveChildren.map((col: any, index: number) => {
            const liveWidthRatio = Number(col.props?.widthRatio);
            const ratio = ratiosFromProps[index];
            return Number.isFinite(liveWidthRatio) && liveWidthRatio > 0
              ? liveWidthRatio
              : (Number.isFinite(ratio) && ratio > 0 ? ratio : fallbackRatio);
          });
          const removedIndices = liveChildren.reduce((indices: number[], col: any, index: number) => {
            if (emptyColumnIds.has(col.id)) indices.push(index);
            return indices;
          }, []);
          const blockEl = document.querySelector(`[data-column-list-id="${block.id}"]`)?.closest('.bn-block');
          const blockGroup = blockEl?.querySelector(':scope > .bn-block-group') as HTMLElement | null;
          const containerWidth = blockGroup?.getBoundingClientRect().width ?? 0;
          const columnOuters = blockGroup
            ? Array.from(blockGroup.querySelectorAll(':scope > .bn-block-outer')) as HTMLElement[]
            : [];
          const visibleWidths = columnOuters.map((outer) => outer.getBoundingClientRect().width);
          const normalizedRatios = visibleWidths.length === liveChildren.length
            ? redistributeColumnRatiosFromWidths(visibleWidths, removedIndices, containerWidth)
            : redistributeColumnRatios(sourceRatios, removedIndices, containerWidth);

          editor.removeBlocks(emptyColumns);

          updateColumnListRatios(editor, block.id, normalizedRatios);
          break;
        }
      } catch {
        // ignore during cleanup
      } finally {
        isNormalizingColumnsRef.current = false;
      }
    }

    hasChangesRef.current = true;
    onSyncStatusChangeRef.current?.('unsaved');

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      triggerMirror().catch((err) => {
        hasChangesRef.current = true;
        onSyncStatusChangeRef.current?.('unsaved');
        console.error('[PageEditor] Auto save failed:', err);
      });
    }, 1000);
  }, [triggerMirror]);

  useEffect(() => {
    if (readOnly) return;

    const waitForRemovedBlocks = async (blockIds: string[]) => {
      if (blockIds.length === 0) return;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const allRemoved = blockIds.every((id) => !findBlockDeep(editor.document, id));
        if (allRemoved) return;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    };

    const handleBlocksRemoved = (event: Event) => {
      const blockIds = ((event as CustomEvent<{ blockIds?: string[] }>).detail?.blockIds || [])
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      hasChangesRef.current = true;
      onSyncStatusChangeRef.current?.('unsaved');
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      void (async () => {
        await waitForRemovedBlocks(blockIds);
        const currentBlocks = editor.document;
        const { spaceSlug, pageId } = identityRef.current;
        await flushAllSyncedBlockSaves(currentBlocks, spaceSlug, pageId);
        await persistFileContentBlocks(currentBlocks, spaceSlug);
        const markdown = blocksToMarkdown(currentBlocks);
        await createMirror(spaceSlug, pageId, markdown);
        hasChangesRef.current = false;
        onSyncStatusChangeRef.current?.('syncing');
        await flushSync();
        await useSpaceStore.getState().refreshAll();
      })().catch((err) => {
        hasChangesRef.current = true;
        onSyncStatusChangeRef.current?.('unsaved');
        console.error('[PageEditor] Delete save failed:', err);
      });
    };

    document.addEventListener('ak-blocks-removed', handleBlocksRemoved);
    return () => document.removeEventListener('ak-blocks-removed', handleBlocksRemoved);
  }, [editor, persistFileContentBlocks, readOnly]);

  // Undo/redo compensation for subpage blocks
  // Detects when undo/redo adds/removes subpage blocks and compensates with backend API calls
  useEffect(() => {
    if (!editor || readOnly) return;
    return editor.onChange((_editor, context) => {
      const changes = context.getChanges();
      const undoRedoChanges = changes.filter(
        (c: any) =>
          (c.source.type === 'undo' || c.source.type === 'redo' || c.source.type === 'undo-redo')
          && c.block.type === 'subpage'
          && (c.block.props as any)?.pageId
      );
      if (undoRedoChanges.length === 0) return;

      const slug = useSpaceStore.getState().currentSpace?.slug;
      if (!slug) return;

      (async () => {
        for (const change of undoRedoChanges) {
          const pageId = (change.block.props as any).pageId;
          try {
            if (change.type === 'delete') {
              // A subpage block was removed by undo — look up the correct action
              const undoAction = getSubpageUndoAction(pageId);
              clearSubpageUndoAction(pageId);
              if (undoAction?.action === 'moveBack') {
                // Was moved from another parent: move it back
                await pagesApi.move(undoAction.spaceSlug, pageId, undoAction.fromParentId, null);
              } else {
                // Was created by paste: delete the backend page
                await pagesApi.delete(slug, pageId);
              }
            } else if (change.type === 'insert') {
              // A subpage block was restored by undo (undo of delete)
              // Only try restore if page is actually in trash (not on disk)
              addPendingRestore(pageId);
              try {
                await pagesApi.restoreById(slug, pageId);
              } catch {
                // 404 = page still on disk, not in trash — nothing to restore
              }
              removePendingRestore(pageId);
            }
          } catch (err) {
            removePendingRestore(pageId);
            // Don't log noise — restoreById 404 is expected when page is on disk
          }
        }
        // Refresh sidebar after all backend operations complete
        await useSpaceStore.getState().refreshAll();
      })();
    });
  }, [editor, readOnly]);

  // Copy handler — preserve native text copy inside code blocks.
  // BlockNote serializes editor selections to markdown on copy, which breaks
  // manual code selections by injecting markdown-oriented formatting.
  useEffect(() => {
    const container = editorRef.current;
    if (!container || readOnly) return;

    const handleCopy = (e: ClipboardEvent) => {
      // Bail out for form fields living inside the editor wrapper but outside
      // the actual editor content (FindReplacePanel search/replace inputs,
      // slash-menu search, link-toolbar inputs). They must handle Cmd+C via
      // the browser/input default; otherwise the container-level capture
      // handler would intercept the copy before the input sees it.
      const copyTargetEl = e.target as HTMLElement | null;
      if (copyTargetEl && (copyTargetEl.tagName === 'INPUT' || copyTargetEl.tagName === 'TEXTAREA')) {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

      const anchorElement = selection.anchorNode instanceof Element
        ? selection.anchorNode
        : selection.anchorNode?.parentElement;
      const focusElement = selection.focusNode instanceof Element
        ? selection.focusNode
        : selection.focusNode?.parentElement;

      const anchorCodeBlock = anchorElement?.closest('[data-content-type="codeBlock"]');
      const focusCodeBlock = focusElement?.closest('[data-content-type="codeBlock"]');

      if (!anchorCodeBlock || anchorCodeBlock !== focusCodeBlock) return;

      const selectedText = selection.toString().replace(/\u200b/g, '');
      if (!selectedText) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.clipboardData?.setData('text/plain', selectedText);
    };

    container.addEventListener('copy', handleCopy, true);
    return () => container.removeEventListener('copy', handleCopy, true);
  }, [readOnly]);

  const persistEditorNow = useCallback(async () => {
    const { spaceSlug, pageId } = identityRef.current;
    await flushAllSyncedBlockSaves(editor.document, spaceSlug, pageId);
    await persistFileContentBlocks(editor.document, spaceSlug);
    const markdown = blocksToMarkdown(editor.document);
    await createMirror(spaceSlug, pageId, markdown);
    hasChangesRef.current = false;
    await flushSync();
    await useSpaceStore.getState().refreshAll();
  }, [editor, persistFileContentBlocks]);

  const insertBlocksAtCursor = useCallback((blocks: any[]) => {
    const currentBlock = editor.getTextCursorPosition().block;
    const blocksToInsert = blocks.map((b: any) => {
      const { id, ...rest } = b;
      return rest;
    });
    const isEmpty = !currentBlock.content || (Array.isArray(currentBlock.content) && currentBlock.content.length === 0);
    if (isEmpty) {
      editor.replaceBlocks([currentBlock], blocksToInsert as any);
    } else {
      editor.insertBlocks(blocksToInsert as any, currentBlock, 'after');
    }
    editor.focus();
  }, [editor]);

  const handleNormalSyncedPaste = useCallback(async () => {
    if (!syncedPaste) return;
    insertBlocksAtCursor(syncedPaste.blocks);
    // 不清理剪贴板信号：跟随系统剪贴板生命周期，用户可在多个页面继续粘贴
    setSyncedPaste(null);
    await persistEditorNow();
  }, [insertBlocksAtCursor, persistEditorNow, syncedPaste]);

  const handleCreateSyncedPaste = useCallback(async () => {
    if (!syncedPaste) return;
    const { spaceSlug, pageId } = identityRef.current;
    const sourceBlockId = newSyncId();
    const mirrorSyncId = newSyncId();
    try {
      const wrapped = await syncedBlocksApi.wrapSource(spaceSlug, {
        sourcePageId: syncedPaste.sourcePageId,
        sourceMd: syncedPaste.sourceMarkdown,
        newSyncId: sourceBlockId,
        mirrorPageId: pageId,
        mirrorSyncId,
      });
      insertBlocksAtCursor([{
        type: 'syncedBlockMirror',
        props: {
          syncId: mirrorSyncId,
          sourcePageId: wrapped.sourcePageId,
          sourceBlockId: wrapped.sourceBlockId,
          pageId,
        },
      }]);
      // 覆盖系统剪贴板：blocks 改为指向 A 源的 mirror block，isSyncedCandidate=false。
      // 后续在 C/D/E... 粘贴时不再弹框，prepareCopiedBlocksForPaste 会把这个 mirror
      // 转成新页上的引用块（指向同一 A 源），避免重复 wrapSource 产生嵌套损坏。
      void writeAkmdClipboard({
        blocks: [{
          type: 'syncedBlockMirror',
          props: {
            syncId: newSyncId(),
            sourcePageId: wrapped.sourcePageId,
            sourceBlockId: wrapped.sourceBlockId,
            pageId: '',
          },
        }],
        markdown: syncedPaste.markdown,
        isCut: false,
        sourceSpaceSlug: spaceSlug,
        sourcePageId: wrapped.sourcePageId,
        sourceBlockIds: [wrapped.sourceBlockId],
        sourceMarkdown: syncedPaste.markdown,
        isSyncedCandidate: false,
      });
      // 不清理剪贴板信号：跟随系统剪贴板生命周期，用户可在多个页面继续创建同步块引用
      setSyncedPaste(null);
      await persistEditorNow();
    } catch (err) {
      console.error('[syncedBlock] wrap source failed:', err);
      showToast('无法创建同步块：源内容已变化');
    }
  }, [insertBlocksAtCursor, persistEditorNow, syncedPaste]);

  const handleSyncedDeleteStrategy = useCallback(async (strategy: 'cascade' | 'placeholder' | 'inline') => {
    if (!syncedDelete?.block) return;
    const { spaceSlug, pageId } = identityRef.current;
    const block = syncedDelete.block;
    setSyncedDelete(null);
    try {
      await syncedBlocksApi.delete(spaceSlug, pageId, block.props?.syncId, strategy);
      removeBlocksEnhanced(editor, [{ id: block.id } as any]);
      await persistEditorNow();
    } catch (err) {
      console.error('[syncedBlock] delete failed:', err);
      showToast('删除同步块失败');
    }
  }, [editor, persistEditorNow, syncedDelete]);

  // Paste handler — capture phase to intercept before BlockNote/ProseMirror processes
  useEffect(() => {
    const container = editorRef.current;
    if (!container || readOnly) return;

    const handlePaste = (e: ClipboardEvent) => {
      // Same form-field guard as handleCopy: FindReplacePanel/ slash-menu /
      // link-toolbar inputs must receive paste directly. Otherwise, when the
      // clipboard happens to carry our custom akmd MIME (from any prior
      // in-editor copy), this handler would call preventDefault() +
      // stopImmediatePropagation() and paste the blocks into the document
      // instead of the input the user is focused on.
      const pasteTargetEl = e.target as HTMLElement | null;
      if (pasteTargetEl && (pasteTargetEl.tagName === 'INPUT' || pasteTargetEl.tagName === 'TEXTAREA')) {
        return;
      }

      const { spaceSlug, pageId } = identityRef.current;
      const payload = readAkmdClipboard(e);

      // 命中自定义 MIME：来自我们自己的复制
      if (payload) {
        // 跨页 + 候选同步块 → 弹框让用户选择
        if (
          payload.isSyncedCandidate &&
          payload.sourceSpaceSlug === spaceSlug &&
          payload.sourcePageId !== pageId
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setSyncedPaste(payload);
          return;
        }

        // 其他情况：作为内部 block 粘贴
        e.preventDefault();
        e.stopImmediatePropagation();

        // 块选择模式：先移除选中块
        const selectedIds = getSelectedBlockIds();
        if (selectedIds.length > 0) {
          removeBlocksEnhanced(editor, selectedIds.map(id => ({ id } as any)));
          setBlockSelection(null);
        }

        const currentBlock = editor.getTextCursorPosition().block;

        (async () => {
          const { spaceSlug: currentSpaceSlug, pageId: currentPageId } = identityRef.current;
          let pasteBlocks = JSON.parse(JSON.stringify(payload.blocks));
          let mirrorRegistrations: SyncedMirrorRegistration[] = [];
          if (!payload.isCut && (!payload.sourceSpaceSlug || payload.sourceSpaceSlug === currentSpaceSlug)) {
            const prepared = prepareCopiedBlocksForPaste(
              pasteBlocks,
              payload.sourcePageId || currentPageId,
              currentPageId,
            );
            pasteBlocks = prepared.blocks;
            mirrorRegistrations = prepared.mirrorRegistrations;
          }

          // 非剪切：duplicate subpage pages，避免多个粘贴共享同一 page
          if (!payload.isCut) {
            const subpageBlocks = pasteBlocks.filter((b: any) => b.type === 'subpage' && b.props?.pageId);
            for (const block of subpageBlocks) {
              try {
                const newPage = await pagesApi.duplicate(currentSpaceSlug, block.props.pageId, currentPageId);
                block.props.pageId = newPage.id;
              } catch (err) {
                console.error('[PageEditor] Failed to duplicate subpage:', err);
              }
            }
          }

          // 当前 block 为空时替换，否则在后面插入
          const isEmpty = !currentBlock.content || (Array.isArray(currentBlock.content) && currentBlock.content.length === 0);

          // 剥离 block id，让 BlockNote 创建新的
          const blocksToInsert = pasteBlocks.map((b: any) => {
            const { id, ...rest } = b;
            return rest;
          });
          if (isEmpty) {
            editor.replaceBlocks([currentBlock], blocksToInsert as any);
          } else {
            editor.insertBlocks(blocksToInsert as any, currentBlock, 'after');
          }
          editor.focus();

          // 记录 subpage 撤销动作
          for (const block of pasteBlocks) {
            if (block.type === 'subpage' && block.props?.pageId) {
              setSubpageUndoAction(block.props.pageId, { action: 'delete' });
            }
          }

          if (mirrorRegistrations.length > 0) {
            await registerSyncedMirrorQuotes(currentSpaceSlug, mirrorRegistrations);
          }

          // 立即保存，让 backend maintainSubpageBlocks 在 sidebar 刷新前修正 sort_order
          await persistFileContentBlocks(editor.document, currentSpaceSlug);
          const markdown = blocksToMarkdown(editor.document);
          await createMirror(currentSpaceSlug, currentPageId, markdown);
          hasChangesRef.current = false;
          await flushSync();
          await useSpaceStore.getState().refreshAll();
        })();
        return;
      }

      // 没有自定义 MIME：fallback 到 text/plain 处理（外部复制 / 跨浏览器 / 老数据）
      const text = e.clipboardData?.getData('text/plain')?.trim();
      if (!text) return;

      const internalLink = parseInternalPageLink(text);
      if (internalLink) {
        e.preventDefault();
        e.stopPropagation();
        handleInsertMention(internalLink.relativePath);
        return;
      }

      if (!URL_RE.test(text)) return; // Not a URL, let default paste handle it

      e.preventDefault();
      e.stopPropagation();

      // External URL: show menu at cursor position
      let x = 100, y = 100;
      // Use ProseMirror coordsAtPos for reliable cursor coordinates
      try {
        const pmEl = container.querySelector('.ProseMirror') as any;
        const pmView = pmEl?.editor?.editorView;
        if (pmView) {
          const pos = pmView.state.selection.head;
          const coords = pmView.coordsAtPos(pos);
          x = coords.left;
          y = coords.bottom + 4;
        } else {
          // Fallback: try global querySelector
          const globalPm = document.querySelector('.ProseMirror') as any;
          const globalView = globalPm?.editor?.editorView;
          if (globalView) {
            const pos = globalView.state.selection.head;
            const coords = globalView.coordsAtPos(pos);
            x = coords.left;
            y = coords.bottom + 4;
          }
        }
      } catch {}
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

    const linkContent = [{ type: 'link', href: url, content: [{ type: 'text', text: title, styles: {} }] } as any];
    if (isEmpty) {
      // Replace empty block with a paragraph containing the link
      editor.updateBlock(currentBlock, {
        type: 'paragraph',
        content: linkContent,
      } as any);
    } else {
      // Insert inline link at cursor
      editor.insertInlineContent(linkContent as any);
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

  // Listen for mention → bookmark conversion
  useEffect(() => {
    const handleConvert = (e: Event) => {
      const { url } = (e as CustomEvent).detail;
      if (!url) return;

      const pmView = _badgeEditorView;
      if (!pmView || pmView.isDestroyed) return;

      const linkMark = pmView.state.schema.marks.link;
      const MENTION_PREFIX_LOCAL = '​​';
      let found = false;

      pmView.state.doc.descendants((node: any, pos: number) => {
        if (found) return false;
        if (!node.isText || !node.marks) return;
        const link = node.marks.find((m: any) => m.type === linkMark && m.attrs.href === url);
        if (link && node.text?.startsWith(MENTION_PREFIX_LOCAL)) {
          found = true;
          // Find the block containing this mention
          const $pos = pmView.state.doc.resolve(pos);
          const blockNode = $pos.parent;
          const blockFrom = $pos.before(1);

          // Check if block only contains this mention
          const blockText = blockNode.textContent.replace(/​/g, '').trim();
          const isOnlyMention = blockText === url;

          if (isOnlyMention) {
            // Replace entire block with bookmark
            const tr = pmView.state.tr;
            const bookmarkNode = pmView.state.schema.nodes.bookmark?.create({ url });
            if (bookmarkNode) {
              tr.replaceWith(blockFrom, blockFrom + blockNode.nodeSize + 2, bookmarkNode);
              pmView.dispatch(tr);
            }
          } else {
            // Remove just the mention link, insert bookmark block after
            let tr = pmView.state.tr.removeMark(pos, pos + node.nodeSize, linkMark);
            // Replace text with nothing (remove the mention text)
            tr = tr.delete(pos, pos + node.nodeSize);
            // Insert bookmark block after current block
            const bookmarkNode = pmView.state.schema.nodes.bookmark?.create({ url });
            if (bookmarkNode) {
              const insertPos = tr.mapping.map(blockFrom + blockNode.nodeSize + 1);
              tr = tr.insert(insertPos, bookmarkNode);
              // Also insert a paragraph after bookmark for continued editing
              const para = pmView.state.schema.nodes.paragraph?.create();
              if (para) {
                tr = tr.insert(insertPos + bookmarkNode.nodeSize, para);
              }
            }
            pmView.dispatch(tr);
          }
          return false;
        }
      });
    };

    document.addEventListener('mention:convert-to-bookmark', handleConvert);
    return () => document.removeEventListener('mention:convert-to-bookmark', handleConvert);
  }, [editor]);

  // Unicode marker to identify mention links in the editor runtime
  const MENTION_PREFIX = '​​'; // zero-width space x2

  const handleInsertMention = useCallback((url: string) => {
    setPasteMenu(null);
    const currentBlock = editor.getTextCursorPosition().block;
    const isEmpty = !currentBlock.content || (Array.isArray(currentBlock.content) && currentBlock.content.length === 0);

    // Use the URL as href (valid URL so BlockNote won't strip it), but prefix text with invisible marker
    const mentionContent = [{ type: 'link', href: url, content: [{ type: 'text', text: MENTION_PREFIX + url, styles: {} }] } as any];
    if (isEmpty) {
      editor.updateBlock(currentBlock, {
        type: 'paragraph',
        content: mentionContent,
      } as any);
    } else {
      editor.insertInlineContent(mentionContent as any);
    }
  }, [editor]);

  // Block selection: Escape toggles, click deselects, drag selects multiple
  const dragOccurredRef = useRef(false);

  useEffect(() => {
    const container = editorRef.current;
    if (!container || readOnly) return;

    // Hoist the scroll container once — needed by mousedown, mousemove, scroll,
    // and the auto-scroll RAF. All rect math is anchored in this container's
    // document coords (viewport coord + scrollTop/Left) so selection survives
    // scrolling instead of being pinned to the viewport.
    //
    // Assumption: scrollableArea's viewport position does NOT change as it
    // itself scrolls (i.e., no ancestor scroll container, no transform that
    // shifts origin). The anchor (`clientX + scrollLeft`) and block hit-test
    // (`r.left + scrollLeft`) both use the same conversion, so they stay
    // consistent with each other even if the absolute reference is "pseudo-
    // document" rather than true document coords.
    const scrollableArea = container.closest('.overflow-y-auto') as HTMLElement | null;
    if (!scrollableArea) return;

    let isDragging = false;
    let dragOccurred = false;
    // Anchor in DOCUMENT coords (clientX + scrollLeft, clientY + scrollTop).
    // Fixed in document space → immune to scrolling.
    let startDocX = 0;
    let startDocY = 0;
    let selectionRect: HTMLDivElement | null = null;
    // Shift-toggle: at mousedown we snapshot the current selection as `base`.
    // Each frame we XOR the current intersect against base — blocks under the
    // rect flip (add if absent, remove if present).
    let shiftMode = false;
    let baseSelectedIds: Set<string> = new Set();
    // Last known mouse viewport position — used to recompute selection when
    // the user scrolls without moving the mouse (wheel/trackpad).
    let lastMouseClientX = 0;
    let lastMouseClientY = 0;
    // Auto-scroll at viewport edges (Notion-style). `autoScrollDir` is -1 / 0 / +1;
    // the RAF loop adjusts scrollTop each frame while the mouse is in the zone.
    let autoScrollRaf: number | null = null;
    let autoScrollDir: 0 | -1 | 1 = 0;
    const EDGE_THRESHOLD = 60;  // px from edge that triggers auto-scroll
    const MAX_AUTO_SPEED = 14;  // max px per frame, scaled by depth into edge

    function updateSelection(ids: string[]) {
      setBlockSelection(ids.length > 0 ? ids : null);
    }

    // Keyboard: Escape toggles selection, Delete/Backspace removes selected blocks
    // Uses module-level getSelectedBlockIds() to avoid stale closure issues
    const handleKeyDown = (e: KeyboardEvent) => {
      // 焦点不在编辑器内（标题、侧边栏、Claude 聊天面板等）：放行，
      // 让原生 + 各组件自己的 React handler 处理。
      // 注意：本 handler 注册在 capture 阶段，会先于 React 合成事件，
      // 不放行的话会拦截掉标题的 Cmd+A / Enter 等。
      const targetEl = e.target as HTMLElement | null;
      // 表单字段（FindReplacePanel 搜索/替换 input、slash 菜单搜索框、
      // 链接工具栏 input 等）虽然渲染在编辑器容器内，但不是 BlockNote
      // 正文。必须放行让 input 自己处理 Cmd+C/Cmd+V/Enter 等，否则会被
      // 下面的"复制选中块"等分支提前 preventDefault + stopImmediatePropagation
      // 拦走（典型表现：搜索框 Cmd+C 复制的是编辑器里的块、Cmd+V 把块
      // 粘贴到文档而不是 input）。
      if (targetEl && (targetEl.tagName === 'INPUT' || targetEl.tagName === 'TEXTAREA')) {
        return;
      }
      const selectedIdsAtStart = getSelectedBlockIds();
      const targetInsideEditor = !!targetEl?.closest('[data-page-editor="true"]');
      const targetInsideSideMenu = !!targetEl?.closest('.bn-side-menu, [data-floating-ui-focusable]');
      const selectedBlockShortcut =
        selectedIdsAtStart.length > 0 &&
        (
          e.key === 'Escape' ||
          e.key === 'Backspace' ||
          e.key === 'Delete' ||
          ((e.key === 'c' || e.key === 'x') && (e.metaKey || e.ctrlKey) && !e.altKey)
        );
      if (!targetInsideEditor && !(targetInsideSideMenu && selectedBlockShortcut)) return;

      if (
        e.key === 'Enter' &&
        !e.altKey &&
        !e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !isDragMenuOpen() &&
        !document.getElementById('bn-suggestion-menu')
      ) {
        const currentBlock = editor.getTextCursorPosition?.().block;
        const syncChildTarget = currentBlock
          ? getSyncedBlockChildEnterTarget(editor.document, currentBlock.id as string)
          : null;
        if (syncChildTarget && isEmptyTextBlock(currentBlock)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const inserted = editor.insertBlocks([{ type: 'paragraph' } as any], currentBlock, 'after');
          if (inserted.length > 0) {
            editor.focus();
            requestAnimationFrame(() => {
              try {
                editor.setTextCursorPosition(inserted[0], 'start');
              } catch {
                // The inserted block may have been changed by a concurrent editor transaction.
              }
            });
          }
          return;
        }
      }

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
        const ids = getCopyCandidateIds(container, editor);
        if (ids.length === 0) return; // Let BlockNote handle text-level copy/cut
        e.preventDefault();
        e.stopImmediatePropagation();

        const isCut = e.key === 'x';

        // Collect selected block data (deep clone to avoid references to editor blocks)
        const selectedBlocks = JSON.parse(JSON.stringify(blocksForIds(editor, ids)));
        if (selectedBlocks.length === 0) return;
        const markdown = blocksToMarkdown(selectedBlocks as any);
        // 产出 HTML 片段写入 text/html，Notion 等外部应用优先读 text/html 才能识别块结构
        let html = '';
        try {
          html = editor.blocksToHTMLLossy(selectedBlocks) || '';
        } catch (err) {
          console.warn('[clipboard] blocksToHTMLLossy failed:', err);
        }
        const { spaceSlug, pageId } = identityRef.current;

        // 一次性写入系统剪贴板：自定义 MIME（结构化）+ text/html（外部富文本）+ text/plain（markdown 兼容）
        // isSyncedCandidate 决定跨页粘贴时是否弹"创建同步块"选择框
        void writeAkmdClipboard({
          blocks: selectedBlocks,
          markdown,
          html,
          isCut,
          sourceSpaceSlug: spaceSlug,
          sourcePageId: pageId,
          sourceBlockIds: selectedBlocks.map((b: any) => b.id),
          sourceMarkdown: markdown,
          isSyncedCandidate: !isCut && !hasSyncedBlock(selectedBlocks),
        });

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

      // Cmd+V 的 paste 处理已全部迁移到 paste 事件 handler（capture 阶段）
      // 见上面的 handlePaste，统一通过系统剪贴板读取数据

      // Delete 在文本 block 末尾时的"向前合并"修正：
      // BlockNote 默认调用 ProseMirror deleteForward，遇到下一个 atom 类 block
      // （subpage / table / image / divider 等 content:'none' 的 block）时会
      // 直接删除它而不是合并——因为对方没有 inline content 可合并。
      // 用户预期：什么都不发生（或只是无法合并），不应该删除下一个 block。
      if (e.key === 'Delete' && !e.altKey && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const ids = getSelectedBlockIds();
        if (ids.length === 0) {
          const cursor = editor.getTextCursorPosition();
          // 用 ProseMirror 判断光标是否在当前文本 block 末尾
          const pmView = (editor as any).prosemirrorView;
          const sel = pmView?.state?.selection;
          const isAtEndOfBlock = sel?.empty
            && sel.$head.parentOffset === sel.$head.parent.content.size;
          if (isAtEndOfBlock && cursor.nextBlock) {
            const nextSchema = (editor.schema.blockSchema as any)[cursor.nextBlock.type];
            // 下一个 block 的 content 不是 inline → 文本无法合并进去，禁止默认动作
            if (nextSchema && nextSchema.content !== 'inline') {
              e.preventDefault();
              e.stopImmediatePropagation();
              return;
            }
          }
        }
      }

      if (e.key !== 'Escape' && e.key !== 'Backspace' && e.key !== 'Delete') return;

      // If a floating menu is open (drag menu or slash menu), let it handle Escape first
      const hasOpenMenu = isDragMenuOpen() || !!document.getElementById('bn-suggestion-menu');
      if (e.key === 'Escape' && hasOpenMenu) return;

      const ids = normalizeSyncedBlockSelection(getSelectedBlockIds(), container);
      if ((e.key === 'Backspace' || e.key === 'Delete') && ids.length <= 1) {
        const candidate = ids.length === 1
          ? blocksForIds(editor, ids)[0]
          : editor.getTextCursorPosition?.().block;
        if (candidate?.type === 'syncedBlockSource') {
          const quotedCount = parseQuotedCount(candidate);
          if (quotedCount > 0) {
            e.preventDefault();
            e.stopImmediatePropagation();
            setSyncedDelete({ block: candidate, quotedCount });
            return;
          }
        }
      }
      if (ids.length > 0) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          updateSelection([]);
          setBlockSelection(null);
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
          if (ids.length === 1) {
            const syncChildTarget = getSyncedBlockChildDeleteTarget(editor.document, ids[0]);
            if (syncChildTarget) {
              e.preventDefault();
              e.stopImmediatePropagation();
              const nextFocusId = syncChildTarget.focusBlock?.id;
              console.log(`[delete.fire] path=syncChild ids=[${ids.join(',')}] nextFocusId=${nextFocusId || ''}`);
              removeBlocksEnhanced(editor, ids.map(id => ({ id } as any)));
              updateSelection([]);
              setBlockSelection(null);
              editor.focus();
              if (nextFocusId) {
                requestAnimationFrame(() => {
                  try {
                    editor.setTextCursorPosition(nextFocusId as any, 'end');
                  } catch {
                    // The target may have been removed by a concurrent editor transaction.
                  }
                });
              }
              return;
            }
          }
          e.preventDefault();
          e.stopImmediatePropagation();
          console.log(`[delete.fire] path=generic ids=[${ids.join(',')}]`);
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
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        const currentBlock = editor.getTextCursorPosition().block;
        const syncChildTarget = getSyncedBlockChildDeleteTarget(editor.document, currentBlock.id as string);
        if (syncChildTarget && isEmptyTextBlock(currentBlock)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const nextFocusId = syncChildTarget.focusBlock?.id;
          if (nextFocusId) {
            removeBlocksEnhanced(editor, [{ id: currentBlock.id } as any]);
            editor.focus();
            requestAnimationFrame(() => {
              try {
                editor.setTextCursorPosition(nextFocusId as any, 'end');
              } catch {
                // The target may have been removed by a concurrent editor transaction.
              }
            });
          }
          return;
        }
        if (e.key !== 'Backspace') return;
        // Allow deleting empty first block (BlockNote default doesn't support this)
        const blocks = editor.document;
        if (blocks.length > 1) {
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

    // Shift+click on a single block: toggle that block in/out of selection.
    // Registered on `container` in CAPTURE phase so it runs before BlockNote's
    // own mousedown handler (which would otherwise focus the editor into edit
    // mode). stopImmediatePropagation prevents the event from reaching the
    // document-level bubble-phase handleMouseDown below, and we set
    // dragOccurred=true so the subsequent click handler leaves the new
    // selection alone.
    //
    // Limitation: capture-phase listeners registered on elements DEEPER than
    // `container` (e.g., inside the ProseMirror editor) would still fire
    // before ours, since capture propagates from the outside in. In practice
    // BlockNote handles block-level interaction in the bubble phase / via
    // React synthetic events, so this is sufficient. If a future BlockNote
    // upgrade adds capture-phase mousedown handling inside the editor, switch
    // this listener to `document` capture or use a different interception
    // strategy.
    const handleShiftClickCapture = (e: MouseEvent) => {
      if (!e.shiftKey || e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (!scrollableArea.contains(target)) return;

      const blockOuter = target.closest('.bn-block-outer');
      if (!blockOuter) return;

      const blockEl = blockOuter.querySelector('[data-id]');
      if (!blockEl) return;
      // Skip column_list / column — layout containers, not selectable content.
      if (blockEl.querySelector('.column-list-inner') || blockEl.querySelector('.column-block-inner')) return;
      const id = blockEl.getAttribute('data-id');
      if (!id) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      const current = new Set(getSelectedBlockIds());
      if (current.has(id)) current.delete(id);
      else current.add(id);
      updateSelection(Array.from(current));

      dragOccurred = true;
      dragOccurredRef.current = true;
      isDragging = false;
    };

    // Mousedown on non-block area: start drag selection
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;

      // Only start in the scrollable content area (covers side whitespace too)
      if (!scrollableArea.contains(target)) return;

      if (target.closest('.bn-block-outer')) return;
      if (target.closest('button, a, input, [contenteditable="true"]')) return;

      e.preventDefault(); // prevent browser text selection during drag
      isDragging = true;
      dragOccurred = false;
      dragOccurredRef.current = false;

      // Anchor in document coords so the selection rectangle survives scroll.
      startDocX = e.clientX + scrollableArea.scrollLeft;
      startDocY = e.clientY + scrollableArea.scrollTop;
      lastMouseClientX = e.clientX;
      lastMouseClientY = e.clientY;

      // Shift mode = toggle (symmetric difference against base snapshot).
      shiftMode = e.shiftKey;
      baseSelectedIds = shiftMode ? new Set(getSelectedBlockIds()) : new Set();
      autoScrollDir = 0;
    };

    // Recompute selection for the given mouse position + current scroll state.
    // Called from mousemove, scroll, and the auto-scroll RAF tick so any of
    // those triggers keeps the rect + selected set in sync. All comparisons
    // happen in document coords (viewport rect + scrollTop/Left), which makes
    // the selection invariant under scrolling.
    const computeSelection = (clientX: number, clientY: number) => {
      const curDocX = clientX + scrollableArea.scrollLeft;
      const curDocY = clientY + scrollableArea.scrollTop;
      const rectDocLeft = Math.min(startDocX, curDocX);
      const rectDocRight = Math.max(startDocX, curDocX);
      const rectDocTop = Math.min(startDocY, curDocY);
      const rectDocBottom = Math.max(startDocY, curDocY);

      // Visual rect is position:fixed (viewport). Recompute top/left from doc
      // coords every frame so the rectangle follows the document on scroll.
      if (selectionRect) {
        selectionRect.style.left = `${rectDocLeft - scrollableArea.scrollLeft}px`;
        selectionRect.style.top = `${rectDocTop - scrollableArea.scrollTop}px`;
        selectionRect.style.width = `${rectDocRight - rectDocLeft}px`;
        selectionRect.style.height = `${rectDocBottom - rectDocTop}px`;
      }

      // Intersect in document coords: shift each block's viewport rect by the
      // current scroll offset so the comparison stays anchored in the document.
      const sTop = scrollableArea.scrollTop;
      const sLeft = scrollableArea.scrollLeft;
      const blockOuters = container.querySelectorAll('.bn-block-outer');
      const intersecting: string[] = [];
      const blockOuterMap = new Map<string, Element>();
      const forcedSyncedBlockIds = new Set<string>();

      blockOuters.forEach(outer => {
        const blockEl = outer.querySelector('[data-id]');
        if (!blockEl) return;
        // Skip column_list and column blocks — they are layout containers,
        // not selectable content blocks. Users should only select content inside them.
        if (blockEl.querySelector('.column-list-inner') || blockEl.querySelector('.column-block-inner')) return;
        const id = blockEl.getAttribute('data-id')!;
        blockOuterMap.set(id, outer);
        const r = outer.getBoundingClientRect();
        const bLeft = r.left + sLeft;
        const bRight = r.right + sLeft;
        const bTop = r.top + sTop;
        const bBottom = r.bottom + sTop;
        if (rectDocLeft < bRight && rectDocRight > bLeft &&
            rectDocTop < bBottom && rectDocBottom > bTop) {
          intersecting.push(id);
          const syncRenderer = outer.querySelector(
            ':scope > .bn-block > .react-renderer.node-syncedBlockSource, :scope > .bn-block > .react-renderer.node-syncedBlockMirror'
          );
          if (syncRenderer) {
            const syncRect = syncRenderer.getBoundingClientRect();
            const syncLeft = syncRect.left + sLeft;
            const syncRight = syncRect.right + sLeft;
            const syncTop = syncRect.top + sTop;
            const syncBottom = syncRect.bottom + sTop;
            if (
              rectDocLeft < syncRight &&
              rectDocRight > syncLeft &&
              rectDocTop < syncBottom &&
              rectDocBottom > syncTop
            ) {
              forcedSyncedBlockIds.add(id);
            }
          }
        }
      });

      // --- Notion-style toggle selection logic ---
      // Toggle = title + content (children). Toggle and its children are mutually exclusive in selection:
      // - If only toggle family is in range → select content items, not toggle title
      // - If toggle + same-level siblings are in range → select toggle as whole unit, not content items
      // This applies recursively for nested toggles (process outermost first).

      const isToggleBlock = (outer: Element): boolean => {
        // Detect toggle by presence of .bn-toggle-wrapper AND .bn-block-group (has children)
        // Note: .bn-block-group is inside .bn-toggle-wrapper, NOT a direct child of .bn-block-outer
        const hasToggleWrapper = !!outer.querySelector('.bn-toggle-wrapper');
        const hasBlockGroup = !!outer.querySelector('.bn-block-group');
        return hasToggleWrapper && hasBlockGroup;
      };

      // Find all descendant block IDs of a toggle (any nesting depth)
      const getDescendantIds = (toggleOuter: Element): string[] => {
        const group = toggleOuter.querySelector('.bn-block-group');
        if (!group) return [];
        const ids: string[] = [];
        group.querySelectorAll('.bn-block-outer').forEach(child => {
          const id = child.querySelector('[data-id]')?.getAttribute('data-id');
          if (id) ids.push(id);
        });
        return ids;
      };

      // Get the parent .bn-block-group element for a block-outer
      const getParentGroup = (outer: Element): Element | null => {
        return outer.parentElement?.classList.contains('bn-block-group') ? outer.parentElement : null;
      };

      // Sort toggles by nesting depth (outermost first) for correct recursive processing
      // Deeper toggles have more ancestor .bn-block-outer elements
      const getNestingDepth = (outer: Element): number => {
        let depth = 0;
        let el = outer.parentElement;
        while (el) {
          if (el.classList?.contains('bn-block-outer')) depth++;
          el = el.parentElement;
        }
        return depth;
      };

      // Identify toggles that are in intersecting AND have at least one descendant in intersecting
      const toggleInfoList: Array<{ id: string; outer: Element; descendantIds: string[]; depth: number }> = [];
      for (const id of intersecting) {
        const outer = blockOuterMap.get(id);
        if (!outer || !isToggleBlock(outer)) continue;
        const descIds = getDescendantIds(outer);
        const selectedDescIds = descIds.filter(did => intersecting.includes(did));
        if (selectedDescIds.length > 0) {
          toggleInfoList.push({ id, outer, descendantIds: selectedDescIds, depth: getNestingDepth(outer) });
        }
      }

      // Process outermost toggles first (lower depth = more outer)
      toggleInfoList.sort((a, b) => a.depth - b.depth);

      const result = normalizeSyncedBlockSelection(intersecting, container, forcedSyncedBlockIds);
      for (const { id: toggleId, outer: toggleOuter, descendantIds } of toggleInfoList) {
        // Skip if toggle already removed from result (by a parent's Case B)
        if (!result.includes(toggleId)) continue;

        // Check: are there same-level (same parent block-group) siblings also selected?
        const parentGroup = getParentGroup(toggleOuter);
        let hasSelectedSibling = false;
        if (parentGroup) {
          for (const rid of result) {
            if (rid === toggleId || descendantIds.includes(rid)) continue;
            const rOuter = blockOuterMap.get(rid);
            if (rOuter && getParentGroup(rOuter) === parentGroup) {
              hasSelectedSibling = true;
              break;
            }
          }
        }

        if (hasSelectedSibling) {
          // Case B: toggle + siblings → keep toggle, remove ALL descendants from selection
          for (const did of descendantIds) {
            const idx = result.indexOf(did);
            if (idx >= 0) result.splice(idx, 1);
          }
        } else {
          // Case A: only toggle family → remove toggle title, keep descendants
          const idx = result.indexOf(toggleId);
          if (idx >= 0) result.splice(idx, 1);
        }
      }

      // Shift mode = symmetric difference against the base snapshot taken at
      // mousedown. Blocks currently under the rect flip state: added if absent
      // in base, removed if present in base.
      let finalIds: string[];
      if (shiftMode && baseSelectedIds.size > 0) {
        const merged = new Set(baseSelectedIds);
        for (const id of result) {
          if (merged.has(id)) merged.delete(id);
          else merged.add(id);
        }
        finalIds = Array.from(merged);
      } else {
        finalIds = result;
      }
      console.log(`[dragSelect] intersecting=[${intersecting.join(',')}] forced=[${Array.from(forcedSyncedBlockIds).join(',')}] normalized=[${result.join(',')}] final=[${finalIds.join(',')}]`);
      updateSelection(finalIds);
    };

    // Auto-scroll at viewport edges. The RAF loop adjusts scrollTop each frame
    // while the mouse stays in the edge zone; speed scales linearly with how
    // deep into the zone the cursor is.
    const tickAutoScroll = () => {
      if (!isDragging || autoScrollDir === 0) {
        autoScrollRaf = null;
        return;
      }
      const areaRect = scrollableArea.getBoundingClientRect();
      let speed = 0;
      if (autoScrollDir === -1) {
        const intoZone = Math.max(0, EDGE_THRESHOLD - (lastMouseClientY - areaRect.top));
        speed = -Math.max(1, Math.ceil((intoZone / EDGE_THRESHOLD) * MAX_AUTO_SPEED));
      } else {
        const intoZone = Math.max(0, EDGE_THRESHOLD - (areaRect.bottom - lastMouseClientY));
        speed = Math.max(1, Math.ceil((intoZone / EDGE_THRESHOLD) * MAX_AUTO_SPEED));
      }
      scrollableArea.scrollTop += speed;
      // The native scroll event will also call computeSelection, but we recompute
      // here too so the rect updates on the same frame (scroll events can be
      // throttled/batched by the browser).
      computeSelection(lastMouseClientX, lastMouseClientY);
      autoScrollRaf = requestAnimationFrame(tickAutoScroll);
    };

    const startAutoScroll = () => {
      if (autoScrollRaf !== null) return;
      autoScrollRaf = requestAnimationFrame(tickAutoScroll);
    };

    const stopAutoScroll = () => {
      autoScrollDir = 0;
      if (autoScrollRaf !== null) {
        cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = null;
      }
    };

    // Mousemove: update selection rectangle + highlight intersecting blocks
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      lastMouseClientX = e.clientX;
      lastMouseClientY = e.clientY;

      // Distance threshold checked in viewport coords. The anchor's viewport
      // position shifts with scroll, so recompute it here from doc coords.
      const startClientX = startDocX - scrollableArea.scrollLeft;
      const startClientY = startDocY - scrollableArea.scrollTop;
      const dist = Math.hypot(e.clientX - startClientX, e.clientY - startClientY);
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

      computeSelection(e.clientX, e.clientY);

      // Notion-style auto-scroll: when cursor is within EDGE_THRESHOLD of the
      // scrollable area's top/bottom, kick off the RAF loop.
      const areaRect = scrollableArea.getBoundingClientRect();
      const topDist = e.clientY - areaRect.top;
      const bottomDist = areaRect.bottom - e.clientY;
      if (topDist >= 0 && topDist < EDGE_THRESHOLD) {
        autoScrollDir = -1;
        startAutoScroll();
      } else if (bottomDist >= 0 && bottomDist < EDGE_THRESHOLD) {
        autoScrollDir = 1;
        startAutoScroll();
      } else if (autoScrollDir !== 0) {
        stopAutoScroll();
      }
    };

    // Scroll: recompute selection with the last known mouse position. Covers
    // the case where the mouse is stationary but the user scrolls via wheel
    // or trackpad (the original bug — selection used to be lost because the
    // rect was anchored in viewport coords and blocks scrolled past it).
    const handleScroll = () => {
      if (!isDragging) return;
      computeSelection(lastMouseClientX, lastMouseClientY);
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
      stopAutoScroll();
      isDragging = false;
      shiftMode = false;
      baseSelectedIds = new Set();
    };

    // Click: clear selection (unless after drag, on side menu, or floating menu is open)
    // Uses getSelectedBlockIds() to also catch selections from drag handle click
    const handleClick = (e: MouseEvent) => {
      if (dragOccurred) {
        dragOccurred = false;
        return;
      }
      if ((e.target as HTMLElement).closest('.bn-image-toolbar, .bn-image-toolbar-menu, .bn-image-align-menu, .bn-image-caption, .bn-resize-handle, .bn-file-block-content-wrapper')) {
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
    // Shift+click on a single block uses CAPTURE on the editor container so
    // it runs before BlockNote's mousedown handler (which would focus the
    // editor into edit mode) and before our document-level bubble handlers.
    container.addEventListener('mousedown', handleShiftClickCapture, true);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('click', handleClick);
    scrollableArea.addEventListener('scroll', handleScroll);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      container.removeEventListener('mousedown', handleShiftClickCapture, true);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('click', handleClick);
      scrollableArea.removeEventListener('scroll', handleScroll);
      stopAutoScroll();
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

    const clearSyncSourceSideMenuMode = () => {
      document.body.classList.remove('sync-source-side-menu-mode');
    };

    const isSyncedBlockSourceOuter = (element: Element) => {
      return !!element.querySelector(':scope > .bn-block > .react-renderer.node-syncedBlockSource');
    };

    const isSyncedBlockMirrorOuter = (element: Element) => {
      return !!element.querySelector(':scope > .bn-block > .react-renderer.node-syncedBlockMirror');
    };

    const isSyncedBlockOuter = (element: Element) => {
      return isSyncedBlockSourceOuter(element) || isSyncedBlockMirrorOuter(element);
    };

    const findSyncedBlockOuter = (element: Element | null): HTMLElement | null => {
      let current: Element | null = element;
      while (current) {
        if (current.classList?.contains('bn-block-outer') && isSyncedBlockOuter(current)) {
          return current as HTMLElement;
        }
        current = current.parentElement;
      }
      return null;
    };

    const selectionIsInside = (element: HTMLElement | null) => {
      if (!element) return false;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return false;
      const anchor = selection.anchorNode;
      const focus = selection.focusNode;
      return !!((anchor && element.contains(anchor)) || (focus && element.contains(focus)));
    };

    let activeSyncSourceOuters = new Set<HTMLElement>();
    let hoveredSyncSourceOuter: HTMLElement | null = null;

    const setSyncSourceActiveMarker = (syncSourceOuter: HTMLElement, active: boolean) => {
      const sourceRenderer = syncSourceOuter.querySelector(':scope > .bn-block > .react-renderer.node-syncedBlockSource') as HTMLElement | null;
      const sourceContent = sourceRenderer?.querySelector('[data-content-type="syncedBlockSource"]') as HTMLElement | null;
      const mirrorRenderer = syncSourceOuter.querySelector(':scope > .bn-block > .react-renderer.node-syncedBlockMirror') as HTMLElement | null;
      const mirrorContent = mirrorRenderer?.querySelector('[data-content-type="syncedBlockMirror"]') as HTMLElement | null;
      if (active) {
        if (sourceRenderer) sourceRenderer.dataset.syncSourceActive = 'true';
        if (sourceContent) sourceContent.dataset.syncSourceActive = 'true';
        if (mirrorRenderer) mirrorRenderer.dataset.syncSourceActive = 'true';
        if (mirrorContent) mirrorContent.dataset.syncSourceActive = 'true';
      } else {
        if (sourceRenderer) delete sourceRenderer.dataset.syncSourceActive;
        if (sourceContent) delete sourceContent.dataset.syncSourceActive;
        if (mirrorRenderer) delete mirrorRenderer.dataset.syncSourceActive;
        if (mirrorContent) delete mirrorContent.dataset.syncSourceActive;
      }
    };

    const setActiveSyncSourceOuters = (nextOuters: Set<HTMLElement>) => {
      for (const outer of activeSyncSourceOuters) {
        if (!nextOuters.has(outer)) {
          setSyncSourceActiveMarker(outer, false);
        }
      }
      for (const outer of nextOuters) {
        setSyncSourceActiveMarker(outer, true);
      }
      activeSyncSourceOuters = nextOuters;
      if (hoveredSyncSourceOuter && nextOuters.has(hoveredSyncSourceOuter)) {
        hideSyncSourceMenu();
      }
    };

    const blockOuterIsSyncSourceChild = (blockOuter: HTMLElement | null, syncSourceOuter: HTMLElement | null) => {
      return !!(
        blockOuter &&
        syncSourceOuter &&
        blockOuter !== syncSourceOuter &&
        syncSourceOuter.contains(blockOuter)
      );
    };

    const getBlockOuterFromNode = (node: Node | null): HTMLElement | null => {
      const element =
        node instanceof HTMLElement
          ? node
          : node?.parentElement || null;
      if (!element || !container.contains(element)) return null;
      return element.closest('.bn-block-outer') as HTMLElement | null;
    };

    const getSelectedBlockOuter = (): HTMLElement | null => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const anchorOuter = getBlockOuterFromNode(selection.anchorNode);
        const focusOuter = getBlockOuterFromNode(selection.focusNode);
        if (anchorOuter) return anchorOuter;
        if (focusOuter) return focusOuter;
      }

      try {
        const pmView = (editor as any)._tiptapEditor?.view || (editor as any).prosemirrorView;
        const from = pmView?.state?.selection?.from;
        if (pmView && typeof from === 'number') {
          const domAtPos = pmView.domAtPos(from);
          const outer = getBlockOuterFromNode(domAtPos.node);
          if (outer) return outer;
        }
      } catch {
        // Ignore and fall back to BlockNote's cursor API.
      }

      try {
        const cursorBlockId = editor.getTextCursorPosition?.().block?.id || null;
        if (!cursorBlockId) return null;
        const cursorBlock = container.querySelector(`.bn-block[data-id="${cursorBlockId}"]`) as HTMLElement | null;
        return cursorBlock?.closest('.bn-block-outer') as HTMLElement | null;
      } catch {
        return null;
      }
    };

    const syncSourceHasEditableChildFocus = (syncSourceOuter: HTMLElement | null) => {
      if (!syncSourceOuter) return false;
      return blockOuterIsSyncSourceChild(getSelectedBlockOuter(), syncSourceOuter);
    };

    const getBlockOuterById = (blockId: string): HTMLElement | null => {
      const block = Array.from(container.querySelectorAll('.bn-block[data-id]')).find(
        (element) => element.getAttribute('data-id') === blockId
      ) as HTMLElement | undefined;
      return (block?.closest('.bn-block-outer') as HTMLElement | null) || null;
    };

    const syncSourceHasSelectedChildBlock = (syncSourceOuter: HTMLElement | null) => {
      if (!syncSourceOuter) return false;
      return getSelectedBlockIds().some((blockId) => {
        const blockOuter = getBlockOuterById(blockId);
        return blockOuterIsSyncSourceChild(blockOuter, syncSourceOuter);
      });
    };

    const syncSourceHasActiveChildBlock = (syncSourceOuter: HTMLElement | null) => {
      return syncSourceHasEditableChildFocus(syncSourceOuter) || syncSourceHasSelectedChildBlock(syncSourceOuter);
    };

    const refreshActiveSyncSources = () => {
      const nextOuters = new Set<HTMLElement>();

      const selectedOuter = getSelectedBlockOuter();
      if (selectedOuter) {
        const syncSourceOuter = findSyncedBlockOuter(selectedOuter);
        if (blockOuterIsSyncSourceChild(selectedOuter, syncSourceOuter)) {
          nextOuters.add(syncSourceOuter!);
        }
      }

      for (const blockId of getSelectedBlockIds()) {
        const blockOuter = getBlockOuterById(blockId);
        const syncSourceOuter = findSyncedBlockOuter(blockOuter);
        if (!syncSourceOuter) continue;
        if (blockOuterIsSyncSourceChild(blockOuter, syncSourceOuter)) {
          nextOuters.add(syncSourceOuter);
        }
      }

      setActiveSyncSourceOuters(nextOuters);
    };

    const syncSourceMenu = document.createElement('div');
    syncSourceMenu.className = 'bn-sync-source-floating-menu';
    document.body.appendChild(syncSourceMenu);
    let sideMenuVisibilityToken = 0;

    const getBlockIdFromOuter = (outer: HTMLElement | null) => {
      return outer?.querySelector(':scope > .bn-block')?.getAttribute('data-id') || null;
    };

    const syncSourceMenuHasButtons = () => {
      return !!syncSourceMenu.querySelector('.bn-side-menu .bn-button');
    };

    const rectContainsPoint = (
      rect: { left: number; right: number; top: number; bottom: number } | null,
      x: number,
      y: number
    ) => {
      return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    const getSyncSourceMenuRect = () => {
      const sideMenu = syncSourceMenu.querySelector('.bn-side-menu') as HTMLElement | null;
      const rect = (sideMenu || syncSourceMenu).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect : null;
    };

    type SyncHoverRect = {
      left: number;
      right: number;
      top: number;
      bottom: number;
      width: number;
      height: number;
    };

    const getSyncSourceHoverRect = (syncSourceOuter: HTMLElement | null): SyncHoverRect | null => {
      if (!syncSourceOuter) return null;
      const childOuters = Array.from(
        syncSourceOuter.querySelectorAll(':scope > .bn-block > .bn-block-group > .bn-block-outer')
      ) as HTMLElement[];
      const rects = childOuters
        .map((childOuter) => {
          const childBlock = childOuter.querySelector(':scope > .bn-block') as HTMLElement | null;
          const visibleContent = childBlock?.querySelector(
            ':scope > .bn-block-content, :scope > .react-renderer > .bn-block-content'
          ) as HTMLElement | null;
          return (visibleContent || childBlock || childOuter).getBoundingClientRect();
        })
        .filter((rect) => rect.width > 0 && rect.height > 0) as DOMRect[];

      if (!rects.length) {
        const brokenMirrorContent = syncSourceOuter.querySelector(
          ':scope > .bn-block > .react-renderer.node-syncedBlockMirror > .bn-block-content[data-content-type="syncedBlockMirror"][data-sync-broken="true"]'
        ) as HTMLElement | null;
        const brokenRect = brokenMirrorContent?.getBoundingClientRect();
        if (!brokenRect || brokenRect.width <= 0 || brokenRect.height <= 0) return null;
        return {
          left: brokenRect.left,
          right: brokenRect.right,
          top: brokenRect.top,
          bottom: brokenRect.bottom,
          width: brokenRect.width,
          height: brokenRect.height,
        };
      }
      const initial = rects[0];
      return rects.slice(1).reduce<SyncHoverRect>(
        (acc, rect) => ({
          left: Math.min(acc.left, rect.left),
          right: Math.max(acc.right, rect.right),
          top: Math.min(acc.top, rect.top),
          bottom: Math.max(acc.bottom, rect.bottom),
          width: Math.max(acc.right, rect.right) - Math.min(acc.left, rect.left),
          height: Math.max(acc.bottom, rect.bottom) - Math.min(acc.top, rect.top),
        }),
        {
          left: initial.left,
          right: initial.right,
          top: initial.top,
          bottom: initial.bottom,
          width: initial.width,
          height: initial.height,
        }
      );
    };

    const cloneNativeSideMenu = () => {
      const nativeSideMenu = document.querySelector(
        '[data-floating-ui-focusable] > .bn-side-menu'
      ) as HTMLElement | null;
      if (!nativeSideMenu) return false;

      const clone = nativeSideMenu.cloneNode(true) as HTMLElement;
      clone.setAttribute('data-sync-source-menu', 'true');
      clone.querySelectorAll('button').forEach((button) => {
        button.setAttribute('type', 'button');
      });
      syncSourceMenu.replaceChildren(clone);
      return true;
    };

    const showSyncSourceMenu = (syncSourceOuter: HTMLElement) => {
      const editorBlockGroup = container.querySelector(':scope .bn-editor > .bn-block-group') as HTMLElement | null;
      const hoverRect = getSyncSourceHoverRect(syncSourceOuter);
      const firstChildBlock = syncSourceOuter.querySelector(
        ':scope > .bn-block > .bn-block-group > .bn-block-outer > .bn-block'
      ) as HTMLElement | null;
      const firstChildContent = firstChildBlock?.querySelector(
        ':scope > .bn-block-content, :scope > .react-renderer'
      ) as HTMLElement | null;
      const brokenMirrorContent = syncSourceOuter.querySelector(
        ':scope > .bn-block > .react-renderer.node-syncedBlockMirror > .bn-block-content[data-content-type="syncedBlockMirror"][data-sync-broken="true"]'
      ) as HTMLElement | null;
      const anchorBlock = firstChildBlock || (brokenMirrorContent?.closest('.bn-block') as HTMLElement | null);
      const anchorContent = firstChildContent || brokenMirrorContent;
      if (!editorBlockGroup || !anchorBlock || !hoverRect) {
        hideSyncSourceMenu();
        return;
      }
      if (!syncSourceMenuHasButtons()) cloneNativeSideMenu();

      const blockRect = anchorBlock.getBoundingClientRect();
      const firstRect = (anchorContent || anchorBlock).getBoundingClientRect();
      const menuRect = syncSourceMenu.getBoundingClientRect();
      const menuWidth = menuRect.width || 42;
      const menuHeight = menuRect.height || 28;
      hoveredSyncSourceOuter = syncSourceOuter;
      document.body.classList.add('sync-source-side-menu-mode');
      document.body.classList.remove('side-menu-visible');
      syncSourceMenu.style.left = `${blockRect.left - menuWidth - 14}px`;
      syncSourceMenu.style.top = brokenMirrorContent && !firstChildBlock
        ? `${firstRect.top + (firstRect.height - menuHeight) / 2}px`
        : `${firstRect.top}px`;
      syncSourceMenu.dataset.visible = 'true';
    };

    function hideSyncSourceMenu() {
      hoveredSyncSourceOuter = null;
      syncSourceMenu.dataset.visible = 'false';
      syncSourceMenu.replaceChildren();
      sideMenuVisibilityToken += 1;
      clearSyncSourceSideMenuMode();
    }

    const syncSourceMenuMouseDown = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const syncSourceMenuClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button');
      const blockId = getBlockIdFromOuter(hoveredSyncSourceOuter);
      if (!button || !blockId) return;

      if (button.getAttribute('draggable') === 'true') {
        const wasDragMenuOpen = isDragMenuOpen();
        setBlockSelection([blockId]);
        const buttonRect = button.getBoundingClientRect();
        setSyntheticDragHandleTarget(blockId, {
          left: buttonRect.left,
          right: buttonRect.right,
          top: buttonRect.top,
          bottom: buttonRect.bottom,
          width: buttonRect.width,
          height: buttonRect.height,
        });
        const nativeDragHandle = Array.from(document.querySelectorAll('[aria-label="打开菜单"]')).find((handle) => {
          return !(handle as HTMLElement).closest('[data-sync-source-menu="true"]');
        }) as HTMLElement | undefined;
        if (!nativeDragHandle) {
          hideSyncSourceMenu();
          return;
        }
        nativeDragHandle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        if (wasDragMenuOpen) {
          requestAnimationFrame(() => {
            hideSyncSourceMenu();
          });
        }
        return;
      }

      const inserted = editor.insertBlocks([{ type: 'paragraph' }], blockId, 'after');
      if (inserted?.[0]) {
        editor.focus();
        editor.setTextCursorPosition(inserted[0], 'end');
      }
    };
    syncSourceMenu.addEventListener('mousedown', syncSourceMenuMouseDown);
    syncSourceMenu.addEventListener('click', syncSourceMenuClick);

    let nativeSideMenuFrame: number | null = null;
    let nativeSideMenuTargetRect: DOMRect | null = null;
    let nativeSideMenuTargetTop: number | null = null;

    const hideNativeSideMenu = () => {
      sideMenuVisibilityToken += 1;
      if (nativeSideMenuFrame !== null) {
        cancelAnimationFrame(nativeSideMenuFrame);
        nativeSideMenuFrame = null;
      }
      nativeSideMenuTargetRect = null;
      nativeSideMenuTargetTop = null;
      document.body.classList.remove('side-menu-visible');
    };

    const showNativeSideMenuWhenReady = (targetRect: DOMRect) => {
      const visibilityToken = sideMenuVisibilityToken;
      const targetTop = Math.round(targetRect.top);
      if (nativeSideMenuFrame !== null && nativeSideMenuTargetTop === targetTop) {
        nativeSideMenuTargetRect = targetRect;
        return;
      }
      if (nativeSideMenuFrame === null && nativeSideMenuTargetTop === targetTop && document.body.classList.contains('side-menu-visible')) {
        nativeSideMenuTargetRect = targetRect;
        return;
      }
      nativeSideMenuTargetRect = targetRect;
      nativeSideMenuTargetTop = targetTop;
      if (nativeSideMenuFrame !== null) cancelAnimationFrame(nativeSideMenuFrame);
      nativeSideMenuFrame = requestAnimationFrame(() => {
        if (visibilityToken !== sideMenuVisibilityToken) {
          nativeSideMenuFrame = null;
          return;
        }
        nativeSideMenuFrame = requestAnimationFrame(() => {
          nativeSideMenuFrame = null;
          if (visibilityToken !== sideMenuVisibilityToken) return;
          const expectedRect = nativeSideMenuTargetRect;
          if (!expectedRect) {
            document.body.classList.remove('side-menu-visible');
            return;
          }
          const nativeSideMenus = Array.from(
            document.querySelectorAll('[data-floating-ui-focusable] > .bn-side-menu')
          ) as HTMLElement[];
          const nativeSideMenu = nativeSideMenus
            .filter((menu) => menu.dataset.blockType !== 'syncedBlockSource' && menu.dataset.blockType !== 'syncedBlockMirror')
            .map((menu) => {
              const wrapper = menu.closest('[data-floating-ui-focusable]') as HTMLElement | null;
              const rect = wrapper?.getBoundingClientRect();
              return { menu, wrapper, rect, distance: rect ? Math.abs(rect.top - expectedRect.top) : Infinity };
            })
            .sort((a, b) => a.distance - b.distance)[0]?.menu || null;
          const wrapper = nativeSideMenu?.closest('[data-floating-ui-focusable]') as HTMLElement | null;
          if (!nativeSideMenu || !wrapper) {
            document.body.classList.remove('side-menu-visible');
            return;
          }
          const wrapperRect = wrapper.getBoundingClientRect();
          const verticalReady =
            wrapperRect.height > 0 &&
            Math.abs(wrapperRect.top - expectedRect.top) <= 8;
          if (verticalReady) {
            document.body.classList.add('side-menu-visible');
          } else {
            document.body.classList.remove('side-menu-visible');
          }
        });
      });
    };

    const handleSideMenuZone = (e: MouseEvent) => {
      // When drag menu is open, keep side menu visible regardless of mouse position
      if (isDragMenuOpen()) return;

      const pointedSyncSourceOuter = (() => {
        const elements = document.elementsFromPoint(e.clientX, e.clientY);
        for (const element of elements) {
          if (!container.contains(element)) continue;
          const blockOuter = (element as HTMLElement).closest('.bn-block-outer');
          const syncOuter = findSyncedBlockOuter(blockOuter);
          const hoverRect = getSyncSourceHoverRect(syncOuter);
          if (
            syncOuter &&
            hoverRect &&
            e.clientX >= hoverRect.left &&
            e.clientX <= hoverRect.right &&
            e.clientY >= hoverRect.top &&
            e.clientY <= hoverRect.bottom
          ) {
            return syncOuter;
          }
        }
        const syncOuters = Array.from(
          container.querySelectorAll([
            '.bn-block-outer:has(> .bn-block > .react-renderer.node-syncedBlockSource)',
            '.bn-block-outer:has(> .bn-block > .react-renderer.node-syncedBlockMirror)',
          ].join(', '))
        ) as HTMLElement[];
        for (const syncOuter of syncOuters) {
          const hoverRect = getSyncSourceHoverRect(syncOuter);
          if (!hoverRect) continue;
          const leftBound = hoverRect.left - 150;
          const rightBound = hoverRect.left + hoverRect.width * 0.7;
          if (
            e.clientY >= hoverRect.top &&
            e.clientY <= hoverRect.bottom &&
            e.clientX >= leftBound &&
            e.clientX <= rightBound
          ) {
            return syncOuter;
          }
        }
        return null;
      })();
      const activeElementAtPoint = document.activeElement;
      const pointedSyncSourceIsActive = !!(
        pointedSyncSourceOuter &&
        (syncSourceHasActiveChildBlock(pointedSyncSourceOuter) ||
          selectionIsInside(pointedSyncSourceOuter) ||
          (activeElementAtPoint && pointedSyncSourceOuter.contains(activeElementAtPoint)))
      );

      if (pointedSyncSourceOuter && !pointedSyncSourceIsActive) {
        hideNativeSideMenu();
        showSyncSourceMenu(pointedSyncSourceOuter);
        return;
      }

      if (syncSourceMenu.dataset.visible === 'true') {
        const activeOuterRect = getSyncSourceHoverRect(hoveredSyncSourceOuter);
        const menuRect = getSyncSourceMenuRect();
        const bridgeRect = activeOuterRect && menuRect
          ? {
              left: Math.min(menuRect.left, activeOuterRect.left),
              right: Math.max(menuRect.right, activeOuterRect.left),
              top: menuRect.top - 4,
              bottom: menuRect.bottom + 4,
            }
          : null;
        const overActiveOuter = rectContainsPoint(activeOuterRect, e.clientX, e.clientY);
        const overSyncMenu = rectContainsPoint(menuRect, e.clientX, e.clientY);
        const overMenuBridge = rectContainsPoint(bridgeRect, e.clientX, e.clientY);
        if (syncSourceHasActiveChildBlock(hoveredSyncSourceOuter)) {
          hideSyncSourceMenu();
        } else if (overSyncMenu || overMenuBridge) {
          hideNativeSideMenu();
          return;
        } else if (!overActiveOuter) {
          hideSyncSourceMenu();
          hideNativeSideMenu();
          return;
        } else {
          return;
        }
      }

      // Find hovered block by y coordinate
      const blockOuters = container.querySelectorAll('.bn-block-outer');
      let hoveredOuter: HTMLElement | null = null;
      const activePointedSyncSourceOuter = pointedSyncSourceIsActive ? pointedSyncSourceOuter : null;
      // Find the content block closest to the mouse x-position.
      // For blocks inside columns, multiple blocks may match the y-position;
      // we pick the one whose content center is nearest to the mouse.
      let bestDist = Infinity;
      let fallbackOuter: HTMLElement | null = null;
      for (const outer of blockOuters) {
        if (outer === activePointedSyncSourceOuter || isSyncedBlockOuter(outer)) continue;
        const r = outer.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) {
          fallbackOuter = outer as HTMLElement;
          const blockContent = outer.querySelector(
            ':scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer, :scope > .bn-block'
          );
          if (blockContent) {
            const cr = blockContent.getBoundingClientRect();
            if (cr.width > 0 && cr.height > 0) {
              const centerX = cr.left + cr.width / 2;
              const dist = Math.abs(e.clientX - centerX);
              if (dist < bestDist) {
                bestDist = dist;
                hoveredOuter = outer as HTMLElement;
              }
            }
          }
        }
      }
      if (!hoveredOuter) hoveredOuter = fallbackOuter;

      if (!hoveredOuter) {
        hideNativeSideMenu();
        clearSyncSourceSideMenuMode();
        return;
      }

      const syncSourceOuter = findSyncedBlockOuter(hoveredOuter);
      const activeElement = document.activeElement;
      const syncSourceIsActive = !!(
        syncSourceOuter &&
        (syncSourceHasActiveChildBlock(syncSourceOuter) ||
          selectionIsInside(syncSourceOuter) ||
          (activeElement && syncSourceOuter.contains(activeElement)))
      );

      if (syncSourceOuter && !syncSourceIsActive) {
        hideSyncSourceMenu();
        hideNativeSideMenu();
        return;
      }

      hideSyncSourceMenu();

      if (syncSourceOuter && syncSourceIsActive && isSyncedBlockSourceOuter(hoveredOuter)) {
        hideNativeSideMenu();
        return;
      }

      // Get block content boundaries
      const blockContent = hoveredOuter.querySelector(
        ':scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer, :scope > .bn-block'
      ) || hoveredOuter;
      const contentRect = blockContent.getBoundingClientRect();

      // Notion's hover zone: left boundary = blockLeft - 150px, right boundary = blockLeft + blockWidth * 0.7
      const leftBound = contentRect.left - 150;
      const rightBound = contentRect.left + contentRect.width * 0.7;
      const verticalHit = e.clientY >= contentRect.top && e.clientY <= contentRect.bottom;

      if (verticalHit && e.clientX >= leftBound && e.clientX <= rightBound) {
        if (syncSourceOuter && syncSourceIsActive) {
          showNativeSideMenuWhenReady(contentRect);
        } else {
          if (nativeSideMenuFrame !== null) {
            cancelAnimationFrame(nativeSideMenuFrame);
            nativeSideMenuFrame = null;
          }
          nativeSideMenuTargetRect = null;
          nativeSideMenuTargetTop = null;
          document.body.classList.add('side-menu-visible');
        }
      } else {
        hideNativeSideMenu();
      }
    };

    document.addEventListener('mousemove', handleSideMenuZone);
    let syncSourceActiveFrame: number | null = null;
    const scheduleSyncSourceActiveRefresh = () => {
      if (syncSourceActiveFrame !== null) cancelAnimationFrame(syncSourceActiveFrame);
      syncSourceActiveFrame = requestAnimationFrame(() => {
        syncSourceActiveFrame = null;
        refreshActiveSyncSources();
      });
    };
    const unsubscribeEditorSelectionChange = editor.onSelectionChange?.(scheduleSyncSourceActiveRefresh);
    const syncSourceMutationObserver = new MutationObserver(scheduleSyncSourceActiveRefresh);
    syncSourceMutationObserver.observe(container, { childList: true, subtree: true });
    document.addEventListener('selectionchange', scheduleSyncSourceActiveRefresh);
    document.addEventListener('block-selection-change', scheduleSyncSourceActiveRefresh);
    container.addEventListener('focusin', scheduleSyncSourceActiveRefresh);
    container.addEventListener('keyup', scheduleSyncSourceActiveRefresh);

    return () => {
      if (syncSourceActiveFrame !== null) cancelAnimationFrame(syncSourceActiveFrame);
      hideNativeSideMenu();
      setActiveSyncSourceOuters(new Set());
      document.removeEventListener('mousemove', handleSideMenuZone);
      unsubscribeEditorSelectionChange?.();
      syncSourceMutationObserver.disconnect();
      document.removeEventListener('selectionchange', scheduleSyncSourceActiveRefresh);
      document.removeEventListener('block-selection-change', scheduleSyncSourceActiveRefresh);
      container.removeEventListener('focusin', scheduleSyncSourceActiveRefresh);
      container.removeEventListener('keyup', scheduleSyncSourceActiveRefresh);
      syncSourceMenu.removeEventListener('mousedown', syncSourceMenuMouseDown);
      syncSourceMenu.removeEventListener('click', syncSourceMenuClick);
      syncSourceMenu.remove();
      hideSyncSourceMenu();
    };
  }, [editor, readOnly]);

  useEffect(() => {
    if (readOnly) return;

    const syncImageSideMenuPosition = () => {
      const wrappers = Array.from(document.querySelectorAll('[data-floating-ui-focusable]')) as HTMLElement[];

      wrappers.forEach((wrapper) => {
        const sideMenu = wrapper.querySelector('.bn-side-menu[data-block-type="image"]') as HTMLElement | null;
        if (!sideMenu) {
          wrapper.style.removeProperty('--bn-image-side-menu-left');
          return;
        }

        const wrapperRect = wrapper.getBoundingClientRect();
        const probeX = Math.min(window.innerWidth - 1, Math.round(wrapperRect.right + 20));
        const probeY = Math.min(window.innerHeight - 1, Math.max(0, Math.round(wrapperRect.top + 2)));
        const elements = document.elementsFromPoint(probeX, probeY);

        let blockOuter: HTMLElement | null = null;
        for (const el of elements) {
          const candidate = (el as HTMLElement).closest('.bn-block-outer') as HTMLElement | null;
          if (candidate) {
            blockOuter = candidate;
            break;
          }
        }

        if (!blockOuter) {
          wrapper.style.removeProperty('--bn-image-side-menu-left');
          return;
        }

        const blockContent = blockOuter.querySelector('.bn-block-content[data-content-type="image"]') as HTMLElement | null;
        const imageWrapper = blockContent?.querySelector('.bn-file-block-content-wrapper') as HTMLElement | null;
        if (!blockContent || !imageWrapper) {
          wrapper.style.removeProperty('--bn-image-side-menu-left');
          return;
        }

        const blockRect = blockContent.getBoundingClientRect();
        const imageRect = imageWrapper.getBoundingClientRect();
        const offset = Math.round(-14 + (imageRect.left - blockRect.left));
        wrapper.style.setProperty('--bn-image-side-menu-left', `${offset}px`);
      });
    };

    const scheduleSync = () => requestAnimationFrame(syncImageSideMenuPosition);
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

    document.addEventListener('mousemove', scheduleSync, true);
    window.addEventListener('resize', scheduleSync);
    document.addEventListener('scroll', scheduleSync, true);
    scheduleSync();

    return () => {
      observer.disconnect();
      document.removeEventListener('mousemove', scheduleSync, true);
      window.removeEventListener('resize', scheduleSync);
      document.removeEventListener('scroll', scheduleSync, true);
    };
  }, [readOnly]);

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

    // Container blocks cannot receive a text cursor themselves — always insert after.
    const isContainerBlock = (
      lastDocBlock.type === 'column_list' ||
      lastDocBlock.type === 'column' ||
      lastDocBlock.type === 'syncedBlockSource' ||
      lastDocBlock.type === 'syncedBlockMirror'
    );

    // Check if the last block is input-capable (has editable text)
    // Non-input blocks like subpage, bookmark, pageReference can't receive cursor
    const container = editorRef.current;
    const blockOuters = container?.querySelectorAll('.bn-block-outer');
    const lastOuter = blockOuters?.[blockOuters.length - 1];
    const lastIsInput = lastOuter ? isInputBlock(lastOuter as HTMLElement) : false;

    if (!isContainerBlock && lastIsEmpty && lastIsInput) {
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

    const scrollArea = container.closest('.overflow-y-auto') as HTMLElement | null;
    if (!scrollArea) return;

    // Track whether mousedown started on a contenteditable element (e.g. title h1).
    // When the user drags to select text in the title and the mouse moves into
    // the editor area, a click event fires on scrollArea (common ancestor).
    // Without this guard, handleScrollAreaClick would steal focus to the editor.
    let mouseDownOnContentEditable = false;
    const trackMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      mouseDownOnContentEditable = !!target.closest('[contenteditable="true"]');
    };
    scrollArea.addEventListener('mousedown', trackMouseDown, true);

    const handleScrollAreaClick = (e: MouseEvent) => {
      if (mouseDownOnContentEditable) {
        mouseDownOnContentEditable = false;
        return;
      }
      const target = e.target as HTMLElement;
      // Allow clicks on column_list/column block-outers to pass through
      // so clicking below column content creates a new root-level paragraph
      const clickedOuter = target.closest('.bn-block-outer');
      if (clickedOuter) {
        const contentType = clickedOuter.querySelector('[data-content-type]');
        const type = contentType?.getAttribute('data-content-type');
        const isSyncedBlockOuter = !!clickedOuter.querySelector(
          ':scope > .bn-block > .react-renderer.node-syncedBlockSource, :scope > .bn-block > .react-renderer.node-syncedBlockMirror'
        );
        if (isSyncedBlockOuter) {
          const contentBlocks = clickedOuter.querySelectorAll(':scope > .bn-block > .bn-block-group > .bn-block-outer');
          let lowestContentBottom = 0;
          contentBlocks.forEach(b => {
            const r = b.getBoundingClientRect();
            if (r.bottom > lowestContentBottom) lowestContentBottom = r.bottom;
          });
          if (contentBlocks.length > 0 && e.clientY >= lowestContentBottom - 5) {
            const syncBlockEl = clickedOuter.querySelector(':scope > .bn-block[data-id]');
            const syncBlockId = syncBlockEl?.getAttribute('data-id');
            if (!syncBlockId) return;
            const inserted = editor.insertBlocks([{ type: 'paragraph' } as any], syncBlockId as any, 'after');
            if (inserted.length > 0) {
              editor.setTextCursorPosition(inserted[0], 'start');
              editor.focus();
            }
            return;
          }
          return;
        }
        if (type === 'column_list' || type === 'column') {
          // column_list/column outer: check if click is below all content blocks
          const contentBlocks = clickedOuter.querySelectorAll(':scope .bn-block-outer');
          let lowestContentBottom = 0;
          contentBlocks.forEach(b => {
            const r = b.getBoundingClientRect();
            if (r.bottom > lowestContentBottom) lowestContentBottom = r.bottom;
          });
          if (e.clientY >= lowestContentBottom - 5) {
            // Click is below all content — treat as "click below" to append paragraph
            handleClickBelow();
            return;
          }
          return; // Click inside column content area — ignore
        }
        // Regular block outer — skip
        return;
      }
      if (target.closest('button, a, input, [contenteditable="true"]')) return;
      if (target.closest('[data-floating-ui-focusable]')) return;
      if (target.closest('.tcm-menu')) return;

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
    return () => {
      scrollArea.removeEventListener('mousedown', trackMouseDown, true);
      scrollArea.removeEventListener('click', handleScrollAreaClick);
    };
  }, [readOnly, handleClickBelow, findBlockByY, isInputBlock, findNearestInputBlock, editor]);

  // Register a lightweight flush function for the router guard (useBlocker
  // in PageViewPage). When the user navigates away from this page, the
  // guard awaits this function before allowing the route change. The flush
  // writes ONLY the IndexedDB mirror (fast, ~5-50ms) — HTTP uploads and
  // server refreshes stay in the background so switches stay snappy.
  // On success it clears hasChangesRef so the unmount cleanup below won't
  // write a duplicate mirror.
  useEffect(() => {
    useEditorFlushStore.getState().setFlushFn(async () => {
      if (!hasChangesRef.current || readOnlyRef.current) return;
      const { spaceSlug, pageId } = identityRef.current;
      const markdown = blocksToMarkdown(editor.document);
      await createMirror(spaceSlug, pageId, markdown);
      hasChangesRef.current = false;
    });
    return () => {
      useEditorFlushStore.getState().setFlushFn(null);
    };
  }, [editor]);

  // Unmount: write final mirror if there are unsaved changes
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      const { spaceSlug, pageId } = identityRef.current;
      if (hasChangesRef.current && !readOnlyRef.current) {
        try {
          const currentBlocks = editor.document;
          const markdown = blocksToMarkdown(currentBlocks);
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

  // Table: highlight the cell containing the cursor
  // Note: ProseMirror re-creates td DOM elements on click, so we cannot use
  // JS-set attributes. Instead, we use pure CSS with :has() and
  // ProseMirror's data-is-empty-and-focused attribute on paragraphs.
  // For non-empty cells, we rely on the ProseMirror selection decoration.

  // Custom code button with </> icon
  const CodeButton = useCallback(() => {
    const editor = useBlockNoteEditor();
    const Components = useComponentsContext()!;
    const state = useEditorState({
      editor,
      selector: ({ editor: e }) => {
        if (!e.isEditable) return undefined;
        const blocks = e.getSelection()?.blocks || [e.getTextCursorPosition().block];
        if (!blocks.find((b: any) => b.content !== undefined)) return undefined;
        return 'code' in e.getActiveStyles() ? { active: true } : { active: false };
      },
    });
    if (state === undefined) return null;
    return (
      <Components.FormattingToolbar.Button
        className="bn-button"
        onClick={() => { editor.focus(); editor.toggleStyles({ code: true }); }}
        isSelected={state.active}
        label="代码"
        mainTooltip="代码"
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <line x1="14" y1="4" x2="10" y2="20" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        }
      />
    );
  }, []);

  // Stable reference for formatting toolbar content — prevents React from
  // unmounting/remounting on every editor state change (which would reset
  // the color picker's open/close state).
  const formattingToolbarComponent = useCallback(() => (
    <FormattingToolbar>
      <BlockTypeSelect key="blockType" />
      <ColorStyleButton key="color" />
      <BasicTextStyleButton basicTextStyle="bold" key="bold" />
      <BasicTextStyleButton basicTextStyle="italic" key="italic" />
      <BasicTextStyleButton basicTextStyle="underline" key="underline" />
      <BasicTextStyleButton basicTextStyle="strike" key="strike" />
      <CodeButton key="code" />
      <CreateLinkButton key="link" />
    </FormattingToolbar>
  ), [CodeButton]);

  // Hide formatting toolbar during multi-cell selection (CellSelection)
  const isCellSelection = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const sel = e._tiptapEditor.state.selection as any;
      return !!(sel.$anchorCell && sel.$headCell);
    },
  });


  // Suppress BlockNote's internal error with merged table cells
  // (accessing .id on undefined block reference in table-widgets mousemove handler)
  useEffect(() => {
    const handler = (e: ErrorEvent) => {
      if (e.message?.includes("Cannot read properties of undefined (reading 'id')")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('error', handler);
    return () => window.removeEventListener('error', handler);
  }, []);

  useEffect(() => {
    if (!editorEl) return;

    const sync = () => syncTableExtendButtonVisibility(editorEl);
    const scheduleSync = () => requestAnimationFrame(sync);
    const observer = new MutationObserver(scheduleSync);

    observer.observe(editorEl, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['class', 'style'],
    });

    editorEl.addEventListener('scroll', scheduleSync, true);
    window.addEventListener('resize', scheduleSync);
    scheduleSync();

    return () => {
      observer.disconnect();
      editorEl.removeEventListener('scroll', scheduleSync, true);
      window.removeEventListener('resize', scheduleSync);
    };
  }, [editorEl]);

  return (
    <div className="relative" ref={editorRefCallback} data-page-editor="true">
      <ComponentsContext.Provider value={blockNoteComponents as any}>
        <div>
          <BlockNoteViewRaw
            editor={editor as any}
            editable={!readOnly}
            onChange={handleChange}
            theme="light"
            slashMenu={false}
            sideMenu={true}
            formattingToolbar={false}
            linkToolbar={false}
          >
            {/* Custom formatting toolbar — hidden during multi-cell selection */}
            {!readOnly && !isCellSelection && (
              <FormattingToolbarController
                formattingToolbar={formattingToolbarComponent}
              />
            )}
            {/* Custom link toolbar — hover tooltip + edit popup */}
            {!readOnly && (
              <CustomLinkToolbar />
            )}
            {/* Link preview card — hover card for mentions */}
            {!readOnly && (
              <LinkPreviewCard />
            )}
            {!readOnly && (
              <FilePanelController />
            )}
            {/* Custom slash menu with subpage support */}
            {!readOnly && (
              <SuggestionMenuController
                triggerCharacter="/"
                getItems={async (query: string) => filterSlashMenuItems(getCustomSlashMenuItems(editor), query)}
              />
            )}
          </BlockNoteViewRaw>
        </div>
      </ComponentsContext.Provider>
      {/* Custom code block toolbar — language selector + copy button */}
      <CodeBlockToolbar editorContainer={editorEl} />
      {/* Table cell menu — notch hover detection + cell context menu */}
      <TableCellMenu editorContainer={editorEl} />
      {/* Find & Replace floating panel */}
      {findReplace.open && (
        <FindReplacePanel
          editor={editor as any}
          initialMode={findReplace.mode}
          onClose={() => setFindReplace((s) => ({ ...s, open: false }))}
        />
      )}
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
          onInsertMention={handleInsertMention}
          onClose={() => setPasteMenu(null)}
        />
      )}
      {syncedPaste && (
        <SyncedBlockPasteDialog
          sourceMarkdown={syncedPaste.sourceMarkdown}
          onCreateSynced={handleCreateSyncedPaste}
          onPasteNormal={handleNormalSyncedPaste}
          onClose={() => setSyncedPaste(null)}
        />
      )}
      {syncedDelete && (
        <SyncedBlockDeleteDialog
          quotedCount={syncedDelete.quotedCount}
          onSelect={handleSyncedDeleteStrategy}
          onClose={() => setSyncedDelete(null)}
        />
      )}
      <input
        ref={imageReplaceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageReplaceInput}
      />
      {imageLightbox && (
        <div
          className="bn-image-lightbox"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setImageLightbox(null);
            }
          }}
        >
          <button
            type="button"
            className="bn-image-lightbox-close"
            onClick={() => setImageLightbox(null)}
            aria-label="关闭图片预览"
          >
            ×
          </button>
          {imageLightbox.type === 'video' ? (
            <video
              className="bn-image-lightbox-media"
              src={imageLightbox.url}
              controls
              autoPlay
              draggable={false}
            />
          ) : (
            <img
              className="bn-image-lightbox-media"
              src={imageLightbox.url}
              alt={imageLightbox.name}
              draggable={false}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default PageEditor;
