import { create } from 'zustand';
import { personalApi, PersonalNoteNode, PersonalOverview, PersonalTodo, PersonalTodoLink } from '../api/personal';
import { Page, pagesApi } from '../api/pages';
import { showToast } from '../components/Toast';

function personalErrorMessage(error: any, action: string): string {
  if (!error?.response) return `${action}：网络连接失败`;
  const detail = error.response.data;
  return typeof detail === 'string' && detail.trim()
    ? `${action}：${detail}`
    : `${action}失败`;
}

interface PersonalState {
  spaceSlug: string;
  todos: PersonalTodo[];
  notes: PersonalNoteNode[];
  recent: PersonalNoteNode[];
  isLoading: boolean;
  error: string | null;
  fetchOverview: () => Promise<PersonalOverview | null>;
  createTodo: (text: string, options?: { today?: boolean; atTop?: boolean; link?: PersonalTodoLink }) => Promise<boolean>;
  updateTodo: (id: string, data: { text?: string; done?: boolean; today?: boolean }) => Promise<void>;
  deleteTodo: (id: string) => Promise<void>;
  createNote: (title: string, parentId?: string) => Promise<Page>;
  deleteNote: (pageId: string) => Promise<void>;
  clearRecentNote: (pageId: string) => Promise<void>;
  moveNote: (pageId: string, parentId: string | null, afterId: string | null) => Promise<void>;
}

export const usePersonalStore = create<PersonalState>((set, get) => ({
  spaceSlug: '',
  todos: [],
  notes: [],
  recent: [],
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
        recent: overview.recent || [],
        isLoading: false,
      });
      return overview;
    } catch (error: any) {
      const message = personalErrorMessage(error, '个人空间加载失败');
      set({ error: message, isLoading: false });
      showToast(message);
      return null;
    }
  },

  createTodo: async (text, options) => {
    try {
      const result = await personalApi.createTodo({
        text,
        today: options?.today,
        at_top: options?.atTop,
        link: options?.link,
      });
      set({ todos: result.todos, error: null });
      return result.created;
    } catch (error: any) {
      const message = personalErrorMessage(error, '添加待办失败');
      set({ error: message });
      showToast(message);
      return false;
    }
  },

  updateTodo: async (id, data) => {
    try {
      const todos = await personalApi.updateTodo(id, data);
      set({ todos, error: null });
    } catch (error: any) {
      const message = personalErrorMessage(error, '更新待办失败');
      set({ error: message });
      showToast(message);
    }
  },

  deleteTodo: async (id) => {
    try {
      const todos = await personalApi.deleteTodo(id);
      set({ todos, error: null });
    } catch (error: any) {
      const message = personalErrorMessage(error, '删除待办失败');
      set({ error: message });
      showToast(message);
    }
  },

  createNote: async (title, parentId) => {
    try {
      const note = await personalApi.createNote(title, parentId);
      await get().fetchOverview();
      return note;
    } catch (error: any) {
      const message = personalErrorMessage(error, '新建笔记失败');
      set({ error: message });
      showToast(message);
      throw error;
    }
  },

  deleteNote: async (pageId) => {
    try {
      await personalApi.deleteNote(pageId);
      await get().fetchOverview();
    } catch (error: any) {
      const message = personalErrorMessage(error, '删除笔记失败');
      set({ error: message });
      showToast(message);
    }
  },

  clearRecentNote: async (pageId) => {
    const { spaceSlug } = get();
    if (!spaceSlug) return;
    try {
      await pagesApi.clearRecent(spaceSlug, pageId);
      await get().fetchOverview();
    } catch (error: any) {
      const message = personalErrorMessage(error, '移除最近访问失败');
      set({ error: message });
      showToast(message);
    }
  },

  moveNote: async (pageId, parentId, afterId) => {
    const { spaceSlug } = get();
    if (!spaceSlug) return;
    try {
      await pagesApi.move(spaceSlug, pageId, parentId, afterId);
      await get().fetchOverview();
    } catch (error: any) {
      const message = personalErrorMessage(error, '笔记排序失败');
      set({ error: message });
      showToast(message);
    }
  },
}));
