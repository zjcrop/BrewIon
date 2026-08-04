// Consolidated release: 1.0.7-consolidated-test
const CACHE_NAME = 'luckybean-1.0.7-consolidated-test';
const RELEASE = '1.0.7-consolidated-test';
const CORE = [
  "./",
  "./?v=1.0.7-consolidated-test",
  "./index.html",
  "./index.html?v=1.0.7-consolidated-test",
  "./manifest.webmanifest?v=1.0.7-consolidated-test",
  "./styles.css?v=1.0.7-consolidated-test",
  "./src/v099j-runtime-stability.js?v=1.0.7-consolidated-test",
  "./src/app.js?v=1.0.7-consolidated-test",
  "./src/v099h-splash-assets.js?v=1.0.7-consolidated-test",
  "./src/v099i-migrations.js?v=1.0.7-consolidated-test",
  "./src/v096-web-ocr.js?v=1.0.7-consolidated-test",
  "./src/v099g-paddle-ocr.js?v=1.0.7-consolidated-test",
  "./src/v099d-ocr-quality.js?v=1.0.7-consolidated-test",
  "./src/v096-package-capture.js?v=1.0.7-consolidated-test",
  "./src/v096-direct-camera.js?v=1.0.7-consolidated-test",
  "./src/v095-ui.js?v=1.0.7-consolidated-test",
  "./src/theme-bridge.js?v=1.0.7-consolidated-test",
  "./src/v095-postbrew-sensory.js?v=1.0.7-consolidated-test",
  "./src/v095-qr-ui.js?v=1.0.7-consolidated-test",
  "./src/v096-integrity-ui.js?v=1.0.7-consolidated-test",
  "./src/v097-ui-fixes.js?v=1.0.7-consolidated-test",
  "./src/v097-fab-gesture.js?v=1.0.7-consolidated-test",
  "./src/v099-trajectory-signal-bridge.js?v=1.0.7-consolidated-test",
  "./src/v099i-trajectory-space.js?v=1.0.7-consolidated-test",
  "./src/v098-selection-bridge.js?v=1.0.7-consolidated-test",
  "./src/v098-feature-fixes.js?v=1.0.7-consolidated-test",
  "./src/v099-runtime.js?v=1.0.7-consolidated-test",
  "./src/v099d-radar-scroll.js?v=1.0.7-consolidated-test",
  "./src/v099d-supabase-auth.js?v=1.0.7-consolidated-test",
  "./src/v099f-cloud-sync.js?v=1.0.7-consolidated-test",
  "./src/v099t-bean-groups.js?v=1.0.7-consolidated-test",
  "./src/v099m-group-controller.js?v=1.0.7-consolidated-test",
  "./src/v099f-ui-upgrade.js?v=1.0.7-consolidated-test",
  "./src/v099g-world-map.js?v=1.0.7-consolidated-test",
  "./src/v099p-settings-rebuild.js?v=1.0.7-consolidated-test",
  "./src/utils.js?v=1.0.7-consolidated-test",
  "./src/db-storage-core.js?v=1.0.7-consolidated-test",
  "./src/db.js?v=1.0.7-consolidated-test",
  "./src/codebook.js?v=1.0.7-consolidated-test",
  "./src/qr.js?v=1.0.7-consolidated-test",
  "./src/qr-core.js?v=1.0.7-consolidated-test",
  "./src/brew-engine.js?v=1.0.7-consolidated-test",
  "./src/brew-engine-core.js?v=1.0.7-consolidated-test",
  "./src/brew-model-v09.js?v=1.0.7-consolidated-test",
  "./src/brew-trajectory-v096.js?v=1.0.7-consolidated-test",
  "./src/brew-optimizer-v097.js?v=1.0.7-consolidated-test",
  "./src/v106-native-backup.js?v=1.0.7-consolidated-test",
  "./src/v106-brew-profile-service.js?v=1.0.7-consolidated-test",
  "./src/water-profiles.js?v=1.0.7-consolidated-test",
  "./src/preference-model.js?v=1.0.7-consolidated-test",
  "./src/share-codec.js?v=1.0.7-consolidated-test",
  "./src/share-codec-core.js?v=1.0.7-consolidated-test",
  "./src/v095-sensory-pro.js?v=1.0.7-consolidated-test",
  "./src/v099f-cloud-codec.js?v=1.0.7-consolidated-test",
  "./src/privacy-codec-v096.js?v=1.0.7-consolidated-test",
  "./src/recognition-candidates.js?v=1.0.7-consolidated-test",
  "./src/sensory-codec-v096.js?v=1.0.7-consolidated-test",
  "./src/image-quality.js?v=1.0.7-consolidated-test",
  "./src/recognition-bridge.js?v=1.0.7-consolidated-test",
  "./public/fallback-codebook.json",
  "./public/legacy-flavor-map.json",
  "./public/app-logo.webp?v=1.0.7-consolidated-test",
  "./public/splash-art-red.webp?v=1.0.7-consolidated-test",
  "./public/splash-art-light.webp?v=1.0.7-consolidated-test",
  "./public/settings-mascot.webp?v=1.0.7-consolidated-test",
  "./public/action-grid.svg"
];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
function legacySplashUrl(url) {
  if (url.pathname.endsWith('/public/splash-red.jpg')) return new URL(`./public/splash-art-red.webp?v=${RELEASE}`, self.registration.scope);
  if (url.pathname.endsWith('/public/splash-white.jpg')) return new URL(`./public/splash-art-light.webp?v=${RELEASE}`, self.registration.scope);
  return null;
}
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
    const replacement = legacySplashUrl(url);
    if (replacement) { event.respondWith(caches.match(replacement.href).then(cached => cached || fetch(replacement.href))); return; }
    event.respondWith(fetch(new Request(request, { cache: 'reload' })).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request)));
    return;
  }
  if (url.hostname === 'cdn.jsdelivr.net') event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => { caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone())); return response; })));
});
