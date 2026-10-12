/**
 * Install-only service worker for safemap.worklazy.net.
 *
 * Why this file exists at all: Chrome/Edge only offer "Install app" (`beforeinstallprompt`) once a service worker
 * with a `fetch` handler is registered for the page's scope — see the 2026 installability criteria. This worker is
 * NOT meant to give the map offline navigation; the map is contributor-only and most of what it shows comes from
 * API responses that may carry personal report data (docs/public-api-contract.md), which must never sit in a
 * cache, a service worker, or localStorage/IndexedDB past sign-out or an account switch.
 *
 * What it is allowed to ever touch, by construction:
 *  - Only GET requests to THIS origin whose path starts with "/assets/" — the Vite build's content-hashed,
 *    1-year-immutable JS/CSS/WASM chunks (see public/_headers). A content hash in the URL means the bytes behind a
 *    given URL never change, so caching it indefinitely can never go stale or leak a future deploy's secrets into
 *    an old client.
 *  - It never touches navigation requests ("/", "/index.html") or the manifest — those always go straight to the
 *    network, so a stale cached shell can never reference assets a newer deploy already removed.
 *  - It never touches "/functions/v1/*" (the API) or any other-origin request (Kakao OAuth, Supabase auth, map
 *    tiles, ad script) — those are not ours to cache and are passed straight through, untouched.
 *  - It never stores a response body for a non-GET request, a redirect, or an opaque/cross-origin response.
 *
 * CACHE_NAME only needs to change if this STRATEGY changes (not on every deploy — asset URLs already change
 * per deploy because they are content-hashed). `activate` always deletes any cache that does not match the
 * current name, so a future redesign cannot leave an orphaned cache behind.
 */
const CACHE_NAME = 'cm-shell-assets-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never touch writes

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Kakao/Supabase/tiles/ads — never ours to cache
  if (!url.pathname.startsWith('/assets/')) return; // app shell (/, /index.html), manifest and API stay network-only

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => fetch(request)),
  );
});
