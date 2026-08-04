import { preparePackageImage } from './image-quality.js';
import { getRecognitionCapabilities, recognizeCoffeeBag, RecognitionUnavailableError } from './recognition-bridge.js';

const MAX_IMAGES = 4;
const ROLE_OPTIONS = [
  ['front', '正面主体'],
  ['back', '背面参数'],
  ['side', '侧面补充'],
  ['date', '日期标签']
];

const captureState = {
  images: [],
  busy: false,
  ocrText: '',
  ocrEngine: '',
  blocks: []
};

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function roleLabel(role) {
  return ROLE_OPTIONS.find(([value]) => value === role)?.[1] || '豆袋照片';
}

function nextRole() {
  const used = new Set(captureState.images.map(image => image.role));
  return ROLE_OPTIONS.find(([role]) => !used.has(role))?.[0] || 'side';
}

function qualityLabel(image) {
  if (image.status === 'good') return '质量良好';
  if (image.status === 'usable') return '可用，建议补拍';
  return '建议重拍';
}

function statusMessage() {
  if (!captureState.images.length) return '先拍摄包装正面。系统会检查清晰度、反光和曝光。';
  const roles = new Set(captureState.images.map(image => image.role));
  if (!roles.has('back')) return '正面已加入。建议补拍背面参数或烘焙标签。';
  if (!roles.has('date')) return '如烘焙日期不清楚，可单独拍摄日期标签。';
  return '已具备多视角照片，可以开始识别；低质量照片仍建议重拍。';
}

function root() {
  return document.querySelector('#overlayRoot');
}

function clearCapture({ keepOverlay = false } = {}) {
  for (const image of captureState.images) URL.revokeObjectURL(image.previewUrl);
  captureState.images = [];
  captureState.busy = false;
  captureState.ocrText = '';
  captureState.ocrEngine = '';
  captureState.blocks = [];
  if (!keepOverlay && root()) root().innerHTML = '';
}

