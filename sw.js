// StarGaze SW v9 — network only, no caching
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Pass through to network, never cache
  return;
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        clients.openWindow('/');
      }
    }),
  );
});

// Schedule delayed notification via message from app
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SCHEDULE') {
    var delay = event.data.delay || 0; // ms
    var title = event.data.title || 'StarGaze';
    var body = event.data.body || '';
    setTimeout(function() {
      self.registration.showNotification(title, { body: body, tag: 'stargaze-reminder' });
    }, delay);
  }
});
