const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));

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
      name: value('阶段'),
      water: numberFrom(value('本段注水')),
      cumulative: numberFrom(value('累计注水')),
      temp: temperatures[0] || 86,
      core: temperatures[1] || temperatures[0] || 86,
      duration,
      flow: durationFlow[1] || 0,
      start: elapsed,
      end: elapsed + duration
    };
    elapsed = stage.end;
    return stage;
  });
}

function windowType(label, risk = false) {
  const text = String(label || '').toLocaleLowerCase('zh-CN');
  if (/涩|astring/.test(text)) return 'astringency';
  if (/苦|木质|bitter|woody/.test(text)) return 'bitter';
  if (/酸|acid/.test(text)) return 'acidity';
  if (/花|香气|floral|aroma/.test(text)) return 'floral';
  if (/果|fruit/.test(text)) return 'fruit';
  if (/甜|sweet/.test(text)) return 'sweetness';
  return risk ? 'bitter' : 'floral';
}

function sourceWindowGeometry(group, sourceLeft, sourceRight, totalTime, risk = false) {
  const rect = $('rect', group);
  const x = Number(rect?.getAttribute('x') || sourceLeft);
  const width = Number(rect?.getAttribute('width') || 40);
  const fromN = clamp((x - sourceLeft) / (sourceRight - sourceLeft), 0, 1);
  const toN = clamp((x + width - sourceLeft) / (sourceRight - sourceLeft), fromN, 1);
  const label = $('text', group)?.textContent.trim() || (risk ? '风险窗口' : '风味窗口');
  return { label, risk, from: fromN * totalTime, to: toN * totalTime };
}

function sourceWindows(svg, totalTime, tx, tyTemp, curveTempAt, minTemp, maxTemp, phase) {
  const viewBox = (svg.getAttribute('viewBox') || '0 0 720 330').split(/\s+/).map(Number);
  const sourceWidth = viewBox[2] || 720;
  const sourceLeft = 42;
  const sourceRight = Math.max(sourceLeft + 1, sourceWidth - 18);
  const colors = {
    acidity: ['rgba(255,214,102,.18)', 'rgba(255,214,102,.72)'],
    floral: ['rgba(139,240,197,.18)', 'rgba(139,240,197,.72)'],
    fruit: ['rgba(255,128,190,.16)', 'rgba(255,128,190,.70)'],
    sweetness: ['rgba(255,184,108,.13)', 'rgba(255,184,108,.62)'],
    bitter: ['rgba(255,92,92,.14)', 'rgba(255,92,92,.72)'],
    astringency: ['rgba(180,138,100,.13)', 'rgba(180,138,100,.66)']
  };

  let windows = $$('.trajectory-peak', svg).map(group => {
    const classes = [...group.classList];
    const geometry = sourceWindowGeometry(group, sourceLeft, sourceRight, totalTime, classes.includes('bitter') || classes.includes('astringency'));
    const type = classes.find(name => colors[name]) || windowType(geometry.label, geometry.risk);
    return { ...geometry, type, risk: type === 'bitter' || type === 'astringency' };
  });

  if (!windows.length) {
    windows = $$('.trajectory-window', svg).map(group => {
      const risk = group.classList.contains('risk');
      const geometry = sourceWindowGeometry(group, sourceLeft, sourceRight, totalTime, risk);
      return { ...geometry, type: windowType(geometry.label, risk), risk };
    });
  }

  if (!windows.some(window => !window.risk)) {
    const { bloomEnd, acidEnd, aromaEnd } = phase;
    windows.push(
      { type: 'acidity', risk: false, label: '明亮酸质', from: Math.max(0, bloomEnd * .55), to: acidEnd },
      { type: 'floral', risk: false, label: '花香释放', from: Math.max(0, bloomEnd * .72), to: acidEnd + (aromaEnd - acidEnd) * .45 },
      { type: 'sweetness', risk: false, label: '甜感与口感', from: acidEnd, to: aromaEnd }
    );
  }
  if (!windows.some(window => window.risk)) {
    const { aromaEnd } = phase;
    windows.push(
      { type: 'astringency', risk: true, label: '木质/干涩', from: aromaEnd, to: aromaEnd + (totalTime - aromaEnd) * .58 },
      { type: 'bitter', risk: true, label: '苦涩风险', from: aromaEnd + (totalTime - aromaEnd) * .38, to: totalTime }
    );
  }

  windows = windows.map(window => ({
    ...window,
    from: clamp(window.from, 0, totalTime),
    to: clamp(Math.max(window.from + totalTime * .035, window.to), 0, totalTime),
    fill: colors[window.type]?.[0] || colors.floral[0],
    stroke: colors[window.type]?.[1] || colors.floral[1]
  }));

  const rendered = windows.map(window => {
    const x = tx(window.from);
    const width = Math.max(24, tx(window.to) - x);
    const middle = (window.from + window.to) / 2;
    const curveTemp = curveTempAt(middle);
    const centerTemp = window.risk
      ? clamp(curveTemp + (window.type === 'bitter' ? 4.4 : 3), minTemp, maxTemp + 6)
      : curveTemp;
    const height = window.risk ? 22 : 24;
    const centerY = tyTemp(centerTemp);
    const y = clamp(centerY - height / 2, 34, 142 - height);
    const midX = x + width / 2;
    const guide = window.risk
      ? `<line x1="${midX}" y1="${tyTemp(curveTemp)}" x2="${midX}" y2="${y}" stroke="rgba(255,92,92,.30)" stroke-width="1" stroke-dasharray="2 2"></line>`
      : `<circle cx="${midX}" cy="${tyTemp(curveTemp)}" r="2.8" fill="${window.stroke}" opacity=".88"></circle>`;
    return `<g class="v098-flavor-window ${window.type}${window.risk ? ' risk' : ' positive'}">${guide}<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="${window.fill}" stroke="${window.stroke}" stroke-width="1"${window.risk ? ' stroke-dasharray="4 3"' : ''}></rect><text x="${midX}" y="${y + 14}" text-anchor="middle">${esc(window.label)}</text>${window.risk ? `<text class="v098-risk-avoid" x="${midX}" y="${tyTemp(curveTemp) + 15}" text-anchor="middle">轨迹下压避开</text>` : ''}</g>`;
  }).join('');

  const coverage = windows.filter(window => !window.risk).map(window => {
    const middle = (window.from + window.to) / 2;
    return `${tx(middle)},${tyTemp(curveTempAt(middle))}`;
  }).join(' ');
  return { rendered, coverage, windows };
}

