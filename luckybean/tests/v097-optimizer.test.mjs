import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFallbackPlan,
  buildCorrectedPlan,
  BREW_OPTIMIZER_VERSION,
  TRAJECTORY_MODEL_VERSION
} from '../src/brew-engine.js';
import {
  buildBeanChemistryModel,
  buildDeviceHydraulicModel,
  buildWaterExtractionModel,
  buildPreferenceTarget,
  buildFlavorWindows,
  deriveSensoryFeedback,
  optimizerProfileIds
} from '../src/brew-optimizer-v097.js';

const baseInput = {
  schemaVersion: 2,
  bean: {
    countryCode: 'CO-PA',
    varietyCode: 'VA-GE',
    processCode: 'PR-WA',
    roastCode: 'RL-L1',
    roastColor: 88,
    altitude: 1900,
    roastDate: '2026-07-20'
  },
  brew: {
    method: 'pourover',
    doseG: 15,
    ratio: 15.5,
    profileId: 'recommended',
    segments: 3,
    lowTempFirst: true,
    dripperCode: 'V60 02',
    filterPaperCode: '快流滤纸',
    grinder: 'C40'
  },
  water: {
    profileId: 'geisha',
    recipeVolumeL: 5,
    tdsMgL: 90,
    customProfile: { ca: 22, mg: 41, hco3: 17, tds: 90 }
  },
  targets: { floral: 3, acidity: 2.4, sweetness: 2.4, body: 1.2, bitterness: 3 }
};

test('v17 chemistry priors are migrated into the inverse optimizer', () => {
  const geisha = buildBeanChemistryModel(baseInput);
  const catimor = buildBeanChemistryModel({
    ...baseInput,
    bean: { ...baseInput.bean, countryCode: 'CO-CN', varietyCode: 'VA-CATIMOR', roastCode: 'RL-L4', roastColor: 56 }
  });
  assert.equal(geisha.priorKey, 'gesha');
  assert.equal(catimor.priorKey, 'cgaheavy');
  assert.ok(geisha.chemistry.volatility > catimor.chemistry.volatility);
  assert.ok(catimor.chemistry.bitter > geisha.chemistry.bitter);
  assert.ok(geisha.markerFamilies.length >= 3);
  assert.match(geisha.priorLabel, /瑰夏/);
});

test('dripper and paper library values alter the hydraulic envelope', () => {
  const fastCone = buildDeviceHydraulicModel(baseInput);
  const slowLowBypass = buildDeviceHydraulicModel({
    ...baseInput,
    brew: { ...baseInput.brew, dripperCode: 'Pulsar 低旁路', filterPaperCode: '慢流贴合滤纸' }
  });
  assert.equal(fastCone.group, 'cone');
  assert.equal(slowLowBypass.group, 'low-bypass');
  assert.ok(fastCone.maxFlow > slowLowBypass.maxFlow);
  assert.ok(slowLowBypass.contact > fastCone.contact);
  assert.ok(slowLowBypass.bypass < fastCone.bypass);
});

test('target and risk windows are bean preference water and device linked', () => {
  const bean = buildBeanChemistryModel(baseInput);
  const device = buildDeviceHydraulicModel(baseInput);
  const water = buildWaterExtractionModel(baseInput, { water: { profile: baseInput.water.customProfile } });
  const target = buildPreferenceTarget(baseInput);
  const windows = buildFlavorWindows(bean, target, water, device);
  assert.ok(windows.positive.length >= 5);
  assert.ok(windows.risks.length >= 5);
  assert.ok(windows.positive.some(item => item.id === 'floral' && item.weight > 0.5));
  assert.ok(windows.risks.some(item => item.id === 'bitter' && item.risk));
  assert.ok(windows.all.every(item => item.start < item.end));
});

test('recommended plan is selected by trajectory objective and retains full protocol', async () => {
  const plan = await computeFallbackPlan(baseInput);
  assert.match(plan.engineVersion, /lucky-brew-optimizer-0\.9\.7\.1/);
  assert.equal(plan.trajectoryModel.version, TRAJECTORY_MODEL_VERSION);
  assert.equal(plan.optimizer.version, BREW_OPTIMIZER_VERSION);
  assert.equal(plan.optimizer.selectedBy, 'inverse-trajectory-objective');
  assert.ok(plan.optimizer.candidateProfiles.length >= 5);
  assert.equal(plan.recommendation.selected.id, plan.profile.id);
  assert.equal(plan.recommendation.candidates[0].score, plan.optimizer.objectiveScore);
  assert.ok(plan.optimizer.objectiveScore > 0);
  assert.ok(plan.optimizer.positiveCoverage >= 0 && plan.optimizer.positiveCoverage <= 1);
  assert.ok(plan.optimizer.riskExposure >= 0 && plan.optimizer.riskExposure <= 1);
  assert.ok(plan.trajectoryModel.points.length >= 81);
  assert.ok(plan.trajectoryModel.points.every(point =>
    Number.isFinite(point.targetSignal) &&
    Number.isFinite(point.actualSignal) &&
    Number.isFinite(point.extractionEY)
  ));
  assert.equal(plan.stages.reduce((sum, stage) => sum + stage.stageWaterG, 0), plan.totals.waterG);
  assert.equal(plan.stages.at(-1).cumulativeWaterG, plan.totals.waterG);
  assert.match(plan.trajectoryModel.disclaimer, /代理族群|直接测量/);
});

