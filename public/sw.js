// GitHub Actions fija este valor con el SHA publicado.
const BUILD_VERSION = '__BUILD_VERSION__';
const CACHE = 'pesito-github-' + BUILD_VERSION;
const base = self.registration.scope;
const optionalShell = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch(base, { cache: 'reload' });
    if (!response.ok) throw new Error('App shell unavailable');
    const html = await response.clone().text();
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+\/assets\/[^"']+|[^"']*assets\/[^"']+)["']/g)]
      .map(match => new URL(match[1], base).href)
      .filter(url => url.startsWith(base));
    // No activar una versión cuyo HTML o JS/CSS principal no pudo descargarse.
    await Promise.all([...new Set(assets)].map(async url => {
      const asset = await fetch(url, { cache: 'reload' });
      if (!asset.ok) throw new Error('App asset unavailable');
      await cache.put(url, asset);
    }));
    await cache.put(base, response);
    await Promise.allSettled(optionalShell.map(async path => {
      const url = new URL(path, base).href;
      const asset = await fetch(url, { cache: 'reload' });
      if (asset.ok) await cache.put(url, asset);
    }));
    // La primera instalación activa normalmente. Las actualizaciones esperan consentimiento.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const pages = (await self.clients.matchAll({ includeUncontrolled: true, type: 'window' }))
      .filter(client => client.url.startsWith(base));
    // Otras pestañas pueden seguir usando el bundle anterior. Conservar sus cachés.
    if (pages.length <= 1) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith('pesito-github-') && key !== CACHE).map(key => caches.delete(key)));
    }
    await self.clients.claim();
    for (const client of await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })) {
      if (client.url.startsWith(base)) client.postMessage({ type: 'SW_ACTIVATED', version: BUILD_VERSION });
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(base)) return;
  if (url.pathname.endsWith('/version.json') || event.request.cache === 'reload') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (!response.ok) throw new Error('Network response unavailable');
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, response.clone())).catch(() => undefined));
      return response;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') return (await caches.match(base)) ?? Response.error();
      return Response.error();
    }
  })());
});
