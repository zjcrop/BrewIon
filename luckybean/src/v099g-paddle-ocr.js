const PADDLE_OCR_VERSION = '0.4.2';
const PADDLE_OCR_URL = `https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@${PADDLE_OCR_VERSION}/+esm`;
const ENGINE = `PP-OCRv5-mobile-browser-${PADDLE_OCR_VERSION}`;
let modulePromise = null;
let enginePromise = null;
let unavailable = false;
let queue = Promise.resolve();

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
  if (unavailable) throw new Error('PP-OCRv5在当前浏览器初始化失败');
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const module = await loadModule();
    if (!module?.PaddleOCR?.create) throw new Error('PP-OCRv5 SDK接口不可用');
    emit('首次使用正在下载中文检测与识别模型', 8);
    const ocr = await module.PaddleOCR.create({
      lang: 'ch',
      ocrVersion: 'PP-OCRv5',
      textDetectionModelName: 'PP-OCRv5_mobile_det',
      textRecognitionModelName: 'PP-OCRv5_mobile_rec',
      textDetectionBatchSize: 1,
      textRecognitionBatchSize: 6,
      ortOptions: { backend: 'auto' }
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
      textDetLimitSideLen: 1600,
      textDetLimitType: 'max',
      textDetBoxThresh: 0.45,
      textDetUnclipRatio: 1.65,
      textRecScoreThresh: 0.30
    });
    const current = normalizeItems(result, image.id);
    blocks.push(...current);
    if (current.length) textGroups.push(current.map(item => item.text).join('\n'));
  }
  emit('PP-OCRv5中英文识别完成', 100);
  return { engine: ENGINE, blocks, fullText: textGroups.join('\n\n') };
}

async function recognizeWithFallback(images, options = {}) {
  try {
    return await paddleRecognize(images, options);
  } catch (error) {
    emit(`PP-OCRv5不可用，切换兼容OCR：${error.message}`, 0);
    const fallback = globalThis.LuckyBeanWebOCR;
    if (typeof fallback?.recognizeCoffeeBag !== 'function') throw error;
    const result = await fallback.recognizeCoffeeBag(images, options);
    return { ...result, engine: `${result.engine || 'tesseract'}-fallback-after-ppocr` };
  }
}

function enqueue(task) {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

globalThis.LuckyBeanPaddleOCR = {
  version: PADDLE_OCR_VERSION,
  engine: ENGINE,
  recognizeCoffeeBag(images, options = {}) {
    return enqueue(() => recognizeWithFallback(images, options));
  },
  async recognize(blob, options = {}) {
    const result = await enqueue(() => recognizeWithFallback([{ id: 'single', blob }], options));
    return { blocks: (result.blocks || []).map(block => ({ text: block.text, confidence: block.confidence, polygon: block.polygon })) };
  },
  async dispose() {
    if (!enginePromise) return;
    try { (await enginePromise)?.dispose?.(); } finally { enginePromise = null; }
  }
};

document.documentElement.dataset.webOcr = `ppocr-v5-${PADDLE_OCR_VERSION}-lazy`;
