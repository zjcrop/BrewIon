const RADAR_TARGET = '[data-radar-axis], .v095-radar-handle, [data-radar-slider]';
let pending = null;
let restoreTimer = 0;

function scrollingNodes(node) {
  const nodes = [];
  let current = node;
  while (current && current !== document.documentElement) {
    if (current instanceof HTMLElement && (current.scrollTop || current.scrollLeft || current.matches('.v095-wizard-overlay,.v095-professional-dialog'))) nodes.push(current);
    current = current.parentElement;
  }
  for (const selector of ['.v095-wizard-overlay', '.v095-professional-dialog', '#mainContent']) {
    const found = document.querySelector(selector);
    if (found && !nodes.includes(found)) nodes.push(found);
  }
  return nodes;
}

function remember(node) {
  pending = {
    pageX: window.scrollX,
    pageY: window.scrollY,
    nodes: scrollingNodes(node).map(item => ({
      selector: item.id ? `#${CSS.escape(item.id)}` : item.classList.contains('v095-wizard-overlay') ? '.v095-wizard-overlay' : item.classList.contains('v095-professional-dialog') ? '.v095-professional-dialog' : '#mainContent',
      top: item.scrollTop,
      left: item.scrollLeft
    }))
  };
  restoreRepeatedly();
}

function restoreOnce() {
  if (!pending) return;
  const snapshot = pending;
  for (const item of snapshot.nodes) {
    const node = document.querySelector(item.selector);
    if (!node) continue;
    node.scrollTop = item.top;
    node.scrollLeft = item.left;
  }
  window.scrollTo(snapshot.pageX, snapshot.pageY);
}

function restoreRepeatedly() {
  clearTimeout(restoreTimer);
  const started = performance.now();
  const tick = () => {
    restoreOnce();
    if (pending && performance.now() - started < 700) restoreTimer = setTimeout(tick, 16);
    else pending = null;
  };
  queueMicrotask(() => requestAnimationFrame(tick));
}

for (const type of ['pointerdown', 'click', 'input', 'change']) {
  document.addEventListener(type, event => {
    const target = event.target.closest?.(RADAR_TARGET);
    if (target) remember(target);
  }, true);
}

new MutationObserver(records => {
  if (!pending) return;
  if (records.some(record => record.target.closest?.('#v095ProfessionalWizard') || [...record.addedNodes].some(node => node.nodeType === 1 && (node.id === 'v095ProfessionalWizard' || node.querySelector?.('.v095-wizard-overlay,.v095-professional-dialog'))))) restoreRepeatedly();
}).observe(document.documentElement, { childList: true, subtree: true });

globalThis.LuckyBeanV099dRadarScroll = { remember, restoreOnce };
