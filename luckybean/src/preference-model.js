import { clamp } from './utils.js';

export const POSITIVE_TAG_WEIGHTS = Object.freeze({
  '白花': .45, '茉莉': .55, '玫瑰': .40, '橙花': .45, '紫罗兰': .40, '洋甘菊': .30,
  '花香': .45, '果香': .40, '柑橘': .35, '莓果': .40, '桃子': .35, '苹果': .25, '葡萄': .30,
  '热带水果': .40, '干果': .20, '茶感': .30, '红茶': .25, '乌龙茶': .35, '香料': .20,
  '坚果': .18, '可可': .20, '巧克力': .24, '蜂蜜': .40, '蔗糖': .35, '红糖': .30,
  '焦糖': .25, '枫糖': .30, '糖浆': .20, '太妃糖': .25, '成熟水果': .30, '甜感清晰': .35,
  '顺滑': .60, '丝滑': .60, '圆润': .45, '奶油感': .35, '轻盈': .25, '多汁': .45,
  '饱满': .30, '厚重': .20, '茶汤感': .25, '圆润舒适': .60, '明亮': .35, '活泼': .28,
  '柔和': .30, '干净': .55, '持久': .35, '甜感延续': .40, '果香延续': .35, '茶感延续': .30,
  '低': .20, '中': .35, '强': .50, '适中': .35, '高': .45, '微酸': .25
});

// Defect penalties deliberately dominate positive descriptors. The structure follows
// cupping practice: clean cup is assumed; taints/faults and harshness remove several
// points at once instead of being offset by stacking positive aroma tags.
export const NEGATIVE_TAG_WEIGHTS = Object.freeze({
  '尖锐': 4.0, '偏高': 3.0, '焦苦': 7.0, '苦感': 2.5, '涩感': 3.5, '轻微涩': 2.0,
  '干涩': 5.0, '干燥': 3.0, '收敛': 4.5, '粗糙': 3.5, '纸味': 5.0, '木质': 4.5,
  '土味': 6.5, '霉味': 11.0, '霉腐': 12.0, '发酵过度': 7.0, '坏发酵': 8.0,
  '药感': 9.0, '橡胶': 9.5, '金属感': 8.0, '醋酸': 6.0, '醋酸感': 6.0,
  '焦糊': 8.0, '青草': 4.5, '脏杯': 10.0, '异味': 8.0, '烟熏': 4.0, '杂味': 5.0
});

function flattenAnswers(answers = {}) {
  return Object.entries(answers).flatMap(([node, groups]) => Object.values(groups || {}).flat().map(value => ({ node, value: String(value) })));
}

function summaryValues(record = {}) {
  return (Array.isArray(record.summary) ? record.summary : [])
    .flatMap(line => String(line || '').replace(/^【[^】]+】$/, '').split(/[：:/／、，,；;＞>\s]+/))
    .map(value => value.trim())
    .filter(Boolean);
}

export function recordEvaluationMode(record = {}) {
  const summary = Array.isArray(record.summary) ? record.summary.join('\n') : '';
  if (record.evaluationMode === 'professional' || /【专业品鉴】|第一雷达贡献|第二雷达贡献/.test(summary)) return 'professional';
  if (record.evaluationMode === 'note' || record.direct === true || (!Object.keys(record.answers || {}).length && record.naturalNote)) return 'note';
  return 'player';
}

function textDerivedScore(record = {}) {
  const values = [...flattenAnswers(record.answers || {}).map(item => item.value), ...summaryValues(record)];
  let score = 80;
  let positive = 0;
  let negative = 0;
  for (const value of values) {
    positive += POSITIVE_TAG_WEIGHTS[value] || 0;
    negative += NEGATIVE_TAG_WEIGHTS[value] || 0;
  }
  score += Math.min(7, positive) - negative;
  const note = String(record.naturalNote || '');
  for (const [tag, weight] of Object.entries(POSITIVE_TAG_WEIGHTS)) if (note.includes(tag)) score += Math.min(.6, weight);
  for (const [tag, weight] of Object.entries(NEGATIVE_TAG_WEIGHTS)) if (note.includes(tag)) score -= Math.min(4, weight);
  return clamp(score, 45, 94);
}

