const wrap = document.querySelector('#fabWrap');
if (wrap) {
  wrap.dataset.v097GestureMode = 'drag-or-tap';
  wrap.setAttribute('title', '拖动中央圆点可移动快捷菜单；轻点文字执行功能');

  const protectButtonTap = button => {
    if (button.dataset.v097TapGuard === '1') return;
    button.dataset.v097TapGuard = '1';
    button.addEventListener('pointerdown', event => {
      // Keep ordinary command taps away from the parent drag capture.
      event.stopPropagation();
    });
  };
  wrap.querySelectorAll('.fab').forEach(protectButtonTap);

  if (!wrap.querySelector('.v097-fab-drag-handle')) {
    const handle = document.createElement('span');
    handle.className = 'v097-fab-drag-handle';
    handle.setAttribute('aria-label', '拖动快捷菜单');
    handle.setAttribute('title', '拖动移动');
    Object.assign(handle.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '42px',
      height: '42px',
      transform: 'translate(-50%, -50%)',
      borderRadius: '50%',
      background: 'rgba(255,255,255,.18)',
      border: '2px solid rgba(255,255,255,.48)',
      boxShadow: '0 0 0 5px rgba(255,255,255,.08), 0 2px 7px rgba(0,0,0,.5)',
      cursor: 'grab',
      touchAction: 'none',
      zIndex: '5'
    });
    wrap.append(handle);
  }

  new MutationObserver(() => wrap.querySelectorAll('.fab').forEach(protectButtonTap))
    .observe(wrap, { childList: true, subtree: true });
}
