import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { pagesApi, TrashedItem } from '../api/pages';
import { useSpaceStore } from '../stores/spaceStore';
import { RotateCcw, Trash2 } from 'lucide-react';

export default function TrashPage() {
  const { spaceSlug } = useParams<{ spaceSlug: string }>();
  const [items, setItems] = useState<TrashedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (spaceSlug) fetchTrash();
  }, [spaceSlug]);

  const fetchTrash = async () => {
    if (!spaceSlug) return;
    try {
      const data = await pagesApi.listTrash(spaceSlug);
      setItems(data);
    } catch (err) {
      console.error('Failed to fetch trash:', err);
    }
    setIsLoading(false);
  };

  const handleRestore = async (item: TrashedItem) => {
    if (!spaceSlug) return;
    try {
      await pagesApi.restoreFromTrash(spaceSlug, item.trash_path);
      setItems(items.filter((i) => i.trash_path !== item.trash_path));
      await useSpaceStore.getState().refreshPageTree();
    } catch (err) {
      console.error('Failed to restore:', err);
    }
  };

  const handlePermanentDelete = async (item: TrashedItem) => {
    if (!spaceSlug) return;
    try {
      await pagesApi.permanentDelete(spaceSlug, item.trash_path);
      setItems(items.filter((i) => i.trash_path !== item.trash_path));
    } catch (err) {
      console.error('Failed to permanently delete:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-notion-border border-t-notion-text"></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-notion-bg">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[912px] mx-auto px-24 py-8 pb-32">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-notion-text">回收站</h1>
            <p className="text-sm text-notion-textSecondary mt-0.5">删除的页面可以在这里还原</p>
          </div>

          {items.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-notion-textSecondary">回收站是空的</p>
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((item) => (
                <div
                  key={item.trash_path}
                  className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-notion-hover transition-colors group"
                >
                  <div>
                    <p className="text-notion-text font-medium">{item.name}</p>
                    <p className="text-xs text-notion-textSecondary mt-0.5">
                      原路径：{item.parent_path || '根目录'}/{item.file_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleRestore(item)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-notion-text hover:bg-notion-border rounded transition-colors"
                      title="还原"
                    >
                      <RotateCcw className="w-4 h-4" />
                      还原
                    </button>
                    <button
                      onClick={() => handlePermanentDelete(item)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 rounded transition-colors"
                      title="永久删除"
                    >
                      <Trash2 className="w-4 h-4" />
                      永久删除
                    </button>
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
