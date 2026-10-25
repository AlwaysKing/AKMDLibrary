import { create } from 'zustand';
import { spacesApi, Space } from '../api/spaces';
import { pagesApi, Page } from '../api/pages';

interface SpaceState {
  spaces: Space[];
  currentSpace: Space | null;
  pageTree: Page[];
  // pageTree 是为哪个 slug 加载的；切换 space 后到新树到达前，pageTree 仍是旧值，
  // 调用方需要用这个字段判断 pageTree 是否对当前 slug 有效，避免误用旧 space 的树。
  pageTreeSlug: string | null;
  starredPages: Page[];
  recentPages: Page[];
  isLoading: boolean;
  error: string | null;
  fetchSpaces: () => Promise<void>;
  setCurrentSpace: (space: Space | null) => void;
  fetchPageTree: (spaceSlug: string) => Promise<void>;
  refreshPageTree: () => Promise<void>;
  fetchStarred: (spaceSlug: string) => Promise<void>;
  fetchRecent: (spaceSlug: string) => Promise<void>;
  refreshStarredAndRecent: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

export const useSpaceStore = create<SpaceState>((set, get) => ({
  spaces: [],
  currentSpace: null,
  pageTree: [],
  pageTreeSlug: null,
  starredPages: [],
  recentPages: [],
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
      get().fetchStarred(space.slug);
      get().fetchRecent(space.slug);
    } else {
      set({ pageTree: [], pageTreeSlug: null, starredPages: [], recentPages: [] });
    }
  },

  fetchPageTree: async (spaceSlug) => {
    set({ isLoading: true, error: null });
    try {
      const pageTree = await pagesApi.getTree(spaceSlug);
      set({ pageTree: pageTree || [], pageTreeSlug: spaceSlug, isLoading: false });
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

  fetchStarred: async (spaceSlug) => {
    try {
      const pages = await pagesApi.listStarred(spaceSlug);
      set({ starredPages: pages || [] });
    } catch (error: any) {
      console.error('Failed to fetch starred pages:', error);
    }
  },

  fetchRecent: async (spaceSlug) => {
    try {
      const pages = await pagesApi.listRecent(spaceSlug);
      set({ recentPages: pages || [] });
    } catch (error: any) {
      console.error('Failed to fetch recent pages:', error);
    }
  },

  refreshStarredAndRecent: async () => {
    const { currentSpace } = get();
    if (currentSpace) {
      await Promise.all([
        get().fetchStarred(currentSpace.slug),
        get().fetchRecent(currentSpace.slug),
      ]);
    }
  },
  refreshAll: async () => {
    const { currentSpace } = get();
    if (currentSpace) {
      await Promise.all([
        get().fetchPageTree(currentSpace.slug),
        get().fetchStarred(currentSpace.slug),
        get().fetchRecent(currentSpace.slug),
      ]);
    }
  },
}));
