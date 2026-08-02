import * as core from './brew-engine-core.js';
import { buildVariableTrajectory, TRAJECTORY_MODEL_VERSION } from './brew-trajectory-v096.js';

export * from './brew-engine-core.js';
export { TRAJECTORY_MODEL_VERSION } from './brew-trajectory-v096.js';

const EXPLICIT_PROFILES = new Set(['one-pour', 'two-pulse', 'three-pulse', 'four-six-v17', 'flat46-clean', 'five-pulse', 'pulse-30x15']);
const EXPECTED_STAGE_COUNTS = Object.freeze({
  'one-pour': 2,
  'two-pulse': 3,
  'three-pulse': 4,
  'four-six-v17': 5,
  'flat46-clean': 5,
  'five-pulse': 6
});

function explicitProfileId(input = {}) {
  const value = String(input.brew?.profileId || '');
  return EXPLICIT_PROFILES.has(value) ? value : '';
}

function normalizeExplicitInput(input = {}, profileId = explicitProfileId(input)) {
  const next = structuredClone(input || {});
  next.brew ||= {};
  if (!profileId) return next;
  next.brew.profileId = profileId;
  const mainPours = {
    'one-pour': 1,
    'two-pulse': 2,
    'three-pulse': 3,
    'five-pulse': 5
  }[profileId];
  if (mainPours) {
    next.brew.segmentMode = String(mainPours);
    next.brew.segments = mainPours;
  }
  return next;
}

function attachVariableTrajectory(input, plan) {
  const legacyTrajectory = Array.isArray(plan.trajectory) ? plan.trajectory : [];
  const trajectoryModel = buildVariableTrajectory(input, plan);
  plan.trajectoryModel = trajectoryModel;
  // Keep the original stage-level contract for exports and older clients.
  // The detailed 81-point curve lives only in trajectoryModel.points.
  plan.trajectory = legacyTrajectory.length === plan.stages?.length
    ? legacyTrajectory
    : (plan.stages || []).map(stage => ({
        x: Number(stage.index || 1) / Math.max(1, plan.stages.length),
        y: Number(stage.cumulativeWaterG || 0) / Math.max(1, plan.totals?.waterG || 1),
        stage: stage.index,
        label: stage.name
      }));
  plan.professional ||= {};
  plan.professional.trajectoryModel = trajectoryModel;
  plan.professional.calculationModelVersion = `${plan.professional.calculationModelVersion || plan.engineVersion || 'brew'}+${TRAJECTORY_MODEL_VERSION}`;
  plan.explanation = [
    ...(plan.explanation || []).filter(value => !String(value).includes('萃取轨迹')),
    '冲煮轨迹按实际阶段水量、流速、温度、段间等待、研磨、烘焙、处理法、品种和水质逐时间步计算；属于相对模型，不替代折光仪实测。'
  ];
  return plan;
}

function assertProfileIntegrity(input, plan) {
  const requested = explicitProfileId(input);
  const resolved = String(plan.profile?.id || String(plan.profileVersion || '').split('@')[0] || '');
  const expectedStages = EXPECTED_STAGE_COUNTS[requested];
  const actualStages = Array.isArray(plan.stages) ? plan.stages.length : 0;
  plan.profileIntegrity = {
    requestedProfileId: requested || 'recommended',
    resolvedProfileId: resolved,
    expectedStageCount: expectedStages || null,
    actualStageCount: actualStages,
    preserved: !requested || requested === resolved,
    stageCountValid: !expectedStages || expectedStages === actualStages
  };
  if (requested && requested !== resolved) {
    throw new Error(`冲煮法解析错误：已选择 ${requested}，引擎却返回 ${resolved || '未知方案'}`);
  }
  if (expectedStages && expectedStages !== actualStages) {
    throw new Error(`冲煮分段错误：${requested} 应为 ${expectedStages} 段（含闷蒸），实际为 ${actualStages} 段`);
  }
  return plan;
}

export async function computeFallbackPlan(input = {}) {
  const normalized = normalizeExplicitInput(input);
  const plan = await core.computeFallbackPlan(normalized);
  assertProfileIntegrity(normalized, plan);
  return attachVariableTrajectory(normalized, plan);
}

export async function buildCorrectedPlan(input, sensoryRecord, previousPlan = null) {
  const selectedProfile = explicitProfileId(input);
  const draft = await core.buildCorrectedPlan(input, sensoryRecord, previousPlan);
  let correctedInput = structuredClone(draft.input || input || {});
  correctedInput.brew ||= {};

  if (selectedProfile) {
    correctedInput = normalizeExplicitInput(correctedInput, selectedProfile);
    draft.correction ||= {};
    draft.correction.changes = [
      ...(draft.correction.changes || []).filter(value => !/采用|方案|分段/.test(String(value))),
      `保留用户指定的“${core.listBrewProfiles().find(item => item.id === selectedProfile)?.label || selectedProfile}”，仅调整温度、研磨、水量和风味目标。`
    ];
  }

  const rebuilt = await core.computeFallbackPlan(correctedInput);
  assertProfileIntegrity(correctedInput, rebuilt);
  attachVariableTrajectory(correctedInput, rebuilt);
  return {
    ...rebuilt,
    id: undefined,
    input: correctedInput,
    correction: {
      ...(draft.correction || {}),
      requestedProfileId: selectedProfile || correctedInput.brew.profileId || 'recommended'
    },
    warnings: [...new Set([...(rebuilt.warnings || []), ...(draft.warnings || [])])]
  };
}

export async function requestPrivatePlan(endpoint, input, timeoutMs = 9000) {
  const normalized = normalizeExplicitInput(input);
  const plan = await core.requestPrivatePlan(endpoint, normalized, timeoutMs);
  assertProfileIntegrity(normalized, plan);
  return attachVariableTrajectory(normalized, plan);
}
