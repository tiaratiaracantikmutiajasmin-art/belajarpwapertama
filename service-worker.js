const CACHE_NAME = "notionflow-v3";
const OFFLINE_URL = "./offline.html";

const urlsToCache = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.json",
  "./assets/style.css",
  "./icons/icon-192x192-A.png",
  "./icons/icon-512x512-B.png",
];

// Install Service Worker & cache essential files
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("[SW] Caching app shell");
        return cache.addAll(urlsToCache);
      })
      .catch((err) => console.error("[SW] Cache gagal:", err))
  );
});

// Activate & clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Enable navigation preload if supported
      if ("navigationPreload" in self.registration) {
        await self.registration.navigationPreload.enable();
      }

      // Delete old caches
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[SW] Menghapus cache lama:", key);
            return caches.delete(key);
          }
        })
      );

      // Take control of all pages immediately
      await self.clients.claim();
    })()
  );
});

// Fetch: Network-first for navigation, Cache-first for assets
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Skip chrome-extension and other non-http(s) requests
  const url = new URL(request.url);
  if (!url.protocol.startsWith("http")) return;

  // Navigation requests (HTML pages) — Network first, fallback to cache, then offline page
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          // Try navigation preload response first
          const preloadResponse = event.preloadResponse && (await event.preloadResponse);
          if (preloadResponse) {
            return preloadResponse;
          }

          // Then try network
          const networkResponse = await fetch(request);
          // Cache the successful response
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone());
          return networkResponse;
        } catch (error) {
          // Network failed, try cache
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          // Return offline page as last resort
          return caches.match(OFFLINE_URL);
        }
      })()
    );
    return;
  }

  // Static assets (same-origin) — Cache first, fallback to network
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request)
          .then((networkResponse) => {
            // Cache the new resource
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
            return networkResponse;
          })
          .catch(() => {
            // For images, return a placeholder or just fail gracefully
            if (request.destination === "image") {
              return new Response("", {
                headers: { "Content-Type": "image/svg+xml" },
              });
            }
          });
      })
    );
    return;
  }

  // External resources (CDN, APIs) — Network first, fallback to cache
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone);
        });
        return networkResponse;
      })
      .catch(() => caches.match(request))
  );
});
