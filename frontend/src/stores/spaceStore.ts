import { create } from 'zustand';
import { spacesApi, Space } from '../api/spaces';
import { pagesApi, Page } from '../api/pages';

interface SpaceState {
  spaces: Space[];
  currentSpace: Space | null;
  pageTree: Page[];
  isLoading: boolean;
  error: string | null;
  fetchSpaces: () => Promise<void>;
  setCurrentSpace: (space: Space | null) => void;
  fetchPageTree: (spaceSlug: string) => Promise<void>;
  refreshPageTree: () => Promise<void>;
}

export const useSpaceStore = create<SpaceState>((set, get) => ({
  spaces: [],
  currentSpace: null,
  pageTree: [],
  isLoading: false,
  error: null,

  fetchSpaces: async () => {
    set({ isLoading: true, error: null });
    try {
      const spaces = await spacesApi.list();
      set({ spaces, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  setCurrentSpace: (space) => {
    set({ currentSpace: space });
    if (space) {
      get().fetchPageTree(space.slug);
    } else {
      set({ pageTree: [] });
    }
  },

  fetchPageTree: async (spaceSlug) => {
    set({ isLoading: true, error: null });
    try {
      const pageTree = await pagesApi.getTree(spaceSlug);
      set({ pageTree: pageTree || [], isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  refreshPageTree: async () => {
    const { currentSpace } = get();
    if (currentSpace) {
      await get().fetchPageTree(currentSpace.slug);
    }
  },
}));
