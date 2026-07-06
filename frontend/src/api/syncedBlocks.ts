import apiClient from './client';

export type SyncedBlockQuote = {
  pageId: string;
  syncId: string;
};

export type SyncedBlockResponse = {
  markdown: string;
  sourceTitle: string;
  quoted: SyncedBlockQuote[];
};

export type WrapSyncedBlockResponse = {
  sourcePageId: string;
  sourceBlockId: string;
};

export const syncedBlocksApi = {
  get: async (spaceSlug: string, sourcePageId: string, sourceBlockId: string): Promise<SyncedBlockResponse> => {
    const response = await apiClient.get<SyncedBlockResponse>(`/spaces/${spaceSlug}/synced-block`, {
      params: { sourcePageId, sourceBlockId },
    });
    return response.data;
  },

  update: async (
    spaceSlug: string,
    sourcePageId: string,
    sourceBlockId: string,
    data: { markdown: string; addQuoted?: SyncedBlockQuote[]; removeQuoted?: string[] },
  ): Promise<SyncedBlockResponse> => {
    const response = await apiClient.put<SyncedBlockResponse>(
      `/spaces/${spaceSlug}/synced-block/${sourceBlockId}`,
      data,
      { params: { sourcePageId } },
    );
    return response.data;
  },

  wrapSource: async (
    spaceSlug: string,
    data: {
      sourcePageId: string;
      sourceMd: string;
      newSyncId: string;
      mirrorPageId: string;
      mirrorSyncId: string;
    },
  ): Promise<WrapSyncedBlockResponse> => {
    const response = await apiClient.post<WrapSyncedBlockResponse>(
      `/spaces/${spaceSlug}/synced-block/wrap-source`,
      data,
    );
    return response.data;
  },

  delete: async (
    spaceSlug: string,
    sourcePageId: string,
    sourceBlockId: string,
    strategy: 'cascade' | 'placeholder' | 'inline',
  ): Promise<{ affectedPages: SyncedBlockQuote[] }> => {
    const response = await apiClient.delete<{ affectedPages: SyncedBlockQuote[] }>(
      `/spaces/${spaceSlug}/synced-block/${sourceBlockId}`,
      {
        params: { sourcePageId },
        data: { strategy },
      },
    );
    return response.data;
  },
};
