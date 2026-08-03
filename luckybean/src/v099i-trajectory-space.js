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
  return $$('#generatedPlan .plan-stage').map(card => {
    const cells = $$('.stage-cell', card);
    const value = label => {
      const cell = cells.find(item => $('span', item)?.textContent.trim() === label);
      return $('strong', cell)?.textContent.trim() || '';
    };
    const temperatures = value('壶中/粉床').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    const durationFlow = value('时间/流速').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    const duration = Math.max(1, durationFlow[0] || 1);
    const stage = {
      index: numberFrom($('.stage-index', card)?.textContent, 1),
      name: value('阶段') || `第${cells.length + 1}段`,
      method: String(card.textContent || ''),
      water: Math.max(0, numberFrom(value('本段注水'))),
      cumulative: Math.max(0, numberFrom(value('累计注水'))),
      temp: temperatures[0] || 86,
      core: temperatures[1] || temperatures[0] || 86,
      duration,
      flow: Math.max(0, durationFlow[1] || 0),
      start: elapsed,
      end: elapsed + duration
    };
    elapsed = stage.end;
    return stage;
  });
}

function pushSample(list, sample) {
  const last = list.at(-1);
  if (last && Math.abs(last.t - sample.t) < 0.01) list[list.length - 1] = { ...last, ...sample };
  else list.push(sample);
}

function buildSamples(stages) {
  const maxFlow = Math.max(1, ...stages.map(stage => stage.flow));
  const samples = [];
  let previousCumulative = 0;
  stages.forEach((stage, index) => {
    const startCumulative = Math.max(previousCumulative, stage.cumulative - stage.water);
    const endCumulative = Math.max(startCumulative, stage.cumulative || startCumulative + stage.water);
    const effectiveTemp = stage.temp * .56 + stage.core * .44;
    const duration = Math.max(1, stage.duration);
    const soakLike = /浸泡|等待|静置|停注|闷蒸/.test(`${stage.name} ${stage.method}`);
    const rawPour = stage.water > 0 && stage.flow > 0 ? stage.water / stage.flow : 0;
    const pourSeconds = soakLike && stage.water <= 0 ? 0 : clamp(rawPour, stage.water > 0 ? Math.min(2, duration * .18) : 0, duration * .72);
    const flowN = clamp(stage.flow / maxFlow, 0, 1);

    pushSample(samples, {
      t: stage.start, temp: effectiveTemp - .3, cumulative: startCumulative,
      flowN: 0, phase: index === 0 ? 'start' : 'repour', stage
    });

    if (pourSeconds > .1) {
      pushSample(samples, {
        t: stage.start + pourSeconds * .45,
        temp: effectiveTemp + .25,
        cumulative: startCumulative + (endCumulative - startCumulative) * .48,
        flowN, phase: 'pour', stage
      });
      pushSample(samples, {
        t: stage.start + pourSeconds,
        temp: effectiveTemp,
        cumulative: endCumulative,
        flowN: flowN * .82, phase: 'pour', stage
      });
    }

    const remaining = duration - pourSeconds;
    const phase = soakLike ? 'soak' : 'drain';
    if (remaining > .1) {
      pushSample(samples, {
        t: stage.end,
        temp: effectiveTemp - (phase === 'drain' ? 2.2 : 1.05),
        cumulative: endCumulative,
        flowN: 0,
        phase,
        drainN: phase === 'drain' ? 1 : 0,
        stage
      });
    } else {
      pushSample(samples, {
        t: stage.end, temp: effectiveTemp - .45, cumulative: endCumulative,
        flowN: 0, phase: 'hold', stage
      });
    }
    previousCumulative = endCumulative;
  });
  return samples.sort((a, b) => a.t - b.t);
}

const REGIONS = Object.freeze([
  { label: '明亮酸质', type: 'positive acidity', t: .22, temp: .55, water: .20, rt: .16, rtemp: .22, rwater: .18, rx: 44, ry: 15 },
  { label: '花香/挥发香', type: 'positive floral', t: .34, temp: .67, water: .32, rt: .17, rtemp: .20, rwater: .18, rx: 50, ry: 16 },
  { label: '果香', type: 'positive fruit', t: .47, temp: .68, water: .47, rt: .18, rtemp: .21, rwater: .20, rx: 50, ry: 17 },
  { label: '甜感', type: 'positive sweet', t: .61, temp: .70, water: .64, rt: .18, rtemp: .22, rwater: .20, rx: 52, ry: 17 },
  { label: '醇厚/焦糖', type: 'positive body', t: .73, temp: .75, water: .79, rt: .16, rtemp: .20, rwater: .18, rx: 50, ry: 17 },
  { label: '尖酸/生涩', type: 'risk under', t: .20, temp: .37, water: .18, rt: .16, rtemp: .18, rwater: .16, rx: 46, ry: 15 },
  { label: '干涩收敛', type: 'risk astringent', t: .77, temp: .78, water: .88, rt: .15, rtemp: .16, rwater: .14, rx: 50, ry: 17 },
  { label: '木质苦味', type: 'risk woody', t: .88, temp: .79, water: .96, rt: .14, rtemp: .18, rwater: .12, rx: 48, ry: 16 },
  { label: '焦苦', type: 'risk burnt', t: .92, temp: .94, water: .96, rt: .11, rtemp: .12, rwater: .10, rx: 43, ry: 15 }
]);

