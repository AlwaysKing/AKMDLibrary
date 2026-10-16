import type { Highlighter } from 'shiki';
import { getCodeThemeRegistration, type CodeThemeValue } from '../../utils/codeTheme';
import { LANGUAGES } from './languages';

const SHIKI_LANG_IDS = LANGUAGES.map(([id]) => id).filter((id) => id !== 'text');
const PLAIN_LANG_IDS = new Set(['text', 'none', 'plaintext', 'txt']);

let highlighterPromise: Promise<Highlighter> | null = null;
let highlighterTheme: CodeThemeValue | null = null;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function stringifyStyle(style: unknown) {
  if (typeof style === 'string') return style;
  if (!style || typeof style !== 'object') return '';
  return Object.entries(style as Record<string, unknown>)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

async function ensureHighlighter(codeTheme: CodeThemeValue) {
  if (!highlighterPromise || highlighterTheme !== codeTheme) {
    highlighterTheme = codeTheme;
    highlighterPromise = (async () => {
      const { createHighlighter: createShikiHighlighter } = await import('shiki');
      const themeRegistration = getCodeThemeRegistration(codeTheme);
      return createShikiHighlighter({
        themes: [themeRegistration as any],
        langs: SHIKI_LANG_IDS,
      });
    })();
  }
  return highlighterPromise;
}

/**
 * Return one HTML string per source line. The overlay can therefore retain
 * unchanged line DOM nodes and replace only the lines touched by an edit.
 */
export async function renderFileContentHighlightLines(
  content: string,
  language: string,
  codeTheme: CodeThemeValue,
) {
  const plainLines = content.split('\n').map(escapeHtml);
  if (!content || !language || PLAIN_LANG_IDS.has(language)) {
    return plainLines;
  }

  try {
    const highlighter = await ensureHighlighter(codeTheme);
    if (!highlighter.getLoadedLanguages().includes(language)) {
      await highlighter.loadLanguage(language as any);
    }

    const theme = highlighter.getLoadedThemes()[0];
    const result = highlighter.codeToTokens(content, {
      lang: language as any,
      theme,
    });
    const lines = result.tokens.map((tokens) => tokens.map((token: any) => {
      const style = stringifyStyle(token.htmlStyle ?? (token.color ? { color: token.color } : ''));
      const text = escapeHtml(token.content);
      return style
        ? `<span class="shiki" style="${escapeAttribute(style)}">${text}</span>`
        : text;
    }).join(''));

    // Shiki may omit trailing empty lines. Keep the overlay line count aligned
    // with the editable text so newlines render at the correct height.
    while (lines.length < plainLines.length) lines.push('');
    return lines;
  } catch {
    return plainLines;
  }
}
