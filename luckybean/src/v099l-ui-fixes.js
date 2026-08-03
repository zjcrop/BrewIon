/* Lucky Bean 099l: top-level settings accordion and data-module placement. */
if (!globalThis.__LuckyBeanV099lUiFixesLoaded) {
  globalThis.__LuckyBeanV099lUiFixesLoaded = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let rootObserver = null;
  let observedRoot = null;
  let queued = false;

  function topLevelCategories(root = $('#settingsContent')) {
    return root ? $$(':scope > .settings-categories > details.settings-category', root) : [];
  }

  function closeOtherCategories(current) {
    if (!current) return;
    for (const item of topLevelCategories()) {
      if (item !== current && item.open) item.open = false;
    }
  }

  function bindExclusiveAccordion() {
    for (const item of topLevelCategories()) {
      if (item.dataset.v099lAccordionBound === '1') continue;
      item.dataset.v099lAccordionBound = '1';
      item.addEventListener('toggle', () => {
        if (item.open) closeOtherCategories(item);
      });
    }
  }

  function dataCategoryBody() {
    return $('#settingsContent > .settings-categories > details.settings-category.data-category > .settings-category-body');
  }

  function placeDataModules() {
    const body = dataCategoryBody();
    if (!body) return;
    let modules = $('#v099fBeanModules');
    if (!modules) {
      modules = document.createElement('section');
      modules.id = 'v099fBeanModules';
      modules.className = 'v099f-bean-modules v099l-data-modules';
      modules.innerHTML = '<button type="button" data-v099f-preference>风味喜好数字侧写</button><button type="button" data-v099f-world>咖啡世界</button>';
    }
    modules.classList.add('v099l-data-modules');
    const preference = $('[data-v099f-preference]', modules);
    if (preference) preference.textContent = '风味喜好数字侧写';
    const world = $('[data-v099f-world]', modules);
    if (world) world.textContent = '咖啡世界';
    if (modules.parentElement !== body || modules !== body.lastElementChild) body.append(modules);
  }

  function cleanLegacyFreshnessButtons() {
    $$('.popup-menu [data-v098-group-method="freshness-state"]').forEach(button => button.remove());
    $$('.popup-menu button').forEach(button => {
      if (button.textContent.replace(/\s*✓\s*$/, '').trim() === '按赏味期状态') button.remove();
    });
    const stageButtons = $$('.popup-menu [data-v099f-group-freshness],.popup-menu [data-v099i-group-freshness]');
    stageButtons.forEach((button, index) => {
      if (index) button.remove();
      else button.textContent = `按赏味期阶段${button.textContent.includes('✓') ? ' ✓' : ''}`;
    });
  }

  function sync() {
    queued = false;
    bindExclusiveAccordion();
    placeDataModules();
    cleanLegacyFreshnessButtons();
  }

  function queueSync() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }

  function observeSettings() {
    const root = $('#settingsContent');
    if (!root || root === observedRoot) return;
    rootObserver?.disconnect();
    observedRoot = root;
    rootObserver = new MutationObserver(queueSync);
    rootObserver.observe(root, { childList: true, subtree: true });
  }

  document.addEventListener('click', event => {
    const summary = event.target.closest?.('#settingsContent > .settings-categories > details.settings-category > summary');
    if (summary) closeOtherCategories(summary.parentElement);
    if (event.target.closest?.('[data-page-target="settings"],#groupBtn')) setTimeout(() => {
      observeSettings();
      queueSync();
    }, 0);
  }, true);

  addEventListener('pageshow', () => {
    observeSettings();
    queueSync();
  });

  observeSettings();
  queueSync();
  globalThis.LuckyBeanV099lUiFixes = { sync, closeOtherCategories, placeDataModules };
}
