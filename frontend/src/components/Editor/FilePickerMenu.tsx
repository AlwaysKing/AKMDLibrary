import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Search, Upload, File as FileIcon, AlertCircle } from 'lucide-react';
import {
  listSpaceFiles,
  checkSpaceFileName,
  uploadSpaceFile,
  displayFilePath,
  type SpaceFileItem,
} from '../../api/files';

export interface FilePickerMenuProps {
  slug: string;
  onClose: () => void;
  onPick: (path: string) => void;
  /**
   * Optional "解除绑定" handler. When provided and a path is currently
   * bound, an unbind button is rendered at the right edge of the tab bar
   * (mirrors the cover picker's "移除" button).
   */
  onUnbind?: () => void;
  /** Currently selected path (used to highlight in the list). */
  currentPath?: string;
  /** Anchor element used to compute the menu position. */
  anchorRef: RefObject<HTMLElement | null>;
}

type TabKey = 'library' | 'upload';

const VIEWPORT_MARGIN = 8;

/**
 * Floating two-tab picker for the fileContent block.
 *
 * Rendered via portal at document.body with position: fixed, so it is never
 * clipped by ancestor overflow containers. Position is computed from the
 * anchor element's bounding rect and clamped to the viewport:
 *   - default placement is below the anchor, left-aligned
 *   - if it would overflow the bottom, flip above (or clamp if no room)
 *   - if it would overflow the right, shift left; never off-screen left
 *
 * Auto-closes on scroll or resize so the menu never drifts away from its
 * anchor.
 */
