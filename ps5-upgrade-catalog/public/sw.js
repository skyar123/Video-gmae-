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
 *
 * This file also receives price-drop notifications. That has nothing to do
 * with caching, but a push can only be delivered to a service worker, so this
 * is where it has to live.
 */

// v4: cached API answers are stamped and expire, so the old unstamped
// entries have to go rather than being treated as fresh forever.
const VERSION = 'v4';
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

/**
 * Puts a copy away without letting a cache failure break the response.
 *
 * The copy is stamped with the time it was stored. A cached API response has
 * no expiry of its own, so without a stamp there is no way to tell last
 * minute's feed from last week's, and the fallback below needs to know.
 */
const store = (cacheName, request, response) => {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches
    .open(cacheName)
    .then(async (cache) => {
      const body = await copy.blob();
      const headers = new Headers(copy.headers);
      headers.set('x-sw-cached-at', String(Date.now()));
      await cache.put(
        request,
        new Response(body, { status: copy.status, statusText: copy.statusText, headers }),
      );
    })
    .catch(() => {});
  return response;
};

/** How old a cached API answer may be before it is not worth showing. */
const MAX_STALE_MS = 30 * 60 * 1000;

const cachedAge = (response) => {
  const at = Number(response?.headers?.get('x-sw-cached-at'));
  return Number.isFinite(at) && at > 0 ? Date.now() - at : Infinity;
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
async function networkFirstFast(request, cacheName, ms = 6000) {
  const network = fetch(request).then((response) => store(cacheName, request, response));
  const settled = await Promise.race([
    network.then((response) => ({ response })).catch((error) => ({ error })),
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), ms)),
  ]);

  if (settled.response) return settled.response;

  const cached = await caches.match(request);

  /*
   * Old enough and it is worth waiting instead.
   *
   * The fallback had no age limit, so a phone that timed out once could be
   * shown the feed from its previous visit, and if that visit was days ago
   * then days-old gossip is what it got, silently, with no way to tell. A
   * feed is only worth reading if it is roughly current, so past half an
   * hour the network is worth waiting for, and the cache is kept for the
   * case it was written for: actually being offline.
   */
  if (cached && (cachedAge(cached) < MAX_STALE_MS || !settled.timedOut)) return cached;
  if (settled.timedOut) return network;
  if (cached) return cached;
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


/**
 * A price drop, delivered while the app is closed.
 *
 * The payload is written by the nightly job. A push that arrives without one,
 * or with something unreadable in it, still has to show a notification: every
 * browser that supports push requires one, and staying silent here is what
 * gets a site's permission revoked.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'A game on your wishlist is cheaper';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || 'Open the catalog to see what dropped.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Tonight's drop replaces last night's rather than stacking up.
      tag: payload.tag || 'price-drop',
      data: { url: payload.url || '/?wishlist=1' },
    }),
  );
});

/**
 * Tapping the notification. Focuses the app if it is already open somewhere
 * rather than opening a second copy of it.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/?wishlist=1';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
