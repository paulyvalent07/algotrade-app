// Cache minimal de la coquille de l'app ; les données (GitHub) passent toujours par le réseau.
const CACHE = 'algotrade-shell-v17';
const SHELL = ['./', 'index.html', 'core.js', 'charts.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});

/* Notifications push : le serveur d'envoi (GitHub Actions) envoie {title, body, tag}. */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = {body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'AlgoTrade', {body: d.body || '', tag: d.tag, icon: 'icon-192.png', badge: 'icon-192.png', data: {url: d.url || './'}}));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(cs => {
    const url = (e.notification.data && e.notification.data.url) || './';
    const tab = (url.split('#')[1] || '');
    for (const c of cs) if ('focus' in c) { c.postMessage({goto: tab}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