function renderImageCards() {
  if (!captureState.images.length) return '<div class="bag-empty">尚未添加照片</div>';
  return captureState.images.map(image => `
    <article class="bag-photo-card" data-bag-image-id="${esc(image.id)}">
      <img src="${esc(image.previewUrl)}" alt="${esc(image.roleLabel)}预览">
      <div class="bag-photo-main">
        <div class="bag-photo-heading"><strong>${esc(image.roleLabel)}</strong><span class="bag-quality ${esc(image.status)}">${qualityLabel(image)} · ${image.score}</span></div>
        <select class="control bag-role-select" data-bag-role="${esc(image.id)}" aria-label="照片类型">
          ${ROLE_OPTIONS.map(([value, label]) => `<option value="${value}"${image.role === value ? ' selected' : ''}>${label}</option>`).join('')}
        </select>
        <p>${image.processedWidth}×${image.processedHeight} px · ${Math.round(image.blob.size / 1024)} KB</p>
        ${image.warnings.length ? `<ul>${image.warnings.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '<p class="bag-good-copy">未发现明显模糊、过曝或大面积反光。</p>'}
      </div>
      <button class="bag-remove" type="button" data-bag-remove="${esc(image.id)}" aria-label="删除照片">×</button>
    </article>`).join('');
}

function renderRecognitionPanel() {
  if (!captureState.ocrText && !captureState.blocks.length) return '';
  return `
    <section class="bag-recognition-result">
      <div class="bag-result-heading"><strong>识别文字</strong><span>${esc(captureState.ocrEngine || '手工输入')}</span></div>
      <textarea id="bagOcrText" class="control" rows="9" placeholder="识别文字会显示在这里，可在交给豆卡解析前修正。">${esc(captureState.ocrText)}</textarea>
      <p class="muted small">这里只保留原始文字和证据。国家、产区、处理法、品种等字段仍由 Lucky Bean 编码表统一解析。</p>
    </section>`;
}

function render() {
  const overlayRoot = root();
  if (!overlayRoot) return;
  const capabilities = getRecognitionCapabilities();
  overlayRoot.innerHTML = `
    <div class="overlay full bag-capture-overlay" data-overlay="bag-capture">
      <div class="dialog bag-capture-dialog">
        <div class="dialog-header"><div><h2>拍袋录入</h2><p>多视角采集，分别处理曲面、倾斜、反光和碎片化信息</p></div><button class="close-button" type="button" data-bag-close aria-label="关闭">×</button></div>
        <div class="bag-capture-status"><strong>${captureState.images.length}/${MAX_IMAGES}</strong><span>${esc(statusMessage())}</span></div>
        <div class="bag-engine-status">
          <span>识别通道</span>
          <b>${capabilities.native ? '原生 PP-OCR 桥接可用' : capabilities.webPaddle ? '网页 PP-OCR 可用' : capabilities.textDetector ? '浏览器文字检测可用' : '等待安装 PP-OCR 引擎'}</b>
        </div>
        <div class="bag-photo-list">${renderImageCards()}</div>
        <div class="bag-capture-actions">
          <button id="bagCameraBtn" class="button primary" type="button"${captureState.images.length >= MAX_IMAGES || captureState.busy ? ' disabled' : ''}>拍摄一张</button>
          <button id="bagGalleryBtn" class="button" type="button"${captureState.images.length >= MAX_IMAGES || captureState.busy ? ' disabled' : ''}>从相册选择</button>
          <button id="bagRecognizeBtn" class="button" type="button"${!captureState.images.length || captureState.busy ? ' disabled' : ''}>${captureState.busy ? '处理中…' : '开始识别'}</button>
        </div>
        ${renderRecognitionPanel()}
        <div class="bag-manual-entry">
          <button id="bagManualBtn" class="button subtle" type="button">手工粘贴文字</button>
          <span class="grow"></span>
          <button id="bagHandoffBtn" class="button primary" type="button"${captureState.ocrText.trim() ? '' : ' disabled'}>交给豆卡解析</button>
        </div>
        <input id="bagCameraInput" type="file" accept="image/*" capture="environment" hidden>
        <input id="bagGalleryInput" type="file" accept="image/*" multiple hidden>
      </div>
    </div>`;
  bindOverlay();
}

async function addFiles(fileList) {
  const files = [...(fileList || [])].filter(file => file.type.startsWith('image/')).slice(0, MAX_IMAGES - captureState.images.length);
  if (!files.length) return;
  captureState.busy = true;
  render();
  try {
    for (const file of files) {
      const prepared = await preparePackageImage(file);
      const role = nextRole();
      const id = `bag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      captureState.images.push({
        id,
        role,
        roleLabel: roleLabel(role),
        blob: prepared.blob,
        previewUrl: URL.createObjectURL(prepared.blob),
        score: prepared.score,
        status: prepared.status,
        warnings: prepared.warnings,
        processedWidth: prepared.processedWidth,
        processedHeight: prepared.processedHeight,
        metrics: prepared.metrics
      });
    }
  } catch (error) {
    captureState.ocrText = `图片处理失败：${error.message}`;
    captureState.ocrEngine = '错误';
  } finally {
    captureState.busy = false;
    render();
  }
}

async function runRecognition() {
  captureState.busy = true;
  captureState.ocrText = '';
  captureState.blocks = [];
  render();
  try {
    const result = await recognizeCoffeeBag(captureState.images, { locale: 'zh-CN' });
    captureState.ocrText = result.fullText || '';
    captureState.ocrEngine = result.engine || 'OCR';
    captureState.blocks = result.blocks || [];
    if (!captureState.ocrText) throw new Error('没有检测到可用文字，请补拍更清晰的局部照片');
  } catch (error) {
    if (error instanceof RecognitionUnavailableError) {
      captureState.ocrEngine = '待安装';
      captureState.ocrText = '';
    } else {
      captureState.ocrEngine = '识别失败';
      captureState.ocrText = '';
      alert(error.message);
    }
  } finally {
    captureState.busy = false;
    render();
    if (!captureState.ocrText) openManualEntry(errorMessageForManual());
  }
}

