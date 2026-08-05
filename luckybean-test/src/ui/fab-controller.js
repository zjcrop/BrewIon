const STORAGE_KEY = 'luckybean.fab.position.v1';
const wrap = document.querySelector('#fabWrap');

if (wrap && !globalThis.__LuckyBeanFabControllerLoaded) {
  globalThis.__LuckyBeanFabControllerLoaded = true;
  wrap.dataset.fabController = 'v1';

  const handle = document.createElement('span');
  handle.className = 'v097-fab-drag-handle';
  handle.setAttribute('aria-label', '拖动快捷菜单');
  handle.setAttribute('title', '拖动移动');
  Object.assign(handle.style, {
    position: 'absolute', left: '50%', top: '50%', width: '42px', height: '42px',
    transform: 'translate(-50%, -50%)', borderRadius: '50%', background: 'rgba(255,255,255,.18)',
    border: '2px solid rgba(255,255,255,.48)', boxShadow: '0 0 0 5px rgba(255,255,255,.08), 0 2px 7px rgba(0,0,0,.5)',
    cursor: 'grab', touchAction: 'none', zIndex: '5'
  });
  wrap.append(handle);
  wrap.querySelectorAll('.fab').forEach(button => button.addEventListener('pointerdown', event => event.stopPropagation()));

  function clampPosition(x, y) {
    const rect = wrap.getBoundingClientRect();
    return {
      x: Math.min(Math.max(8, x), Math.max(8, innerWidth - rect.width - 8)),
      y: Math.min(Math.max(8, y), Math.max(8, innerHeight - rect.height - 70))
    };
  }

  function apply(x, y, save = false) {
    const next = clampPosition(x, y);
    wrap.style.left = `${next.x}px`;
    wrap.style.top = `${next.y}px`;
    wrap.style.right = 'auto';
    wrap.style.bottom = 'auto';
    wrap.style.transform = 'none';
    if (save) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) apply(saved.x, saved.y);
    } catch { localStorage.removeItem(STORAGE_KEY); }
  }

  function repair() {
    if (wrap.classList.contains('hidden')) return;
    const rect = wrap.getBoundingClientRect();
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.width < 20 || rect.height < 20) {
      localStorage.removeItem(STORAGE_KEY);
      wrap.style.removeProperty('left'); wrap.style.removeProperty('top');
      wrap.style.removeProperty('right'); wrap.style.removeProperty('bottom'); wrap.style.removeProperty('transform');
      return;
    }
    apply(rect.left, rect.top, true);
  }

  let drag = null;
  handle.addEventListener('pointerdown', event => {
    const rect = wrap.getBoundingClientRect();
    drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    handle.setPointerCapture(event.pointerId);
    handle.style.cursor = 'grabbing';
    event.preventDefault();
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    apply(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
  });
  const finish = event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = wrap.getBoundingClientRect();
    apply(rect.left, rect.top, true);
    drag = null;
    handle.style.cursor = 'grab';
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  addEventListener('resize', () => requestAnimationFrame(repair), { passive: true });
  addEventListener('orientationchange', () => setTimeout(repair, 120), { passive: true });
  addEventListener('pageshow', () => requestAnimationFrame(repair));
  restore();

  globalThis.LuckyBeanFabController = { repair, reset: () => { localStorage.removeItem(STORAGE_KEY); wrap.style.removeProperty('left'); wrap.style.removeProperty('top'); wrap.style.removeProperty('right'); wrap.style.removeProperty('bottom'); wrap.style.removeProperty('transform'); requestAnimationFrame(repair); } };
}
