import { clamp } from './utils.js';

export const TRAJECTORY_MODEL_VERSION = 'lucky-trajectory-0.9.6-variable.1';

const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

function roastLevel(bean = {}) {
  const fromCode = Number(String(bean.roastCode || '').replace(/\D/g, ''));
  if (Number.isFinite(fromCode)) return clamp(fromCode, 0, 6);
  const agtron = Number(bean.roastColor || bean.agtron || 0);
  if (!agtron) return 2;
  if (agtron >= 95) return 0;
  if (agtron >= 85) return 1;
  if (agtron >= 75) return 2;
  if (agtron >= 65) return 3;
  if (agtron >= 55) return 4;
  if (agtron >= 45) return 5;
  return 6;
}

function processFactors(code = '') {
  const value = String(code).toUpperCase();
  return {
    washed: /WA|WASH/.test(value) ? 1 : 0,
    natural: /NA|NAT|DRY|ANA|CARBON|CM|FERM/.test(value) ? 1 : 0,
    honey: /HON/.test(value) ? 1 : 0,
    wetHulled: /WH|WET/.test(value) ? 1 : 0
  };
}

function varietyFactors(code = '') {
  const value = String(code).toUpperCase();
  if (/GEISHA|GESHA|VA-GE/.test(value)) return { volatility: 1.18, solubility: 0.94, bitterness: 0.82, density: 1.08 };
  if (/SL28|SL34/.test(value)) return { volatility: 1.05, solubility: 1.03, bitterness: 0.92, density: 1.07 };
  if (/74110|74112|74158|JA10|JA12|JA58/.test(value)) return { volatility: 1.10, solubility: 1.04, bitterness: 0.88, density: 1.04 };
  if (/CATIMOR|SARCHIMOR|BATIAN|RUIRU|IH90/.test(value)) return { volatility: 0.92, solubility: 1.10, bitterness: 1.18, density: 1.02 };
  return { volatility: 1, solubility: 1, bitterness: 1, density: 1 };
}

function profileFactors(id = '') {
  return {
    'one-pour': { bypass: 1.08, agitation: 1.02, tail: 0.94 },
    'two-pulse': { bypass: 1.00, agitation: 1.00, tail: 0.96 },
    'three-pulse': { bypass: 0.96, agitation: 1.04, tail: 0.98 },
    'four-six-v17': { bypass: 0.94, agitation: 1.06, tail: 1.02 },
    'flat46-clean': { bypass: 0.88, agitation: 1.05, tail: 0.92 },
    'five-pulse': { bypass: 0.93, agitation: 1.09, tail: 1.08 },
    'pulse-30x15': { bypass: 0.95, agitation: 1.08, tail: 1.04 }
  }[id] || { bypass: 1, agitation: 1, tail: 1 };
}

function stageAtSecond(stages, second) {
  return stages.find(stage => second < Number(stage.startSec || 0) + Number(stage.durationSec || 0)) || stages.at(-1);
}

function peakWindow(points, key, width = 0.13) {
  let peak = points[0] || { x: 0 };
  for (const point of points) if (Number(point[key] || 0) > Number(peak[key] || 0)) peak = point;
  return { start: round(clamp(peak.x - width, 0, 1), 4), end: round(clamp(peak.x + width, 0, 1), 4) };
}