function errorMessageForManual() {
  const caps = getRecognitionCapabilities();
  if (!caps.native && !caps.webPaddle && !caps.textDetector) return '当前版本已完成拍摄与识别桥接，PP-OCR 模型尚未加入仓库。可先粘贴豆袋文字继续测试字段解析。';
  return '自动识别没有得到文字，可手工输入，或返回补拍更清晰的局部照片。';
}

function openManualEntry(message = '可粘贴包装上的文字，后续仍由同一套编码表解析。') {
  const existing = document.querySelector('#bagOcrText')?.value || captureState.ocrText;
  captureState.ocrText = existing || ' ';
  render();
  const target = document.querySelector('#bagOcrText');
  if (target) {
    target.value = existing.trim();
    target.placeholder = message;
    target.focus();
    const button = document.querySelector('#bagHandoffBtn');
    if (button) button.disabled = !target.value.trim();
  }
}

function handoffToExistingParser() {
  const text = (document.querySelector('#bagOcrText')?.value || captureState.ocrText).trim();
  if (!text) return;
  clearCapture();
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.dataset.addMode = 'text';
  trigger.hidden = true;
  document.body.append(trigger);
  trigger.click();
  trigger.remove();
  requestAnimationFrame(() => {
    const textarea = document.querySelector('#recognitionText');
    if (!textarea) return;
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#parseTextBtn')?.click();
  });
}

function bindOverlay() {
  document.querySelector('[data-bag-close]')?.addEventListener('click', () => clearCapture());
  document.querySelector('#bagCameraBtn')?.addEventListener('click', () => document.querySelector('#bagCameraInput')?.click());
  document.querySelector('#bagGalleryBtn')?.addEventListener('click', () => document.querySelector('#bagGalleryInput')?.click());
  document.querySelector('#bagCameraInput')?.addEventListener('change', event => addFiles(event.target.files));
  document.querySelector('#bagGalleryInput')?.addEventListener('change', event => addFiles(event.target.files));
  document.querySelector('#bagRecognizeBtn')?.addEventListener('click', runRecognition);
  document.querySelector('#bagManualBtn')?.addEventListener('click', () => openManualEntry());
  document.querySelector('#bagHandoffBtn')?.addEventListener('click', handoffToExistingParser);
  document.querySelector('#bagOcrText')?.addEventListener('input', event => {
    captureState.ocrText = event.target.value;
    const button = document.querySelector('#bagHandoffBtn');
    if (button) button.disabled = !event.target.value.trim();
  });
  document.querySelectorAll('[data-bag-remove]').forEach(button => button.addEventListener('click', () => {
    const index = captureState.images.findIndex(image => image.id === button.dataset.bagRemove);
    if (index < 0) return;
    URL.revokeObjectURL(captureState.images[index].previewUrl);
    captureState.images.splice(index, 1);
    render();
  }));
  document.querySelectorAll('[data-bag-role]').forEach(select => select.addEventListener('change', () => {
    const image = captureState.images.find(item => item.id === select.dataset.bagRole);
    if (!image) return;
    image.role = select.value;
    image.roleLabel = roleLabel(select.value);
    render();
  }));
}

export function openPackageCapture() {
  clearCapture({ keepOverlay: true });
  render();
}

function interceptPhotoMode(event) {
  const button = event.target.closest?.('[data-add-mode="photo"]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  document.querySelectorAll('.popup-menu').forEach(node => node.remove());
  openPackageCapture();
}

document.addEventListener('click', interceptPhotoMode, true);
new MutationObserver(() => {
  const button = document.querySelector('[data-add-mode="photo"]');
  if (button && button.textContent !== '拍袋录入') button.textContent = '拍袋录入';
}).observe(document.body, { childList: true, subtree: true });

window.LuckyBeanPackageCapture = { open: openPackageCapture, capabilities: getRecognitionCapabilities };
