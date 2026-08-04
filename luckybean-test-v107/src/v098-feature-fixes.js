import { all, get, put, remove, getSetting, setSetting } from './db.js';
import { loadCodebook, makeIndex, displayName } from './codebook.js';
import { freshnessProfile, uid, todayISO } from './utils.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const GROUP_KEY = 'luckybean.group.method.v098';
const SELECTED_KEY = 'luckybean.selected.bean.v098';
const RADAR_KEY = 'luckybean.professional.radar.v098';
const FIXED_PROFILE_STAGES = Object.freeze({
  'one-pour': 1,
  'two-pulse': 2,
  'three-pulse': 3,
  'four-stage': 4,
  'four-six-v17': 5,
  'four-six-33666': 5,
  'flat46-clean': 5,
  'five-pulse': 5,
  'hoffmann-one-cup': 5,
  'april-two-pour': 2,
  'matt-winton-five': 5,
  'lance-daily-two': 2,
  'switch-hybrid-50-50': 2,
  'mugen-one-pour': 1,
  'onyx-center-spiral': 5
});
const ROAST_LABELS = Object.freeze({
  'RL-L0': '极浅烘', 'RL-L1': '浅烘', 'RL-L2': '浅中烘', 'RL-L3': '中烘',
  'RL-L4': '中深烘', 'RL-L5': '深烘', 'RL-L6': '极深烘'
});
const FRESHNESS_ORDER = Object.freeze({ urgent: 0, decline: 1, good: 2, peak: 3, resting: 4 });
const FRESHNESS_LABEL = Object.freeze({
  urgent: '赏味期已明显衰减', decline: '赏味期正在衰减', good: '赏味期后段', peak: '赏味高峰', resting: '养豆期 / 最新鲜'
});

let groupMode = localStorage.getItem(GROUP_KEY) || 'roast';
let activeGroup = '';
let groupBusy = false;
let groupQueued = false;
let codebookPromise = null;
let archivedDetailId = '';
let affectiveBusy = false;
let uiQueued = false;

function codebookContext() {
  if (!codebookPromise) codebookPromise = loadCodebook().then(result => ({ book: result.data, index: makeIndex(result.data) }));
  return codebookPromise;
}

async function migrateDefaultGroup() {
  const done = await getSetting('migration.v098.default-roast-group', false);
  if (done) return;
  const settings = await getSetting('app.settings', {});
  settings.groupMethod = 'roast';
  await setSetting('app.settings', settings);
  await setSetting('migration.v098.default-roast-group', true);
  localStorage.setItem(GROUP_KEY, 'roast');
  groupMode = 'roast';
}

function profileName(index, table, code, fallback) {
  return displayName(index, table, code, fallback);
}

