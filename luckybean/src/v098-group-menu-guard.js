const GROUP_KEY = 'luckybean.group.method.v098';
const OPTIONS = [
  ['freshness-state', '按赏味期状态'],
  ['remaining-50', '按余量（每50g）']
];
let queued = false;
let syncing = false;

function syncGroupMenus() {
  if (syncing) return;
  syncing = true;
  try {
    document.querySelectorAll('.popup-menu').forEach(menu => {
      const isGroupMenu = Boolean(menu.querySelector('[data-group-method]'));
      if (!isGroupMenu) {
        menu.querySelectorAll('[data-v098-group-method]').forEach(button => button.remove());
        return;
      }
      // Prevent the older enhancer from appending another copy.
      menu.dataset.v098Enhanced = '1';
      const selected = localStorage.getItem(GROUP_KEY) || 'roast';
      OPTIONS.forEach(([value, label]) => {
        let button = menu.querySelector(`[data-v098-group-method="${value}"]`);
        if (!button) {
          button = document.createElement('button');
          button.type = 'button';
          button.dataset.v098GroupMethod = value;
          menu.append(button);
        }
        const text = `${label}${selected === value ? ' ✓' : ''}`;
        if (button.textContent !== text) button.textContent = text;
      });
      menu.querySelectorAll('[data-group-method]').forEach(button => {
        const text = button.textContent.replace(/\s*✓$/, '') + (selected === button.dataset.groupMethod ? ' ✓' : '');
        if (button.textContent !== text) button.textContent = text;
      });
    });
  } finally {
    syncing = false;
  }
}

function queueSync() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    syncGroupMenus();
  });
}

new MutationObserver(records => {
  if (records.some(record => record.addedNodes.length || record.removedNodes.length)) queueSync();
}).observe(document.documentElement, { childList: true, subtree: true });
syncGroupMenus();
