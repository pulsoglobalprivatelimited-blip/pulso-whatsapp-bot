const CACHE_NAME = 'pulso-admin-v3';
const STATIC_ASSETS = [
  '/admin/login',
  '/admin/manifest.webmanifest',
  '/admin/assets/dashboard.css?v=20260419a',
  '/admin/assets/admin-pwa.js?v=20260419a',
  '/admin/assets/pwa/icon.svg',
  '/admin/assets/pwa/icon-maskable.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) {
    return;
  }

  if (requestUrl.pathname.startsWith('/admin/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            }
            return response;
          })
          .catch(() => cached);

        return cached || networkFetch;
      })
    );
    return;
  }

  if (
    event.request.mode === 'navigate' &&
    (requestUrl.pathname === '/admin' || requestUrl.pathname === '/admin/login')
  ) {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cachedLogin = await caches.match('/admin/login');
        return cachedLogin || Response.error();
      })
    );
    return;
  }

  if (requestUrl.pathname === '/admin/manifest.webmanifest') {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
