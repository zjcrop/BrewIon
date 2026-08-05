const SIGNALS = Object.freeze([
  ['floral', '花香表现', false],
  ['fruity', '果香表现', false],
  ['acidity', '酸质明亮度', false],
  ['sweetness', '甜感回收', false],
  ['bitterness', '苦感风险', true],
  ['astringency', '涩感风险', true]
]);

const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

function summaryMap(analysis) {
  const map = new Map();
  for (const item of analysis?.trajectory?.summary || []) {
    const score = number(item.mean) == null && number(item.peak) == null
      ? null
      : (number(item.mean) ?? 0) * .58 + (number(item.peak) ?? 0) * .42;
    if (score != null) map.set(String(item.id), score);
  }
  const prediction = analysis?.prediction || analysis?.trajectory?.prediction || {};
  if (!map.size && prediction.suitability != null) map.set('suitability', Number(prediction.suitability));
  return map;
}

export function directionalLevel(delta, { risk = false } = {}) {
  if (!Number.isFinite(delta)) return { key: 'unknown', label: '无法比较', arrow: '·', strength: 0 };
  const effective = risk ? -delta : delta;
  if (effective >= .12) return { key: 'significant-up', label: '明显改善', arrow: '↑', strength: 2 };
  if (effective >= .04) return { key: 'slight-up', label: '略有改善', arrow: '↑', strength: 1 };
  if (effective <= -.12) return { key: 'significant-down', label: '明显减弱', arrow: '↓', strength: -2 };
  if (effective <= -.04) return { key: 'slight-down', label: '略有减弱', arrow: '↓', strength: -1 };
  return { key: 'stable', label: '基本不变', arrow: '→', strength: 0 };
}

function planOf(recordOrAnalysis) {
  return recordOrAnalysis?.analysisSnapshot?.plan || recordOrAnalysis?.plan || {};
}
function analysisOf(recordOrAnalysis) {
  return recordOrAnalysis?.analysisSnapshot || recordOrAnalysis || {};
}
function planMetric(plan, paths) {
  for (const path of paths) {
    let value = plan;
    for (const key of path.split('.')) value = value?.[key];
    const numeric = number(value);
    if (numeric != null) return numeric;
  }
  return null;
}

export function compareAnalyses(previousInput, currentInput) {
  const previous = analysisOf(previousInput);
  const current = analysisOf(currentInput);
  const previousSignals = summaryMap(previous);
  const currentSignals = summaryMap(current);
  const signals = SIGNALS.map(([id, label, risk]) => {
    const before = previousSignals.get(id);
    const after = currentSignals.get(id);
    const delta = before == null || after == null ? null : after - before;
    return { id, label, risk, before, after, delta, direction: directionalLevel(delta, { risk }) };
  }).filter(item => item.before != null || item.after != null);

  const previousPlan = planOf(previousInput);
  const currentPlan = planOf(currentInput);
  const definitions = [
    ['doseG', '粉量', ['totals.doseG','summary.dose'], 'g'],
    ['waterG', '总水量', ['totals.waterG','summary.totalWater'], 'g'],
    ['ratio', '粉水比', ['totals.ratio','summary.ratio'], ''],
    ['temperatureC', '基准水温', ['summary.basePourTemperature','totals.baseTemperatureC'], '°C'],
    ['timeSec', '目标总时间', ['totals.targetTimeSec','summary.totalTime'], 's'],
    ['grind', '研磨基准', ['grinder.recommended','summary.grinder.finalSetting'], '']
  ];
  const parameters = definitions.map(([id, label, paths, unit]) => {
    const before = planMetric(previousPlan, paths);
    const after = planMetric(currentPlan, paths);
    return { id, label, unit, before, after, delta: before == null || after == null ? null : round(after - before, 2) };
  }).filter(item => item.before != null || item.after != null);

  const improvement = signals.reduce((sum, item) => sum + item.direction.strength, 0);
  const headline = !signals.length
    ? '两次结果缺少共同的风味信号，暂不能形成方向比较。'
    : improvement >= 3
      ? '当前方案整体趋势较上次明显改善。'
      : improvement >= 1
        ? '当前方案整体趋势较上次略有改善。'
        : improvement <= -3
          ? '当前方案相较上次存在明显退化信号。'
          : improvement <= -1
            ? '当前方案相较上次有部分指标减弱。'
            : '当前方案与上次整体接近，主要变化有限。';

  return {
    previousFingerprint: previous.analysisFingerprint || '',
    currentFingerprint: current.analysisFingerprint || '',
    signals,
    parameters,
    headline,
    improvement,
    comparable: signals.some(item => item.before != null && item.after != null)
  };
}

export function changeReasons(comparison) {
  const changed = comparison.parameters.filter(item => Number.isFinite(item.delta) && Math.abs(item.delta) > .001);
  const reasons = [];
  for (const item of changed) {
    const direction = item.delta > 0 ? '提高' : '降低';
    const amount = Math.abs(item.delta);
    if (item.id === 'grind') reasons.push(`研磨基准${direction}${amount}${item.unit || '档'}`);
    else if (item.id === 'temperatureC') reasons.push(`水温${direction}${amount}${item.unit}`);
    else if (item.id === 'timeSec') reasons.push(`目标时间${direction}${amount}${item.unit}`);
    else if (item.id === 'ratio') reasons.push(`粉水比数值${direction}${amount}`);
    else reasons.push(`${item.label}${direction}${amount}${item.unit}`);
  }
  return reasons.slice(0, 4);
}
