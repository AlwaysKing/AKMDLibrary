/**
 * Clipboard state module.
 *
 * 设计：所有剪贴板数据存放在系统剪贴板的三个 representation 中：
 *   - text/html：BlockNote 产出的 HTML + 嵌入的结构化 JSON（藏在 hidden div 的 data 属性里）
 *   - text/plain：标准 markdown 纯文本（兼容只读 text/plain 的应用）
 *   - web text/akmd-clipboard：同样的 JSON（兜底，Chrome 现版本 paste 事件不暴露此 MIME，但写进去无害）
 *
 * paste 事件从 text/html 里提取 embedded JSON；提取不到则 fallback 到 BlockNote 默认解析。
 *
 * 为什么不用 web text/akmd-clipboard 单独承载？
 *   Chrome 的 ClipboardItem.write() 接受 web custom format，但 paste 事件的 clipboardData
 *   只暴露 text/plain 和 text/html，自定义 MIME 被丢弃。所以必须把 JSON 嵌到 text/html 里。
 */

// ClipboardItem.write() 只接受 text/plain、text/html、image/png、image/svg+xml
// 以及 Web Custom Formats（"web <type>/<name>"）。
export const AKMD_CLIPBOARD_MIME = 'web text/akmd-clipboard';

// 嵌入 text/html 的 JSON 载体：<div data-akmd-clipboard="ENCODED_JSON" hidden></div>
// 外部应用会忽略这个空 div，我们自己 paste 时用正则提取。
const AKMD_HTML_MARKER_ATTR = 'data-akmd-clipboard';

export type ClipboardPayload = {
  v: 1;
  /** 完整 block 结构数组（用于内部粘贴，避免再次解析 markdown） */
  blocks: any[];
  /** blocks 序列化后的 markdown（同时作为 text/plain 写入系统剪贴板） */
  markdown: string;
  /** blocks 序列化后的 HTML 片段（作为 text/html 写入系统剪贴板，供 Notion 等外部应用识别块结构） */
  html?: string;
  /** 是否为剪切操作 */
  isCut: boolean;
  /** 来源 space slug */
  sourceSpaceSlug: string;
  /** 来源 page id */
  sourcePageId: string;
  /** 来源 block id 列表 */
  sourceBlockIds: string[];
  /** 同步块 wrap 用的原始 markdown */
  sourceMarkdown: string;
  /** 是否候选"创建同步块"弹框（非剪切、且不含已有 syncedBlock） */
  isSyncedCandidate: boolean;
  /** 写入时间戳，用于 TTL 校验 */
  createdAt: number;
};

const TTL_MS = 5 * 60 * 1000;

/**
 * 将 payload 写入系统剪贴板：
 *   - 优先尝试 ClipboardItem 多 MIME 写入（text/html 含嵌入 JSON + text/plain + web custom format 兜底）
 *   - 失败时 fallback 到 writeText（仅 text/plain）
 */
export async function writeAkmdClipboard(
  payload: Omit<ClipboardPayload, 'v' | 'createdAt'>,
): Promise<void> {
  const full: ClipboardPayload = { ...payload, v: 1, createdAt: Date.now() };
  const json = JSON.stringify(full);
  const jsonEncoded = encodeURIComponent(json);

  // 把 JSON 嵌入 HTML 开头的 hidden div——外部应用忽略空 div，我们自己用正则提取。
  // 即使 payload.html 为空（例如 syncedBlockSource/Mirror 这类自定义 block，
  // BlockNote 的 blocksToHTMLLossy 不认得、返回空串），也要写 text/html，
  // 否则 JSON 没有载体，paste 端读不到 payload。
  const htmlWithMarker = `<div ${AKMD_HTML_MARKER_ATTR}="${jsonEncoded}" aria-hidden="true" hidden></div>${payload.html ? '\n' + payload.html : ''}`;

  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const items: Record<string, Blob> = {
        [AKMD_CLIPBOARD_MIME]: new Blob([json], { type: AKMD_CLIPBOARD_MIME }),
        'text/plain': new Blob([payload.markdown], { type: 'text/plain' }),
        'text/html': new Blob([htmlWithMarker], { type: 'text/html' }),
      };
      await navigator.clipboard.write([new ClipboardItem(items)]);
      return;
    }
  } catch (err) {
    console.warn('[clipboard] ClipboardItem write failed, falling back to text/plain:', err);
  }

  try {
    await navigator.clipboard.writeText(payload.markdown);
  } catch (err) {
    console.warn('[clipboard] writeText fallback also failed:', err);
  }
}

/**
 * 从 paste 事件读取 payload。
 * 优先尝试 web text/akmd-clipboard（未来浏览器支持时直接生效）；
 * 拿不到则从 text/html 里提取嵌入的 JSON。
 * 校验版本号、TTL、blocks 非空，任一不满足返回 null（调用方走 fallback）。
 */
export function readAkmdClipboard(e: ClipboardEvent): ClipboardPayload | null {
  const data = e.clipboardData;
  if (!data) return null;

  let json = '';

  // 路径 1：web custom format（Chrome 现版本不暴露，但保留兼容未来）
  try {
    json = data.getData(AKMD_CLIPBOARD_MIME) || '';
  } catch {
    // ignore
  }

  // 路径 2：从 text/html 提取嵌入的 JSON
  if (!json) {
    const html = data.getData('text/html') || '';
    if (!html) return null;
    const match = html.match(/data-akmd-clipboard="([^"]*)"/);
    if (!match) return null;
    try {
      json = decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  }

  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as ClipboardPayload;
    if (parsed.v !== 1) return null;
    if (typeof parsed.createdAt !== 'number') return null;
    if (Date.now() - parsed.createdAt > TTL_MS) return null;
    if (!Array.isArray(parsed.blocks) || parsed.blocks.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Track page IDs that are currently being restored from trash (undo of delete).
 * SubpageBlock checks this to avoid making API calls that would 404.
 */
const pendingRestores = new Set<string>();

export function addPendingRestore(pageId: string): void {
  pendingRestores.add(pageId);
}

export function removePendingRestore(pageId: string): void {
  pendingRestores.delete(pageId);
}

export function isPendingRestore(pageId: string): boolean {
  return pendingRestores.has(pageId);
}

/**
 * Subpage undo actions: maps pageId to the correct undo behavior.
 * - 'delete': page was created by paste/duplicate, undo should delete it
 * - 'moveBack': page was moved from another parent, undo should move it back
 */
export type SubpageUndoAction =
  | { action: 'delete' }
  | { action: 'moveBack'; spaceSlug: string; fromParentId: string };

const subpageUndoActions = new Map<string, SubpageUndoAction>();

export function setSubpageUndoAction(pageId: string, action: SubpageUndoAction): void {
  subpageUndoActions.set(pageId, action);
}

export function getSubpageUndoAction(pageId: string): SubpageUndoAction | undefined {
  return subpageUndoActions.get(pageId);
}

export function clearSubpageUndoAction(pageId: string): void {
  subpageUndoActions.delete(pageId);
}
