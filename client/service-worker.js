const CACHE_NAME = 'connect-cache-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/main.css',
  '/css/themes.css',
  '/css/animations.css',
  '/css/responsive.css',
  '/js/storage.js',
  '/js/profile.js',
  '/js/socket.js',
  '/js/webrtc.js',
  '/js/audio.js',
  '/js/gps.js',
  '/js/chat.js',
  '/js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Don't strictly fail install if assets are missing
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })))
        .catch(err => console.warn('[SW] Failed to cache some assets', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Ignore non-GET requests and external URLs
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Network-first strategy for index.html (always get latest HTML), Cache-first for assets
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/index.html').then(response => {
          if (response) {
            // Notify client they are offline
            self.clients.matchAll().then(clients => {
              clients.forEach(client => client.postMessage({ type: 'OFFLINE_STATE' }));
            });
            return response;
          }
        });
      })
    );
  } else {
    // Cache-first for JS/CSS/Images
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request).then((fetchRes) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, fetchRes.clone());
            return fetchRes;
          });
        });
      }).catch(() => {
        // Return a generic offline fallback if it's an image
        if (event.request.destination === 'image') {
          return new Response('<svg width="100" height="100"><text x="10" y="40">Offline</text></svg>', {
            headers: { 'Content-Type': 'image/svg+xml' }
          });
        }
      })
    );
  }
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: '/assets/icons/icon-192.png',
      badge: '/assets/icons/icon-72.png',
      data: { url: data.url || '/' },
      vibrate: [100, 50, 100]
    };
    event.waitUntil(self.registration.showNotification(data.title, options));
  } catch (e) {
    console.error('[SW] Push error:', e);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      const urlToOpen = new URL(event.notification.data.url, self.location.origin).href;
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
