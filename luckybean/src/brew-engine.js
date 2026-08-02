import * as core from './brew-engine-core.js';
import {
  BREW_OPTIMIZER_VERSION,
  TRAJECTORY_MODEL_VERSION,
  deriveSensoryFeedback,
  optimizeBrewPlan,
  optimizerProfileIds,
  summarizeCandidate
} from './brew-optimizer-v097.js';

export * from './brew-engine-core.js';
export {
  BREW_OPTIMIZER_VERSION,
  TRAJECTORY_MODEL_VERSION,
  deriveSensoryFeedback,
  optimizeBrewPlan
} from './brew-optimizer-v097.js';

const EXTRA_PROFILES = Object.freeze([
  { id: 'four-stage', label: '四段式', tags: ['balanced', 'four-stage'], description: '总计四段，闷蒸计为第一段，之后用三段完成主体萃取。' },
  { id: 'four-six-33666', label: '46法改进版（33666）', tags: ['4:6', 'floral', 'acidity'], description: '按30/30/60/60/60比例缩放；前两段均作为闷蒸温区，强调酸质与花香。' }
]);
const EXTRA_PROFILE_MAP = new Map(EXTRA_PROFILES.map(profile => [profile.id, profile]));

export function listBrewProfiles() {
  return [...core.listBrewProfiles().map(profile => ({ ...profile })), ...EXTRA_PROFILES.map(profile => ({ ...profile }))];
}

const EXPLICIT_PROFILES = new Set([
  'one-pour','two-pulse','three-pulse','four-stage','four-six-v17','four-six-33666',
  'flat46-clean','five-pulse','pulse-30x15'
]);

const PROFILE_ALIASES = Object.freeze({
  'one-pour': 'one-pour', onepour: 'one-pour', onepouring: 'one-pour', 'one-pour-v17': 'one-pour', '一刀流': 'one-pour',
  '两段式': 'two-pulse', '二段式': 'two-pulse', 'two-pulse': 'two-pulse', twopulse: 'two-pulse',
  '三段式': 'three-pulse', 'three-pulse': 'three-pulse', threepulse: 'three-pulse',
  '四段式': 'four-stage', 'four-stage': 'four-stage', fourstage: 'four-stage',
  '四六法': 'four-six-v17', '4:6': 'four-six-v17', 'four-six': 'four-six-v17', 'four-six-v17': 'four-six-v17', foursix: 'four-six-v17',
  '46法改进版': 'four-six-33666', '四六法改进版': 'four-six-33666', '33666': 'four-six-33666', 'four-six-33666': 'four-six-33666',
  '平底四六法': 'flat46-clean', '46法·平底净化': 'flat46-clean', 'flat46-clean': 'flat46-clean',
  '五段式': 'five-pulse', 'five-pulse': 'five-pulse', fivepulse: 'five-pulse',
  '30g/15秒脉冲': 'pulse-30x15', '30g闷蒸+每15秒30ml多段脉冲': 'pulse-30x15', 'pulse-30x15': 'pulse-30x15', pulse30x15: 'pulse-30x15'
});

// Segment counts are total stages and always include bloom.
const SEGMENT_PROFILE_MAP = Object.freeze({ '2': 'two-pulse', '3': 'three-pulse', '4': 'four-stage', '5': 'five-pulse' });
const EXPECTED_STAGE_COUNTS = Object.freeze({
  'one-pour': 2, 'two-pulse': 2, 'three-pulse': 3, 'four-stage': 4,
  'four-six-v17': 5, 'four-six-33666': 5, 'flat46-clean': 5, 'five-pulse': 5
});
const CORE_PROFILE_ALIAS = Object.freeze({
  'four-stage': 'five-pulse',
  'four-six-33666': 'four-six-v17'
});

function normalizedProfileAlias(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (EXPLICIT_PROFILES.has(raw)) return raw;
  const compact = raw.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s_·•、，,。()（）[\]【】]/g, '');
  return PROFILE_ALIASES[raw] || PROFILE_ALIASES[compact] || '';
}

