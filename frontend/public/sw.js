// PWA Service Worker — App Shell precache + stale-while-revalidate for static
// assets. API requests (/api/*) bypass the cache to avoid stale user data.

const CACHE_VERSION = 'akmdl-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // addAll fails atomically if any single resource 404s; add individually so
    // a missing optional asset doesn't break the whole install.
    await Promise.all(APP_SHELL.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Cross-origin: pass through (e.g. CDN fonts, Google APIs).
  if (url.origin !== self.location.origin) return;

  // API requests: network-only, never cache (avoid stale user data).
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests: network-first with cache fallback (offline shell).
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put('/', fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      })
      .catch(() => cached);
    return cached || network;
  })());
});
