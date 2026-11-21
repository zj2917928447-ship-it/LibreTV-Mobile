/* Conservative PWA cache: never cache API responses or media streams. */
const CACHE_NAME = 'libretv-static-v25';
const PRECACHE = [
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/player-poster.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('libretv-static-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Authentication, dynamic API data, watch/live routes and all media are network-only.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/watch' ||
    url.pathname === '/live' ||
    /\.(m3u8|m3u|txt|mp4|m4v|webm|flv|ts|m4s|mpd|key)(?:$|\?)/i.test(url.pathname)
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const offline = await caches.match('/offline.html');
        return offline || new Response('当前无网络连接，请恢复网络后重试', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      })
    );
    return;
  }

  const isStatic =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    ['/favicon.ico', '/player-poster.png'].includes(url.pathname);

  if (!isStatic) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request).then((response) => {
        if (response.ok) void cache.put(request, response.clone());
        return response;
      }).catch(() => null);

      if (cached) {
        void network;
        return cached;
      }

      const response = await network;
      return response || new Response('', { status: 503 });
    })
  );
});
