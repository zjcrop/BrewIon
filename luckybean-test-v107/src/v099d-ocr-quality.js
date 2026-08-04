const PROVIDER = globalThis.LuckyBeanWebOCR;
const BASE_RECOGNIZE = PROVIDER?.recognizeCoffeeBag?.bind(PROVIDER);
const REVISION = '099d-cn-priority-multipass';
const REPLACEMENTS = new Map([
  ['水冼', '水洗'], ['水先', '水洗'], ['曰晒', '日晒'], ['日哂', '日晒'],
  ['处埋', '处理'], ['処理', '处理'], ['蜜処理', '蜜处理'], ['厌氣', '厌氧'],
  ['瑰厦', '瑰夏'], ['瑰下', '瑰夏'], ['海拨', '海拔'], ['烘焙曰期', '烘焙日期'],
  ['埃塞俄比亞', '埃塞俄比亚'], ['哥倫比亞', '哥伦比亚'], ['發酵', '发酵']
]);

function clean(value) {
  let text = String(value || '').normalize('NFKC');
  for (const [from, to] of REPLACEMENTS) text = text.replaceAll(from, to);
  return text
    .replace(/([\u3400-\u9FFF])\s+(?=[\u3400-\u9FFF])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function score(text, confidence = 0) {
  const value = clean(text);
  const cjk = (value.match(/[\u3400-\u9FFF]/g) || []).length;
  const latin = (value.match(/[A-Za-z0-9]/g) || []).length;
  const domain = (value.match(/水洗|日晒|蜜处理|厌氧|发酵|瑰夏|波旁|铁皮卡|卡杜艾|海拔|产区|庄园|处理法|烘焙日期|风味/g) || []).length;
  const noise = (value.match(/[�□■]/g) || []).length;
  return cjk * 3.8 + latin * .45 + domain * 8 + Number(confidence || 0) * .1 - noise * 8;
}

function blocks(result, imageId) {
  const item = (result?.results || []).find(entry => entry.imageId === imageId);
  return Array.isArray(item?.value) ? item.value : item?.value?.blocks || [];
}
function textFor(result, imageId) {
  const local = blocks(result, imageId).map(block => block?.text || block?.rawValue || '').filter(Boolean).join('\n');
  return clean(local || result?.fullText || '');
}
function confidenceFor(result, imageId) {
  const values = blocks(result, imageId).map(block => Number(block?.confidence || 0)).filter(Number.isFinite);
  if (!values.length) return Number(result?.confidence || 0);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return average <= 1 ? average * 100 : average;
}
function key(line) {
  return line.toLocaleLowerCase('zh-CN').replace(/[\s，,。.;；:：\-_·•]/g, '');
}
function merge(values) {
  const candidates = values.flatMap(value => clean(value.text).split(/\n+/).map(line => ({
    line: line.trim(), key: key(line), rank: score(line, value.confidence)
  }))).filter(item => item.key.length >= 2).sort((a, b) => b.rank - a.rank);
  const selected = [];
  const seen = new Set();
  for (const item of candidates) {
    if (seen.has(item.key)) continue;
    if ([...seen].some(existing => existing.includes(item.key) && item.key.length >= 4)) continue;
    seen.add(item.key);
    selected.push(item.line);
  }
  return selected.join('\n');
}

async function decode(blob) {
  if (globalThis.createImageBitmap) return createImageBitmap(blob, { imageOrientation: 'from-image' });
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('方向复核图片读取失败'));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}
function toBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('方向复核图片生成失败')), 'image/png', .96));
}
async function rotate(blob, degrees) {
  const image = await decode(blob);
  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = height;
  canvas.height = width;
  const context = canvas.getContext('2d');
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(degrees * Math.PI / 180);
  context.drawImage(image, -width / 2, -height / 2, width, height);
  image.close?.();
  return toBlob(canvas);
}
function progress(status, value = 0) {
  globalThis.dispatchEvent(new CustomEvent('luckybean:ocr-progress', { detail: { status, progress: value } }));
}
async function pass(images, languages, label) {
  if (!BASE_RECOGNIZE) throw new Error('基础 OCR 引擎未加载');
  progress(label, .02);
  return BASE_RECOGNIZE(images, { locale: 'zh-CN', languages });
}

async function recognize(images) {
  const mixed = await pass(images, ['chi_sim', 'eng'], '中英文混合识别');
  const values = new Map(images.map(image => [image.id, [{
    text: textFor(mixed, image.id), confidence: confidenceFor(mixed, image.id), source: 'mixed'
  }]]));
  const needsChinese = images.some(image => {
    const text = textFor(mixed, image.id);
    return score(text, confidenceFor(mixed, image.id)) < 42 || (text.match(/[\u3400-\u9FFF]/g) || []).length < 4;
  });
  if (needsChinese) {
    const chinese = await pass(images, ['chi_sim'], '中文优先复核');
    for (const image of images) values.get(image.id).push({
      text: textFor(chinese, image.id), confidence: confidenceFor(chinese, image.id), source: 'cn'
    });
  }
  const weak = images.filter(image => Math.max(...values.get(image.id).map(value => score(value.text, value.confidence)), 0) < 52);
  for (const degrees of weak.length ? [90, -90] : []) {
    const rotated = [];
    for (const image of weak) rotated.push({ ...image, blob: await rotate(image.blob, degrees) });
    const result = await pass(rotated, ['chi_sim'], degrees > 0 ? '顺时针文字方向复核' : '逆时针文字方向复核');
    for (const image of weak) values.get(image.id).push({
      text: textFor(result, image.id), confidence: confidenceFor(result, image.id), source: `rotate-${degrees}`
    });
  }
  const results = images.map(image => {
    const candidates = values.get(image.id);
    const text = merge(candidates);
    const best = [...candidates].sort((a, b) => score(b.text, b.confidence) - score(a.text, a.confidence))[0] || { confidence: 0 };
    return { imageId: image.id, value: { blocks: text ? [{ text, confidence: Math.max(0, Math.min(1, best.confidence / 100)) }] : [] } };
  });
  progress('中文优先多通道识别完成', 1);
  return {
    engine: `tesseract.js-${REVISION}`,
    results,
    fullText: results.map(item => item.value.blocks[0]?.text || '').filter(Boolean).join('\n\n')
  };
}

if (PROVIDER && BASE_RECOGNIZE) {
  PROVIDER.baseRecognizeCoffeeBag = BASE_RECOGNIZE;
  PROVIDER.recognizeCoffeeBag = recognize;
  PROVIDER.engine = `tesseract.js-${REVISION}`;
  PROVIDER.pipeline = {
    revision: REVISION,
    strategy: 'mixed-pass + conditional Chinese-only + conditional ±90° orientation + conservative coffee-domain correction',
    limitation: 'generic Tesseract chi_sim model; not a fine-tuned coffee-package OCR model'
  };
  document.documentElement.dataset.webOcr = REVISION;
}
globalThis.LuckyBeanV099dOCR = { score, merge, clean, rotate };