test('explicit brew method is a hard constraint while its parameters are inverse fitted', async () => {
  const input = {
    ...baseInput,
    brew: { ...baseInput.brew, profileId: 'one-pour' }
  };
  const plan = await computeFallbackPlan(input);
  assert.equal(plan.profile.id, 'one-pour');
  assert.equal(plan.stages.length, 2);
  assert.equal(plan.profileIntegrity.preserved, true);
  assert.equal(plan.optimizer.selectedBy, 'user-profile-constraint');
  assert.equal(plan.optimizer.candidateProfiles.length, 1);
  assert.equal(plan.stages.reduce((sum, stage) => sum + stage.stageWaterG, 0), plan.totals.waterG);
});

test('gear constraints and bean chemistry change optimized trajectory and controls', async () => {
  const conePlan = await computeFallbackPlan({
    ...baseInput,
    brew: { ...baseInput.brew, profileId: 'three-pulse', dripperCode: 'V60 02', filterPaperCode: '快流滤纸' }
  });
  const lowBypassPlan = await computeFallbackPlan({
    ...baseInput,
    bean: { ...baseInput.bean, varietyCode: 'VA-CATIMOR', roastCode: 'RL-L4', roastColor: 56 },
    brew: { ...baseInput.brew, profileId: 'three-pulse', dripperCode: 'Pulsar 低旁路', filterPaperCode: '慢流贴合滤纸' }
  });
  assert.notDeepEqual(conePlan.optimizer.controls, lowBypassPlan.optimizer.controls);
  assert.notDeepEqual(
    conePlan.trajectoryModel.points.map(point => point.actualSignal),
    lowBypassPlan.trajectoryModel.points.map(point => point.actualSignal)
  );
  assert.ok(lowBypassPlan.optimizer.deviceModel.maxFlow < conePlan.optimizer.deviceModel.maxFlow);
});

test('sensory feedback becomes a closed-loop parameter correction', async () => {
  const original = await computeFallbackPlan({
    ...baseInput,
    brew: { ...baseInput.brew, profileId: 'three-pulse' }
  });
  original.id = 'brew_original';
  const sensory = {
    id: 'sensory_feedback',
    brewSessionId: 'brew_original',
    autoScore: 85,
    subjectiveScore: 75,
    naturalNote: '酸尖，甜不足，尾段干涩',
    answers: {
      acid: { 0: ['尖锐'] },
      sweet: { 0: ['甜感弱'] },
      mouthfeel: { 0: ['干涩'] }
    }
  };
  const feedback = deriveSensoryFeedback(sensory, original);
  assert.equal(feedback.flags.underExtracted, true);
  assert.equal(feedback.flags.overExtracted, true);
  assert.equal(feedback.flags.lowSweet, true);

  const corrected = await buildCorrectedPlan({
    ...baseInput,
    brew: { ...baseInput.brew, profileId: 'three-pulse' }
  }, sensory, original);
  assert.equal(corrected.profile.id, 'three-pulse');
  assert.equal(corrected.correction.feedback.sourceRecordId, 'sensory_feedback');
  assert.ok(corrected.correction.changes.some(value => /逆向拟合修正/.test(value)));
  assert.ok(corrected.optimizer.controls.tailDrop > original.optimizer.controls.tailDrop);
  assert.notDeepEqual(corrected.optimizer.controls, original.optimizer.controls);
  assert.equal(corrected.stages.reduce((sum, stage) => sum + stage.stageWaterG, 0), corrected.totals.waterG);
});

test('flat-only profile is not considered for cone equipment but is considered for flat equipment', () => {
  const coneIds = optimizerProfileIds(baseInput);
  const flatIds = optimizerProfileIds({
    ...baseInput,
    brew: { ...baseInput.brew, dripperCode: 'B75 平底滤杯' }
  });
  assert.equal(coneIds.includes('flat46-clean'), false);
  assert.equal(flatIds.includes('flat46-clean'), true);
});
