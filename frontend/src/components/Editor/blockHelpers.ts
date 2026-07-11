import { useSpaceStore } from '../../stores/spaceStore';
import { pagesApi } from '../../api/pages';
import { syncedBlocksApi } from '../../api/syncedBlocks';
import { findBlockDeep } from './BlockNoteComponents';

function flattenBlocks(blocks: any[]): any[] {
  const out: any[] = [];
  for (const block of blocks || []) {
    out.push(block);
    if (Array.isArray(block.children) && block.children.length > 0) {
      out.push(...flattenBlocks(block.children));
    }
  }
  return out;
}

type RemovedSyncedMirror = {
  sourcePageId: string;
  sourceBlockId: string;
  syncId: string;
};

function collectBlockPaths(
  blocks: any[],
  path: string[] = [],
  out = new Map<string, string[]>(),
) {
  for (const block of blocks || []) {
    if (!block?.id) continue;
    const nextPath = [...path, block.id];
    out.set(block.id, nextPath);
    if (Array.isArray(block.children) && block.children.length > 0) {
      collectBlockPaths(block.children, nextPath, out);
    }
  }
  return out;
}

function normalizeRemoveBlockIds(documentBlocks: any[], blockIds: string[]) {
  const seen = new Set<string>();
  const uniqueIds = blockIds.filter((id) => {
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const paths = collectBlockPaths(documentBlocks);
  const selected = new Set(uniqueIds);

  return uniqueIds.filter((id) => {
    const path = paths.get(id);
    if (!path) return false;
    return !path.slice(0, -1).some((ancestorId) => selected.has(ancestorId));
  });
}

async function removeSyncedMirrorQuotes(spaceSlug: string, mirrors: RemovedSyncedMirror[]) {
  const seen = new Set<string>();
  for (const mirror of mirrors) {
    const key = `${mirror.sourcePageId}:${mirror.sourceBlockId}:${mirror.syncId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      const source = await syncedBlocksApi.get(spaceSlug, mirror.sourcePageId, mirror.sourceBlockId);
      await syncedBlocksApi.update(spaceSlug, mirror.sourcePageId, mirror.sourceBlockId, {
        markdown: source.markdown,
        removeQuoted: [mirror.syncId],
      });
    } catch (err: any) {
      if (err?.response?.status !== 404) {
        console.error('Failed to remove synced block quote:', err);
      }
    }
  }
}

/**
 * Enhanced removeBlocks: when any of the removed blocks is a subpage block,
 * also clean up related backend state and refresh the sidebar tree.
 */
export async function removeBlocksEnhanced(editor: any, blocks: any[] | string[]) {
  // Normalize input: BlockNote accepts both block objects and ID strings
  const requestedBlockIds = blocks.map((b: any) =>
    typeof b === 'string' ? b : b.id,
  );
  const blockIds = normalizeRemoveBlockIds(editor.document, requestedBlockIds);
  const blockIdSet = new Set(blockIds);
  const blocksToRemove = blocks.filter((b: any) => {
    const id = typeof b === 'string' ? b : b.id;
    return blockIdSet.has(id);
  });
  if (blockIds.length === 0) return;

  // Find subpage blocks among those being removed
  const subpagePageIds: string[] = [];
  const removedSyncedMirrors: RemovedSyncedMirror[] = [];
  for (const id of blockIds) {
    const block = findBlockDeep(editor.document, id);
    for (const removedBlock of flattenBlocks(block ? [block] : [])) {
      if (removedBlock?.type === 'syncedBlockMirror') {
        const sourcePageId = String(removedBlock.props?.sourcePageId || '');
        const sourceBlockId = String(removedBlock.props?.sourceBlockId || '');
        const syncId = String(removedBlock.props?.syncId || '');
        if (sourcePageId && sourceBlockId && syncId) {
          removedSyncedMirrors.push({ sourcePageId, sourceBlockId, syncId });
        }
      }
    }
    if (block?.type === 'subpage' && block.props?.pageId) {
      subpagePageIds.push(block.props.pageId);
    }
  }

  // Remove blocks from editor first
  editor.removeBlocks(blocksToRemove);

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

  if (removedSyncedMirrors.length > 0) {
    const slug = useSpaceStore.getState().currentSpace?.slug;
    if (slug) {
      await removeSyncedMirrorQuotes(slug, removedSyncedMirrors);
    }
  }

  document.dispatchEvent(new CustomEvent('ak-blocks-removed', {
    detail: { blockIds },
  }));
}
