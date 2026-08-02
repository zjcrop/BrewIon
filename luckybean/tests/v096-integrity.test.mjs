import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computeFallbackPlan, buildCorrectedPlan, TRAJECTORY_MODEL_VERSION } from '../src/brew-engine.js';
import { compactSensoryRecord, expandSensoryRecord, sealSensoryRecord, openSensoryRecord, SENSORY_STORAGE_FORMAT } from '../src/sensory-codec-v096.js';
import { buildCompactSharePayload, encodeSharePayload, decodeSharePayload } from '../src/share-codec.js';
import { fieldCandidates } from '../src/recognition-candidates.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function brewInput(overrides = {}) {
  const base = {
    schemaVersion: 2,
    bean: { countryCode: 'CO-EA', regionCode: '', entityCode: '', varietyCode: 'VA-GE', processCode: 'PR-WA', roastCode: 'RL-L1', roastColor: 88, roastDate: '2026-07-20', altitude: 1950 },
    brew: {
      mode: 'professional', method: 'pourover', doseG: 15, ratio: 15.5,
      profileId: 'one-pour', segmentMode: '2', segments: 2,
      dripperCode: '平底滤杯', filterPaper: '', filterPaperId: '', grinder: '',
      firstCoolingMode: 'auto', firstTemperatureC: 87,
      tailCoolingMode: 'auto', tailTemperatureC: 86,
      lowTempFirst: true, temperatureTune: 0, grindTune: 0, bloomTune: 0,
      repeatability: false, waterProfileId: 'washed'
    },
    water: { profileId: 'washed', recipeVolumeL: 5, tdsMgL: 100 },
    targets: { floral: 2.5, acidity: 2, sweetness: 2, body: 1.2, bitterness: 2 }
  };
  return {
    ...base, ...overrides,
    bean: { ...base.bean, ...(overrides.bean || {}) },
    brew: { ...base.brew, ...(overrides.brew || {}) },
    water: { ...base.water, ...(overrides.water || {}) },
    targets: { ...base.targets, ...(overrides.targets || {}) }
  };
}

test('explicit one-pour remains bloom plus one pour before and after correction', async () => {
  const input = brewInput();
  const plan = await computeFallbackPlan(input);
  assert.equal(plan.profile.id, 'one-pour');
  assert.equal(plan.stages.length, 2);
  assert.equal(plan.profileIntegrity.preserved, true);
  assert.equal(plan.profileIntegrity.stageCountValid, true);
  assert.equal(plan.profileIntegrity.countIncludesBloom, true);
  const record = {
    id: 'sensory-test', brewSessionId: 'brew-test', autoScore: 82, subjectiveScore: 72, score: 72, scoreDelta: -10,
    answers: {
      floral: { 0: ['无'], 1: ['无'] }, fruit: { 0: ['无'], 1: ['无'] }, other: { 0: ['无'], 1: ['无'], 2: ['无'], 3: ['无'] },
      sweet: { 0: ['蜂蜜'], 1: ['低'] }, acid: { 0: ['柑橘'], 1: ['圆润舒适'] }, bitter: { 0: ['无'] }, mouthfeel: { 0: ['干涩'] }, negative: { 0: ['无'] }
    },
    naturalNote: '甜感不足且略干涩'
  };
  const corrected = await buildCorrectedPlan(input, record, { id: 'brew-test' });
  assert.equal(corrected.profile.id, 'one-pour');
  assert.equal(corrected.stages.length, 2);
  assert.equal(corrected.input.brew.profileId, 'one-pour');
  assert.match(corrected.correction.changes.join('；'), /保留用户指定/);
});

test('trajectory is calculated from temperature grind water and profile variables', async () => {
  const base = await computeFallbackPlan(brewInput());
  const changed = await computeFallbackPlan(brewInput({
    brew: { profileId: 'three-pulse', segmentMode: '3', segments: 3, temperatureTune: -3, grindTune: 2, waterProfileId: 'kenya' },
    water: { profileId: 'kenya', tdsMgL: 104 },
    targets: { floral: 1, acidity: 3, sweetness: 1, body: 2.5, bitterness: 1 }
  }));
  assert.equal(base.trajectoryModel.version, TRAJECTORY_MODEL_VERSION);
  assert.equal(base.trajectoryModel.model, 'time-stepped-variable-release');
  assert.equal(base.trajectoryModel.points.length, 81);
  assert.equal(changed.stages.length, 3);
  assert.notDeepEqual(base.trajectoryModel.drivers, changed.trajectoryModel.drivers);
  const baseSignature = base.trajectoryModel.points.map(point => [point.temperatureC, point.flowGPerSec, point.extractionEY, point.floral, point.acidity, point.bitterRisk]);
  const changedSignature = changed.trajectoryModel.points.map(point => [point.temperatureC, point.flowGPerSec, point.extractionEY, point.floral, point.acidity, point.bitterRisk]);
  assert.notDeepEqual(baseSignature, changedSignature);
  assert.ok(base.trajectoryModel.points.some(point => point.extractionEY > 0));
});

