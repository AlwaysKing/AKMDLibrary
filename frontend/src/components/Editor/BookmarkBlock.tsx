import { useState, useEffect } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import { Globe, Trash2 } from 'lucide-react';
import { bookmarksApi, BookmarkMeta } from '../../api/bookmarks';

function BookmarkComponent({ block, editor }: any) {
  const url = block.props.url || '';
  const [meta, setMeta] = useState<BookmarkMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!url) { setLoading(false); return; }
    bookmarksApi.getMeta(url)
      .then(data => { setMeta(data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [url]);

  const handleClick = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    editor.removeBlocks([block]);
  };

  if (loading) {
    return (
      <div className="py-1">
        <div className="border border-notion-border rounded-lg overflow-hidden max-w-[600px]">
          <div className="p-3">
            <div className="h-4 bg-notion-sidebarBg rounded w-3/4 mb-2 animate-pulse" />
            <div className="h-3 bg-notion-sidebarBg rounded w-1/2 animate-pulse" />
          </div>
          <div className="border-t border-notion-border px-3 py-2 flex items-center gap-2">
            <Globe className="w-3 h-3 text-notion-textSecondary" />
            <div className="h-3 bg-notion-sidebarBg rounded w-32 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !meta) {
    return (
      <div className="py-1 group/bookmark relative">
        <div className="border border-notion-border rounded-lg overflow-hidden max-w-[600px] hover:border-notion-textSecondary transition-colors">
          <div className="p-3 cursor-pointer" onClick={handleClick}>
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-notion-textSecondary flex-shrink-0" />
              <span className="text-sm text-notion-textSecondary truncate">{url}</span>
            </div>
          </div>
        </div>
        <button
          onClick={handleDelete}
          className="absolute top-2 right-2 p-1 rounded hover:bg-notion-hover opacity-0 group-hover/bookmark:opacity-100 transition-opacity"
        >
          <Trash2 className="w-3 h-3 text-notion-textSecondary" />
        </button>
      </div>
    );
  }

  // Extract domain from URL
  let domain = '';
  try { domain = new URL(url).hostname; } catch { domain = url; }

  return (
    <div className="py-1 group/bookmark relative">
      <div
        onClick={handleClick}
        className="border border-notion-border rounded-lg overflow-hidden max-w-[600px] hover:border-notion-textSecondary transition-colors cursor-pointer flex"
      >
        {/* Text content */}
        <div className="flex-1 p-3 min-w-0">
          {meta.title && (
            <div className="text-sm font-medium text-notion-text mb-0.5 line-clamp-2">{meta.title}</div>
          )}
          {meta.description && (
            <div className="text-xs text-notion-textSecondary line-clamp-2 mb-1.5">{meta.description}</div>
          )}
          <div className="flex items-center gap-1.5">
            {meta.favicon_url ? (
              <img src={meta.favicon_url} alt="" className="w-3.5 h-3.5 object-contain flex-shrink-0" />
            ) : (
              <Globe className="w-3.5 h-3.5 text-notion-textSecondary flex-shrink-0" />
            )}
            <span className="text-xs text-notion-textSecondary truncate">{domain}</span>
          </div>
        </div>
        {/* Image thumbnail */}
        {meta.image_url && (
          <div className="w-[120px] flex-shrink-0 border-l border-notion-border">
            <img
              src={meta.image_url}
              alt=""
              className="w-full h-full object-cover"
              style={{ maxHeight: '100px' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        )}
      </div>
      <button
        onClick={handleDelete}
        className="absolute top-2 right-2 p-1 rounded hover:bg-notion-hover opacity-0 group-hover/bookmark:opacity-100 transition-opacity"
      >
        <Trash2 className="w-3 h-3 text-notion-textSecondary" />
      </button>
    </div>
  );
}

export const BookmarkBlockSpec = createReactBlockSpec(
  {
    type: 'bookmark',
    propSchema: { url: { default: '' } },
    content: 'none',
  },
  { render: BookmarkComponent },
);
