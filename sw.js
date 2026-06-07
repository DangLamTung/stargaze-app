self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

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

// Respond to PING from test-notifications.html
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'PING') {
    const port = event.ports[0];
    if (port) {
      port.postMessage({ pong: true, timestamp: Date.now(), version: '1.0' });
    }
  }
});
