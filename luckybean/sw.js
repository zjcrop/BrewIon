// Release marker: luckybean-v0.9.8-main-098e
// Compatibility marker: luckybean-v0.9.8-main-098d
const CACHE_NAME = 'luckybean-v0.9.8-main-098e';
const RELEASE = '098e';
const CORE = [
  './', `./?v=${RELEASE}`, './index.html', `./index.html?v=${RELEASE}`,
  `./manifest.webmanifest?v=${RELEASE}`,
  `./styles.css?v=${RELEASE}`,
  `./styles-v095.css?v=${RELEASE}`,
  `./styles-action-grid.css?v=${RELEASE}`,
  `./styles-theme-light.css?v=${RELEASE}`,
  `./styles-v095-refine.css?v=${RELEASE}`,
  `./styles-v096-recognition.css?v=${RELEASE}`,
  `./styles-qr-scan.css?v=${RELEASE}`,
  `./styles-v096-integrity.css?v=${RELEASE}`,
  `./styles-v097-fixes.css?v=${RELEASE}`,
  `./styles-v098-fixes.css?v=${RELEASE}`,
  `./styles-v098-trajectory-v17.css?v=${RELEASE}`,
  `./src/app.js?v=${RELEASE}`,
  `./src/v096-web-ocr.js?v=${RELEASE}`,
  `./src/v096-package-capture.js?v=${RELEASE}`,
  `./src/v096-direct-camera.js?v=${RELEASE}`,
  `./src/v095-sensory-bootstrap.js?v=${RELEASE}`,
  `./src/v095-ui.js?v=${RELEASE}`,
  `./src/theme-bridge.js?v=${RELEASE}`,
  `./src/v095-layout-gear.js?v=${RELEASE}`,
  `./src/v095-sensory-flow-guard.js?v=${RELEASE}`,
  `./src/v095-postbrew-sensory.js?v=${RELEASE}`,
  `./src/v095-qr-ui.js?v=${RELEASE}`,
  `./src/v096-integrity-ui.js?v=${RELEASE}`,
  `./src/v097-ui-fixes.js?v=${RELEASE}`,
  `./src/v097-fab-gesture.js?v=${RELEASE}`,
  `./src/v098-trajectory-v17.js?v=${RELEASE}`,
  `./src/v098-selection-bridge.js?v=${RELEASE}`,
  `./src/v098-feature-fixes.js?v=${RELEASE}`,
  `./src/v098-group-menu-guard.js?v=${RELEASE}`,
  './src/recognition-candidates.js', './src/sensory-codec-v096.js', './src/privacy-codec-v096.js',
  './src/image-quality.js', './src/recognition-bridge.js', './src/utils.js', './src/brew-model-v09.js',
  './src/brew-trajectory-v096.js', './src/brew-optimizer-v097.js', './src/brew-engine-core.js',
  './src/brew-engine.js', './src/db-storage-core.js', './src/db.js', './src/codebook.js',
  './src/qr.js', './src/qr-core.js', './src/water-profiles.js', './src/preference-model.js',
  './src/share-codec-core.js', './src/share-codec.js',
  './public/fallback-codebook.json', './public/legacy-flavor-map.json',
  `./public/app-logo.webp?v=${RELEASE}`, `./public/splash-red.jpg?v=${RELEASE}`,
  './public/splash-white.jpg', './public/settings-mascot.png', './public/action-grid.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(new Request(request, { cache: 'reload' }))
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(new Request(request, { cache: 'reload' }))
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      }))
    );
  }
});