test('sensory records are coded compressed encrypted and note-limited', async () => {
  const note = '札'.repeat(360);
  const record = {
    id: 's1', beanId: 'b1', brewSessionId: 'p1', createdAt: '2026-08-02T10:00:00Z', autoScore: 82, subjectiveScore: 78.5, scoreDelta: -3.5,
    answers: { floral: { 0: ['茉莉'], 1: ['强'] }, sweet: { 0: ['蜂蜜'], 1: ['适中'] } }, naturalNote: note,
    professional: {
      mode: 'professional', selections: { dry: ['茉莉', '柑橘'], high: ['蜂蜜'] }, intensities: { dry: 10.5, high: 8 },
      radar: { aroma: [8, 7, 4, 2, 3], style: [8, 7, 7, 8, 5] }, affective: { 香气: 8, 风味: 7 }, mappedScore: 86
    }
  };
  const compact = compactSensoryRecord(record);
  assert.equal(compact.n.length, 300);
  assert.notEqual(JSON.stringify(compact.q), JSON.stringify(record.answers));
  const expanded = expandSensoryRecord(compact);
  assert.equal(expanded.naturalNote.length, 300);
  assert.deepEqual(expanded.professional.radar.aroma, [8, 7, 4, 2, 3]);
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const sealed = await sealSensoryRecord(record, secret);
  assert.equal(sealed.storageFormat, SENSORY_STORAGE_FORMAT);
  assert.equal(sealed.encryption, 'AES-GCM-256');
  assert.ok(!JSON.stringify(sealed).includes('茉莉'));
  assert.ok(!JSON.stringify(sealed).includes('札札札'));
  const opened = await openSensoryRecord(sealed, secret);
  assert.equal(opened.naturalNote.length, 300);
  assert.ok(opened.summary.some(value => value.includes('茉莉')));
});

test('encrypted share omits plaintext public identity and remains decodable', async () => {
  const payload = buildCompactSharePayload({
    appVersion: '0.9.6', user: { publicId: 'LB-SECRET-ID', nickname: '真实昵称' },
    bean: { countryCode: 'CO-EA', varietyCode: 'VA-GE', processCode: 'PR-WA', flavorCodes: ['FL-JASMINE'] },
    brewSessions: [], sensoryRecords: [], names: { displayName: '测试豆' }
  });
  assert.deepEqual(payload.u, []);
  assert.ok(!JSON.stringify(payload).includes('LB-SECRET-ID'));
  assert.ok(!JSON.stringify(payload).includes('真实昵称'));
  const encoded = await encodeSharePayload(payload);
  assert.match(encoded, /^LB8[JR]\.E\./);
  assert.ok(!encoded.includes('LB-SECRET-ID'));
  const decoded = await decodeSharePayload(encoded);
  assert.equal(decoded.bean.countryCode, 'CO-EA');
  assert.equal(decoded.user.publicId, '');
  assert.equal(decoded.user.nickname, '匿名');
  assert.equal(decoded.encrypted, true);
});

test('OCR evidence candidates support per-field fuzzy correction', () => {
  const book = {
    countries: [['CT-ET', '埃塞俄比亚', 'Ethiopia']],
    regions: [['RG-GUJI', 'CT-ET', '古吉', 'Guji']], entities: [],
    varieties: [['VR-001', '瑰夏', 'Gesha']], processes: [['PROC-WASHED', '水洗', 'Washed']], flavors: []
  };
  const country = fieldCandidates('countryCode', '埃秦俄比亚', book, {}, 3);
  assert.equal(country[0].code, 'CT-ET');
  const weight = fieldCandidates('initialWeight', '15G', book);
  assert.equal(weight[0].value, 15);
});

test('runtime provides minimal identity screen rich history and selection-only tasting navigation', async () => {
  const [html, css, ui, db, sw] = await Promise.all([
    read('index.html'), read('styles-v096-integrity.css'), read('src/v096-integrity-ui.js'), read('src/db.js'), read('sw.js')
  ]);
  for (const label of ['>登录<', '>注册<', '>本地使用<', '>测试<']) assert.ok(html.includes(label), label);
  assert.ok(!html.includes('login-logo'));
  assert.ok(!html.includes('login-copy'));
  assert.match(html, /styles-v096-integrity\.css\?v=096f/);
  assert.match(html, /src\/v096-integrity-ui\.js\?v=096f/);
  assert.match(ui, /#directSensoryBtn, #planToSensoryBtn/);
  assert.match(ui, /stopImmediatePropagation/);
  assert.match(ui, /maxlength', '300/);
  assert.match(ui, /sensory-record-tags/);
  assert.match(ui, /data-evidence-field/);
  assert.match(css, /\.sensory-record-card/);
  assert.match(css, /\.evidence-row-v2/);
  assert.match(db, /delete value\.sensoryNote/);
  assert.match(db, /sealPrivateJson\(identity/);
  assert.match(sw, /luckybean-v0\.9\.8-feature-fix-a/);
});
