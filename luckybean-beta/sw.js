const CACHE_NAME = 'luckybean-v0.8.0-beta.1-dbfix1';
const CORE = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './src/app.js', './src/utils.js', './src/db.js', './src/codebook.js', './src/qr.js', './src/water-profiles.js', './src/preference-model.js', './src/share-codec.js', './src/brew-engine.js',
  './public/fallback-codebook.json', './public/legacy-flavor-map.json', './public/app-icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)); return response; }).catch(() => caches.match('./index.html')));
    return;
  }
  if (url.origin === self.location.origin) {
    // Beta 采用网络优先，避免同一版本号下的紧急修复继续被旧 JS 缓存覆盖；离线时再回退缓存。
    event.respondWith(fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); }
      return response;
    }).catch(() => caches.match(request)));
    return;
  }
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); return response; })));
  }
});
