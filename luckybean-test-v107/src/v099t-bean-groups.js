import { all, getSetting, setSetting } from './db.js';
import { loadCodebook, makeIndex, displayName } from './codebook.js';
import { freshnessProfile, clamp } from './utils.js';
import { normalizeRecommendationScore } from './preference-model.js';

if (!globalThis.__LuckyBeanV099tBeanGroupsLoaded) {
  globalThis.__LuckyBeanV099tBeanGroupsLoaded = true;

  const MODE_KEY = 'v099i.group.mode';
  const LEGACY_MODE_KEY = 'v099f.group.mode';
  const LEGACY_GROUP_KEY = 'luckybean.group.method.v098';
  const MODE_NATIVE = 'native';
  const MODE_FRESHNESS = 'freshness-ratio';
  const MODE_REMAINING = 'remaining-50';
  const SELECTED_KEY = 'luckybean.selected.bean.v098';
  const CACHE_TTL = 30000;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  const measuredRatios = new Map();
  let codebookPromise = null;
  let dataCache = null;
  let dataPromise = null;
  let currentMode = '';
  let activeGroup = '';
  let rendering = false;
  let recommendationBusy = false;
  let selectedId = localStorage.getItem(SELECTED_KEY) || '';
  let boardHtmlCache = '';

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const nextFrames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  function toast(message, kind = '') {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.className = `toast show ${kind}`;
    setTimeout(() => { node.className = 'toast'; }, 2800);
  }

  async function codebookContext() {
    if (!codebookPromise) codebookPromise = loadCodebook().then(result => ({ index: makeIndex(result.data) }));
    return codebookPromise;
  }

  function labelFor(index, table, code, fallback) {
    return code ? displayName(index, table, code, fallback) : fallback;
  }

  function captureBoard(container = $('#beanGroups')) {
    const board = container?.querySelector('.preference-board-strip');
    if (board) boardHtmlCache = board.outerHTML;
    return boardHtmlCache;
  }

  function captureRenderedRatios() {
    $$('#beanGroups .bean-card[data-bean-id]').forEach(card => {
      const track = $('.bean-freshness-progress', card);
      const solid = $('.bean-freshness-solid', card);
      if (!track || !solid) return;
      const trackWidth = track.getBoundingClientRect().width;
      const solidWidth = solid.getBoundingClientRect().width;
      if (trackWidth > 2 && Number.isFinite(solidWidth)) measuredRatios.set(card.dataset.beanId, clamp(solidWidth / trackWidth, 0, 1));
    });
  }

  function ratioFor(bean) {
    if (measuredRatios.has(bean.id)) return measuredRatios.get(bean.id);
    return clamp(Number(freshnessProfile(bean).progress || 0), 0, 1);
  }

  function freshnessStage(bean) {
    const ratio = ratioFor(bean);
    if (ratio < 1 / 3) return '养豆中';
    if (ratio < 2 / 3) return '味正盛';
    return '味将尽';
  }

  function buildScoreMap(records) {
    const aggregate = new Map();
    for (const record of records) {
      if (!record?.beanId) continue;
      const score = normalizeRecommendationScore(record);
      if (!Number.isFinite(score)) continue;
      const row = aggregate.get(record.beanId) || { total: 0, count: 0 };
      row.total += score;
      row.count += 1;
      aggregate.set(record.beanId, row);
    }
    return new Map([...aggregate].map(([beanId, row]) => [beanId, row.count ? row.total / row.count : 0]));
  }

  async function loadData({ force = false } = {}) {
    const now = Date.now();
    if (!force && dataCache && now - dataCache.at < CACHE_TTL) return dataCache;
    if (dataPromise) return dataPromise;
    dataPromise = Promise.all([codebookContext(), all('beans'), all('sensoryRecords')]).then(([{ index }, beans, records]) => {
      const active = beans.filter(bean => !bean.archived && Number(bean.remainingWeight) > 0).sort((a, b) => String(b.roastDate || '').localeCompare(String(a.roastDate || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      dataCache = { at: Date.now(), index, active, scoreMap: buildScoreMap(records) };
      return dataCache;
    }).finally(() => { dataPromise = null; });
    return dataPromise;
  }

  function invalidateData() { dataCache = null; }

  async function getMode() {
    if (currentMode) return currentMode;
    const [saved, legacy] = await Promise.all([getSetting(MODE_KEY, MODE_NATIVE), getSetting(LEGACY_MODE_KEY, MODE_NATIVE)]);
    const oldGroup = localStorage.getItem(LEGACY_GROUP_KEY) || '';
    if (saved === MODE_FRESHNESS || saved === MODE_REMAINING) currentMode = saved;
    else if (legacy === 'freshness') currentMode = MODE_FRESHNESS;
    else if (oldGroup === MODE_REMAINING) currentMode = MODE_REMAINING;
    else currentMode = MODE_NATIVE;
    if (currentMode !== MODE_NATIVE || legacy === 'freshness' || oldGroup === MODE_REMAINING) {
      localStorage.setItem(LEGACY_GROUP_KEY, 'roast');
      await Promise.all([setSetting(MODE_KEY, currentMode), setSetting(LEGACY_MODE_KEY, MODE_NATIVE)]);
    }
    return currentMode;
  }

  async function saveMode(mode) {
    currentMode = mode;
    activeGroup = '';
    localStorage.setItem(LEGACY_GROUP_KEY, 'roast');
    await Promise.all([setSetting(MODE_KEY, mode), setSetting(LEGACY_MODE_KEY, MODE_NATIVE)]);
  }

  function groupData(active, mode) {
    if (mode === MODE_FRESHNESS) {
      const order = ['养豆中', '味正盛', '味将尽'];
      const groups = new Map(order.map((label, index) => [label, { key: label, label, order: index, items: [] }]));
      for (const bean of active) groups.get(freshnessStage(bean)).items.push(bean);
      return [...groups.values()];
    }
    const groups = new Map();
    for (const bean of active) {
      const weight = Math.max(0, Number(bean.remainingWeight || 0));
      const start = Math.floor(weight / 50) * 50;
      const key = String(start);
      if (!groups.has(key)) groups.set(key, { key, label: `${start}–${start + 49}g`, order: start, items: [] });
      groups.get(key).items.push(bean);
    }
    return [...groups.values()].sort((a, b) => a.order - b.order);
  }

  function sortedItems(items, mode) {
    const copy = [...items];
    if (mode === MODE_FRESHNESS) return copy.sort((a, b) => String(b.roastDate || '').localeCompare(String(a.roastDate || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return copy.sort((a, b) => Number(a.remainingWeight || 0) - Number(b.remainingWeight || 0) || String(b.roastDate || '').localeCompare(String(a.roastDate || '')));
  }

  function beanCardHtml(bean, index, scoreMap) {
    const process = labelFor(index, 'processes', bean.processCode, '处理法未记');
    const country = labelFor(index, 'countries', bean.countryCode, '未定国家');
    const variety = labelFor(index, 'varieties', bean.varietyCode, '未定豆种');
    const fresh = freshnessProfile(bean);
    const score = scoreMap.get(bean.id) || 0;
    const progress = Math.round(ratioFor(bean) * 1000) / 10;
    const selected = bean.id === selectedId;
    return `<article class="bean-card compact${selected ? ' recommended v099l-selected' : ''}" data-bean-id="${esc(bean.id)}" tabindex="0"><div class="compact-bean-copy"><h3>${esc(country)} · ${esc(variety)}</h3><small>${esc(process)}</small><div class="compact-bean-row"><strong>${Number(bean.remainingWeight || 0).toFixed(1)}g${bean.refrigerated ? '<small class="frozen-mark">❄️</small>' : ''}</strong><span class="compact-score">${score ? `${score.toFixed(1)}分` : '未评分'}${selected ? '<em>选</em>' : ''}</span></div></div><button class="cup-action compact-pick" type="button" data-brew-bean="${esc(bean.id)}">酌</button><div class="bean-freshness-progress" aria-label="时间轴已填充${progress}%"><span class="bean-freshness-solid" style="width:${progress}%;background:${fresh.color}"></span><span class="bean-freshness-dashed" style="left:${progress}%"></span></div></article>`;
  }

  function modeNote(mode) {
    return mode === MODE_FRESHNESS ? '按时间轴有色长度÷整行宽度分为三组：不足1/3为“养豆中”，达到1/3且不足2/3为“味正盛”，达到2/3为“味将尽”。组内按烘焙日期由新到旧。' : '按当前余量每50g划分一组；组内按剩余克重由少到多排列。';
  }

  async function render({ force = false, refreshData = false } = {}) {
    if (rendering) return;
    const mode = await getMode();
    if (![MODE_FRESHNESS, MODE_REMAINING].includes(mode)) return;
    const page = $('#pageBeans.active');
    const container = $('#beanGroups');
    if (!page || !container || !$('#activeFilterBar')?.classList.contains('hidden')) return;
    const board = captureBoard(container);
    const renderKey = `${mode}|${activeGroup}`;
    if (!force && container.dataset.v099tGroupKey === renderKey && container.querySelector('[data-v099t-group-root]')) return;

    rendering = true;
    container.classList.add('v099t-group-busy');
    try {
      const { index, active, scoreMap } = await loadData({ force: refreshData });
      const groups = groupData(active, mode);
      if (activeGroup && !groups.some(group => group.key === activeGroup)) activeGroup = '';
      container.dataset.v099tGroupKey = `${mode}|${activeGroup}`;
      if (!active.length) {
        container.innerHTML = `${board}<div data-v099t-group-root class="empty-state"><strong>没有可分组的豆卡</strong></div>`;
        return;
      }
      if (!activeGroup) {
        container.innerHTML = `${board}<section data-v099t-group-root><div class="v099f-freshness-note v099i-freshness-note">${modeNote(mode)}</div><div class="bean-grid compact-grid group-grid bean-grid-animated manual-motion">${groups.map(group => { const weight = group.items.reduce((sum, bean) => sum + Number(bean.remainingWeight || 0), 0); return `<button class="group-card v099f-stage-card" type="button" data-v099t-open-group="${esc(group.key)}"><span>${esc(group.label)}</span><small>${group.items.length}只 · ${weight.toFixed(1)}g</small></button>`; }).join('')}</div></section>`;
        return;
      }
      const group = groups.find(item => item.key === activeGroup);
      const items = group ? sortedItems(group.items, mode) : [];
      container.innerHTML = `${board}<section data-v099t-group-root class="active-group-panel auto-motion"><div class="active-group-title"><span>${esc(group?.label || activeGroup)}</span><small>${items.length}只 · ${mode === MODE_FRESHNESS ? '烘焙日期由新到旧' : '余量由少到多'}</small></div><div class="bean-grid compact-grid bean-grid-animated auto-motion">${items.map(bean => beanCardHtml(bean, index, scoreMap)).join('') || '<p class="muted">该分组没有豆卡</p>'}</div><div class="group-collapse-zone" data-v099t-group-back><button class="group-collapse" type="button" data-v099t-group-back>收</button></div></section>`;
    } finally {
      rendering = false;
      container.classList.remove('v099t-group-busy');
    }
  }

  function pickBean(mode, beans, scoreMap) {
    if (mode === 'leaderboard') return [...beans].sort((a, b) => (scoreMap.get(b.id) || 0) - (scoreMap.get(a.id) || 0))[0];
    if (mode === 'freshness') return [...beans].sort((a, b) => Number(freshnessProfile(b).flavorScore || 0) - Number(freshnessProfile(a).flavorScore || 0))[0];
    if (mode === 'price') return [...beans].sort((a, b) => Number(b.price || 0) - Number(a.price || 0))[0];
    if (mode === 'remaining') return [...beans].sort((a, b) => Number(a.remainingWeight || 0) - Number(b.remainingWeight || 0))[0];
    return beans[Math.floor(Math.random() * beans.length)];
  }

  async function animateBean(bean, { persist = false, duration = 720 } = {}) {
    const mode = await getMode();
    activeGroup = mode === MODE_FRESHNESS ? freshnessStage(bean) : String(Math.floor(Math.max(0, Number(bean.remainingWeight || 0)) / 50) * 50);
    if (persist) { selectedId = bean.id; localStorage.setItem(SELECTED_KEY, selectedId); }
    const container = $('#beanGroups');
    if (container) delete container.dataset.v099tGroupKey;
    await render({ force: true });
    await nextFrames();
    const card = $(`#beanGroups [data-bean-id="${CSS.escape(bean.id)}"]`);
    if (!card) return wait(duration);
    card.classList.remove('recommend-step');
    void card.offsetWidth;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('recommend-step');
    await wait(duration);
    card.classList.remove('recommend-step');
    if (persist) card.classList.add('recommended', 'v099l-selected');
  }

  async function runRecommendation(mode) {
    if (recommendationBusy) return;
    recommendationBusy = true;
    $$('.recommend-menu,.popup-menu').forEach(node => node.remove());
    try {
      const { index, active, scoreMap } = await loadData();
      if (!active.length) return toast('没有可推荐的豆卡');
      selectedId = '';
      let selected;
      if (mode === 'random') {
        const rounds = Math.floor(Math.random() * 5) + 4;
        let previous = '';
        for (let step = 0; step < rounds; step += 1) {
          const pool = active.length > 1 ? active.filter(bean => bean.id !== previous) : active;
          selected = pool[Math.floor(Math.random() * pool.length)];
          previous = selected.id;
          await animateBean(selected, { persist: step === rounds - 1, duration: step === rounds - 1 ? 820 : 420 });
        }
      } else {
        selected = pickBean(mode, active, scoreMap);
        await animateBean(selected, { persist: true, duration: 820 });
      }
      toast(`已选：${labelFor(index, 'countries', selected.countryCode, '未定国家')} · ${labelFor(index, 'varieties', selected.varietyCode, '未定豆种')}`, 'recommendation');
    } finally { recommendationBusy = false; }
  }

  async function handleClick(event) {
    const mode = currentMode || MODE_NATIVE;
    const recommendation = event.target.closest?.('[data-recommend-mode]');
    if (recommendation && [MODE_FRESHNESS, MODE_REMAINING].includes(mode)) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      runRecommendation(recommendation.dataset.recommendMode).catch(error => toast(error.message, 'status-bad'));
      return;
    }
    const freshness = event.target.closest?.('[data-v099f-group-freshness],[data-v099i-group-freshness]');
    if (freshness) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      captureBoard(); captureRenderedRatios(); await saveMode(MODE_FRESHNESS); $$('.popup-menu').forEach(node => node.remove());
      const container = $('#beanGroups'); if (container) delete container.dataset.v099tGroupKey;
      await render({ force: true }); return;
    }
    const remaining = event.target.closest?.('[data-v098-group-method="remaining-50"]');
    if (remaining) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      captureBoard(); captureRenderedRatios(); await saveMode(MODE_REMAINING); $$('.popup-menu').forEach(node => node.remove());
      const container = $('#beanGroups'); if (container) delete container.dataset.v099tGroupKey;
      await render({ force: true }); return;
    }
    const group = event.target.closest?.('[data-v099t-open-group]');
    if (group) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); activeGroup = group.dataset.v099tOpenGroup;
      const container = $('#beanGroups'); if (container) delete container.dataset.v099tGroupKey;
      await render({ force: true }); return;
    }
    if (event.target.closest?.('[data-v099t-group-back]')) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); activeGroup = '';
      const container = $('#beanGroups'); if (container) delete container.dataset.v099tGroupKey;
      await render({ force: true }); return;
    }
    if (event.target.closest?.('[data-group-method]')) { await saveMode(MODE_NATIVE); invalidateData(); return; }
    if (event.target.closest?.('[data-page-target="beans"]') && [MODE_FRESHNESS, MODE_REMAINING].includes(mode)) {
      setTimeout(() => { captureBoard(); const container = $('#beanGroups'); if (container) delete container.dataset.v099tGroupKey; render({ force: true, refreshData: true }).catch(() => {}); }, 60);
    }
  }

  window.addEventListener('click', event => { handleClick(event).catch(error => console.error('豆藏分组处理失败', error)); }, true);
  window.addEventListener('pageshow', () => { getMode().then(mode => { if ([MODE_FRESHNESS, MODE_REMAINING].includes(mode) && $('#pageBeans.active')) setTimeout(() => { captureBoard(); render({ force: true, refreshData: true }).catch(() => {}); }, 80); }).catch(() => {}); });

  const prewarm = () => loadData().catch(() => {});
  if ('requestIdleCallback' in globalThis) requestIdleCallback(prewarm, { timeout: 1600 }); else setTimeout(prewarm, 600);
  getMode().then(mode => { if ([MODE_FRESHNESS, MODE_REMAINING].includes(mode) && $('#pageBeans.active')) setTimeout(() => { captureBoard(); render({ force: true }).catch(() => {}); }, 80); }).catch(() => {});

  globalThis.LuckyBeanV099tBeanGroups = { render, captureRenderedRatios, ratioFor, runRecommendation, invalidateData };
}
