import { clamp, sha256Hex } from './utils.js';
import { calculateWaterRecipe, inferWaterProfile, WATER_MODEL_VERSION } from './water-profiles.js';
import { BREW_MODEL_VERSION, professionalTemperatureModel, applyTemperatureOverrides, buildDetailedTrajectory, targetExtractionModel } from './brew-model-v09.js';

/**
 * Public browser-compatible brew engine for Lucky Bean.
 *
 * This module implements the same product-level capabilities and data contract as
 * the private brew-profiles service without embedding private repository credentials
 * or depending on GitHub at runtime. The exact private engine remains optional through
 * requestPrivatePlan().
 */
export const FALLBACK_ENGINE_VERSION = 'lucky-brew-0.9.0-beta.1';
export const BREW_SCHEMA_VERSION = 2;

export const BREW_PROFILES = Object.freeze([
  { id: 'recommended', label: '模型推荐', tags: ['auto'], description: '综合滤杯、烘焙、处理法和目标风味选择方案。' },
  { id: 'one-pour', label: '一刀流', tags: ['simple', 'body'], description: '闷蒸后一次完成主体注水，操作简洁、体感较强。' },
  { id: 'two-pulse', label: '两段式', tags: ['balanced', 'low-risk'], description: '闷蒸后两段完成主体与尾段收束。' },
  { id: 'three-pulse', label: '三段式', tags: ['clarity', 'aroma'], description: '闷蒸后分三段控制香气、甜感与尾段。' },
  { id: 'four-six-v17', label: '四六法', tags: ['sweetness', 'structure'], description: '前40%调整酸甜，后60%调整浓度与结构。' },
  { id: 'flat46-clean', label: '46法·平底净化', tags: ['flat-bottom', 'clean-cup', 'high-flow'], description: '平底滤杯、较细研磨、大流量短注水与低液位控制。' },
  { id: 'five-pulse', label: '五段式', tags: ['high-control', 'aroma'], description: '多段细分，适合需要精细控制香气与尾段的豆子。' },
  { id: 'pulse-30x15', label: '30g/15秒脉冲', tags: ['fixed-pulse', 'repeatable'], description: '固定水量和节拍，便于重复执行与对比。' }
]);

const PROFILE_MAP = new Map(BREW_PROFILES.map(profile => [profile.id, profile]));
const GRINDER_BASE = Object.freeze({
  c40: { label: 'Comandante C40', base: 24, unit: 'click' },
  zp6: { label: '1Zpresso ZP6', base: 4.8, unit: '格' },
  k6: { label: 'KINGrinder K6', base: 90, unit: '格' },
  c5: { label: '泰摩 C5', base: 16, unit: '格' },
  generic: { label: '通用刻度', base: 0, unit: '档' }
});

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
function roastLevel(code) {
  const value = Number(String(code || 'RL-L2').replace(/\D/g, ''));
  return Number.isFinite(value) ? clamp(value, 0, 6) : 2;
}
function processBias(code = '') {
  const value = String(code).toUpperCase();
  return {
    natural: /NA|NAT|DRY|ANA|CM|CARBON|FERM/.test(value),
    washed: /WA|WAS|WASH/.test(value),
    honey: /HON/.test(value),
    wetHulled: /WH|WET/.test(value)
  };
}
function dripperGroup(value = '') {
  const text = String(value).toLowerCase();
  if (/平底|b75|kalita|orea|april|flat/.test(text)) return 'flat';
  if (/浸泡|switch|clever|aero|immersion/.test(text)) return 'immersion';
  if (/低旁路|pulsar|tricolate|stagg/.test(text)) return 'low-bypass';
  return 'cone';
}
function grinderKey(text = '') {
  const value = String(text).toLowerCase();
  if (/c40|comandante/.test(value)) return 'c40';
  if (/zp6/.test(value)) return 'zp6';
  if (/k6|kingrinder/.test(value)) return 'k6';
  if (/c5|泰摩/.test(value)) return 'c5';
  return 'generic';
}
function target01(value, fallback = 1.5) {
  return clamp(Number.isFinite(Number(value)) ? Number(value) : fallback, 0, 3) / 3;
}

export async function inputHash(input) {
  return `sha256:${await sha256Hex(JSON.stringify(input))}`;
}

