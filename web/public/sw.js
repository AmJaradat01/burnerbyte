// BurnerByte Service Worker — basic offline support
// Bump CACHE_VERSION on each deploy to invalidate old caches
const CACHE_VERSION = "3";
const CACHE_NAME = `burnerbyte-v${CACHE_VERSION}`;

// Pre-cache the offline page and key assets on install
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(["/favicon.svg", "/manifest.json"])
    )
  );
  self.skipWaiting();
});

// Clean up old caches on activate
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first strategy for navigation, cache-first for static assets
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== "GET") return;
  if (request.url.includes("/ws/")) return;

  // Stale-while-revalidate for inbox list API (offline-first for key data)
  if (request.url.includes("/api/") && request.url.includes("/inboxes")) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          const fetchPromise = fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          }).catch(() => cached || new Response(JSON.stringify({ data: [], total: 0, page: 1, per_page: 12, total_pages: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }));
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Skip other API calls (no caching for mutations, auth, etc.)
  if (request.url.includes("/api/")) return;

  // For navigation requests, try network first
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((cached) => cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } }))
      )
    );
    return;
  }

  // For static assets, try cache first then network
  if (request.url.match(/\.(js|css|svg|png|ico|woff2?)$/)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
  }
});
