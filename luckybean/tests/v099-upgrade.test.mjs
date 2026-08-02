import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computeFallbackPlan, listBrewProfiles } from '../src/brew-engine.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const input = profileId => ({
  schemaVersion: 2,
  bean: {
    countryCode: 'CO-ET', varietyCode: 'VA-GE', processCode: 'PR-WA',
    roastCode: 'RL-L1', roastColor: 88, altitude: 1950, roastDate: '2026-07-20'
  },
  brew: {
    method: 'pourover', doseG: 16, ratio: 15, ratioLocked: true,
    profileId, segmentMode: 'auto', segments: 3, lowTempFirst: true,
    dripperCode: 'V60 02', filterPaperCode: '快流滤纸', grinder: 'C40'
  },
  water: { profileId: 'geisha', recipeVolumeL: 5, tdsMgL: 90 },
  targets: { floral: 3, acidity: 2.8, sweetness: 2.2, body: 1.8, bitterness: 2.8 }
});

test('one-pour is one continuous stage and 33666 remains exact five stages', async () => {
  const one = await computeFallbackPlan(input('one-pour'));
  assert.equal(one.profile.id, 'one-pour');
  assert.equal(one.stages.length, 1);
  assert.match(one.stages[0].name, /一刀流|连续注水/);
  assert.equal(one.profileIntegrity.expectedStageCount, 1);
  assert.equal(one.profileIntegrity.stageCountValid, true);

  const split = await computeFallbackPlan(input('four-six-33666'));
  assert.equal(split.profile.id, 'four-six-33666');
  assert.equal(split.stages.length, 5);
  assert.deepEqual(split.stages.map(stage => stage.stageWaterG), [30, 30, 60, 60, 60]);
  assert.equal(split.stages[0].temperatureC, split.stages[1].temperatureC);
});

test('researched methods are persisted as selectable profiles', () => {
  const ids = new Set(listBrewProfiles().map(profile => profile.id));
  for (const id of [
    'hoffmann-one-cup', 'april-two-pour', 'matt-winton-five',
    'lance-daily-two', 'switch-hybrid-50-50', 'mugen-one-pour',
    'onyx-center-spiral', 'four-six-33666'
  ]) assert.ok(ids.has(id), id);
});

test('group guard is non-recursive and recommendation rendering yields to native state', async () => {
  const [guard, runtime] = await Promise.all([
    read('src/v098-group-menu-guard.js'), read('src/v098-feature-fixes.js')
  ]);
  assert.match(guard, /let syncing = false/);
  assert.match(guard, /if \(syncing\) return/);
  assert.doesNotMatch(guard, /characterData\s*:\s*true/);
  assert.match(runtime, /v099NativeRecommendation/);
  assert.match(runtime, /\['freshness-state', 'remaining-50'\]\.includes\(groupMode\)/);
});

test('eight-axis radar uses dynamic pointer geometry and defect scoring', async () => {
  const sensory = await read('src/v095-sensory-pro.js');
  assert.match(sensory, /'干净度', '一致性', '平衡度'/);
  assert.match(sensory, /function pointerRadarValue\(event, svg, key, index\)/);
  assert.match(sensory, /wizard\.radar\[key\]\.length/);
  assert.match(sensory, /明缺陷/);
  assert.match(sensory, /暗缺陷/);
  assert.match(sensory, /cleanRaw >= 10 \? 10 : 0/);
  assert.match(sensory, /lines\.push\(`\$\{label\}\/\$\{marker\}\/\$\{Number/);
});

test('v0.9.9 presentation and inverse-trajectory emphasis are published', async () => {
  const [html, css, trajectory, optimizer, sw] = await Promise.all([
    read('index.html'), read('styles-v099.css'), read('src/v098-trajectory-v17.js'),
    read('src/brew-optimizer-v097.js'), read('sw.js')
  ]);
  assert.match(html, /application-version" content="0\.9\.9/);
  assert.match(html, /release-revision" content="099a/);
  assert.match(html, /styles-v099\.css\?v=099a/);
  assert.match(html, /src\/v099-runtime\.js\?v=099a/);
  assert.match(css, /\.v097-fab-drag-handle[\s\S]*background: transparent !important/);
  assert.match(css, /stroke: #fff !important/);
  assert.match(css, /stroke-width: 3\.4/);
  assert.match(css, /#454542/);
  assert.match(css, /#cececa/);
  assert.match(trajectory, /白色实线：冲煮萃取轨迹/);
  assert.match(optimizer, /timeScale/);
  assert.match(optimizer, /正向风味窗口视为必须穿越的目标区/);
  assert.match(sw, /luckybean-v0\.9\.9-main-099a/);
});
