import { clamp } from './utils.js';

/**
 * LuckyBean intentionally stores only water profile identity, reference TDS and
 * sensory tendency. Exact ions, salts, purity and dosing belong to the 萃离 app.
 */
export const WATER_MODEL_VERSION = 'luckybean-water-selection/1.0.0';
export const WATER_EXTERNAL_APP = Object.freeze({
  id: 'brew-water-calibrato',
  name: '萃离',
  purpose: '精确矿物配比、母液和投加量调整'
});

const profile = (name, tds, tendency, note, modelHints = {}) => Object.freeze({
  name,
  tds,
  tdsMid: Math.round((tds[0] + tds[1]) / 2),
  tendency: Object.freeze({
    floral: 0, acidity: 0, sweetness: 0, body: 0, bitterness: 0, astringency: 0,
    ...tendency
  }),
  note,
  modelHints: Object.freeze({ buffer: 'medium', aromaDrive: 'medium', structure: 'medium', ...modelHints }),
  source: 'built-in-selection'
});

export const WATER_PROFILES = Object.freeze({
  geisha: profile('高萜烯花香水', [70, 100], { floral: 2, acidity: 1, body: -1, astringency: -1 }, '突出花香、茶感和清亮酸质。', { buffer: 'low', aromaDrive: 'high', structure: 'light' }),
  ethiopia: profile('花香柑橘水', [78, 108], { floral: 2, acidity: 1, sweetness: 1, body: -1 }, '适合花香、柑橘和清晰度导向。', { buffer: 'low', aromaDrive: 'high', structure: 'light' }),
  kenya: profile('高酸黑加仑水', [85, 120], { acidity: 2, floral: 1, sweetness: 1, body: 0 }, '保留黑加仑和明亮酸质，不采用强抑酸。', { buffer: 'low', aromaDrive: 'high', structure: 'medium' }),
  sweet: profile('高甜芳香水', [88, 120], { sweetness: 2, floral: 1, acidity: 0, body: 1 }, '提高甜感与芳香表达，保持适中结构。', { buffer: 'medium', aromaDrive: 'medium', structure: 'medium' }),
  washed: profile('干净平衡水', [90, 125], { floral: 1, acidity: 1, sweetness: 1, body: 0 }, '水洗豆通用平衡方案，强调洁净和酸甜平衡。'),
  honey: profile('蜜处理甜圆水', [95, 130], { sweetness: 2, body: 1, acidity: -1 }, '增强蜜甜、焦糖与圆润感。', { buffer: 'medium-high', aromaDrive: 'medium', structure: 'medium-high' }),
  natural: profile('日晒发酵平衡水', [100, 140], { sweetness: 1, body: 1, acidity: -1, astringency: -1 }, '平衡发酵感、果香与较厚口感。', { buffer: 'medium-high', aromaDrive: 'medium', structure: 'medium-high' }),
  wethulled: profile('湿刨醇厚水', [100, 140], { body: 2, acidity: -1, floral: -1 }, '偏向香料、草本和厚重体感。', { buffer: 'medium-high', aromaDrive: 'low', structure: 'high' }),
  dark: profile('深烘抑苦水', [90, 125], { sweetness: 1, bitterness: -2, astringency: -1, acidity: -1 }, '保留巧克力和焦糖，同时控制焦苦与尾段刺激。', { buffer: 'medium', aromaDrive: 'low', structure: 'medium' }),
  custom: profile('自定义水型', [85, 120], {}, '仅记录名称、TDS、风味倾向和备注；精确配方请在萃离中调整。')
});

function roastLevel(bean = {}) {
  const value = Number(String(bean.roastCode || '').replace(/\D/g, ''));
  return Number.isFinite(value) ? value : 2;
}

export function inferWaterProfile(bean = {}) {
  const roast = roastLevel(bean);
  const process = String(bean.processCode || '').toUpperCase();
  const variety = String(bean.varietyCode || '').toUpperCase();
  const country = String(bean.countryCode || '').toUpperCase();
  if (roast >= 4) return 'dark';
  if (/GE|GESHA/.test(variety)) return 'geisha';
  if (country === 'CO-KE' || /SL28|SL34/.test(variety)) return 'kenya';
  if (country === 'CO-EA' && /WA|WASH/.test(process)) return 'ethiopia';
  if (/WH|WET/.test(process) || country === 'CO-ID') return 'wethulled';
  if (/HON/.test(process)) return 'honey';
  if (/NA|ANA|CM|CARBON|FERM/.test(process)) return 'natural';
  if (/WA|WASH/.test(process)) return 'washed';
  return 'custom';
}

function direction(value) {
  const number = clamp(Number(value || 0), -2, 2);
  if (number >= 1.5) return '明显增强';
  if (number >= .5) return '略有增强';
  if (number <= -1.5) return '明显降低';
  if (number <= -.5) return '略有降低';
  return '基本不变';
}

export function tuneWaterProfile(profileId, targets = {}, customProfile = null) {
  const base = WATER_PROFILES[profileId] || WATER_PROFILES.custom;
  const custom = profileId === 'custom' && customProfile ? customProfile : null;
  const tdsValue = Number(custom?.tds);
  const tendency = {
    ...base.tendency,
    ...(custom?.tendency && typeof custom.tendency === 'object' ? custom.tendency : {})
  };
  // Targets only alter the explanatory tendency, never infer a chemical recipe.
  tendency.floral = clamp(tendency.floral + (Number(targets.floral || 1.5) - 1.5) * .25, -2, 2);
  tendency.acidity = clamp(tendency.acidity + (Number(targets.acidity || 1.5) - 1.5) * .2, -2, 2);
  tendency.sweetness = clamp(tendency.sweetness + (Number(targets.sweetness || 1.5) - 1.5) * .2, -2, 2);
  tendency.body = clamp(tendency.body + (Number(targets.body || 1.5) - 1.5) * .2, -2, 2);
  const tdsRange = Number.isFinite(tdsValue) ? [tdsValue, tdsValue] : [...base.tds];
  return {
    ...base,
    id: profileId,
    name: String(custom?.name || base.name),
    tds: tdsRange,
    tdsMid: Math.round((tdsRange[0] + tdsRange[1]) / 2),
    tendency,
    tendencyText: Object.fromEntries(Object.entries(tendency).map(([key, value]) => [key, direction(value)])),
    note: String(custom?.note || base.note),
    source: custom ? 'user-custom-selection' : base.source
  };
}

export function calculateWaterRecipe(profileId, { volumeL = 5, targets = {}, customProfile = null } = {}) {
  const selected = tuneWaterProfile(profileId, targets, customProfile);
  return {
    modelVersion: WATER_MODEL_VERSION,
    profile: selected,
    volumeL: Number(volumeL || 5),
    targetTdsRange: [...selected.tds],
    operationalTdsRange: [Math.max(0, selected.tds[0] - 8), selected.tds[1] + 8],
    tendency: { ...selected.tendency },
    externalTool: WATER_EXTERNAL_APP,
    warning: 'LuckyBean仅保存水型、参考TDS和风味倾向；不保存精确离子、盐质量或配方。精细调整请使用“萃离”。'
  };
}

export function listWaterProfiles() {
  return Object.entries(WATER_PROFILES).map(([id, value]) => ({ id, ...value }));
}
