const wrap = document.querySelector('#fabWrap');
if (wrap) {
  const protectButtonTap = button => {
    if (button.dataset.v097TapGuard === '1') return;
    button.dataset.v097TapGuard = '1';
    button.addEventListener('pointerdown', event => {
      // The parent container owns drag gestures. A tap that begins on an
      // actual command must stay a command and must not be pointer-captured.
      event.stopPropagation();
    });
  };
  wrap.querySelectorAll('.fab').forEach(protectButtonTap);
  new MutationObserver(() => wrap.querySelectorAll('.fab').forEach(protectButtonTap))
    .observe(wrap, { childList: true, subtree: true });
}
