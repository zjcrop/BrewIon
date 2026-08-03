/* Lucky Bean 099m: event-driven top-level settings accordion and data-module placement. */
if (!globalThis.__LuckyBeanV099mUiFixesLoaded) {
  globalThis.__LuckyBeanV099mUiFixesLoaded = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let syncTimers = [];

  function topLevelCategories() {
    return $$('#settingsContent > .settings-categories > details.settings-category');
  }

  function closeOtherCategories(current) {
    for (const item of topLevelCategories()) {
      if (item !== current && item.open) item.open = false;
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
    const world = $('[data-v099f-world]', modules);
    if (preference) preference.textContent = '风味喜好数字侧写';
    if (world) world.textContent = '咖啡世界';
    if (modules.parentElement !== body || modules !== body.lastElementChild) body.append(modules);
  }

  function renamePreferenceTitle() {
    const title = $('[data-overlay="v099f-preference"] h2');
    if (title && title.textContent !== '风味喜好数字侧写') title.textContent = '风味喜好数字侧写';
  }

  function syncSettingsOnce() {
    placeDataModules();
  }

  function scheduleSettingsSync() {
    syncTimers.forEach(clearTimeout);
    syncTimers = [0, 70, 180].map(delay => setTimeout(syncSettingsOnce, delay));
  }

  document.addEventListener('click', event => {
    const summary = event.target.closest?.('#settingsContent > .settings-categories > details.settings-category > summary');
    if (summary) {
      closeOtherCategories(summary.parentElement);
      return;
    }

    if (event.target.closest?.('[data-page-target="settings"]')) {
      scheduleSettingsSync();
      return;
    }

    if (event.target.closest?.('[data-v099f-preference]')) {
      [0, 80, 220].forEach(delay => setTimeout(renamePreferenceTitle, delay));
    }
  }, true);

  window.addEventListener('pageshow', () => {
    if ($('#pageSettings.active')) scheduleSettingsSync();
  });

  if ($('#pageSettings.active')) scheduleSettingsSync();
  globalThis.LuckyBeanV099mUiFixes = { closeOtherCategories, placeDataModules };
}
