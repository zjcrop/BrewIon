import { all, getSetting, setSetting } from './db.js';
import { loadCodebook, makeIndex, displayName } from './codebook.js';
import { freshnessProfile, clamp } from './utils.js';
import { normalizeRecommendationScore } from './preference-model.js';

if (!globalThis.__LuckyBeanV099iFreshnessGroupLoaded) {
  globalThis.__LuckyBeanV099iFreshnessGroupLoaded = true;

  const MODE_KEY = 'v099i.group.mode';
  const LEGACY_MODE_KEY = 'v099f.group.mode';
  const MODE_RATIO = 'freshness-ratio';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let codebookPromise = null;
  let activeStage = '';
  let rendering = false;
  let queued = false;
  let currentMode = '';

  async function mode() {
    if (!currentMode) currentMode = await getSetting(MODE_KEY, 'native');
    return currentMode;
  }

  async function codebookContext() {
    if (!codebookPromise) codebookPromise = loadCodebook().then(result => ({ index: makeIndex(result.data) }));
    return codebookPromise;
  }

  function labelFor(index, table, code, fallback) {
    return code ? displayName(index, table, code, fallback) : fallback;
  }

  function stageFor(bean) {
    const ratio = clamp(Number(freshnessProfile(bean).progress || 0), 0, 1);
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
    const score = records.length
      ? records.reduce((sum, record) => sum + normalizeRecommendationScore(record), 0) / records.length
      : 0;
    const progress = Math.round(clamp(Number(profile.progress || 0), 0, 1) * 100);
    return `<article class="bean-card compact" data-bean-id="${esc(bean.id)}" tabindex="0">
      <div class="compact-bean-copy"><h3>${esc(country)} · ${esc(variety)}</h3><small>${esc(process)}</small><div class="compact-bean-row"><strong>${Number(bean.remainingWeight || 0).toFixed(1)}g${bean.refrigerated ? '<small class="frozen-mark">❄️</small>' : ''}</strong><span class="compact-score">${score ? `${score.toFixed(1)}分` : '未评分'}</span></div></div>
      <button class="cup-action compact-pick" type="button" data-brew-bean="${esc(bean.id)}" aria-label="用这只豆小酌">酌</button>
      <div class="bean-freshness-progress" aria-label="时间轴已填充${progress}%"><span class="bean-freshness-solid" style="width:${progress}%;background:${profile.color}"></span><span class="bean-freshness-dashed" style="left:${progress}%"></span></div>
    </article>`;
  }

  async function render() {
    if (rendering || await mode() !== MODE_RATIO) return;
    const page = $('#pageBeans.active');
    const container = $('#beanGroups');
    if (!page || !container) return;
    const renderKey = `${activeStage}:${container.dataset.v099iSourceRevision || ''}`;
    if (container.dataset.v099iFreshnessRendered === renderKey) return;
    rendering = true;
    try {
      const [{ index }, beans, sensoryRecords] = await Promise.all([
        codebookContext(), all('beans'), all('sensoryRecords')
      ]);
      const active = beans
        .filter(bean => !bean.archived && Number(bean.remainingWeight) > 0)
        .sort((a, b) => String(b.roastDate || '').localeCompare(String(a.roastDate || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      const order = ['养豆中', '味正盛', '味将尽'];
      const groups = new Map(order.map(label => [label, []]));
      active.forEach(bean => groups.get(stageFor(bean)).push(bean));
      container.dataset.v099iFreshnessRendered = renderKey;
      if (!active.length) {
        container.innerHTML = '<div class="empty-state"><strong>没有可分组的豆卡</strong></div>';
        return;
      }
      if (!activeStage) {
        container.innerHTML = `<div class="v099f-freshness-note v099i-freshness-note">按时间轴填充长度÷整行宽度分组：不足1/3为“养豆中”，1/3至不足2/3为“味正盛”，达到2/3为“味将尽”。组内按烘焙日期由新到旧。</div><div class="bean-grid compact-grid group-grid">${order.map(label => {
          const items = groups.get(label);
          const total = items.reduce((sum, bean) => sum + Number(bean.remainingWeight || 0), 0);
          return `<button class="group-card v099f-stage-card" type="button" data-v099i-open-stage="${label}"><span>${label}</span><small>${items.length}只 · ${total.toFixed(1)}g</small></button>`;
        }).join('')}</div>`;
      } else {
        const items = groups.get(activeStage) || [];
        container.innerHTML = `<section class="active-group-panel"><div class="active-group-title"><span>${activeStage}</span><small>${items.length}只 · 烘焙日期由新到旧</small></div><div class="bean-grid compact-grid">${items.map(bean => compactBeanCard(bean, index, sensoryRecords)).join('') || '<p class="muted">该阶段没有豆卡</p>'}</div><div class="group-collapse-zone"><button class="group-collapse" type="button" data-v099i-stage-back>收</button></div></section>`;
      }
    } finally {
      rendering = false;
    }
  }

  function queueRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      queued = false;
      const container = $('#beanGroups');
      if (container && !container.querySelector('[data-v099i-open-stage],[data-v099i-stage-back],.v099i-freshness-note')) delete container.dataset.v099iFreshnessRendered;
      render();
    }));
  }

  document.addEventListener('click', async event => {
    const ratioButton = event.target.closest?.('[data-v099f-group-freshness],[data-v099i-group-freshness]');
    if (ratioButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      currentMode = MODE_RATIO;
      activeStage = '';
      await Promise.all([setSetting(MODE_KEY, MODE_RATIO), setSetting(LEGACY_MODE_KEY, 'native')]);
      $$('.popup-menu').forEach(node => node.remove());
      const container = $('#beanGroups');
      if (container) delete container.dataset.v099iFreshnessRendered;
      render();
      return;
    }
    const open = event.target.closest?.('[data-v099i-open-stage]');
    if (open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeStage = open.dataset.v099iOpenStage;
      const container = $('#beanGroups');
      if (container) delete container.dataset.v099iFreshnessRendered;
      render();
      return;
    }
    const back = event.target.closest?.('[data-v099i-stage-back]');
    if (back) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeStage = '';
      const container = $('#beanGroups');
      if (container) delete container.dataset.v099iFreshnessRendered;
      render();
      return;
    }
    const native = event.target.closest?.('[data-group-method]');
    if (native) {
      currentMode = 'native';
      activeStage = '';
      await setSetting(MODE_KEY, 'native');
    }
  }, true);

  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      if (record.target?.id === 'beanGroups') return true;
      return [...record.addedNodes].some(node => node.nodeType === 1 && (
        node.id === 'beanGroups' || node.matches?.('.popup-menu,#pageBeans') || node.querySelector?.('#beanGroups,.popup-menu')
      ));
    });
    if (relevant) queueRender();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-page-target="beans"],#groupBtn')) setTimeout(queueRender, 40);
  });
  queueRender();
  globalThis.LuckyBeanV099iFreshness = { render: queueRender };
}
