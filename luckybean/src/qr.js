import { decodeSharePayload } from './share-codec.js';

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.0/+esm';
const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const CORE_LEN = 32;
const CRC_LEN = 2;
const DAY_MS = 86400000;
const EPOCH = Date.UTC(2000, 0, 1);
let zxingLoaderPromise;
let jsqrLoaderPromise;
let nativeDetectorPromise;

export async function ensureZXing() {
  if (zxingLoaderPromise) return zxingLoaderPromise;
  zxingLoaderPromise = import(ZXING_URL).then(module => {
    if (!module?.BrowserQRCodeReader) throw new Error('ZXing 二维码模块未正确加载');
    return module;
  });
  return zxingLoaderPromise;
}

export async function ensureJsQR() {
  if (globalThis.jsQR) return globalThis.jsQR;
  if (jsqrLoaderPromise) return jsqrLoaderPromise;
  jsqrLoaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = JSQR_URL;
    script.crossOrigin = 'anonymous';
    script.onload = () => globalThis.jsQR ? resolve(globalThis.jsQR) : reject(new Error('jsQR 未正确加载'));
    script.onerror = () => reject(new Error('jsQR 兼容引擎加载失败，请检查网络'));
    document.head.append(script);
  });
  return jsqrLoaderPromise;
}

async function ensureNativeDetector() {
  if (nativeDetectorPromise) return nativeDetectorPromise;
  nativeDetectorPromise = (async () => {
    if (!('BarcodeDetector' in globalThis)) return null;
    try {
      const formats = typeof globalThis.BarcodeDetector.getSupportedFormats === 'function'
        ? await globalThis.BarcodeDetector.getSupportedFormats()
        : ['qr_code'];
      if (!formats.includes('qr_code')) return null;
      return new globalThis.BarcodeDetector({ formats: ['qr_code'] });
    } catch {
      return null;
    }
  })();
  return nativeDetectorPromise;
}

