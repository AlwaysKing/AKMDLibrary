import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * FindReplaceExtension
 *
 * ProseMirror Plugin that performs in-document text search and replacement.
 * - Holds search state (term, matches, current index) in plugin state
 * - Highlights matches via ProseMirror Decorations (no DOM mutation)
 * - Replacements go through transactions so undo/redo works natively
 * - Exposes an imperative API on the editor for the React panel to call
 *
 * Communication model:
 *   React panel → editor.findReplace.* (imperative methods) → dispatch tr with meta
 *   Plugin state.apply → reads meta or docChanged → returns new FindReplaceState
 *   Plugin props.decorations → builds inline Decorations from current state
 */

export type FindMatch = {
  from: number;
  to: number;
};

export type FindReplaceState = {
  searchTerm: string;
  replaceTerm: string;
  matches: FindMatch[];
  currentIndex: number; // 0-based; -1 when no matches / not started
};

export const findReplaceKey = new PluginKey<FindReplaceState>('findReplace');

const DEFAULT_STATE: FindReplaceState = {
  searchTerm: '',
  replaceTerm: '',
  matches: [],
  currentIndex: -1,
};

/**
 * Walk the ProseMirror document and return all case-insensitive matches
 * of `term` across text nodes. Matches do not span node boundaries.
 */
function findMatches(doc: any, term: string): FindMatch[] {
  const matches: FindMatch[] = [];
  if (!term) return matches;

  const lower = term.toLowerCase();
  doc.descendants((node: any, pos: number) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let from = 0;
    while (from <= text.length - lower.length) {
      const idx = text.indexOf(lower, from);
      if (idx === -1) break;
      matches.push({ from: pos + idx, to: pos + idx + lower.length });
      from = idx + 1;
    }
  });
  return matches;
}

/**
 * Build a DecorationSet that highlights every match. The current match
 * gets a distinct class so the panel can visually distinguish it.
 */
