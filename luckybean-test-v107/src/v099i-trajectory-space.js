const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function numberFrom(text, fallback = 0) {
  const value = Number(String(text || '').match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(value) ? value : fallback;
}

function planStages() {
  let elapsed = 0;
  let previousCumulative = 0;
  return $$('#generatedPlan .plan-stage').map((card, index) => {
    const cells = $$('.stage-cell', card);
    const value = label => {
      const cell = cells.find(item => $('span', item)?.textContent.trim() === label);
      return $('strong', cell)?.textContent.trim() || '';
    };
    const temperatures = value('壶中/粉床').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    const durationFlow = value('时间/流速').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    const duration = Math.max(1, durationFlow[0] || 1);
    const water = Math.max(0, numberFrom(value('本段注水')));
    const reportedCumulative = numberFrom(value('累计注水'), previousCumulative + water);
    const cumulative = Math.max(previousCumulative, reportedCumulative || previousCumulative + water);
    const name = value('阶段') || `第${index + 1}段`;
    const stage = {
      index: numberFrom($('.stage-index', card)?.textContent, index + 1),
      name,
      water,
      cumulative,
      previousCumulative,
      temp: temperatures[0] || 90,
      core: temperatures[1] || temperatures[0] || 90,
      duration,
      flow: Math.max(0, durationFlow[1] || water / duration || 0),
      start: elapsed,
      end: elapsed + duration,
      hold: /浸泡|等待|静置|停注|焖|闷蒸/.test(name) && water <= 0
    };
    elapsed = stage.end;
    previousCumulative = cumulative;
    return stage;
  });
}

function buildSamples(stages) {
  const samples = [];
  const push = point => {
    const previous = samples.at(-1);
    if (previous && Math.abs(previous.t - point.t) < .001) samples[samples.length - 1] = point;
    else samples.push(point);
  };
  stages.forEach(stage => {
    const span = Math.max(1, stage.duration);
    const startCum = stage.previousCumulative;
    const endCum = stage.cumulative;
    const delta = Math.max(0, endCum - startCum);
    const pouring = stage.flow > .02 && delta > .1 && !stage.hold;
    push({ t: stage.start, temp: stage.temp - .35, flow: 0, cumulative: startCum, phase: stage.hold ? 'soak' : 'rest', stage });
    if (pouring) {
      push({ t: stage.start + span * .18, temp: stage.temp, flow: stage.flow * .72, cumulative: startCum + delta * .12, phase: 'pour', stage });
      push({ t: stage.start + span * .52, temp: stage.temp, flow: stage.flow, cumulative: startCum + delta * .62, phase: 'pour', stage });
      push({ t: stage.start + span * .82, temp: stage.temp - .25, flow: stage.flow * .42, cumulative: endCum, phase: 'pour', stage });
      push({ t: stage.end, temp: stage.temp - .8, flow: 0, cumulative: endCum, phase: 'drain', stage });
    } else {
      push({ t: stage.start + span * .50, temp: stage.temp - .35, flow: 0, cumulative: startCum, phase: 'soak', stage });
      push({ t: stage.end, temp: stage.temp - .75, flow: 0, cumulative: endCum, phase: 'drain', stage });
    }
  });
  return samples.sort((a, b) => a.t - b.t);
}

function windowType(label, risk = false) {
  const text = String(label || '').toLowerCase();
  if (/涩|木质|苦|焦|risk|bitter|astring/.test(text)) return 'risk';
  if (/酸|acid/.test(text)) return 'acid';
  if (/果|莓|fruit/.test(text)) return 'fruit';
  if (/甜|糖|sweet/.test(text)) return 'sweet';
  return risk ? 'risk' : 'positive';
}

function sourceWindows(svg, totalTime) {
  const clone = svg.cloneNode(true);
  const box = (clone.getAttribute('viewBox') || '0 0 800 190').split(/\s+/).map(Number);
  const sourceWidth = box[2] || 800;
  const left = 38;
  const right = Math.max(left + 1, sourceWidth - 14);
  const nodes = $$('.trajectory-peak,.trajectory-window,.v098-flavor-window', clone);
  const rows = nodes.map(group => {
    const rect = $('rect', group);
    if (!rect) return null;
    const x = Number(rect.getAttribute('x'));
    const width = Number(rect.getAttribute('width'));
    if (!Number.isFinite(x) || !Number.isFinite(width)) return null;
    const from = clamp((x - left) / (right - left), 0, 1) * totalTime;
    const to = clamp((x + width - left) / (right - left), 0, 1) * totalTime;
    const label = $('text', group)?.textContent.trim() || '风味窗口';
    const risk = group.classList.contains('risk') || /bitter|astring|risk/.test(group.className.baseVal || group.className || '') || /苦|涩|木质|焦/.test(label);
    return { label, from, to: Math.max(from + totalTime * .04, to), type: windowType(label, risk), risk };
  }).filter(Boolean);
  if (rows.length) return rows;
  return [
    { label: '明亮酸区', from: totalTime * .12, to: totalTime * .36, type: 'acid', risk: false },
    { label: '小分子花香区', from: totalTime * .24, to: totalTime * .56, type: 'positive', risk: false },
    { label: '莓果 / 果香区', from: totalTime * .40, to: totalTime * .70, type: 'fruit', risk: false },
    { label: '甜感协同区', from: totalTime * .52, to: totalTime * .80, type: 'sweet', risk: false },
    { label: '木质 / 涩感风险', from: totalTime * .70, to: totalTime * .94, type: 'risk', risk: true },
    { label: '苦味风险区', from: totalTime * .82, to: totalTime, type: 'risk', risk: true }
  ];
}

function polygon(points, upper, lower, tx) {
  const top = points.map(point => `${tx(point.t)},${upper(point)}`).join(' ');
  const bottom = [...points].reverse().map(point => `${tx(point.t)},${lower(point)}`).join(' ');
  return `${top} ${bottom}`;
}

function renderTrajectory(svg) {
  if (!svg || svg.dataset.v099jTrajectory === '1') return;
  const stages = planStages();
  if (!stages.length) return;
  const originalWindows = sourceWindows(svg, Math.max(1, stages.at(-1).end));
  const points = buildSamples(stages);
  if (points.length < 2) return;

  const W = 900, H = 420, PL = 54, PR = 24, PT = 34, IH = 250, IW = W - PL - PR;
  const totalTime = Math.max(1, points.at(-1).t);
  const totalWater = Math.max(1, ...points.map(point => point.cumulative));
  const minTemp = Math.min(...points.map(point => point.temp), 86);
  const maxTemp = Math.max(...points.map(point => point.temp), 94);
  const tempRange = Math.max(4, maxTemp - minTemp);
  const maxFlow = Math.max(1, ...points.map(point => point.flow));
  const tx = time => PL + IW * time / totalTime;
  const yTemp = value => PT + IH * (1 - ((value - minTemp) / tempRange) * .72 - .14);
  const yFlow = value => PT + IH * (1 - (value / maxFlow) * .58 - .18);
  const yWater = value => PT + IH * (1 - (value / totalWater) * .62 - .18);

  let previousActivity = 0;
  let previous = points[0];
  const computed = points.map((point, index) => {
    const timeN = point.t / totalTime;
    const tempN = clamp((point.temp - minTemp) / tempRange, 0, 1);
    const flowN = clamp(point.flow / maxFlow, 0, 1);
    const waterN = clamp(point.cumulative / totalWater, 0, 1);
    const raw = .18 * tempN + .32 * Math.sqrt(flowN) + .36 * waterN + .14 * timeN;
    let activity;
    const noNewWater = index > 0 && Math.abs(point.cumulative - previous.cumulative) < .05 && flowN < .02;
    if (!index) activity = raw * .45;
    else if (point.phase === 'soak' || noNewWater) {
      const drop = .035 * Math.max(.2, (point.t - previous.t) / totalTime * 8);
      activity = Math.max(0, Math.min(previousActivity, raw) - drop);
    } else if (point.phase === 'drain') {
      activity = Math.max(0, previousActivity - .045);
    } else {
      activity = previousActivity * .34 + raw * .66;
    }
    activity = clamp(activity, 0, 1);
    previousActivity = activity;
    previous = point;
    return { ...point, timeN, tempN, flowN, waterN, activity };
  });
  const yExtraction = value => PT + IH * (1 - value * .78 - .10);

  const bloomEnd = stages[0]?.end || totalTime * .18;
  const afterBloom = Math.max(1, totalTime - bloomEnd);
  const acidEnd = bloomEnd + afterBloom * .25;
  const aromaEnd = acidEnd + afterBloom * .38;
  const phaseRects = [
    [0, bloomEnd, 'rgba(126,219,255,.06)', '闷蒸'],
    [bloomEnd, acidEnd, 'rgba(255,164,74,.07)', '前段·酸'],
    [acidEnd, aromaEnd, 'rgba(139,240,197,.07)', '中段·香气'],
    [aromaEnd, totalTime, 'rgba(255,120,120,.06)', '尾段·收束']
  ].map(([start, end, fill, label], index) => `<rect x="${tx(start)}" y="${PT}" width="${Math.max(0, tx(end) - tx(start))}" height="${IH}" fill="${fill}"></rect><text class="v099j-phase-label" x="${(tx(start) + tx(end)) / 2}" y="${PT + 14}" text-anchor="middle" fill="${['#7edbff','#ffa44a','#8bf0c5','#ff8787'][index]}">${label}</text>`).join('');
  const grid = Array.from({ length: 5 }, (_, index) => {
    const y = PT + IH * index / 4;
    return `<line class="v099j-grid" x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}"></line>`;
  }).join('');
  const phaseLines = [bloomEnd, acidEnd, aromaEnd].map(time => `<line class="v099j-phase-line" x1="${tx(time)}" y1="${PT}" x2="${tx(time)}" y2="${PT + IH}"></line>`).join('');

  const targetLevel = { acid: .34, positive: .47, fruit: .58, sweet: .68, risk: .84 };
  const windows = originalWindows.map(window => {
    const middle = (window.from + window.to) / 2;
    const center = targetLevel[window.type] ?? .5;
    const y = yExtraction(center) - 12;
    const x = tx(window.from);
    const width = Math.max(36, tx(window.to) - x);
    const samples = computed.filter(point => point.t >= window.from && point.t <= window.to);
    const closest = samples.length ? Math.min(...samples.map(point => Math.abs(point.activity - center))) : 1;
    const hit = closest <= (window.risk ? .085 : .12);
    return { ...window, middle, center, y, x, width, height: 24, hit, closest };
  });
  const windowSvg = windows.map(window => `<g class="v099j-window ${window.type} ${window.risk ? 'risk' : 'positive'} ${window.hit ? 'hit' : 'miss'}"><rect x="${window.x}" y="${window.y}" width="${window.width}" height="${window.height}" rx="8"></rect><text x="${window.x + window.width / 2}" y="${window.y + 15}" text-anchor="middle">${esc(window.label)}</text></g>`).join('');

  const tempBand = polygon(points, point => yTemp(point.temp + 1), point => yTemp(point.temp - 1), tx);
  const flowBand = polygon(points, point => yFlow(Math.max(0, point.flow + .3)), point => yFlow(Math.max(0, point.flow - .3)), tx);
  const polyline = (rows, getter) => rows.map(point => `${tx(point.t).toFixed(1)},${getter(point).toFixed(1)}`).join(' ');
  const tempLine = polyline(points, point => yTemp(point.temp));
  const flowLine = polyline(points, point => yFlow(point.flow));
  const waterLine = polyline(points, point => yWater(point.cumulative));
  const extractionLine = polyline(computed, point => yExtraction(point.activity));
  const ticks = [...new Set(stages.map(stage => stage.start).concat(totalTime))].map(time => `<text class="v099j-time-tick" x="${tx(time)}" y="${PT + IH + 15}" text-anchor="middle">${Math.round(time)}s</text>`).join('');

  function scoreFor(type, risk = false) {
    const selected = windows.filter(window => risk ? window.risk : window.type === type);
    if (!selected.length) return risk ? 20 : 55;
    const closeness = selected.reduce((sum, item) => sum + clamp(1 - item.closest / (risk ? .25 : .28), 0, 1), 0) / selected.length;
    return Math.round(clamp(risk ? closeness * 100 : 35 + closeness * 63, 5, 98));
  }
  const fitBars = [
    ['花香保护', scoreFor('positive'), '#c7f7ff'],
    ['果香表达', scoreFor('fruit'), '#ffcf8a'],
    ['甜感回收', scoreFor('sweet'), '#b8ffd9'],
    ['苦涩风险', scoreFor('risk', true), '#ff8f9b']
  ].map((item, index) => {
    const y = 318 + index * 22;
    return `<text class="v099j-fit-label" x="${PL}" y="${y + 10}">${item[0]}</text><rect x="${PL + 78}" y="${y}" width="${IW * .52}" height="12" rx="6" fill="rgba(255,255,255,.08)"></rect><rect x="${PL + 78}" y="${y}" width="${IW * .52 * item[1] / 100}" height="12" rx="6" fill="${item[2]}" opacity=".88"></rect><text class="v099j-fit-value" x="${PL + 88 + IW * .52}" y="${y + 10}">${item[1]}</text>`;
  }).join('');

  svg.dataset.v099jTrajectory = '1';
  svg.dataset.v099jTrajectoryModel = 'v17-composite-v2';
  delete svg.dataset.v099iTrajectory;
  delete svg.dataset.v099iTrajectoryModel;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('aria-label', 'V17二维时间轴：白色综合冲煮轨迹、温度、流量、累计注水量、风味窗口和风险窗口');
  svg.innerHTML = `<rect width="${W}" height="${H}" fill="#071018"></rect>${phaseRects}${grid}${windowSvg}${phaseLines}<polygon class="v099j-temp-band" points="${tempBand}"></polygon><polygon class="v099j-flow-band" points="${flowBand}"></polygon><polyline class="v099j-water-line" points="${waterLine}"></polyline><polyline class="v099j-flow-line" points="${flowLine}"></polyline><polyline class="v099j-temp-line" points="${tempLine}"></polyline><polyline class="v099j-extraction-line" points="${extractionLine}"></polyline><text class="v099j-axis-label" x="${PL - 5}" y="${yTemp(maxTemp)}" text-anchor="end">${maxTemp}°</text><text class="v099j-axis-label" x="${PL - 5}" y="${yTemp(minTemp)}" text-anchor="end">${minTemp}°</text>${ticks}<text class="v099j-fit-title" x="${PL}" y="302">风味拟合</text>${fitBars}`;

  const shell = svg.closest('.trajectory-shell');
  const legend = $('.trajectory-legend', shell);
  if (legend) legend.innerHTML = '<span class="v099j-legend extraction">白色：综合冲煮轨迹</span><span class="v099j-legend temperature">橙色：温度</span><span class="v099j-legend flow">青色：流量</span><span class="v099j-legend water">绿色虚线：累计注水</span><span class="v099j-legend risk">红色虚框：风险窗口</span>';
  const note = shell?.nextElementSibling;
  if (note?.matches('.muted.small')) note.textContent = '白色轨迹是时间、粉床温度、流量与累计注水量的共同作用变量：升温、提高流量和继续注水会推动轨迹上升；停注浸泡不再上升；流干时逐渐下降；再次注水重新抬升。彩色框表示正向风味条件窗口，红色虚框表示木质、涩感与苦味风险窗口。图表为V17式二维拟合，不随黑白主题切换。';
}

let timer = 0;
function scheduleSync() {
  if (timer) return;
  timer = window.setTimeout(() => {
    timer = 0;
    $$('.trajectory-chart.detailed:not([data-v099j-trajectory="1"])').forEach(renderTrajectory);
  }, 70);
}

const host = document.querySelector('#brewContent') || document.documentElement;
new MutationObserver(records => {
  const relevant = records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches?.('.trajectory-chart.detailed,#generatedPlan,.trajectory-shell') || node.querySelector?.('.trajectory-chart.detailed'))));
  if (relevant) scheduleSync();
}).observe(host, { childList: true, subtree: true });
document.addEventListener('click', event => {
  if (event.target.closest?.('#generatePlanBtn,#trajectoryTitleBtn,[data-page-target="brew"]')) setTimeout(scheduleSync, 90);
});
document.addEventListener('DOMContentLoaded', scheduleSync, { once: true });
scheduleSync();

globalThis.LuckyBeanTrajectoryV17Composite = { renderTrajectory, scheduleSync };