export function listBrewProfiles() {
  return BREW_PROFILES.map(profile => ({ ...profile }));
}

export function recommendProfile(input = {}) {
  const bean = input.bean || {};
  const brew = input.brew || {};
  const targets = input.targets || {};
  const level = roastLevel(bean.roastCode);
  const group = dripperGroup(brew.dripperCode);
  const floral = target01(targets.floral);
  const body = target01(targets.body);
  const sweet = target01(targets.sweetness);
  const process = processBias(bean.processCode);
  const candidates = [];
  const push = (id, score, reason) => candidates.push({ id, score: round(score, 3), reason, profile: PROFILE_MAP.get(id) });

  push('two-pulse', 0.58 + (level >= 4 ? 0.18 : 0) + (group === 'immersion' ? 0.08 : 0), '低风险、易重复，适合中深烘或需要稳定结果的场景。');
  push('three-pulse', 0.62 + floral * 0.18 + (group === 'cone' ? 0.08 : 0), '对香气与尾段有较好的分离控制。');
  push('four-six-v17', 0.60 + sweet * 0.16 + (level <= 3 ? 0.06 : -0.06), '用前40%调节酸甜、后60%调节浓度。');
  push('flat46-clean', 0.52 + (group === 'flat' ? 0.30 : -0.20) + floral * 0.08, '平底滤杯与高流量低液位策略可提升洁净度。');
  push('five-pulse', 0.50 + floral * 0.24 + (process.natural ? 0.05 : 0), '高控制、多段香气提取，但对注水稳定性要求更高。');
  push('one-pour', 0.48 + body * 0.25 + (level >= 3 ? 0.08 : 0), '操作最简，适合强调体感与快速复刻。');
  push('pulse-30x15', 0.50 + (brew.repeatability ? 0.25 : 0.04), '固定节拍便于跨次对照和训练。');

  candidates.sort((a, b) => b.score - a.score);
  return { selected: candidates[0], candidates: candidates.slice(0, 4) };
}

function resolveProfile(input) {
  const requested = String(input.brew?.profileId || input.brew?.brewStyle || 'recommended');
  if (requested !== 'recommended' && PROFILE_MAP.has(requested)) {
    return { id: requested, profile: PROFILE_MAP.get(requested), recommendation: recommendProfile(input) };
  }
  const recommendation = recommendProfile(input);
  return { id: recommendation.selected.id, profile: recommendation.selected.profile, recommendation };
}

function resolveTemperature(input, level, process, water) {
  const tune = Number(input.brew?.temperatureTune || input.tune?.temperature || 0);
  let temperature = 95 - level * 1.45;
  if (process.natural) temperature -= 0.8;
  if (process.honey) temperature -= 0.2;
  if (process.washed) temperature += 0.4;
  if (water.profile.id === 'dark') temperature -= 0.8;
  temperature += clamp(tune, -6, 6);
  return round(clamp(temperature, 82, 97), 0);
}

function resolveGrinder(input, level, group, profileId) {
  const text = input.brew?.grinder || '';
  const key = grinderKey(text);
  const spec = GRINDER_BASE[key];
  let offset = 0;
  if (level <= 1) offset -= 1;
  if (level >= 4) offset += 1;
  if (group === 'flat') offset -= 0.5;
  if (profileId === 'flat46-clean') offset -= 1;
  if (profileId === 'one-pour') offset += 0.5;
  const manual = clamp(Number(input.brew?.grindTune || 0), -4, 4);
  const value = spec.base ? round(spec.base + offset + manual, key === 'zp6' ? 1 : 0) : round(offset + manual, 1);
  return {
    model: key,
    label: spec.label,
    recommended: value,
    unit: spec.unit,
    offset: round(offset + manual, 1),
    note: key === 'generic' ? '以当前手冲中细研磨基准为0档，负值更细、正值更粗。' : `建议从 ${value}${spec.unit} 起步，按流速与品鉴结果微调。`
  };
}