export function FilePickerMenu({ slug, onClose, onPick, onUnbind, currentPath, anchorRef }: FilePickerMenuProps) {
  const [tab, setTab] = useState<TabKey>('library');
  const [items, setItems] = useState<SpaceFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [nameStatus, setNameStatus] = useState<{ checked: boolean; available: boolean }>({
    checked: false,
    available: false,
  });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  // Load library list
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listSpaceFiles(slug)
      .then((data) => {
        if (cancelled) return;
        setItems(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || '加载失败');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Position computation: run after the menu is mounted so we can measure
  // its size. useLayoutEffect avoids a visible flash on the first paint.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Vertical: try below; flip above if it overflows and there's more room
    // above; otherwise clamp to viewport.
    const spaceBelow = vh - anchorRect.bottom - VIEWPORT_MARGIN;
    const spaceAbove = anchorRect.top - VIEWPORT_MARGIN;
    let top: number;
    if (menuRect.height <= spaceBelow || spaceBelow >= spaceAbove) {
      top = anchorRect.bottom + 4;
      if (top + menuRect.height > vh - VIEWPORT_MARGIN) {
        top = Math.max(VIEWPORT_MARGIN, vh - VIEWPORT_MARGIN - menuRect.height);
      }
    } else {
      // flip above
      top = anchorRect.top - 4 - menuRect.height;
      if (top < VIEWPORT_MARGIN) {
        top = VIEWPORT_MARGIN;
      }
    }

    // Horizontal: left-align with anchor, clamp to viewport.
    let left = anchorRect.left;
    if (left + menuRect.width > vw - VIEWPORT_MARGIN) {
      left = vw - VIEWPORT_MARGIN - menuRect.width;
    }
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

    setCoords({ top, left });
  }, [anchorRef, items.length, tab]);

  // Outside-click to close
  useEffect(() => {
    function handler(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  // Close on scroll (any ancestor) and resize so position never goes stale.
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [onClose]);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Name availability check when a file is selected
  useEffect(() => {
    if (!selectedFile) {
      setNameStatus({ checked: false, available: false });
      return;
    }
    let cancelled = false;
    setUploadError(null);
    checkSpaceFileName(slug, selectedFile.name)
      .then((available) => {
        if (!cancelled) setNameStatus({ checked: true, available });
      })
      .catch(() => {
        if (!cancelled) setNameStatus({ checked: true, available: false });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFile, slug]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((it) => {
      const disp = displayFilePath(it.path).toLowerCase();
      return disp.includes(q) || it.name.toLowerCase().includes(q);
    });
  }, [items, query]);

  const handleUpload = async () => {
    if (!selectedFile || !nameStatus.available) return;
    setUploading(true);
    setUploadError(null);
    try {
      const result = await uploadSpaceFile(slug, selectedFile);
      const refreshed = await listSpaceFiles(slug);
      setItems(refreshed);
      onPick(result.path);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 409) {
        setUploadError('同名文件已存在');
        setNameStatus({ checked: true, available: false });
      } else {
        setUploadError(err?.response?.data || err?.message || '上传失败');
      }
    } finally {
      setUploading(false);
    }
  };

  // Style: fixed positioning; on first paint (coords === null) we render
  // invisibly so we can measure, then the layout effect sets coords.
  const style: React.CSSProperties = coords
    ? { position: 'fixed', top: coords.top, left: coords.left }
    : { position: 'fixed', top: -9999, left: -9999, visibility: 'hidden' };

  // Prevent editor blur ONLY when the user clicks non-interactive chrome
  // (the panel background, tabs, etc.). For form elements inside the panel
  // (input / textarea / button), we must let mousedown proceed so they can
  // receive focus — calling preventDefault on them would make the search
  // box and upload button appear "dead" on click.
  const isInteractiveTarget = (el: EventTarget | null): boolean => {
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    if (tag === 'button') return true;
    if (el.closest('button, input, textarea, select, [contenteditable="true"]')) return true;
    return false;
  };

  return createPortal(
    <div
      ref={menuRef}
      className="bn-file-picker-menu"
      style={style}
      onPointerDownCapture={(e) => {
        if (isInteractiveTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        if (isInteractiveTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bn-file-picker-tabs">
        <div className="bn-file-picker-tabs-left">
          <button
            type="button"
            className={`bn-file-picker-tab${tab === 'library' ? ' is-active' : ''}`}
            onClick={() => setTab('library')}
          >
            已有文件
          </button>
          <button
            type="button"
            className={`bn-file-picker-tab${tab === 'upload' ? ' is-active' : ''}`}
            onClick={() => setTab('upload')}
          >
            上传
          </button>
        </div>
        {onUnbind && currentPath && (
          <div className="bn-file-picker-tabs-right">
            <button
              type="button"
              className="bn-file-picker-unbind"
              onClick={() => {
                onUnbind();
                onClose();
              }}
            >
              解除绑定
            </button>
          </div>
        )}
      </div>

      <div className="bn-file-picker-body">
        {tab === 'library' && (
          <div className="bn-file-picker-library">
            <div className="bn-file-picker-search">
              <Search size={14} />
              <input
                type="text"
                placeholder="搜索文件名 / 路径"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="bn-file-picker-list">
              {loading && <div className="bn-file-picker-empty">加载中…</div>}
              {!loading && error && <div className="bn-file-picker-empty">{error}</div>}
              {!loading && !error && filtered.length === 0 && (
                <div className="bn-file-picker-empty">暂无文件，去上传 tab 添加</div>
              )}
              {!loading &&
                !error &&
                filtered.map((it) => (
                  <button
                    key={it.path}
                    type="button"
                    className={`bn-file-picker-item${it.path === currentPath ? ' is-selected' : ''}`}
                    title={displayFilePath(it.path)}
                    onClick={() => onPick(it.path)}
                  >
                    <FileIcon size={14} />
                    <span className="bn-file-picker-item-path">{displayFilePath(it.path)}</span>
                    <span className="bn-file-picker-item-size">{formatBytes(it.size)}</span>
                  </button>
                ))}
            </div>
          </div>
        )}

        {tab === 'upload' && (
          <div className="bn-file-picker-upload">
            <input
              ref={fileInputRef}
              type="file"
              className="bn-file-input-native"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setSelectedFile(f);
              }}
            />
            <button
              type="button"
              className="bn-file-picker-upload-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} />
              <span>{selectedFile ? selectedFile.name : '选择文件'}</span>
            </button>
            {selectedFile && (
              <div className="bn-file-picker-upload-info">
                {nameStatus.checked ? (
                  nameStatus.available ? (
                    <span className="bn-file-picker-ok">文件名可用</span>
                  ) : (
                    <span className="bn-file-picker-warn">
                      <AlertCircle size={12} /> 同名文件已存在
                    </span>
                  )
                ) : (
                  <span className="bn-file-picker-info">检查文件名中…</span>
                )}
              </div>
            )}
            {uploadError && (
              <div className="bn-file-picker-upload-error">{uploadError}</div>
            )}
            <button
              type="button"
              className="bn-file-picker-upload-submit"
              disabled={!selectedFile || !nameStatus.available || uploading}
              onClick={handleUpload}
            >
              {uploading ? '上传中…' : '上传'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
