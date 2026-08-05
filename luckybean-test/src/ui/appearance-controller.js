const UI_KEY = 'luckybean.ui.v095';
const LEGACY_UI_KEY = 'luckybean.ui.v094';
const SPLASH = Object.freeze({
  red: './public/splash-art-red.webp?v=1.1.0-test',
  white: './public/splash-art-light.webp?v=1.1.0-test'
});
let renderQueued = false;

function safeParse(value) {
  try { return JSON.parse(value || '{}'); }
  catch { return {}; }
}

function readPreference() {
  return {
    theme: 'dark',
    splash: 'red',
    ...safeParse(localStorage.getItem(LEGACY_UI_KEY)),
    ...safeParse(localStorage.getItem(UI_KEY))
  };
}

function writePreference(next) {
  const normalized = {
    theme: next.theme === 'light' ? 'light' : 'dark',
    splash: next.splash === 'white' ? 'white' : 'red'
  };
  const value = JSON.stringify(normalized);
  try {
    localStorage.setItem(UI_KEY, value);
    localStorage.setItem(LEGACY_UI_KEY, value);
  } catch (error) {
    console.warn('外观偏好无法持久化，当前会话继续使用。', error);
  }
  return normalized;
}

function icon(theme) {
  return theme === 'dark'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15.2A8.5 8.5 0 0 1 8.8 3 8.5 8.5 0 1 0 21 15.2Z"/></svg>';
}

function applyTheme(theme = readPreference().theme) {
  const normalized = theme === 'light' ? 'light' : 'dark';
  const root = document.documentElement;
  root.dataset.theme = normalized;
  root.classList.toggle('theme-light', normalized === 'light');
  root.style.colorScheme = normalized;
  document.body?.classList.toggle('theme-light', normalized === 'light');
  const button = document.querySelector('#themeToggleBtn');
  if (button && button.dataset.appearanceTheme !== normalized) {
    button.innerHTML = icon(normalized);
    button.dataset.appearanceTheme = normalized;
    button.setAttribute('aria-label', normalized === 'dark' ? '切换到白色模式' : '切换到黑色模式');
    button.title = normalized === 'dark' ? '白色模式' : '黑色模式';
  }
  const settingButton = document.querySelector('[data-appearance-theme]');
  if (settingButton) settingButton.textContent = normalized === 'dark' ? '黑色模式' : '白色模式';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = normalized === 'dark' ? '#080909' : '#ececea';
}

function applySplash(splash = readPreference().splash) {
  const normalized = splash === 'white' ? 'white' : 'red';
  const image = document.querySelector('#splashImage');
  if (!image) return;
  const expected = SPLASH[normalized];
  if (!image.src.endsWith(expected.replace('./', '')) && image.getAttribute('src') !== expected) image.src = expected;
  image.alt = normalized === 'white' ? '富贵盒子白色启动画面' : '富贵盒子红色启动画面';
}

function toggleTheme() {
  const current = readPreference();
  current.theme = current.theme === 'light' ? 'dark' : 'light';
  const next = writePreference(current);
  applyTheme(next.theme);
  queueSettingsPanel();
}

function chooseSplash(value) {
  const current = readPreference();
  current.splash = value === 'white' ? 'white' : 'red';
  const next = writePreference(current);
  applySplash(next.splash);
  queueSettingsPanel();
}

function renderSettingsPanel() {
  renderQueued = false;
  const root = document.querySelector('#settingsContent .settings-categories');
  if (!root) return;
  root.querySelector('#appearanceSettings')?.remove();
  const pref = readPreference();
  const details = document.createElement('details');
  details.id = 'appearanceSettings';
  details.className = 'settings-category';
  details.innerHTML = `<summary><span>界面</span><small>显示模式与启动图</small></summary>
    <div class="settings-category-body">
      <div class="v095-setting-line"><span>显示模式</span><button class="button" type="button" data-appearance-theme>${pref.theme === 'dark' ? '黑色模式' : '白色模式'}</button></div>
      <div class="v095-splash-choice" role="radiogroup" aria-label="启动页图片">
        <button type="button" data-appearance-splash="red" class="${pref.splash === 'red' ? 'selected' : ''}"><img src="${SPLASH.red}" alt="红色启动页"><span>红色版本（默认）</span></button>
        <button type="button" data-appearance-splash="white" class="${pref.splash === 'white' ? 'selected' : ''}"><img src="${SPLASH.white}" alt="白色启动页"><span>白色版本</span></button>
      </div>
    </div>`;
  root.prepend(details);
  details.querySelector('[data-appearance-theme]')?.addEventListener('click', toggleTheme);
  details.querySelectorAll('[data-appearance-splash]').forEach(button => button.addEventListener('click', () => chooseSplash(button.dataset.appearanceSplash)));
}

function queueSettingsPanel() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(renderSettingsPanel);
}

function bind() {
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('#themeToggleBtn') : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    toggleTheme();
  }, true);
  const settingsRoot = document.querySelector('#settingsContent');
  if (settingsRoot) {
    new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && !node.matches?.('#appearanceSettings')))) queueSettingsPanel();
    }).observe(settingsRoot, { childList: true });
  }
  window.addEventListener('storage', () => {
    const pref = readPreference();
    applyTheme(pref.theme);
    applySplash(pref.splash);
    queueSettingsPanel();
  });
  applyTheme();
  applySplash();
  queueSettingsPanel();
}

bind();
globalThis.LuckyBeanAppearanceController = { readPreference, applyTheme, applySplash, toggleTheme, chooseSplash };
document.documentElement.dataset.appearanceController = 'ready';
