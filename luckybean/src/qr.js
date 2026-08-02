import * as core from './qr-core.js';

export * from './qr-core.js';

const CORE_LEN = 32;
const CRC_LEN = 2;

function structuredText(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/^HEX\s*:/i.test(value)) return true;
  if (/^[\[{]/.test(value)) return true;
  if (/(?:^|[^A-Z0-9])(?:CT|RG|EN|VR|PROC|FL|RL)-[A-Z0-9-]+/i.test(value)) return true;
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

function normalizeCodeText(value) {
  return String(value || '').normalize('NFKC').toUpperCase()
    .replace(/[‐‑‒–—―−﹣－]/g, '-')
    .replace(/\s*-\s*/g, '-');
}

function decodeCodebookText(text, codebook) {
  const source = normalizeCodeText(text);
  const tableFields = {
    countries: 'countryCode',
    regions: 'regionCode',
    entities: 'entityCode',
    varieties: 'varietyCode',
    processes: 'processCode'
  };
  const result = { source: 'codebook-text-qr' };
  let matches = 0;
  for (const [table, field] of Object.entries(tableFields)) {
    for (const row of codebook?.[table] || []) {
      const code = normalizeCodeText(row?.[0]);
      if (!code) continue;
      const index = source.indexOf(code);
      if (index < 0) continue;
      const before = source[index - 1] || '';
      const after = source[index + code.length] || '';
      if (/[A-Z0-9]/.test(before) || /[A-Z0-9]/.test(after)) continue;
      result[field] = row[0];
      matches += 1;
      break;
    }
  }
  const roast = source.match(/(?:^|[^A-Z0-9])(RL-L[0-6])(?:$|[^A-Z0-9])/);
  if (roast) { result.roastCode = roast[1]; matches += 1; }
  if (matches >= 2 || (matches >= 1 && /豆仓编码|BREWION|LUCKY\s*BEAN/i.test(text))) return result;
  return null;
}

function latin1Bytes(text) {
  if (!text || text.length < CORE_LEN + CRC_LEN) return null;
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 255) return null;
    bytes[index] = code;
  }
  return bytes;
}

function tryBrewIonBytes(bytes, codebook) {
  if (!bytes || bytes.length < CORE_LEN + CRC_LEN) return null;
  try { return core.decodeBrewIonBytes(Uint8Array.from(bytes), codebook); }
  catch { return null; }
}

export function decodeJsQrResult(result, codebook) {
  if (!result) throw new Error('二维码结果为空');
  const text = String(result.data || '').trim();

  // Text formats are authoritative. Raw bytes are considered only after JSON,
  // Lucky Bean share codes and explicit codebook text have been ruled out.
  if (/^HEX\s*:/i.test(text)) return core.decodeBrewIonBytes(text, codebook);
  try {
    const object = JSON.parse(text);
    if (object && typeof object === 'object') return { ...object, source: object.source || 'json-qr' };
  } catch { /* not JSON */ }

  const codebookResult = decodeCodebookText(text, codebook);
  if (codebookResult) return codebookResult;

  if (core.extractShareEncoded(text)) {
    throw new Error('分享二维码未完成解压，请重新扫描或改用原图');
  }

  const explicitBytes = result.binaryData || result.rawBytes || null;
  const decodedExplicit = tryBrewIonBytes(explicitBytes, codebook);
  if (decodedExplicit) return decodedExplicit;

  // Some mobile decoders expose a byte-mode QR only as an ISO-8859-1 string.
  // Recover those bytes before declaring the BrewIon packet invalid.
  const decodedLatin1 = tryBrewIonBytes(latin1Bytes(text), codebook);
  if (decodedLatin1) return decodedLatin1;

  if (explicitBytes?.length >= CORE_LEN + CRC_LEN || text.length >= CORE_LEN + CRC_LEN) {
    throw new Error('二维码已识别，但内容不是有效的 BrewIon 固定字段编码；请确认二维码来自豆仓/富贵盒子并保持图像清晰');
  }
  throw new Error('二维码不是受支持的 BrewIon、Lucky Bean、JSON 或编码表文本');
}