/**
 * Normalizes all three evaluation systems onto the same 0–100 cup-score scale used by
 * professional evaluation. It affects recommendation math only; it does not rewrite the
 * score originally shown to the user.
 */
export function normalizeRecommendationScore(record = {}) {
  const mode = recordEvaluationMode(record);
  const subjective = Number(record.subjectiveScore ?? record.score ?? 0);
  const automatic = Number(record.autoScore ?? subjective);
  if (mode === 'professional') {
    const raw90 = Number(record.rawScore90 ?? record.qualityRaw90 ?? record.professionalRaw90);
    if (Number.isFinite(raw90) && raw90 > 0) return Number(clamp(raw90 / 90 * 100, 0, 100).toFixed(1));
    return Number(clamp(subjective || automatic || textDerivedScore(record), 0, 100).toFixed(1));
  }
  if (mode === 'player') {
    const player = subjective || automatic || textDerivedScore(record);
    const blended = automatic ? player * .72 + automatic * .28 : player;
    return Number(clamp(blended, 45, 94).toFixed(1));
  }
  if (subjective > 0) return Number(clamp(subjective, 45, 94).toFixed(1));
  return Number(textDerivedScore(record).toFixed(1));
}

export function positiveNegativeTagCounts(record = {}) {
  const counts = { positive: new Map(), negative: new Map() };
  const values = [...flattenAnswers(record.answers || {}).map(item => item.value), ...summaryValues(record)];
  for (const value of values) {
    if (POSITIVE_TAG_WEIGHTS[value]) counts.positive.set(value, (counts.positive.get(value) || 0) + 1);
    if (NEGATIVE_TAG_WEIGHTS[value]) counts.negative.set(value, (counts.negative.get(value) || 0) + 1);
  }
  return counts;
}

export function computeAutomaticScore(answers = {}) {
  const values = flattenAnswers(answers);
  let score = 80;
  const completedNodes = new Set(values.map(item => item.node));
  score += Math.min(2.5, completedNodes.size * .2);
  let positiveTotal = 0;
  let defectPenalty = 0;
  for (const { node, value } of values) {
    if (value === '无') {
      if (node === 'negative') score += 1.0;
      if (node === 'bitter') score += .3;
      continue;
    }
    positiveTotal += POSITIVE_TAG_WEIGHTS[value] || 0;
    defectPenalty += NEGATIVE_TAG_WEIGHTS[value] || 0;
    if (node === 'bitter' && value === '高') defectPenalty += 4;
    if (node === 'bitter' && value === '适中') defectPenalty += 1.5;
    if (node === 'mouthfeel' && /粗糙|干涩|收敛/.test(value)) defectPenalty += 2.5;
    if (node === 'acid' && /尖锐|醋酸/.test(value)) defectPenalty += 2.0;
  }
  score += Math.min(5, positiveTotal);
  score -= defectPenalty;
  if (!values.some(({ value }) => NEGATIVE_TAG_WEIGHTS[value])) score += 1.5;
  return Number(clamp(score, 45, 94).toFixed(1));
}

export function sensoryPreferenceTags(record = {}, bean = {}) {
  const answerTags = flattenAnswers(record.answers || {})
    .filter(({ value }) => value && value !== '无' && !['低', '中', '强', '适中', '高', '微酸', '圆润舒适', '尖锐', '偏高', '焦苦'].includes(value))
    .map(({ node, value }) => `${node}:${value}`);
  const beanTags = [
    ...(bean.flavorCodes || []).map(code => `flavor:${code}`),
    bean.countryCode ? `country:${bean.countryCode}` : '',
    bean.varietyCode ? `variety:${bean.varietyCode}` : '',
    bean.entityCode ? `entity:${bean.entityCode}` : '',
    bean.processCode ? `process:${bean.processCode}` : '',
    bean.roastCode ? `roast:${bean.roastCode}` : '',
    (bean.roasterName || bean.roaster) ? `roaster:${String(bean.roasterName || bean.roaster).trim()}` : ''
  ].filter(Boolean);
  return [...new Set([...beanTags, ...answerTags])];
}