function stage(index, name, water, cumulative, temp, duration, method, patternCode, flowLevel, startSec, extra = {}) {
  return {
    index,
    name,
    startSec,
    durationSec: Math.max(1, round(duration)),
    stageWaterG: Math.max(0, round(water)),
    cumulativeWaterG: Math.max(0, round(cumulative)),
    temperatureC: round(temp),
    flowGPerSec: round(extra.flowGPerSec || ({ 1: 3.0, 2: 4.4, 3: 6.0 }[flowLevel] || 4.4), 1),
    method,
    methodCode: `${patternCode}${flowLevel}`,
    drainWaitSec: round(extra.drainWaitSec || 0),
    drainTargetMm: extra.drainTargetMm ?? null,
    agitation: extra.agitation || 'none'
  };
}

function allocateByFractions(total, fractions) {
  const values = [];
  let used = 0;
  fractions.forEach((fraction, index) => {
    const value = index === fractions.length - 1 ? total - used : round(total * fraction);
    values.push(value);
    used += value;
  });
  return values;
}

function buildStages(input, profileId, totalWater, temperature, level, targets) {
  const dose = Number(input.brew?.doseG || 15);
  const lowBloom = input.brew?.lowTempFirst !== false;
  const bloomTemp = lowBloom ? Math.max(80, temperature - (level <= 1 ? 4 : 2)) : temperature;
  const bloomWater = round(clamp(dose * (level <= 1 ? 3 : 2.6), 28, 60));
  const bloomSeconds = round(clamp((level <= 1 ? 42 : 34) + Number(input.brew?.bloomTune || 0), 20, 75));
  const remaining = Math.max(0, totalWater - bloomWater);
  const floral = target01(targets.floral);
  const sweet = target01(targets.sweetness);
  const body = target01(targets.body);
  const stages = [];
  let cumulative = 0;
  let elapsed = 0;

  const add = (name, water, temp, duration, method, pattern, flow, extra = {}) => {
    cumulative += water;
    stages.push(stage(stages.length + 1, name, water, cumulative, temp, duration, method, pattern, flow, elapsed, extra));
    elapsed += stages.at(-1).durationSec;
  };

  if (profileId === 'four-six-v17' || profileId === 'flat46-clean') {
    const first40 = round(totalWater * 0.4);
    const first = round(first40 * clamp(0.50 + (sweet - 0.5) * 0.20 - (target01(targets.acidity) - 0.5) * 0.12, 0.42, 0.58));
    const second = first40 - first;
    const rear = totalWater - first40;
    const rearParts = allocateByFractions(rear, profileId === 'flat46-clean' ? [1 / 3, 1 / 3, 1 / 3] : [0.34, 0.33, 0.33]);
    add('第一投·润湿', first, bloomTemp, bloomSeconds, profileId === 'flat46-clean' ? '中心快速润湿，轻摇后等待低液位' : '中心小圈润湿全部粉层', 1, profileId === 'flat46-clean' ? 3 : 2, { drainWaitSec: profileId === 'flat46-clean' ? 22 : 0, drainTargetMm: profileId === 'flat46-clean' ? 3 : null, agitation: 'gentle-swirl' });
    add('第二投·前40%', second, temperature, 30, sweet >= 0.55 ? '中心向外绕圈，扩大甜感区间' : '外圈向中心收束，保留明亮酸质', sweet >= 0.55 ? 3 : 4, 2, { drainWaitSec: profileId === 'flat46-clean' ? 18 : 0, drainTargetMm: profileId === 'flat46-clean' ? 3 : null });
    rearParts.forEach((water, i) => add(i === rearParts.length - 1 ? '第五投·尾段截流' : `后60%·第${i + 1}投`, water, i === rearParts.length - 1 ? Math.max(82, temperature - 1) : temperature, profileId === 'flat46-clean' ? 25 : 30, i === rearParts.length - 1 ? '大水流快速收束，达到目标水量即停止拖尾' : '连续绕圈注水，控制低液位并等待接近排空', i % 2 ? 4 : 3, profileId === 'flat46-clean' ? 3 : 2, { drainWaitSec: profileId === 'flat46-clean' ? (i === rearParts.length - 1 ? 24 : 18) : 0, drainTargetMm: profileId === 'flat46-clean' ? (i === rearParts.length - 1 ? 0 : 3) : null }));
  } else if (profileId === 'pulse-30x15') {
    const first = Math.min(30, totalWater);
    add('闷蒸', first, bloomTemp, Math.max(30, bloomSeconds), '中心注水润湿，轻摇整平', 1, 2, { agitation: 'gentle-swirl' });
    let left = totalWater - first;
    let pulse = 1;
    while (left > 0) {
      const water = Math.min(30, left);
      add(`固定脉冲 ${pulse}`, water, pulse > 5 ? Math.max(82, temperature - 1) : temperature, 15, pulse % 2 ? '中心向外绕圈注水' : '外圈向中心绕圈注水', pulse % 2 ? 3 : 4, 2);
      left -= water;
      pulse += 1;
    }
  } else {
    add('闷蒸', bloomWater, bloomTemp, bloomSeconds, '中心注水润湿全部粉层，轻柔摇匀', 1, 2, { agitation: 'gentle-swirl' });
    const counts = { 'one-pour': 1, 'two-pulse': 2, 'three-pulse': 3, 'five-pulse': 5 };
    const count = counts[profileId] || clamp(Number(input.brew?.segments || 3), 1, 5);
    let fractions;
    if (count === 1) fractions = [1];
    else if (count === 2) fractions = [0.58, 0.42];
    else if (count === 3) fractions = [0.42, 0.34, 0.24];
    else if (count === 4) fractions = [0.32, 0.28, 0.22, 0.18];
    else fractions = [0.24, 0.22, 0.20, 0.18, 0.16];
    const parts = allocateByFractions(remaining, fractions);
    parts.forEach((water, i) => {
      const tail = i === parts.length - 1;
      const flowLevel = profileId === 'one-pour' ? 2 : floral > body ? 3 : 2;
      const duration = clamp(water / ({ 1: 3.0, 2: 4.4, 3: 5.8 }[flowLevel]) + (tail ? 7 : 10), 18, profileId === 'one-pour' ? 70 : 48);
      add(tail ? '尾段收束' : `主萃 ${i + 1}`, water, tail ? Math.max(82, temperature - 1) : temperature, duration, tail ? '提高流量快速收尾，达到目标水量停止拖洗' : (i % 2 ? '中心向外稳定绕圈，控制液位' : '外圈向中心连续注水，减少段间停顿'), i % 2 ? 3 : 4, flowLevel);
    });
  }
  // Correct rounding drift in a single place.
  const drift = totalWater - stages.reduce((sum, item) => sum + item.stageWaterG, 0);
  if (drift) {
    stages.at(-1).stageWaterG += drift;
    stages.at(-1).cumulativeWaterG = totalWater;
  }
  return stages;
}

