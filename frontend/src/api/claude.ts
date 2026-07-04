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

export const claudeApi = {
  getConfig: async (): Promise<ClaudeAdminConfig> => {
    const response = await apiClient.get<ClaudeAdminConfig>('/admin/claude/config');
    return response.data;
  },

  updateConfig: async (config: ClaudeAdminConfig): Promise<void> => {
    await apiClient.put('/admin/claude/config', config);
  },
};
