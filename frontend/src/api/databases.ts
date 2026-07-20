import apiClient from './client';

export type DatabaseColumnType =
  | 'text' | 'number' | 'select' | 'multi_select' | 'date' | 'checkbox' | 'url'
  | 'status' | 'formula' | 'relation' | 'created_time' | 'last_edited_time' | 'last_edited_user' | 'linked';

export interface DatabaseColumn {
  id: string;
  name: string;
  type: DatabaseColumnType;
  icon?: string;
  readonly?: boolean;
  auto?: boolean;
  default?: any;
  description?: string;
  config?: Record<string, any>;
}

export interface DatabaseSummary {
  id: string;
  name: string;
  dir_name: string;
  icon?: string;
  description?: string;
  created_at: string;
  column_count: number;
  row_count: number;
}

export interface DatabaseDetail extends DatabaseSummary {
  columns: DatabaseColumn[];
}

export interface DatabaseRow {
  uuid: string;
  values: Record<string, string>;
}

export interface DatabaseRowsResponse {
  rows: DatabaseRow[];
  total: number;
  limit: number;
  offset: number;
}

export const databasesApi = {
  async list(spaceSlug: string): Promise<DatabaseSummary[]> {
    const res = await apiClient.get(`/spaces/${spaceSlug}/databases`);
    return res.data || [];
  },
  async create(spaceSlug: string, data: { name: string; icon?: string; description?: string }): Promise<DatabaseDetail> {
    const res = await apiClient.post(`/spaces/${spaceSlug}/databases`, data);
    return res.data;
  },
  async get(spaceSlug: string, dbId: string): Promise<DatabaseDetail> {
    const res = await apiClient.get(`/spaces/${spaceSlug}/databases/${dbId}`);
    return res.data;
  },
  async update(spaceSlug: string, dbId: string, data: Partial<Pick<DatabaseDetail, 'name' | 'icon' | 'description'>>): Promise<DatabaseDetail> {
    const res = await apiClient.patch(`/spaces/${spaceSlug}/databases/${dbId}`, data);
    return res.data;
  },
  async delete(spaceSlug: string, dbId: string): Promise<void> {
    await apiClient.delete(`/spaces/${spaceSlug}/databases/${dbId}`);
  },
  async addColumn(spaceSlug: string, dbId: string, data: { name: string; type: DatabaseColumnType; icon?: string; config?: Record<string, any>; default?: any; description?: string }): Promise<DatabaseDetail> {
    const res = await apiClient.post(`/spaces/${spaceSlug}/databases/${dbId}/columns`, data);
    return res.data;
  },
  async updateColumn(spaceSlug: string, dbId: string, colId: string, data: Partial<DatabaseColumn>): Promise<DatabaseDetail> {
    const res = await apiClient.patch(`/spaces/${spaceSlug}/databases/${dbId}/columns/${colId}`, data);
    return res.data;
  },
  async deleteColumn(spaceSlug: string, dbId: string, colId: string): Promise<DatabaseDetail> {
    const res = await apiClient.delete(`/spaces/${spaceSlug}/databases/${dbId}/columns/${colId}`);
    return res.data;
  },
  async reorderColumns(spaceSlug: string, dbId: string, columnIds: string[]): Promise<DatabaseDetail> {
    const res = await apiClient.post(`/spaces/${spaceSlug}/databases/${dbId}/columns/reorder`, { column_ids: columnIds });
    return res.data;
  },
  async listRows(spaceSlug: string, dbId: string, params: { limit?: number; offset?: number } = {}): Promise<DatabaseRowsResponse> {
    const res = await apiClient.get(`/spaces/${spaceSlug}/databases/${dbId}/rows`, { params });
    return res.data;
  },
  async createRow(spaceSlug: string, dbId: string, values: Record<string, string> = {}): Promise<DatabaseRow> {
    const res = await apiClient.post(`/spaces/${spaceSlug}/databases/${dbId}/rows`, { values });
    return res.data;
  },
  async updateRow(spaceSlug: string, dbId: string, rowId: string, values: Record<string, string>): Promise<DatabaseRow> {
    const res = await apiClient.patch(`/spaces/${spaceSlug}/databases/${dbId}/rows/${rowId}`, { values });
    return res.data;
  },
  async deleteRow(spaceSlug: string, dbId: string, rowId: string): Promise<void> {
    await apiClient.delete(`/spaces/${spaceSlug}/databases/${dbId}/rows/${rowId}`);
  },
  async getRowPage(spaceSlug: string, dbId: string, rowId: string): Promise<{ markdown: string; title: string }> {
    const res = await apiClient.get(`/spaces/${spaceSlug}/databases/${dbId}/rows/${rowId}/page`);
    return res.data;
  },
  async putRowPage(spaceSlug: string, dbId: string, rowId: string, markdown: string): Promise<void> {
    await apiClient.put(`/spaces/${spaceSlug}/databases/${dbId}/rows/${rowId}/page`, { markdown });
  },
};
