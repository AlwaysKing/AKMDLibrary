import { Extension } from '@tiptap/core';
import { createHighlightPlugin } from 'prosemirror-highlight';
import { createParser } from 'prosemirror-highlight/shiki';
import type { Highlighter } from 'shiki';
import { getCodeThemeRegistration, type CodeThemeValue } from '../../utils/codeTheme';
import { LANGUAGES } from './languages';

/**
 * Adds Shiki-based syntax highlighting to `fileContent` blocks, mirroring the
 * code block highlighting that BlockNote applies to `codeBlock` nodes.
 *
 * Why this exists: BlockNote's built-in highlight plugin is hardcoded to
 * `nodeTypes: ["codeBlock"]`, so custom block types that also want Shiki
 * decorations need their own plugin. We build a parallel highlighter with the
 * same theme + language list as the code block so the visuals match.
 *
 * Created via a factory so the highlighter picks up the current code theme.
 */

const SHIKI_LANG_IDS = LANGUAGES.map(([id]) => id).filter((id) => id !== 'text');

const PLAIN_LANG_IDS = new Set(['text', 'none', 'plaintext', 'txt']);

interface ParserOpts {
  language?: string;
  [key: string]: unknown;
}

export function createFileContentHighlightExtension(codeTheme: CodeThemeValue) {
  let highlighterPromise: Promise<Highlighter> | null = null;
  let resolvedHighlighter: Highlighter | null = null;
  let parser: ((opts: ParserOpts) => unknown[]) | null = null;

  const ensureHighlighter = (): Promise<Highlighter> => {
    if (!highlighterPromise) {
      highlighterPromise = (async () => {
        const { createHighlighter: createShikiHighlighter } = await import('shiki');
        const themeRegistration = getCodeThemeRegistration(codeTheme);
        return createShikiHighlighter({
          themes: [themeRegistration as any],
          langs: SHIKI_LANG_IDS,
        });
      })();
      highlighterPromise.then((h) => {
        resolvedHighlighter = h;
      });
    }
    return highlighterPromise;
  };

  // Mirrors BlockNote's parser logic: kick off highlighter load on first
  // call (plugin will re-run when the promise resolves), skip plain text,
  // load missing languages on demand.
  const parserFn = (opts: ParserOpts): any => {
    const lang = opts?.language;
    if (!lang || PLAIN_LANG_IDS.has(lang)) return [];
    if (!resolvedHighlighter) {
      return ensureHighlighter().then(() => parserFn(opts));
    }
    const loaded = (resolvedHighlighter as any).getLoadedLanguages?.() ?? [];
    if (!loaded.includes(lang)) {
      return (resolvedHighlighter as any).loadLanguage(lang).then(() => parserFn(opts));
    }
    if (!parser) {
      parser = createParser(resolvedHighlighter as any) as unknown as (opts: ParserOpts) => unknown[];
    }
    return parser(opts);
  };

  return Extension.create({
    name: 'fileContentHighlighter',
    addProseMirrorPlugins() {
      return [
        createHighlightPlugin({
          parser: parserFn as any,
          nodeTypes: ['fileContent'],
          languageExtractor: (node: any) => node?.attrs?.language,
        } as any),
      ];
    },
  });
}
