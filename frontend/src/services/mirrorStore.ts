/**
 * Page Mirror Store — IndexedDB 持久化镜像存储
 *
 * 编辑器写入镜像（快速、本地），同步模块读取镜像推送服务器。
 * 镜像数据持久化在 IndexedDB 中，关闭浏览器也不丢失。
 */

const DB_NAME = 'mdlibrary';
const DB_VERSION = 2;
const STORE_NAME = 'page_mirrors';

export interface PageMirror {
  id?: number;
  spaceSlug: string;
  pageId: number;
  content: string;
  createdAt: number;
  synced: boolean;
  syncedAt?: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let dbAvailable = true;

// ---- IndexedDB helpers ----

function wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (!dbAvailable) return Promise.reject(new Error('IndexedDB unavailable'));

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      // v1→v2: rebuild store (boolean index was broken)
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      store.createIndex('by_page', ['spaceSlug', 'pageId'], { unique: false });
      store.createIndex('by_created', 'createdAt', { unique: false });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbAvailable = false;
      console.warn('[mirrorStore] IndexedDB not available, mirrors disabled');
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

function getStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDB().then(db => {
    const tx = db.transaction(STORE_NAME, mode);
    return tx.objectStore(STORE_NAME);
  });
}

// ---- Public API ----

export async function initMirrorDB(): Promise<void> {
  try {
    await openDB();
  } catch {
    // Silently fail — dbAvailable already set to false
  }
}

export async function createMirror(spaceSlug: string, pageId: number, content: string): Promise<void> {
  if (!dbAvailable) return;
  try {
    const store = await getStore('readwrite');
    await wrapRequest(
      store.add({
        spaceSlug,
        pageId,
        content,
        createdAt: Date.now(),
        synced: false,
      } as PageMirror),
    );
  } catch (e) {
    console.warn('[mirrorStore] Failed to create mirror:', e);
  }
}

/**
 * 获取所有待同步镜像（不去重）。
 * 注意：IndexedDB 不支持 boolean 作为 key，所以不用 by_synced 索引，
 * 改为 getAll + JS 过滤。
 */
export async function getAllPendingMirrors(): Promise<PageMirror[]> {
  if (!dbAvailable) return [];
  try {
    const store = await getStore('readonly');
    const all = await wrapRequest<PageMirror[]>(store.getAll());
    return all.filter(m => !m.synced);
  } catch (e) {
    console.warn('[mirrorStore] Failed to get pending mirrors:', e);
    return [];
  }
}

/**
 * 获取某页最新的镜像（不限同步状态）。用于页面加载时检查是否有未同步内容。
 */
export async function getLatestMirror(spaceSlug: string, pageId: number): Promise<PageMirror | null> {
  if (!dbAvailable) return null;
  try {
    const store = await getStore('readonly');
    const index = store.index('by_page');
    const all = await wrapRequest<PageMirror[]>(index.getAll(IDBKeyRange.only([spaceSlug, pageId])));

    let latest: PageMirror | null = null;
    for (const m of all) {
      if (!latest || m.createdAt > latest.createdAt) {
        latest = m;
      }
    }
    return latest;
  } catch (e) {
    console.warn('[mirrorStore] Failed to get latest mirror:', e);
    return null;
  }
}

export async function markSynced(id: number): Promise<void> {
  if (!dbAvailable) return;
  try {
    const store = await getStore('readwrite');
    const record = await wrapRequest<PageMirror>(store.get(id));
    if (record) {
      record.synced = true;
      record.syncedAt = Date.now();
      await wrapRequest(store.put(record));
    }
  } catch (e) {
    console.warn('[mirrorStore] Failed to mark synced:', e);
  }
}

export async function deleteMirror(id: number): Promise<void> {
  if (!dbAvailable) return;
  try {
    const store = await getStore('readwrite');
    await wrapRequest(store.delete(id));
  } catch (e) {
    console.warn('[mirrorStore] Failed to delete mirror:', e);
  }
}

/**
 * 批量删除镜像（按 ID 列表）。
 * 用于同步完一个页面后清理该页所有已知旧镜像。
 */
export async function deleteMirrors(ids: number[]): Promise<void> {
  if (!dbAvailable || ids.length === 0) return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const id of ids) {
      store.delete(id);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[mirrorStore] Failed to batch delete mirrors:', e);
  }
}

/**
 * 清理已同步的旧镜像（超过 maxAgeMs 的）。
 * 返回删除数量。
 */
export async function cleanupOldSyncedMirrors(maxAgeMs: number): Promise<number> {
  if (!dbAvailable) return 0;
  try {
    const store = await getStore('readwrite');
    const all = await wrapRequest<PageMirror[]>(store.getAll());
    const cutoff = Date.now() - maxAgeMs;
    let deleted = 0;
    for (const m of all) {
      if (m.synced && m.syncedAt && m.syncedAt < cutoff) {
        await wrapRequest(store.delete(m.id!));
        deleted++;
      }
    }
    return deleted;
  } catch (e) {
    console.warn('[mirrorStore] Failed to cleanup mirrors:', e);
    return 0;
  }
}
