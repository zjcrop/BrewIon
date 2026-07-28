import { clamp } from './utils.js';

/**
 * Coffee water profiles adapted from Brew-Water-Calibrato v2.7.
 * Values are target ion concentrations in mg/L. pH is intentionally not inferred.
 */
export const WATER_MODEL_VERSION = 'brew-water-2.7-compat-0.8.0-beta';

export const WATER_PROFILES = Object.freeze({
  geisha: { name: '高萜烯花香水', tds: [70, 100], ca: 5.5, mg: 12.0, hco3: 15, naShare: 0.32, note: '低钙、低碱度、中高镁；保留高萜烯花香、茶感和明亮酸质。' },
  ethiopia: { name: '花香柑橘水', tds: [78, 108], ca: 7.0, mg: 12.5, hco3: 20, naShare: 0.35, note: '适合埃塞水洗与花香柑橘型；镁提供香气驱动，钙仅作结构支撑。' },
  kenya: { name: '高酸黑加仑水', tds: [85, 120], ca: 7.0, mg: 15.0, hco3: 16, naShare: 0.34, note: '高镁、低碱度；保留肯尼亚型黑加仑与磷酸触觉，不采用强抑酸。' },
  sweet: { name: '高甜芳香水', tds: [88, 120], ca: 9.5, mg: 11.5, hco3: 25, naShare: 0.38, note: '浆果、热带水果和蔗糖感取向；中等钙镁，避免碱度过高造成闷甜。' },
  washed: { name: '干净平衡水', tds: [90, 125], ca: 10.0, mg: 10.5, hco3: 28, naShare: 0.40, note: '水洗豆通用平衡方案；兼顾酸甜、结构和洁净度。' },
  honey: { name: '蜜处理甜圆水', tds: [95, 130], ca: 11.0, mg: 10.0, hco3: 32, naShare: 0.42, note: '提高圆润、焦糖和蜜甜；比水洗方案稍高钙与缓冲。' },
  natural: { name: '日晒发酵平衡水', tds: [100, 140], ca: 12.0, mg: 10.5, hco3: 36, naShare: 0.44, note: '为发酵酸、酒香和厚重水果感提供中高结构与中等缓冲。' },
  wethulled: { name: '湿刨醇厚水', tds: [100, 140], ca: 14.0, mg: 8.5, hco3: 35, naShare: 0.46, note: '提高钙结构、降低镁的明亮驱动，适合香料、草本和厚重体感。' },
  dark: { name: '深烘抑苦水', tds: [90, 125], ca: 12.0, mg: 7.0, hco3: 32, naShare: 0.50, note: '保留巧克力和焦糖，同时控制焦苦、酸尖与尾段刺激。' },
  custom: { name: '自定义研究水', tds: [85, 120], ca: 9.0, mg: 12.0, hco3: 28, naShare: 0.40, note: '作为无明确匹配时的研究基准；应以实测TDS和感官结果复核。' }
});

const MW = Object.freeze({ Ca: 40.078, Mg: 24.305, Na: 22.990, K: 39.098, HCO3: 61.017 });
const SALTS = Object.freeze({
  cacl2: { name: '无水氯化钙', mw: 110.98, purity: 0.95, ion: 'Ca', ionCount: 1 },
  mgso4: { name: '无水硫酸镁', mw: 120.37, purity: 0.99, ion: 'Mg', ionCount: 1 },
  khco3: { name: '碳酸氢钾', mw: 100.115, purity: 0.99, ion: 'HCO3', ionCount: 1 },
  nahco3: { name: '碳酸氢钠', mw: 84.006, purity: 0.99, ion: 'HCO3', ionCount: 1 }
});

function doseForIon(targetMgL, volumeL, salt, share = 1) {
  const ionMassG = Math.max(0, Number(targetMgL)) * Math.max(0, Number(volumeL)) / 1000 * share;
  const ionMoles = ionMassG / MW[salt.ion];
  return ionMoles / salt.ionCount * salt.mw / salt.purity;
}

