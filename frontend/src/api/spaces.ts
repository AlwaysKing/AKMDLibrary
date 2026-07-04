import apiClient from './client';

export interface FeatureFlags {
  git: boolean;
  claude: boolean;
}

export interface Space {
  id: number;
  name: string;
  slug: string;
  icon?: string;
  description?: string;
  feature_flags: FeatureFlags;
  created_at: string;
  updated_at: string;
}

export interface SpaceMember {
  id: number;
  space_id: number;
  user_id: number;
  role: 'admin' | 'editor' | 'viewer';
  user: {
    id: number;
    username: string;
    display_name: string;
  };
  created_at: string;
}

export const spacesApi = {
  list: async (): Promise<Space[]> => {
    const response = await apiClient.get<Space[]>('/spaces');
    return response.data;
  },

  listAll: async (): Promise<Space[]> => {
    const response = await apiClient.get<Space[]>('/spaces', { params: { all: true } });
    return response.data;
  },

  get: async (slug: string): Promise<Space> => {
    const response = await apiClient.get<Space>(`/spaces/${slug}`);
    return response.data;
  },

  create: async (data: Partial<Space>): Promise<Space> => {
    const response = await apiClient.post<Space>('/spaces', data);
    return response.data;
  },

  update: async (slug: string, data: Partial<Space>): Promise<Space> => {
    const response = await apiClient.put<Space>(`/spaces/${slug}`, data);
    return response.data;
  },

  delete: async (slug: string): Promise<void> => {
    await apiClient.delete(`/spaces/${slug}`);
  },

  refresh: async (slug: string): Promise<void> => {
    await apiClient.post(`/spaces/${slug}/refresh`);
  },

  updateFeatureFlags: async (slug: string, flags: FeatureFlags): Promise<FeatureFlags> => {
    const response = await apiClient.put<{ feature_flags: FeatureFlags }>(
      `/spaces/${slug}/feature-flags`,
      flags
    );
    return response.data.feature_flags;
  },

  getMembers: async (slug: string): Promise<SpaceMember[]> => {
    const response = await apiClient.get<SpaceMember[]>(`/spaces/${slug}/members`);
    return response.data;
  },

  addMember: async (slug: string, data: { user_id: number; role: string }): Promise<SpaceMember> => {
    const response = await apiClient.post<SpaceMember>(`/spaces/${slug}/members`, data);
    return response.data;
  },

  updateMember: async (slug: string, memberId: number, role: string): Promise<SpaceMember> => {
    const response = await apiClient.put<SpaceMember>(`/spaces/${slug}/members/${memberId}`, { role });
    return response.data;
  },

  removeMember: async (slug: string, memberId: number): Promise<void> => {
    await apiClient.delete(`/spaces/${slug}/members/${memberId}`);
  },
};
