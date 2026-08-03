const EXPECTED_MODE_VERSION = 'professional-v2';
const BOOTSTRAP_VERSION = 'sensory-bootstrap-20260803d';
let importPromise = null;
let syncQueued = false;
let failureTimer = null;

function sensoryContent() {
  return document.querySelector('#sensoryContent');
}

function ensureSafeSentinel() {
  const content = sensoryContent();
  if (!content) return;
  const realStart = content.querySelector('.sensory-start-panel:not([data-sensory-sentinel])');
  if (realStart) {
    content.querySelectorAll('[data-sensory-sentinel]').forEach(node => node.remove());
    return;
  }
  if (!content.querySelector('[data-sensory-sentinel]')) {
    const sentinel = document.createElement('div');
    sentinel.className = 'sensory-start-panel';
    sentinel.hidden = true;
    sentinel.dataset.sensorySentinel = 'safe-null-root';
    content.append(sentinel);
  }
}

function startPanel() {
  return document.querySelector('#sensoryContent .sensory-start-panel:not([data-sensory-sentinel])');
}

function expectedPanel(panel = startPanel()) {
  return panel?.querySelector(`.v095-sensory-modes[data-mode-version="${EXPECTED_MODE_VERSION}"]`) || null;
}

function reserveModeSlot() {
  const panel = startPanel();
  if (!panel) return null;
  if (expectedPanel(panel)) return panel;
  const action = panel.querySelector('.sensory-start-action');
  const nativeButton = panel.querySelector('#startSensoryBtn');
  if (!action || !nativeButton) return null;
  [...panel.querySelectorAll('.v095-sensory-modes')].forEach(node => node.remove());
  nativeButton.classList.add('v095-native-start');
  const reservation = document.createElement('div');
  reservation.className = 'v095-sensory-modes v095-sensory-loading';
  reservation.dataset.modeVersion = 'loading-professional-v2';
  reservation.innerHTML = '<span>正在加载品鉴模式…</span>';
  action.append(reservation);
  panel.dataset.sensoryBootstrap = BOOTSTRAP_VERSION;
  return panel;
}

async function loadProfessionalModes() {
  const panel = reserveModeSlot();
  if (!panel || expectedPanel(panel)) return;
  if (!importPromise) importPromise = import('./v095-sensory-pro.js?v=099d');
  try {
    await importPromise;
  } catch (error) {
    importPromise = null;
    showFailure(`专业品鉴模块加载失败：${error.message}`);
    return;
  }
  clearTimeout(failureTimer);
  failureTimer = setTimeout(() => {
    if (!expectedPanel()) showFailure('三种品鉴模式未能完成挂载，请重新加载。');
  }, 2500);
}

function showFailure(message) {
  const panel = startPanel();
  const slot = panel?.querySelector('.v095-sensory-modes');
  if (!slot) return;
  slot.dataset.modeVersion = 'load-failed';
  slot.classList.remove('v095-sensory-loading');
  slot.classList.add('v095-sensory-load-failed');
  slot.innerHTML = `<strong>品鉴模式加载失败</strong><small>${message}</small><button type="button" class="button" data-retry-sensory>重新加载</button>`;
  slot.querySelector('[data-retry-sensory]')?.addEventListener('click', () => { importPromise = null; slot.remove(); queueSync(); });
}

function verifyFinalPanel() {
  const panel = expectedPanel();
  if (!panel) return false;
  const labels = [...panel.querySelectorAll('button > strong')].map(node => node.textContent.trim());
  const expected = ['专业品鉴', '玩家互动品鉴', '札记'];
  if (!expected.every((label, index) => labels[index] === label)) {
    panel.remove();
    importPromise = null;
    loadProfessionalModes();
    return false;
  }
  clearTimeout(failureTimer);
  document.documentElement.dataset.sensoryModesReady = 'professional-v2';
  return true;
}

function sync() {
  ensureSafeSentinel();
  const panel = startPanel();
  if (!panel || verifyFinalPanel()) return;
  loadProfessionalModes();
}
function queueSync() {
  ensureSafeSentinel();
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => { syncQueued = false; sync(); });
}
new MutationObserver(queueSync).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', queueSync, { once: true });
queueSync();
