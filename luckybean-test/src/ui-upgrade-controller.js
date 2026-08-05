import { all, getSetting, setSetting } from './db.js';
import { loadCodebook, makeIndex, displayName } from './codebook.js';
import { freshnessProfile, clamp } from './utils.js';
import {
  normalizeRecommendationScore, positiveNegativeTagCounts,
  POSITIVE_TAG_WEIGHTS, NEGATIVE_TAG_WEIGHTS, recordEvaluationMode
} from './preference-model.js';

if (!globalThis.__LuckyBeanV099fUiUpgradeLoaded) {
  globalThis.__LuckyBeanV099fUiUpgradeLoaded = true;

  const GROUP_MODE_KEY = 'v099f.group.mode';
  const REQUIRED_FIELDS = [
    ['beanCountry', '国家'], ['beanVariety', '豆种'], ['beanProcess', '处理法'],
    ['beanRoast', '烘焙度'], ['beanRoastDate', '烘焙日期'], ['beanInitialWeight', '初始克重']
  ];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  let codebookPromise = null;
  let enhanceQueued = false;
  let freshnessRendering = false;
  let activeFreshnessStage = '';
  let autoParsePending = false;

  function toast(message, kind = '') {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.className = `toast show ${kind}`;
    setTimeout(() => { node.className = 'toast'; }, 2800);
  }

  async function codebookContext() {
    if (!codebookPromise) codebookPromise = loadCodebook().then(result => ({ book: result.data, index: makeIndex(result.data) }));
    return codebookPromise;
  }

  function labelFor(index, table, code, fallback = '未记录') {
    return code ? displayName(index, table, code, fallback) : fallback;
  }

  function queueEnhance() {
    if (enhanceQueued) return;
    enhanceQueued = true;
    requestAnimationFrame(() => requestAnimationFrame(async () => {
      enhanceQueued = false;
      ensureBeanModules();
      enhanceGroupPopup();
      enhanceBeanForm();
      normalizeDialogPosition();
      removeDuplicateStoragePanels();
      if (await getSetting(GROUP_MODE_KEY, 'native') === 'freshness') renderFreshnessGrouping();
    }));
  }

  function removeDuplicateStoragePanels() {
    const root = $('#settingsContent');
    if (!root) return;
    const old = $$('.v099e-cloud-panel,[data-v099e-cloud-panel]', root);
    old.forEach(node => node.remove());
    const current = $$('[data-v099f-account-sync]', root);
    current.slice(1).forEach(node => node.remove());
  }

  function normalizeDialogPosition() {
    const beanOverlay = $('[data-overlay="bean-form"]');
    if (beanOverlay && beanOverlay.dataset.v099fPositioned !== '1') {
      beanOverlay.dataset.v099fPositioned = '1';
      beanOverlay.scrollTop = 0;
      const dialog = $('.dialog', beanOverlay);
      if (dialog) dialog.scrollTop = 0;
    }
    const camera = $('[data-overlay="camera"], [data-overlay="bag-capture"]');
    if (camera) camera.classList.add('v099f-centered-capture');
  }

  function fieldMissing(id) {
    const control = $(`#${id}`);
    if (!control) return false;
    if (control.disabled && String(control.value || '').trim()) return false;
    if (id === 'beanInitialWeight') return !(Number(control.value) > 0);
    return !String(control.value || '').trim();
  }

  function updateRequiredHighlights(form) {
    for (const [id] of REQUIRED_FIELDS) {
      const wrapper = $(`[data-field="${id}"]`, form);
      if (!wrapper) continue;
      wrapper.classList.toggle('v099f-required-missing', fieldMissing(id));
    }
  }

  function focusFirstMissing(form) {
    updateRequiredHighlights(form);
    const pair = REQUIRED_FIELDS.find(([id]) => fieldMissing(id));
    if (!pair) return;
    const control = $(`#${pair[0]}`);
    const wrapper = $(`[data-field="${pair[0]}"]`, form) || control;
    wrapper?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      try { control?.focus?.({ preventScroll: true }); } catch { control?.focus?.(); }
    }, 300);
    toast(`请补充必填项目：${pair[1]}`, 'status-warn');
  }

  function enhanceBeanForm() {
    const form = $('#beanForm');
    if (!form || form.dataset.v099fEnhanced === '1') return;
    form.dataset.v099fEnhanced = '1';
    const overlay = form.closest('[data-overlay="bean-form"]');
    if (overlay) {
      overlay.scrollTop = 0;
      $('.dialog', overlay)?.scrollTo?.({ top: 0, behavior: 'auto' });
    }
    updateRequiredHighlights(form);
    for (const [id] of REQUIRED_FIELDS) {
      const control = $(`#${id}`, form);
      control?.addEventListener('input', () => updateRequiredHighlights(form));
      control?.addEventListener('change', () => updateRequiredHighlights(form));
    }
    form.addEventListener('submit', () => updateRequiredHighlights(form), true);
    const fromRecognition = autoParsePending || Boolean($('.text-evidence', form));
    if (fromRecognition) {
      autoParsePending = false;
      document.documentElement.classList.remove('v099f-auto-parsing');
      setTimeout(() => focusFirstMissing(form), 120);
    }
  }

  function autoHandoffRecognition(event) {
    const button = event.target.closest?.('#bagHandoffBtn');
    if (!button) return;
    const source = ($('#bagOcrText')?.value || '').trim();
    if (!source) return;
    autoParsePending = true;
    document.documentElement.classList.add('v099f-auto-parsing');
    setTimeout(() => {
      const textarea = $('#recognitionText');
      const parse = $('#parseTextBtn');
      if (!textarea || !parse) return;
      textarea.value = source;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      parse.click();
    }, 80);
  }

  function enhanceGroupPopup() {
    const popup = $$('.popup-menu').find(node => $('[data-group-method]', node));
    if (!popup || $('[data-v099f-group-freshness]', popup)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.v099fGroupFreshness = '1';
    button.textContent = '按赏味期阶段';
    popup.append(button);
  }

  async function chooseFreshnessGrouping(event) {
    const button = event.target.closest?.('[data-v099f-group-freshness]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    await setSetting(GROUP_MODE_KEY, 'freshness');
    activeFreshnessStage = '';
    $$('.popup-menu').forEach(node => node.remove());
    renderFreshnessGrouping();
  }

  async function chooseNativeGrouping(event) {
    const button = event.target.closest?.('[data-group-method]');
    if (!button) return;
    await setSetting(GROUP_MODE_KEY, 'native');
    activeFreshnessStage = '';
  }

  function stageFor(bean) {
    const profile = freshnessProfile(bean);
    if (Number(profile.effectiveAge) < Number(profile.start)) return '未到赏味期';
    if (Number(profile.effectiveAge) <= Number(profile.end)) return '正值赏味期';
    return '已过赏味期';
  }

  function compactBeanCard(bean, index, sensoryRecords) {
    const process = labelFor(index, 'processes', bean.processCode, '处理法未记');
    const country = labelFor(index, 'countries', bean.countryCode, '未定国家');
    const variety = labelFor(index, 'varieties', bean.varietyCode, '未定豆种');
    const profile = freshnessProfile(bean);
    const records = sensoryRecords.filter(record => record.beanId === bean.id);
    const score = records.length ? records.reduce((sum, record) => sum + normalizeRecommendationScore(record), 0) / records.length : 0;
    const progress = Math.round(clamp(Number(profile.progress || 0), 0, 1) * 100);
    return `<article class="bean-card compact" data-bean-id="${esc(bean.id)}" tabindex="0">
      <div class="compact-bean-copy"><h3>${esc(country)} · ${esc(variety)}</h3><small>${esc(process)}</small><div class="compact-bean-row"><strong>${Number(bean.remainingWeight || 0).toFixed(1)}g${bean.refrigerated ? '<small class="frozen-mark">❄️</small>' : ''}</strong><span class="compact-score">${score ? `${score.toFixed(1)}分` : '未评分'}</span></div></div>
      <button class="cup-action compact-pick" type="button" data-brew-bean="${esc(bean.id)}" aria-label="用这只豆小酌">酌</button>
      <div class="bean-freshness-progress" aria-label="${esc(profile.label)}"><span class="bean-freshness-solid" style="width:${progress}%;background:${profile.color}"></span><span class="bean-freshness-dashed" style="left:${progress}%"></span></div>
    </article>`;
  }

  async function renderFreshnessGrouping() {
    if (freshnessRendering) return;
    const container = $('#beanGroups');
    if (!container || !$('#pageBeans.active')) return;
    if (container.dataset.v099fFreshnessRendered === '1' && container.dataset.stage === activeFreshnessStage) return;
    freshnessRendering = true;
    try {
      const [{ index }, beans, sensoryRecords] = await Promise.all([codebookContext(), all('beans'), all('sensoryRecords')]);
      const active = beans
        .filter(bean => !bean.archived && Number(bean.remainingWeight) > 0)
        .sort((a, b) => String(b.roastDate || '').localeCompare(String(a.roastDate || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      const order = ['未到赏味期', '正值赏味期', '已过赏味期'];
      const groups = new Map(order.map(label => [label, []]));
      active.forEach(bean => groups.get(stageFor(bean)).push(bean));
      container.dataset.v099fFreshnessRendered = '1';
      container.dataset.stage = activeFreshnessStage;
      if (!active.length) {
        container.innerHTML = '<div class="empty-state"><strong>没有可分组的豆卡</strong></div>';
        return;
      }
      if (!activeFreshnessStage) {
        container.innerHTML = `<div class="v099f-freshness-note">按烘焙日期由新到旧排列，养豆时间轴由短到长。</div><div class="bean-grid compact-grid group-grid">${order.map(label => {
          const items = groups.get(label);
          const total = items.reduce((sum, bean) => sum + Number(bean.remainingWeight || 0), 0);
          return `<button class="group-card v099f-stage-card" type="button" data-v099f-open-stage="${label}"><span>${label}</span><small>${items.length}只 · ${total.toFixed(1)}g</small></button>`;
        }).join('')}</div>`;
      } else {
        const items = groups.get(activeFreshnessStage) || [];
        container.innerHTML = `<section class="active-group-panel"><div class="active-group-title"><span>${activeFreshnessStage}</span><small>${items.length}只 · 烘焙日期由新到旧</small></div><div class="bean-grid compact-grid">${items.map(bean => compactBeanCard(bean, index, sensoryRecords)).join('') || '<p class="muted">该阶段没有豆卡</p>'}</div><div class="group-collapse-zone"><button class="group-collapse" type="button" data-v099f-stage-back>收</button></div></section>`;
      }
    } finally {
      freshnessRendering = false;
    }
  }

  async function handleFreshnessStage(event) {
    const open = event.target.closest?.('[data-v099f-open-stage]');
    if (open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeFreshnessStage = open.dataset.v099fOpenStage;
      const container = $('#beanGroups');
      if (container) delete container.dataset.v099fFreshnessRendered;
      renderFreshnessGrouping();
      return;
    }
    const back = event.target.closest?.('[data-v099f-stage-back]');
    if (back) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeFreshnessStage = '';
      const container = $('#beanGroups');
      if (container) delete container.dataset.v099fFreshnessRendered;
      renderFreshnessGrouping();
    }
  }

  function ensureBeanModules() {
    const page = $('#pageBeans');
    const bar = $('#activeFilterBar');
    if (!page || !bar || $('#v099fBeanModules')) return;
    const modules = document.createElement('div');
    modules.id = 'v099fBeanModules';
    modules.className = 'v099f-bean-modules';
    modules.innerHTML = `<button type="button" data-v099f-preference>风味喜好数字测写</button><button type="button" data-v099f-world>咖啡世界</button>`;
    bar.insertAdjacentElement('afterend', modules);
  }

  function allRecordLabels(record = {}) {
    const labels = [];
    for (const groups of Object.values(record.answers || {})) for (const values of Object.values(groups || {})) labels.push(...(values || []).map(String));
    for (const line of record.summary || []) labels.push(...String(line || '').split(/[：:/／、，,；;＞>\s]+/).filter(Boolean));
    const note = String(record.naturalNote || '');
    for (const tag of Object.keys(POSITIVE_TAG_WEIGHTS)) if (note.includes(tag)) labels.push(tag);
    for (const tag of Object.keys(NEGATIVE_TAG_WEIGHTS)) if (note.includes(tag)) labels.push(tag);
    return labels;
  }

  async function preferenceAnalytics() {
    const [{ index }, beans, records] = await Promise.all([codebookContext(), all('beans'), all('sensoryRecords')]);
    const beanMap = new Map(beans.map(bean => [bean.id, bean]));
    const positive = new Map();
    const negative = new Map();
    const dimensions = {
      country: new Map(), variety: new Map(), entity: new Map(), process: new Map(), roaster: new Map()
    };
    const modes = new Map();
    let normalizedTotal = 0;
    let scored = 0;
    for (const record of records) {
      const bean = beanMap.get(record.beanId);
      if (!bean) continue;
      const mode = recordEvaluationMode(record);
      modes.set(mode, (modes.get(mode) || 0) + 1);
      normalizedTotal += normalizeRecommendationScore(record);
      scored += 1;
      const counts = positiveNegativeTagCounts(record);
      for (const label of allRecordLabels(record)) {
        if (POSITIVE_TAG_WEIGHTS[label]) counts.positive.set(label, Math.max(1, counts.positive.get(label) || 0));
        if (NEGATIVE_TAG_WEIGHTS[label]) counts.negative.set(label, Math.max(1, counts.negative.get(label) || 0));
      }
      let positiveHits = 0;
      for (const [tag, count] of counts.positive) {
        positive.set(tag, (positive.get(tag) || 0) + count);
        positiveHits += count;
      }
      for (const [tag, count] of counts.negative) negative.set(tag, (negative.get(tag) || 0) + count);
      if (!positiveHits) continue;
      const values = {
        country: labelFor(index, 'countries', bean.countryCode, '未记录国家'),
        variety: labelFor(index, 'varieties', bean.varietyCode, '未记录豆种'),
        entity: labelFor(index, 'entities', bean.entityCode, '未记录庄园'),
        process: labelFor(index, 'processes', bean.processCode, '未记录处理法'),
        roaster: String(bean.roasterName || bean.roaster || '未记录烘焙商')
      };
      for (const [dimension, label] of Object.entries(values)) dimensions[dimension].set(label, (dimensions[dimension].get(label) || 0) + positiveHits);
    }
    return {
      positive: [...positive.entries()].sort((a, b) => b[1] - a[1]),
      negative: [...negative.entries()].sort((a, b) => b[1] - a[1]),
      dimensions,
      modes,
      average: scored ? normalizedTotal / scored : 0,
      recordCount: records.length
    };
  }

  function piePath(startAngle, endAngle, radius = 86, center = 100) {
    const point = angle => [center + Math.cos(angle - Math.PI / 2) * radius, center + Math.sin(angle - Math.PI / 2) * radius];
    const [x1, y1] = point(startAngle);
    const [x2, y2] = point(endAngle);
    const large = endAngle - startAngle > Math.PI ? 1 : 0;
    if (endAngle - startAngle >= Math.PI * 2 - .0001) return `<circle cx="${center}" cy="${center}" r="${radius}"></circle>`;
    return `<path d="M${center},${center} L${x1.toFixed(2)},${y1.toFixed(2)} A${radius},${radius} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z"></path>`;
  }

  function pieChartHtml(entries = [], title = '') {
    let rows = entries.filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return `<div class="v099f-empty-chart">暂无${esc(title)}数据</div>`;
    if (rows.length > 8) {
      const other = rows.slice(7).reduce((sum, [, value]) => sum + value, 0);
      rows = [...rows.slice(0, 7), ['其他', other]];
    }
    const total = rows.reduce((sum, [, value]) => sum + value, 0);
    let angle = 0;
    const slices = rows.map(([label, value], index) => {
      const start = angle;
      angle += value / total * Math.PI * 2;
      return `<g class="v099f-pie-slice slice-${index}">${piePath(start, angle)}<title>${esc(label)} ${value}次 ${(value / total * 100).toFixed(1)}%</title></g>`;
    }).join('');
    const legend = rows.map(([label, value], index) => `<li><i class="slice-${index}"></i><span>${esc(label)}</span><strong>${(value / total * 100).toFixed(1)}%</strong><small>${value}次</small></li>`).join('');
    return `<div class="v099f-pie-layout"><svg class="v099f-pie" viewBox="0 0 200 200" role="img" aria-label="${esc(title)}占比饼状图">${slices}<circle class="v099f-pie-hole" cx="100" cy="100" r="42"></circle><text x="100" y="97" text-anchor="middle">${total}</text><text x="100" y="116" text-anchor="middle">正面标签</text></svg><ol class="v099f-pie-legend">${legend}</ol></div>`;
  }

  async function openPreferencePage() {
    const data = await preferenceAnalytics();
    const topPositive = data.positive.slice(0, 10);
    const topNegative = data.negative.slice(0, 10);
    const modeNames = { professional: '专业杯测', player: '玩家品鉴', note: '札记评分' };
    const overlay = $('#overlayRoot');
    overlay.innerHTML = `<div class="overlay full v099f-analysis-overlay" data-overlay="v099f-preference"><div class="dialog v099f-analysis-dialog">
      <div class="dialog-header"><div><h2>风味喜好数字测写</h2><p>按正面与负面标签累计次数，并将三种评价体系归一到杯测100分尺度。</p></div><button class="close-button" type="button" data-v099f-close>×</button></div>
      <div class="v099f-analysis-summary"><div><span>品鉴记录</span><strong>${data.recordCount}</strong></div><div><span>归一推荐均分</span><strong>${data.average.toFixed(1)}</strong></div><div><span>正面标签</span><strong>${data.positive.reduce((sum, [, count]) => sum + count, 0)}</strong></div><div><span>负面标签</span><strong>${data.negative.reduce((sum, [, count]) => sum + count, 0)}</strong></div></div>
      <div class="v099f-mode-summary">${[...data.modes.entries()].map(([mode, count]) => `<span>${modeNames[mode] || mode} ${count}次</span>`).join('')}</div>
      <section class="v099f-top-tags"><h3>正面标签前10</h3><div>${topPositive.map(([tag, count], index) => `<span><b>${index + 1}</b>${esc(tag)}<strong>${count}</strong></span>`).join('') || '<p class="muted">尚无正面标签</p>'}</div></section>
      <section class="v099f-top-tags negative"><h3>负面标签前10</h3><div>${topNegative.map(([tag, count], index) => `<span><b>${index + 1}</b>${esc(tag)}<strong>${count}</strong></span>`).join('') || '<p class="muted">尚无负面标签</p>'}</div></section>
      <div class="v099f-dimension-tabs" role="tablist"><button class="active" data-v099f-dimension="country">国家</button><button data-v099f-dimension="variety">豆种</button><button data-v099f-dimension="entity">庄园</button><button data-v099f-dimension="process">处理法</button><button data-v099f-dimension="roaster">烘焙商</button></div>
      <section id="v099fPiePanel">${pieChartHtml([...data.dimensions.country.entries()], '国家')}</section>
    </div></div>`;
    $('[data-v099f-close]', overlay)?.addEventListener('click', () => { overlay.innerHTML = ''; });
    $$('[data-v099f-dimension]', overlay).forEach(button => button.addEventListener('click', () => {
      $$('[data-v099f-dimension]', overlay).forEach(item => item.classList.toggle('active', item === button));
      const names = { country: '国家', variety: '豆种', entity: '庄园', process: '处理法', roaster: '烘焙商' };
      $('#v099fPiePanel', overlay).innerHTML = pieChartHtml([...data.dimensions[button.dataset.v099fDimension].entries()], names[button.dataset.v099fDimension]);
    }));
  }

  const COUNTRY_GEO = Object.freeze([
    ['ET', 40.49, 9.15, ['埃塞俄比亚', 'Ethiopia']], ['KE', 37.91, .02, ['肯尼亚', 'Kenya']], ['RW', 29.87, -1.94, ['卢旺达', 'Rwanda']],
    ['BI', 29.92, -3.37, ['布隆迪', 'Burundi']], ['TZ', 34.89, -6.37, ['坦桑尼亚', 'Tanzania']], ['UG', 32.29, 1.37, ['乌干达', 'Uganda']],
    ['CD', 21.76, -4.04, ['刚果民主共和国', '刚果金', 'DR Congo']], ['CM', 12.35, 7.37, ['喀麦隆', 'Cameroon']], ['CI', -5.55, 7.54, ['科特迪瓦', 'Ivory Coast']],
    ['BR', -51.93, -14.24, ['巴西', 'Brazil']], ['CO', -74.30, 4.57, ['哥伦比亚', 'Colombia']], ['PE', -75.02, -9.19, ['秘鲁', 'Peru']],
    ['EC', -78.18, -1.83, ['厄瓜多尔', 'Ecuador']], ['BO', -63.59, -16.29, ['玻利维亚', 'Bolivia']], ['VE', -66.59, 6.42, ['委内瑞拉', 'Venezuela']],
    ['GT', -90.23, 15.78, ['危地马拉', 'Guatemala']], ['HN', -86.24, 15.20, ['洪都拉斯', 'Honduras']], ['SV', -88.90, 13.79, ['萨尔瓦多', 'El Salvador']],
    ['CR', -83.75, 9.75, ['哥斯达黎加', 'Costa Rica']], ['PA', -80.78, 8.54, ['巴拿马', 'Panama']], ['NI', -85.21, 12.87, ['尼加拉瓜', 'Nicaragua']],
    ['MX', -102.55, 23.63, ['墨西哥', 'Mexico']], ['JM', -77.30, 18.11, ['牙买加', 'Jamaica']], ['DO', -70.16, 18.74, ['多米尼加', 'Dominican Republic']],
    ['ID', 113.92, -.79, ['印度尼西亚', '印尼', 'Indonesia']], ['VN', 108.28, 14.06, ['越南', 'Vietnam']], ['CN', 104.20, 35.86, ['中国', 'China']],
    ['IN', 78.96, 20.59, ['印度', 'India']], ['TH', 100.99, 15.87, ['泰国', 'Thailand']], ['LA', 102.50, 19.86, ['老挝', 'Laos']],
    ['MM', 95.96, 21.91, ['缅甸', 'Myanmar']], ['PH', 121.77, 12.88, ['菲律宾', 'Philippines']], ['PG', 143.96, -6.31, ['巴布亚新几内亚', 'Papua New Guinea']],
    ['YE', 48.52, 15.55, ['也门', 'Yemen']], ['SA', 45.08, 23.89, ['沙特阿拉伯', 'Saudi Arabia']], ['AU', 133.78, -25.27, ['澳大利亚', 'Australia']],
    ['US', -95.71, 37.09, ['美国', 'United States']], ['PR', -66.59, 18.22, ['波多黎各', 'Puerto Rico']], ['CU', -77.78, 21.52, ['古巴', 'Cuba']]
  ]);

  function geoFor(code, name) {
    const normalizedCode = String(code || '').toUpperCase();
    return COUNTRY_GEO.find(([iso, , , aliases]) => normalizedCode === iso || normalizedCode.endsWith(`-${iso}`) || aliases.some(alias => String(name || '').includes(alias)));
  }

  function mapPoint(lon, lat) {
    return { x: (Number(lon) + 180) / 360 * 1000, y: (90 - Number(lat)) / 180 * 500 };
  }

  async function openWorldPage() {
    const [{ index }, beans, brews] = await Promise.all([codebookContext(), all('beans'), all('brewSessions')]);
    const counts = new Map();
    const beanMap = new Map(beans.map(bean => [bean.id, bean]));
    for (const bean of beans) if (bean.countryCode) counts.set(bean.countryCode, (counts.get(bean.countryCode) || 0) + 1);
    for (const brew of brews) {
      const code = beanMap.get(brew.beanId)?.countryCode;
      if (code) counts.set(code, (counts.get(code) || 0) + 1);
    }
    const geoCounts = COUNTRY_GEO.map(entry => {
      const [iso, lon, lat, aliases] = entry;
      let matchedCode = '';
      let count = 0;
      let display = aliases[0];
      for (const [code, value] of counts) {
        const name = labelFor(index, 'countries', code, code);
        if (geoFor(code, name)?.[0] === iso) {
          matchedCode = code;
          count += value;
          display = name;
        }
      }
      return { iso, lon, lat, aliases, code: matchedCode, count, display };
    });
    const markers = geoCounts.map(item => {
      const point = mapPoint(item.lon, item.lat);
      const intensity = clamp(item.count / 20, 0, 1);
      const radius = item.count ? 7 + Math.sqrt(Math.min(item.count, 30)) * 1.7 : 5;
      return `<g class="v099f-country-marker ${item.count >= 20 ? 'max' : item.count ? 'visited' : 'zero'}" transform="translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})" style="--intensity:${intensity.toFixed(3)}"><circle r="${radius.toFixed(1)}"></circle>${item.count ? `<text y="${(-radius - 5).toFixed(1)}">${esc(item.display)}</text><text class="count" y="4">${item.count}</text>` : ''}<title>${esc(item.display)}：拥有或冲煮 ${item.count} 次</title></g>`;
    }).join('');
    const visited = geoCounts.filter(item => item.count).sort((a, b) => b.count - a.count);
    const overlay = $('#overlayRoot');
    overlay.innerHTML = `<div class="overlay full v099f-world-overlay" data-overlay="v099f-world"><div class="dialog v099f-world-dialog">
      <div class="dialog-header"><div><h2>咖啡世界</h2><p>豆卡持有次数＋实际冲煮次数。达到20次的国家使用当前背景色的反相色。</p></div><button class="close-button" type="button" data-v099f-close>×</button></div>
      <div class="v099f-map-toolbar"><span>双指缩放 · 单指拖动</span><button type="button" class="button subtle" data-v099f-map-reset>复位</button></div>
      <div class="v099f-map-viewport" id="v099fMapViewport"><svg viewBox="0 0 1000 500" role="img" aria-label="咖啡世界地图"><rect class="map-bg" width="1000" height="500"></rect><g id="v099fMapLayer"><g class="v099f-continent-lines">
        <path d="M70 105 L150 65 245 85 280 145 245 190 180 180 130 220 82 180Z"></path><path d="M245 215 L300 230 330 310 300 405 260 455 225 350Z"></path>
        <path d="M430 85 L505 58 565 88 610 120 690 105 765 130 835 155 895 225 850 275 785 245 720 285 650 255 605 210 555 210 520 165 455 155Z"></path>
        <path d="M480 190 L555 205 605 270 575 380 525 440 470 360 445 270Z"></path><path d="M790 330 L875 345 930 390 885 440 810 420Z"></path>
      </g>${markers}</g></svg></div>
      <div class="v099f-world-ranking"><h3>国家热度</h3>${visited.length ? visited.map((item, index) => `<div><b>${index + 1}</b><span>${esc(item.display)}</span><strong>${item.count}次</strong></div>`).join('') : '<p class="muted">尚无豆卡或冲煮记录</p>'}</div>
    </div></div>`;
    $('[data-v099f-close]', overlay)?.addEventListener('click', () => { overlay.innerHTML = ''; });
    bindMapGestures($('#v099fMapViewport', overlay), $('#v099fMapLayer', overlay), $('[data-v099f-map-reset]', overlay));
  }

  function bindMapGestures(viewport, layer, resetButton) {
    if (!viewport || !layer) return;
    let scale = 1;
    let tx = 0;
    let ty = 0;
    const pointers = new Map();
    let lastSingle = null;
    let pinch = null;
    const apply = () => { layer.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
    const clampTransform = () => {
      scale = clamp(scale, 1, 5);
      const limitX = viewport.clientWidth * (scale - 1) * .8;
      const limitY = viewport.clientHeight * (scale - 1) * .8;
      tx = clamp(tx, -limitX, limitX);
      ty = clamp(ty, -limitY, limitY);
    };
    const reset = () => { scale = 1; tx = 0; ty = 0; pointers.clear(); lastSingle = null; pinch = null; apply(); };
    resetButton?.addEventListener('click', reset);
    viewport.addEventListener('pointerdown', event => {
      viewport.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) lastSingle = { x: event.clientX, y: event.clientY };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale, midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2, tx, ty };
      }
    });
    viewport.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1 && lastSingle) {
        tx += event.clientX - lastSingle.x;
        ty += event.clientY - lastSingle.y;
        lastSingle = { x: event.clientX, y: event.clientY };
      } else if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        scale = clamp(pinch.scale * distance / pinch.distance, 1, 5);
        tx = pinch.tx + (midX - pinch.midX);
        ty = pinch.ty + (midY - pinch.midY);
      }
      clampTransform();
      apply();
    });
    const end = event => {
      pointers.delete(event.pointerId);
      if (pointers.size === 1) {
        const remaining = [...pointers.values()][0];
        lastSingle = { ...remaining };
      } else lastSingle = null;
      if (pointers.size < 2) pinch = null;
    };
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);
    viewport.addEventListener('wheel', event => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : .89;
      scale = clamp(scale * factor, 1, 5);
      clampTransform();
      apply();
    }, { passive: false });
  }

  function moduleClick(event) {
    if (event.target.closest?.('[data-v099f-preference]')) openPreferencePage().catch(error => toast(error.message, 'status-bad'));
    if (event.target.closest?.('[data-v099f-world]')) openWorldPage().catch(error => toast(error.message, 'status-bad'));
  }

  document.addEventListener('click', autoHandoffRecognition);
  document.addEventListener('click', chooseFreshnessGrouping, true);
  document.addEventListener('click', chooseNativeGrouping, true);
  document.addEventListener('click', handleFreshnessStage, true);
  document.addEventListener('click', moduleClick);
  document.addEventListener('click', event => {
    if (event.target.closest?.('#parseTextBtn')) {
      autoParsePending = true;
      document.documentElement.classList.add('v099f-auto-parsing');
    }
  }, true);

  {
  const uiUpgradeObserver1 = new MutationObserver(queueEnhance);
  ["#beanGroups","#overlayRoot","#settingsContent"].forEach(selector => {
    const root = document.querySelector(selector);
    if (root) uiUpgradeObserver1.observe(root, { childList: true, subtree: true });
  });
}
  queueEnhance();
  globalThis.LuckyBeanV099fUi = { openPreferencePage, openWorldPage, renderFreshnessGrouping, focusFirstMissing };
}
