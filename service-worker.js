const CACHE_VERSION = 'zogaga-v0.2.0';
const PRECACHE_URLS = [
  './', './index.html', './manifest.json', './favicon.svg',
  './assets/css/style.css', './assets/js/license.js',
  './assets/images/logo.png', './assets/images/logo-print.png',
  './assets/images/logo-192.png', './assets/images/logo-512.png',
  './assets/images/qr.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API الترخيص: شبكة فقط — ممنوع الكاش نهائياً
  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      Promise.race([
        fetch(request).catch(() => null),
        new Promise((resolve) => setTimeout(() => resolve(null), 3000))
      ]).then(async (netRes) => {
        if (netRes && netRes.ok) {
          const clone = netRes.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, clone));
          return netRes;
        }
        const cached = await caches.match(request);
        return cached || caches.match('./index.html');
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((netRes) => {
        if (netRes && netRes.ok && request.url.startsWith(self.location.origin)) {
          const clone = netRes.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, clone));
        }
        return netRes;
      }).catch(() => cached);
    })
  );
});
