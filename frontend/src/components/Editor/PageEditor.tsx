import { useEffect, useState, useCallback, useRef } from 'react';
import { BlockNoteViewRaw, useCreateBlockNote, ComponentsContext, SuggestionMenuController, FormattingToolbar, FormattingToolbarController, BasicTextStyleButton, ColorStyleButton, CreateLinkButton, BlockTypeSelect, useBlockNoteEditor, useEditorState, useComponentsContext } from '@blocknote/react';
import CustomLinkToolbar from './CustomLinkToolbar';
import LinkPreviewCard from './LinkPreviewCard';
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems } from '@blocknote/core';
import { getDefaultReactSlashMenuItems } from '@blocknote/react';
import { zh } from '@blocknote/core/locales';
import '@blocknote/react/style.css';
import { markdownToBlocks, blocksToMarkdown } from '../../utils/markdown';
import { blockNoteComponents, setBlockSelection, getSelectedBlockIds, isDragMenuOpen, GROUP_ORDER } from './BlockNoteComponents';
import { removeBlocksEnhanced } from './blockHelpers';
import { PageReferenceBlockSpec } from './PageReferenceBlock';
import { TextSelection } from '@tiptap/pm/state';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension } from '@tiptap/core';
import { setClipboardData, getClipboardData, addPendingRestore, removePendingRestore, setSubpageUndoAction, getSubpageUndoAction, clearSubpageUndoAction } from './blockClipboardState';
import { BookmarkBlockSpec } from './BookmarkBlock';
import { SubpageBlockSpec } from './SubpageBlock';
import LinkPasteMenu from './LinkPasteMenu';
import { getBlockDragData, markDragHandled } from './blockDragState';
import { pageMetaCache } from './PageMetaCache';
import { mentionMetaCache } from './MentionMetaCache';
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
    paragraph: { ...zh.slash_menu.paragraph, group: '列表' },
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
function NotionHeadingIcon({ level }: { level: number }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor">
      <path d={NOTION_HEADING_PATHS[level]} />
    </svg>
  );
}

// Notion toggle heading icon — uses exact Notion SVG paths (viewBox 0 0 20 20)
function NotionToggleHeadingIcon({ level }: { level: number }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor">
      <path d={NOTION_TOGGLE_HEADING_PATHS[level]} />
    </svg>
  );
}

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
  // Sort 基础区块 items to: headings first, then toggle headings
  filtered.sort((a: any, b: any) => {
    const aOrder = BASE_BLOCK_ORDER[a.key];
    const bOrder = BASE_BLOCK_ORDER[b.key];
    if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
    return 0;
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
      title: '子页面',
      subtext: '创建并链接到子页面',
      key: 'subpage',
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

// Mutable ref so the TipTap extension can access the BlockNote editor
const bnEditorRef: { current: any } = { current: null };

/**
 * BlockNote built-in input rules vs our slash menu shortcuts:
 *   ✅ # → heading, `` ``` `` → code, --- → divider, -/+/* → bullet,
 *      [] → check, 1. → numbered, > → toggle list
 *   ❌ #> → toggle heading, "" → quote, || → table
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

            // --- Quote: "" (straight quotes) or "“”" (smart quotes) ---
            if ((textBefore === '""' || textBefore === '“”' || textBefore === '„“') && event.key === ' ') {
              event.preventDefault();
              const tr = view.state.tr.deleteRange(from - 2, from);
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
          apply(tr, oldValue, oldState, newState) {
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
    const editor = this.editor;
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
          apply(tr, oldValue, oldState, newState) {
            // Only rebuild when doc changed or async mention meta arrived
            if (!tr.docChanged && !tr.getMeta('mentionMetaReady')) return oldValue;
            return buildInternalLinkDecorations(newState.doc, spaceSlug(), _badgeEditorView);
          },
        },
        props: {
          decorations(state) {
            return internalLinkBadgeKey.getState(state) ?? DecorationSet.empty;
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

function buildInternalLinkDecorations(doc: any, spaceSlug: string, editorView?: any): DecorationSet {
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
      const mentionUrl = href;
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
        if (meta.favicon_url) {
          const img = document.createElement('img');
          img.className = 'mention-badge-icon';
          img.src = meta.favicon_url;
          img.alt = '';
          img.onerror = () => {
            // Replace failed favicon with fallback icon
            const fallback = document.createElement('span');
            fallback.className = 'mention-badge-fallback-icon';
            fallback.textContent = '🔗';
            img.replaceWith(fallback);
          };
          badge.appendChild(img);
        } else {
          const icon = document.createElement('span');
          icon.className = 'mention-badge-fallback-icon';
          icon.textContent = '🔗';
          badge.appendChild(icon);
        }
        const titleEl = document.createElement('span');
        titleEl.className = 'mention-badge-title';
        titleEl.textContent = meta.title;
        badge.appendChild(titleEl);
      } else {
        // No meta yet: show URL, fetch in background
        const icon = document.createElement('span');
        icon.className = 'mention-badge-fallback-icon';
        icon.textContent = '🔗';
        badge.appendChild(icon);
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
        window.open(mentionUrl, '_blank', 'noopener,noreferrer');
      });

      decorations.push(Decoration.widget(pos, badge, { side: -1 }));
      return;
    }

    // Internal page link
    const match = href.match(INTERNAL_URL_RE);
    if (!match) return;

    const pageId = match[2];
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
      window.location.href = href;
    });

    decorations.push(Decoration.widget(pos, badge, { side: -1 }));

    // If meta not cached, fetch and trigger re-render
    if (!meta && spaceSlug) {
      pageMetaCache.getOrFetch(pageId, spaceSlug).then(() => {
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
    _tiptapOptions: { extensions: [CustomInputRules, NumberedListIndexFix, InternalLinkBadge] },
  } as any);

  // Wire up the editor ref for ToggleHeadingInputRules
  useEffect(() => {
    bnEditorRef.current = editor;
  }, [editor]);

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

      pmView.state.doc.descendants((node, pos) => {
        if (found) return false;
        if (!node.isText || !node.marks) return;
        const link = node.marks.find((m: any) => m.type === linkMark && m.attrs.href === url);
        if (link && node.text?.startsWith(MENTION_PREFIX_LOCAL)) {
          found = true;
          // Find the block containing this mention
          const $pos = pmView.state.doc.resolve(pos);
          const blockNode = $pos.parent;
          const blockStart = $pos.start() - 1; // pos before block content
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

          // Record undo actions for pasted subpage blocks (undo should delete them)
          for (const block of clipData.blocks) {
            if (block.type === 'subpage' && block.props?.pageId) {
              setSubpageUndoAction(block.props.pageId, { action: 'delete' });
            }
          }

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
    return () => {
      scrollArea.removeEventListener('mousedown', trackMouseDown, true);
      scrollArea.removeEventListener('click', handleScrollAreaClick);
    };
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
            formattingToolbar={false}
            linkToolbar={false}
          >
            {/* Custom formatting toolbar — only select, basic styles, color, link */}
            {!readOnly && (
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
          onInsertMention={handleInsertMention}
          onClose={() => setPasteMenu(null)}
        />
      )}
    </div>
  );
}

export default PageEditor;