function buildTrajectory(stages, totalWater, level, targets) {
  const floral = target01(targets.floral);
  const body = target01(targets.body);
  let soluble = 0.08 + (6 - level) * 0.006;
  return stages.map((item, index) => {
    const waterFraction = item.cumulativeWaterG / Math.max(1, totalWater);
    const gain = (0.24 - index * 0.024) * (0.86 + floral * 0.16 - body * 0.04);
    soluble = clamp(soluble + gain, 0.08, 0.96);
    return {
      x: round(waterFraction, 4),
      y: round(soluble, 4),
      stage: item.index,
      label: item.name,
      cumulativeWaterG: item.cumulativeWaterG,
      model: 'relative-soluble-release'
    };
  });
}

function buildFlavorFit(level, process, targets, water, profileId) {
  const profileBoost = {
    'one-pour': { body: 0.12, sweetness: 0.04 },
    'two-pulse': { sweetness: 0.05, body: 0.04 },
    'three-pulse': { floral: 0.08, acidity: 0.06 },
    'four-six-v17': { sweetness: 0.09, acidity: 0.04 },
    'flat46-clean': { floral: 0.08, acidity: 0.05 },
    'five-pulse': { floral: 0.10, acidity: 0.04 },
    'pulse-30x15': { sweetness: 0.04 }
  }[profileId] || {};
  const natural = process.natural ? 0.07 : 0;
  const waterMg = clamp((water.profile.mg - 8) / 20, -0.1, 0.4);
  const waterBuffer = clamp((water.profile.hco3 - 20) / 60, -0.1, 0.4);
  return {
    floral: round(clamp(0.42 + target01(targets.floral) * 0.38 + (level <= 2 ? 0.08 : -0.08) + waterMg * 0.10 + (profileBoost.floral || 0), 0.1, 0.98), 3),
    acidity: round(clamp(0.40 + target01(targets.acidity) * 0.38 + (level <= 2 ? 0.08 : -0.07) + waterMg * 0.08 - waterBuffer * 0.12 + (profileBoost.acidity || 0), 0.1, 0.98), 3),
    sweetness: round(clamp(0.44 + target01(targets.sweetness) * 0.36 + natural + waterBuffer * 0.06 + (profileBoost.sweetness || 0), 0.15, 0.98), 3),
    body: round(clamp(0.38 + target01(targets.body) * 0.40 + level * 0.035 + (profileBoost.body || 0), 0.15, 0.98), 3),
    bitterness: round(clamp(0.18 + level * 0.08 - target01(targets.bitterness ?? 2) * 0.12, 0.05, 0.9), 3),
    clarity: round(clamp(0.72 + (profileId === 'flat46-clean' ? 0.14 : 0) - level * 0.035 - (profileId === 'one-pour' ? 0.08 : 0), 0.25, 0.98), 3)
  };
}

