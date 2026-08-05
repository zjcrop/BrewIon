let stream = null;
let facingMode = 'environment';
let cameraRoot = null;
let opening = false;

function stopCamera() {
  for (const track of stream?.getTracks?.() || []) track.stop();
  stream = null;
  cameraRoot?.remove();
  cameraRoot = null;
}

function cameraErrorMessage(error) {
  if (error?.name === 'NotAllowedError') return '未获得摄像头权限，请在浏览器网站权限中允许使用摄像头。';
  if (error?.name === 'NotFoundError') return '没有找到可用摄像头。';
  if (error?.name === 'NotReadableError') return '摄像头正被其他应用占用，请关闭系统相机后重试。';
  if (!globalThis.isSecureContext) return '网页内摄像头只能在 HTTPS 安全连接中使用。';
  return `摄像头启动失败：${error?.message || error}`;
}

async function takeFrame(video) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track) throw new Error('摄像头尚未启动');

  if (globalThis.ImageCapture) {
    try {
      const capture = new ImageCapture(track);
      const blob = await capture.takePhoto();
      if (blob?.size) return blob;
    } catch { /* 部分手机仅支持视频帧回退 */ }
  }

  const width = video.videoWidth || 1920;
  const height = video.videoHeight || 1080;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.drawImage(video, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('摄像头画面截取失败')),
    'image/jpeg',
    0.94
  ));
}

function sendBlobToBagCapture(blob) {
  const input = document.querySelector('#bagCameraInput');
  if (!input) throw new Error('拍袋录入窗口已经关闭');
  const extension = blob.type === 'image/png' ? 'png' : 'jpg';
  const file = new File([blob], `coffee-bag-${Date.now()}.${extension}`, { type: blob.type || 'image/jpeg' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function openStream(video, status) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持网页内摄像头');
  stopTracksOnly();
  status.textContent = '正在启动后置摄像头…';
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 2560 },
      height: { ideal: 1440 },
      frameRate: { ideal: 30, max: 30 }
    }
  });
  video.srcObject = stream;
  await video.play();

  const track = stream.getVideoTracks()[0];
  try {
    const capabilities = track.getCapabilities?.() || {};
    const advanced = [];
    if (capabilities.focusMode?.includes?.('continuous')) advanced.push({ focusMode: 'continuous' });
    if (capabilities.exposureMode?.includes?.('continuous')) advanced.push({ exposureMode: 'continuous' });
    if (advanced.length) await track.applyConstraints({ advanced });
  } catch { /* 浏览器不支持时保持默认相机参数 */ }

  const settings = track.getSettings?.() || {};
  status.textContent = `${settings.width || video.videoWidth || ''}×${settings.height || video.videoHeight || ''} · 对准文字后点击拍摄`;
}

function stopTracksOnly() {
  for (const track of stream?.getTracks?.() || []) track.stop();
  stream = null;
}

async function openCamera() {
  if (opening || cameraRoot) return;
  opening = true;
  const root = document.createElement('div');
  root.className = 'lb-direct-camera';
  root.innerHTML = `
    <div class="lb-camera-panel" role="dialog" aria-modal="true" aria-label="网页内拍摄豆袋">
      <div class="lb-camera-head"><strong>拍摄豆袋</strong><button type="button" data-camera-close aria-label="关闭">×</button></div>
      <div class="lb-camera-view"><video playsinline muted autoplay></video><div class="lb-camera-guide"><span>尽量让中文和英文文字占满框内区域</span></div></div>
      <p class="lb-camera-status">正在请求摄像头权限…</p>
      <div class="lb-camera-actions">
        <button type="button" class="button" data-camera-switch>切换摄像头</button>
        <button type="button" class="button primary" data-camera-shot disabled>拍摄并加入</button>
      </div>
    </div>`;
  document.body.append(root);
  cameraRoot = root;
  const video = root.querySelector('video');
  const status = root.querySelector('.lb-camera-status');
  const shot = root.querySelector('[data-camera-shot]');

  root.querySelector('[data-camera-close]').addEventListener('click', stopCamera);
  root.addEventListener('click', event => { if (event.target === root) stopCamera(); });
  root.querySelector('[data-camera-switch]').addEventListener('click', async () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    shot.disabled = true;
    try {
      await openStream(video, status);
      shot.disabled = false;
    } catch (error) {
      status.textContent = cameraErrorMessage(error);
    }
  });
  shot.addEventListener('click', async () => {
    shot.disabled = true;
    status.textContent = '正在截取高清画面…';
    try {
      const blob = await takeFrame(video);
      sendBlobToBagCapture(blob);
      stopCamera();
    } catch (error) {
      status.textContent = cameraErrorMessage(error);
      shot.disabled = false;
    }
  });

  try {
    await openStream(video, status);
    shot.disabled = false;
  } catch (error) {
    status.textContent = cameraErrorMessage(error);
  } finally {
    opening = false;
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest?.('#bagCameraBtn');
  if (!button || button.disabled) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openCamera();
}, true);

window.addEventListener('pagehide', stopCamera);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && cameraRoot) stopCamera();
});

globalThis.LuckyBeanDirectCamera = { open: openCamera, close: stopCamera };
