import { create } from 'zustand';
import { pagesApi, Page } from '../api/pages';

interface PageState {
  currentPage: Page | null;
  currentContent: string;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  fetchPage: (spaceSlug: string, pageId: string, signal?: AbortSignal) => Promise<void>;
  savePage: (spaceSlug: string, pageId: string, content: string) => Promise<void>;
  createPage: (spaceSlug: string, title: string, parentId?: string) => Promise<Page>;
  deletePage: (spaceSlug: string, pageId: string) => Promise<void>;
  updateMetadata: (spaceSlug: string, pageId: string, data: any) => Promise<void>;
  duplicatePage: (spaceSlug: string, pageId: string, targetParentId?: string | null) => Promise<Page>;
  movePage: (spaceSlug: string, pageId: string, targetParentId: string | null, afterId?: string | null) => Promise<Page>;
  clearCurrentPage: () => void;
  refreshPageTree: () => Promise<void>;
}

export const usePageStore = create<PageState>((set, get) => ({
  currentPage: null,
  currentContent: '',
  isLoading: false,
  isSaving: false,
  error: null,

  fetchPage: async (spaceSlug, pageId, signal) => {
    const startedAt = performance.now();
    console.debug('[page-debug] pageStore.fetchPage start', { spaceSlug, pageId });
    set({ isLoading: true, error: null });
    try {
      const page = await pagesApi.get(spaceSlug, pageId, signal);
      const content = page.content || '';
      console.debug('[page-debug] pageStore.fetchPage success', {
        spaceSlug,
        pageId,
        elapsedMs: Math.round(performance.now() - startedAt),
        filePath: page.file_path,
        contentBytes: content.length,
      });
      set({
        currentPage: page,
        currentContent: content,
        isLoading: false,
      });
    } catch (error: any) {
      // 请求被取消（组件已卸载），静默忽略
      if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError') {
        console.debug('[page-debug] pageStore.fetchPage canceled', {
          spaceSlug,
          pageId,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
        return;
      }
      console.debug('[page-debug] pageStore.fetchPage error', {
        spaceSlug,
        pageId,
        elapsedMs: Math.round(performance.now() - startedAt),
        message: error.message,
        code: error.code,
        status: error.response?.status,
      });
      set({ error: error.message, isLoading: false });
    }
  },

  savePage: async (spaceSlug, pageId, content) => {
    set({ isSaving: true, error: null });
    try {
      await pagesApi.update(spaceSlug, pageId, content);
      set({ isSaving: false });
      // Only update currentPage/currentContent if user is still viewing this page
      const { currentPage } = usePageStore.getState();
      if (currentPage && currentPage.id === pageId) {
        set({ currentContent: content });
      }
    } catch (error: any) {
      set({ error: error.message, isSaving: false });
      throw error;
    }
  },

  createPage: async (spaceSlug, title, parentId) => {
    try {
      const page = await pagesApi.create(spaceSlug, { title, parent_id: parentId });
      return page;
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    }
  },

  deletePage: async (spaceSlug, pageId) => {
    const { currentPage } = get();
    const isCurrent = currentPage?.id === pageId;
    if (isCurrent) set({ isLoading: true });
    try {
      await pagesApi.delete(spaceSlug, pageId);
      if (isCurrent) {
        set({ isLoading: false, currentPage: null, currentContent: '' });
      }
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  updateMetadata: async (spaceSlug, pageId, data) => {
    set({ isSaving: true, error: null });
    try {
      const page = await pagesApi.updateMetadata(spaceSlug, pageId, data);
      const { currentPage } = get();
      set({
        currentPage: currentPage?.id === pageId ? page : currentPage,
        isSaving: false,
      });
    } catch (error: any) {
      set({ error: error.message, isSaving: false });
      throw error;
    }
  },

  duplicatePage: async (spaceSlug, pageId, targetParentId) => {
    try {
      const page = await pagesApi.duplicate(spaceSlug, pageId, targetParentId);
      return page;
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    }
  },

  movePage: async (spaceSlug, pageId, targetParentId, afterId?) => {
    try {
      const page = await pagesApi.move(spaceSlug, pageId, targetParentId, afterId);
      return page;
    } catch (error: any) {
      set({ error: error.message });
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
