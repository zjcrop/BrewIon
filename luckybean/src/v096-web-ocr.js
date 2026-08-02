const TESSERACT_VERSION = '6.0.1';
const TESSERACT_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
let loaderPromise = null;
let workerPromise = null;
let workerLanguages = '';
let operationQueue = Promise.resolve();

function emitProgress(status, progress = 0) {
  const percent = Number.isFinite(progress) ? Math.round(progress * 100) : 0;
  globalThis.dispatchEvent(new CustomEvent('luckybean:ocr-progress', {
    detail: { status: String(status || ''), progress: percent }
  }));
}

function ensureTesseract() {
  if (globalThis.Tesseract?.createWorker) return Promise.resolve(globalThis.Tesseract);
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TESSERACT_URL;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.onload = () => globalThis.Tesseract?.createWorker
      ? resolve(globalThis.Tesseract)
      : reject(new Error('网页 OCR 主程序未正确加载'));
    script.onerror = () => reject(new Error('网页 OCR 主程序下载失败，请检查网络后重试'));
    document.head.append(script);
  }).catch(error => {
    loaderPromise = null;
    throw error;
  });
  return loaderPromise;
}

function normalizeLanguages(value) {
  const input = Array.isArray(value) ? value : String(value || '').split(/[,+\s]+/);
  const languages = [...new Set(input.map(item => String(item || '').trim()).filter(Boolean))];
  return languages.length ? languages : ['eng', 'chi_sim'];
}

async function ensureWorker(languages) {
  const key = languages.join('+');
  if (workerPromise && workerLanguages === key) return workerPromise;
  const Tesseract = await ensureTesseract();
  if (workerPromise) {
    try { (await workerPromise)?.terminate?.(); } catch { /* old worker may already be closed */ }
  }
  workerLanguages = key;
  emitProgress('正在下载并初始化 OCR 模型', 0);
  workerPromise = Tesseract.createWorker(languages, 1, {
    logger(message) {
      emitProgress(message?.status || '正在识别', Number(message?.progress || 0));
    }
  }).catch(error => {
    workerPromise = null;
    workerLanguages = '';
    throw new Error(`网页 OCR 初始化失败：${error.message}`);
  });
  return workerPromise;
}

async function recognizeImages(images, options = {}) {
  const languages = normalizeLanguages(options.languages || options.langs);
  const worker = await ensureWorker(languages);
  const results = [];
  const combined = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    emitProgress(`正在识别第 ${index + 1}/${images.length} 张图片`, 0);
    const output = await worker.recognize(image.blob);
    const data = output?.data || {};
    const text = String(data.text || '').trim();
    if (text) combined.push(text);
    results.push({
      imageId: image.id,
      value: {
        blocks: text ? [{
          text,
          confidence: Math.max(0, Math.min(1, Number(data.confidence || 0) / 100))
        }] : []
      }
    });
  }
  emitProgress('文字识别完成', 1);
  return {
    engine: `tesseract.js-${TESSERACT_VERSION}`,
    results,
    fullText: combined.join('\n\n')
  };
}

function enqueue(task) {
  const next = operationQueue.then(task, task);
  operationQueue = next.catch(() => {});
  return next;
}

globalThis.LuckyBeanWebOCR = {
  version: TESSERACT_VERSION,
  engine: `tesseract.js-${TESSERACT_VERSION}`,
  recognizeCoffeeBag(images, options = {}) {
    return enqueue(() => recognizeImages(images, options));
  },
  async recognize(blob, options = {}) {
    const result = await enqueue(() => recognizeImages([{ id: 'single', blob }], options));
    return result.results[0]?.value || { blocks: [] };
  },
  async terminate() {
    if (!workerPromise) return;
    try { (await workerPromise)?.terminate?.(); } finally {
      workerPromise = null;
      workerLanguages = '';
    }
  }
};

globalThis.addEventListener('luckybean:ocr-progress', event => {
  const status = document.querySelector('[data-overlay="bag-capture"] .bag-engine-status b');
  const button = document.querySelector('[data-overlay="bag-capture"] #bagRecognizeBtn');
  if (status) {
    const percent = Number(event.detail?.progress || 0);
    status.textContent = percent > 0 && percent < 100
      ? `${event.detail.status} ${percent}%`
      : event.detail.status || '内置网页 OCR 可用';
  }
  if (button?.disabled && event.detail?.status) button.textContent = '识别处理中…';
});

document.documentElement.dataset.webOcr = `tesseract-${TESSERACT_VERSION}`;
