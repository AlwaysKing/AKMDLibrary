import { bookmarksApi, BookmarkMeta } from '../../api/bookmarks';
import { useSpaceStore } from '../../stores/spaceStore';
import { pagesApi, Page } from '../../api/pages';

export interface LinkMeta {
  title: string;
  description: string;
  favicon_url: string;
  image_url: string;
  is_internal?: boolean;
  page_id?: string;
}

const APP_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';
const INTERNAL_URL_RE = new RegExp(`^${APP_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/s/([^/]+)/p/([a-f0-9]{32})(?:$|/)`);

function findPageInTree(tree: Page[], pageId: string): Page | null {
  for (const page of tree) {
    if (page.id === pageId) return page;
    if (page.children) {
      const found = findPageInTree(page.children, pageId);
      if (found) return found;
    }
  }
  return null;
}

class MentionMetaCacheClass {
  private cache = new Map<string, LinkMeta>();
  private pending = new Map<string, Promise<LinkMeta | null>>();

  get(url: string): LinkMeta | null {
    return this.cache.get(url) || null;
  }

  async getOrFetch(url: string): Promise<LinkMeta | null> {
    const cached = this.cache.get(url);
    if (cached) return cached;

    const pending = this.pending.get(url);
    if (pending) return pending;

    const internalMatch = url.match(INTERNAL_URL_RE);
    if (internalMatch) {
      const spaceSlug = internalMatch[1];
      const pageId = internalMatch[2];
      const { pageTree } = useSpaceStore.getState();
      const treeMatch = findPageInTree(pageTree, pageId);

      const internalPromise = (async () => {
        try {
          const page = treeMatch || await pagesApi.get(spaceSlug, pageId);
          const result: LinkMeta = {
            title: page.title || url,
            description: '',
            favicon_url: page.icon || '',
            image_url: '',
            is_internal: true,
            page_id: page.id,
          };
          this.cache.set(url, result);
          this.pending.delete(url);
          return result;
        } catch {
          this.pending.delete(url);
          return null;
        }
      })();

      this.pending.set(url, internalPromise);
      return internalPromise;
    }

    const promise = bookmarksApi.getMeta(url)
      .then((meta: BookmarkMeta) => {
        const result: LinkMeta = {
          title: meta.title || url,
          description: meta.description || '',
          favicon_url: meta.favicon_url || '',
          image_url: meta.image_url || '',
          is_internal: false,
        };
        this.cache.set(url, result);
        this.pending.delete(url);
        return result;
      })
      .catch(() => {
        this.pending.delete(url);
        return null;
      });

    this.pending.set(url, promise);
    return promise;
  }
}

export const mentionMetaCache = new MentionMetaCacheClass();
