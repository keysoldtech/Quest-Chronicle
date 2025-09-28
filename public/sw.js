// This file is the Service Worker for the Quest & Chronicle Progressive Web App (PWA).
// It handles caching of assets for offline functionality and manages the update process
// to ensure users seamlessly receive new versions of the app.

const CACHE_NAME = 'quest-and-chronicle-v4.5.24-the-new-war-reborn';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/client.js',
  '/socket.io/socket.io.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=MedievalSharp&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200',
];

// Install event: triggered when the service worker is first registered.
// It opens the cache and adds all the core application files to it.
self.addEventListener('install', event => {
  console.log('[SW] Install event');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        // Force the waiting service worker to become the active service worker.
        return self.skipWaiting();
      })
  );
});

// Activate event: triggered after installation. This is the perfect place
// to clean up old caches from previous versions of the service worker.
self.addEventListener('activate', event => {
  console.log('[SW] Activate event');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // If a cache's name is different from our current cache name, delete it.
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
        // Take control of all open clients immediately.
        return self.clients.claim();
    })
  );
});

// Fetch event: triggered for every network request made by the page.
// This implements a "cache-first" strategy.
self.addEventListener('fetch', event => {
  // We only want to cache GET requests.
  if (event.request.method !== 'GET' || event.request.url.includes('/socket.io/')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // If the request is in the cache, return the cached response.
        if (response) {
          return response;
        }

        // If the request is not in the cache, fetch it from the network.
        return fetch(event.request).then(
          networkResponse => {
            // We don't cache opaque responses (like from Google Fonts CDN)
            // because we can't check their status. We just serve them directly.
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
               return networkResponse;
            }

            // IMPORTANT: Clone the response. A response is a stream
            // and because we want the browser to consume the response
            // as well as the cache consuming the response, we need
            // to clone it so we have two streams.
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                // Cache the new response for future use.
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          }
        ).catch(error => {
            console.error('[SW] Fetch failed; network error or offline.', error);
            // Optionally, return a fallback offline page here if you have one.
        });
      })
    );
});