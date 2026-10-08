importScripts('version.js');
const CACHE = 'sa3et-kora-' + self.APP_VERSION;
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'core.js', 'admin.js', 'session.js', 'stats.js', 'i18n.js', 'firebase-config.js', 'manifest.json', 'version.js', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// شبكة أولاً ثم الكاش (عشان التحديثات توصل فوراً) — لملفات التطبيق فقط
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    fetch(r).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(r, copy));
      return res;
    }).catch(() => caches.match(r).then(m => m || caches.match('index.html')))
  );
});
