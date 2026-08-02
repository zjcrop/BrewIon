import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('current v0.9.6 release retains v0.9.5 runtime entry', async () => {
  const [html, pkg, utils, sw, manifest] = await Promise.all([
    read('index.html'), read('package.json'), read('src/utils.js'), read('sw.js'), read('manifest.webmanifest')
  ]);
  assert.match(html, /styles-v095\.css\?v=095/);
  assert.match(html, /src\/v095-ui\.js\?v=095/);
  assert.match(html, /splash-red\.jpg\?v=095/);
  assert.equal(JSON.parse(pkg).version, '0.9.6');
  assert.match(utils, /APP_VERSION = '0\.9\.6'/);
  assert.match(sw, /luckybean-v0\.9\.6/);
  assert.equal(JSON.parse(manifest).name, '富贵盒子 0.9.6');
});

test('v0.9.5 requested modes, labels and artwork exist', async () => {
  const ui = await read('src/v095-ui.js');
  for (const marker of [
    '雷达图 / 互动品鉴 / 札记', '品鉴全流程',
    '互动品鉴 / 札记', '仅作分段互动 / 札记 / 打分',
    '仅作札记 / 打分', 'settings-mascot.png',
    'splash-white.jpg', '移至溯旧', '干香', '高温', '中温', '低温'
  ]) assert.ok(ui.includes(marker), marker);
});

test('sensory modes preserve interaction and only note mode skips nodes', async () => {
  const ui = await read('src/v095-ui.js');
  assert.match(ui, /function openSegmentedWizard/);
  assert.match(ui, /async function skipNativeToNote/);
  assert.match(ui, /function attachNativeSummary/);
  assert.match(ui, /function bindRadarDragging/);
  assert.doesNotMatch(ui, /advanceNativeToScore/);
});

test('v0.9.5 layout and theme selectors exist', async () => {
  const css = await read('styles-v095.css');
  for (const marker of ['gap: 2ch', 'four-source', 'two-source', 'v095-detail-actions', 'v095-settings-mascot', 'v095-radar-handle']) {
    assert.ok(css.includes(marker), marker);
  }
});

test('header controls remain horizontal and theme binding is stable', async () => {
  const [css, ui] = await Promise.all([read('styles-v095.css'), read('src/v095-ui.js')]);
  for (const marker of ['flex-flow: row nowrap !important', 'width: auto !important', 'gap: 2ch !important']) {
    assert.ok(css.includes(marker), marker);
  }
  assert.match(ui, /button\.onclick = event =>/);
  assert.match(ui, /button\.dataset\.v095ThemeIcon !== ui\.theme/);
  assert.match(ui, /界面偏好无法写入本地存储/);
});