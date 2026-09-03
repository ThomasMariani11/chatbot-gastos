// GitHub Actions reemplaza este valor con el SHA de cada publicación.
// Así, una nueva versión de la app siempre instala un service worker nuevo.
const BUILD_VERSION = '__BUILD_VERSION__';
const CACHE = `pesito-github-${BUILD_VERSION}`;
const base = self.registration.scope;
const SHELL = [base, `${base}manifest.webmanifest`, `${base}icon-192.png`, `${base}icon-512.png`, `${base}apple-touch-icon.png`];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Nunca interceptar ni guardar llamadas a Supabase u otros servicios externos.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(base)) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached ?? caches.match(base))));
});
