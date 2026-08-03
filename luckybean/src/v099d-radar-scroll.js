const RADAR_TARGET = '[data-radar-axis], .v095-radar-handle, [data-radar-slider]';
let pending = null;
let restoreQueued = false;

function dialogFor(node) {
  return node?.closest?.('.v095-professional-dialog') || document.querySelector('.v095-professional-dialog');
}

function remember(node) {
  const dialog = dialogFor(node);
  if (!dialog) return;
  pending = {
    dialogTop: dialog.scrollTop,
    dialogLeft: dialog.scrollLeft,
    pageX: window.scrollX,
    pageY: window.scrollY,
    axis: node?.closest?.('[data-radar-axis]')?.dataset?.radarAxis || ''
  };
  queueRestore();
}

function restore() {
  restoreQueued = false;
  if (!pending) return;
  const snapshot = pending;
  const dialog = document.querySelector('.v095-professional-dialog');
  if (!dialog) return;
  dialog.scrollTop = snapshot.dialogTop;
  dialog.scrollLeft = snapshot.dialogLeft;
  window.scrollTo(snapshot.pageX, snapshot.pageY);
  if (snapshot.axis) {
    const target = dialog.querySelector(`[data-radar-axis="${CSS.escape(snapshot.axis)}"]`);
    try { target?.focus?.({ preventScroll: true }); } catch { /* optional focus */ }
    dialog.scrollTop = snapshot.dialogTop;
    window.scrollTo(snapshot.pageX, snapshot.pageY);
  }
  pending = null;
}

function queueRestore() {
  if (restoreQueued) return;
  restoreQueued = true;
  queueMicrotask(() => requestAnimationFrame(() => requestAnimationFrame(restore)));
}

document.addEventListener('pointerdown', event => {
  const target = event.target.closest?.(RADAR_TARGET);
  if (target) remember(target);
}, true);

document.addEventListener('click', event => {
  const target = event.target.closest?.(RADAR_TARGET);
  if (!target) return;
  event.preventDefault();
  remember(target);
}, true);

document.addEventListener('input', event => {
  const target = event.target.closest?.('[data-radar-slider]');
  if (target) remember(target);
}, true);

new MutationObserver(records => {
  if (!pending) return;
  if (records.some(record => record.target.closest?.('#v095ProfessionalWizard') || [...record.addedNodes].some(node => node.nodeType === 1 && (node.id === 'v095ProfessionalWizard' || node.querySelector?.('.v095-professional-dialog'))))) {
    queueRestore();
  }
}).observe(document.documentElement, { childList: true, subtree: true });

globalThis.LuckyBeanV099dRadarScroll = { remember, restore };
