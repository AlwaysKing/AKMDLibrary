import apiClient from './client';

export interface SpaceFileItem {
  /** Path relative to the space directory, e.g. `_files/foo/bar.txt`. */
  path: string;
  /** Base filename. */
  name: string;
  size: number;
  mtime: string;
}

export interface SpaceFileUploadResult {
  path: string;
  name: string;
}

/**
 * Strip the leading `_files/` segment from a stored file path for display.
 * The stored path is always relative to the space dir and starts with
 * `_files/`; in the UI we hide that prefix to keep lists scannable.
 *
 * Examples:
 *   `_files/foo.txt`         -> `foo.txt`
 *   `_files/sub/bar.json`    -> `sub/bar.json`
 */
export function displayFilePath(path: string): string {
  if (!path) return '';
  const p = path.replace(/^\/*/, '');
  if (p.toLowerCase().startsWith('_files/')) return p.slice('_files/'.length);
  if (p.toLowerCase() === '_files') return '';
  return p;
}

/**
 * Recursively list every file under `<space>/_files/`.
 * Returns an empty array if the directory does not exist yet.
 */
export async function listSpaceFiles(spaceSlug: string): Promise<SpaceFileItem[]> {
  const { data } = await apiClient.get(`/spaces/${encodeURIComponent(spaceSlug)}/files`);
  return Array.isArray(data) ? data : [];
}

/** Read a file's text content. */
export async function readSpaceFile(spaceSlug: string, path: string): Promise<string> {
  const { data } = await apiClient.get(`/spaces/${encodeURIComponent(spaceSlug)}/files/content`, {
    params: { path },
    responseType: 'text',
    transformResponse: (x) => x,
  });
  return data;
}

/**
 * Write text content to a file under `<space>/_files/`. Creates the file (and
 * parent dirs) if missing. Used by fileContent blocks to persist edits
 * independently of page.md — the on-disk page body only keeps the
 * `<content file="..." lang="..." />` marker.
 *
 * Unlike upload, this does NOT enforce name uniqueness: writing to an existing
 * path overwrites it, which is exactly what edit-save needs.
 */
export async function writeSpaceFile(
  spaceSlug: string,
  path: string,
  content: string
): Promise<void> {
  await apiClient.put(`/spaces/${encodeURIComponent(spaceSlug)}/files/content`, content, {
    params: { path },
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    transformRequest: [(data) => data],
  });
}

/**
 * Check whether a base filename is available under `_files/`.
 * Caller-side pre-check so we can surface a conflict before the upload starts.
 */
export async function checkSpaceFileName(spaceSlug: string, name: string): Promise<boolean> {
  const { data } = await apiClient.get(`/spaces/${encodeURIComponent(spaceSlug)}/files/check`, {
    params: { name },
  });
  return Boolean(data?.available);
}

export interface UploadSpaceFileOpts {
  /** Optional subdirectory under `_files/` to place the file in. */
  subdir?: string;
}

/** Upload a file to `<space>/_files/[subdir]/`. Throws on name conflict (409). */
export async function uploadSpaceFile(
  spaceSlug: string,
  file: File,
  opts: UploadSpaceFileOpts = {}
): Promise<SpaceFileUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (opts.subdir) formData.append('subdir', opts.subdir);
  const { data } = await apiClient.post(
    `/spaces/${encodeURIComponent(spaceSlug)}/files/upload`,
    formData
  );
  return data;
}

/** Rename / move a file inside `_files/`. */
export async function renameSpaceFile(
  spaceSlug: string,
  fromPath: string,
  toPath: string
): Promise<{ path: string }> {
  const { data } = await apiClient.put(`/spaces/${encodeURIComponent(spaceSlug)}/files/rename`, {
    from: fromPath,
    to: toPath,
  });
  return data;
}

/** Permanently delete a file from `_files/`. */
export async function deleteSpaceFile(spaceSlug: string, path: string): Promise<void> {
  await apiClient.delete(`/spaces/${encodeURIComponent(spaceSlug)}/files`, { params: { path } });
}

/** Build a download URL for a file via fetch (Bearer auth handled by axios). */
export async function downloadSpaceFile(spaceSlug: string, path: string): Promise<Blob> {
  const { data } = await apiClient.get(
    `/spaces/${encodeURIComponent(spaceSlug)}/files/download`,
    { params: { path }, responseType: 'blob' }
  );
  return data;
}

/** Trigger a browser download for a file. */
export async function saveSpaceFileAs(spaceSlug: string, path: string): Promise<void> {
  const blob = await downloadSpaceFile(spaceSlug, path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = path.split('/').pop() || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
