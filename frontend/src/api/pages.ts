import apiClient from './client';

export interface Page {
  id: string;
  space_id: string;
  title: string;
  file_path: string;
  icon?: string;
  cover_url?: string;
  full_page?: boolean;
  icon_large?: boolean;
  cover_offset?: number;
  sort_order: number;
  is_starred?: boolean;
  last_accessed_at?: string;
  created_at: string;
  updated_at: string;
  content?: string;
  children?: Page[];
}

export interface PageContent {
  page: Page;
  content: string;
}

export interface PageMetadata {
  title?: string;
  icon?: string;
  cover_url?: string;
  full_page?: boolean;
  icon_large?: boolean;
  cover_offset?: number;
  sort_order?: number;
  is_starred?: boolean;
}

export interface TrashedItem {
  name: string;
  trash_path: string;
  parent_path: string;
  file_name: string;
}

export const pagesApi = {
  getTree: async (spaceSlug: string): Promise<Page[]> => {
    const response = await apiClient.get<Page[]>(`/spaces/${spaceSlug}/pages`);
    return response.data;
  },

  get: async (spaceSlug: string, pageId: string, signal?: AbortSignal): Promise<Page> => {
    const response = await apiClient.get<Page>(`/spaces/${spaceSlug}/pages/${pageId}`, { signal });
    return response.data;
  },

  create: async (spaceSlug: string, data: { title: string; parent_id?: string }): Promise<Page> => {
    const response = await apiClient.post<Page>(`/spaces/${spaceSlug}/pages`, data);
    return response.data;
  },

  update: async (spaceSlug: string, pageId: string, content: string): Promise<Page> => {
    const response = await apiClient.put<Page>(`/spaces/${spaceSlug}/pages/${pageId}`, { content });
    return response.data;
  },

  updateMetadata: async (spaceSlug: string, pageId: string, data: PageMetadata): Promise<Page> => {
    const response = await apiClient.put<Page>(`/spaces/${spaceSlug}/pages/${pageId}/meta`, data);
    return response.data;
  },

  duplicate: async (spaceSlug: string, pageId: string, targetParentId?: string | null): Promise<Page> => {
    const response = await apiClient.post<Page>(`/spaces/${spaceSlug}/pages/${pageId}/duplicate`, {
      target_parent_id: targetParentId ?? null,
    });
    return response.data;
  },

  move: async (spaceSlug: string, pageId: string, targetParentId: string | null, afterId?: string | null): Promise<Page> => {
    const response = await apiClient.put<Page>(`/spaces/${spaceSlug}/pages/${pageId}/move`, {
      target_parent_id: targetParentId,
      after_id: afterId ?? null,
    });
    return response.data;
  },

  delete: async (spaceSlug: string, pageId: string): Promise<void> => {
    await apiClient.delete(`/spaces/${spaceSlug}/pages/${pageId}`);
  },

  listTrash: async (spaceSlug: string): Promise<TrashedItem[]> => {
    const response = await apiClient.get<TrashedItem[]>(`/spaces/${spaceSlug}/trash`);
    return response.data;
  },

  restoreFromTrash: async (spaceSlug: string, trashPath: string): Promise<Page> => {
    const response = await apiClient.post<Page>(`/spaces/${spaceSlug}/trash/restore`, { trash_path: trashPath });
    return response.data;
  },

  permanentDelete: async (spaceSlug: string, trashPath: string): Promise<void> => {
    await apiClient.post(`/spaces/${spaceSlug}/trash/delete`, { trash_path: trashPath });
  },

  listStarred: async (spaceSlug: string): Promise<Page[]> => {
    const response = await apiClient.get<Page[]>(`/spaces/${spaceSlug}/pages/starred`);
    return response.data;
  },

  listRecent: async (spaceSlug: string, limit?: number): Promise<Page[]> => {
    const params = limit ? { limit } : {};
    const response = await apiClient.get<Page[]>(`/spaces/${spaceSlug}/pages/recent`, { params });
    return response.data;
  },
};
