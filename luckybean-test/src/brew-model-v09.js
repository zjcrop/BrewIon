import { clamp } from './utils.js';

/**
 * Lucky Bean v0.9 professional calculation layer.
 *
 * The equations and decision structure were extracted from the user's independent
 * pour-over calculation tool. Only pure calculation concepts are brought into
 * Lucky Bean; the source tool's UI, storage and document structure are not copied.
 */
export const BREW_MODEL_VERSION = 'lucky-brew-model-0.9.0-beta.1';

const VARIETY_MODELS = Object.freeze({
  default: { label: '均衡阿拉比卡参考', markers: ['柠檬酸簇','糖-美拉德前体','中性挥发物'], execution: '平衡总酸骨架、挥发物保留与尾段苦味控制。', volatility: 0, solubility: 0, density: 0, bitter: 0, sensitivity: { temp: .58, alkalinity: .62, magnesium: .58, calcium: .46, tail: .60, pulse: .56 } },
  gesha: { label: '瑰夏·低阈值萜烯型', markers: ['芳樟醇','柠檬烯','香叶醇'], execution: '偏低碱度、较紧尾段截流和轻量连续脉冲，优先保护花香。', volatility: .95, solubility: -.08, density: .22, bitter: -.28, sensitivity: { temp: .95, alkalinity: .96, magnesium: .62, calcium: .74, tail: .94, pulse: .86 } },
  sl28: { label: 'SL28·磷酸触觉型', markers: ['磷酸','苹果酸','柠檬酸','含硫酯类'], execution: '允许前段略强，但压住碱度与尾段过洗，避免明亮感钝化。', volatility: .25, solubility: .08, density: .26, bitter: -.10, sensitivity: { temp: .72, alkalinity: .92, magnesium: .80, calcium: .42, tail: .74, pulse: .68 } },
  sl34: { label: 'SL34·高酸甜平衡型', markers: ['磷酸','苹果酸','柠檬酸','吡嗪/硫醇前体'], execution: '保留低碱度与偏紧尾段，同时延长中段甜感回收。', volatility: .20, solubility: .10, density: .20, bitter: -.08, sensitivity: { temp: .66, alkalinity: .86, magnesium: .70, calcium: .48, tail: .66, pulse: .62 } },
  jarc74110: { label: '74110·花果甜感型', markers: ['酯类','醛类','葫芦巴碱','蔗糖前体'], execution: '延长中段香气窗口，并适度提前收尾。', volatility: .50, solubility: .10, density: .20, bitter: -.22, sensitivity: { temp: .84, alkalinity: .78, magnesium: .74, calcium: .48, tail: .82, pulse: .78 } },
  jarc74112: { label: '74112·花香柑橘清亮型', markers: ['酯类','醛类','葫芦巴碱','蔗糖前体'], execution: '采用细密脉冲和偏低尾段温度，保持清亮度。', volatility: .58, solubility: .08, density: .22, bitter: -.24, sensitivity: { temp: .88, alkalinity: .82, magnesium: .72, calcium: .50, tail: .86, pulse: .80 } },
  jarc74158: { label: '74158·甜感浆果型', markers: ['酮类','长链酯类','蔗糖前体','发酵副产物'], execution: '允许稍厚中段和轻微更高口感，尾段及时收敛。', volatility: .36, solubility: .18, density: .18, bitter: -.08, sensitivity: { temp: .72, alkalinity: .70, magnesium: .68, calcium: .56, tail: .78, pulse: .72 } },
  pinkbourbon: { label: '粉波旁·高挥发花果型', markers: ['花香VOCs','果香酯类','近阈值有机酸簇'], execution: '优先保护花果清晰度，避免尾段甜浊。', volatility: .55, solubility: .04, density: .14, bitter: -.16, sensitivity: { temp: .82, alkalinity: .84, magnesium: .70, calcium: .58, tail: .82, pulse: .74 } },
  bourbon: { label: '波旁系·甜润平衡型', markers: ['葫芦巴碱','糖-美拉德前体','适中有机酸簇'], execution: '允许适度甜感回收与中等口感，保持主轴平衡。', volatility: .08, solubility: .10, density: .10, bitter: -.04, sensitivity: { temp: .56, alkalinity: .62, magnesium: .60, calcium: .56, tail: .58, pulse: .50 } },
  resistant: { label: '抗病/杂交系·苦味风险型', markers: ['绿原酸','咖啡因','潜在苯基茚满路径'], execution: '强化尾段降温与截流，优先降低恶性苦味路径。', volatility: -.12, solubility: .28, density: .10, bitter: .36, sensitivity: { temp: .74, alkalinity: .68, magnesium: .54, calcium: .60, tail: .96, pulse: .64 } }
});

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function varietyModelForBean(bean = {}) {
  const code = String(bean.varietyCode || '').toUpperCase();
  if (/VA-GE$|GESHA|GEISHA/.test(code)) return VARIETY_MODELS.gesha;
  if (/SL28/.test(code)) return VARIETY_MODELS.sl28;
  if (/SL34/.test(code)) return VARIETY_MODELS.sl34;
  if (/JA10|74110/.test(code)) return VARIETY_MODELS.jarc74110;
  if (/JA12|74112/.test(code)) return VARIETY_MODELS.jarc74112;
  if (/JA58|74158/.test(code)) return VARIETY_MODELS.jarc74158;
  if (/VA-PB$|PINK|SIDRA/.test(code)) return VARIETY_MODELS.pinkbourbon;
  if (/BOU|BOURBON|YB$|RB$|CATURRA|CATUAI|TYPICA|VA-CU$|VA-CA$|VA-TY$/.test(code)) return VARIETY_MODELS.bourbon;
  if (/CATIMOR|VA-CT$|RU11|BATIAN|IH90|LEM|SARCHIMOR|CEN/.test(code)) return VARIETY_MODELS.resistant;
  return VARIETY_MODELS.default;
}

