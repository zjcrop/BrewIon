const SELECTED_KEY = 'luckybean.selected.bean.v098';
let queued = false;

function captureSelectedBean() {
  const selected = document.querySelector('#beanGroups .bean-card.recommended[data-bean-id]:not(.v098-selected)');
  if (!selected?.dataset.beanId) return false;
  localStorage.setItem(SELECTED_KEY, selected.dataset.beanId);
  selected.classList.add('v098-selected');
  return true;
}

function queueCapture() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    captureSelectedBean();
  });
}

document.addEventListener('click', event => {
  if (!event.target.closest?.('[data-recommend-mode],#fabRecommendBtn')) return;
  [0, 40, 120, 260, 500].forEach(delay => setTimeout(captureSelectedBean, delay));
}, true);

{
  const selectionObserver1 = new MutationObserver(queueCapture);
  ["#beanGroups"].forEach(selector => {
    const root = document.querySelector(selector);
    if (root) selectionObserver1.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  });
}
queueCapture();

globalThis.LuckyBeanSelectionBridge = { captureSelectedBean };