function beanScore(beanId, records) {
  const scores = records
    .filter(record => record.beanId === beanId)
    .map(record => Number(record.subjectiveScore ?? record.score))
    .filter(Number.isFinite);
  if (!scores.length) return 0;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function groupDescriptor(bean, index) {
  if (groupMode === 'roast') {
    const order = Number(String(bean.roastCode || 'RL-L9').replace(/\D/g, ''));
    return { key: bean.roastCode || 'unknown', label: ROAST_LABELS[bean.roastCode] || '未记录烘焙度', order: Number.isFinite(order) ? order : 99 };
  }
  if (groupMode === 'freshness-state') {
    const profile = freshnessProfile(bean);
    const status = profile.status || 'good';
    return { key: status, label: FRESHNESS_LABEL[status] || profile.label || '赏味状态未定', order: FRESHNESS_ORDER[status] ?? 9 };
  }
  if (groupMode === 'remaining-50') {
    const weight = Math.max(0, Number(bean.remainingWeight || 0));
    const start = Math.floor(weight / 50) * 50;
    const end = start + 49;
    return { key: String(start), label: `${start}–${end}g`, order: start };
  }
  if (groupMode === 'variety') return { key: bean.varietyCode || 'unknown', label: profileName(index, 'varieties', bean.varietyCode, '未记录豆种'), order: 0 };
  if (groupMode === 'process') return { key: bean.processCode || 'unknown', label: profileName(index, 'processes', bean.processCode, '未记录工法'), order: 0 };
  return { key: bean.countryCode || 'unknown', label: profileName(index, 'countries', bean.countryCode, '未记录国家'), order: 0 };
}

function cardHtml(bean, index, records, selectedId) {
  const country = profileName(index, 'countries', bean.countryCode, '未定国家');
  const variety = profileName(index, 'varieties', bean.varietyCode, '未定豆种');
  const process = profileName(index, 'processes', bean.processCode, '处理法未记');
  const fresh = freshnessProfile(bean);
  const progress = Math.round(clamp(fresh.progress, 0, 1) * 100);
  const score = beanScore(bean.id, records);
  const selected = bean.id === selectedId;
  return `<article class="bean-card compact${selected ? ' recommended v098-selected' : ''}" data-bean-id="${esc(bean.id)}" tabindex="0">
    <div class="compact-bean-copy"><h3>${esc(country)} · ${esc(variety)}</h3><small>${esc(process)}</small><div class="compact-bean-row"><strong class="${bean.refrigerated ? 'frozen-weight' : ''}">${Number(bean.remainingWeight || 0).toFixed(1)}g${bean.refrigerated ? '<small class="frozen-mark" aria-label="冷藏">❄️</small>' : ''}</strong><span class="compact-score">${score ? `${score.toFixed(1)}分` : '未评分'}${selected ? '<em>选</em>' : ''}</span></div></div>
    <button class="cup-action compact-pick" type="button" data-brew-bean="${esc(bean.id)}" aria-label="用这只豆小酌">酌</button>
    <div class="bean-freshness-progress" aria-label="${esc(fresh.label)}，风味${esc(fresh.trend)}，进度${progress}%"><span class="bean-freshness-solid" style="width:${progress}%;background:${fresh.color}"></span><span class="bean-freshness-dashed" style="left:${progress}%"></span></div>
  </article>`;
}

function sortItems(items, descriptor) {
  if (groupMode === 'freshness-state') {
    return items.sort((left, right) => String(left.roastDate || '').localeCompare(String(right.roastDate || '')));
  }
  if (groupMode === 'remaining-50') return items.sort((left, right) => Number(left.remainingWeight || 0) - Number(right.remainingWeight || 0));
  if (groupMode === 'roast') return items.sort((left, right) => String(right.roastDate || '').localeCompare(String(left.roastDate || '')));
  return items.sort((left, right) => String(left.updatedAt || '').localeCompare(String(right.updatedAt || '')));
}

async function renderCustomGroups() {
  if (groupBusy) return;
  const container = $('#beanGroups');
  if (!container || !$('#pageBeans.active')) return;
  if (!$('#activeFilterBar')?.classList.contains('hidden')) return;
  if (!['freshness-state', 'remaining-50'].includes(groupMode)) return;
  if (container.dataset.v099NativeRecommendation === '1' || container.querySelector('[data-all-groups],.recommendation-all-groups')) return;
  groupBusy = true;
  try {
    const [{ index }, beans, records] = await Promise.all([codebookContext(), all('beans'), all('sensoryRecords')]);
    const active = beans.filter(bean => !bean.archived && Number(bean.remainingWeight) > 0);
    const groups = new Map();
    for (const bean of active) {
      const descriptor = groupDescriptor(bean, index);
      if (!groups.has(descriptor.key)) groups.set(descriptor.key, { ...descriptor, items: [] });
      groups.get(descriptor.key).items.push(bean);
    }
    const ordered = [...groups.values()].sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'zh-CN'));
    if (activeGroup && !groups.has(activeGroup)) activeGroup = '';
    const selectedId = localStorage.getItem(SELECTED_KEY) || '';
    const board = $('.recommendation-board', container)?.outerHTML || '';
    const signature = `${groupMode}|${activeGroup}|${active.map(bean => `${bean.id}:${bean.updatedAt}:${bean.remainingWeight}`).join(',')}|${selectedId}`;
    if (container.dataset.v098Signature === signature) return;
    container.dataset.v098Signature = signature;
    container.dataset.v098Grouping = groupMode;

    if (!activeGroup) {
      container.innerHTML = `${board}<div class="bean-grid compact-grid group-grid bean-grid-animated manual-motion">${ordered.map(group => {
        const weight = group.items.reduce((sum, bean) => sum + Number(bean.remainingWeight || 0), 0);
        return `<button class="group-card" type="button" data-v098-group="${esc(group.key)}"><span>${esc(group.label)}</span><small>${group.items.length}只 · ${weight.toFixed(1)}g</small></button>`;
      }).join('')}</div>`;
      return;
    }

    const group = groups.get(activeGroup);
    const cards = sortItems([...group.items], group).map(bean => cardHtml(bean, index, records, selectedId)).join('');
    container.innerHTML = `${board}<section class="active-group-panel manual-motion" data-active-group-panel><div class="active-group-title"><span>${esc(group.label)}</span><small>${group.items.length}只</small></div><div class="bean-grid compact-grid">${cards}</div><div class="group-collapse-zone group-collapse-zone-v098" data-v098-collapse><button class="group-collapse" type="button">收</button></div></section>`;
  } finally {
    groupBusy = false;
  }
}

