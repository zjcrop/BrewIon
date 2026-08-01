const UI_KEY = 'luckybean.ui.v095';
const LEGACY_UI_KEY = 'luckybean.ui.v094';

function safeParse(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function readUi() {
  return {
    theme: 'dark',
    splash: 'red',
    ...safeParse(localStorage.getItem(LEGACY_UI_KEY)),
    ...safeParse(localStorage.getItem(UI_KEY))
  };
}

function writeUi(next) {
  const value = JSON.stringify(next);
  try {
    localStorage.setItem(UI_KEY, value);
    localStorage.setItem(LEGACY_UI_KEY, value);
  } catch (error) {
    console.warn('主题偏好无法写入本地存储，当前会话仍继续生效。', error);
  }
}

function sunIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg>';
}

function moonIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15.2A8.5 8.5 0 0 1 8.8 3 8.5 8.5 0 1 0 21 15.2Z"/></svg>';
}

function applyVisualState(theme = readUi().theme) {
  const normalized = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = normalized;
  document.documentElement.classList.toggle('theme-light', normalized === 'light');
  document.documentElement.style.colorScheme = normalized;
  document.body?.classList.toggle('theme-light', normalized === 'light');

  const button = document.getElementById('themeToggleBtn');
  if (button) {
    if (button.dataset.themeBridgeIcon !== normalized) {
      button.innerHTML = normalized === 'dark' ? sunIcon() : moonIcon();
      button.dataset.themeBridgeIcon = normalized;
    }
    button.setAttribute('aria-label', normalized === 'dark' ? '切换到白色模式' : '切换到黑色模式');
    button.title = normalized === 'dark' ? '白色模式' : '黑色模式';
  }

  const settingsButton = document.getElementById('v095ThemeSettingBtn');
  if (settingsButton) settingsButton.textContent = normalized === 'dark' ? '黑色模式' : '白色模式';

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = normalized === 'dark' ? '#080909' : '#ececea';
}

function syntheticEvent() {
  return {
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  };
}

function invokeNativeToggle() {
  const nativeButton = document.getElementById('themeToggleBtn');
  if (nativeButton && typeof nativeButton.onclick === 'function') {
    nativeButton.onclick.call(nativeButton, syntheticEvent());
    return true;
  }
  return false;
}

function fallbackToggle() {
  const current = readUi();
  current.theme = current.theme === 'light' ? 'dark' : 'light';
  writeUi(current);
  applyVisualState(current.theme);
}

function handleThemeRequest(event) {
  const target = event.target instanceof Element
    ? event.target.closest('#themeToggleBtn, #v095ThemeSettingBtn')
    : null;
  if (!target) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (!invokeNativeToggle()) fallbackToggle();
  requestAnimationFrame(() => applyVisualState(document.documentElement.dataset.theme || readUi().theme));
}

document.addEventListener('click', handleThemeRequest, true);
document.addEventListener('keydown', event => {
  const target = event.target instanceof Element
    ? event.target.closest('#themeToggleBtn, #v095ThemeSettingBtn')
    : null;
  if (!target || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  target.click();
}, true);

let syncScheduled = false;
function queueVisualSync() {
  if (syncScheduled) return;
  syncScheduled = true;
  requestAnimationFrame(() => {
    syncScheduled = false;
    applyVisualState(document.documentElement.dataset.theme || readUi().theme);
  });
}

new MutationObserver(queueVisualSync).observe(document.documentElement, {
  childList: true,
  subtree: true
});
window.addEventListener('pageshow', queueVisualSync);
window.addEventListener('storage', queueVisualSync);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) queueVisualSync();
});

applyVisualState(readUi().theme);
document.documentElement.dataset.themeBridge = 'ready';
