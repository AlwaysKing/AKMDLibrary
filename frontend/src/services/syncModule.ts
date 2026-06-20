/**
 * Sync Module — 后台同步单例
 *
 * 定时扫描 IndexedDB 中的待同步镜像，按页面分组推送至服务器。
 *
 * 同步策略：
 * 1. 取所有待同步镜像，按 (spaceSlug, pageId) 分组
 * 2. 每组取最新的镜像推送 API
 * 3. 推送成功后，删除该组全部镜像（包括刚同步的）
 * 4. 同步期间产生的新镜像不在当前批次中，下轮自动拾取
 */

import {
  getAllPendingMirrors,
  deleteMirrors,
  initMirrorDB,
} from './mirrorStore';
import type { PageMirror } from './mirrorStore';
import { pagesApi } from '../api/pages';

// ---- Types ----

export interface SyncStatusEvent {
  type: 'syncing' | 'synced' | 'error';
  spaceSlug: string;
  pageId: string;
  error?: string;
}

export type SyncStatusCallback = (event: SyncStatusEvent) => void;

// ---- State ----

const SYNC_INTERVAL = 4000;      // 4 秒扫描一次

let timerHandle: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let isSyncing = false;            // 防止并发 syncCycle
const listeners = new Set<SyncStatusCallback>();

// ---- Internal ----

function emit(event: SyncStatusEvent): void {
  for (const cb of listeners) {
    try {
      cb(event);
    } catch (e) {
      console.warn('[syncModule] Listener error:', e);
    }
  }
}

interface MirrorGroup {
  key: string;
  spaceSlug: string;
  pageId: string;
  mirrors: PageMirror[];
  latest: PageMirror;
}

function groupMirrors(mirrors: PageMirror[]): MirrorGroup[] {
  const map = new Map<string, PageMirror[]>();
  for (const m of mirrors) {
    const key = `${m.spaceSlug}:${m.pageId}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }

  const groups: MirrorGroup[] = [];
  for (const [key, group] of map) {
    // 找最新的一条
    const sorted = [...group].sort((a, b) => b.createdAt - a.createdAt);
    groups.push({
      key,
      spaceSlug: sorted[0].spaceSlug,
      pageId: sorted[0].pageId,
      mirrors: group,
      latest: sorted[0],
    });
  }
  return groups;
}

async function syncCycle(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const allMirrors = await getAllPendingMirrors();
    if (allMirrors.length === 0) return;

    const groups = groupMirrors(allMirrors);

    for (const group of groups) {
      const mirror = group.latest;
      if (!mirror.id) continue;

      emit({ type: 'syncing', spaceSlug: group.spaceSlug, pageId: group.pageId });

      try {
        // 推送最新镜像到服务器
        await pagesApi.update(group.spaceSlug, group.pageId, mirror.content);
        emit({ type: 'synced', spaceSlug: group.spaceSlug, pageId: group.pageId });

        // 同步成功：删除该页所有已知镜像（包括刚同步的和更早的）
        const ids = group.mirrors.map(m => m.id!).filter(Boolean);
        await deleteMirrors(ids);

        // 刷新页面树（标题可能变了）
        try {
          const { useSpaceStore } = await import('../stores/spaceStore');
          await useSpaceStore.getState().refreshAll();
        } catch {
          // store may not be ready, ignore
        }
      } catch (e: any) {
        const status = e?.response?.status;
        if (status === 404) {
          // 页面已在服务端删除，清理该页所有镜像
          const ids = group.mirrors.map(m => m.id!).filter(Boolean);
          await deleteMirrors(ids);
          console.info(`[syncModule] Deleted orphan mirrors for page ${group.pageId} (404)`);
        } else {
          console.warn(`[syncModule] Failed to sync page ${group.pageId}:`, e?.message);
          emit({ type: 'error', spaceSlug: group.spaceSlug, pageId: group.pageId, error: e?.message });
        }
      }
    }
  } finally {
    isSyncing = false;
  }
}

// ---- Public API ----

export function startSync(): void {
  if (isRunning) return;
  isRunning = true;

  initMirrorDB().then(() => {
    timerHandle = setInterval(() => {
      syncCycle();
    }, SYNC_INTERVAL);

    // 启动后立即执行一次（处理上次未完成的镜像）
    syncCycle();
  });
}

export function stopSync(): void {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
  isRunning = false;
}

/**
 * 立即执行一次同步并等待完成。
 * 用于页面加载时检测到未同步镜像的场景。
 */
export async function flushSync(): Promise<void> {
  await initMirrorDB();
  await syncCycle();
}

/**
 * 订阅同步状态变化。返回取消订阅函数。
 */
export function onSyncStatusChange(callback: SyncStatusCallback): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

// ---- Auto-start ----
if (typeof window !== 'undefined') {
  startSync();
}