function queueGroups() {
  // 099t owns custom grouping. Do not recompute groups from the global DOM observer.
  return;
}

function enhanceGroupMenu() {
  const popup = $('.popup-menu');
  if (!popup || popup.dataset.v098Enhanced === '1') return;
  popup.dataset.v098Enhanced = '1';
  const options = [
    ['freshness-state', '按赏味期状态'],
    ['remaining-50', '按余量（每50g）']
  ];
  for (const [value, label] of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.v098GroupMethod = value;
    button.textContent = `${label}${groupMode === value ? ' ✓' : ''}`;
    popup.append(button);
  }
  $$('[data-group-method]', popup).forEach(button => {
    const value = button.dataset.groupMethod;
    button.textContent = button.textContent.replace(/\s*✓$/, '') + (groupMode === value ? ' ✓' : '');
  });
}

function fixedBrewStageCount(profileId) {
  return FIXED_PROFILE_STAGES[profileId] || 0;
}

function syncBrewControls() {
  const profile = $('#brewProfile');
  const segments = $('#brewSegments');
  if (!profile || !segments) return;
  const field = segments.closest('.field') || segments.parentElement;
  const fixedCount = fixedBrewStageCount(profile.value);
  field?.classList.toggle('v098-segments-hidden', Boolean(fixedCount));
  field?.setAttribute('aria-hidden', fixedCount ? 'true' : 'false');
  if (fixedCount && segments.value !== String(fixedCount)) segments.value = String(fixedCount);

  const labels = {
    auto: '模型自动决定总段数',
    '1': '总1段（一刀流连续注水）',
    '2': '总2段（含闷蒸）',
    '3': '总3段（含闷蒸）',
    '4': '总4段（含闷蒸）',
    '5': '总5段（含闷蒸）'
  };
  for (const option of segments.options) {
    if (labels[option.value]) option.textContent = labels[option.value];
    if (option.value === '1') option.disabled = false;
  }
  const helper = field?.querySelector('.helper,.muted,small');
  if (helper) helper.textContent = '这里的段数为总段数，闷蒸计为第一段；仅在冲煮法未固定段数时显示。';
}

