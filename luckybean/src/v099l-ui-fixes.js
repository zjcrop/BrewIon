/* Lucky Bean 099n: data-module placement only. Settings folding is owned by v099n-settings-controller. */
if (!globalThis.__LuckyBeanV099nDataModulePlacementLoaded) {
  globalThis.__LuckyBeanV099nDataModulePlacementLoaded = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  let syncTimers = [];

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

  function schedulePlacement() {
    syncTimers.forEach(clearTimeout);
    syncTimers = [0, 70, 180].map(delay => setTimeout(placeDataModules, delay));
  }

  document.addEventListener('luckybean:settings-mounted', schedulePlacement);
  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-page-target="settings"]')) schedulePlacement();
    if (event.target.closest?.('[data-v099f-preference]')) {
      [0, 80, 220].forEach(delay => setTimeout(renamePreferenceTitle, delay));
    }
  }, true);
  window.addEventListener('pageshow', () => {
    if ($('#pageSettings.active')) schedulePlacement();
  });

  if ($('#pageSettings.active')) schedulePlacement();
  globalThis.LuckyBeanV099nDataModules = { place: placeDataModules };
}
