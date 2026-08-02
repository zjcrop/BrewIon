import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('header controls are forced into one horizontal row', async () => {
  const css = await read('styles-theme-light.css');
  for (const marker of ['grid-template-columns: max-content max-content 22px !important','grid-auto-flow: column !important','gap: 2ch !important','flex-flow: row nowrap !important','width: max-content !important']) assert.ok(css.includes(marker), marker);
});

test('theme bridge intercepts dynamic buttons and delegates to native state', async () => {
  const bridge = await read('src/theme-bridge.js');
  for (const marker of ["document.addEventListener('click', handleThemeRequest, true)","target.closest('#themeToggleBtn, #v095ThemeSettingBtn')",'nativeButton.onclick.call(nativeButton, syntheticEvent())',"document.documentElement.dataset.themeBridge = 'ready'","window.addEventListener('pageshow', queueVisualSync)"]) assert.ok(bridge.includes(marker), marker);
});

test('light theme covers main pages, overlays, forms, navigation and tasting wizard', async () => {
  const css = await read('styles-theme-light.css');
  for (const marker of ['html[data-theme="light"] .bottom-nav','html[data-theme="light"] .v095-wizard-overlay','.settings-category-body','.sensory-evaluation','.professional-result','select option','.score-value-row > strong','.trajectory-chart text','.fab-wrap.action-grid .fab']) assert.ok(css.includes(marker), marker);
});

test('runtime entry and PWA cache include theme patch assets', async () => {
  const [html, sw] = await Promise.all([read('index.html'), read('sw.js')]);
  assert.match(html, /styles-theme-light\.css\?v=095b/);
  assert.match(html, /src\/theme-bridge\.js\?v=095b/);
  assert.match(sw, /luckybean-v0\.9\.6-ui-fix-i/);
  assert.match(sw, /styles-theme-light\.css/);
  assert.match(sw, /src\/theme-bridge\.js/);
});