function renderTrajectory(svg) {
  if (!svg || svg.dataset.v099iTrajectory === '1') return;
  const stages = planStages();
  if (!stages.length) return;
  const samples = buildSamples(stages);
  if (samples.length < 2) return;

  const W = 820, H = 236;
  const totalTime = Math.max(1, stages.at(-1).end);
  const totalWater = Math.max(1, ...samples.map(point => point.cumulative));
  const rawTemps = samples.map(point => point.temp);
  const minTemp = Math.min(...rawTemps) - 1.5;
  const maxTemp = Math.max(...rawTemps) + 1.5;
  const tempRange = Math.max(4, maxTemp - minTemp);

  const normalized = samples.map(point => ({
    ...point,
    tN: clamp(point.t / totalTime, 0, 1),
    tempN: clamp((point.temp - minTemp) / tempRange, 0, 1),
    waterN: clamp(point.cumulative / totalWater, 0, 1)
  }));

  const projectRaw = (tN, tempN, waterN) => ({
    x: 62 + tN * 560 + waterN * 122,
    y: 182 - tempN * 96 - waterN * 58
  });
  const project = point => {
    const raw = projectRaw(point.tN, point.tempN, point.waterN);
    const activity = point.flowN > 0 ? .22 + .78 * Math.sqrt(point.flowN) : point.phase === 'soak' ? .06 : 0;
    const drain = point.phase === 'drain' ? 10 * clamp(point.drainN || 1, 0, 1) : 0;
    return { ...raw, y: raw.y - activity * 15 + drain };
  };
  const plotted = normalized.map(point => ({ ...point, ...project(point) }));

  const origin = projectRaw(0, 0, 0);
  const timeEnd = projectRaw(1, 0, 0);
  const tempEnd = projectRaw(0, 1, 0);
  const waterEnd = projectRaw(0, 0, 1);
  const axes = `
    <line class="v099i-axis" x1="${origin.x}" y1="${origin.y}" x2="${timeEnd.x}" y2="${timeEnd.y}"></line>
    <line class="v099i-axis temp" x1="${origin.x}" y1="${origin.y}" x2="${tempEnd.x}" y2="${tempEnd.y}"></line>
    <line class="v099i-axis water" x1="${origin.x}" y1="${origin.y}" x2="${waterEnd.x}" y2="${waterEnd.y}"></line>
    <text class="v099i-axis-label" x="${timeEnd.x + 5}" y="${timeEnd.y + 4}">时间</text>
    <text class="v099i-axis-label temp" x="${tempEnd.x - 7}" y="${tempEnd.y - 6}" text-anchor="end">粉床温度</text>
    <text class="v099i-axis-label water" x="${waterEnd.x + 5}" y="${waterEnd.y - 4}">累计注水量</text>`;

  const goldenCenter = projectRaw(.60, .69, .61);
  const golden = `<g class="v099i-golden-corridor"><ellipse cx="${goldenCenter.x}" cy="${goldenCenter.y}" rx="148" ry="29" transform="rotate(-8 ${goldenCenter.x} ${goldenCenter.y})"></ellipse><text x="${goldenCenter.x}" y="${goldenCenter.y - 34}" text-anchor="middle">金杯目标走廊（计划代理）</text></g>`;

  const regions = REGIONS.map(region => {
    const center = projectRaw(region.t, region.temp, region.water);
    const hit = normalized.some(point => {
      const distance = ((point.tN - region.t) / region.rt) ** 2
        + ((point.tempN - region.temp) / region.rtemp) ** 2
        + ((point.waterN - region.water) / region.rwater) ** 2;
      return distance <= 1;
    });
    return `<g class="v099i-region ${region.type} ${hit ? 'hit' : 'miss'}"><ellipse cx="${center.x}" cy="${center.y}" rx="${region.rx}" ry="${region.ry}" transform="rotate(-8 ${center.x} ${center.y})"></ellipse><text x="${center.x}" y="${center.y + 3}" text-anchor="middle">${esc(region.label)}</text></g>`;
  }).join('');

  const segments = plotted.slice(1).map((point, index) => {
    const previous = plotted[index];
    const phase = point.phase || previous.phase || 'hold';
    const width = 2.1 + Math.max(point.flowN || 0, previous.flowN || 0) * 2.8;
    const dash = phase === 'drain' ? ' stroke-dasharray="5 4"' : '';
    const opacity = phase === 'soak' ? .72 : phase === 'drain' ? .66 : .96;
    return `<line class="v099i-trajectory-segment ${phase}" x1="${previous.x}" y1="${previous.y}" x2="${point.x}" y2="${point.y}" stroke-width="${width.toFixed(2)}" opacity="${opacity}"${dash}></line>`;
  }).join('');

  const stageMarks = plotted.filter((point, index) => index === 0 || point.phase === 'repour').map(point => `<g class="v099i-stage-mark"><circle cx="${point.x}" cy="${point.y}" r="3"></circle><text x="${point.x + 5}" y="${point.y - 6}">${esc(point.stage?.name || '')}</text></g>`).join('');
  const timeTicks = stages.map(stage => {
    const point = projectRaw(stage.start / totalTime, 0, 0);
    return `<text class="v099i-time-tick" x="${point.x}" y="${origin.y + 17}" text-anchor="middle">${Math.round(stage.start)}s</text>`;
  }).join('') + `<text class="v099i-time-tick" x="${timeEnd.x}" y="${origin.y + 17}" text-anchor="middle">${Math.round(totalTime)}s</text>`;

  const positiveHits = REGIONS.filter(region => region.type.startsWith('positive') && normalized.some(point => (((point.tN - region.t) / region.rt) ** 2 + ((point.tempN - region.temp) / region.rtemp) ** 2 + ((point.waterN - region.water) / region.rwater) ** 2) <= 1)).map(region => region.label);
  const riskHits = REGIONS.filter(region => region.type.startsWith('risk') && normalized.some(point => (((point.tN - region.t) / region.rt) ** 2 + ((point.tempN - region.temp) / region.rtemp) ** 2 + ((point.waterN - region.water) / region.rwater) ** 2) <= 1)).map(region => region.label);

  svg.dataset.v099iTrajectory = '1';
  svg.dataset.v099iTrajectoryModel = 'state-space-projection-v1';
  delete svg.dataset.v098Trajectory;
  delete svg.dataset.v098TrajectoryModel;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('aria-label', '时间、粉床温度、累计注水量三维状态空间的冲煮轨迹投影');
  svg.innerHTML = `${axes}${golden}${regions}${segments}${stageMarks}${timeTicks}`;

  const shell = svg.closest('.trajectory-shell');
  const legend = $('.trajectory-legend', shell);
  if (legend) legend.innerHTML = '<span class="v099i-legend trajectory">白色：三维冲煮轨迹投影</span><span class="v099i-legend pour">粗亮：注水推进</span><span class="v099i-legend drain">白色虚线：流干衰减</span><span class="v099i-legend positive">彩色区域：正向萃取条件</span><span class="v099i-legend risk">红褐虚线：负面风险条件</span><span class="v099i-legend golden">金色：金杯计划代理区</span>';

  const note = shell?.nextElementSibling;
  if (note?.matches('.muted.small')) {
    const positiveText = positiveHits.length ? positiveHits.join('、') : '尚未穿过明显正向区域';
    const riskText = riskHits.length ? `；风险接近：${riskHits.join('、')}` : '；未明显进入负面风险区';
    note.textContent = `轨迹模型：横向为时间，纵向投影叠加粉床温度与累计注水量；流量提高使轨迹局部上扬，浸泡保持平台，流干逐渐下行，再次注水重新上升。当前计划覆盖：${positiveText}${riskText}。彩色区域是连续概率区而非单一物质的精确边界；未录入成品TDS与饮液质量时，金杯区仅为计划代理，不能视为实测萃取率。`;
  }
}

let syncTimer = 0;
function scheduleSync() {
  if (syncTimer) return;
  syncTimer = window.setTimeout(() => {
    syncTimer = 0;
    $$('.trajectory-chart.detailed:not([data-v099i-trajectory="1"])').forEach(renderTrajectory);
  }, 60);
}

const observer = new MutationObserver(records => {
  const relevant = records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (
    node.matches?.('.trajectory-chart.detailed,#generatedPlan,.trajectory-shell') || node.querySelector?.('.trajectory-chart.detailed')
  )));
  if (relevant) scheduleSync();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('click', event => {
  if (event.target.closest?.('#generatePlanBtn,#trajectoryTitleBtn,[data-page-target="brew"]')) setTimeout(scheduleSync, 80);
});
document.addEventListener('DOMContentLoaded', scheduleSync, { once: true });
scheduleSync();

globalThis.LuckyBeanTrajectorySpaceV1 = { renderTrajectory, scheduleSync };
