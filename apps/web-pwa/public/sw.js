const CACHE_NAME = 'vh-pwa-cache-v2';
const ASSET_PATTERN = /\/assets\/.*\.(js|css|wasm)$/; // Added css
const APP_SHELL_PATH = '/index.html';

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  await Promise.all(clients.map((client) => client.postMessage(message)));
}

self.addEventListener('install', (event) => {
  console.log('[SW] Installing...', event);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Precaching app shell');
      return cache.addAll(['/', APP_SHELL_PATH]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...', event);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Navigation requests (HTML) -> network first so a previous tab can pick up
  // a new app shell instead of staying pinned to stale cache-first HTML.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(APP_SHELL_PATH);
        try {
          const response = await fetch(request);
          if (response.ok) {
            const [freshText, cachedText] = await Promise.all([
              response.clone().text(),
              cached ? cached.clone().text() : Promise.resolve(null),
            ]);
            await cache.put(APP_SHELL_PATH, response.clone());
            await cache.put('/', response.clone());
            if (cachedText !== null && cachedText !== freshText) {
              await notifyClients({ type: 'VH_CLIENT_OUT_OF_DATE', cacheName: CACHE_NAME });
            }
          }
          return response;
        } catch (error) {
          if (cached) return cached;
          throw error;
        }
      })
    );
    return;
  }

  // Assets -> Cache First
  if (ASSET_PATTERN.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          console.log('[SW] Serving from cache:', url.pathname);
          return cached;
        }
        console.log('[SW] Fetching:', url.pathname);
        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      })
    );
  }
});
