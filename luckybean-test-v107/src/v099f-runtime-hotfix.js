import { getSetting } from './db.js';

if (!globalThis.__LuckyBeanV099fRuntimeHotfixLoaded) {
  globalThis.__LuckyBeanV099fRuntimeHotfixLoaded = true;

  const GROUP_MODE_KEY = 'v099f.group.mode';
  let queued = false;
  let lastBagText = '';

  function toast(message, kind = '') {
    const node = document.querySelector('#toast');
    if (!node) return;
    node.textContent = message;
    node.className = `toast show ${kind}`;
    setTimeout(() => { node.className = 'toast'; }, 2800);
  }

  // Capture the text before the legacy handoff handler removes the capture dialog.
  document.addEventListener('click', event => {
    const button = event.target.closest?.('#bagHandoffBtn');
    if (!button) return;
    lastBagText = String(document.querySelector('#bagOcrText')?.value || '').trim();
    if (!lastBagText) return;
    document.documentElement.classList.add('v099f-auto-parsing');
    setTimeout(() => {
      const textarea = document.querySelector('#recognitionText');
      const parse = document.querySelector('#parseTextBtn');
      if (!textarea || !parse) {
        document.documentElement.classList.remove('v099f-auto-parsing');
        toast('未找到文字解析页面，请重新进入文字识别', 'status-bad');
        return;
      }
      textarea.value = lastBagText;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      parse.click();
      lastBagText = '';
    }, 120);
  }, true);

  async function ensureFreshnessView() {
    queued = false;
    if (await getSetting(GROUP_MODE_KEY, 'native') !== 'freshness') return;
    const page = document.querySelector('#pageBeans.active');
    const container = document.querySelector('#beanGroups');
    if (!page || !container || !globalThis.LuckyBeanV099fUi?.renderFreshnessGrouping) return;
    const hasFreshnessUi = Boolean(container.querySelector('[data-v099f-open-stage],[data-v099f-stage-back],.v099f-freshness-note'));
    if (hasFreshnessUi) return;
    delete container.dataset.v099fFreshnessRendered;
    delete container.dataset.stage;
    globalThis.LuckyBeanV099fUi.renderFreshnessGrouping();
  }

  function queueFreshnessCheck() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => requestAnimationFrame(ensureFreshnessView));
  }

  new MutationObserver(records => {
    if (records.some(record => record.target?.id === 'beanGroups' || [...record.addedNodes].some(node => node.nodeType === 1 && (node.id === 'beanGroups' || node.querySelector?.('#beanGroups'))))) queueFreshnessCheck();
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-page-target="beans"],#groupBtn,[data-group-method],[data-v099f-group-freshness]')) setTimeout(queueFreshnessCheck, 30);
  });

  globalThis.LuckyBeanV099fRuntimeHotfix = { ensureFreshnessView: queueFreshnessCheck };
}
