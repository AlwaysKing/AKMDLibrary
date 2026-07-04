import apiClient from './client';

export interface ClaudeToolConfig {
  allow_bash: boolean;
  allow_web: boolean;
}

export interface ClaudeAdminConfig {
  settings_json: Record<string, any>;
  system_prompt: string;
  tool_config: ClaudeToolConfig;
}

export interface ClaudeAttachmentUploadResult {
  attachmentId: string;
  filename: string;
}

export const claudeApi = {
  getConfig: async (): Promise<ClaudeAdminConfig> => {
    const response = await apiClient.get<ClaudeAdminConfig>('/admin/claude/config');
    return response.data;
  },

  updateConfig: async (config: ClaudeAdminConfig): Promise<void> => {
    await apiClient.put('/admin/claude/config', config);
  },

  /**
   * 上传聊天附件到指定 session。返回 attachmentId 与（去重后的）filename。
   * 注意：不走 apiClient 默认 Authorization header，因为后端用 query param 校验。
   */
  uploadAttachment: async (
    spaceSlug: string,
    sessionId: string,
    file: File,
  ): Promise<ClaudeAttachmentUploadResult> => {
    const token = localStorage.getItem('token') || '';
    const form = new FormData();
    form.append('file', file);
    const url = `/api/spaces/${encodeURIComponent(spaceSlug)}/claude/attachments?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}`;
    const resp = await fetch(url, { method: 'POST', body: form });
    if (!resp.ok) {
      const msg = await resp.text().catch(() => '');
      throw new Error(`upload failed: ${resp.status} ${msg}`);
    }
    return resp.json();
  },
};
