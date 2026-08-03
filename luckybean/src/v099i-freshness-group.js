import { all, getSetting, setSetting } from './db.js';
import { loadCodebook, makeIndex, displayName } from './codebook.js';
import { freshnessProfile, clamp } from './utils.js';
import { normalizeRecommendationScore } from './preference-model.js';

if (!globalThis.__LuckyBeanV099jFreshnessGroupLoaded) {
  globalThis.__LuckyBeanV099jFreshnessGroupLoaded = true;

  const MODE_KEY = 'v099i.group.mode';
  const LEGACY_MODE_KEY = 'v099f.group.mode';
  const MODE_RATIO = 'freshness-ratio';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const measuredRatios = new Map();
  let codebookPromise = null;
  let activeStage = '';
  let rendering = false;
  let queued = false;
  let currentMode = '';

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
      if (trackWidth > 2 && Number.isFinite(solidWidth)) measuredRatios.set(card.dataset.beanId, clamp(solidWidth / trackWidth, 0, 1));
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

  function compactBeanCard(bean, index, sensoryRecords) {
    const process = labelFor(index, 'processes', bean.processCode, '处理法未记');
    const country = labelFor(index, 'countries', bean.countryCode, '未定国家');
    const variety = labelFor(index, 'varieties', bean.varietyCode, '未定豆种');
    const profile = freshnessProfile(bean);
    const records = sensoryRecords.filter(record => record.beanId === bean.id);
    const score = records.length ? records.reduce((sum, record) => sum + normalizeRecommendationScore(record), 0) / records.length : 0;
    const ratio = ratioFor(bean);
    const progress = Math.round(ratio * 1000) / 10;
    return `<article class="bean-card compact" data-bean-id="${esc(bean.id)}" tabindex="0">
      <div class="compact-bean-copy"><h3>${esc(country)} · ${esc(variety)}</h3><small>${esc(process)}</small><div class="compact-bean-row"><strong>${Number(bean.remainingWeight || 0).toFixed(1)}g${bean.refrigerated ? '<small class="frozen-mark">❄️</small>' : ''}</strong><span class="compact-score">${score ? `${score.toFixed(1)}分` : '未评分'}</span></div></div>
      <button class="cup-action compact-pick" type="button" data-brew-bean="${esc(bean.id)}" aria-label="用这只豆小酌">酌</button>
      <div class="bean-freshness-progress" aria-label="时间轴实际填充${progress}%"><span class="bean-freshness-solid" style="width:${progress}%;background:${profile.color}"></span><span class="bean-freshness-dashed" style="left:${progress}%"></span></div>
    </article>`;
  }

  async function mode() {
    if (currentMode) return currentMode;
    const [saved, legacy] = await Promise.all([getSetting(MODE_KEY, 'native'), getSetting(LEGACY_MODE_KEY, 'native')]);
    currentMode = saved === MODE_RATIO || legacy === 'freshness' ? MODE_RATIO : 'native';
    if (legacy === 'freshness') await Promise.all([setSetting(MODE_KEY, MODE_RATIO), setSetting(LEGACY_MODE_KEY, 'native')]);
    return currentMode;
  }

  async function render() {
    if (rendering || await mode() !== MODE_RATIO) return;
    const page = $('#pageBeans.active');
    const container = $('#beanGroups');
    if (!page || !container) return;
    if (container.dataset.v099jFreshnessStage === activeStage && container.querySelector('[data-v099j-freshness-root]')) return;
    rendering = true;
    try {
      const [{ index }, beans, sensoryRecords] = await Promise.all([codebookContext(), all('beans'), all('sensoryRecords')]);
      const active = beans
        .filter(bean => !bean.archived && Number(bean.remainingWeight) > 0)
        .sort((a, b) => String(b.roastDate || '').localeCompare(String(a.roastDate || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      const order = ['养豆中', '味正盛', '味将尽'];
      const groups = new Map(order.map(label => [label, []]));
      active.forEach(bean => groups.get(stageFor(bean)).push(bean));
      container.dataset.v099jFreshnessStage = activeStage;
      if (!active.length) {
        container.innerHTML = '<div data-v099j-freshness-root class="empty-state"><strong>没有可分组的豆卡</strong></div>';
        return;
      }
      if (!activeStage) {
        container.innerHTML = `<section data-v099j-freshness-root><div class="v099f-freshness-note v099i-freshness-note">直接按豆卡时间轴已填充长度÷整行宽度分组：不足1/3为“养豆中”，达到1/3且不足2/3为“味正盛”，达到2/3为“味将尽”。组内按烘焙日期由新到旧。</div><div class="bean-grid compact-grid group-grid">${order.map(label => {
          const items = groups.get(label);
          const total = items.reduce((sum, bean) => sum + Number(bean.remainingWeight || 0), 0);
          return `<button class="group-card v099f-stage-card" type="button" data-v099j-open-stage="${label}"><span>${label}</span><small>${items.length}只 · ${total.toFixed(1)}g</small></button>`;
        }).join('')}</div></section>`;
      } else {
        const items = groups.get(activeStage) || [];
        container.innerHTML = `<section data-v099j-freshness-root class="active-group-panel"><div class="active-group-title"><span>${activeStage}</span><small>${items.length}只 · 烘焙日期由新到旧</small></div><div class="bean-grid compact-grid">${items.map(bean => compactBeanCard(bean, index, sensoryRecords)).join('') || '<p class="muted">该阶段没有豆卡</p>'}</div><div class="group-collapse-zone"><button class="group-collapse" type="button" data-v099j-stage-back>收</button></div></section>`;
      }
    } finally {
      rendering = false;
    }
  }

  function queueRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const container = $('#beanGroups');
      if (container && !container.querySelector('[data-v099j-freshness-root]')) delete container.dataset.v099jFreshnessStage;
      render();
    });
  }

  async function handleClick(event) {
    const ratioButton = event.target.closest?.('[data-v099f-group-freshness],[data-v099i-group-freshness]');
    if (ratioButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      captureRenderedRatios();
      currentMode = MODE_RATIO;
      activeStage = '';
      await Promise.all([setSetting(MODE_KEY, MODE_RATIO), setSetting(LEGACY_MODE_KEY, 'native')]);
      $$('.popup-menu').forEach(node => node.remove());
      const container = $('#beanGroups');
      if (container) delete container.dataset.v099jFreshnessStage;
      render();
      return;
    }
    const open = event.target.closest?.('[data-v099j-open-stage]');
    if (open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeStage = open.dataset.v099jOpenStage;
      const container = $('#beanGroups');
      if (container) delete container.dataset.v099jFreshnessStage;
      render();
      return;
    }
    const back = event.target.closest?.('[data-v099j-stage-back]');
    if (back) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeStage = '';
      const container = $('#beanGroups');
      if (container) delete container.dataset.v099jFreshnessStage;
      render();
      return;
    }
    const native = event.target.closest?.('[data-group-method]');
    if (native) {
      currentMode = 'native';
      activeStage = '';
      await Promise.all([setSetting(MODE_KEY, 'native'), setSetting(LEGACY_MODE_KEY, 'native')]);
    }
    if (event.target.closest?.('[data-page-target="beans"]')) setTimeout(queueRender, 80);
  }

  window.addEventListener('click', handleClick, true);
  const container = $('#beanGroups');
  if (container) new MutationObserver(() => {
    if (!rendering && currentMode === MODE_RATIO && !container.querySelector('[data-v099j-freshness-root]')) queueRender();
  }).observe(container, { childList: true });

  (async () => {
    await mode();
    if (currentMode === MODE_RATIO) queueRender();
  })();
  globalThis.LuckyBeanV099jFreshnessGroup = { render, captureRenderedRatios, ratioFor };
}
