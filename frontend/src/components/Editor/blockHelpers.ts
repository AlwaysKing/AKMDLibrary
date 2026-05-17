import { useSpaceStore } from '../../stores/spaceStore';
import { pagesApi } from '../../api/pages';

/**
 * Enhanced removeBlocks: when any of the removed blocks is a subpage block,
 * also delete the corresponding page via API and refresh the sidebar tree.
 */
export async function removeBlocksEnhanced(editor: any, blocks: any[] | string[]) {
  // Normalize input: BlockNote accepts both block objects and ID strings
  const blockIds = blocks.map((b: any) =>
    typeof b === 'string' ? b : b.id,
  );

  // Find subpage blocks among those being removed
  const subpagePageIds: string[] = [];
  for (const id of blockIds) {
    const block = editor.document.find((b: any) => b.id === id);
    if (block?.type === 'subpage' && block.props?.pageId) {
      subpagePageIds.push(block.props.pageId);
    }
  }

  // Remove blocks from editor first
  editor.removeBlocks(blocks);

  // Delete corresponding pages and refresh sidebar
  if (subpagePageIds.length > 0) {
    const slug = useSpaceStore.getState().currentSpace?.slug;
    if (slug) {
      try {
        await Promise.all(
          subpagePageIds.map(pageId => pagesApi.delete(slug, pageId)),
        );
        useSpaceStore.getState().refreshPageTree();
      } catch (err) {
        console.error('Failed to delete subpage(s):', err);
      }
    }
  }
}
