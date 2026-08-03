import { getSetting } from './db.js';

if (!globalThis.__LuckyBeanV099mGroupControllerLoaded) {
  globalThis.__LuckyBeanV099mGroupControllerLoaded = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let nativePassThrough = false;
  let opening = false;

  function closeMenus() {
    $$('.popup-menu,.recommend-menu').forEach(node => node.remove());
  }

  function position(anchor, popup) {
    const rect = anchor.getBoundingClientRect();
    popup.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
    popup.style.top = `${rect.bottom + 6}px`;
  }

  async function currentState() {
    const [appSettings, ratioMode] = await Promise.all([
      getSetting('app.settings', {}),
      getSetting('v099i.group.mode', 'native')
    ]);
    const legacyMode = localStorage.getItem('luckybean.group.method.v098') || '';
    return {
      native: appSettings?.groupMethod || 'country',
      freshness: ratioMode === 'freshness-ratio',
      remaining: ratioMode !== 'freshness-ratio' && legacyMode === 'remaining-50'
    };
  }

  async function openMenu(anchor) {
    if (opening) return;
    opening = true;
    try {
      closeMenus();
      const state = await currentState();
      if (!anchor.isConnected) return;
      const popup = document.createElement('div');
      popup.className = 'popup-menu v099m-group-menu';
      const nativeOptions = [
        ['country', '按国家'],
        ['variety', '按豆种'],
        ['roast', '按烘焙度'],
        ['process', '按处理工法']
      ];
      popup.innerHTML = `${nativeOptions.map(([value, label]) =>
        `<button type="button" data-group-method="${value}">${label}${!state.freshness && !state.remaining && state.native === value ? ' ✓' : ''}</button>`
      ).join('')}
        <button type="button" data-v099f-group-freshness="1" data-v099i-group-freshness="1">按赏味期阶段${state.freshness ? ' ✓' : ''}</button>
        <button type="button" data-v098-group-method="remaining-50">按余量（每50g）${state.remaining ? ' ✓' : ''}</button>`;
      document.body.append(popup);
      position(anchor, popup);

      popup.addEventListener('click', event => {
        const native = event.target.closest('[data-group-method]');
        if (!native) return;
        event.preventDefault();
        event.stopPropagation();
        const value = native.dataset.groupMethod;
        popup.remove();

        // Return native choices to the main application so its in-memory state,
        // IndexedDB settings and bean rendering remain the single source of truth.
        nativePassThrough = true;
        anchor.click();
        nativePassThrough = false;
        requestAnimationFrame(() => {
          const generated = $(`.popup-menu [data-group-method="${CSS.escape(value)}"]`);
          generated?.click();
        });
      });
    } finally {
      opening = false;
    }
  }

  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('#groupBtn');
    if (!anchor || nativePassThrough) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openMenu(anchor).catch(error => console.error('分组菜单打开失败', error));
  }, true);

  globalThis.LuckyBeanGroupControllerV099m = { open: openMenu, close: closeMenus };
}