function buildProfessionalModel(input, stages, profileId, grinder, water, flavorFit, recommendation) {
  const total = Number(stages.at(-1)?.cumulativeWaterG || 0);
  const averageFlow = stages.reduce((sum, item) => sum + item.flowGPerSec * item.stageWaterG, 0) / Math.max(1, total);
  const staticWait = stages.reduce((sum, item) => sum + Number(item.drainWaitSec || 0), 0);
  return {
    profile: { id: profileId, ...PROFILE_MAP.get(profileId) },
    recommendation,
    grinder,
    water,
    hydraulics: {
      dripperGroup: dripperGroup(input.brew?.dripperCode),
      averageFlowGPerSec: round(averageFlow, 2),
      totalDrainWaitSec: staticWait,
      estimatedBedRisk: staticWait > 75 ? 'medium' : 'low',
      bypassStrategy: profileId === 'flat46-clean' ? 'low-headspace' : 'standard'
    },
    flavorFit,
    modelLimitations: [
      '萃取轨迹为相对可溶物释放模型，不等同于实测萃取率或折光仪曲线。',
      'LuckyBean仅使用水型、参考TDS和风味倾向；精确配方请在“萃离”中完成。',
      '研磨刻度受磨芯校准、零点、豆密度和筛分分布影响，必须以流速和品鉴复核。'
    ]
  };
}

