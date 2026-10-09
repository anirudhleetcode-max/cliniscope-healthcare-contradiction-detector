// MEDGUARD offline support. Same-origin GET requests only; never caches
// cross-origin traffic (e.g. an optional shared-workspace API).
const CACHE = 'medguard-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The page sends the list of resources it has loaded so they are available offline.
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'precache' || !Array.isArray(e.data.urls)) return;
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of e.data.urls) {
      try {
        const u = new URL(url, self.location.href);
        if (u.origin !== self.location.origin) continue;
        if (!(await cache.match(u.href))) { const r = await fetch(u.href); if (r.ok) await cache.put(u.href, r); }
      } catch { /* best effort */ }
    }
    e.source?.postMessage({ type: 'precached' });
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const immutable = /\/(assets|ocr|demo)\//.test(url.pathname) || url.pathname.endsWith('pdf.worker.min.js');
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (immutable) {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }
    // App shell: network first (picks up new deployments), cache as offline fallback.
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req)) ?? (await cache.match(new URL('./', self.location.href).href)) ?? Response.error();
    }
  })());
});
