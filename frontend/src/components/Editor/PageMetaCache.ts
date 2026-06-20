/**
 * Lightweight singleton cache for page metadata (icon + title).
 * Pre-populated from spaceStore.pageTree, with API fallback.
 * Used by internal link badges and custom link toolbar.
 */
import { Page, pagesApi } from '../../api/pages';

export interface PageMeta {
  icon: string | null;
  title: string;
}

class PageMetaCache {
  private cache = new Map<string, PageMeta>();
  private pending = new Map<string, Promise<PageMeta | null>>();

  /** Populate from pageTree (call when tree refreshes) */
  populateFromTree(tree: Page[]): void {
    const walk = (nodes: Page[]) => {
      for (const page of nodes) {
        this.cache.set(page.id, {
          icon: page.icon || null,
          title: page.title || '未命名',
        });
        if (page.children) walk(page.children);
      }
    };
    walk(tree);
  }

  /** Synchronous get — returns null if not cached */
  get(pageId: string): PageMeta | null {
    return this.cache.get(pageId) ?? null;
  }

  /** Async get — fetches from API on cache miss */
  async getOrFetch(pageId: string, spaceSlug: string): Promise<PageMeta | null> {
    const cached = this.cache.get(pageId);
    if (cached) return cached;

    // Deduplicate in-flight requests
    const pending = this.pending.get(pageId);
    if (pending) return pending;

    const promise = pagesApi.get(spaceSlug, pageId)
      .then(page => {
        const meta: PageMeta = { icon: page.icon || null, title: page.title || '未命名' };
        this.cache.set(pageId, meta);
        this.pending.delete(pageId);
        return meta;
      })
      .catch(() => {
        this.pending.delete(pageId);
        return null;
      });

    this.pending.set(pageId, promise);
    return promise;
  }

  /** Clear cache (e.g., on space switch) */
  clear(): void {
    this.cache.clear();
    this.pending.clear();
  }
}

export const pageMetaCache = new PageMetaCache();