export async function computeFallbackPlan(input) {
  const bean = input.bean || {};
  const brew = input.brew || {};
  const targets = input.targets || {};
  const dose = round(clamp(brew.doseG || 15, 5, 40), 1);
  const ratio = round(clamp(brew.ratio || 15.5, 8, 25), 1);
  const totalWater = round(dose * ratio);
  const level = roastLevel(bean.roastCode);
  const process = processBias(bean.processCode);
  const group = dripperGroup(brew.dripperCode);
  const resolved = resolveProfile(input);
  const waterProfileId = brew.waterProfileId || input.water?.profileId || inferWaterProfile(bean);
  const customWater = waterProfileId === 'custom' && input.water?.customProfile;
  const water = calculateWaterRecipe(waterProfileId, {
    volumeL: Number(input.water?.recipeVolumeL || 5),
    targets,
    customProfile: customWater || null
  });
  const legacyTemperature = resolveTemperature(input, level, process, water);
  const temperatureModel = professionalTemperatureModel(bean, water.profile, targets);
  const temperature = Number.isFinite(Number(brew.mainTemperatureC))
    ? round(clamp(Number(brew.mainTemperatureC), 82, 97), 1)
    : round(clamp((legacyTemperature + temperatureModel.mainC) / 2, 82, 97), 1);
  temperatureModel.mainC = temperature;
  temperatureModel.firstC = round(clamp(temperature - temperatureModel.firstDropC, 78, temperature), 1);
  temperatureModel.tailC = round(clamp(temperature - temperatureModel.tailDropC, 78, temperature), 1);
  const grinder = resolveGrinder(input, level, group, resolved.id);
  const rawStages = buildStages(input, resolved.id, totalWater, temperature, level, targets);
  const stages = applyTemperatureOverrides(rawStages, temperatureModel, brew);
  const targetTimeSec = stages.reduce((sum, item) => sum + Number(item.durationSec || 0), 0);
  const flavorFit = buildFlavorFit(level, process, targets, water, resolved.id);
  const trajectory = buildTrajectory(stages, totalWater, level, targets);
  const trajectoryModel = buildDetailedTrajectory(stages, totalWater, flavorFit, bean, water.profile);
  const extractionModel = targetExtractionModel({ doseG: dose, waterG: totalWater, bean, targets });
  const professional = {
    ...buildProfessionalModel(input, stages, resolved.id, grinder, water, flavorFit, resolved.recommendation),
    calculationModelVersion: BREW_MODEL_VERSION,
    temperatureModel,
    extractionModel,
    trajectoryModel
  };
  const warnings = [];
  if (resolved.id === 'flat46-clean' && group !== 'flat') warnings.push('46法·平底净化方案优先用于平底滤杯；当前滤杯可能无法复现低液位与高流量假设。');
  if (dose < 10 || dose > 25) warnings.push('当前粉量超出主要模型校准区间，分段与研磨建议应增加人工复核。');
  if (!bean.roastColor) warnings.push('未填写烘焙色值，温度与研磨使用烘焙度区间估计。');

  return {
    schemaVersion: BREW_SCHEMA_VERSION,
    engineVersion: FALLBACK_ENGINE_VERSION,
    profileVersion: `${resolved.id}@0.9.0-beta.1`,
    inputHash: await inputHash(input),
    source: 'local-compatible-engine',
    profile: professional.profile,
    recommendation: resolved.recommendation,
    stages,
    totals: { doseG: dose, waterG: totalWater, ratio, targetTimeSec },
    temperature: { mainC: temperature, firstC: stages[0]?.temperatureC, tailC: stages.at(-1)?.temperatureC, model: temperatureModel },
    grinder,
    water,
    warnings,
    firstPourReason: brew.lowTempFirst !== false
      ? (level <= 2 ? '浅烘初段降温用于控制表层快速释放，使花香、酸质与后段甜感更易分离。' : '中深烘初段降温用于限制苦涩物质的早期释放。')
      : '首段沿用主萃温度，适合需要更强溶出推动力的设定。',
    explanation: [
      `${resolved.profile.label}由滤杯、烘焙度、处理法和目标风味共同选择。`,
      `主萃温度 ${temperature}°C，建议研磨 ${grinder.recommended}${grinder.unit}，目标水质 ${water.profile.name}。`,
      `模型目标 EY ${extractionModel.targetEY}%、预测 TDS ${extractionModel.predictedTds}%；仅作为冲煮设定参考，不能替代折光仪实测。`,
      '萃取轨迹整合温度、流量、累计注水和风味窗口；用于比较阶段相对趋势，不等同于实测浓度曲线。'
    ],
    trajectory,
    trajectoryModel,
    extractionModel,
    flavorFit,
    professional
  };
}

function detectSensoryIssues(record = {}) {
  const answers = record.answers || {};
  const flat = id => Object.values(answers[id] || {}).flat().map(String);
  const acid = flat('acid');
  const bitter = flat('bitter');
  const sweet = flat('sweet');
  const mouth = flat('mouthfeel');
  const negative = flat('negative');
  return {
    overAcid: acid.some(value => /尖锐|醋酸|过酸/.test(value)) || /过酸|酸尖/.test(record.naturalNote || ''),
    overBitter: bitter.some(value => /偏高|焦苦/.test(value)) || /过苦|焦苦/.test(record.naturalNote || ''),
    lowSweet: sweet.some(value => /无|低/.test(value)) || /甜不足|不甜/.test(record.naturalNote || ''),
    dry: mouth.some(value => /干涩|收敛/.test(value)) || negative.some(value => /木质|纸味/.test(value)) || /干涩|收敛/.test(record.naturalNote || '')
  };
}

