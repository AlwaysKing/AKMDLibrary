import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Upload,
  Download,
  Trash2,
  Edit2,
  Search,
  File as FileIcon,
  AlertCircle,
  Check,
  X,
} from 'lucide-react';
import {
  listSpaceFiles,
  uploadSpaceFile,
  renameSpaceFile,
  deleteSpaceFile,
  saveSpaceFileAs,
  checkSpaceFileName,
  displayFilePath,
  type SpaceFileItem,
} from '../api/files';
import { showToast } from '../components/Toast';

/**
 * File manager page at /s/:spaceSlug/files. Lists every file under
 * <space>/_files/ and provides upload / download / rename / delete actions.
 */
export default function FilesPage() {
  const { spaceSlug } = useParams<{ spaceSlug: string }>();
  const [items, setItems] = useState<SpaceFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingUpload, setPendingUpload] = useState<{
    file: File;
    available: boolean;
    checking: boolean;
    error: string | null;
    uploading: boolean;
  } | null>(null);

  const refresh = async () => {
    if (!spaceSlug) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listSpaceFiles(spaceSlug);
      setItems(data);
    } catch (err: any) {
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceSlug]);

  // Check filename availability when pending upload changes
  useEffect(() => {
    if (!pendingUpload || !spaceSlug) return;
    if (!pendingUpload.available && !pendingUpload.checking) return;
    let cancelled = false;
    setPendingUpload((p) => (p ? { ...p, checking: true, error: null } : p));
    checkSpaceFileName(spaceSlug, pendingUpload.file.name)
      .then((available) => {
        if (cancelled) return;
        setPendingUpload((p) =>
          p ? { ...p, checking: false, available, error: available ? null : '同名文件已存在' } : p
        );
      })
      .catch(() => {
        if (cancelled) return;
        setPendingUpload((p) =>
          p ? { ...p, checking: false, available: false, error: '检查失败' } : p
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUpload?.file.name, spaceSlug]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((it) => {
      const disp = displayFilePath(it.path).toLowerCase();
      return disp.includes(q) || it.name.toLowerCase().includes(q);
    });
  }, [items, query]);

  const handleSelectUpload = () => uploadInputRef.current?.click();

  const handleUploadInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setPendingUpload({
      file: f,
      available: false,
      checking: true,
      error: null,
      uploading: false,
    });
  };

  const handleConfirmUpload = async () => {
    if (!spaceSlug || !pendingUpload || !pendingUpload.available) return;
    setPendingUpload((p) => (p ? { ...p, uploading: true } : p));
    try {
      await uploadSpaceFile(spaceSlug, pendingUpload.file);
      showToast('上传成功');
      setPendingUpload(null);
      await refresh();
    } catch (err: any) {
      const status = err?.response?.status;
      const msg =
        status === 409
          ? '同名文件已存在'
          : err?.response?.data || err?.message || '上传失败';
      setPendingUpload((p) => (p ? { ...p, uploading: false, error: msg } : p));
      showToast(msg);
    }
  };

  const handleCancelUpload = () => setPendingUpload(null);

  const handleDownload = async (it: SpaceFileItem) => {
    if (!spaceSlug) return;
    try {
      await saveSpaceFileAs(spaceSlug, it.path);
    } catch (err: any) {
      showToast(err?.message || '下载失败');
    }
  };

  const startRename = (it: SpaceFileItem) => {
    setRenaming(it.path);
    // Default to base name only — user can change the entire path if desired
    setRenameValue(it.path.replace(/^_files\//, ''));
    setRenameError(null);
  };

  const confirmRename = async () => {
    if (!spaceSlug || !renaming) return;
    const fromPath = renaming;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError('文件名不能为空');
      return;
    }
    const toPath = trimmed.startsWith('_files/') ? trimmed : `_files/${trimmed}`;
    if (toPath === fromPath) {
      setRenaming(null);
      return;
    }
    try {
      await renameSpaceFile(spaceSlug, fromPath, toPath);
      showToast('已重命名');
      setRenaming(null);
      await refresh();
    } catch (err: any) {
      const status = err?.response?.status;
      const msg =
        status === 409
          ? '目标路径已存在'
          : err?.response?.data || err?.message || '重命名失败';
      setRenameError(msg);
    }
  };

  const handleDelete = async (path: string) => {
    if (!spaceSlug) return;
    try {
      await deleteSpaceFile(spaceSlug, path);
      showToast('已删除');
      setConfirmingDelete(null);
      await refresh();
    } catch (err: any) {
      showToast(err?.message || '删除失败');
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-notion-bg">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[912px] mx-auto px-24 py-8 pb-32">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-notion-text">文件管理</h1>
              <p className="text-sm text-notion-textSecondary mt-0.5">
                当前 space 的共享文件池（<code className="px-1 bg-notion-hover rounded">_files/</code>），可被 fileContent block 引用
              </p>
            </div>
            <button
              type="button"
              onClick={handleSelectUpload}
              disabled={!spaceSlug}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-notion-text text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Upload size={14} />
              上传
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              onChange={handleUploadInputChange}
            />
          </div>

          {pendingUpload && (
            <div className="mb-4 p-3 rounded-md border border-notion-border bg-notion-hover/50 flex items-center gap-3">
              <FileIcon size={18} className="text-notion-textSecondary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-notion-text truncate">
                  {pendingUpload.file.name}
                </div>
                <div className="text-xs text-notion-textSecondary">
                  {formatBytes(pendingUpload.file.size)}
                  {pendingUpload.checking && ' · 检查文件名中…'}
                  {pendingUpload.error && (
                    <span className="text-red-500 ml-1">· {pendingUpload.error}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={handleConfirmUpload}
                disabled={
                  !pendingUpload.available ||
                  pendingUpload.checking ||
                  pendingUpload.uploading
                }
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-notion-text text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Check size={12} />
                {pendingUpload.uploading ? '上传中…' : '确认上传'}
              </button>
              <button
                type="button"
                onClick={handleCancelUpload}
                disabled={pendingUpload.uploading}
                className="p-1 text-notion-textSecondary hover:text-notion-text transition-colors"
                title="取消"
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div className="mb-3 flex items-center gap-2 px-3 py-1.5 rounded-md bg-notion-hover/50">
            <Search size={14} className="text-notion-textSecondary" />
            <input
              type="text"
              placeholder="搜索文件名或路径…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-notion-text outline-none placeholder:text-notion-textSecondary"
            />
          </div>

          {loading && (
            <div className="text-center py-16 text-notion-textSecondary text-sm">
              加载中…
            </div>
          )}
          {!loading && error && (
            <div className="text-center py-16 text-red-500 text-sm flex items-center justify-center gap-2">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="text-center py-16 text-notion-textSecondary text-sm">
              {items.length === 0 ? '暂无文件，点击右上角上传' : '没有匹配的文件'}
            </div>
          )}
          {!loading && !error && filtered.length > 0 && (
            <div className="space-y-0.5">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-1.5 text-xs font-medium text-notion-textSecondary border-b border-notion-border/60">
                <span>路径</span>
                <span className="text-right w-20">大小</span>
                <span className="text-right w-32">修改时间</span>
                <span className="text-right w-28">操作</span>
              </div>
              {filtered.map((it) => (
                <div
                  key={it.path}
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center px-4 py-2 rounded-md hover:bg-notion-hover/60 transition-colors group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileIcon size={14} className="text-notion-textSecondary flex-shrink-0" />
                    {renaming === it.path ? (
                      <input
                        autoFocus
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmRename();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        onBlur={() => {
                          // Allow click on confirm button before closing
                          setTimeout(() => setRenaming(null), 150);
                        }}
                        className="flex-1 px-1.5 py-0.5 text-sm rounded border border-notion-border bg-notion-bg text-notion-text outline-none focus:border-notion-text"
                      />
                    ) : (
                      <span
                        className="text-sm text-notion-text truncate"
                        title={displayFilePath(it.path)}
                      >
                        {displayFilePath(it.path)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-notion-textSecondary text-right w-20">
                    {formatBytes(it.size)}
                  </div>
                  <div className="text-xs text-notion-textSecondary text-right w-32">
                    {formatDate(it.mtime)}
                  </div>
                  <div className="flex items-center justify-end gap-1 w-28">
                    {renaming === it.path ? (
                      <>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={confirmRename}
                          className="p-1 rounded hover:bg-notion-hover text-notion-text"
                          title="确认"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setRenaming(null)}
                          className="p-1 rounded hover:bg-notion-hover text-notion-textSecondary"
                          title="取消"
                        >
                          <X size={14} />
                        </button>
                        {renameError && (
                          <span className="text-xs text-red-500" title={renameError}>
                            <AlertCircle size={12} />
                          </span>
                        )}
                      </>
                    ) : confirmingDelete === it.path ? (
                      <>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleDelete(it.path)}
                          className="p-1 rounded hover:bg-red-100 text-red-600"
                          title="确认删除"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setConfirmingDelete(null)}
                          className="p-1 rounded hover:bg-notion-hover text-notion-textSecondary"
                          title="取消"
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDownload(it)}
                          className="p-1 rounded hover:bg-notion-hover text-notion-textSecondary opacity-0 group-hover:opacity-100 transition-opacity"
                          title="下载"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => startRename(it)}
                          className="p-1 rounded hover:bg-notion-hover text-notion-textSecondary opacity-0 group-hover:opacity-100 transition-opacity"
                          title="重命名"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(it.path)}
                          className="p-1 rounded hover:bg-red-100 text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (x: number) => x.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}
