import { create } from 'zustand';
import { personalApi, PersonalNoteNode, PersonalOverview, PersonalTodo } from '../api/personal';
import { Page, pagesApi } from '../api/pages';

interface PersonalState {
  spaceSlug: string;
  todos: PersonalTodo[];
  notes: PersonalNoteNode[];
  isLoading: boolean;
  error: string | null;
  fetchOverview: () => Promise<PersonalOverview | null>;
  createTodo: (text: string) => Promise<void>;
  updateTodo: (index: number, data: { text?: string; done?: boolean }) => Promise<void>;
  deleteTodo: (index: number) => Promise<void>;
  createNote: (title: string, parentId?: string) => Promise<Page>;
  deleteNote: (pageId: string) => Promise<void>;
  moveNote: (pageId: string, parentId: string | null, afterId: string | null) => Promise<void>;
}

export const usePersonalStore = create<PersonalState>((set, get) => ({
  spaceSlug: '',
  todos: [],
  notes: [],
  isLoading: false,
  error: null,

  fetchOverview: async () => {
    set({ isLoading: true, error: null });
    try {
      const overview = await personalApi.getOverview();
      set({
        spaceSlug: overview.space_slug,
        todos: overview.todos || [],
        notes: overview.notes || [],
        isLoading: false,
      });
      return overview;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return null;
    }
  },

  createTodo: async (text) => {
    try {
      const todos = await personalApi.createTodo(text);
      set({ todos, error: null });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  updateTodo: async (index, data) => {
    try {
      const todos = await personalApi.updateTodo(index, data);
      set({ todos, error: null });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  deleteTodo: async (index) => {
    try {
      const todos = await personalApi.deleteTodo(index);
      set({ todos, error: null });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  createNote: async (title, parentId) => {
    try {
      const note = await personalApi.createNote(title, parentId);
      await get().fetchOverview();
      return note;
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    }
  },

  deleteNote: async (pageId) => {
    try {
      await personalApi.deleteNote(pageId);
      await get().fetchOverview();
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  moveNote: async (pageId, parentId, afterId) => {
    const { spaceSlug } = get();
    if (!spaceSlug) return;
    try {
      await pagesApi.move(spaceSlug, pageId, parentId, afterId);
      await get().fetchOverview();
    } catch (error: any) {
      set({ error: error.message });
    }
  },
}));
