import * as core from './qr-core.js';

export * from './qr-core.js';

const CORE_LEN = 32;
const CRC_LEN = 2;

function structuredText(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/^HEX\s*:/i.test(value)) return true;
  if (/^[\[{]/.test(value)) return true;
  return Boolean(core.extractShareEncoded(value));
}

function sanitizeStructuredResult(result) {
  if (!result || !structuredText(result.data)) return result;
  return { ...result, binaryData: null, rawBytes: null };
}

export async function scanQrFile(file) {
  return sanitizeStructuredResult(await core.scanQrFile(file));
}

export class CameraScanner extends core.CameraScanner {
  constructor(video, onResult, onStatus = () => {}) {
    super(video, result => onResult(sanitizeStructuredResult(result)), onStatus);
  }
}

export function decodeJsQrResult(result, codebook) {
  if (!result) throw new Error('二维码结果为空');
  const text = String(result.data || '').trim();

  // ZXing/jsQR expose UTF-8 bytes even for ordinary URL and JSON QR codes.
  // Parse the meaningful text first; only genuine binary packets reach CRC16.
  if (/^HEX\s*:/i.test(text)) return core.decodeBrewIonBytes(text, codebook);
  try {
    const object = JSON.parse(text);
    if (object && typeof object === 'object') {
      return { ...object, source: object.source || 'json-qr' };
    }
  } catch { /* not JSON */ }

  if (core.extractShareEncoded(text)) {
    throw new Error('分享二维码未完成解压，请重新扫描或改用原图');
  }

  const bytes = result.binaryData || result.rawBytes || null;
  if (bytes?.length >= CORE_LEN + CRC_LEN) {
    try {
      return core.decodeBrewIonBytes(Uint8Array.from(bytes), codebook);
    } catch (error) {
      if (/CRC16/.test(String(error?.message || ''))) {
        throw new Error('二维码已识别，但原始字节不是有效的 BrewIon 编码；请确认二维码类型或改用清晰原图');
      }
      throw error;
    }
  }

  throw new Error('二维码不是受支持的 BrewIon 或 Lucky Bean 数据');
}
