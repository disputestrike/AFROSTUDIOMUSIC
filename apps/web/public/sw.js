/*
 * AFROHIT MINIMAL SERVICE WORKER — app-shell offline only.
 *
 * Scope is deliberately narrow and SAFE:
 *  - Precache a tiny app shell (manifest + icons) so the PWA can boot offline.
 *  - Same-origin GET navigations + Next.js static assets: network-first, fall
 *    back to cache when offline (so a saved page still opens with no internet).
 *  - Everything else — the API ("/backend"), any auth request, cross-origin
 *    audio, and every non-GET — is BYPASSED entirely (no caching). Auth and
 *    private media must never be served from a shared cache.
 *
 * The actual saved-song AUDIO is NOT handled here; it lives in IndexedDB
 * (lib/offline-store.ts) and the player reads it directly. This SW only makes
 * the shell openable offline.
 */

const CACHE = 'afrohit-shell-v3';
const SHELL = ['/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isCacheableAsset(url) {
  // Only same-origin Next static assets + the shell icons/manifest. Never the
  // API, never auth, never anything with a query string we don't control.
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/backend')) return false; // API proxy — never cache
  if (url.pathname.startsWith('/api/')) return false; // web API routes — never cache
  return (
    url.pathname.startsWith('/_next/static/') ||
    SHELL.includes(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only GET is ever eligible; mutations always hit the network untouched.
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // API + auth + cross-origin: hands off. Let the browser do it directly.
  if (url.origin === self.location.origin && (url.pathname.startsWith('/backend') || url.pathname.startsWith('/api/'))) {
    return;
  }

  // App navigations (opening a page): network-first, cache fallback so the
  // shell still loads offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then((hit) => hit ?? caches.match('/manifest.json').then((m) => m ?? Response.error())),
      ),
    );
    return;
  }

  // Static assets: cache-first (immutable, content-hashed), then network.
  if (isCacheableAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            const copy = res.clone();
            if (res.ok) caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
            return res;
          }),
      ),
    );
  }
});
