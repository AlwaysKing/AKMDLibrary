const DESKTOP_QUERY_KEY = 'desktop';
const DESKTOP_STORAGE_KEY = 'akmd_desktop_runtime';

function hasDesktopQuery(): boolean {
  return new URLSearchParams(window.location.search).get(DESKTOP_QUERY_KEY) === '1';
}

if (hasDesktopQuery()) {
  window.sessionStorage.setItem(DESKTOP_STORAGE_KEY, '1');
}

export function isDesktopRuntime(): boolean {
  return (
    window.__AKMD_DESKTOP__ === true ||
    window.location.protocol === 'wails:' ||
    hasDesktopQuery() ||
    window.sessionStorage.getItem(DESKTOP_STORAGE_KEY) === '1'
  );
}

export function getWebSocketURL(path: string): string {
  const url = new URL(path, window.__AKMD_WS_BASE__ || window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function openExternalURL(url: string): void {
  if (isDesktopRuntime() && window.runtime?.BrowserOpenURL) {
    window.runtime.BrowserOpenURL(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

if (isDesktopRuntime()) {
  const nativeOpen = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const value = typeof url === 'string' ? url : url?.toString();
    if (value && /^https?:\/\//i.test(value) && window.runtime?.BrowserOpenURL) {
      window.runtime.BrowserOpenURL(value);
      return null;
    }
    return nativeOpen(url as string | undefined, target, features);
  }) as typeof window.open;
}
