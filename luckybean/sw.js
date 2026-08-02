// Release marker: luckybean-v0.9.8-main-098d
// Compatibility marker: luckybean-v0.9.8-feature-fix-b
// Compatibility marker: luckybean-v0.9.8-feature-fix-a
// Compatibility marker: luckybean-v0.9.6-ui-fix-i
const CACHE_NAME = 'luckybean-v0.9.8-main-098d';
const CORE = [
  './', './?v=098d', './index.html', './index.html?v=098d', './styles.css', './styles-v095.css', './styles-action-grid.css', './styles-theme-light.css', './styles-v095-refine.css', './styles-v096-recognition.css', './styles-qr-scan.css', './styles-v096-integrity.css', './styles-v097-fixes.css', './styles-v098-fixes.css', './styles-v098-trajectory-v17.css', './manifest.webmanifest', './manifest.webmanifest?v=098d',
  './src/app.js', './src/v096-web-ocr.js', './src/v096-package-capture.js', './src/v096-direct-camera.js', './src/v096-integrity-ui.js', './src/v097-ui-fixes.js', './src/v097-fab-gesture.js', './src/v098-trajectory-v17.js', './src/v098-selection-bridge.js', './src/v098-feature-fixes.js', './src/v098-group-menu-guard.js', './src/recognition-candidates.js', './src/sensory-codec-v096.js', './src/privacy-codec-v096.js', './src/image-quality.js', './src/recognition-bridge.js', './src/v095-sensory-bootstrap.js', './src/v095-ui.js', './src/theme-bridge.js', './src/v095-layout-gear.js', './src/v095-sensory-pro.js', './src/v095-sensory-flow-guard.js', './src/v095-postbrew-sensory.js', './src/v095-qr-ui.js', './src/utils.js', './src/brew-model-v09.js', './src/brew-trajectory-v096.js', './src/brew-optimizer-v097.js', './src/brew-engine-core.js', './src/brew-engine.js', './src/db-storage-core.js', './src/db.js', './src/codebook.js', './src/qr.js', './src/qr-core.js', './src/water-profiles.js', './src/preference-model.js', './src/share-codec-core.js', './src/share-codec.js',
  './public/fallback-codebook.json', './public/legacy-flavor-map.json', './public/app-logo.webp', './public/splash-red.jpg', './public/splash-white.jpg', './public/settings-mascot.png', './public/action-grid.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
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
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
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
