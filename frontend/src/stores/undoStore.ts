import { create } from 'zustand';
import { usePageStore } from './pageStore';

export interface MoveAction {
  type: 'move';
  spaceSlug: string;
  pageId: string;
  from: { parentId: string | null; afterId: string | null };
  to: { parentId: string | null; afterId: string | null };
}

interface UndoState {
  past: MoveAction[];
  future: MoveAction[];
  pushAction: (action: MoveAction) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

export const useUndoStore = create<UndoState>((set, get) => ({
  past: [],
  future: [],

  pushAction: (action: MoveAction) => {
    set((state) => ({
      past: [...state.past, action],
      future: [], // Clear future on new action (standard undo behavior)
    }));
  },

  undo: async () => {
    const { past, future } = get();
    if (past.length === 0) return;

    const action = past[past.length - 1];

    // Execute the reverse: move from "to" back to "from"
    try {
      await usePageStore.getState().movePage(
        action.spaceSlug,
        action.pageId,
        action.from.parentId,
        action.from.afterId,
      );
      await usePageStore.getState().refreshPageTree();
    } catch (err) {
      console.error('Undo failed:', err);
      return;
    }

    set({
      past: past.slice(0, -1),
      future: [...future, action],
    });
  },

  redo: async () => {
    const { past, future } = get();
    if (future.length === 0) return;

    const action = future[future.length - 1];

    // Re-execute the original: move from "from" to "to"
    try {
      await usePageStore.getState().movePage(
        action.spaceSlug,
        action.pageId,
        action.to.parentId,
        action.to.afterId,
      );
      await usePageStore.getState().refreshPageTree();
    } catch (err) {
      console.error('Redo failed:', err);
      return;
    }

    set({
      past: [...past, action],
      future: future.slice(0, -1),
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  clear: () => set({ past: [], future: [] }),
}));
