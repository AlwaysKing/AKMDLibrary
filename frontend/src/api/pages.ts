import apiClient from './client';

export interface Page {
  id: number;
  space_id: number;
  title: string;
  file_path: string;
  icon?: string;
  cover_url?: string;
  sort_order: number;
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
  sort_order?: number;
}

export const pagesApi = {
  getTree: async (spaceSlug: string): Promise<Page[]> => {
    const response = await apiClient.get<Page[]>(`/spaces/${spaceSlug}/pages`);
    return response.data;
  },

  get: async (spaceSlug: string, pageId: number): Promise<Page> => {
    const response = await apiClient.get<Page>(`/spaces/${spaceSlug}/pages/${pageId}`);
    return response.data;
  },

  create: async (spaceSlug: string, data: { title: string; parent_id?: number }): Promise<Page> => {
    const response = await apiClient.post<Page>(`/spaces/${spaceSlug}/pages`, data);
    return response.data;
  },

  update: async (spaceSlug: string, pageId: number, content: string): Promise<Page> => {
    const response = await apiClient.put<Page>(`/spaces/${spaceSlug}/pages/${pageId}`, { content });
    return response.data;
  },

  updateMetadata: async (spaceSlug: string, pageId: number, data: PageMetadata): Promise<Page> => {
    const response = await apiClient.put<Page>(`/spaces/${spaceSlug}/pages/${pageId}/meta`, data);
    return response.data;
  },

  delete: async (spaceSlug: string, pageId: number): Promise<void> => {
    await apiClient.delete(`/spaces/${spaceSlug}/pages/${pageId}`);
  },
};
