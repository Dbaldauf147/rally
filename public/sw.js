// Minimal service worker — required for PWA installability so the Web Share
// Target manifest entry is honored. We don't cache anything; just pass requests
// through to the network.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Passthrough — no caching. The default browser behavior handles the request.
});
