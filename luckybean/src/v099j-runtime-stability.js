/* Lucky Bean 099k runtime stability: repair FAB position without altering browser observers or settings toggles. */
if (!globalThis.__LuckyBeanV099kRuntimeStabilityLoaded) {
  globalThis.__LuckyBeanV099kRuntimeStabilityLoaded = true;

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

  globalThis.LuckyBeanRuntimeStabilityV099k = {
    repairFab,
    resetFab: () => repairFab({ forceDefault: true })
  };
}
