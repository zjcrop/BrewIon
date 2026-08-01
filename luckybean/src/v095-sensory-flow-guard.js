let simpleNoteRequested = false;
let observerQueued = false;

function markSimpleNoteMode(event) {
  const button = event.target.closest?.('[data-v095-mode="note"]');
  if (!button) return;
  simpleNoteRequested = true;
  document.documentElement.dataset.simpleNoteFlow = 'pending';
  window.setTimeout(() => {
    if (document.documentElement.dataset.simpleNoteFlow === 'pending') {
      document.documentElement.classList.remove('v095-native-bypass');
      delete document.documentElement.dataset.simpleNoteFlow;
      simpleNoteRequested = false;
    }
  }, 8000);
}

function revealSimpleScore() {
  if (!simpleNoteRequested) return;
  if (!document.querySelector('#sensoryDeltaWheel')) return;
  document.documentElement.classList.remove('v095-native-bypass');
  document.documentElement.dataset.simpleNoteFlow = 'score-visible';
  simpleNoteRequested = false;
}

function queueReveal() {
  if (observerQueued) return;
  observerQueued = true;
  requestAnimationFrame(() => {
    observerQueued = false;
    revealSimpleScore();
  });
}

document.addEventListener('click', markSimpleNoteMode, true);
new MutationObserver(queueReveal).observe(document.documentElement, { childList: true, subtree: true });