export function inferWaterProfile(bean = {}) {
  const roast = Number(String(bean.roastCode || '').replace(/\D/g, ''));
  const process = String(bean.processCode || '').toUpperCase();
  const variety = String(bean.varietyCode || '').toUpperCase();
  const country = String(bean.countryCode || '').toUpperCase();
  if (Number.isFinite(roast) && roast >= 4) return 'dark';
  if (/GE|GESHA/.test(variety)) return 'geisha';
  if (country === 'CO-KE' || /SL28|SL34/.test(variety)) return 'kenya';
  if (country === 'CO-EA' && /WA|WASH/.test(process)) return 'ethiopia';
  if (/WH|WET/.test(process) || country === 'CO-ID') return 'wethulled';
  if (/HON/.test(process)) return 'honey';
  if (/NA|ANA|CM|CARBON|FERM/.test(process)) return 'natural';
  if (/WA|WASH/.test(process)) return 'washed';
  return 'custom';
}

export function tuneWaterProfile(profileId, targets = {}) {
  const base = WATER_PROFILES[profileId] || WATER_PROFILES.custom;
  const floral = clamp(targets.floral ?? 1, 0, 3) / 3;
  const acidity = clamp(targets.acidity ?? 1, 0, 3) / 3;
  const sweetness = clamp(targets.sweetness ?? 1, 0, 3) / 3;
  const body = clamp(targets.body ?? 1, 0, 3) / 3;
  const ca = clamp(base.ca + 2.1 * sweetness + 1.4 * body - 1.8 * floral, 4, 18);
  const mg = clamp(base.mg + 2.6 * floral + 1.2 * acidity - 1.5 * body, 5, 22);
  const hco3 = clamp(base.hco3 + 6 * body + 4 * sweetness - 5 * floral - 3 * acidity, 10, 48);
  const tdsMid = Math.round((base.tds[0] + base.tds[1]) / 2);
  return { ...base, id: profileId, ca: Number(ca.toFixed(1)), mg: Number(mg.toFixed(1)), hco3: Number(hco3.toFixed(1)), tdsMid };
}

export function calculateWaterRecipe(profileId, { volumeL = 5, targets = {} } = {}) {
  const profile = tuneWaterProfile(profileId, targets);
  const naShare = clamp(profile.naShare, 0.25, 0.65);
  const doses = [
    { id: 'cacl2', ...SALTS.cacl2, grams: doseForIon(profile.ca, volumeL, SALTS.cacl2) },
    { id: 'mgso4', ...SALTS.mgso4, grams: doseForIon(profile.mg, volumeL, SALTS.mgso4) },
    { id: 'khco3', ...SALTS.khco3, grams: doseForIon(profile.hco3, volumeL, SALTS.khco3, 1 - naShare) },
    { id: 'nahco3', ...SALTS.nahco3, grams: doseForIon(profile.hco3, volumeL, SALTS.nahco3, naShare) }
  ].map(item => ({ ...item, grams: Number(item.grams.toFixed(4)) }));
  const totalDoseG = Number(doses.reduce((sum, item) => sum + item.grams, 0).toFixed(4));
  return {
    modelVersion: WATER_MODEL_VERSION,
    profile,
    volumeL,
    targetIonsMgL: { calcium: profile.ca, magnesium: profile.mg, bicarbonate: profile.hco3 },
    targetTdsRange: profile.tds,
    operationalTdsRange: [Math.max(5, profile.tds[0] - 8), profile.tds[1] + 8],
    doses,
    totalDoseG,
    warning: 'TDS为电导换算量；pH不能由TDS或HCO₃⁻可靠反推，需实测。粉剂纯度、吸潮和称量误差会改变实际结果。'
  };
}

export function listWaterProfiles() {
  return Object.entries(WATER_PROFILES).map(([id, profile]) => ({ id, ...profile }));
}
