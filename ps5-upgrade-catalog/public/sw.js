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
 *   - API calls: network first with a short timeout, cache as a fallback.
 *     This app's prices, news and calendar change under it; a visitor with a
 *     signal must always see what the server has right now, not whatever
 *     happened to be cached from an earlier visit. The cache only exists so
 *     a dropped connection shows the last-known answer instead of nothing.
 *     (An earlier version of this file served the cache first here — that
 *     meant a stale response, once cached, never updated until the network
 *     copy happened to be requested for some other reason. Network-first
 *     fixes that; VERSION is bumped so anyone who already has the old
 *     behavior installed drops its cache on next load.)
 *   - Store and news images: cache first. A picture does not change once
 *     published, so there is nothing to revalidate.
 *
 * Anything else falls through to the network untouched.
 */

const VERSION = 'v2';
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

/**
 * Prefers whatever the server says right now; only a genuinely broken
 * connection (offline, or slower than `ms`) falls back to the last answer.
 * The network request is never abandoned — a slow reply that arrives after
 * the timeout still updates the cache, so the next load is current even if
 * this one wasn't.
 */
async function networkFirstFast(request, cacheName, ms = 4000) {
  const network = fetch(request).then((response) => store(cacheName, request, response));
  const settled = await Promise.race([
    network.then((response) => ({ response })).catch((error) => ({ error })),
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), ms)),
  ]);

  if (settled.response) return settled.response;

  const cached = await caches.match(request);
  if (cached) return cached;
  if (settled.timedOut) return network; // No cache yet: worth the wait.
  throw settled.error ?? new Error('offline');
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
      event.respondWith(networkFirstFast(request, DATA));
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
