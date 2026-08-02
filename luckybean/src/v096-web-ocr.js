const TESSERACT_VERSION = '6.0.1';
const ENGINE_NAME = 'tesseract.js-6.0.1-cn-mixed';
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
  if (!languages.length) return ['chi_sim', 'eng'];
  if (languages.includes('chi_sim')) return ['chi_sim', ...languages.filter(item => item !== 'chi_sim')];
  return languages;
}

async function ensureWorker(languages) {
  const key = languages.join('+');
  if (workerPromise && workerLanguages === key) return workerPromise;
  const Tesseract = await ensureTesseract();
  if (workerPromise) {
    try { (await workerPromise)?.terminate?.(); } catch { /* old worker may already be closed */ }
  }
  workerLanguages = key;
  emitProgress('正在下载并初始化中英文 OCR 模型', 0);
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

function canvasBlob(canvas, type = 'image/png', quality = 0.95) {
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('OCR 图像预处理失败')),
    type,
    quality
  ));
}

async function decodeImage(blob) {
  if (globalThis.createImageBitmap) return createImageBitmap(blob, { imageOrientation: 'from-image' });
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('OCR 图片无法读取'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function percentile(histogram, total, ratio) {
  const target = total * ratio;
  let sum = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    sum += histogram[index];
    if (sum >= target) return index;
  }
  return histogram.length - 1;
}

function otsuThreshold(histogram, total) {
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 128;
  for (let i = 0; i < 256; i += 1) {
    backgroundWeight += histogram[i];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += i * histogram[i];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = i;
    }
  }
  return threshold;
}

async function prepareOcrVariants(blob) {
  const image = await decodeImage(blob);
  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;
  const longest = Math.max(width, height);
  const scale = Math.min(2.4, Math.max(1, 2400 / Math.max(1, longest)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();

  const source = context.getImageData(0, 0, canvas.width, canvas.height);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < source.data.length; i += 4) {
    const y = Math.round(0.299 * source.data[i] + 0.587 * source.data[i + 1] + 0.114 * source.data[i + 2]);
    histogram[y] += 1;
  }
  const pixels = canvas.width * canvas.height;
  const low = percentile(histogram, pixels, 0.02);
  const high = Math.max(low + 24, percentile(histogram, pixels, 0.98));
  const enhanced = new ImageData(new Uint8ClampedArray(source.data.length), canvas.width, canvas.height);
  const enhancedHistogram = new Uint32Array(256);
  for (let i = 0; i < source.data.length; i += 4) {
    const y = 0.299 * source.data[i] + 0.587 * source.data[i + 1] + 0.114 * source.data[i + 2];
    const stretched = Math.max(0, Math.min(255, Math.round((y - low) * 255 / (high - low))));
    enhanced.data[i] = enhanced.data[i + 1] = enhanced.data[i + 2] = stretched;
    enhanced.data[i + 3] = 255;
    enhancedHistogram[stretched] += 1;
  }
  context.putImageData(enhanced, 0, 0);
  const grayscale = await canvasBlob(canvas);

  const threshold = otsuThreshold(enhancedHistogram, pixels);
  const binary = new ImageData(new Uint8ClampedArray(enhanced.data.length), canvas.width, canvas.height);
  for (let i = 0; i < enhanced.data.length; i += 4) {
    const value = enhanced.data[i] > threshold ? 255 : 0;
    binary.data[i] = binary.data[i + 1] = binary.data[i + 2] = value;
    binary.data[i + 3] = 255;
  }
  context.putImageData(binary, 0, 0);
  const binarized = await canvasBlob(canvas);
  return { grayscale, binarized };
}

function cleanOcrText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resultScore(text, confidence = 0) {
  const cjk = (text.match(/[\u3400-\u9FFF]/g) || []).length;
  const latin = (text.match(/[A-Za-z0-9]/g) || []).length;
  const usefulLines = text.split(/\n+/).filter(line => /[\u3400-\u9FFFA-Za-z0-9]{2}/.test(line)).length;
  const noise = (text.match(/[�□■]{1}/g) || []).length + (text.match(/[^\s\u3400-\u9FFFA-Za-z0-9.,，。:：;；()（）/%+\-—_@#&'"°]/g) || []).length;
  return cjk * 3.2 + latin * 0.7 + usefulLines * 2 + Number(confidence || 0) * 0.12 - noise * 2.5;
}

function usefulLine(line) {
  const text = line.trim();
  if (!text) return false;
  const useful = (text.match(/[\u3400-\u9FFFA-Za-z0-9]/g) || []).length;
  return useful >= 2 && useful / Math.max(1, text.length) >= 0.42;
}

function mergeText(primary, secondary) {
  const seen = new Set();
  const lines = [];
  for (const line of `${primary}\n${secondary}`.split(/\n+/)) {
    if (!usefulLine(line)) continue;
    const key = line.toLocaleLowerCase('zh-CN').replace(/[\s，,。.;；:：\-_]/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    lines.push(line.trim());
  }
  return lines.join('\n');
}

async function recognizeVariant(worker, blob, pageSegMode) {
  await worker.setParameters({
    tessedit_pageseg_mode: String(pageSegMode),
    preserve_interword_spaces: '1',
    user_defined_dpi: '300'
  });
  const output = await worker.recognize(blob);
  return {
    text: cleanOcrText(output?.data?.text),
    confidence: Number(output?.data?.confidence || 0)
  };
}

async function recognizeImages(images, options = {}) {
  const languages = normalizeLanguages(options.languages || options.langs);
  const worker = await ensureWorker(languages);
  const results = [];
  const combined = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    emitProgress(`正在增强并识别第 ${index + 1}/${images.length} 张图片`, 0);
    const variants = await prepareOcrVariants(image.blob);
    const sparse = await recognizeVariant(worker, variants.grayscale, 11);
    let block = null;
    const sparseCjk = (sparse.text.match(/[\u3400-\u9FFF]/g) || []).length;
    if (sparse.confidence < 72 || sparseCjk < 2 || sparse.text.length < 12) {
      block = await recognizeVariant(worker, variants.binarized, 6);
    }
    const candidates = [sparse, block].filter(Boolean).sort((a, b) => resultScore(b.text, b.confidence) - resultScore(a.text, a.confidence));
    const best = candidates[0] || { text: '', confidence: 0 };
    const text = block && resultScore(block.text, block.confidence) > resultScore(sparse.text, sparse.confidence) * 0.72
      ? mergeText(best.text, candidates[1]?.text || '')
      : best.text;
    if (text) combined.push(text);
    results.push({
      imageId: image.id,
      value: {
        blocks: text ? [{ text, confidence: Math.max(0, Math.min(1, best.confidence / 100)) }] : []
      }
    });
  }
  emitProgress('中英文文字识别完成', 1);
  return { engine: ENGINE_NAME, results, fullText: combined.join('\n\n') };
}

function enqueue(task) {
  const next = operationQueue.then(task, task);
  operationQueue = next.catch(() => {});
  return next;
}

globalThis.LuckyBeanWebOCR = {
  version: TESSERACT_VERSION,
  engine: ENGINE_NAME,
  defaultLanguages: ['chi_sim', 'eng'],
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
      : event.detail.status || '中英文网页 OCR 可用';
  }
  if (button?.disabled && event.detail?.status) button.textContent = '识别处理中…';
});

document.documentElement.dataset.webOcr = `tesseract-${TESSERACT_VERSION}-cn-mixed`;