export function resolveRequestedProfileId(input = {}) {
  const brew = input.brew || {};
  const profileRaw = String(brew.profileId ?? '').trim();
  const profile = normalizedProfileAlias(profileRaw);
  const style = normalizedProfileAlias(brew.brewStyle ?? brew.style ?? '');
  const profileIsRecommended = !profileRaw || /^(recommended|auto|模型推荐)$/i.test(profileRaw);

  if (profile && !profileIsRecommended) return profile;
  if (style) return style;

  const segmentMode = String(brew.segmentMode ?? '').trim().toLocaleLowerCase('zh-CN');
  if (segmentMode && !['auto', 'recommended', '模型推荐'].includes(segmentMode)) {
    const segmentProfile = SEGMENT_PROFILE_MAP[segmentMode];
    if (segmentProfile) return segmentProfile;
  }
  return '';
}

function explicitProfileId(input = {}) { return resolveRequestedProfileId(input); }

function normalizeExplicitInput(input = {}, profileId = explicitProfileId(input)) {
  const next = structuredClone(input || {});
  next.brew ||= {};
  if (!profileId) return next;
  next.brew.profileId = profileId;
  const totalStages = EXPECTED_STAGE_COUNTS[profileId];
  if (totalStages) {
    next.brew.segmentMode = String(totalStages);
    next.brew.segments = totalStages;
    next.brew.segmentCountIncludesBloom = true;
  }
  return next;
}

const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

function profileDefinition(profileId) {
  return EXTRA_PROFILE_MAP.get(profileId)
    || core.listBrewProfiles().find(profile => profile.id === profileId)
    || { id: profileId, label: profileId, tags: [], description: '' };
}

function sourceStageAtWater(stages, midpoint) {
  let previous = 0;
  for (const item of stages) {
    const end = Number(item.cumulativeWaterG || previous + Number(item.stageWaterG || 0));
    if (midpoint <= end) return item;
    previous = end;
  }
  return stages.at(-1) || {};
}

