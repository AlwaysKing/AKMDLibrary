import PageTreeItem from './PageTreeItem';
import { useSpaceStore } from '../../stores/spaceStore';

export default function PageTree() {
  const { pageTree, currentSpace } = useSpaceStore();

  if (!currentSpace) {
    return (
      <div className="text-notion-textSecondary text-sm px-2 py-4">
        选择一个空间以查看页面
      </div>
    );
  }

  if (pageTree.length === 0) {
    return (
      <div className="text-notion-textSecondary text-sm px-2 py-4">
        暂无页面，创建你的第一个页面吧！
      </div>
    );
  }

  return (
    <div data-page-tree="true" className="space-y-[2px]">
      {pageTree.map((page) => (
        <PageTreeItem key={page.id} page={page} level={0} />
      ))}
    </div>
  );
}
