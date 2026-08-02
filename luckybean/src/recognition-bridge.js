export class RecognitionUnavailableError extends Error {
  constructor(message = '当前设备尚未安装豆袋文字识别引擎') {
    super(message);
    this.name = 'RecognitionUnavailableError';
  }
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeBlock(block, imageId, engine) {
  const text = cleanText(block?.text ?? block?.rawValue ?? block?.value);
  if (!text) return null;
  const box = block?.polygon || block?.corners || block?.boundingBox || null;
  const confidence = Number(block?.confidence ?? block?.score ?? 0.75);
  return {
    text,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.75,
    polygon: box,
    imageId,
    engine
  };
}

function deduplicateBlocks(blocks) {
  const map = new Map();
  for (const block of blocks) {
    const key = block.text.toLocaleLowerCase('zh-CN').replace(/[\s·•,，;；:：/_-]+/g, '');
    if (!key) continue;
    const current = map.get(key);
    if (!current || block.confidence > current.confidence) map.set(key, block);
  }
  return [...map.values()];
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片编码失败'));
    reader.readAsDataURL(blob);
  });
}

async function nativeRecognize(images, options) {
  const bridge = globalThis.LuckyBeanRecognitionBridge || globalThis.LuckyBeanNative;
  if (typeof bridge?.recognizeCoffeeBag !== 'function') return null;
  const payloadImages = await Promise.all(images.map(async image => ({
    id: image.id,
    role: image.role,
    mimeType: image.blob.type || 'image/jpeg',
    dataUrl: await blobToDataUrl(image.blob)
  })));
  const result = await bridge.recognizeCoffeeBag({ images: payloadImages, locale: options.locale || 'zh-CN' });
  return { ...result, engine: result?.engine || 'native-ppocr' };
}

async function webProviderRecognize(images, options) {
  const provider = globalThis.LuckyBeanPaddleOCR || globalThis.LuckyBeanWebOCR;
  if (typeof provider?.recognizeCoffeeBag === 'function') {
    const result = await provider.recognizeCoffeeBag(images, options);
    return { ...result, engine: result?.engine || 'web-ppocr' };
  }
  if (typeof provider?.recognize === 'function') {
    const results = [];
    for (const image of images) {
      const value = await provider.recognize(image.blob, options);
      results.push({ imageId: image.id, value });
    }
    return { engine: 'web-ppocr', results };
  }
  return null;
}

async function textDetectorRecognize(images) {
  if (typeof globalThis.TextDetector !== 'function' || typeof globalThis.createImageBitmap !== 'function') return null;
  const detector = new TextDetector();
  const results = [];
  for (const image of images) {
    const bitmap = await createImageBitmap(image.blob);
    try {
      results.push({ imageId: image.id, value: await detector.detect(bitmap) });
    } finally {
      bitmap.close?.();
    }
  }
  return { engine: 'browser-text-detector', results };
}

function collectBlocks(result, images) {
  const engine = result?.engine || 'unknown';
  const blocks = [];

  if (Array.isArray(result?.blocks)) {
    for (const block of result.blocks) {
      const normalized = normalizeBlock(block, block.imageId || images[0]?.id || '', engine);
      if (normalized) blocks.push(normalized);
    }
  }
  for (const item of result?.results || []) {
    const rawBlocks = Array.isArray(item?.value) ? item.value : item?.value?.blocks || item?.value?.results || [];
    for (const block of rawBlocks) {
      const normalized = normalizeBlock(block, item.imageId, engine);
      if (normalized) blocks.push(normalized);
    }
  }
  if (!blocks.length && result?.fullText) {
    const normalized = normalizeBlock({ text: result.fullText, confidence: result.confidence }, images[0]?.id || '', engine);
    if (normalized) blocks.push(normalized);
  }
  return deduplicateBlocks(blocks);
}

export function getRecognitionCapabilities() {
  const nativeBridge = globalThis.LuckyBeanRecognitionBridge || globalThis.LuckyBeanNative;
  return {
    native: typeof nativeBridge?.recognizeCoffeeBag === 'function',
    webPaddle: Boolean(globalThis.LuckyBeanPaddleOCR || globalThis.LuckyBeanWebOCR),
    textDetector: typeof globalThis.TextDetector === 'function'
  };
}

export async function recognizeCoffeeBag(images, options = {}) {
  if (!Array.isArray(images) || !images.length) throw new Error('请先添加豆袋照片');
  let result = await nativeRecognize(images, options);
  if (!result) result = await webProviderRecognize(images, options);
  if (!result) result = await textDetectorRecognize(images);
  if (!result) throw new RecognitionUnavailableError();

  const blocks = collectBlocks(result, images);
  const groupedText = images.map(image => {
    const text = blocks.filter(block => block.imageId === image.id).map(block => block.text).join('\n');
    return text ? `【${image.roleLabel || image.role || '豆袋照片'}】\n${text}` : '';
  }).filter(Boolean);
  const fullText = groupedText.join('\n\n') || blocks.map(block => block.text).join('\n');
  return { engine: result.engine, blocks, fullText, raw: result };
}