function rebuildStages(plan, profileId, fractions, names, { improved33666 = false } = {}) {
  const original = (plan.stages || []).map(stage => ({ ...stage }));
  if (!original.length) return plan;
  const totalWater = Number(plan.totals?.waterG || original.at(-1)?.cumulativeWaterG || 0);
  const originalBloom = original[0];
  const sourceMain = original.slice(1);
  const stages = [];
  let elapsed = 0;
  let cumulative = 0;

  const append = (water, source, index, overrides = {}) => {
    cumulative += water;
    const flow = clamp(overrides.flowGPerSec ?? source.flowGPerSec ?? 4.4, 1.5, 9);
    const duration = Math.max(1, round(overrides.durationSec ?? (water / flow + (index === 0 ? 24 : 8))));
    const stage = {
      ...source,
      ...overrides,
      index: index + 1,
      startSec: elapsed,
      durationSec: duration,
      stageWaterG: water,
      cumulativeWaterG: cumulative,
      flowGPerSec: round(flow, 1)
    };
    elapsed += duration;
    stages.push(stage);
  };

  if (improved33666) {
    const exact = fractions.map(value => totalWater * value);
    const waters = exact.map((value, index) => index === exact.length - 1
      ? totalWater - exact.slice(0, -1).reduce((sum, amount) => sum + round(amount), 0)
      : round(value));
    const bloomTemp = Number(originalBloom.temperatureC || 86);
    const bloomCore = Number(originalBloom.coreTemperatureC ?? bloomTemp);
    const firstFlow = Number(originalBloom.flowGPerSec || 3.2);
    const methods = [
      '小水流完成第一轮润湿与排气，保持低液位，优先打开明亮酸质。',
      '继续使用闷蒸温区扩展润湿；轻柔绕圈，强化花香与酸质，不进入主温。',
      '进入主体萃取，稳定绕圈建立甜感与香气层次。',
      '维持主体温区与中等流量，增加风味丰富度和口感完整性。',
      '尾段收束并及时截流，避免拖洗造成苦涩。'
    ];
    waters.forEach((water, index) => {
      const midpoint = cumulative + water / 2;
      const source = index < 2 ? originalBloom : sourceStageAtWater(sourceMain, midpoint);
      const tail = index === waters.length - 1;
      append(water, source, index, {
        name: names[index],
        temperatureC: index < 2 ? bloomTemp : tail ? Math.max(80, Number(source.temperatureC || bloomTemp) - 1) : Number(source.temperatureC || bloomTemp),
        coreTemperatureC: index < 2 ? bloomCore : Number(source.coreTemperatureC ?? source.temperatureC ?? bloomCore),
        flowGPerSec: index < 2 ? firstFlow : Number(source.flowGPerSec || 4.6),
        durationSec: index === 0 ? Math.max(28, Number(originalBloom.durationSec || 34)) : index === 1 ? Math.max(24, round(Number(originalBloom.durationSec || 34) * .75)) : undefined,
        method: methods[index],
        notice: index < 2 ? '本段按闷蒸温度计算' : tail ? '达到目标总水量后立即截流' : '保持连续稳定注水'
      });
    });
  } else {
    const bloomWater = Number(originalBloom.stageWaterG || 0);
    append(bloomWater, originalBloom, 0, {
      name: '第一段·闷蒸',
      durationSec: Number(originalBloom.durationSec || 34),
      method: originalBloom.method || '完全润湿粉层并排气'
    });
    const remaining = Math.max(0, totalWater - bloomWater);
    let used = 0;
    fractions.forEach((fraction, fractionIndex) => {
      const water = fractionIndex === fractions.length - 1 ? remaining - used : round(remaining * fraction);
      const midpoint = bloomWater + used + water / 2;
      const source = sourceStageAtWater(sourceMain, midpoint);
      const stageIndex = fractionIndex + 1;
      const tail = fractionIndex === fractions.length - 1;
      append(water, source, stageIndex, {
        name: names[fractionIndex],
        temperatureC: tail ? Math.max(80, Number(source.temperatureC || originalBloom.temperatureC || 86) - 1) : Number(source.temperatureC || originalBloom.temperatureC || 86),
        method: tail ? '提高流量完成尾段收束，达到目标水量即停止拖洗' : source.method,
        notice: tail ? '尾段及时截流' : source.notice
      });
      used += water;
    });
  }

  const drift = totalWater - stages.reduce((sum, stage) => sum + Number(stage.stageWaterG || 0), 0);
  if (drift && stages.length) {
    stages.at(-1).stageWaterG += drift;
    stages.at(-1).cumulativeWaterG = totalWater;
  }
  const profile = profileDefinition(profileId);
  plan.stages = stages;
  plan.profile = { ...profile };
  plan.profileVersion = `${profileId}@stage-count-includes-bloom-v1`;
  plan.totals = { ...(plan.totals || {}), waterG: totalWater, targetTimeSec: stages.reduce((sum, stage) => sum + Number(stage.durationSec || 0), 0) };
  plan.professional ||= {};
  plan.professional.profile = { ...profile };
  plan.professional.stageCountSemantics = 'total-stages-including-bloom';
  plan.trajectory = [];
  return plan;
}

function normalizeStageSemantics(plan, profileId) {
  if (profileId === 'four-six-33666') {
    return rebuildStages(plan, profileId, [0.125, 0.125, 0.25, 0.25, 0.25], [
      '第一段·闷蒸润湿', '第二段·闷蒸扩展', '第三段·主体一', '第四段·主体二', '第五段·尾段收束'
    ], { improved33666: true });
  }
  const configs = {
    'one-pour': { fractions: [1], names: ['第二段·主体一刀流'] },
    'two-pulse': { fractions: [1], names: ['第二段·主体完成'] },
    'three-pulse': { fractions: [.56, .44], names: ['第二段·主体萃取', '第三段·尾段收束'] },
    'four-stage': { fractions: [.36, .34, .30], names: ['第二段·前段萃取', '第三段·中段展开', '第四段·尾段收束'] },
    'five-pulse': { fractions: [.25, .25, .25, .25], names: ['第二段·细分一', '第三段·细分二', '第四段·细分三', '第五段·尾段收束'] }
  };
  const config = configs[profileId];
  return config ? rebuildStages(plan, profileId, config.fractions, config.names) : plan;
}