function base36(value, allowPadding = false) {
  let text = String(value || '');
  if (allowPadding) text = text.replace(/^\*+/, '');
  if (!text || !/^[0-9A-Z]+$/.test(text)) throw new Error(`Base36 无效：${value}`);
  return Number.parseInt(text, 36);
}
function indexField(field, width, required = false) {
  const text = String(field || '');
  const empty = '*'.repeat(width);
  if (text.length !== width) throw new Error(`索引长度错误：${text}`);
  if (text === empty) { if (required) throw new Error('必填索引为空'); return 0; }
  if (!/^\**[0-9A-Z]+$/.test(text)) throw new Error(`索引格式无效：${text}`);
  const first = text.search(/[0-9A-Z]/);
  if (first < 0 || text.slice(first).includes('*')) throw new Error(`索引补位无效：${text}`);
  return base36(text, true);
}
function asciiText(bytes) { return [...bytes].map(value => String.fromCharCode(value)).join(''); }
function crc16(bytes) {
  let crc = 0xffff;
  for (const value of bytes) {
    crc ^= value << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) : crc << 1;
    crc &= 0xffff;
  }
  return crc;
}
function readCrc(bytes) { return (bytes[0] << 8) | bytes[1]; }
function decodeCjk16(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
  let output = '';
  for (let index = 0; index < data.length;) {
    const first = data[index++];
    if (first < 0x80) { output += String.fromCodePoint(first); continue; }
    if (first >= 0x80 && first <= 0xd1 && index < data.length) {
      const value = (first << 8) | data[index++];
      if (value >= 0x8000 && value <= 0xd1ff) output += String.fromCodePoint(0x4e00 + value - 0x8000);
      continue;
    }
    if (first >= 0xd2 && first <= 0xeb && index < data.length) {
      const value = (first << 8) | data[index++];
      if (value >= 0xd200 && value <= 0xebbf) output += String.fromCodePoint(0x3400 + value - 0xd200);
      continue;
    }
    if (first === 0xfe && index < data.length) {
      const length = data[index++];
      if (length < 1 || length > 4 || index + length > data.length) break;
      output += new TextDecoder('utf-8', { fatal: false }).decode(data.slice(index, index + length));
      index += length;
    }
  }
  return output;
}
function rowAt(codebook, table, index) { return index ? codebook?.[table]?.[index - 1] || null : null; }
function inferRoast(number) {
  if (number >= 130) return 0;
  if (number >= 105) return 1;
  if (number >= 90) return 2;
  if (number >= 75) return 3;
  if (number >= 60) return 4;
  if (number >= 45) return 5;
  return 6;
}
function decodeRoast(text) {
  if (/^\*[0-6]$/.test(text)) return { level: text[1], agtron: '' };
  if (!/^[0-9A-Z]{2}$/.test(text)) return { level: '2', agtron: '' };
  const value = Number.parseInt(text, 36);
  return value >= 0 && value <= 150 ? { level: String(inferRoast(value)), agtron: String(value) } : { level: '2', agtron: '' };
}
function decodeAltitude(text) {
  if (text === '**' || text.length !== 2 || !/^\**[0-9A-Z]+$/.test(text)) return '';
  try { return String(base36(text, true) * 10); } catch { return ''; }
}
function codeToDate(text) {
  if (text.length !== 3 || text === '***' || !/^\**[0-9A-Z]+$/.test(text)) return new Date().toISOString().slice(0, 10);
  try {
    const days = base36(text, true);
    if (days > 46655) throw new Error('日期越界');
    return new Date(EPOCH + days * DAY_MS).toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
function normalizeBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (Array.isArray(input)) return Uint8Array.from(input);
  if (typeof input === 'string') {
    const hex = input.trim().replace(/^HEX\s*:/i, '').replace(/\s+/g, '');
    if (!hex || hex.length % 2 || !/^[0-9A-Fa-f]+$/.test(hex)) throw new Error('HEX 数据无效');
    return Uint8Array.from(hex.match(/../g).map(value => Number.parseInt(value, 16)));
  }
  throw new Error('二维码字节类型无法识别');
}

export function decodeBrewIonBytes(input, codebook) {
  const bytes = normalizeBytes(input);
  if (bytes.length < CORE_LEN + CRC_LEN) throw new Error('二维码数据长度不足');
  const core = bytes.slice(0, -CRC_LEN);
  if (readCrc(bytes.slice(-CRC_LEN)) !== crc16(core)) throw new Error('CRC16 校验失败');
  const fixed = asciiText(core.slice(0, CORE_LEN));
  const remainder = core.slice(CORE_LEN);
  const countryIndex = indexField(fixed.slice(0, 2), 2, true);
  const regionIndex = indexField(fixed.slice(2, 4), 2);
  const farmIndex = indexField(fixed.slice(4, 7), 3);
  const stationIndex = indexField(fixed.slice(7, 10), 3);
  const varietyIndex = indexField(fixed.slice(10, 12), 2, true);
  const processIndex = indexField(fixed.slice(12, 14), 2, true);
  const roast = decodeRoast(fixed.slice(14, 16));
  const flavorIndexes = [18, 20, 22, 24, 26].map(index => indexField(fixed.slice(index, index + 2), 2)).filter(Boolean);
  const roastDate = codeToDate(fixed.slice(28, 31));
  const harvestOffset = /^[0-3]$/.test(fixed[31]) ? Number(fixed[31]) : null;
  const country = rowAt(codebook, 'countries', countryIndex);
  const region = rowAt(codebook, 'regions', regionIndex);
  const farm = rowAt(codebook, 'entities', farmIndex);
  const station = rowAt(codebook, 'entities', stationIndex);
  const variety = rowAt(codebook, 'varieties', varietyIndex);
  const process = rowAt(codebook, 'processes', processIndex);
  const flavors = flavorIndexes.map(index => rowAt(codebook, 'flavors', index)).filter(Boolean);
  return {
    countryCode: country?.[0] || '',
    regionCode: region?.[0] || '',
    entityCode: station?.[0] || farm?.[0] || '',
    entityName: station?.[3] || farm?.[3] || '',
    varietyCode: variety?.[0] || '',
    processCode: process?.[0] || '',
    roastCode: `RL-L${roast.level}`,
    agtron: roast.agtron,
    altitude: decodeAltitude(fixed.slice(16, 18)),
    flavorCodes: flavors.map(row => row[0]),
    roastDate,
    harvestYear: harvestOffset === null ? '' : String(Number(roastDate.slice(0, 4)) - harvestOffset),
    roaster: decodeCjk16(remainder),
    source: 'brewion-qr'
  };
}

function resultText(result) {
  if (!result) return '';
  if (typeof result === 'string') return result.trim();
  if (typeof result.getText === 'function') return String(result.getText() || '').trim();
  return String(result.rawValue ?? result.data ?? '').trim();
}
function resultBytes(result) {
  if (!result) return null;
  const value = typeof result.getRawBytes === 'function' ? result.getRawBytes() : (result.binaryData || result.rawBytes || null);
  if (!value) return null;
  try { return normalizeBytes(value); } catch { return null; }
}

export function extractShareEncoded(text) {
  const value = String(text || '').trim();
  if (/^LB8[RDGJ]\./.test(value)) return value;
  const hashIndex = value.indexOf('#share=');
  if (hashIndex >= 0) return value.slice(hashIndex + 7).split(/[&#]/)[0];
  try {
    const url = new URL(value, globalThis.location?.href || 'https://local.invalid/');
    if (url.hash.startsWith('#share=')) return url.hash.slice(7);
  } catch { /* not a URL */ }
  return '';
}

async function expandShareResult(normalized) {
  const encoded = extractShareEncoded(normalized.data);
  if (!encoded) return normalized;
  const payload = await decodeSharePayload(encoded);
  const bean = {
    ...(payload.bean || {}),
    source: 'luckybean-share-qr',
    notes: [`二维码分享`, payload.user?.nickname ? `来自 ${payload.user.nickname}` : '', payload.sharedAt ? `分享于 ${payload.sharedAt}` : ''].filter(Boolean).join('；')
  };
  return {
    ...normalized,
    data: JSON.stringify(bean),
    binaryData: null,
    shareEncoded: encoded,
    sharePayloadVersion: payload.appVersion || ''
  };
}

export async function normalizeQrResult(result, engine = 'unknown') {
  const bytes = resultBytes(result);
  const normalized = {
    data: resultText(result),
    binaryData: bytes ? Array.from(bytes) : null,
    engine,
    location: result?.location || null
  };
  return expandShareResult(normalized);
}

function isSupportedCandidate(result) {
  if (Array.isArray(result?.binaryData) && result.binaryData.length >= CORE_LEN + CRC_LEN) return true;
  const text = String(result?.data || '').trim();
  if (/^HEX\s*:/i.test(text)) return true;
  if (/^[\[{]/.test(text)) return true;
  if (extractShareEncoded(text)) return true;
  return false;
}

function runJsQr(imageData) {
  return globalThis.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
}
function scanImageData(imageData) {
  let result = runJsQr(imageData);
  if (result) return result;
  for (const threshold of [110, 140, 170, 200, 225]) {
    const data = new Uint8ClampedArray(imageData.data);
    for (let index = 0; index < data.length; index += 4) {
      const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      const value = luminance > threshold ? 255 : 0;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
    result = globalThis.jsQR(data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
    if (result) return result;
  }
  return null;
}
function scanCanvasWithJsQr(canvas, context) {
  const full = scanImageData(context.getImageData(0, 0, canvas.width, canvas.height));
  if (full) return full;
  for (const fraction of [0.88, 0.72, 0.58]) {
    const width = Math.max(1, Math.round(canvas.width * fraction));
    const height = Math.max(1, Math.round(canvas.height * fraction));
    const x = Math.round((canvas.width - width) / 2);
    const y = Math.round((canvas.height - height) / 2);
    const cropped = scanImageData(context.getImageData(x, y, width, height));
    if (cropped) return cropped;
  }
  return null;
}

async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = url;
  });
}

export async function scanQrFile(file) {
  if (!file) throw new Error('未选择图片');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    try {
      const { BrowserQRCodeReader } = await ensureZXing();
      const reader = new BrowserQRCodeReader();
      const result = await reader.decodeFromImageElement(image);
      const normalized = await normalizeQrResult(result, 'zxing-browser-0.2.0');
      if (!isSupportedCandidate(normalized)) throw new Error('识别到二维码，但不是受支持的豆卡二维码');
      return normalized;
    } catch (zxingError) {
      const detector = await ensureNativeDetector();
      if (detector) {
        try {
          const detected = await detector.detect(image);
          if (detected?.[0]) {
            const normalized = await normalizeQrResult(detected[0], 'barcode-detector');
            if (isSupportedCandidate(normalized)) return normalized;
          }
        } catch { /* continue to compatibility engine */ }
      }
      await ensureJsQR();
      const max = 1920;
      const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const result = scanCanvasWithJsQr(canvas, context);
      if (!result) throw new Error(`图片中未识别到二维码；ZXing：${zxingError.message}`);
      const normalized = await normalizeQrResult(result, 'jsqr-1.4.0-fallback');
      if (!isSupportedCandidate(normalized)) throw new Error('识别到二维码，但不是受支持的豆卡二维码');
      return normalized;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class CameraScanner {
  constructor(video, onResult, onStatus = () => {}) {
    this.video = video;
    this.onResult = onResult;
    this.onStatus = onStatus;
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d', { willReadFrequently: true });
    this.stream = null;
    this.controls = null;
    this.reader = null;
    this.active = false;
    this.timer = null;
    this.processing = false;
    this.lastHintAt = 0;
    this.nativeDetector = null;
    this.jsQrReady = false;
  }

  status(message) {
    try { this.onStatus(message); } catch { /* overlay may have closed */ }
  }

  async start() {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持摄像头实时扫描');
    this.active = true;
    this.status('正在启动自动捕捉引擎…');
    try {
      await this.startWithZXing();
    } catch (error) {
      if (!this.active) throw error;
      this.status('ZXing 启动失败，正在切换兼容扫描引擎…');
      await this.startFallback(error);
    }
  }

  async startWithZXing() {
    const { BrowserQRCodeReader } = await ensureZXing();
    if (!this.active) return;
    this.reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 100, delayBetweenScanSuccess: 500 });
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        focusMode: { ideal: 'continuous' }
      }
    };
    this.status('ZXing 0.2.0 自动捕捉已开启 · 无需拍照，将二维码完整放入取景框');
    this.controls = await this.reader.decodeFromConstraints(constraints, this.video, async result => {
      if (!this.active || !result || this.processing) return;
      this.processing = true;
      try {
        const normalized = await normalizeQrResult(result, 'zxing-browser-0.2.0');
        if (!isSupportedCandidate(normalized)) {
          this.status('已捕捉到二维码，但不是支持的豆卡二维码，请更换二维码');
          this.processing = false;
          return;
        }
        this.status('已自动捕捉，正在解析二维码…');
        this.stop();
        await this.onResult(normalized);
      } catch (error) {
        this.processing = false;
        this.status(`二维码已捕捉但解析失败：${error.message}`);
      }
    });
  }

  async startFallback(zxingError) {
    this.nativeDetector = await ensureNativeDetector();
    try {
      await ensureJsQR();
      this.jsQrReady = true;
    } catch {
      this.jsQrReady = false;
    }
    if (!this.nativeDetector && !this.jsQrReady) throw new Error(`二维码引擎均无法加载：${zxingError.message}`);
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.status(`${this.nativeDetector ? '系统二维码引擎' : 'jsQR 兼容引擎'}自动捕捉已开启 · 无需拍照`);
    this.tickFallback();
  }

  async acceptFallback(result, engine) {
    if (!this.active || this.processing) return;
    this.processing = true;
    try {
      const normalized = await normalizeQrResult(result, engine);
      if (!isSupportedCandidate(normalized)) {
        this.status('已捕捉到二维码，但不是支持的豆卡二维码，请更换二维码');
        this.processing = false;
        return;
      }
      this.status('已自动捕捉，正在解析二维码…');
      this.stop();
      await this.onResult(normalized);
    } catch (error) {
      this.processing = false;
      this.status(`二维码已捕捉但解析失败：${error.message}`);
    }
  }

  async tickFallback() {
    if (!this.active) return;
    try {
      if (this.video.readyState >= 2 && this.video.videoWidth) {
        if (this.nativeDetector) {
          const detected = await this.nativeDetector.detect(this.video).catch(() => []);
          if (detected?.[0]) {
            await this.acceptFallback(detected[0], 'barcode-detector');
            if (!this.active) return;
          }
        }
        if (this.jsQrReady && !this.processing) {
          const maxWidth = 1280;
          const scale = Math.min(1, maxWidth / this.video.videoWidth);
          const width = Math.max(1, Math.round(this.video.videoWidth * scale));
          const height = Math.max(1, Math.round(this.video.videoHeight * scale));
          if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
          }
          this.context.drawImage(this.video, 0, 0, width, height);
          const result = scanCanvasWithJsQr(this.canvas, this.context);
          if (result) {
            await this.acceptFallback(result, 'jsqr-1.4.0-fallback');
            if (!this.active) return;
          }
        }
      }
      const now = Date.now();
      if (now - this.lastHintAt > 2500) {
        this.lastHintAt = now;
        this.status('自动捕捉中 · 保持二维码清晰、完整并尽量正对镜头');
      }
    } finally {
      if (this.active) this.timer = setTimeout(() => this.tickFallback(), 120);
    }
  }

  stop() {
    this.active = false;
    this.processing = false;
    clearTimeout(this.timer);
    this.timer = null;
    try { this.controls?.stop?.(); } catch { /* already stopped */ }
    this.controls = null;
    try { this.reader?.reset?.(); } catch { /* optional */ }
    this.reader = null;
    if (this.stream) this.stream.getTracks().forEach(track => track.stop());
    this.stream = null;
    const mediaStream = this.video?.srcObject;
    if (mediaStream?.getTracks) mediaStream.getTracks().forEach(track => track.stop());
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
  }
}

export function decodeJsQrResult(result, codebook) {
  if (!result) throw new Error('二维码结果为空');
  if (result.binaryData?.length >= CORE_LEN + CRC_LEN) return decodeBrewIonBytes(Uint8Array.from(result.binaryData), codebook);
  const text = String(result.data || '').trim();
  if (/^HEX\s*:/i.test(text)) return decodeBrewIonBytes(text, codebook);
  try {
    const object = JSON.parse(text);
    if (object && typeof object === 'object') return { ...object, source: object.source || 'json-qr' };
  } catch { /* plain text below */ }
  if (extractShareEncoded(text)) throw new Error('分享二维码未完成解压，请重新扫描');
  throw new Error('二维码不是受支持的 BrewIon 或 Lucky Bean 数据');
}
