const POST_BREW_FLAG = 'luckybean-postbrew-mode-choice';
let pendingModeChoice = false;
let resetTimer = null;
let observerQueued = false;

function clearPending() {
  pendingModeChoice = false;
  clearTimeout(resetTimer);
  resetTimer = null;
  document.documentElement.classList.remove('v095-postbrew-mode-choice');
  delete document.documentElement.dataset.postBrewSensory;
}

function beginPending() {
  pendingModeChoice = true;
  document.documentElement.classList.add('v095-postbrew-mode-choice');
  document.documentElement.dataset.postBrewSensory = 'waiting-for-mode-choice';
  clearTimeout(resetTimer);
  resetTimer = setTimeout(clearPending, 12000);
}

function restoreModeChoice() {
  if (!pendingModeChoice) return;

  const modePanel = document.querySelector('.v095-sensory-modes[data-mode-version="professional-v2"]');
  if (modePanel) {
    clearPending();
    return;
  }

  const evaluation = document.querySelector('#sensoryContent .sensory-evaluation');
  const cancelButton = evaluation?.querySelector('#cancelEvaluationBtn');
  if (!evaluation || !cancelButton) return;

  document.documentElement.dataset.postBrewSensory = 'cancelling-auto-evaluation';
  cancelButton.click();
}

function queueRestore() {
  if (observerQueued) return;
  observerQueued = true;
  requestAnimationFrame(() => {
    observerQueued = false;
    restoreModeChoice();
  });
}

document.addEventListener('click', event => {
  if (!event.target.closest?.('#recordConsumptionBtn')) return;
  beginPending();
}, true);

new MutationObserver(queueRestore).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('pagehide', clearPending);