function attachLegacyTrajectory(plan) {
  const legacy = Array.isArray(plan.trajectory) ? plan.trajectory : [];
  plan.trajectory = legacy.length === plan.stages?.length ? legacy : (plan.stages || []).map(stage => ({
    x: Number(stage.index || 1) / Math.max(1, plan.stages.length),
    y: Number(stage.cumulativeWaterG || 0) / Math.max(1, plan.totals?.waterG || 1),
    stage: stage.index,
    label: stage.name
  }));
  plan.professional ||= {};
  plan.professional.trajectoryModel = plan.trajectoryModel;
  plan.professional.calculationModelVersion = `${plan.professional.calculationModelVersion || plan.engineVersion || 'brew'}+${TRAJECTORY_MODEL_VERSION}`;
  return plan;
}

function assertProfileIntegrity(input, plan) {
  const requested = explicitProfileId(input);
  const resolved = String(plan.profile?.id || String(plan.profileVersion || '').split('@')[0] || '');
  const expectedStages = EXPECTED_STAGE_COUNTS[requested];
  const actualStages = Array.isArray(plan.stages) ? plan.stages.length : 0;
  plan.profileIntegrity = {
    requestedProfileId: requested || 'recommended', resolvedProfileId: resolved,
    expectedStageCount: expectedStages || null, actualStageCount: actualStages,
    preserved: !requested || requested === resolved,
    stageCountValid: !expectedStages || expectedStages === actualStages,
    countIncludesBloom: true
  };
  if (requested && requested !== resolved) throw new Error(`冲煮法解析错误：已选择 ${requested}，引擎却返回 ${resolved || '未知方案'}`);
  if (expectedStages && expectedStages !== actualStages) throw new Error(`冲煮分段错误：${requested} 应为 ${expectedStages} 段（含闷蒸），实际为 ${actualStages} 段`);
  return plan;
}

function candidateInput(input, id) {
  const next = structuredClone(input || {});
  next.brew ||= {};
  next.brew.profileId = id;
  return normalizeExplicitInput(next, id);
}

function optimizerIds(input = {}) {
  const base = optimizerProfileIds(input);
  return [...new Set([...base, 'four-stage', 'four-six-33666'])];
}

async function computeOptimizedPlan(input, { feedback = null, forceProfile = '' } = {}) {
  const explicit = forceProfile || explicitProfileId(input);
  const ids = explicit ? [explicit] : optimizerIds(input);
  const candidates = [];
  for (const id of ids) {
    const requestedInput = candidateInput(input, id);
    const coreId = CORE_PROFILE_ALIAS[id] || id;
    const coreInput = coreId === id ? requestedInput : candidateInput(input, coreId);
    let base = await core.computeFallbackPlan(coreInput);
    base = normalizeStageSemantics(base, id);
    let plan = optimizeBrewPlan(requestedInput, base, { feedback });
    // The inverse optimizer may redistribute stage water. Re-apply the chosen
    // method's structural invariant afterwards, especially exact 33666.
    plan = normalizeStageSemantics(plan, id);
    plan.profile = { ...profileDefinition(id) };
    plan.professional ||= {};
    plan.professional.profile = { ...profileDefinition(id) };
    candidates.push({ input: requestedInput, plan, summary: { ...summarizeCandidate(plan), profileId: id } });
  }
  candidates.sort((a, b) => b.summary.score - a.summary.score);
  const best = candidates[0];
  if (!best) throw new Error('冲煮优化器没有生成可用候选方案');
  const profiles = new Map(listBrewProfiles().map(profile => [profile.id, profile]));
  const ranked = candidates.map(candidate => ({
    id: candidate.summary.profileId, score: candidate.summary.score,
    reason: `目标覆盖 ${(candidate.summary.positiveCoverage * 100).toFixed(1)}%，轨迹拟合 ${(candidate.summary.targetFit * 100).toFixed(1)}%，风险暴露 ${(candidate.summary.riskExposure * 100).toFixed(2)}%。`,
    positiveCoverage: candidate.summary.positiveCoverage, targetFit: candidate.summary.targetFit,
    riskExposure: candidate.summary.riskExposure, controls: candidate.summary.controls,
    profile: profiles.get(candidate.summary.profileId)
  }));
  best.plan.recommendation = { ...(best.plan.recommendation || {}), selected: ranked[0], candidates: ranked };
  best.plan.optimizer.candidateProfiles = ranked;
  best.plan.optimizer.selectedBy = explicit ? 'user-profile-constraint' : 'inverse-trajectory-objective';
  best.plan.optimizer.inputProfileId = explicit || 'recommended';
  best.plan.input = best.input;
  assertProfileIntegrity(explicit ? best.input : input, best.plan);
  return attachLegacyTrajectory(best.plan);
}

