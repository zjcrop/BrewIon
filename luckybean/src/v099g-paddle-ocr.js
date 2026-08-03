const PADDLE_OCR_VERSION = '0.4.2';
const PADDLE_OCR_URL = `https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@${PADDLE_OCR_VERSION}/+esm`;
const ENGINE = `PP-OCRv5-mobile-browser-${PADDLE_OCR_VERSION}`;
const LOW_MEMORY = Number(navigator.deviceMemory || 4) <= 4 || /iPhone|iPad|iPod/i.test(navigator.userAgent);
const MAX_SIDE = LOW_MEMORY ? 960 : 1280;
let modulePromise = null;
let enginePromise = null;
let unavailable = false;
let busy = false;
let disposeTimer = 0;

function emit(status, progress = 0) {
  globalThis.dispatchEvent(new CustomEvent('luckybean:ocr-progress', {
    detail: { status, progress: Math.max(0, Math.min(100, Number(progress) || 0)) }
  }));
}

async function loadModule() {
  if (modulePromise) return modulePromise;
  emit('正在加载PP-OCRv5网页识别引擎', 2);
  modulePromise = import(PADDLE_OCR_URL).catch(error => {
    modulePromise = null;
    throw new Error(`PP-OCRv5程序加载失败：${error.message}`);
  });
  return modulePromise;
}

async function ensureEngine() {
  clearTimeout(disposeTimer);
  if (unavailable) throw new Error('PP-OCRv5在当前浏览器初始化失败');
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const module = await loadModule();
    if (!module?.PaddleOCR?.create) throw new Error('PP-OCRv5 SDK接口不可用');
    emit(`首次使用正在下载中文模型${LOW_MEMORY ? '（省内存模式）' : ''}`, 8);
    const ocr = await module.PaddleOCR.create({
      lang: 'ch',
      ocrVersion: 'PP-OCRv5',
      textDetectionModelName: 'PP-OCRv5_mobile_det',
      textRecognitionModelName: 'PP-OCRv5_mobile_rec',
      textDetectionBatchSize: 1,
      textRecognitionBatchSize: 1,
      ortOptions: { backend: LOW_MEMORY ? 'wasm' : 'auto' }
    });
    emit('PP-OCRv5中文模型已就绪', 18);
    return ocr;
  })().catch(error => {
    enginePromise = null;
    unavailable = true;
    throw error;
  });
  return enginePromise;
}

async function disposeEngine() {
  clearTimeout(disposeTimer);
  if (!enginePromise) return;
  const current = enginePromise;
  enginePromise = null;
  try { (await current)?.dispose?.(); } catch { /* 释放失败不影响后续回退 */ }
}

function scheduleDispose() {
  clearTimeout(disposeTimer);
  disposeTimer = window.setTimeout(disposeEngine, LOW_MEMORY ? 15000 : 90000);
}

async function canvasBlob(canvas, type = 'image/jpeg', quality = .88) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片压缩失败')), type, quality));
}

async function constrainImage(blob) {
  if (!(blob instanceof Blob) || typeof createImageBitmap !== 'function') return blob;
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_SIDE) return blob;
    const scale = MAX_SIDE / longest;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) return blob;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    return await canvasBlob(canvas);
  } catch {
    return blob;
  } finally {
    bitmap?.close?.();
  }
}

async function prepareImages(images) {
  const prepared = [];
  for (let index = 0; index < images.length; index += 1) {
    emit(`正在压缩第${index + 1}/${images.length}张图片以控制内存`, 4 + Math.round(index / Math.max(1, images.length) * 8));
    prepared.push({ ...images[index], blob: await constrainImage(images[index].blob) });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return prepared;
}

function normalizeItems(result, imageId) {
  return (result?.items || []).map(item => ({
    text: String(item?.text || '').trim(),
    confidence: Number(item?.score ?? 0.75),
    polygon: item?.poly || item?.polygon || null,
    imageId,
    engine: ENGINE
  })).filter(item => item.text);
}

async function paddleRecognize(images) {
  const ocr = await ensureEngine();
  const blocks = [];
  const textGroups = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    emit(`PP-OCRv5正在识别第${index + 1}/${images.length}张图片`, 20 + Math.round(index / Math.max(1, images.length) * 70));
    const [result] = await ocr.predict(image.blob, {
      textDetLimitSideLen: MAX_SIDE,
      textDetLimitType: 'max',
      textDetBoxThresh: 0.45,
      textDetUnclipRatio: 1.65,
      textRecScoreThresh: 0.30
    });
    const current = normalizeItems(result, image.id);
    blocks.push(...current);
    if (current.length) textGroups.push(current.map(item => item.text).join('\n'));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  emit('PP-OCRv5中英文识别完成', 100);
  scheduleDispose();
  return { engine: `${ENGINE}${LOW_MEMORY ? '-low-memory' : ''}`, blocks, fullText: textGroups.join('\n\n') };
}

async function recognizeWithFallback(images, options = {}) {
  const prepared = await prepareImages(images);
  try {
    return await paddleRecognize(prepared, options);
  } catch (error) {
    await disposeEngine();
    emit(`PP-OCRv5不可用，切换兼容OCR：${error.message}`, 0);
    const fallback = globalThis.LuckyBeanWebOCR;
    if (typeof fallback?.recognizeCoffeeBag !== 'function') throw error;
    const result = await fallback.recognizeCoffeeBag(prepared, options);
    return { ...result, engine: `${result.engine || 'tesseract'}-fallback-after-ppocr` };
  }
}

async function runExclusive(task) {
  if (busy) throw new Error('识别任务正在运行，请勿重复点击');
  busy = true;
  try { return await task(); }
  finally { busy = false; scheduleDispose(); }
}

globalThis.LuckyBeanPaddleOCR = {
  version: PADDLE_OCR_VERSION,
  engine: ENGINE,
  lowMemory: LOW_MEMORY,
  maxSide: MAX_SIDE,
  recognizeCoffeeBag(images, options = {}) {
    return runExclusive(() => recognizeWithFallback(images, options));
  },
  async recognize(blob, options = {}) {
    const result = await runExclusive(() => recognizeWithFallback([{ id: 'single', blob }], options));
    return { blocks: (result.blocks || []).map(block => ({ text: block.text, confidence: block.confidence, polygon: block.polygon })) };
  },
  dispose: disposeEngine
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden && LOW_MEMORY && !busy) disposeEngine();
});
window.addEventListener('pagehide', () => { if (!busy) disposeEngine(); });
document.documentElement.dataset.webOcr = `ppocr-v5-${PADDLE_OCR_VERSION}-lazy-${LOW_MEMORY ? 'low-memory' : 'balanced'}`;