function buildDecorations(doc: any, state: FindReplaceState): DecorationSet {
  if (state.matches.length === 0) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  state.matches.forEach((m, i) => {
    const className = i === state.currentIndex ? 'find-match-current' : 'find-match';
    decorations.push(Decoration.inline(m.from, m.to, { class: className }));
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Recompute matches for the current term and clamp the current index.
 * `keepNearPos` biases the initial current match toward a document
 * position (e.g. the replacement cursor) so navigation feels natural.
 */
function recompute(state: FindReplaceState, doc: any, keepNearPos?: number): FindReplaceState {
  const matches = findMatches(doc, state.searchTerm);
  let currentIndex = -1;
  if (matches.length > 0) {
    if (keepNearPos !== undefined) {
      const atOrAfter = matches.findIndex((m) => m.from >= keepNearPos);
      currentIndex = atOrAfter === -1 ? matches.length - 1 : atOrAfter;
    } else if (state.currentIndex >= 0 && state.currentIndex < matches.length) {
      currentIndex = state.currentIndex;
    } else {
      currentIndex = 0;
    }
  }
  return { ...state, matches, currentIndex };
}

/**
 * Scroll the current match into view.
 *
 * This only scrolls — it deliberately does NOT touch the ProseMirror
 * selection. Setting a text selection on the match range would trigger
 * BlockNote's FormattingToolbarController (any non-empty text selection
 * pops the `bn-formatting-toolbar`), which is undesirable while the user
 * is navigating search results. Highlighting is handled separately by
 * ProseMirror Decorations (`find-match-current` class).
 *
 * Implementation strategy:
 *   1. Use `view.coordsAtPos(match.from)` to get the exact viewport
 *      coordinates of the match position.
 *   2. Compute the delta needed to bring those coords inside the scroll
 *      container's visible rect and call `scrollBy` on the container.
 *
 * Why we can't use ProseMirror's `tr.scrollIntoView()`:
 *   Under the BlockNote → TipTap → ProseMirror wrapper stack, with the
 *   editor unfocused (the search input holds focus during Cmd+F) and the
 *   real scroll container being the outer `.overflow-y-auto`, ProseMirror's
 *   own scroll-into-view does not reliably reach the visible scroll parent.
 *
 * Why we can't use native `leaf.scrollIntoView({ block: 'nearest' })` on
 * the DOM at the match position:
 *   For `codeBlock`, `view.domAtPos()` returns a text node whose parent
 *   is the single `<code>` element wrapping ALL of the code (newlines are
 *   characters, not separate block elements). `<code>` is then taller
 *   than the viewport, and `scrollIntoView({ block: 'nearest' })` on it
 *   scrolls so the element's TOP lands at the viewport top — i.e. it
 *   scrolls to the start of the code block, not the matched line.
 *
 * `coordsAtPos` is computed by ProseMirror independently of the DOM
 * hierarchy, so it gives the correct y-coordinate of the matched line
 * regardless of whether `domAtPos` would return the line's text node or
 * the whole `<code>` wrapper.
 */
function scrollMatchIntoView(editor: any, match: FindMatch) {
  try {
    const { view } = editor;
    const coords = view.coordsAtPos(match.from);
    // The editor's vertical scroll container. Matches the pattern used
    // elsewhere in this codebase (PageEditor.tsx ~L5298, L6840).
    const container = (view.dom.closest?.('.overflow-y-auto') as HTMLElement | null) ?? null;
    if (container) {
      const cRect = container.getBoundingClientRect();
      const margin = 8;
      if (coords.top < cRect.top + margin) {
        // Match is above the visible area — scroll up.
        container.scrollBy({ top: coords.top - cRect.top - margin, behavior: 'smooth' });
      } else if (coords.bottom > cRect.bottom - margin) {
        // Match is below the visible area — scroll down.
        container.scrollBy({ top: coords.bottom - cRect.bottom + margin, behavior: 'smooth' });
      }
      return;
    }
    // Fallback: no `.overflow-y-auto` ancestor — use native scrollIntoView
    // on the leaf element. Less precise for code blocks but still better
    // than nothing.
    const { node } = view.domAtPos(match.from);
    const leaf = node instanceof HTMLElement ? node : node.parentElement;
    leaf?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch {
    // Scroll is best-effort; never throw during search nav.
  }
}

// ---- Imperative API exposed on the editor ----

export type FindReplaceAPI = {
  setSearchTerm(term: string): void;
  setReplaceTerm(term: string): void;
  next(): void;
  prev(): void;
  replaceCurrent(): void;
  replaceAll(): void;
  getState(): FindReplaceState;
};

export const FindReplaceExtension = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    const editor = this.editor;

    const api: FindReplaceAPI = {
      setSearchTerm(term: string) {
        const tr = editor.state.tr.setMeta(findReplaceKey, { type: 'set-term', term });
        editor.view.dispatch(tr);
      },
      setReplaceTerm(term: string) {
        const tr = editor.state.tr.setMeta(findReplaceKey, { type: 'set-replace-term', term });
        editor.view.dispatch(tr);
      },
      next() {
        const tr = editor.state.tr.setMeta(findReplaceKey, { type: 'goto', delta: 1 });
        editor.view.dispatch(tr);
        const s = findReplaceKey.getState(editor.state);
        if (s && s.currentIndex >= 0) {
          const m = s.matches[s.currentIndex];
          if (m) scrollMatchIntoView(editor, m);
        }
      },
      prev() {
        const tr = editor.state.tr.setMeta(findReplaceKey, { type: 'goto', delta: -1 });
        editor.view.dispatch(tr);
        const s = findReplaceKey.getState(editor.state);
        if (s && s.currentIndex >= 0) {
          const m = s.matches[s.currentIndex];
          if (m) scrollMatchIntoView(editor, m);
        }
      },
      replaceCurrent() {
        const s = findReplaceKey.getState(editor.state);
        if (!s || s.currentIndex < 0 || !s.matches[s.currentIndex]) return;
        const m = s.matches[s.currentIndex];
        const text = s.replaceTerm;
        let tr = editor.state.tr.deleteRange(m.from, m.to);
        tr.insertText(text, m.from);
        // Recompute state against the post-replacement doc and bias toward
        // the position right after the inserted text.
        tr = tr.setMeta(findReplaceKey, {
          type: 'set-state',
          state: recompute({ ...s, matches: [], currentIndex: -1 }, tr.doc, m.from + text.length),
        });
        editor.view.dispatch(tr);
        const after = findReplaceKey.getState(editor.state);
        if (after && after.currentIndex >= 0) {
          scrollMatchIntoView(editor, after.matches[after.currentIndex]);
        }
      },
      replaceAll() {
        const s = findReplaceKey.getState(editor.state);
        if (!s || s.matches.length === 0) return;
        const text = s.replaceTerm;
        let tr = editor.state.tr;
        // Replace from the end to avoid offset drift for earlier matches.
        const sorted = [...s.matches].sort((a, b) => b.from - a.from);
        for (const m of sorted) {
          tr.deleteRange(m.from, m.to);
          tr.insertText(text, m.from);
        }
        tr = tr.setMeta(findReplaceKey, {
          type: 'set-state',
          state: recompute({ ...s, matches: [], currentIndex: -1 }, tr.doc, 0),
        });
        editor.view.dispatch(tr);
      },
      getState() {
        return findReplaceKey.getState(editor.state) ?? { ...DEFAULT_STATE };
      },
    };

    // Stash the API on the editor so the React layer can grab it.
    (editor as any).findReplace = api;

    const plugin = new Plugin<FindReplaceState>({
      key: findReplaceKey,
      state: {
        init() {
          return { ...DEFAULT_STATE };
        },
        apply(tr, oldState, _oldEditorState, newEditorState) {
          const meta = tr.getMeta(findReplaceKey) as
            | { type: 'set-term'; term: string }
            | { type: 'set-replace-term'; term: string }
            | { type: 'set-state'; state: FindReplaceState }
            | { type: 'goto'; delta: number }
            | undefined;

          if (meta?.type === 'set-term') {
            return recompute({ ...oldState, searchTerm: meta.term }, newEditorState.doc, 0);
          }
          if (meta?.type === 'set-replace-term') {
            return { ...oldState, replaceTerm: meta.term };
          }
          if (meta?.type === 'set-state') {
            return meta.state;
          }
          if (meta?.type === 'goto') {
            if (oldState.matches.length === 0) return oldState;
            const n = oldState.matches.length;
            const idx = ((oldState.currentIndex + meta.delta) % n + n) % n;
            return { ...oldState, currentIndex: idx };
          }
          if (tr.docChanged) {
            return recompute(oldState, newEditorState.doc);
          }
          return oldState;
        },
      },
      props: {
        decorations(state) {
          const s = findReplaceKey.getState(state);
          if (!s) return null;
          return buildDecorations(state.doc, s);
        },
      },
    });

    return [plugin];
  },
});
