import { all, getSetting, setSetting } from './db.js';
import { loadCodebook, makeIndex, displayName } from './codebook.js';
import { freshnessProfile, clamp } from './utils.js';
import { normalizeRecommendationScore } from './preference-model.js';

if (!globalThis.__LuckyBeanV099mFreshnessGroupLoaded) {
  globalThis.__LuckyBeanV099mFreshnessGroupLoaded = true;

  const MODE_KEY = 'v099i.group.mode';
  const LEGACY_MODE_KEY = 'v099f.group.mode';
  const MODE_RATIO = 'freshness-ratio';
  const SELECTED_KEY = 'luckybean.selected.bean.v098';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  const measuredRatios = new Map();
  let codebookPromise = null;
  let activeStage = '';
  let currentMode = '';
  let rendering = false;
  let recommendationBusy = false;
  let selectedId = localStorage.getItem(SELECTED_KEY) || '';

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

  function captureRenderedRatios() {
    $$('#beanGroups .bean-card[data-bean-id]').forEach(card => {
      const track = $('.bean-freshness-progress', card);
      const solid = $('.bean-freshness-solid', card);
      if (!track || !solid) return;
      const trackWidth = track.getBoundingClientRect().width;
      const solidWidth = solid.getBoundingClientRect().width;
      if (trackWidth > 2 && Number.isFinite(solidWidth)) {
        measuredRatios.set(card.dataset.beanId, clamp(solidWidth / trackWidth, 0, 1));
      }
    });
  }

  function ratioFor(bean) {
    if (measuredRatios.has(bean.id)) return measuredRatios.get(bean.id);
    return clamp(Number(freshnessProfile(bean).progress || 0), 0, 1);
  }

  function stageFor(bean) {
    const ratio = ratioFor(bean);
    if (ratio < 1 / 3) return '养豆中';
    if (ratio < 2 / 3) return '味正盛';
    return '味将尽';
  }

  function averageScore(beanId, records) {
    const items = records.filter(record => record.beanId === beanId);
    return items.length
      ? items.reduce((sum, record) => sum + normalizeRecommendationScore(record), 0) / items.length
      : 0;
  }

  function beanCardHtml(bean, index, records) {
    const process = labelFor(index, 'processes', bean.processCode, '处理法未记');
    const country = labelFor(index, 'countries', bean.countryCode, '未定国家');
    const variety = labelFor(index, 'varieties', bean.varietyCode, '未定豆种');
    const fresh = freshnessProfile(bean);
    const score = averageScore(bean.id, records);
    const progress = Math.round(ratioFor(bean) * 1000) / 10;
    const selected = bean.id === selectedId;
    return `<article class="bean-card compact${selected ? ' recommended v099l-selected' : ''}" data-bean-id="${esc(bean.id)}" tabindex="0">
      <div class="compact-bean-copy"><h3>${esc(country)} · ${esc(variety)}</h3><small>${esc(process)}</small><div class="compact-bean-row"><strong>${Number(bean.remainingWeight || 0).toFixed(1)}g${bean.refrigerated ? '<small class="frozen-mark">❄️</small>' : ''}</strong><span class="compact-score">${score ? `${score.toFixed(1)}分` : '未评分'}${selected ? '<em>选</em>' : ''}</span></div></div>
      <button class="cup-action compact-pick" type="button" data-brew-bean="${esc(bean.id)}">酌</button>
      <div class="bean-freshness-progress" aria-label="时间轴已填充${progress}%"><span class="bean-freshness-solid" style="width:${progress}%;background:${fresh.color}"></span><span class="bean-freshness-dashed" style="left:${progress}%"></span></div>
    </article>`;
  }

  async function getMode() {
    if (currentMode) return currentMode;
    const [saved, legacy] = await Promise.all([
      getSetting(MODE_KEY, 'native'),
      getSetting(LEGACY_MODE_KEY, 'native')
    ]);
    currentMode = saved === MODE_RATIO || legacy === 'freshness' ? MODE_RATIO : 'native';
    if (legacy === 'freshness') {
      await Promise.all([
        setSetting(MODE_KEY, MODE_RATIO),
        setSetting(LEGACY_MODE_KEY, 'native')
      ]);
    }
    return currentMode;
  }

  async function loadData() {
    const [{ index }, beans, sensoryRecords] = await Promise.all([
      codebookContext(), all('beans'), all('sensoryRecords')
    ]);
    const active = beans
      .filter(bean => !bean.archived && Number(bean.remainingWeight) > 0)
      .sort((a, b) => String(b.roastDate || '').localeCompare(String(a.roastDate || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { index, active, sensoryRecords };
  }

  async function render({ force = false } = {}) {
    if (rendering || await getMode() !== MODE_RATIO) return;
    const page = $('#pageBeans.active');
    const container = $('#beanGroups');
    if (!page || !container) return;
    if (!force && container.dataset.v099mFreshnessStage === activeStage && container.querySelector('[data-v099m-freshness-root]')) return;

    rendering = true;
    try {
      const { index, active, sensoryRecords } = await loadData();
      const order = ['养豆中', '味正盛', '味将尽'];
      const groups = new Map(order.map(label => [label, []]));
      active.forEach(bean => groups.get(stageFor(bean)).push(bean));
      container.dataset.v099mFreshnessStage = activeStage;

      if (!active.length) {
        container.innerHTML = '<div data-v099m-freshness-root class="empty-state"><strong>没有可分组的豆卡</strong></div>';
        return;
      }

      if (!activeStage) {
        container.innerHTML = `<section data-v099m-freshness-root>
          <div class="v099f-freshness-note v099i-freshness-note">按时间轴有色长度÷整行宽度分为三组：不足1/3为“养豆中”，达到1/3且不足2/3为“味正盛”，达到2/3为“味将尽”。组内按烘焙日期由新到旧。</div>
          <div class="bean-grid compact-grid group-grid bean-grid-animated manual-motion">${order.map(label => {
            const items = groups.get(label);
            const weight = items.reduce((sum, bean) => sum + Number(bean.remainingWeight || 0), 0);
            return `<button class="group-card v099f-stage-card" type="button" data-v099m-open-stage="${label}"><span>${label}</span><small>${items.length}只 · ${weight.toFixed(1)}g</small></button>`;
          }).join('')}</div>
        </section>`;
        return;
      }

      const items = groups.get(activeStage) || [];
      container.innerHTML = `<section data-v099m-freshness-root class="active-group-panel auto-motion">
        <div class="active-group-title"><span>${activeStage}</span><small>${items.length}只 · 烘焙日期由新到旧</small></div>
        <div class="bean-grid compact-grid bean-grid-animated auto-motion">${items.map(bean => beanCardHtml(bean, index, sensoryRecords)).join('') || '<p class="muted">该阶段没有豆卡</p>'}</div>
        <div class="group-collapse-zone"><button class="group-collapse" type="button" data-v099m-stage-back>收</button></div>
      </section>`;
    } finally {
      rendering = false;
    }
  }

  function invalidate() {
    const container = $('#beanGroups');
    if (container) delete container.dataset.v099mFreshnessStage;
  }

  function pickBean(mode, beans, records) {
    if (mode === 'leaderboard') return [...beans].sort((a, b) => averageScore(b.id, records) - averageScore(a.id, records))[0];
    if (mode === 'freshness') return [...beans].sort((a, b) => Number(freshnessProfile(b).flavorScore || 0) - Number(freshnessProfile(a).flavorScore || 0))[0];
    if (mode === 'price') return [...beans].sort((a, b) => Number(b.price || 0) - Number(a.price || 0))[0];
    if (mode === 'remaining') return [...beans].sort((a, b) => Number(a.remainingWeight || 0) - Number(b.remainingWeight || 0))[0];
    return beans[Math.floor(Math.random() * beans.length)];
  }

  async function animateBean(bean, { persist = false, duration = 720 } = {}) {
    activeStage = stageFor(bean);
    if (persist) {
      selectedId = bean.id;
      localStorage.setItem(SELECTED_KEY, selectedId);
    }
    invalidate();
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
      const { index, active, sensoryRecords } = await loadData();
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
        selected = pickBean(mode, active, sensoryRecords);
        await animateBean(selected, { persist: true, duration: 820 });
      }
      toast(`已选：${labelFor(index, 'countries', selected.countryCode, '未定国家')} · ${labelFor(index, 'varieties', selected.varietyCode, '未定豆种')}`, 'recommendation');
    } finally {
      recommendationBusy = false;
    }
  }

  async function handleClick(event) {
    const recommendation = event.target.closest?.('[data-recommend-mode]');
    if (recommendation && currentMode === MODE_RATIO) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      runRecommendation(recommendation.dataset.recommendMode).catch(error => toast(error.message, 'status-bad'));
      return;
    }

    const freshness = event.target.closest?.('[data-v099f-group-freshness],[data-v099i-group-freshness]');
    if (freshness) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      captureRenderedRatios();
      currentMode = MODE_RATIO;
      activeStage = '';
      await Promise.all([
        setSetting(MODE_KEY, MODE_RATIO),
        setSetting(LEGACY_MODE_KEY, 'native')
      ]);
      $$('.popup-menu').forEach(node => node.remove());
      invalidate();
      await render({ force: true });
      return;
    }

    const stage = event.target.closest?.('[data-v099m-open-stage]');
    if (stage) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      activeStage = stage.dataset.v099mOpenStage;
      invalidate();
      await render({ force: true });
      return;
    }

    if (event.target.closest?.('[data-v099m-stage-back]')) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      activeStage = '';
      invalidate();
      await render({ force: true });
      return;
    }

    if (event.target.closest?.('[data-group-method],[data-v098-group-method]')) {
      currentMode = 'native';
      activeStage = '';
      await Promise.all([
        setSetting(MODE_KEY, 'native'),
        setSetting(LEGACY_MODE_KEY, 'native')
      ]);
    }

    if (event.target.closest?.('[data-page-target="beans"]') && await getMode() === MODE_RATIO) {
      setTimeout(() => render({ force: true }), 60);
    }
  }

  window.addEventListener('click', handleClick, true);
  window.addEventListener('pageshow', () => {
    getMode().then(mode => {
      if (mode === MODE_RATIO && $('#pageBeans.active')) render({ force: true });
    }).catch(() => {});
  });

  getMode().then(mode => {
    if (mode === MODE_RATIO && $('#pageBeans.active')) render({ force: true });
  }).catch(() => {});

  globalThis.LuckyBeanV099mFreshnessGroup = {
    render,
    captureRenderedRatios,
    ratioFor,
    runRecommendation
  };
}