function parseNumber(text, fallback = 0) {
  const value = Number(String(text || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(value) ? value : fallback;
}

function stageDataFromPlan() {
  let start = 0;
  return $$('#generatedPlan .plan-stage').map(card => {
    const cells = $$('.stage-cell', card);
    const value = label => {
      const cell = cells.find(item => $('span', item)?.textContent.trim() === label);
      return $('strong', cell)?.textContent || '';
    };
    const tempPair = value('壶中/粉床').match(/([\d.]+).*?([\d.]+)?°?C?/) || [];
    const timeFlow = value('时间/流速');
    const duration = parseNumber(timeFlow.split('·')[0], 1);
    const flow = parseNumber(timeFlow.split('·')[1], 1);
    const stage = {
      index: parseNumber($('.stage-index', card)?.textContent, 1),
      name: value('阶段'),
      water: parseNumber(value('本段注水')),
      cumulative: parseNumber(value('累计注水')),
      temp: parseNumber(tempPair[1]),
      core: parseNumber(tempPair[2], parseNumber(tempPair[1])),
      duration,
      flow,
      start,
      end: start + duration
    };
    start = stage.end;
    return stage;
  });
}

function pathPoints(path) {
  const values = String(path?.getAttribute('d') || '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  const points = [];
  for (let index = 0; index + 1 < values.length; index += 2) points.push({ x: values[index], y: values[index + 1] });
  return points;
}

function v17Trajectory(svg) {
  if (!svg || svg.dataset.v098Trajectory === '1') return;
  const stages = stageDataFromPlan();
  if (!stages.length) return;
  const old = svg.cloneNode(true);
  const W = 800, H = 190, left = 38, right = 14, top = 16, bottom = 32;
  const innerW = W - left - right, innerH = H - top - bottom;
  const totalTime = Math.max(1, stages.at(-1).end);
  const minTemp = Math.min(...stages.map(stage => stage.temp));
  const maxTemp = Math.max(...stages.map(stage => stage.temp));
  const tempRange = Math.max(4, maxTemp - minTemp);
  const maxFlow = Math.max(1, ...stages.map(stage => stage.flow));
  const tx = time => left + time / totalTime * innerW;
  const tyTemp = value => top + innerH - (value - minTemp) / tempRange * innerH * .85;
  const tyFlow = value => top + innerH - value / maxFlow * innerH * .70;

  const physical = [];
  stages.forEach((stage, index) => {
    if (index === 0) physical.push({ t: stage.start, temp: stage.temp, flow: 0 });
    physical.push({ t: (stage.start + stage.end) / 2, temp: stage.temp, flow: stage.flow });
    physical.push({ t: stage.end, temp: stage.temp, flow: 0 });
  });
  const tempPoints = physical.map(point => `${tx(point.t).toFixed(1)},${tyTemp(point.temp).toFixed(1)}`).join(' ');
  const flowPoints = physical.map(point => `${tx(point.t).toFixed(1)},${tyFlow(point.flow).toFixed(1)}`).join(' ');

  const flavorSeries = ['floral', 'acidity', 'sweetness'].map(name => pathPoints(old.querySelector(`.trajectory-series.${name}`))).filter(points => points.length);
  const coverage = flavorSeries.length ? flavorSeries[0].map((point, index) => {
    const ys = flavorSeries.map(series => series[index]?.y).filter(Number.isFinite);
    const normalizedX = clamp((point.x - 42) / 660, 0, 1);
    const normalizedY = clamp(1 - (Math.min(...ys) - 24) / 268, 0, 1);
    return `${(left + normalizedX * innerW).toFixed(1)},${(top + innerH - normalizedY * innerH * .72).toFixed(1)}`;
  }).join(' ') : '';

  const peakColors = {
    floral: ['rgba(139,240,197,.18)', 'rgba(139,240,197,.72)'],
    acidity: ['rgba(255,214,102,.18)', 'rgba(255,214,102,.72)'],
    fruit: ['rgba(255,128,190,.16)', 'rgba(255,128,190,.70)'],
    sweetness: ['rgba(126,219,255,.16)', 'rgba(126,219,255,.68)'],
    bitter: ['rgba(255,92,92,.15)', 'rgba(255,92,92,.62)'],
    astringency: ['rgba(255,92,92,.12)', 'rgba(255,92,92,.54)']
  };
  const windows = $$('.trajectory-peak', old).map((group, index) => {
    const rect = $('rect', group);
    const label = $('text', group)?.textContent.trim() || '';
    const type = [...group.classList].find(name => peakColors[name]) || 'floral';
    const x = parseNumber(rect?.getAttribute('x'));
    const width = parseNumber(rect?.getAttribute('width'));
    const from = clamp((x - 42) / 660, 0, 1);
    const to = clamp((x + width - 42) / 660, 0, 1);
    const row = index % 4;
    const y = top + 19 + row * 22;
    const [fill, stroke] = peakColors[type];
    return `<g class="v098-flavor-window ${type}"><rect x="${(left + from * innerW).toFixed(1)}" y="${y}" width="${Math.max(24, (to - from) * innerW).toFixed(1)}" height="16" rx="5" fill="${fill}" stroke="${stroke}"></rect><text x="${(left + from * innerW + 5).toFixed(1)}" y="${y + 11}">${esc(label)}</text></g>`;
  }).join('');

  const stageLines = stages.map(stage => `<g class="v098-stage-marker"><line x1="${tx(stage.start).toFixed(1)}" y1="${top}" x2="${tx(stage.start).toFixed(1)}" y2="${H - bottom}"></line><text x="${(tx(stage.start) + 3).toFixed(1)}" y="${H - 11}">${stage.index}</text></g>`).join('');
  const grid = [0, .25, .5, .75, 1].map(value => {
    const y = top + (1 - value) * innerH;
    return `<line class="v098-grid" x1="${left}" y1="${y}" x2="${W - right}" y2="${y}"></line>`;
  }).join('');

  svg.dataset.v098Trajectory = '1';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('aria-label', '按阶段时间绘制的温度、流量、风味覆盖与风味窗口轨迹');
  svg.innerHTML = `${grid}${windows}${stageLines}<polyline class="v098-temp-line" points="${tempPoints}"></polyline><polyline class="v098-flow-line" points="${flowPoints}"></polyline>${coverage ? `<polyline class="v098-flavor-line" points="${coverage}"></polyline>` : ''}<text class="v098-axis" x="${left}" y="12">阶段时间轨迹</text><text class="v098-axis" x="${W-right}" y="${H-9}" text-anchor="end">时间 →</text>`;

  const shell = svg.closest('.trajectory-shell');
  const legend = $('.trajectory-legend', shell);
  if (legend) legend.innerHTML = '<span class="v098-legend-temp">温度曲线</span><span class="v098-legend-flow">流量曲线</span><span class="v098-legend-flavor">风味覆盖轨迹</span><span class="v098-legend-window">标志性风味窗口</span><span class="v098-legend-risk">木质 / 苦涩风险窗口</span>';
  let bar = $('.phase-marker-bar', shell);
  if (!bar && shell) {
    bar = document.createElement('div');
    bar.className = 'phase-marker-bar v098-phase-bar';
    svg.after(bar);
  }
  if (bar) bar.innerHTML = stages.map(stage => `<span class="phase-seg" style="flex:${Math.max(1, stage.duration)}" title="${esc(stage.name)}"></span>`).join('');
}

function radarValues(key) {
  const svg = $(`[data-radar-svg="${key}"]`);
  const fallback = key === 'style' ? Array(8).fill(5) : Array(5).fill(5);
  if (!svg) return fallback;
  const handles = $$('.v095-radar-handle', svg);
  const count = Math.max(1, handles.length);
  return handles.map((circle, index) => {
    const x = Number(circle.getAttribute('cx')) - 120;
    const y = Number(circle.getAttribute('cy')) - 120;
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    return Math.round(clamp((x * Math.cos(angle) + y * Math.sin(angle)) / 88 * 10, 0, 10) * 10) / 10;
  });
}

function saveRadarSnapshot() {
  const snapshot = { aroma: radarValues('aroma'), style: radarValues('style') };
  sessionStorage.setItem(RADAR_KEY, JSON.stringify(snapshot));
  return snapshot;
}

function loadRadarSnapshot() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(RADAR_KEY) || 'null');
    if (parsed?.aroma?.length === 5 && parsed?.style?.length === 8) return parsed;
  } catch { /* Ignore stale data. */ }
  return { aroma: [5, 5, 5, 5, 5], style: [5, 5, 5, 5, 5, 5, 5, 5] };
}

