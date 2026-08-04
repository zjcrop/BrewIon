let queued = false;

function enhanceCameraOverlay() {
  const overlay = document.querySelector('[data-overlay="camera"]');
  const video = overlay?.querySelector('#cameraVideo');
  if (!overlay || !video || overlay.dataset.qrUiEnhanced) return;
  overlay.dataset.qrUiEnhanced = 'auto-capture-v1';

  const stage = document.createElement('div');
  stage.className = 'v095-qr-stage';
  video.before(stage);
  stage.append(video);
  stage.insertAdjacentHTML('beforeend', `
    <div class="v095-qr-frame" aria-hidden="true">
      <i></i><i></i><i></i><i></i><span></span>
    </div>
    <div class="v095-qr-live-badge"><b></b>自动捕捉中</div>
  `);

  const status = overlay.querySelector('#cameraStatus');
  if (status) {
    status.classList.add('v095-qr-status');
    status.insertAdjacentHTML('afterend', '<p class="v095-qr-help">无需按快门。将二维码完整、清晰地放入方框，识别成功后会自动进入豆卡确认。</p>');
  }

  const fileButton = overlay.querySelector('#cameraFileBtn');
  if (fileButton) fileButton.textContent = '自动识别困难时选择图片';
}

function queueEnhance() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    enhanceCameraOverlay();
  });
}

new MutationObserver(queueEnhance).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', queueEnhance, { once: true });
queueEnhance();
