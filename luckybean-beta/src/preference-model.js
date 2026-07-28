import { clamp } from './utils.js';

const POSITIVE = Object.freeze({
  '白花': 1.2, '茉莉': 1.4, '玫瑰': 1.0, '橙花': 1.2, '紫罗兰': 1.0, '洋甘菊': 0.8,
  '柑橘': 0.9, '莓果': 1.0, '桃子': 0.9, '苹果': 0.7, '葡萄': 0.8, '热带水果': 1.0, '干果': 0.5,
  '蜂蜜': 0.9, '蔗糖': 0.8, '红糖': 0.7, '焦糖': 0.6, '枫糖': 0.7, '糖浆': 0.5, '太妃糖': 0.6,
  '顺滑': 1.1, '圆润': 0.9, '奶油感': 0.7, '轻盈': 0.6, '厚重': 0.4, '圆润舒适': 1.1,
  '低': 0.5, '适中': 0.8, '高': 0.9, '微酸': 0.7
});
const NEGATIVE = Object.freeze({
  '尖锐': 2.5, '偏高': 1.8, '焦苦': 3.2, '干涩': 2.8, '收敛': 2.3,
  '纸味': 3.0, '木质': 2.2, '土味': 3.2, '霉味': 5.0, '发酵过度': 3.5,
  '药感': 3.4, '橡胶': 4.0, '金属感': 3.8, '醋酸': 1.8
});

function flattenAnswers(answers = {}) {
  return Object.entries(answers).flatMap(([node, groups]) => Object.values(groups || {}).flat().map(value => ({ node, value: String(value) })));
}

export function computeAutomaticScore(answers = {}) {
  const values = flattenAnswers(answers);
  let score = 78;
  const uniqueNodes = new Set(values.map(item => item.node));
  score += Math.min(5, uniqueNodes.size * 0.35);
  for (const { node, value } of values) {
    if (value === '无') {
      if (node === 'negative') score += 2.4;
      if (node === 'bitter') score += 1.0;
      continue;
    }
    score += POSITIVE[value] || 0;
    score -= NEGATIVE[value] || 0;
    if (node === 'floral' || node === 'fruit') score += 0.35;
    if (node === 'sweet' && value === '高') score += 1.1;
    if (node === 'acid' && value === '圆润舒适') score += 1.4;
    if (node === 'bitter' && value === '低') score += 0.7;
  }
  const negativeCount = values.filter(({ value }) => NEGATIVE[value]).length;
  if (!negativeCount) score += 1.5;
  return Number(clamp(score, 50, 96).toFixed(1));
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
