// GitHub Actions reemplaza este valor con el SHA de cada publicación.
// Así, una nueva versión de la app siempre instala un service worker nuevo.
const BUILD_VERSION = '__BUILD_VERSION__';
const CACHE = `pesito-github-${BUILD_VERSION}`;
const base = self.registration.scope;
const SHELL = [
  base,
  `${base}manifest.webmanifest`,
  `${base}icon-192.png`,
  `${base}icon-512.png`,
  `${base}apple-touch-icon.png`
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then(async (cache) => {
        await Promise.allSettled(
          SHELL.map((url) =>
            fetch(url, { cache: 'no-cache' }).then((res) => {
              if (res.ok) return cache.put(url, res);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'SW_ACTIVATED', version: BUILD_VERSION });
        }
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Nunca interceptar ni guardar llamadas a Supabase u otros servicios externos.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(base)) return;

  const fetchPromise = (event.request.mode === 'navigate')
    ? fetch(event.request, { cache: 'no-cache' }).catch(() => fetch(event.request))
    : fetch(event.request);

  event.respondWith(
    fetchPromise
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? caches.match(base)))
  );
});
