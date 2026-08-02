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

const EXPLICIT_PROFILES = new Set([
  'one-pour','two-pulse','three-pulse','four-six-v17',
  'flat46-clean','five-pulse','pulse-30x15'
]);

const PROFILE_ALIASES = Object.freeze({
  'one-pour': 'one-pour', onepour: 'one-pour', onepouring: 'one-pour', 'one-pour-v17': 'one-pour', '一刀流': 'one-pour',
  '两段式': 'two-pulse', '二段式': 'two-pulse', 'two-pulse': 'two-pulse', twopulse: 'two-pulse',
  '三段式': 'three-pulse', 'three-pulse': 'three-pulse', threepulse: 'three-pulse',
  '四六法': 'four-six-v17', '4:6': 'four-six-v17', 'four-six': 'four-six-v17', 'four-six-v17': 'four-six-v17', foursix: 'four-six-v17',
  '平底四六法': 'flat46-clean', '46法·平底净化': 'flat46-clean', 'flat46-clean': 'flat46-clean',
  '五段式': 'five-pulse', 'five-pulse': 'five-pulse', fivepulse: 'five-pulse',
  '30g/15秒脉冲': 'pulse-30x15', '30g闷蒸+每15秒30ml多段脉冲': 'pulse-30x15', 'pulse-30x15': 'pulse-30x15', pulse30x15: 'pulse-30x15'
});

const SEGMENT_PROFILE_MAP = Object.freeze({ '1': 'one-pour', '2': 'two-pulse', '3': 'three-pulse', '5': 'five-pulse' });
const EXPECTED_STAGE_COUNTS = Object.freeze({
  'one-pour': 2, 'two-pulse': 3, 'three-pulse': 4,
  'four-six-v17': 5, 'flat46-clean': 5, 'five-pulse': 6
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

  // A bare numeric `segments` field is not authoritative: historical records
  // contain it even when the UI remained on model recommendation. Only the
  // explicit segmentMode control may constrain the profile.
  return '';
}

function explicitProfileId(input = {}) { return resolveRequestedProfileId(input); }

function normalizeExplicitInput(input = {}, profileId = explicitProfileId(input)) {
  const next = structuredClone(input || {});
  next.brew ||= {};
  if (!profileId) return next;
  next.brew.profileId = profileId;
  const mainPours = { 'one-pour': 1, 'two-pulse': 2, 'three-pulse': 3, 'five-pulse': 5 }[profileId];
  if (mainPours) {
    next.brew.segmentMode = String(mainPours);
    next.brew.segments = mainPours;
  }
  return next;
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
    stageCountValid: !expectedStages || expectedStages === actualStages
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

async function computeOptimizedPlan(input, { feedback = null, forceProfile = '' } = {}) {
  const explicit = forceProfile || explicitProfileId(input);
  const ids = explicit ? [explicit] : optimizerProfileIds(input);
  const candidates = [];
  for (const id of ids) {
    const nextInput = candidateInput(input, id);
    const base = await core.computeFallbackPlan(nextInput);
    const plan = optimizeBrewPlan(nextInput, base, { feedback });
    candidates.push({ input: nextInput, plan, summary: summarizeCandidate(plan) });
  }
  candidates.sort((a, b) => b.summary.score - a.summary.score);
  const best = candidates[0];
  if (!best) throw new Error('冲煮优化器没有生成可用候选方案');
  const profiles = new Map(core.listBrewProfiles().map(profile => [profile.id, profile]));
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
  const draft = await core.buildCorrectedPlan(input, sensoryRecord, previousPlan);
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
      ? `保留用户指定的“${core.listBrewProfiles().find(item => item.id === selectedProfile)?.label || selectedProfile}”，不改变冲煮法，仅重算阶段参数。`
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
  const normalized = normalizeExplicitInput(input);
  const privatePlan = await core.requestPrivatePlan(endpoint, normalized, timeoutMs);
  const optimized = optimizeBrewPlan(normalized, privatePlan);
  assertProfileIntegrity(normalized, optimized);
  return attachLegacyTrajectory(optimized);
}
