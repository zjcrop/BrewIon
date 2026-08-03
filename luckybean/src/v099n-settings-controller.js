/* Lucky Bean 099o settings controller.
 * One event-driven folding model for every settings <details> element.
 * Observers only detect settings DOM replacement/category insertion; they never
 * react to open state, scroll position or input changes. Categories are never
 * moved after insertion, preventing browser scroll-anchor compensation.
 */
if (!globalThis.__LuckyBeanV099oSettingsControllerLoaded) {
  globalThis.__LuckyBeanV099oSettingsControllerLoaded = true;

  const ROOT_SELECTOR = '#settingsContent';
  const CATEGORY_SELECTOR = ':scope > .settings-categories > details.settings-category';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let activeKey = '';
  let mountedContainer = null;
  let rootObserver = null;
  let categoryObserver = null;
  let mountFrame = 0;
  let normalizing = false;

  function categoryKey(details) {
    if (!details) return '';
    if (details.id === 'v095AppearanceSettings') return 'appearance';
    if (details.id === 'privateGearCategory') return 'gear';
    if (details.id === 'v099iVoiceSettings') return 'voice';
    if (details.classList.contains('data-category')) return 'data';
    const title = details.querySelector(':scope > summary span')?.textContent?.trim() || '';
    if (/账户|账号/.test(title)) return 'account';
    if (/私器/.test(title)) return 'gear';
    if (/语音/.test(title)) return 'voice';
    if (/数藏/.test(title)) return 'data';
    if (/本物|关于/.test(title)) return 'about';
    if (/界面|启动页/.test(title)) return 'appearance';
    return details.dataset.settingsKey || `other-${title || details.id || 'item'}`;
  }

  function topLevelCategories(root = $(ROOT_SELECTOR)) {
    return root ? $$(CATEGORY_SELECTOR, root) : [];
  }

  function syncExpandedState(details) {
    const summary = details.querySelector(':scope > summary');
    if (summary) summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');
  }

  function closeOtherTopLevel(current) {
    for (const item of topLevelCategories()) {
      if (item !== current && item.open) item.open = false;
    }
  }

  function bindCategory(details) {
    if (details.dataset.v099oBound === '1') return;
    details.dataset.v099oBound = '1';
    details.addEventListener('toggle', () => {
      syncExpandedState(details);
      const key = categoryKey(details);
      if (details.open) {
        activeKey = key;
        closeOtherTopLevel(details);
      } else if (activeKey === key) {
        activeKey = '';
      }
    });
    syncExpandedState(details);
  }

  function removeDuplicates(items) {
    const firstByKey = new Map();
    for (const item of items) {
      const key = categoryKey(item);
      item.dataset.settingsKey = key;
      if (!firstByKey.has(key)) firstByKey.set(key, item);
      else item.remove();
    }
    return [...firstByKey.values()];
  }

  function restoreOpenState(items, isNewContainer) {
    if (isNewContainer) {
      const desired = activeKey && items.some(item => categoryKey(item) === activeKey) ? activeKey : '';
      for (const item of items) {
        const shouldOpen = Boolean(desired) && categoryKey(item) === desired;
        if (item.open !== shouldOpen) item.open = shouldOpen;
        syncExpandedState(item);
      }
      if (!desired) activeKey = '';
      return;
    }

    if (activeKey) {
      for (const item of items) {
        const shouldOpen = categoryKey(item) === activeKey;
        if (item.open !== shouldOpen) item.open = shouldOpen;
        syncExpandedState(item);
      }
    } else {
      for (const item of items) syncExpandedState(item);
    }
  }

  function connectCategoryObserver(container) {
    if (container === mountedContainer) return false;
    categoryObserver?.disconnect();
    mountedContainer = container;
    categoryObserver = new MutationObserver(records => {
      if (normalizing) return;
      if (records.some(record => record.type === 'childList')) queueMount();
    });
    categoryObserver.observe(container, { childList: true });
    return true;
  }

  function mount() {
    mountFrame = 0;
    const root = $(ROOT_SELECTOR);
    const container = root?.querySelector(':scope > .settings-categories');
    if (!root || !container) return;

    const isNewContainer = connectCategoryObserver(container);
    normalizing = true;
    try {
      const items = removeDuplicates(topLevelCategories(root));
      for (const item of items) {
        const key = categoryKey(item);
        item.dataset.settingsKey = key;
        if (key === 'account') {
          const title = item.querySelector(':scope > summary span');
          if (title && title.textContent.trim() !== '账号') title.textContent = '账号';
        }
        bindCategory(item);
      }
      restoreOpenState(items, isNewContainer);
    } finally {
      normalizing = false;
    }

    document.dispatchEvent(new CustomEvent('luckybean:settings-mounted', {
      detail: { activeKey, categories: topLevelCategories(root).map(categoryKey) }
    }));
  }

  function queueMount() {
    if (mountFrame) return;
    mountFrame = requestAnimationFrame(mount);
  }

  function connectRootObserver() {
    const root = $(ROOT_SELECTOR);
    if (!root || rootObserver) return;
    rootObserver = new MutationObserver(records => {
      if (records.some(record => record.type === 'childList')) queueMount();
    });
    rootObserver.observe(root, { childList: true });
  }

  function setSettingsActive(active) {
    document.documentElement.classList.toggle('v099o-settings-active', Boolean(active));
  }

  document.addEventListener('click', event => {
    const summary = event.target.closest?.(`${ROOT_SELECTOR} details > summary`);
    if (!summary) return;
    if (event.target.closest('button,a,input,select,textarea') && event.target !== summary) return;

    const details = summary.parentElement;
    if (!(details instanceof HTMLDetailsElement)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const isTopLevel = details.parentElement?.classList.contains('settings-categories');
    const willOpen = !details.open;
    if (isTopLevel) {
      closeOtherTopLevel(details);
      details.open = willOpen;
      activeKey = willOpen ? categoryKey(details) : '';
    } else {
      details.open = willOpen;
    }
    syncExpandedState(details);
  }, true);

  document.addEventListener('click', event => {
    const nav = event.target.closest?.('[data-page-target]');
    if (!nav) return;
    const isSettings = nav.dataset.pageTarget === 'settings';
    setSettingsActive(isSettings);
    if (!isSettings) return;
    requestAnimationFrame(() => {
      connectRootObserver();
      queueMount();
    });
  }, true);

  window.addEventListener('pageshow', () => {
    setSettingsActive(Boolean($('#pageSettings.active')));
    connectRootObserver();
    queueMount();
  });

  setSettingsActive(Boolean($('#pageSettings.active')));
  connectRootObserver();
  queueMount();

  globalThis.LuckyBeanSettingsControllerV099o = {
    mount,
    closeAll() {
      activeKey = '';
      topLevelCategories().forEach(item => { item.open = false; syncExpandedState(item); });
    },
    get activeKey() { return activeKey; }
  };
}
