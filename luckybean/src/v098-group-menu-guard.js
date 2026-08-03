const GROUP_KEY = 'luckybean.group.method.v098';
const OPTIONS = [
  ['remaining-50', '按余量（每50g）']
];
let queued = false;
let syncing = false;

function migrateLegacySelection() {
  if (localStorage.getItem(GROUP_KEY) === 'freshness-state') localStorage.setItem(GROUP_KEY, 'roast');
}

function syncGroupMenus() {
  if (syncing) return;
  syncing = true;
  try {
    migrateLegacySelection();
    document.querySelectorAll('.popup-menu').forEach(menu => {
      const isGroupMenu = Boolean(menu.querySelector('[data-group-method]'));
      if (!isGroupMenu) {
        menu.querySelectorAll('[data-v098-group-method]').forEach(button => button.remove());
        return;
      }
      menu.dataset.v098Enhanced = '1';
      menu.querySelectorAll('[data-v098-group-method="freshness-state"]').forEach(button => button.remove());
      menu.querySelectorAll('button').forEach(button => {
        if (button.textContent.replace(/\s*✓\s*$/, '').trim() === '按赏味期状态') button.remove();
      });

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
      const freshnessButtons = [...menu.querySelectorAll('[data-v099f-group-freshness],[data-v099i-group-freshness]')];
      freshnessButtons.forEach((button, index) => {
        if (index) button.remove();
        else button.textContent = `按赏味期阶段${button.textContent.includes('✓') ? ' ✓' : ''}`;
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