function normalizeRadarUi() {
  $$('.v095-radar-slider input').forEach(input => {
    input.min = '0';
    input.max = '10';
    if (Number(input.value) < 0) input.value = '0';
    if (Number(input.value) > 10) input.value = '10';
    const label = input.closest('label')?.querySelector('span');
    if (label) label.textContent = label.textContent.replace('强度', '质量得分');
  });
  $$('.v095-radar > p').forEach(node => { node.textContent = '点击轴点后，以0–10分记录对应杯测维度的质量得分。'; });
}

async function bypassAffectiveStep() {
  if (affectiveBusy || !$('.v095-affective-grid')) return;
  affectiveBusy = true;
  document.documentElement.classList.add('v098-affective-bypass');
  try {
    const values = loadRadarSnapshot().style.map(value => Math.round(clamp(value, 1, 9)));
    for (let index = 0; index < values.length; index += 1) {
      const fieldset = $$('.v095-affective-item')[index];
      const button = fieldset?.querySelector(`[data-affective-value="${values[index]}"]`);
      if (button && !button.classList.contains('selected')) {
        button.click();
        await nextFrame();
      }
    }
    $('[data-pro-next]')?.click();
  } finally {
    setTimeout(() => document.documentElement.classList.remove('v098-affective-bypass'), 300);
    affectiveBusy = false;
  }
}

