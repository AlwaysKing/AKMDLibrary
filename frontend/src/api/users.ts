import apiClient from './client';
import { User } from './auth';

export type { User };

export const usersApi = {
  list: async (): Promise<User[]> => {
    const response = await apiClient.get<User[]>('/users');
    return response.data;
  },

  create: async (data: { username: string; password: string; display_name: string; role?: string }): Promise<User> => {
    const response = await apiClient.post<User>('/users', data);
    return response.data;
  },

  update: async (id: number, data: Partial<User>): Promise<User> => {
    const response = await apiClient.put<User>(`/users/${id}`, data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/users/${id}`);
  },

  resetPassword: async (id: number, password: string): Promise<void> => {
    await apiClient.put(`/users/${id}/password`, { password });
  },
};
