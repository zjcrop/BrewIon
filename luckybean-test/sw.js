// LuckyBean local-first sync test release: 1.2.0-test
const CACHE_PREFIX = 'luckybean-v120-test-';
const CACHE_NAME = `${CACHE_PREFIX}1.2.0-test`;
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest?v=1.2.0-test',
  './styles.css?v=1.2.0-test',
  './src/app.js?v=1.2.0-test',
  './src/core/startup-controller.js?v=1.2.0-test',
  './src/core/bootstrap.js?v=1.2.0-test',
  './src/services/cloud-auth-service.js?v=1.2.0-test',
  './src/services/cloud-sync-service.js?v=1.2.0-test',
  './src/cloud-codec.js?v=1.2.0-test',
  './src/services/brew-analysis-service.js?v=1.2.0-test',
  './src/services/local-reference-analysis.js?v=1.2.0-test',
  './src/services/provider-package-service.js?v=1.2.0-test',
  './src/services/codebook-reconciliation-service.js?v=1.2.0-test',
  './src/services/provider-bootstrap-controller.js?v=1.2.0-test',
  './src/ui/provider-status-panel.js?v=1.2.0-test',
  './src/ui/codebook-reconciliation-screen.js?v=1.2.0-test',
  './src/ui/codebook-reconciliation-screen.css?v=1.2.0-test',
  './src/domain/history/history-service.js?v=1.2.0-test',
  './src/domain/history/history-comparison.js?v=1.2.0-test',
  './src/ui/brew-trend-panel.js?v=1.2.0-test',
  './src/ui/brew-trend-panel.css?v=1.2.0-test',
  './src/domain/history/history-migration.js?v=1.2.0-test',
  './src/ui/history/history-screen.js?v=1.2.0-test',
  './src/ui/history/history-screen.css?v=1.2.0-test',
  './src/renderers/brew-spatial-view.js?v=1.2.0-test',
  './src/renderers/brew-spatial-controller.js?v=1.2.0-test',
  './src/renderers/brew-spatial-view.css?v=1.2.0-test',
  './src/ui/account-sync-panel.js?v=1.2.0-test',
  './src/ui/appearance-controller.js?v=1.2.0-test',
  './src/ui/fab-controller.js?v=1.2.0-test',
  './src/features/runtime-features.js?v=1.2.0-test',
  './src/data-migrations.js?v=1.2.0-test',
  './src/recognition-web-ocr.js?v=1.2.0-test',
  './src/recognition-paddle-ocr.js?v=1.2.0-test',
  './src/recognition-quality-controller.js?v=1.2.0-test',
  './src/package-capture-controller.js?v=1.2.0-test',
  './src/direct-camera-controller.js?v=1.2.0-test',
  './src/postbrew-sensory-controller.js?v=1.2.0-test',
  './src/qr-ui-controller.js?v=1.2.0-test',
  './src/integrity-ui-controller.js?v=1.2.0-test',
  './src/ui-layout-controller.js?v=1.2.0-test',
  './src/selection-controller.js?v=1.2.0-test',
  './src/feature-controller.js?v=1.2.0-test',
  './src/runtime-controller.js?v=1.2.0-test',
  './src/bean-groups-controller.js?v=1.2.0-test',
  './src/group-interaction-controller.js?v=1.2.0-test',
  './src/ui-upgrade-controller.js?v=1.2.0-test',
  './src/origin-map-controller.js?v=1.2.0-test',
  './src/settings-screen-controller.js?v=1.2.0-test',

  './public/app-logo.webp?v=1.2.0-test',
  './public/splash-art-red.webp?v=1.2.0-test',
  './public/splash-art-light.webp?v=1.2.0-test',
  './public/fallback-codebook.json',
  './public/legacy-flavor-map.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
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
    event.respondWith(fetch(new Request(request, { cache: 'reload' })).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put('./index.html', response.clone()));
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(fetch(new Request(request, { cache: 'reload' })).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request)));
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    })));
  }
});
