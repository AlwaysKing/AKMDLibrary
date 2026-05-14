import { create } from 'zustand';
import { pagesApi, Page } from '../api/pages';

interface PageState {
  currentPage: Page | null;
  currentContent: string;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  fetchPage: (spaceSlug: string, pageId: number) => Promise<void>;
  savePage: (spaceSlug: string, pageId: number, content: string) => Promise<void>;
  createPage: (spaceSlug: string, title: string, parentId?: number) => Promise<Page>;
  deletePage: (spaceSlug: string, pageId: number) => Promise<void>;
  updateMetadata: (spaceSlug: string, pageId: number, data: any) => Promise<void>;
  duplicatePage: (spaceSlug: string, pageId: number, targetParentId?: number | null) => Promise<Page>;
  movePage: (spaceSlug: string, pageId: number, targetParentId: number | null) => Promise<Page>;
  clearCurrentPage: () => void;
  refreshPageTree: () => Promise<void>;
}

export const usePageStore = create<PageState>((set) => ({
  currentPage: null,
  currentContent: '',
  isLoading: false,
  isSaving: false,
  error: null,

  fetchPage: async (spaceSlug, pageId) => {
    set({ isLoading: true, error: null });
    try {
      const page = await pagesApi.get(spaceSlug, pageId);
      const content = page.content || '';
      set({
        currentPage: page,
        currentContent: content,
        isLoading: false,
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  savePage: async (spaceSlug, pageId, content) => {
    set({ isSaving: true, error: null });
    try {
      const page = await pagesApi.update(spaceSlug, pageId, content);
      set({
        currentPage: page,
        currentContent: content,
        isSaving: false,
      });
    } catch (error: any) {
      set({ error: error.message, isSaving: false });
      throw error;
    }
  },

  createPage: async (spaceSlug, title, parentId) => {
    set({ isLoading: true, error: null });
    try {
      const page = await pagesApi.create(spaceSlug, { title, parent_id: parentId });
      set({ isLoading: false });
      return page;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  deletePage: async (spaceSlug, pageId) => {
    set({ isLoading: true, error: null });
    try {
      await pagesApi.delete(spaceSlug, pageId);
      set({ isLoading: false, currentPage: null, currentContent: '' });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  updateMetadata: async (spaceSlug, pageId, data) => {
    set({ isSaving: true, error: null });
    try {
      const page = await pagesApi.updateMetadata(spaceSlug, pageId, data);
      set({
        currentPage: page,
        isSaving: false,
      });
    } catch (error: any) {
      set({ error: error.message, isSaving: false });
      throw error;
    }
  },

  duplicatePage: async (spaceSlug, pageId, targetParentId) => {
    set({ isLoading: true, error: null });
    try {
      const page = await pagesApi.duplicate(spaceSlug, pageId, targetParentId);
      set({ isLoading: false });
      return page;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  movePage: async (spaceSlug, pageId, targetParentId) => {
    set({ isLoading: true, error: null });
    try {
      const page = await pagesApi.move(spaceSlug, pageId, targetParentId);
      set({ isLoading: false });
      return page;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  clearCurrentPage: () => {
    set({
      currentPage: null,
      currentContent: '',
      error: null,
    });
  },

  refreshPageTree: async () => {
    const { useSpaceStore } = await import('./spaceStore');
    await useSpaceStore.getState().refreshAll();
  },
}));