export function professionalTemperatureModel(bean = {}, waterProfile = {}, targets = {}) {
  const model = varietyModelForBean(bean);
  const roast = Number(String(bean.roastCode || 'RL-L2').replace(/\D/g, '')) || 2;
  const light = ({ 0: 1, 1: .85, 2: .55, 3: .25, 4: 0, 5: -.25, 6: -.45 })[roast] ?? .55;
  const hints = waterProfile.modelHints || {};
  const buffer = String(hints.buffer || 'medium');
  const aromaDrive = String(hints.aromaDrive || 'medium');
  const tendency = waterProfile.tendency || {};
  const floral = clamp(Number(targets.floral ?? 1.5), 0, 3) / 3;
  const bitternessSuppression = clamp(Number(targets.bitterness ?? 1.5), 0, 3) / 3;
  const volatilityBias = model.volatility * .55 + floral * .42 + clamp(Number(tendency.floral || 0), -2, 2) * .08;
  const riskBias = model.sensitivity.temp * .28 + light * .35 + bitternessSuppression * .15;
  const bufferBias = /high/.test(buffer) ? -.25 : buffer === 'low' ? .12 : 0;
  const aromaBias = aromaDrive === 'high' ? -.12 : aromaDrive === 'low' ? .10 : 0;
  const mainC = round(clamp(90 - volatilityBias + riskBias + bufferBias + aromaBias, 84, 96), 1);
  const firstDrop = round(clamp(1.5 + model.sensitivity.temp * 2.7 + light * .8, 1, 5), 1);
  const tailDrop = round(clamp(.8 + model.sensitivity.tail * 2.2 + Math.max(0, model.bitter) * 1.8, 1, 4), 1);
  const tempBand = round(clamp(1.75 - model.sensitivity.temp * .8 - model.sensitivity.tail * .18, .55, 1.8), 2);
  const flowBand = round(clamp(.52 - model.sensitivity.pulse * .28, .16, .55), 2);
  const waterBand = Math.round(clamp(8 - model.sensitivity.temp * 2.1 - model.sensitivity.tail * 2.4, 3, 8));
  const levelName = value => value >= .88 ? '极高' : value >= .72 ? '高' : value >= .58 ? '中高' : value >= .42 ? '中' : '低';
  const waterAdvice = buffer === 'low'
    ? '该水型偏向明亮与香气表达，尾段需注意避免酸质尖锐。'
    : /high/.test(buffer)
      ? '该水型偏向圆润与结构，可能降低部分明亮感。'
      : '该水型以平衡表达为主，按实际杯测微调。';
  return {
    model: model.label,
    markers: model.markers || [],
    execution: model.execution || '',
    sensitivity: { ...model.sensitivity },
    sensitivityText: `温度 ${levelName(model.sensitivity.temp)} / 水型缓冲 ${buffer} / 尾段 ${levelName(model.sensitivity.tail)} / 脉冲 ${levelName(model.sensitivity.pulse)}`,
    tolerance: { temperatureC: tempBand, flowGPerSec: flowBand, waterG: waterBand },
    waterAdvice,
    mainC,
    firstC: round(clamp(mainC - firstDrop, 80, mainC), 1),
    tailC: round(clamp(mainC - tailDrop, 80, mainC), 1),
    firstDropC: firstDrop,
    tailDropC: tailDrop,
    lowFirstRecommended: model.sensitivity.temp >= .68 || light >= .55,
    tailCoolingRecommended: model.sensitivity.tail >= .65 || model.bitter > .1,
    reason: `${model.label}；温度敏感度${model.sensitivity.temp >= .8 ? '高' : '中'}，尾段敏感度${model.sensitivity.tail >= .8 ? '高' : '中'}；水型“${waterProfile.name || '未命名'}”，参考TDS ${Number(waterProfile.tdsMid || 85)}。`
  };
}
export function applyTemperatureOverrides(stages = [], model, brew = {}) {
  const firstMode = brew.firstCoolingMode || (brew.lowTempFirst === false ? 'off' : 'auto');
  const tailMode = brew.tailCoolingMode || 'auto';
  const firstCustom = Number(brew.firstTemperatureC);
  const tailCustom = Number(brew.tailTemperatureC);
  return stages.map((original, index) => {
    const item = { ...original };
    const isFirst = index === 0;
    const isTail = index === stages.length - 1;
    let temperature = Number(item.temperatureC);
    let source = 'model';
    if (isFirst) {
      if (firstMode === 'off') temperature = model.mainC;
      else if (firstMode === 'custom' && Number.isFinite(firstCustom)) { temperature = clamp(firstCustom, 78, 97); source = 'custom'; }
      else temperature = model.firstC;
    } else if (isTail) {
      if (tailMode === 'off') temperature = model.mainC;
      else if (tailMode === 'custom' && Number.isFinite(tailCustom)) { temperature = clamp(tailCustom, 78, 97); source = 'custom'; }
      else temperature = model.tailC;
    } else temperature = model.mainC;
    const coreLoss = round(clamp(1.2 + index * .18 + Number(item.drainWaitSec || 0) / 45, 1.1, 3.5), 1);
    item.temperatureC = round(temperature, 1);
    item.coreTemperatureC = round(temperature - coreLoss, 1);
    item.temperatureSource = source;
    item.coolingDeltaC = round(model.mainC - temperature, 1);
    item.point = item.drainTargetMm === 0 ? '达到目标水量立即截流' : item.drainTargetMm != null ? `液位降至粉床上方约${item.drainTargetMm}mm再进入下一段` : (isFirst ? '确保粉层完全润湿' : '保持稳定液位与流速');
    const cooling = item.coolingDeltaC > .1 ? `本段降温${item.coolingDeltaC}度` : '本段不降温';
    const notice = [cooling, item.point, item.agitation === 'gentle-swirl' ? '轻柔摇匀，避免过度扰动' : '', isTail ? '尾段注意截流，避免拖洗' : ''].filter(Boolean).join('；');
    item.notice = notice;
    item.advanceSpeech = `下一段，${item.name}，注水${Math.round(item.stageWaterG)}克，水温${Math.round(item.temperatureC)}度，${item.method}。${notice}`;
    return item;
  });
}

