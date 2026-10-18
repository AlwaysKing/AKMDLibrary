import apiClient from './client';
import { Page } from './pages';

export interface PersonalTodo {
  index: number;
  text: string;
  done: boolean;
}

export interface PersonalNoteNode {
  id: string;
  title: string;
  icon?: string;
  children?: PersonalNoteNode[];
}

export interface PersonalOverview {
  space_slug: string;
  todos: PersonalTodo[];
  notes: PersonalNoteNode[];
}

export const personalApi = {
  getOverview: async (): Promise<PersonalOverview> => {
    const response = await apiClient.get<PersonalOverview>('/personal');
    return response.data;
  },

  createTodo: async (text: string): Promise<PersonalTodo[]> => {
    const response = await apiClient.post<PersonalTodo[]>('/personal/todos', { text });
    return response.data;
  },

  updateTodo: async (index: number, data: { text?: string; done?: boolean }): Promise<PersonalTodo[]> => {
    const response = await apiClient.patch<PersonalTodo[]>(`/personal/todos/${index}`, data);
    return response.data;
  },

  deleteTodo: async (index: number): Promise<PersonalTodo[]> => {
    const response = await apiClient.delete<PersonalTodo[]>(`/personal/todos/${index}`);
    return response.data;
  },

  createNote: async (title: string, parentId?: string): Promise<Page> => {
    const response = await apiClient.post<Page>('/personal/notes', {
      title,
      parent_id: parentId,
    });
    return response.data;
  },

  deleteNote: async (pageId: string): Promise<void> => {
    await apiClient.delete(`/personal/notes/${pageId}`);
  },
};