function polygonBand(points, upper, lower, tx) {
  const top = points.map(point => `${tx(point.t)},${upper(point)}`).join(' ');
  const bottom = [...points].reverse().map(point => `${tx(point.t)},${lower(point)}`).join(' ');
  return `${top} ${bottom}`;
}

function renderTrajectory(svg) {
  if (!svg || svg.dataset.v098Trajectory === '1') return;
  const stages = planStages();
  if (!stages.length) return;
  const original = svg.cloneNode(true);
  const W = 800, H = 190, left = 38, right = 14, top = 16, bottom = 32;
  const innerW = W - left - right;
  const innerH = H - top - bottom;
  const totalTime = Math.max(1, stages.at(-1).end);
  const totalWater = Math.max(1, stages.at(-1).cumulative);
  const points = [];
  stages.forEach((stage, index) => {
    if (index === 0) points.push({ t: stage.start, temp: stage.temp, flow: 0, cumulative: 0 });
    points.push({ t: (stage.start + stage.end) / 2, temp: stage.temp, flow: stage.flow, cumulative: stage.cumulative });
    points.push({ t: stage.end, temp: stage.temp, flow: 0, cumulative: stage.cumulative });
  });
  const minTemp = Math.min(...points.map(point => point.temp));
  const maxTemp = Math.max(...points.map(point => point.temp));
  const tempRange = Math.max(4, maxTemp - minTemp);
  const maxFlow = Math.max(1, ...points.map(point => point.flow));
  const tx = time => left + time / totalTime * innerW;
  const tyTemp = value => top + innerH - (value - minTemp) / tempRange * innerH * .85;
  const tyFlow = value => top + innerH - value / maxFlow * innerH * .70;
  const tyCumulative = value => top + innerH - value / totalWater * innerH * .55;
  const curveTempAt = time => {
    if (time <= points[0].t) return points[0].temp;
    for (let index = 1; index < points.length; index += 1) {
      if (time <= points[index].t) {
        const leftPoint = points[index - 1];
        const rightPoint = points[index];
        const span = Math.max(1, rightPoint.t - leftPoint.t);
        const ratio = (time - leftPoint.t) / span;
        return leftPoint.temp + (rightPoint.temp - leftPoint.temp) * ratio;
      }
    }
    return points.at(-1).temp;
  };

  const bloomEnd = stages[0].end;
  const afterBloom = Math.max(0, totalTime - bloomEnd);
  const acidEnd = bloomEnd + afterBloom * .25;
  const aromaEnd = acidEnd + afterBloom * .38;
  const phase = { bloomEnd, acidEnd, aromaEnd };
  const flavor = sourceWindows(original, totalTime, tx, tyTemp, curveTempAt, minTemp, maxTemp, phase);
  const phaseRects = [
    [0, bloomEnd, 'rgba(126,219,255,.06)', '闷蒸'],
    [bloomEnd, acidEnd, 'rgba(255,164,74,.07)', '前段·酸'],
    [acidEnd, aromaEnd, 'rgba(139,240,197,.07)', '中段·香气'],
    [aromaEnd, totalTime, 'rgba(255,120,120,.06)', '尾段·截流']
  ].map(([start, end, fill, label]) => `<rect x="${tx(start)}" y="${top}" width="${Math.max(0, tx(end) - tx(start))}" height="${innerH}" fill="${fill}"></rect><text class="v098-phase-label" x="${(tx(start) + tx(end)) / 2}" y="${top + 9}" text-anchor="middle">${label}</text>`).join('');
  const phaseLines = [bloomEnd, acidEnd, aromaEnd].map(time => `<line class="v098-phase-line" x1="${tx(time)}" y1="${top}" x2="${tx(time)}" y2="${top + innerH}"></line>`).join('');
  const tempBand = polygonBand(points, point => tyTemp(point.temp + 1), point => tyTemp(point.temp - 1), tx);
  const flowBand = polygonBand(points, point => tyFlow(Math.max(0, point.flow + .3)), point => tyFlow(Math.max(0, point.flow - .3)), tx);
  const temperature = points.map(point => `${tx(point.t)},${tyTemp(point.temp)}`).join(' ');
  const flow = points.map(point => `${tx(point.t)},${tyFlow(point.flow)}`).join(' ');
  const cumulative = points.map(point => `${tx(point.t)},${tyCumulative(point.cumulative)}`).join(' ');
  const ticks = [...new Set(stages.map(stage => stage.start).concat(totalTime))].map(time => `<text class="v098-time-tick" x="${tx(time)}" y="${top + innerH + 14}" text-anchor="middle">${Math.round(time)}s</text>`).join('');

  svg.dataset.v098Trajectory = '1';
  svg.dataset.v098TrajectoryModel = 'v17-stage-time-window';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('aria-label', 'v17阶段时间轨迹：温度、流量、累计注水、风味物质窗口与风险窗口');
  svg.innerHTML = `${phaseRects}${flavor.rendered}${phaseLines}<line class="v098-y-axis" x1="${left}" y1="${top}" x2="${left}" y2="${top + innerH}"></line><polygon class="v098-temp-band" points="${tempBand}"></polygon><polygon class="v098-flow-band" points="${flowBand}"></polygon>${flavor.coverage ? `<polyline class="v098-flavor-line" points="${flavor.coverage}"></polyline>` : ''}<polyline class="v098-cumulative-line" points="${cumulative}"></polyline><polyline class="v098-flow-line" points="${flow}"></polyline><polyline class="v098-temp-line" points="${temperature}"></polyline><text class="v098-temp-axis" x="${left - 4}" y="${tyTemp(maxTemp)}" text-anchor="end">${maxTemp}°</text><text class="v098-temp-axis" x="${left - 4}" y="${tyTemp(minTemp)}" text-anchor="end">${minTemp}°</text>${ticks}`;

  const shell = svg.closest('.trajectory-shell');
  const legend = $('.trajectory-legend', shell);
  if (legend) legend.innerHTML = '<span class="v099-legend-trajectory">白色实线：冲煮萃取轨迹（重点）</span><span class="v098-legend-temp">温度中线及±1℃范围</span><span class="v098-legend-flow">流量中线及±0.3g/s范围</span><span class="v098-legend-water">累计注水</span><span class="v098-legend-risk">木质/苦涩风险</span>';
  let bar = $('.phase-marker-bar', shell);
  if (!bar && shell) {
    bar = document.createElement('div');
    bar.className = 'phase-marker-bar v098-phase-bar';
    svg.after(bar);
  }
  if (bar) {
    const width = value => `${value / totalTime * 100}%`;
    bar.innerHTML = `<span class="phase-seg" style="width:${width(bloomEnd)};background:rgba(126,219,255,.30)"></span><span class="phase-seg" style="width:${width(acidEnd - bloomEnd)};background:rgba(255,164,74,.35)"></span><span class="phase-seg" style="width:${width(aromaEnd - acidEnd)};background:rgba(139,240,197,.30)"></span><span class="phase-seg" style="width:${width(totalTime - aromaEnd)};background:rgba(255,120,120,.25)"></span>`;
  }
  const note = shell?.nextElementSibling;
  if (note?.matches('.muted.small')) note.textContent = '按 v17 阶段时间轴绘制：粗白色实线是需要重点观察的冲煮萃取轨迹：计算器反向调整温度、流量、等待、总时间、研磨与粉水比，使轨迹穿过正向风味窗口，并通过降温、加快注水或提前截流避开木质、苦涩与收敛风险。橙线为温度，青线为流量，绿色虚线为累计注水。';
}

function sync() {
  $$('.trajectory-chart.detailed:not([data-v098-trajectory="1"])').forEach(renderTrajectory);
}

document.addEventListener('DOMContentLoaded', sync, { once: true });
new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true });
sync();

globalThis.LuckyBeanV17Trajectory = { renderTrajectory };
