const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

function pathPoints(path) {
  const numbers = String(path?.getAttribute('d') || '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  const points = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) points.push({ x: numbers[index], y: numbers[index + 1] });
  return points;
}

function normalizedSignal(point, sourceTop = 24, sourceHeight = 268) {
  return clamp(1 - (point.y - sourceTop) / sourceHeight, 0, 1);
}

function buildExtractionSignal(svg) {
  if (!svg || svg.dataset.v099ExtractionSignal) return;
  const floral = pathPoints($('.trajectory-series.floral', svg));
  const acidity = pathPoints($('.trajectory-series.acidity', svg));
  const sweetness = pathPoints($('.trajectory-series.sweetness', svg));
  const risk = pathPoints($('.trajectory-series.risk', svg));
  const length = Math.min(floral.length, acidity.length, sweetness.length);
  if (length < 2) return;

  const points = [];
  for (let index = 0; index < length; index += 1) {
    const floralN = normalizedSignal(floral[index]);
    const acidityN = normalizedSignal(acidity[index]);
    const sweetnessN = normalizedSignal(sweetness[index]);
    const riskN = risk[index] ? normalizedSignal(risk[index]) : 0;
    const positive = floralN * .38 + acidityN * .28 + sweetnessN * .34;
    const extraction = clamp(positive * (1 - riskN * .35), 0, 1);
    points.push({ x: floral[index].x, signal: extraction });
  }
  svg.dataset.v099ExtractionSignal = JSON.stringify(points);
  svg.dataset.v099ExtractionSource = 'modeled-positive-signal-minus-risk';
}

function applyExtractionSignal(svg) {
  if (!svg?.matches('[data-v098-trajectory="1"]')) return;
  const line = $('.v098-flavor-line', svg);
  if (!line) return;
  let points;
  try { points = JSON.parse(svg.dataset.v099ExtractionSignal || '[]'); } catch { points = []; }
  if (points.length < 2) return;

  const W = 800, left = 38, right = 14, top = 16, bottom = 32, H = 190;
  const innerW = W - left - right;
  const innerH = H - top - bottom;
  const mapped = points.map(point => {
    const xN = clamp((Number(point.x) - 42) / 660, 0, 1);
    const signal = clamp(point.signal, 0, 1);
    return `${(left + xN * innerW).toFixed(1)},${(top + innerH - signal * innerH * .88).toFixed(1)}`;
  }).join(' ');
  line.setAttribute('points', mapped);
  line.dataset.v099Signal = 'modeled-extraction';
  svg.setAttribute('aria-label', '冲煮轨迹拟合：粗白实线为正向风味释放减去风险暴露后的预测萃取轨迹');

  const shell = svg.closest('.trajectory-shell');
  const legend = $('.trajectory-legend', shell);
  const label = $('.v099-legend-trajectory', legend);
  if (label) label.textContent = '白色实线：预测萃取轨迹（重点）';
}

function sync() {
  $$('.trajectory-chart.detailed').forEach(svg => {
    buildExtractionSignal(svg);
    applyExtractionSignal(svg);
  });
}

document.addEventListener('DOMContentLoaded', sync, { once: true });
let queued = false;
new MutationObserver(() => {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    sync();
  });
}).observe(document.documentElement, { childList: true, subtree: true });
sync();

globalThis.LuckyBeanV099TrajectorySignal = { buildExtractionSignal, applyExtractionSignal };
