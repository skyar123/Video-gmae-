/**
 * Offline shell for the home-screen app.
 *
 * Deliberately small and conservative: no build step, no precache manifest to
 * go stale. Three rules, chosen by what the request is for.
 *
 *   - Navigations: network first, cache as a fallback. A phone with no signal
 *     still opens the app; a phone with signal always gets the current build.
 *   - Hashed build assets: cache first. The hash is the version, so a cached
 *     copy can never be wrong, and this is what makes a cold launch instant.
 *   - API and store images: stale-while-revalidate. Yesterday's prices beat a
 *     spinner, and the fresh copy lands before you have finished scrolling.
 *
 * Anything else falls through to the network untouched.
 */

const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const DATA = `data-${VERSION}`;
const MEDIA = `media-${VERSION}`;

const MEDIA_HOSTS = [
  'image.api.playstation.com',
  'shared.akamai.steamstatic.com',
  'cdn.akamai.steamstatic.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(['/', '/manifest.webmanifest'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.endsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Puts a copy away without letting a cache failure break the response. */
const store = (cacheName, request, response) => {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches.open(cacheName).then((cache) => cache.put(request, copy)).catch(() => {});
  return response;
};

async function networkFirst(request, cacheName) {
  try {
    return store(cacheName, request, await fetch(request));
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error('offline');
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return store(cacheName, request, await fetch(request));
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const fresh = fetch(request)
    .then((response) => store(cacheName, request, response))
    .catch(() => null);
  return cached ?? (await fresh) ?? Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, SHELL).catch(
        async () => (await caches.match('/')) ?? Response.error(),
      ),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) {
      event.respondWith(staleWhileRevalidate(request, DATA));
      return;
    }
    // Vite writes a content hash into every built asset's name.
    if (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest)$/.test(url.pathname)) {
      event.respondWith(cacheFirst(request, ASSETS));
      return;
    }
  }

  if (MEDIA_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, MEDIA));
  }
});
