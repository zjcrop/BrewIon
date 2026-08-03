/* Lucky Bean 099u: remove duplicate management history entry and skip duplicate OCR editor. */
if (!globalThis.__LuckyBeanV099uMenuOcrFlowLoaded) {
  globalThis.__LuckyBeanV099uMenuOcrFlowLoaded = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function removeDuplicateHistoryEntry() {
    $$('[data-manage-action="history"]').forEach(node => node.remove());
  }

  function autoSubmitRecognizedText() {
    const overlayRoot = $('#overlayRoot');
    if (!overlayRoot) return;

    let finished = false;
    let attempts = 0;
    let timer = 0;

    const stop = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      observer.disconnect();
      document.documentElement.classList.remove('v099u-ocr-handoff');
    };

    const trySubmit = () => {
      if (finished) return;
      attempts += 1;
      const overlay = $('[data-overlay="text-recognition"]', overlayRoot);
      if (overlay) {
        overlay.style.visibility = 'hidden';
        overlay.setAttribute('aria-hidden', 'true');
      }
      const textarea = $('#recognitionText', overlayRoot);
      const parseButton = $('#parseTextBtn', overlayRoot);
      if (textarea?.value.trim() && parseButton) {
        parseButton.click();
        stop();
        return;
      }
      if (attempts >= 40) {
        if (overlay) {
          overlay.style.visibility = '';
          overlay.removeAttribute('aria-hidden');
        }
        stop();
        return;
      }
      timer = setTimeout(trySubmit, 16);
    };

    const observer = new MutationObserver(trySubmit);
    observer.observe(overlayRoot, { childList: true, subtree: true });
    document.documentElement.classList.add('v099u-ocr-handoff');
    timer = setTimeout(trySubmit, 0);
  }

  document.addEventListener('click', event => {
    if (event.target.closest?.('#manageBtn')) {
      queueMicrotask(removeDuplicateHistoryEntry);
      requestAnimationFrame(removeDuplicateHistoryEntry);
      return;
    }

    const duplicateHistory = event.target.closest?.('[data-manage-action="history"]');
    if (duplicateHistory) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      duplicateHistory.remove();
      return;
    }

    if (event.target.closest?.('#bagHandoffBtn')) autoSubmitRecognizedText();
  }, true);

  removeDuplicateHistoryEntry();
  globalThis.LuckyBeanV099uMenuOcrFlow = { removeDuplicateHistoryEntry, autoSubmitRecognizedText };
}
