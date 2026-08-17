// Rally service worker — offline app shell + runtime caching.
// CACHE_VERSION is stamped with the per-build id at build time (see
// vite.config.js), so every deploy automatically invalidates the old cache.
// In dev the placeholder is served as-is, which is fine.
const CACHE_VERSION = 'rally-__BUILD_ID__';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

// Last-resort page for a navigation that can't be served from network or cache.
// A navigation MUST end in a Response — see the fetch handler below.
const offlinePage = () => new Response(
  '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  + '<title>Rally</title></head>'
  + '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;'
  + 'background:#faf9f7;color:#4a4a4a;font-family:system-ui,-apple-system,sans-serif;text-align:center">'
  + '<div style="padding:2rem"><div style="font-size:1.5rem;font-weight:700;color:#863bff">Rally</div>'
  + '<p style="margin:0.75rem 0 1.25rem;font-size:0.9rem">Couldn’t reach Rally. Check your connection.</p>'
  + '<button onclick="location.reload()" style="padding:0.6rem 1.5rem;border:none;border-radius:8px;'
  + 'background:#863bff;color:#fff;font:inherit;font-size:0.9rem;cursor:pointer">Try again</button>'
  + '</div></body></html>',
  { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
);

self.addEventListener('install', (event) => {
  // Note: we do NOT skipWaiting here. A new build installs and then WAITS,
  // so the running app can prompt the user and control when it swaps in
  // (via the SKIP_WAITING message below). This makes updates reliable.
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // Cached one at a time, not with addAll: addAll is all-or-nothing, so a
      // single URL failing during install left the shell cache completely
      // empty — and an empty cache is what turned an offline navigation into
      // a dead page below.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .catch(() => {}),
  );
});

// The page tells the waiting worker to take over (Update Now button).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Always go to network for the API and anything cross-origin (Firebase,
  // Google APIs, fonts) — those manage their own freshness/auth.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network-first so the freshest HTML wins, with the cached
  // app shell as the offline fallback.
  //
  // Every branch here must end in a Response. This used to fall back to
  // `caches.match('/') || caches.match(request)`, which resolves to undefined
  // when neither is cached; respondWith(undefined) throws and the navigation
  // fails outright. A browser shows its own error page for that, but the iOS
  // WKWebView shell renders nothing — a black screen that survives relaunches,
  // since the worker stays registered and fails the next navigation the same way.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        // A redirected response can't be used for a navigation — WebKit fails
        // the load. Re-wrap it as a plain response with the same content.
        const safe = res.redirected
          ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers })
          : res;
        if (safe.ok) {
          const copy = safe.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/', copy)).catch(() => {});
        }
        return safe;
      } catch {
        return (await caches.match('/')) || (await caches.match(request)) || offlinePage();
      }
    })());
    return;
  }

  // Static assets (hashed JS/CSS, icons): stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        // Response.error() is a proper network-error response; returning
        // undefined here would throw inside respondWith the same way.
        .catch(() => cached || Response.error());
      return cached || network;
    }),
  );
});
