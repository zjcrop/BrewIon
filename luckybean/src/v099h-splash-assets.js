const RELEASE = '099h';
const UI_KEY = 'luckybean.ui.v095';
const LEGACY_UI_KEY = 'luckybean.ui.v094';
const SPLASH_ASSETS = Object.freeze({
  red: `./public/splash-art-red.webp?v=${RELEASE}`,
  white: `./public/splash-art-light.webp?v=${RELEASE}`
});

if (!globalThis.__LuckyBeanV099hSplashAssetsLoaded) {
  globalThis.__LuckyBeanV099hSplashAssetsLoaded = true;

  const nativeSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  const nativeSetAttribute = Element.prototype.setAttribute;
  let syncQueued = false;

  function safeParse(value) {
    try { return JSON.parse(value || '{}'); } catch { return {}; }
  }

  function selectedVariant() {
    const value = {
      splash: 'red',
      ...safeParse(localStorage.getItem(LEGACY_UI_KEY)),
      ...safeParse(localStorage.getItem(UI_KEY))
    };
    return value.splash === 'white' ? 'white' : 'red';
  }

  function remapSplashUrl(value) {
    const text = String(value || '');
    if (/splash-red\.jpg(?:[?#].*)?$/i.test(text)) return SPLASH_ASSETS.red;
    if (/splash-white\.jpg(?:[?#].*)?$/i.test(text)) return SPLASH_ASSETS.white;
    return value;
  }

  if (nativeSrc?.get && nativeSrc?.set && !HTMLImageElement.prototype.__luckyBean099hSrcPatched) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: nativeSrc.configurable,
      enumerable: nativeSrc.enumerable,
      get: nativeSrc.get,
      set(value) { nativeSrc.set.call(this, remapSplashUrl(value)); }
    });
    Object.defineProperty(HTMLImageElement.prototype, '__luckyBean099hSrcPatched', { value: true });
  }

  if (!Element.prototype.__luckyBean099hSetAttributePatched) {
    Element.prototype.setAttribute = function patchedSetAttribute(name, value) {
      if (this instanceof HTMLImageElement && String(name).toLowerCase() === 'src') {
        return nativeSetAttribute.call(this, name, remapSplashUrl(value));
      }
      return nativeSetAttribute.call(this, name, value);
    };
    Object.defineProperty(Element.prototype, '__luckyBean099hSetAttributePatched', { value: true });
  }

  function setImage(image, variant, alt) {
    if (!image) return;
    const target = SPLASH_ASSETS[variant];
    if (!String(image.getAttribute('src') || '').includes(target.split('?')[0])) image.setAttribute('src', target);
    image.setAttribute('alt', alt);
    image.dataset.splashAsset = variant;
  }

  function syncSplashAssets() {
    syncQueued = false;
    const variant = selectedVariant();
    const screen = document.querySelector('#splashScreen');
    if (screen) screen.dataset.splashVariant = variant;
    setImage(
      document.querySelector('#splashImage') || document.querySelector('#splashScreen img'),
      variant,
      variant === 'white' ? '富贵盒子浅色启动画面' : '富贵盒子红色启动画面'
    );

    const redButton = document.querySelector('[data-splash-choice="red"]');
    const whiteButton = document.querySelector('[data-splash-choice="white"]');
    if (redButton) {
      redButton.dataset.splashVariant = 'red';
      setImage(redButton.querySelector('img'), 'red', '红色启动页预览');
    }
    if (whiteButton) {
      whiteButton.dataset.splashVariant = 'white';
      setImage(whiteButton.querySelector('img'), 'white', '浅色启动页预览');
    }
  }

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(syncSplashAssets);
  }

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-splash-choice]')) setTimeout(queueSync, 0);
  }, true);
  window.addEventListener('storage', queueSync);
  window.addEventListener('pageshow', queueSync);
  new MutationObserver(records => {
    if (records.every(record => record.target instanceof HTMLImageElement && record.target.dataset.splashAsset)) return;
    queueSync();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  syncSplashAssets();
  globalThis.LuckyBeanSplashAssetsV099h = { assets: SPLASH_ASSETS, sync: syncSplashAssets };
}
