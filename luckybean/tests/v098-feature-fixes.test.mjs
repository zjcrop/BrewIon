import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computeFallbackPlan, listBrewProfiles, resolveRequestedProfileId } from '../src/brew-engine.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const input = (profileId, segmentMode = 'auto') => ({
  schemaVersion: 2,
  bean: { countryCode: 'CO-ET', varietyCode: 'VA-GE', processCode: 'PR-WA', roastCode: 'RL-L1', roastColor: 88, altitude: 1950, roastDate: '2026-07-20' },
  brew: {
    method: 'pourover', doseG: 16, ratio: 15, ratioLocked: true,
    profileId, segmentMode, segments: Number(segmentMode) || 3,
    lowTempFirst: true, dripperCode: 'V60 02', filterPaperCode: '快流滤纸', grinder: 'C40'
  },
  water: { profileId: 'geisha', recipeVolumeL: 5, tdsMgL: 90 },
  targets: { floral: 3, acidity: 2.8, sweetness: 2.2, body: 1.8, bitterness: 2.8 }
});

test('segment numbers mean total stages including bloom', async () => {
  assert.equal(resolveRequestedProfileId(input('recommended', '2')), 'two-pulse');
  assert.equal(resolveRequestedProfileId(input('recommended', '3')), 'three-pulse');
  assert.equal(resolveRequestedProfileId(input('recommended', '4')), 'four-stage');
  assert.equal(resolveRequestedProfileId(input('recommended', '5')), 'five-pulse');

  const expected = [
    ['two-pulse', 2], ['three-pulse', 3], ['four-stage', 4], ['five-pulse', 5]
  ];
  for (const [profileId, count] of expected) {
    const plan = await computeFallbackPlan(input(profileId));
    assert.equal(plan.profile.id, profileId);
    assert.equal(plan.stages.length, count, `${profileId} total stages`);
    assert.equal(plan.stages[0].index, 1);
    assert.match(plan.stages[0].name, /闷蒸|润湿/);
    assert.equal(plan.profileIntegrity.countIncludesBloom, true);
  }
});

test('improved 4:6 profile uses exact scaled 33666 split and two bloom-temperature stages', async () => {
  assert.ok(listBrewProfiles().some(profile => profile.id === 'four-six-33666'));
  const plan = await computeFallbackPlan(input('four-six-33666'));
  assert.equal(plan.profile.id, 'four-six-33666');
  assert.equal(plan.stages.length, 5);
  assert.deepEqual(plan.stages.map(stage => stage.stageWaterG), [30, 30, 60, 60, 60]);
  assert.equal(plan.stages[0].temperatureC, plan.stages[1].temperatureC);
  assert.match(plan.stages[0].name, /闷蒸/);
  assert.match(plan.stages[1].name, /闷蒸/);
  assert.match(plan.stages[1].notice, /闷蒸温度/);
  assert.equal(plan.stages.at(-1).cumulativeWaterG, 240);
});

test('v098 runtime and styles contain grouping, selected-card, radar, archive and flavor-record fixes', async () => {
  const [runtime, css, trajectory, trajectoryCss, selection, groupGuard, html, sw] = await Promise.all([
    read('src/v098-feature-fixes.js'),
    read('styles-v098-fixes.css'),
    read('src/v098-trajectory-v17.js'),
    read('styles-v098-trajectory-v17.css'),
    read('src/v098-selection-bridge.js'),
    read('src/v098-group-menu-guard.js'),
    read('index.html'),
    read('sw.js')
  ]);
  for (const marker of [
    "groupMode = localStorage.getItem(GROUP_KEY) || 'roast'",
    'freshness-state', 'remaining-50', 'FRESHNESS_ORDER',
    'v098-segments-hidden', 'FIXED_PROFILE_STAGES',
    'min = \'1\'', 'max = \'9\'', 'bypassAffectiveStep',
    'openProfessionalRadarReturn', 'rebuyBean', 'permanentlyDeleteBean',
    "['高温', 'H']", "['中温', 'W']", "['低温', 'C']"
  ]) assert.ok(runtime.includes(marker), marker);
  for (const marker of [
    '#2d2e30', '#ddddda', 'rgba(190, 38, 38, .50)',
    '.v098-segments-hidden', '.v098-affective-bypass', '.v098-radar-return'
  ]) assert.ok(css.includes(marker), marker);
  for (const marker of [
    'v17-stage-time-window', 'v098-temp-band', 'v098-flow-band',
    'v098-cumulative-line', 'v098-flavor-window', '轨迹下压避开',
    "$$('.trajectory-window', svg)", '明亮酸质', '苦涩风险'
  ]) assert.ok(trajectory.includes(marker), marker);
  for (const marker of ['.v098-temp-band', '.v098-flow-band', '.v098-cumulative-line', '.v098-risk-avoid']) {
    assert.ok(trajectoryCss.includes(marker), marker);
  }
  assert.ok(selection.includes('luckybean.selected.bean.v098'));
  assert.ok(selection.includes('.bean-card.recommended'));
  assert.ok(groupGuard.includes("menu.querySelector('[data-group-method]')"));
  assert.ok(groupGuard.includes('data-v098-group-method'));

  assert.match(html, /styles-v098-fixes\.css\?v=098a/);
  assert.match(html, /styles-v098-trajectory-v17\.css\?v=098b/);
  assert.match(html, /src\/v098-trajectory-v17\.js\?v=098c/);
  assert.match(html, /src\/v098-selection-bridge\.js\?v=098b/);
  assert.match(html, /src\/v098-feature-fixes\.js\?v=098a/);
  assert.match(html, /src\/v098-group-menu-guard\.js\?v=098b/);
  assert.match(sw, /luckybean-v0\.9\.8-feature-fix-b/);
  for (const marker of [
    'styles-v098-fixes.css', 'styles-v098-trajectory-v17.css',
    'src/v098-feature-fixes.js', 'src/v098-trajectory-v17.js',
    'src/v098-selection-bridge.js', 'src/v098-group-menu-guard.js'
  ]) assert.ok(sw.includes(marker), marker);
});
