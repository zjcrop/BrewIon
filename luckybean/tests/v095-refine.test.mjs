import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('refinement runtime files are loaded in deterministic order and cached', async () => {
  const [html, sw, bootstrap] = await Promise.all([read('index.html'), read('sw.js'), read('src/v095-sensory-bootstrap.js')]);
  const bootstrapIndex = html.indexOf('src/v095-sensory-bootstrap.js?v=095f');
  const legacyUiIndex = html.indexOf('src/v095-ui.js?v=095e');
  assert.ok(bootstrapIndex >= 0, 'sensory bootstrap missing');
  assert.ok(legacyUiIndex > bootstrapIndex, 'sensory bootstrap must load before legacy UI');
  assert.ok(!html.includes('src/v095-sensory-pro.js?v=095c'), 'old direct sensory module entry must be removed');
  assert.match(sw, /luckybean-v0\.9\.6-ui-fix-i/);
  for (const marker of ['./styles-v095-refine.css','./src/v095-sensory-bootstrap.js','./src/v095-sensory-pro.js','./src/v095-sensory-flow-guard.js']) assert.ok(sw.includes(marker), marker);
  for (const marker of ['loading-professional-v2','专业品鉴','玩家互动品鉴','札记','sensoryModesReady','safe-null-root']) assert.ok(bootstrap.includes(marker), marker);
});

test('light mode covers seals, groups, leaderboard and collapse row', async () => {
  const css = await read('styles-v095-refine.css');
  for (const marker of ['html[data-theme="light"] .page-seal','color: #fff !important','.group-card','.active-group-panel','.group-collapse','.preference-board-line','.recommendation-board button','.overlay[data-overlay="recommendation-board"] .dialog']) assert.ok(css.includes(marker), marker);
});

test('remaining recommendation, manage menu and structured grinder range are implemented', async () => {
  const layout = await read('src/v095-layout-gear.js');
  for (const marker of ["value.replaceAll('拾余', '余量')","dot.style.background = '#8b8b87'","$$('[data-manage-action=\"history\"]')",'手冲常用刻度范围','rangeStart','rangeEnd','normalizeDripperSection','serializeGrinders']) assert.ok(layout.includes(marker), marker);
});

test('settings mascot uses fixed one-third size', async () => {
  const css = await read('styles-v095-refine.css');
  assert.match(css, /\.v095-settings-mascot\s*\{[\s\S]*width:\s*120px\s*!important/);
  assert.match(css, /min-width:\s*120px\s*!important/);
  assert.match(css, /max-width:\s*120px\s*!important/);
});

test('three sensory modes have distinct non-duplicated workflows', async () => {
  const sensory = await read('src/v095-sensory-pro.js');
  for (const marker of ['专业品鉴','专业杯测品鉴 / 雷达图 / 札记','玩家互动品鉴','风味互动 / 札记','自然语言记录，评分','排序靠前的标签代表强度更高','skipNativeToScore','finishProfessional','injectProfessionalNote']) assert.ok(sensory.includes(marker), marker);
  assert.doesNotMatch(sensory, /advanceNativeToScore/);
});

test('professional sensory uses CATA tags, ordering, conditional radar slider and final affective score', async () => {
  const sensory = await read('src/v095-sensory-pro.js');
  for (const marker of ['data-cata-tag','draggable="true"',"chip.addEventListener('dragstart'","chip.addEventListener('pointermove'",'data-radar-axis','data-radar-slider',"if (!wizard.selectedRadar || wizard.selectedRadar.key !== key)",'data-affective-value','确认评分，进入札记','不是 SCA 官方总分公式']) assert.ok(sensory.includes(marker), marker);
});

test('simple note mode reveals score before note', async () => {
  const guard = await read('src/v095-sensory-flow-guard.js');
  assert.match(guard, /data-v095-mode="note"/);
  assert.match(guard, /#sensoryDeltaWheel/);
  assert.match(guard, /classList\.remove\('v095-native-bypass'\)/);
});
