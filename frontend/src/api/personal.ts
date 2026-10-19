import apiClient from './client';
import { Page } from './pages';

export interface PersonalTodo {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
  today_on?: string;
  today_set_at?: string;
  completed_at?: string;
  is_today: boolean;
  overdue: boolean;
  link?: PersonalTodoLink;
}

export interface PersonalTodoLink {
  type: 'page' | 'database-row';
  space_slug: string;
  page_id?: string;
  database_id?: string;
  row_id?: string;
}

export interface PersonalTodoMutationResponse {
  todo: PersonalTodo;
  todos: PersonalTodo[];
  created: boolean;
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
  recent: PersonalNoteNode[];
}

export const personalApi = {
  getOverview: async (): Promise<PersonalOverview> => {
    const response = await apiClient.get<PersonalOverview>('/personal');
    return response.data;
  },

  createTodo: async (data: {
    text?: string;
    today?: boolean;
    link?: PersonalTodoLink;
  }): Promise<PersonalTodoMutationResponse> => {
    const response = await apiClient.post<PersonalTodoMutationResponse>('/personal/todos', data);
    return response.data;
  },

  updateTodo: async (id: string, data: { text?: string; done?: boolean; today?: boolean }): Promise<PersonalTodo[]> => {
    const response = await apiClient.patch<PersonalTodo[]>(`/personal/todos/${id}`, data);
    return response.data;
  },

  deleteTodo: async (id: string): Promise<PersonalTodo[]> => {
    const response = await apiClient.delete<PersonalTodo[]>(`/personal/todos/${id}`);
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