export function preferenceContribution(record = {}) {
  const normalized = normalizeRecommendationScore(record);
  const automatic = Number(record.autoScore ?? normalized);
  const displayed = Number(record.subjectiveScore ?? record.score ?? normalized);
  const delta = displayed - automatic;
  return Number(((normalized - 70) * .82 + delta * 1.15).toFixed(2));
}

export function buildPreferenceModel(beans = [], records = []) {
  const beanMap = new Map(beans.map(bean => [bean.id, bean]));
  const tagScores = new Map();
  const beanStats = new Map();
  for (const record of records) {
    const bean = beanMap.get(record.beanId);
    if (!bean) continue;
    const normalized = normalizeRecommendationScore(record);
    const contribution = preferenceContribution(record);
    const tags = Array.isArray(record.preferenceTags) && record.preferenceTags.length
      ? [...new Set([...record.preferenceTags, ...sensoryPreferenceTags(record, bean)])]
      : sensoryPreferenceTags(record, bean);
    for (const tag of tags) tagScores.set(tag, Number(((tagScores.get(tag) || 0) + contribution).toFixed(2)));
    const stat = beanStats.get(bean.id) || { count: 0, normalizedTotal: 0, subjectiveTotal: 0, autoTotal: 0, deltaTotal: 0, tagAffinity: 0, modes: {} };
    stat.count += 1;
    stat.normalizedTotal += normalized;
    stat.subjectiveTotal += Number(record.subjectiveScore ?? record.score ?? normalized);
    stat.autoTotal += Number(record.autoScore ?? normalized);
    stat.deltaTotal += Number(record.scoreDelta ?? ((record.subjectiveScore ?? record.score ?? normalized) - (record.autoScore ?? normalized)));
    const mode = recordEvaluationMode(record);
    stat.modes[mode] = (stat.modes[mode] || 0) + 1;
    beanStats.set(bean.id, stat);
  }
  for (const bean of beans) {
    const stat = beanStats.get(bean.id) || { count: 0, normalizedTotal: 0, subjectiveTotal: 0, autoTotal: 0, deltaTotal: 0, tagAffinity: 0, modes: {} };
    const tags = [
      ...(bean.flavorCodes || []).map(code => `flavor:${code}`),
      bean.countryCode ? `country:${bean.countryCode}` : '',
      bean.varietyCode ? `variety:${bean.varietyCode}` : '',
      bean.entityCode ? `entity:${bean.entityCode}` : '',
      bean.processCode ? `process:${bean.processCode}` : '',
      bean.roastCode ? `roast:${bean.roastCode}` : '',
      (bean.roasterName || bean.roaster) ? `roaster:${String(bean.roasterName || bean.roaster).trim()}` : ''
    ].filter(Boolean);
    stat.tagAffinity = tags.reduce((sum, tag) => sum + (tagScores.get(tag) || 0), 0) / Math.max(1, tags.length);
    stat.averageNormalized = stat.count ? stat.normalizedTotal / stat.count : 0;
    stat.averageSubjective = stat.count ? stat.subjectiveTotal / stat.count : 0;
    stat.averageAuto = stat.count ? stat.autoTotal / stat.count : 0;
    stat.averageDelta = stat.count ? stat.deltaTotal / stat.count : 0;
    stat.preferenceScore = Number((stat.averageNormalized * .66 + stat.tagAffinity * .28 + Math.max(-10, stat.averageDelta) * .06).toFixed(2));
    beanStats.set(bean.id, stat);
  }
  return { tagScores, beanStats };
}

export function recommendedBeanIds(beans = [], records = []) {
  if (!beans.length) return new Set();
  const { beanStats } = buildPreferenceModel(beans, records);
  const ranked = beans
    .map(bean => ({ id: bean.id, score: beanStats.get(bean.id)?.preferenceScore || 0 }))
    .sort((a, b) => b.score - a.score);
  const count = Math.max(1, Math.ceil(ranked.length / 3));
  const thresholdHasData = records.length > 0;
  return new Set((thresholdHasData ? ranked.slice(0, count) : []).map(item => item.id));
}
