/* Runtime stability: coalesce document-wide observers, enforce one settings section, repair FAB position. */
if (!globalThis.__LuckyBeanV099jRuntimeStabilityLoaded) {
  globalThis.__LuckyBeanV099jRuntimeStabilityLoaded = true;

  const NativeMutationObserver = globalThis.MutationObserver;
  if (NativeMutationObserver && !globalThis.__LuckyBeanMutationObserverCoalesced) {
    globalThis.__LuckyBeanMutationObserverCoalesced = true;
    class CoalescedMutationObserver {
      constructor(callback) {
        this.callback = callback;
        this.globalScope = false;
        this.records = [];
        this.timer = 0;
        this.native = new NativeMutationObserver((records) => {
          if (!this.globalScope) {
            callback(records, this);
            return;
          }
          this.records.push(...records.slice(0, 300));
          if (this.timer) return;
          this.timer = window.setTimeout(() => {
            this.timer = 0;
            const batch = this.records.splice(0, 600);
            if (!batch.length || document.hidden) return;
            callback(batch, this);
          }, 72);
        });
      }
      observe(target, options = {}) {
        this.globalScope = Boolean(options.subtree && (target === document.documentElement || target === document.body));
        this.native.observe(target, options);
      }
      disconnect() {
        clearTimeout(this.timer);
        this.timer = 0;
        this.records.length = 0;
        this.native.disconnect();
      }
      takeRecords() { return this.native.takeRecords(); }
    }
    globalThis.MutationObserver = CoalescedMutationObserver;
  }

  const closeOtherSettings = current => {
    if (!current?.open) return;
    document.querySelectorAll('#settingsContent details[open]').forEach(item => {
      if (item !== current) item.open = false;
    });
  };
  document.addEventListener('toggle', event => {
    const current = event.target?.closest?.('#settingsContent details');
    if (current) closeOtherSettings(current);
  }, true);
  document.addEventListener('click', event => {
    const summary = event.target.closest?.('#settingsContent details > summary');
    if (!summary) return;
    requestAnimationFrame(() => closeOtherSettings(summary.parentElement));
  }, true);

  function defaultFab(node) {
    node.classList.add('v099j-anchor-reset');
    node.style.removeProperty('left');
    node.style.removeProperty('top');
    node.style.removeProperty('right');
    node.style.removeProperty('bottom');
    node.style.removeProperty('transform');
    localStorage.removeItem('luckybean.fab.position.v1');
    requestAnimationFrame(() => node.classList.remove('v099j-anchor-reset'));
  }

  function repairFab({ forceDefault = false } = {}) {
    const node = document.querySelector('#fabWrap');
    if (!node || node.classList.contains('hidden')) return;
    if (forceDefault) return defaultFab(node);
    const rect = node.getBoundingClientRect();
    const invalid = !Number.isFinite(rect.left) || !Number.isFinite(rect.top)
      || rect.width < 20 || rect.height < 20
      || rect.right < 8 || rect.bottom < 70
      || rect.left > innerWidth - 20 || rect.top > innerHeight - 70
      || (rect.left <= 2 && rect.top <= 2);
    if (invalid) return defaultFab(node);
    const x = Math.min(Math.max(8, rect.left), Math.max(8, innerWidth - rect.width - 8));
    const y = Math.min(Math.max(8, rect.top), Math.max(8, innerHeight - rect.height - 70));
    if (Math.abs(x - rect.left) > .5 || Math.abs(y - rect.top) > .5) {
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.style.right = 'auto';
      node.style.bottom = 'auto';
      localStorage.setItem('luckybean.fab.position.v1', JSON.stringify({ x, y }));
    }
  }

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-page-target="beans"]')) setTimeout(repairFab, 90);
  }, true);
  addEventListener('resize', () => setTimeout(repairFab, 60), { passive: true });
  addEventListener('orientationchange', () => setTimeout(repairFab, 180), { passive: true });
  addEventListener('pageshow', () => setTimeout(repairFab, 120));
  globalThis.LuckyBeanRuntimeStabilityV099j = { repairFab, resetFab: () => repairFab({ forceDefault: true }) };
}
