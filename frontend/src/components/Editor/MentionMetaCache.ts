import { bookmarksApi, BookmarkMeta } from '../../api/bookmarks';

export interface LinkMeta {
  title: string;
  description: string;
  favicon_url: string;
  image_url: string;
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

    const promise = bookmarksApi.getMeta(url)
      .then((meta: BookmarkMeta) => {
        const result: LinkMeta = {
          title: meta.title || url,
          description: meta.description || '',
          favicon_url: meta.favicon_url || '',
          image_url: meta.image_url || '',
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
