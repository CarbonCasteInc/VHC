self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    const title = '[VHC A6] Pager wakeup';
    const options = {
      body: 'Open the VHC pager for the public-safe incident case file.',
      data: { url: '/' },
      tag: 'vhc-a6-pager',
      renotify: true,
      requireInteraction: true,
    };
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url ?? '/'));
});
