const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const CORE_LEN = 32;
const CRC_LEN = 2;
const DAY_MS = 86400000;
const EPOCH = Date.UTC(2000, 0, 1);
let loaderPromise;

export async function ensureJsQR() {
  if (globalThis.jsQR) return globalThis.jsQR;
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = JSQR_URL;
    script.crossOrigin = 'anonymous';
    script.onload = () => globalThis.jsQR ? resolve(globalThis.jsQR) : reject(new Error('jsQR 未正确加载'));
    script.onerror = () => reject(new Error('jsQR 加载失败，请检查网络'));
    document.head.append(script);
  });
  return loaderPromise;
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
function asciiText(bytes) { return [...bytes].map(v => String.fromCharCode(v)).join(''); }
function crc16(bytes) {
  let crc = 0xffff;
  for (const value of bytes) {
    crc ^= value << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) : crc << 1;
    crc &= 0xffff;
  }
  return crc;
}
function readCrc(bytes) { return (bytes[0] << 8) | bytes[1]; }
function decodeCjk16(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
  let output = '';
  for (let i = 0; i < data.length;) {
    const first = data[i++];
    if (first < 0x80) { output += String.fromCodePoint(first); continue; }
    if (first >= 0x80 && first <= 0xd1 && i < data.length) {
      const value = (first << 8) | data[i++];
      if (value >= 0x8000 && value <= 0xd1ff) output += String.fromCodePoint(0x4e00 + value - 0x8000);
      continue;
    }
    if (first >= 0xd2 && first <= 0xeb && i < data.length) {
      const value = (first << 8) | data[i++];
      if (value >= 0xd200 && value <= 0xebbf) output += String.fromCodePoint(0x3400 + value - 0xd200);
      continue;
    }
    if (first === 0xfe && i < data.length) {
      const length = data[i++];
      if (length < 1 || length > 4 || i + length > data.length) break;
      output += new TextDecoder('utf-8', { fatal: false }).decode(data.slice(i, i + length));
      i += length;
    }
  }
  return output;
}
function rowAt(codebook, table, index) { return index ? codebook?.[table]?.[index - 1] || null : null; }
function inferRoast(number) {
  if (number >= 130) return 0; if (number >= 105) return 1; if (number >= 90) return 2;
  if (number >= 75) return 3; if (number >= 60) return 4; if (number >= 45) return 5; return 6;
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
  } catch { return new Date().toISOString().slice(0, 10); }
}
function normalizeBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (Array.isArray(input)) return Uint8Array.from(input);
  if (typeof input === 'string') {
    const hex = input.trim().replace(/^HEX\s*:/i, '').replace(/\s+/g, '');
    if (!hex || hex.length % 2 || !/^[0-9A-Fa-f]+$/.test(hex)) throw new Error('HEX 数据无效');
    return Uint8Array.from(hex.match(/../g).map(v => Number.parseInt(v, 16)));
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
  const flavorIndexes = [18, 20, 22, 24, 26].map(i => indexField(fixed.slice(i, i + 2), 2)).filter(Boolean);
  const roastDate = codeToDate(fixed.slice(28, 31));
  const harvestOffset = /^[0-3]$/.test(fixed[31]) ? Number(fixed[31]) : null;
  const country = rowAt(codebook, 'countries', countryIndex);
  const region = rowAt(codebook, 'regions', regionIndex);
  const farm = rowAt(codebook, 'entities', farmIndex);
  const station = rowAt(codebook, 'entities', stationIndex);
  const variety = rowAt(codebook, 'varieties', varietyIndex);
  const process = rowAt(codebook, 'processes', processIndex);
  const flavors = flavorIndexes.map(i => rowAt(codebook, 'flavors', i)).filter(Boolean);
  return {
    countryCode: country?.[0] || '', regionCode: region?.[0] || '',
    entityCode: station?.[0] || farm?.[0] || '', entityName: station?.[3] || farm?.[3] || '',
    varietyCode: variety?.[0] || '', processCode: process?.[0] || '',
    roastCode: `RL-L${roast.level}`, agtron: roast.agtron,
    altitude: decodeAltitude(fixed.slice(16, 18)), flavorCodes: flavors.map(row => row[0]),
    roastDate, harvestYear: harvestOffset === null ? '' : String(Number(roastDate.slice(0, 4)) - harvestOffset),
    roaster: decodeCjk16(remainder), source: 'brewion-qr'
  };
}

function scanImageData(imageData) {
  const run = data => globalThis.jsQR(data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
  let result = run(imageData.data);
  if (result) return result;
  for (const threshold of [155, 190, 220]) {
    const data = new Uint8ClampedArray(imageData.data);
    for (let i = 0; i < data.length; i += 4) {
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const v = y > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
    }
    result = run(data);
    if (result) return result;
  }
  return null;
}

export async function scanQrFile(file) {
  await ensureJsQR();
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('图片加载失败'));
      element.src = url;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = scanImageData(context.getImageData(0, 0, canvas.width, canvas.height));
    if (!result) throw new Error('图片中未识别到二维码');
    return result;
  } finally { URL.revokeObjectURL(url); }
}

export class CameraScanner {
  constructor(video, onResult, onStatus = () => {}) {
    this.video = video; this.onResult = onResult; this.onStatus = onStatus;
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d', { willReadFrequently: true });
    this.stream = null; this.active = false; this.timer = null;
  }
  async start() {
    await ensureJsQR();
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.active = true;
    this.onStatus('正在识别，将二维码完整置于画面中央');
    this.tick();
  }
  tick() {
    if (!this.active) return;
    if (this.video.readyState >= 2 && this.video.videoWidth) {
      const maxWidth = 960;
      const scale = Math.min(1, maxWidth / this.video.videoWidth);
      const width = Math.round(this.video.videoWidth * scale);
      const height = Math.round(this.video.videoHeight * scale);
      if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
      this.context.drawImage(this.video, 0, 0, width, height);
      const result = scanImageData(this.context.getImageData(0, 0, width, height));
      if (result) { this.stop(); this.onResult(result); return; }
    }
    this.timer = setTimeout(() => this.tick(), 150);
  }
  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.stream) this.stream.getTracks().forEach(track => track.stop());
    this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; }
  }
}

export function decodeJsQrResult(result, codebook) {
  if (!result) throw new Error('二维码结果为空');
  if (result.binaryData?.length >= CORE_LEN + CRC_LEN) return decodeBrewIonBytes(Uint8Array.from(result.binaryData), codebook);
  const text = String(result.data || '').trim();
  if (/^HEX\s*:/i.test(text)) return decodeBrewIonBytes(text, codebook);
  try {
    const object = JSON.parse(text);
    if (object && typeof object === 'object') return { ...object, source: 'json-qr' };
  } catch { /* plain text below */ }
  throw new Error('二维码不是受支持的 BrewIon 数据');
}
