import { useEffect, useRef, useState } from 'react';
import { pagesApi, TrashedItem } from '../api/pages';
import { useSpaceStore } from '../stores/spaceStore';
import { usePersonalStore } from '../stores/personalStore';
import { usePreferenceStore } from '../stores/preferenceStore';
import { LockKeyhole, RotateCcw, Trash2 } from 'lucide-react';

interface TrashEntry extends TrashedItem {
  sourceName: string;
  isPersonal: boolean;
}

export default function TrashPage() {
  const { currentSpace, spaces } = useSpaceStore();
  const [items, setItems] = useState<TrashEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestSeq = useRef(0);

  // 回收站聚合「侧边栏当前团队空间」和「个人空间」两个来源，
  // 不跟随路由上正在展示的文档所属空间。
  const teamSpace = currentSpace || spaces[0] || null;
  const teamSpaceSlug = teamSpace?.slug;

  // 直接打开 /trash 时 spaces 还在加载，teamSpaceSlug 会从 undefined 变成真实 slug，
  // 触发第二次拉取；用请求序号丢弃先发后到的结果，避免先返回的个人空间列表覆盖聚合结果。
  useEffect(() => {
    void fetchTrash();
    return () => {
      requestSeq.current += 1;
    };
  }, [teamSpaceSlug, spaces.length]);

  const fetchTrash = async () => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setLoadFailed(false);

    // 直接打开 /trash 时 store 里还没有空间列表（fetchSpaces 只在 /s/:spaceSlug 下触发），
    // 先补齐列表，回退顺序为：当前空间 → 上次活跃空间 → 第一个空间。
    if (!teamSpaceSlug) {
      await useSpaceStore.getState().fetchSpaces();
    }
    const spaceState = useSpaceStore.getState();
    const lastSlug = usePreferenceStore.getState().preferences.last_active_space_slug;
    const fallbackSpace = spaceState.currentSpace
      || spaceState.spaces.find((s) => s.slug === lastSlug)
      || spaceState.spaces[0]
      || null;
    const effectiveTeamSlug = teamSpaceSlug || fallbackSpace?.slug;
    const effectiveTeamName = teamSpaceSlug ? (teamSpace?.name || teamSpaceSlug) : (fallbackSpace?.name || effectiveTeamSlug);

    let personalSlug = usePersonalStore.getState().spaceSlug;
    if (!personalSlug) {
      await usePersonalStore.getState().fetchOverview();
      personalSlug = usePersonalStore.getState().spaceSlug;
    }

    const sources: Array<{ slug: string; name: string; isPersonal: boolean }> = [];
    if (effectiveTeamSlug) {
      sources.push({ slug: effectiveTeamSlug, name: effectiveTeamName || effectiveTeamSlug, isPersonal: false });
    }
    if (personalSlug && personalSlug !== effectiveTeamSlug) {
      sources.push({ slug: personalSlug, name: '个人空间', isPersonal: true });
    }

    let failed = false;
    const results = await Promise.all(sources.map(async (source) => {
      try {
        const data = await pagesApi.listTrash(source.slug);
        return data.map((item) => ({
          ...item,
          sourceName: source.name,
          isPersonal: source.isPersonal,
        }));
      } catch (err) {
        failed = true;
        console.error('Failed to fetch trash:', source.slug, err);
        return [];
      }
    }));

    if (seq !== requestSeq.current) return;
    setItems(results.flat());
    setLoadFailed(failed);
    setIsLoading(false);
  };

  const removeItem = (target: TrashEntry) => {
    setItems((current) => current.filter((item) => (
      item.space_slug !== target.space_slug || item.trash_path !== target.trash_path
    )));
  };

  const refreshSource = async (target: TrashEntry) => {
    if (target.isPersonal) {
      await usePersonalStore.getState().fetchOverview();
    } else {
      // 显式用条目所属的团队空间刷新，避免依赖 store 里可能已变化的 currentSpace。
      await useSpaceStore.getState().fetchPageTree(target.space_slug);
      await Promise.all([
        useSpaceStore.getState().fetchStarred(target.space_slug),
        useSpaceStore.getState().fetchRecent(target.space_slug),
      ]);
    }
  };

  const handleRestore = async (item: TrashEntry) => {
    try {
      await pagesApi.restoreFromTrash(item.space_slug, item.trash_path);
      removeItem(item);
      await refreshSource(item);
    } catch (err) {
      console.error('Failed to restore:', err);
    }
  };

  const handlePermanentDelete = async (item: TrashEntry) => {
    try {
      await pagesApi.permanentDelete(item.space_slug, item.trash_path);
      removeItem(item);
    } catch (err) {
      console.error('Failed to permanently delete:', err);
    }
  };

  const renderItemDescription = (item: TrashEntry) => {
    if (item.type !== 'database_row') {
      return (
        <p className="text-xs text-notion-textSecondary mt-0.5">
          原路径：{item.parent_path || '根目录'}/{item.file_name}
        </p>
      );
    }

    const fields = item.row_preview ?? [];
    return (
      <div className="mt-1 text-xs text-notion-textSecondary">
        {fields.length > 0 ? (
          <p className="line-clamp-2">
            {fields.map((field) => field.value).join(' · ')}
          </p>
        ) : (
          <p>无可预览字段</p>
        )}
      </div>
    );
  };

  const renderItemTitle = (item: TrashEntry) => {
    if (item.type !== 'database_row') {
      return <p className="text-notion-text font-medium">{item.name}</p>;
    }
    const databaseName = item.database_name || item.database_id || '未知数据库';
    return (
      <p className="flex items-baseline gap-1.5">
        <span className="text-notion-text text-[17px] font-semibold">{databaseName}</span>
        <span className="text-notion-textSecondary text-xs font-medium">数据库的数据页</span>
      </p>
    );
  };

  const renderSourceLabel = (item: TrashEntry) => (
    <span className="flex flex-shrink-0 items-center gap-1 rounded bg-notion-hover px-1.5 py-0.5 text-[10px] font-medium text-notion-textSecondary">
      {item.isPersonal && <LockKeyhole className="h-3 w-3" strokeWidth={1.8} />}
      {item.sourceName}
    </span>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-notion-border border-t-notion-text"></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-notion-bg">
      {/* Fixed head — title stays visible while the list scrolls */}
      <div>
        <div className="max-w-[912px] mx-auto px-24 pt-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-notion-text">回收站</h1>
            <p className="text-sm text-notion-textSecondary mt-0.5">删除的页面可以在这里还原</p>
          </div>
        </div>
      </div>

      {/* Scrollable list — only this region scrolls */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[912px] mx-auto px-24 pb-32">

          {loadFailed && (
            <p className="mb-3 text-sm text-notion-textSecondary">
              部分空间的回收站加载失败，请稍后重试
            </p>
          )}

          {items.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-notion-textSecondary">回收站是空的</p>
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((item) => (
                <div
                  key={`${item.space_slug}:${item.trash_path}`}
                  className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-notion-hover transition-colors group"
                >
                  <div className="min-w-0 pr-4">
                    <div className="flex items-center gap-2">
                      {renderItemTitle(item)}
                      {renderSourceLabel(item)}
                    </div>
                    {renderItemDescription(item)}
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