export async function computeFallbackPlan(input = {}) { return computeOptimizedPlan(input); }

function feedbackSummary(feedback) {
  const labels = { underExtracted: '欠萃/酸尖', overExtracted: '过萃/苦涩', lowSweet: '甜感不足', lowAroma: '香气不足', muddy: '浑浊', thin: '单薄', heavy: '滞重' };
  const active = Object.entries(feedback?.flags || {}).filter(([, value]) => value).map(([key]) => labels[key] || key);
  return active.length ? active.join('、') : '未检测到明确缺陷，按评分残差做小幅校准';
}

function controlChangeText(controls = {}) {
  const signed = value => `${Number(value) >= 0 ? '+' : ''}${Number(value || 0).toFixed(2)}`;
  return `逆向拟合修正：主温 ${signed(controls.tempOffset)}℃，流量 ${signed(controls.flowOffset)} g/s，研磨 ${signed(controls.grindDelta)} 标准单位，粉水比 ${signed(controls.ratioDelta)}，尾段降温 ${Number(controls.tailDrop || 0).toFixed(2)}℃。`;
}

export async function buildCorrectedPlan(input, sensoryRecord, previousPlan = null) {
  const selectedProfile = explicitProfileId(input);
  const coreInput = selectedProfile && CORE_PROFILE_ALIAS[selectedProfile]
    ? candidateInput(input, CORE_PROFILE_ALIAS[selectedProfile])
    : input;
  const draft = await core.buildCorrectedPlan(coreInput, sensoryRecord, previousPlan);
  let correctedInput = structuredClone(draft.input || input || {});
  correctedInput.brew ||= {};
  if (selectedProfile) correctedInput = normalizeExplicitInput(correctedInput, selectedProfile);
  const feedback = deriveSensoryFeedback(sensoryRecord || {}, previousPlan);
  correctedInput.optimizerFeedback = feedback;
  const rebuilt = await computeOptimizedPlan(correctedInput, { feedback, forceProfile: selectedProfile });
  const existingChanges = (draft.correction?.changes || []).filter(value => !selectedProfile || !/采用|方案|分段/.test(String(value)));
  const changes = [
    ...existingChanges,
    selectedProfile
      ? `保留用户指定的“${listBrewProfiles().find(item => item.id === selectedProfile)?.label || selectedProfile}”，不改变冲煮法，仅重算阶段参数。`
      : '依据品鉴残差重新比较全部候选冲煮法，选择轨迹目标函数得分最高者。',
    `品鉴反馈识别：${feedbackSummary(feedback)}。`,
    controlChangeText(rebuilt.optimizer?.controls)
  ];
  return {
    ...rebuilt, id: undefined, input: correctedInput,
    correction: {
      ...(draft.correction || {}), changes,
      requestedProfileId: selectedProfile || 'recommended', feedback,
      optimizerVersion: BREW_OPTIMIZER_VERSION,
      previousObjectiveScore: Number(previousPlan?.optimizer?.objectiveScore || 0) || null,
      correctedObjectiveScore: Number(rebuilt.optimizer?.objectiveScore || 0)
    },
    warnings: [...new Set([...(rebuilt.warnings || []), ...(draft.warnings || [])])]
  };
}

export async function requestPrivatePlan(endpoint, input, timeoutMs = 9000) {
  const selected = explicitProfileId(input);
  if (selected && CORE_PROFILE_ALIAS[selected]) return computeOptimizedPlan(input, { forceProfile: selected });
  const normalized = normalizeExplicitInput(input);
  const privatePlan = await core.requestPrivatePlan(endpoint, normalized, timeoutMs);
  const semanticPlan = normalizeStageSemantics(privatePlan, selected);
  let optimized = optimizeBrewPlan(normalized, semanticPlan);
  optimized = normalizeStageSemantics(optimized, selected);
  assertProfileIntegrity(normalized, optimized);
  return attachLegacyTrajectory(optimized);
}