export async function buildCorrectedPlan(input, sensoryRecord, previousPlan = null) {
  const issues = detectSensoryIssues(sensoryRecord);
  const corrected = structuredClone(input || {});
  corrected.brew ||= {};
  corrected.targets ||= {};
  corrected.tune ||= {};
  const changes = [];

  if (issues.overAcid) {
    corrected.brew.temperatureTune = clamp(Number(corrected.brew.temperatureTune || 0) + 1, -6, 6);
    corrected.targets.acidity = clamp(Number(corrected.targets.acidity ?? 1) - 0.5, 0, 3);
    corrected.targets.sweetness = clamp(Number(corrected.targets.sweetness ?? 1.5) + 0.5, 0, 3);
    changes.push('水温提高约1°C并提高甜感目标，避免仅靠提高缓冲度压平酸质。');
  }
  if (issues.overBitter) {
    corrected.brew.temperatureTune = clamp(Number(corrected.brew.temperatureTune || 0) - 2, -6, 6);
    corrected.brew.ratio = round(clamp(Number(corrected.brew.ratio || 15.5) - 0.5, 8, 25), 1);
    corrected.brew.grindTune = clamp(Number(corrected.brew.grindTune || 0) + 1, -4, 4);
    changes.push('水温降低约2°C、尾段水量收紧并建议略粗研磨，以抑制苦味和拖尾。');
  }
  if (issues.lowSweet) {
    corrected.targets.sweetness = clamp(Number(corrected.targets.sweetness ?? 1.5) + 0.8, 0, 3);
    corrected.brew.profileId = issues.overBitter ? 'two-pulse' : 'four-six-v17';
    changes.push('提高甜感权重，并优先采用两段式或四六法重排前40%注水。');
  }
  if (issues.dry) {
    corrected.brew.grindTune = clamp(Number(corrected.brew.grindTune || 0) + 1, -4, 4);
    corrected.brew.segments = clamp(Number(corrected.brew.segments || 3) - 1, 1, 5);
    corrected.brew.profileId ||= 'two-pulse';
    changes.push('减少分段并略粗研磨，降低高细粉与段间浸泡导致的收敛风险。');
  }
  if (!changes.length) changes.push('未识别到明确酸、苦、甜或干涩问题；保留原方案，仅记录主观分差。');

  const plan = await computeFallbackPlan(corrected);
  return {
    ...plan,
    id: undefined,
    input: corrected,
    correction: {
      sourcePlanId: previousPlan?.id || sensoryRecord.brewSessionId || '',
      sourceSensoryId: sensoryRecord.id || '',
      issues,
      changes,
      subjectiveScore: Number(sensoryRecord.subjectiveScore ?? sensoryRecord.score ?? 0),
      autoScore: Number(sensoryRecord.autoScore ?? 0),
      createdAt: new Date().toISOString()
    },
    warnings: [...(plan.warnings || []), '该方案由品鉴问题自动修正，属于下一次试冲建议，不能替代实际品鉴复核。']
  };
}

export async function requestPrivatePlan(endpoint, input, timeoutMs = 9000) {
  if (!endpoint) throw new Error('未配置私有冲煮 API 地址');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
      credentials: 'omit'
    });
    if (!response.ok) throw new Error(`冲煮 API HTTP ${response.status}`);
    const plan = await response.json();
    validatePlan(plan);
    return { ...plan, source: 'private-api' };
  } finally {
    clearTimeout(timer);
  }
}

export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('方案响应不是对象');
  if (![1, 2, '1.0.1'].includes(plan.schemaVersion)) throw new Error('方案 Schema 版本不兼容');
  if (!plan.engineVersion || !plan.profileVersion) throw new Error('方案缺少版本信息');
  if (!Array.isArray(plan.stages) || !plan.stages.length) throw new Error('方案缺少阶段');
  let last = 0;
  let total = 0;
  for (const item of plan.stages) {
    for (const key of ['index', 'durationSec', 'stageWaterG', 'cumulativeWaterG', 'temperatureC']) {
      if (!Number.isFinite(Number(item[key]))) throw new Error(`阶段字段 ${key} 无效`);
    }
    if (Number(item.cumulativeWaterG) < last) throw new Error('累计注水量倒退');
    if (Number(item.durationSec) <= 0 || Number(item.stageWaterG) < 0) throw new Error('阶段时间或注水量无效');
    total += Number(item.stageWaterG);
    last = Number(item.cumulativeWaterG);
  }
  if (Number.isFinite(Number(plan.totals?.waterG)) && Math.abs(total - Number(plan.totals.waterG)) > 1) {
    throw new Error('分段注水量与总量不守恒');
  }
  return plan;
}
