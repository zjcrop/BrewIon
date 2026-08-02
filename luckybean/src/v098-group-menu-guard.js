function syncGroupMenus() {
  document.querySelectorAll('.popup-menu').forEach(menu => {
    const isGroupMenu = Boolean(menu.querySelector('[data-group-method]'));
    if (!isGroupMenu) {
      menu.querySelectorAll('[data-v098-group-method]').forEach(button => button.remove());
      return;
    }
    const selected = localStorage.getItem('luckybean.group.method.v098') || 'roast';
    const options = [
      ['freshness-state', '按赏味期状态'],
      ['remaining-50', '按余量（每50g）']
    ];
    options.forEach(([value, label]) => {
      let button = menu.querySelector(`[data-v098-group-method="${value}"]`);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.v098GroupMethod = value;
        menu.append(button);
      }
      button.textContent = `${label}${selected === value ? ' ✓' : ''}`;
    });
  });
}

new MutationObserver(syncGroupMenus).observe(document.documentElement, { childList: true, subtree: true });
syncGroupMenus();
