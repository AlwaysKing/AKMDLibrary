import apiClient from './client';

export interface BookmarkMeta {
  url: string;
  title: string;
  description: string;
  favicon_url: string;
  image_url: string;
}

export const bookmarksApi = {
  getMeta: async (url: string): Promise<BookmarkMeta> => {
    const response = await apiClient.get<BookmarkMeta>('/bookmark/meta', {
      params: { url },
    });
    return response.data;
  },
};
