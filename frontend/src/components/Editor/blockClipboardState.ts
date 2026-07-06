/**
 * Module-level clipboard state for cross-document block copy/paste.
 * Persists across SPA page navigations (React Router).
 */

let clipboardBlocks: any[] | null = null;
let clipboardMarkdown: string | null = null;
let clipboardIsCut = false;

export type PendingSyncedPaste = {
  sourceSpaceSlug: string;
  sourcePageId: string;
  sourceBlockIds: string[];
  sourceMarkdown: string;
  blocks: any[];
  createdAt: number;
};

let pendingSyncedPaste: PendingSyncedPaste | null = null;
const PENDING_SYNCED_PASTE_TTL_MS = 5 * 60 * 1000;

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

export function setPendingSyncedPaste(data: Omit<PendingSyncedPaste, 'createdAt'>): void {
  pendingSyncedPaste = { ...data, createdAt: Date.now() };
}

export function getPendingSyncedPaste(): PendingSyncedPaste | null {
  if (!pendingSyncedPaste) return null;
  if (Date.now() - pendingSyncedPaste.createdAt > PENDING_SYNCED_PASTE_TTL_MS) {
    pendingSyncedPaste = null;
    return null;
  }
  return pendingSyncedPaste;
}

export function clearPendingSyncedPaste(): void {
  pendingSyncedPaste = null;
}

/**
 * Track page IDs that are currently being restored from trash (undo of delete).
 * SubpageBlock checks this to avoid making API calls that would 404.
 */
const pendingRestores = new Set<string>();

export function addPendingRestore(pageId: string): void {
  pendingRestores.add(pageId);
}

export function removePendingRestore(pageId: string): void {
  pendingRestores.delete(pageId);
}

export function isPendingRestore(pageId: string): boolean {
  return pendingRestores.has(pageId);
}

/**
 * Subpage undo actions: maps pageId to the correct undo behavior.
 * - 'delete': page was created by paste/duplicate, undo should delete it
 * - 'moveBack': page was moved from another parent, undo should move it back
 */
export type SubpageUndoAction =
  | { action: 'delete' }
  | { action: 'moveBack'; spaceSlug: string; fromParentId: string };

const subpageUndoActions = new Map<string, SubpageUndoAction>();

export function setSubpageUndoAction(pageId: string, action: SubpageUndoAction): void {
  subpageUndoActions.set(pageId, action);
}

export function getSubpageUndoAction(pageId: string): SubpageUndoAction | undefined {
  return subpageUndoActions.get(pageId);
}

export function clearSubpageUndoAction(pageId: string): void {
  subpageUndoActions.delete(pageId);
}
