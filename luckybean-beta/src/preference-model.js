import { clamp } from './utils.js';

const POSITIVE = Object.freeze({
  '白花': .45, '茉莉': .55, '玫瑰': .40, '橙花': .45, '紫罗兰': .40, '洋甘菊': .30,
  '柑橘': .35, '莓果': .40, '桃子': .35, '苹果': .25, '葡萄': .30, '热带水果': .40, '干果': .20,
  '蜂蜜': .40, '蔗糖': .35, '红糖': .30, '焦糖': .25, '枫糖': .30, '糖浆': .20, '太妃糖': .25,
  '顺滑': .60, '圆润': .45, '奶油感': .35, '轻盈': .25, '厚重': .20, '圆润舒适': .60,
  '低': .20, '适中': .35, '高': .45, '微酸': .25
});

// Defect penalties deliberately dominate positive descriptors. The structure follows
// cupping practice: clean cup is assumed; taints/faults and harshness remove several
// points at once instead of being offset by stacking positive aroma tags.
const NEGATIVE = Object.freeze({
  '尖锐': 4.0, '偏高': 3.0, '焦苦': 7.0, '干涩': 5.0, '收敛': 4.5,
  '纸味': 5.0, '木质': 4.5, '土味': 6.5, '霉味': 11.0, '发酵过度': 7.0,
  '药感': 9.0, '橡胶': 9.5, '金属感': 8.0, '醋酸': 6.0,
  '焦糊': 8.0, '青草': 4.5, '脏杯': 10.0, '异味': 8.0
});
function flattenAnswers(answers = {}) {
  return Object.entries(answers).flatMap(([node, groups]) => Object.values(groups || {}).flat().map(value => ({ node, value: String(value) })));
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
    positiveTotal += POSITIVE[value] || 0;
    defectPenalty += NEGATIVE[value] || 0;
    if (node === 'bitter' && value === '高') defectPenalty += 4;
    if (node === 'bitter' && value === '适中') defectPenalty += 1.5;
    if (node === 'mouthfeel' && /粗糙|干涩|收敛/.test(value)) defectPenalty += 2.5;
    if (node === 'acid' && /尖锐|醋酸/.test(value)) defectPenalty += 2.0;
  }
  // Positive descriptors are capped; defects remain uncapped within the final range.
  score += Math.min(5, positiveTotal);
  score -= defectPenalty;
  if (!values.some(({ value }) => NEGATIVE[value])) score += 1.5;
  return Number(clamp(score, 45, 94).toFixed(1));
}

export function sensoryPreferenceTags(record = {}, bean = {}) {
  const answerTags = flattenAnswers(record.answers || {})
    .filter(({ value }) => value && value !== '无' && !['低', '适中', '高', '微酸', '圆润舒适', '尖锐', '偏高', '焦苦'].includes(value))
    .map(({ node, value }) => `${node}:${value}`);
  const beanTags = [
    ...(bean.flavorCodes || []).map(code => `flavor:${code}`),
    bean.countryCode ? `country:${bean.countryCode}` : '',
    bean.varietyCode ? `variety:${bean.varietyCode}` : '',
    bean.processCode ? `process:${bean.processCode}` : '',
    bean.roastCode ? `roast:${bean.roastCode}` : ''
  ].filter(Boolean);
  return [...new Set([...beanTags, ...answerTags])];
}

export function preferenceContribution(record = {}) {
  const subjective = Number(record.subjectiveScore ?? record.score ?? 0);
  const auto = Number(record.autoScore ?? subjective);
  const delta = subjective - auto;
  // Subjective score establishes general preference. Positive delta is an additional
  // personal preference signal; negative delta is retained rather than discarded.
  return Number(((subjective - 70) * 0.8 + delta * 1.4).toFixed(2));
}

export function buildPreferenceModel(beans = [], records = []) {
  const beanMap = new Map(beans.map(bean => [bean.id, bean]));
  const tagScores = new Map();
  const beanStats = new Map();
  for (const record of records) {
    const bean = beanMap.get(record.beanId);
    if (!bean) continue;
    const contribution = preferenceContribution(record);
    const tags = Array.isArray(record.preferenceTags) && record.preferenceTags.length
      ? record.preferenceTags
      : sensoryPreferenceTags(record, bean);
    for (const tag of tags) tagScores.set(tag, Number(((tagScores.get(tag) || 0) + contribution).toFixed(2)));
    const stat = beanStats.get(bean.id) || { count: 0, subjectiveTotal: 0, autoTotal: 0, deltaTotal: 0, tagAffinity: 0 };
    stat.count += 1;
    stat.subjectiveTotal += Number(record.subjectiveScore ?? record.score ?? 0);
    stat.autoTotal += Number(record.autoScore ?? record.score ?? 0);
    stat.deltaTotal += Number(record.scoreDelta ?? ((record.subjectiveScore ?? record.score ?? 0) - (record.autoScore ?? record.score ?? 0)));
    beanStats.set(bean.id, stat);
  }
  for (const bean of beans) {
    const stat = beanStats.get(bean.id) || { count: 0, subjectiveTotal: 0, autoTotal: 0, deltaTotal: 0, tagAffinity: 0 };
    const tags = [
      ...(bean.flavorCodes || []).map(code => `flavor:${code}`),
      bean.countryCode ? `country:${bean.countryCode}` : '',
      bean.varietyCode ? `variety:${bean.varietyCode}` : '',
      bean.processCode ? `process:${bean.processCode}` : '',
      bean.roastCode ? `roast:${bean.roastCode}` : ''
    ].filter(Boolean);
    stat.tagAffinity = tags.reduce((sum, tag) => sum + (tagScores.get(tag) || 0), 0) / Math.max(1, tags.length);
    stat.averageSubjective = stat.count ? stat.subjectiveTotal / stat.count : 0;
    stat.averageAuto = stat.count ? stat.autoTotal / stat.count : 0;
    stat.averageDelta = stat.count ? stat.deltaTotal / stat.count : 0;
    stat.preferenceScore = Number((stat.averageSubjective * 0.62 + stat.tagAffinity * 0.30 + Math.max(-10, stat.averageDelta) * 0.08).toFixed(2));
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