export function buildVariableTrajectory(input = {}, plan = {}) {
  const stages = (plan.stages || []).map(stage => ({ ...stage }));
  if (!stages.length) return { version: TRAJECTORY_MODEL_VERSION, points: [], windows: [], phases: [], drivers: {} };

  const bean = input.bean || {};
  const brew = input.brew || {};
  const targets = input.targets || {};
  const water = plan.water?.profile || input.water?.customProfile || {};
  const profileId = plan.profile?.id || brew.profileId || 'recommended';
  const totalWater = Number(plan.totals?.waterG || stages.at(-1)?.cumulativeWaterG || 0);
  const dose = Number(plan.totals?.doseG || brew.doseG || 15);
  const ratio = Number(plan.totals?.ratio || brew.ratio || (totalWater / Math.max(1, dose)));
  const totalTime = Math.max(1, stages.reduce((sum, stage) => Math.max(sum, Number(stage.startSec || 0) + Number(stage.durationSec || 0)), 0));
  const roast = roastLevel(bean);
  const process = processFactors(bean.processCode);
  const variety = varietyFactors(bean.varietyCode);
  const profile = profileFactors(profileId);
  const mg = Number(water.mg || 0);
  const ca = Number(water.ca || 0);
  const hco3 = Number(water.hco3 || 0);
  const tds = Number(water.tdsMid || (Array.isArray(water.tds) ? (Number(water.tds[0]) + Number(water.tds[1])) / 2 : water.tds) || 85);
  const grindTune = Number(brew.grindTune || 0);
  const temperatureTune = Number(brew.temperatureTune || 0);
  const grinderValue = Number(plan.grinder?.recommended);
  const grinderFactor = clamp(1.04 - grindTune * 0.055 + (Number.isFinite(grinderValue) ? 0 : 0), 0.72, 1.34);
  const roastSolubility = clamp(0.82 + roast * 0.075, 0.78, 1.28);
  const mineralDrive = clamp(0.88 + mg * 0.006 + ca * 0.0025 - Math.max(0, hco3 - 38) * 0.0022, 0.72, 1.22);
  const tdsDrive = clamp(1.08 - Math.max(0, tds - 105) * 0.0018 - Math.max(0, 45 - tds) * 0.002, 0.82, 1.10);
  const bedFactor = clamp((15 / Math.max(6, dose)) ** 0.16 * (15.5 / Math.max(8, ratio)) ** 0.08, 0.84, 1.18);
  const processSolubility = 1 + process.natural * 0.035 + process.honey * 0.018 + process.wetHulled * 0.045 - process.washed * 0.01;
  const targetFloral = clamp(Number(targets.floral ?? 1.5) / 3, 0, 1);
  const targetAcidity = clamp(Number(targets.acidity ?? 1.5) / 3, 0, 1);
  const targetSweetness = clamp(Number(targets.sweetness ?? 1.5) / 3, 0, 1);
  const targetBody = clamp(Number(targets.body ?? 1.5) / 3, 0, 1);
  const suppressBitterness = clamp(Number(targets.bitterness ?? 1.5) / 3, 0, 1);
  const targetEY = Number(plan.extractionModel?.targetEY || plan.professional?.extractionModel?.targetEY || 19.2);

  const samples = 81;
  const dt = totalTime / (samples - 1);
  let released = 0;
  let lastCumulative = 0;
  const points = [];

  for (let index = 0; index < samples; index += 1) {
    const second = index * dt;
    const x = index / (samples - 1);
    const stage = stageAtSecond(stages, second);
    const stageStart = Number(stage.startSec || 0);
    const duration = Math.max(1, Number(stage.durationSec || 1));
    const withinSec = clamp(second - stageStart, 0, duration);
    const flow = Math.max(0.1, Number(stage.flowGPerSec || 4));
    const pourDuration = clamp(Number(stage.stageWaterG || 0) / flow, 0.5, duration);
    const pouredFraction = clamp(withinSec / pourDuration, 0, 1);
    const previousWater = Math.max(0, Number(stage.cumulativeWaterG || 0) - Number(stage.stageWaterG || 0));
    const cumulative = clamp(previousWater + Number(stage.stageWaterG || 0) * pouredFraction, 0, totalWater);
    const activeFlow = withinSec <= pourDuration ? flow : 0;
    const waitFraction = withinSec > pourDuration ? (withinSec - pourDuration) / Math.max(1, duration - pourDuration) : 0;
    const kettleTemp = Number(stage.temperatureC || 90) + temperatureTune * 0.15;
    const coreBase = Number(stage.coreTemperatureC ?? kettleTemp - 1.5);
    const coreTemp = coreBase - 0.65 * (withinSec / duration) - waitFraction * 0.9;
    const tempDrive = clamp(Math.exp((coreTemp - 88) / 24), 0.63, 1.50);
    const freshWater = clamp((cumulative - lastCumulative) / Math.max(1, totalWater / 12), 0, 1.5);
    const saturation = clamp(released / Math.max(0.001, targetEY / 100), 0, 1.2);
    const agitation = stage.agitation && stage.agitation !== 'none' ? 1.10 : 1;
    const hydraulic = clamp((activeFlow ? (0.72 + activeFlow / 12) : 0.48 + waitFraction * 0.09) * profile.bypass, 0.38, 1.32);
    const stageDrive = tempDrive * grinderFactor * roastSolubility * processSolubility * variety.solubility * mineralDrive * tdsDrive * bedFactor * agitation * profile.agitation * hydraulic;
    const depletion = clamp(1.06 - saturation * 0.78, 0.12, 1.06);
    const releaseRate = 0.00044 * stageDrive * depletion * (0.42 + freshWater * 0.58);
    if (index > 0) released += releaseRate * dt;
    released = clamp(released, 0, targetEY / 100 * 1.12);
    lastCumulative = cumulative;

    const extractionN = clamp(released / Math.max(0.001, targetEY / 100), 0, 1);
    const waterN = clamp(cumulative / Math.max(1, totalWater), 0, 1);
    const early = Math.exp(-((extractionN - 0.25) ** 2) / (2 * 0.19 ** 2));
    const mid = Math.exp(-((extractionN - 0.55) ** 2) / (2 * 0.22 ** 2));
    const late = Math.exp(-((extractionN - 0.83) ** 2) / (2 * 0.17 ** 2));
    const tempAroma = clamp(1.18 - Math.max(0, coreTemp - 91) * 0.035 - Math.max(0, 84 - coreTemp) * 0.025, 0.55, 1.18);
    const bufferPenalty = clamp(1 - Math.max(0, hco3 - 35) * 0.006, 0.58, 1);
    const floral = clamp((0.28 + targetFloral * 0.72) * variety.volatility * tempAroma * early * (0.92 + mg * 0.006), 0, 1);
    const acidity = clamp((0.30 + targetAcidity * 0.70) * early * bufferPenalty * (0.94 + process.washed * 0.08), 0, 1);
    const sweetness = clamp((0.26 + targetSweetness * 0.74) * mid * (0.92 + process.natural * 0.10 + process.honey * 0.07) * (1 - Math.max(0, coreTemp - 94) * 0.018), 0, 1);
    const body = clamp((0.22 + targetBody * 0.62) * (0.25 + extractionN * 0.75) * (1.04 - profile.bypass * 0.08), 0, 1);
    const bitterRisk = clamp((0.12 + roast * 0.055 + variety.bitterness * 0.08) * late * profile.tail * (1.05 + Math.max(0, coreTemp - 90) * 0.025) + Math.max(0, extractionN - 0.88) * 1.8 - suppressBitterness * 0.12, 0, 1);
    const astringency = clamp(bitterRisk * 0.68 + Math.max(0, activeFlow - 5.5) * 0.035 + Math.max(0, Number(stage.drainWaitSec || 0) - 20) * 0.003, 0, 1);

    points.push({
      x: round(x, 4), second: round(second, 1), stage: Number(stage.index || 1),
      temperatureC: round(coreTemp, 2), temperatureN: round(clamp((coreTemp - 78) / 20, 0, 1), 4),
      flowGPerSec: round(activeFlow, 2), flowN: round(clamp(activeFlow / 8, 0, 1), 4),
      cumulativeWaterG: round(cumulative, 1), cumulativeN: round(waterN, 4),
      extractionEY: round(released * 100, 2), extractionN: round(extractionN, 4),
      floral: round(floral, 4), acidity: round(acidity, 4), sweetness: round(sweetness, 4), body: round(body, 4),
      bitterRisk: round(bitterRisk, 4), astringency: round(astringency, 4)
    });
  }

  const aromaWindow = peakWindow(points, 'floral', 0.12);
  const acidWindow = peakWindow(points, 'acidity', 0.12);
  const sweetWindow = peakWindow(points, 'sweetness', 0.14);
  const riskStart = points.find(point => point.bitterRisk >= 0.28 || point.extractionN >= 0.86)?.x ?? 0.78;
  const phases = stages.map(stage => ({
    index: stage.index,
    label: stage.name,
    start: round(Number(stage.startSec || 0) / totalTime, 4),
    end: round((Number(stage.startSec || 0) + Number(stage.durationSec || 0)) / totalTime, 4)
  }));

  return {
    version: TRAJECTORY_MODEL_VERSION,
    model: 'time-stepped-variable-release',
    axes: { timeSec: round(totalTime), waterG: totalWater, temperatureC: [78, 98], flowGPerSec: [0, 8], extractionEY: targetEY },
    water: { ca, mg, hco3, tds },
    drivers: {
      profileId, doseG: dose, ratio, roastLevel: roast, roastColor: Number(bean.roastColor || 0) || null,
      processCode: bean.processCode || '', varietyCode: bean.varietyCode || '', grindTune, temperatureTune,
      grinderFactor: round(grinderFactor, 4), mineralDrive: round(mineralDrive, 4), tdsDrive: round(tdsDrive, 4),
      bedFactor: round(bedFactor, 4), processSolubility: round(processSolubility, 4), targetEY
    },
    points,
    windows: [
      { id: 'aroma', label: '花香/挥发物窗口', ...aromaWindow, kind: 'positive' },
      { id: 'acid', label: '酸质骨架窗口', ...acidWindow, kind: 'positive' },
      { id: 'sweet', label: '甜感回收窗口', ...sweetWindow, kind: 'positive' },
      { id: 'tail-risk', label: '木质/苦涩风险窗口', start: round(clamp(riskStart, 0, 1), 4), end: 1, kind: 'risk' }
    ],
    phases
  };
}
