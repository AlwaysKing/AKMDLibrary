/**
 * Module-level clipboard state for cross-document block copy/paste.
 * Persists across SPA page navigations (React Router).
 */

let clipboardBlocks: any[] | null = null;
let clipboardMarkdown: string | null = null;
let clipboardIsCut = false;

export function setClipboardData(blocks: any[], markdown: string, isCut: boolean): void {
  clipboardBlocks = blocks;
  clipboardMarkdown = markdown;
  clipboardIsCut = isCut;
}

export function getClipboardData(): { blocks: any[]; markdown: string; isCut: boolean } | null {
  if (!clipboardBlocks || clipboardBlocks.length === 0) return null;
  return { blocks: clipboardBlocks, markdown: clipboardMarkdown!, isCut: clipboardIsCut };
}

export function clearClipboardData(): void {
  clipboardBlocks = null;
  clipboardMarkdown = null;
  clipboardIsCut = false;
}
