import { create } from 'zustand';

// PageEditor registers its lightweight flush function here on mount so that
// any router-level guard (useBlocker in PageViewPage) can await it before
// allowing navigation away from the current page.
//
// The flush function writes the current document to the IndexedDB mirror
// (createMirror) and is the ONLY thing the guard waits for — HTTP uploads,
// sync-block source pushes, and server refreshes stay in the background so
// that page switches remain fast.

interface EditorFlushState {
  flushFn: (() => Promise<void>) | null;
  setFlushFn: (fn: (() => Promise<void>) | null) => void;
  // Runs the registered flush function. Resolves immediately with no-op
  // when nothing is registered. Never throws — errors are swallowed so
  // callers (router guards) can unblock navigation even on flush failure.
  flush: () => Promise<void>;
}

export const useEditorFlushStore = create<EditorFlushState>((set, get) => ({
  flushFn: null,
  setFlushFn: (fn) => set({ flushFn: fn }),
  flush: async () => {
    const fn = get().flushFn;
    if (!fn) return;
    try {
      await fn();
    } catch {
      // Swallow: navigation must not be blocked by a flush error.
      // The mirror write is best-effort; unmount cleanup + background
      // syncModule retries will pick up the next attempt.
    }
  },
}));
