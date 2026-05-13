import apiClient from './client';

export interface IconLibraryItem {
  name: string;
  url: string;
}

export async function fetchIconLibrary(): Promise<IconLibraryItem[]> {
  const { data } = await apiClient.get('/icons');
  return Array.isArray(data) ? data : [];
}

export async function checkIconName(name: string): Promise<boolean> {
  const { data } = await apiClient.get('/icons/check', { params: { name } });
  return data?.exists ?? false;
}

export async function useIconFromLibrary(iconName: string, pageId: number, spaceSlug: string): Promise<string> {
  const { data } = await apiClient.post('/icons/use', {
    icon_name: iconName,
    page_id: pageId,
    space_slug: spaceSlug,
  });
  return data.path;
}
