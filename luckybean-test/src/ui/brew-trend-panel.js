import { listCompletedBrews } from '../domain/history/history-service.js';
import { compareAnalyses, changeReasons } from '../domain/history/history-comparison.js';

const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));

function analysisFromPlan(plan) {
  return plan?.analysisSnapshot || (plan?.analysisContract === 'brew-analysis/2.0' ? {
    contract: plan.analysisContract,
    analysisFingerprint: plan.analysisFingerprint,
    plan,
    trajectory: plan.visualization3d || plan.trajectory,
    prediction: plan.prediction,
    integrations: plan.integrations || {}
  } : null);
}

function signalRow(item) {
  return `<div class="brew-trend-row ${esc(item.direction.key)}"><span>${esc(item.label)}</span><strong>${esc(item.direction.arrow)} ${esc(item.direction.label)}</strong></div>`;
}

async function mount(plan) {
  const analysis = analysisFromPlan(plan);
  const beanId = plan?.beanId;
  if (!analysis || !beanId) return;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const host = document.querySelector('#planResult #generatedPlan') || document.querySelector('#planResult');
  if (!host) return;
  host.querySelector('[data-brew-trend-panel]')?.remove();
  const history = await listCompletedBrews({ beanId });
  const previous = history.find(record => record.analysisSnapshot?.analysisFingerprint !== analysis.analysisFingerprint);
  const panel = document.createElement('section');
  panel.className = 'brew-trend-panel';
  panel.dataset.brewTrendPanel = 'true';
  if (!previous) {
    panel.innerHTML = `<div class="brew-trend-head"><div><h3>与上次相比</h3><p>当前豆卡尚无可比较的正式冲煮记录。</p></div></div>`;
    host.append(panel);
    return;
  }
  const comparison = compareAnalyses(previous, analysis);
  const reasons = changeReasons(comparison);
  panel.innerHTML = `<div class="brew-trend-head"><div><h3>与上次相比</h3><p>${esc(comparison.headline)}</p></div><small>${esc(previous.createdAt?.slice(0,10) || '')}</small></div>
    <div class="brew-trend-grid">${comparison.signals.length ? comparison.signals.map(signalRow).join('') : '<p class="muted small">两次分析没有共同风味信号。</p>'}</div>
    ${reasons.length ? `<div class="brew-trend-reasons"><strong>主要参数变化</strong><span>${reasons.map(esc).join('；')}</span></div>` : ''}
    <p class="muted small">趋势用于比较迭代方向，不代表实验室级绝对测量。</p>`;
  host.append(panel);
}

document.addEventListener('luckybean:plan-ready', event => mount(event.detail?.plan).catch(error => console.warn('趋势比较失败', error)));
document.addEventListener('luckybean:history-plan-loaded', event => mount(event.detail?.plan).catch(error => console.warn('趋势比较失败', error)));

globalThis.LuckyBeanBrewTrend = { mount };
