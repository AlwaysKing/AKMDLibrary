import apiClient from './client';

export interface GitFileStatus {
  path: string;
  status: string;   // raw XY porcelain v1 code, e.g. " M", "??", "A "
  category: 'modified' | 'untracked' | 'deleted' | 'added' | 'renamed';
}

export interface GitRepoState {
  is_repo: boolean;
  branch: string;
  remote: string;        // remote name only, e.g. "origin"
  upstream: string;      // full upstream ref, e.g. "origin/main"; empty if none
  has_remote: boolean;
  has_upstream: boolean;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
  dirty_count: number;
  error?: string;
}

export interface GitSyncConfig {
  mode: 'off' | 'on-save' | 'scheduled';
  action: 'commit' | 'commit-push';
  scheduled_seconds: number;
  debounce_ms: number;
}

export type CredentialType = 'none' | 'ssh-key' | 'ssh-password';

export interface CredentialMeta {
  type: CredentialType;
  has_passphrase: boolean;
}

export interface CredentialInput {
  type: CredentialType;
  private_key?: string;
  passphrase?: string;
  password?: string;
}

export const gitApi = {
  state: (slug: string) =>
    apiClient.get<GitRepoState>(`/spaces/${slug}/git/state`).then((r) => r.data),

  commit: (slug: string, message: string, paths: string[]) =>
    apiClient.post(`/spaces/${slug}/git/commit`, { message, paths }).then((r) => r.data),

  // Discard worktree changes for the given paths. Returns the refreshed state.
  restore: (slug: string, paths: string[]) =>
    apiClient.post<GitRepoState>(`/spaces/${slug}/git/restore`, { paths }).then((r) => r.data),

  push: (slug: string) =>
    apiClient.post<{ ok: boolean; output: string }>(`/spaces/${slug}/git/push`).then((r) => r.data),

  pull: (slug: string) =>
    apiClient.post<{ ok: boolean; output: string }>(`/spaces/${slug}/git/pull`).then((r) => r.data),

  getConfig: (slug: string) =>
    apiClient.get<GitSyncConfig>(`/spaces/${slug}/git/config`).then((r) => r.data),

  setConfig: (slug: string, cfg: GitSyncConfig) =>
    apiClient.put<GitSyncConfig>(`/spaces/${slug}/git/config`, cfg).then((r) => r.data),

  getCredentials: (slug: string) =>
    apiClient.get<CredentialMeta>(`/spaces/${slug}/git/credentials`).then((r) => r.data),

  setCredentials: (slug: string, input: CredentialInput) =>
    apiClient.put<CredentialMeta>(`/spaces/${slug}/git/credentials`, input).then((r) => r.data),

  deleteCredentials: (slug: string) =>
    apiClient.delete<CredentialMeta>(`/spaces/${slug}/git/credentials`).then((r) => r.data),
};
