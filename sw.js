const CACHE_NAME = 'busbibliotheek-v179';
const PHOTO_CACHE_NAME = 'busbibliotheek-photos-v1';
const PHOTO_CACHE_MAX_ENTRIES = 32;
const PHOTO_CACHE_MAX_BYTES = 3 * 1024 * 1024;
const APP_SHELL_CACHE_KEY = '/index.html';
const CORE_ASSETS = [
  '/',
  APP_SHELL_CACHE_KEY,
  '/app.js?v=20261022-6',
  '/manifest.json',
  '/style.css?v=20261022-6',
  '/translations.js?v=20261022-6',
  '/site-config.js?v=20261018-13',
  '/media/icons/pwa-icon-192.png',
  '/media/icons/pwa-icon-512.png',
  '/media/icons/pwa-icon-maskable-512.png',
  '/media/icons/pwa-icon-180.png',
  '/media/icons/logo.png',
  '/media/icons/navicon.png',
  '/media/icons/navicon_green.png',
  '/media/icons/hansea.png',
  '/media/icons/favicon.ico'
];

function isHttpCacheRequest(requestOrUrl) {
  try {
    const requestUrl = requestOrUrl instanceof Request
      ? requestOrUrl.url
      : new URL(requestOrUrl, self.location.href).href;
    const protocol = new URL(requestUrl).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch (_) {
    return false;
  }
}

async function putInCache(requestOrUrl, response) {
  if (!isHttpCacheRequest(requestOrUrl)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(requestOrUrl, response);
}

function cacheInBackground(event, requestOrUrl, response) {
  if (!isHttpCacheRequest(requestOrUrl)) return;
  event.waitUntil(putInCache(requestOrUrl, response).catch(() => {}));
}

async function cacheVehiclePhoto(request, response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > PHOTO_CACHE_MAX_BYTES) return;
  if (!response.headers.get('content-type')?.startsWith('image/')) return;

  const cache = await caches.open(PHOTO_CACHE_NAME);
  await cache.put(request, response);
  const requests = await cache.keys();
  const excessCount = requests.length - PHOTO_CACHE_MAX_ENTRIES;
  if (excessCount > 0) {
    await Promise.all(requests.slice(0, excessCount).map((cachedRequest) => cache.delete(cachedRequest)));
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_ASSETS);
      await self.skipWaiting();
    })()
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (
            cacheName.startsWith('busbibliotheek-') &&
            cacheName !== CACHE_NAME &&
            cacheName !== PHOTO_CACHE_NAME
          ) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  const offlineTextResponse = new Response('Offline', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
  });

  if (url.searchParams.has('network-check')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(() => new Response(null, { status: 204, statusText: 'No Content' }))
        .catch(() => new Response(null, { status: 503, statusText: 'Offline' }))
    );
    return;
  }

  if (request.method !== 'GET') {
    return;
  }

  const isVehiclePhotoRequest =
    url.origin === self.location.origin &&
    (
      url.pathname.startsWith('/media/bus/') ||
      url.pathname.startsWith('/media/bus-optimized/')
    );

  if (isVehiclePhotoRequest) {
    event.respondWith(
      caches.open(PHOTO_CACHE_NAME).then(cache => cache.match(request)).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response && response.status === 200 && !request.headers.has('range')) {
            event.waitUntil(cacheVehiclePhoto(request, response.clone()).catch(() => {}));
          }
          return response;
        }).catch(() => offlineTextResponse);
      })
    );
    return;
  }

  // HTML navigation: network first with cached index fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(response => {
          const cloned = response.clone();
          cacheInBackground(event, APP_SHELL_CACHE_KEY, cloned);
          return response;
        })
        .catch(async () => {
          const cachedIndex = await caches.match(APP_SHELL_CACHE_KEY, { ignoreSearch: true });
          return cachedIndex || offlineTextResponse;
        })
    );
    return;
  }

  if (url.pathname.includes('/api')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() =>
        new Response(JSON.stringify({ error: 'Realtime tijdelijk niet beschikbaar' }), {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' }
        })
      )
    );
    return;
  }

  const isSameOriginStaticAsset =
    url.origin === self.location.origin &&
    !url.pathname.includes('/api') &&
    !url.pathname.startsWith('/media/');

  const matchLocalAsset = () =>
    caches.match(request).then(cached => {
      if (cached) return cached;
      const hasExplicitVersion = url.searchParams.has('v');
      if (isSameOriginStaticAsset && !hasExplicitVersion) {
        return caches.match(request, { ignoreSearch: true });
      }
      return undefined;
    });

  // External calls: network first, fallback to cache
  if (url.hostname !== self.location.hostname) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache successful responses
          if (response && response.status === 200) {
            const clonedResponse = response.clone();
            cacheInBackground(event, request, clonedResponse);
          }
          return response;
        })
        .catch(() => {
          // Fall back to cache if network fails
          return caches.match(request).then(cached => cached || offlineTextResponse);
        })
    );
  } else { // Static assets: stale-while-revalidate
    event.respondWith(
      matchLocalAsset().then(cached => {
        const networkFetch = fetch(request)
          .then(response => {
            if (response && response.status === 200) {
              const clone = response.clone();
              cacheInBackground(event, request, clone);
            }
            return response;
          })
          .catch(() => cached || offlineTextResponse);

        return cached || networkFetch;
      })
    );
  }
});
