import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import DatabaseRowView from '../components/Editor/database/DatabaseRowView';

/**
 * 行页面的“嵌入”渲染：不带 App 外壳，专供浮层里的 iframe 使用。
 * 独立文档 = 独立 BlockNote 运行环境，因此浮层里也能拿到原生块把手。
 * 与父页面之间通过 postMessage 通信（关闭 / 全局展开）。
 */
export default function EmbedDatabaseRowPage() {
  const { spaceSlug, dbId, rowId } = useParams<{ spaceSlug: string; dbId: string; rowId: string }>();

  useEffect(() => {
    document.documentElement.style.background = '#fff';
    document.body.style.margin = '0';
    return () => {
      document.documentElement.style.removeProperty('background');
      document.body.style.removeProperty('margin');
    };
  }, []);

  if (!spaceSlug || !dbId || !rowId) return null;

  const notify = (type: 'close' | 'open-full') => {
    window.parent?.postMessage({ source: 'akmd-row-embed', type }, window.location.origin);
  };

  return (
    <div className="akdb-row-embed-root">
      <DatabaseRowView
        spaceSlug={spaceSlug}
        dbId={dbId}
        rowId={rowId}
        onClose={() => notify('close')}
        onOpenFull={() => notify('open-full')}
      />
    </div>
  );
}