function transformTemperatureSummary(text) {
  let next = String(text || '');
  const rows = [['高温', 'H'], ['中温', 'W'], ['低温', 'C']];
  for (const [label, code] of rows) {
    const pattern = new RegExp(`^${label}：(.+?)(?:；强度\\s*([\\d.]+)\\/15)?$`, 'm');
    next = next.replace(pattern, (_, tags, intensity = '7.5') => {
      const marker = /未标记|尚未选择|无/.test(tags) ? '-' : tags.trim();
      return `${code}/${marker}/${Number(intensity).toFixed(1)}`;
    });
  }
  return next;
}

function normalizeProfessionalSummary() {
  const pre = $('#v095ProfessionalSummary pre');
  if (pre) pre.textContent = transformTemperatureSummary(pre.textContent);
  const note = $('#sensoryNaturalNote');
  if (note && /【专业品鉴】/.test(note.value)) {
    const transformed = transformTemperatureSummary(note.value);
    if (transformed !== note.value) {
      note.value = transformed;
      note.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

function radarPolygon(values, center = 120, radius = 88) {
  return values.map((value, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / values.length;
    const length = radius * clamp(value, 0, 10) / 10;
    return `${(center + Math.cos(angle) * length).toFixed(1)},${(center + Math.sin(angle) * length).toFixed(1)}`;
  }).join(' ');
}

function customRadarCard(key, title, labels, values) {
  const rings = [2, 4, 6, 8, 10].map(level => `<polygon points="${radarPolygon(Array(labels.length).fill(level))}"></polygon>`).join('');
  const axes = labels.map((label, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / labels.length;
    const x = 120 + Math.cos(angle) * 88;
    const y = 120 + Math.sin(angle) * 88;
    const lx = 120 + Math.cos(angle) * 108;
    const ly = 120 + Math.sin(angle) * 108;
    return `<line x1="120" y1="120" x2="${x}" y2="${y}"></line><text x="${lx}" y="${ly}">${esc(label)}</text>`;
  }).join('');
  return `<section class="v098-radar-card" data-v098-radar-card="${key}"><h3>${esc(title)}</h3><svg viewBox="0 0 240 240"><g class="grid">${rings}${axes}</g><polygon class="value" points="${radarPolygon(values)}"></polygon></svg><div class="v098-radar-sliders">${labels.map((label, index) => `<label><span>${esc(label)}</span><input type="range" min="0" max="10" step="0.1" value="${values[index]}" data-v098-radar="${key}:${index}"><output>${Number(values[index]).toFixed(1)}</output></label>`).join('')}</div></section>`;
}

function openProfessionalRadarReturn() {
  if ($('#v098RadarReturn')) return;
  const snapshot = loadRadarSnapshot();
  const root = document.createElement('div');
  root.id = 'v098RadarReturn';
  root.className = 'overlay full v098-radar-return';
  root.innerHTML = `<div class="dialog v098-radar-dialog"><div class="dialog-header centered"><div><h2>专业品鉴 · 雷达质量得分</h2><p>保持在同一专业流程中调整，0–10分。</p></div></div><div class="v098-radar-grid">${customRadarCard('aroma', '香气倾向', ['花香','果香','茶感','坚果','酵感'], snapshot.aroma)}${customRadarCard('style', '整体质量', ['风味','余韵','酸质','甜感','醇厚','干净度','一致性','平衡度'], snapshot.style)}</div><div class="v098-radar-actions"><button class="button" type="button" data-v098-radar-cancel>返回札记</button><button class="button primary" type="button" data-v098-radar-save>确认并返回札记</button></div></div>`;
  document.body.append(root);
  root.addEventListener('input', event => {
    const input = event.target.closest('[data-v098-radar]');
    if (!input) return;
    const [key, indexText] = input.dataset.v098Radar.split(':');
    const index = Number(indexText);
    snapshot[key][index] = Number(input.value);
    input.nextElementSibling.textContent = Number(input.value).toFixed(1);
    $(`[data-v098-radar-card="${key}"] .value`, root)?.setAttribute('points', radarPolygon(snapshot[key]));
  });
  root.addEventListener('click', event => {
    if (event.target.closest('[data-v098-radar-save]')) sessionStorage.setItem(RADAR_KEY, JSON.stringify(snapshot));
    if (event.target.closest('[data-v098-radar-save],[data-v098-radar-cancel]')) root.remove();
  });
}

function modal(content) {
  const root = document.createElement('div');
  root.className = 'overlay v098-local-overlay';
  root.innerHTML = `<div class="dialog">${content}</div>`;
  document.body.append(root);
  return root;
}

async function rebuyBean(beanId) {
  const bean = await get('beans', beanId);
  if (!bean) return;
  const root = modal(`<div class="dialog-header centered"><div><h2>重购豆卡</h2><p>复制豆卡信息，但必须重新设定烘焙日期与克数。</p></div></div><div class="grid-2"><label class="field"><span>新烘焙日期</span><input id="v098RebuyDate" class="control" type="date" value="${todayISO()}" required></label><label class="field"><span>新克数</span><input id="v098RebuyWeight" class="control" type="number" min="1" step="0.1" value="100" required></label></div><div class="menu-row"><button class="button" type="button" data-v098-close>取消</button><button class="button primary" type="button" data-v098-confirm-rebuy>确认重购</button></div>`);
  root.addEventListener('click', async event => {
    if (event.target.closest('[data-v098-close]')) return root.remove();
    if (!event.target.closest('[data-v098-confirm-rebuy]')) return;
    const roastDate = $('#v098RebuyDate', root)?.value;
    const weight = Number($('#v098RebuyWeight', root)?.value);
    if (!roastDate || !Number.isFinite(weight) || weight <= 0) return;
    const now = new Date().toISOString();
    const copy = {
      ...structuredClone(bean),
      id: uid('bean'),
      archived: false,
      roastDate,
      initialWeight: weight,
      remainingWeight: weight,
      refrigerated: false,
      freezeDate: '',
      createdAt: now,
      updatedAt: now,
      reboughtFrom: bean.id
    };
    await put('beans', copy);
    root.remove();
    location.reload();
  });
}

async function permanentlyDeleteBean(beanId) {
  const bean = await get('beans', beanId);
  if (!bean) return;
  const root = modal(`<div class="dialog-header centered"><div><h2>彻底删除</h2><p>将同时删除该豆卡对应的冲煮、品鉴和余量记录，无法恢复。</p></div></div><div class="menu-row"><button class="button" type="button" data-v098-close>取消</button><button class="button danger" type="button" data-v098-confirm-delete>确认删除</button></div>`);
  root.addEventListener('click', async event => {
    if (event.target.closest('[data-v098-close]')) return root.remove();
    if (!event.target.closest('[data-v098-confirm-delete]')) return;
    const [sessions, sensory, inventory] = await Promise.all([all('brewSessions'), all('sensoryRecords'), all('inventoryEvents')]);
    await Promise.all([
      ...sessions.filter(item => item.beanId === beanId).map(item => remove('brewSessions', item.id)),
      ...sensory.filter(item => item.beanId === beanId).map(item => remove('sensoryRecords', item.id)),
      ...inventory.filter(item => item.beanId === beanId).map(item => remove('inventoryEvents', item.id)),
      remove('beans', beanId)
    ]);
    root.remove();
    location.reload();
  });
}

async function enhanceArchivedDetail() {
  const actions = $('.overlay[data-overlay="bean-detail"] .detail-actions');
  if (!actions || actions.dataset.v098Archived === '1' || !archivedDetailId) return;
  const bean = await get('beans', archivedDetailId);
  if (!bean?.archived) return;
  actions.dataset.v098Archived = '1';
  $('#brewThisBeanBtn', actions)?.remove();
  $('#editBeanBtn', actions)?.remove();
  $('#copyBeanBtn', actions)?.remove();
  const share = $('#shareBeanBtn', actions);
  if (share) share.textContent = '分享';
  const rebuy = document.createElement('button');
  rebuy.type = 'button';
  rebuy.className = 'button primary';
  rebuy.textContent = '重购';
  rebuy.addEventListener('click', () => rebuyBean(bean.id));
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'button danger';
  removeButton.textContent = '删除';
  removeButton.addEventListener('click', () => permanentlyDeleteBean(bean.id));
  actions.prepend(rebuy);
  actions.append(removeButton);
}

function syncUi() {
  // v0.9.9 uses the non-recursive group-menu guard.
  syncBrewControls();
  $$('.trajectory-chart.detailed').forEach(v17Trajectory);
  normalizeRadarUi();
  normalizeProfessionalSummary();
  enhanceArchivedDetail().catch(console.error);
  if ($('.v095-affective-grid')) bypassAffectiveStep().catch(console.error);
  queueGroups();
}

function queueUi() {
  if (uiQueued) return;
  uiQueued = true;
  requestAnimationFrame(() => {
    uiQueued = false;
    syncUi();
  });
}

document.addEventListener('click', event => {
  const customGroup = event.target.closest('[data-v098-group]');
  if (customGroup) {
    event.preventDefault();
    event.stopImmediatePropagation();
    activeGroup = customGroup.dataset.v098Group;
    queueGroups();
    return;
  }
  if (event.target.closest('[data-v098-collapse]')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    activeGroup = '';
    queueGroups();
    return;
  }
  const customMethod = event.target.closest('[data-v098-group-method]');
  if (customMethod) {
    event.preventDefault();
    event.stopImmediatePropagation();
    groupMode = customMethod.dataset.v098GroupMethod;
    activeGroup = '';
    localStorage.setItem(GROUP_KEY, groupMode);
    $('.popup-menu')?.remove();
    queueGroups();
    return;
  }
  const regularMethod = event.target.closest('[data-group-method]');
  if (regularMethod) {
    groupMode = regularMethod.dataset.groupMethod;
    activeGroup = '';
    localStorage.setItem(GROUP_KEY, groupMode);
    setTimeout(queueGroups, 80);
  }
  const archivedCard = event.target.closest('.bean-card.archived[data-bean-id]');
  if (archivedCard) archivedDetailId = archivedCard.dataset.beanId;
  if (event.target.closest('[data-recommend-mode]')) {
    setTimeout(() => {
      const selected = $('.bean-card.recommended[data-bean-id]');
      if (selected) {
        localStorage.setItem(SELECTED_KEY, selected.dataset.beanId);
        queueGroups();
      }
    }, 400);
  }
  if (event.target.closest('[data-pro-next]') && $('[data-radar-card]')) saveRadarSnapshot();
  if (event.target.closest('#prevSensoryNodeBtn') && $('#v095ProfessionalSummary')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openProfessionalRadarReturn();
  }
  if (event.target.closest('#generatePlanBtn')) setTimeout(syncBrewControls, 0);
}, true);

document.addEventListener('change', event => {
  if (event.target.matches?.('#brewProfile,#brewSegments')) setTimeout(syncBrewControls, 0);
}, true);

document.addEventListener('input', event => {
  if (event.target.matches?.('#brewProfile,#brewSegments')) setTimeout(syncBrewControls, 0);
}, true);

new MutationObserver(queueUi).observe(document.documentElement, { childList: true, subtree: true });
migrateDefaultGroup().catch(console.error).finally(queueUi);
queueUi();

globalThis.LuckyBeanV098Fixes = {
  renderCustomGroups,
  v17Trajectory,
  saveRadarSnapshot,
  transformTemperatureSummary
};