function stageAtProgress(stages, progress, totalTime) {
  const second = progress * totalTime;
  return stages.find(item => second <= Number(item.startSec || 0) + Number(item.durationSec || 0)) || stages.at(-1);
}

export function buildDetailedTrajectory(stages = [], totalWater = 0, flavorFit = {}, bean = {}, waterProfile = {}) {
  if (!stages.length) return { version: BREW_MODEL_VERSION, points: [], windows: [], phases: [] };
  const totalTime = Math.max(1, stages.reduce((sum, item) => sum + Number(item.durationSec || 0), 0));
  const model = varietyModelForBean(bean);
  const samples = 41;
  const points = [];
  for (let index = 0; index < samples; index += 1) {
    const x = index / (samples - 1);
    const stage = stageAtProgress(stages, x, totalTime);
    const stageStart = Number(stage.startSec || 0) / totalTime;
    const stageEnd = (Number(stage.startSec || 0) + Number(stage.durationSec || 0)) / totalTime;
    const within = clamp((x - stageStart) / Math.max(.001, stageEnd - stageStart), 0, 1);
    const previousWater = Math.max(0, Number(stage.cumulativeWaterG || 0) - Number(stage.stageWaterG || 0));
    const cumulative = previousWater + Number(stage.stageWaterG || 0) * within;
    const cumulativeN = clamp(cumulative / Math.max(1, totalWater), 0, 1);
    const temperature = Number(stage.temperatureC || 90) - within * .5;
    const flow = within > .83 ? Number(stage.flowGPerSec || 4) * (1 - (within - .83) / .17) : Number(stage.flowGPerSec || 4);
    const aromaCenter = .30 + model.volatility * .035;
    const acidCenter = .25;
    const sweetCenter = .53;
    const tailCenter = .84 - model.sensitivity.tail * .035;
    const bell = (center, spread) => Math.exp(-((x - center) ** 2) / (2 * spread ** 2));
    const floral = clamp(Number(flavorFit.floral || .5) * bell(aromaCenter, .19), 0, 1);
    const acidity = clamp(Number(flavorFit.acidity || .5) * bell(acidCenter, .20), 0, 1);
    const sweetness = clamp(Number(flavorFit.sweetness || .5) * bell(sweetCenter, .24), 0, 1);
    const body = clamp(Number(flavorFit.body || .5) * (0.35 + .65 * cumulativeN), 0, 1);
    const bitterRisk = clamp(Number(flavorFit.bitterness || .25) * (0.18 + .82 * bell(tailCenter, .17)) + Math.max(0, x - .75) * .45, 0, 1);
    points.push({
      x: round(x, 4), second: round(x * totalTime), stage: stage.index,
      temperatureC: round(temperature, 2), temperatureN: round(clamp((temperature - 78) / 20, 0, 1), 4),
      flowGPerSec: round(flow, 2), flowN: round(clamp(flow / 8, 0, 1), 4),
      cumulativeWaterG: round(cumulative), cumulativeN: round(cumulativeN, 4),
      floral: round(floral, 4), acidity: round(acidity, 4), sweetness: round(sweetness, 4), body: round(body, 4), bitterRisk: round(bitterRisk, 4)
    });
  }
  const windows = [
    { id: 'aroma', label: '花香/挥发物窗口', start: .08, end: .48, kind: 'positive' },
    { id: 'acid', label: '酸质骨架窗口', start: .12, end: .45, kind: 'positive' },
    { id: 'sweet', label: '甜感回收窗口', start: .34, end: .72, kind: 'positive' },
    { id: 'tail-risk', label: '木质/苦涩风险窗口', start: round(.72 - model.bitter * .04, 3), end: 1, kind: 'risk' }
  ];
  const phases = stages.map(item => ({
    index: item.index, label: item.name, start: round(Number(item.startSec || 0) / totalTime, 4),
    end: round((Number(item.startSec || 0) + Number(item.durationSec || 0)) / totalTime, 4)
  }));
  return {
    version: BREW_MODEL_VERSION,
    axes: { timeSec: totalTime, waterG: totalWater, temperatureC: [78, 98], flowGPerSec: [0, 8] },
    water: { name: waterProfile.name || '未命名水型', tds: Number(waterProfile.tdsMid || 85), tendency: structuredClone(waterProfile.tendency || {}), modelHints: structuredClone(waterProfile.modelHints || {}) },
    points, windows, phases
  };
}

export function targetExtractionModel({ doseG = 15, waterG = 232, bean = {}, targets = {} } = {}) {
  const model = varietyModelForBean(bean);
  const body = clamp(Number(targets.body ?? 1.5), 0, 3);
  const ey = clamp(19.1 + model.solubility * .9 + model.density * .35 + body * .12 - model.sensitivity.tail * .22, 18.0, 20.9);
  const tds = clamp((ey * Number(doseG)) / (Math.max(1, Number(waterG)) * .88), 1.05, 1.75);
  return { targetEY: round(ey, 1), predictedTds: round(tds, 2), model: model.label };
}
