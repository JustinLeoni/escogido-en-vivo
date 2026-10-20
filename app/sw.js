/* Service Worker — Escogido PWA v1 */
const VERSION = 'escogido-v8';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Estadísticas MLB: red primero, aunque conserve la última copia para el modo offline
  if (url.hostname === 'statsapi.mlb.com'){
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // mismo origen: network-first (stale al caer), imágenes/fuentes cache-first
  e.respondWith(
    (async () => {
      const hit = await caches.match(e.request);
      const isAsset = /\.(png|svg|woff2?|ico)$/i.test(url.pathname);
      try {
        const res = await fetch(e.request);
        if (res.ok){
          const clone = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, clone));
        }
        return res;
      } catch {
        return hit;
      }
    })()
  );
});
