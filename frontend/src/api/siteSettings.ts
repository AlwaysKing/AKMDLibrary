import apiClient from './client';

export interface SiteSettings {
  favicon?: string;
  logo?: string;
  site_name?: string;
}

export const siteSettingsApi = {
  get: async (): Promise<SiteSettings> => {
    const response = await apiClient.get<SiteSettings>('/site-settings');
    return response.data;
  },

  updateSiteName: async (site_name: string): Promise<SiteSettings> => {
    const response = await apiClient.put<SiteSettings>('/site-settings/name', { site_name });
    return response.data;
  },

  uploadFavicon: async (file: File): Promise<{ url: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post<{ url: string }>('/site-settings/favicon', formData);
    return response.data;
  },

  resetFavicon: async (): Promise<void> => {
    await apiClient.post('/site-settings/favicon/reset');
  },

  uploadLogo: async (file: File): Promise<{ url: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post<{ url: string }>('/site-settings/logo', formData);
    return response.data;
  },

  resetLogo: async (): Promise<void> => {
    await apiClient.post('/site-settings/logo/reset');
  },
};
