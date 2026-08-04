import * as core from './share-codec-core.js';

export * from './share-codec-core.js';

export const SHARE_FORMAT_VERSION = 2;
export const SHARE_PREFIX = 'LB8';
export const SHARE_ENCRYPTION = 'AES-GCM-256';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlDecode(text) {
  const value = String(text || '');
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function compress(bytes) {
  if (!globalThis.CompressionStream) return { code: 'J', bytes };
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return compressed.length < bytes.length ? { code: 'R', bytes: compressed } : { code: 'J', bytes };
  } catch {
    return { code: 'J', bytes };
  }
}

async function decompress(bytes, code) {
  if (code !== 'R') return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function importKey(raw, usages) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usages);
}

function stripIdentity(payload = {}) {
  const safe = structuredClone(payload || {});
  safe.u = [];
  delete safe.user;
  safe.privacy = { identity: 'omitted', content: 'compressed+aes-gcm' };
  return safe;
}

export function buildCompactSharePayload(args = {}) {
  const payload = core.buildCompactSharePayload({
    ...args,
    user: { publicId: '', nickname: '匿名' }
  });
  payload.v = SHARE_FORMAT_VERSION;
  return stripIdentity(payload);
}

export async function encodeSharePayload(payload) {
  const safe = stripIdentity(payload);
  const packed = await compress(encoder.encode(JSON.stringify(safe)));
  if (!crypto?.subtle || !crypto?.getRandomValues) throw new Error('当前浏览器不支持安全分享加密');
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(rawKey, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed.bytes));
  // Keep the established LB8R/LB8J outer prefix so old scanners accept the QR.
  // The E marker identifies the encrypted v2 payload inside that envelope.
  return `LB8${packed.code}.E.${base64UrlEncode(rawKey)}.${base64UrlEncode(iv)}.${base64UrlEncode(cipher)}`;
}

function encryptedParts(encoded) {
  const text = String(encoded || '');
  const compatible = text.match(/^LB8([RJ])\.E\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (compatible) return compatible;
  const transitional = text.match(/^LB8E\.([RJ])\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  return transitional;
}

async function decodeEncryptedShare(encoded) {
  const match = encryptedParts(encoded);
  if (!match) throw new Error('不是 Lucky Bean 加密分享编码');
  if (!crypto?.subtle) throw new Error('当前浏览器不支持分享解密');
  const [, compression, keyText, ivText, cipherText] = match;
  const key = await importKey(base64UrlDecode(keyText), ['decrypt']);
  let plain;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlDecode(ivText) }, key, base64UrlDecode(cipherText)));
  } catch {
    throw new Error('分享数据校验失败或内容已损坏');
  }
  const bytes = await decompress(plain, compression);
  const compact = JSON.parse(decoder.decode(bytes));
  const envelopeVersion = Number(compact.v || 1);
  compact.v = 1;
  compact.u = [];
  const expanded = core.expandCompactSharePayload(compact);
  expanded.user = { publicId: '', nickname: '匿名' };
  expanded.encrypted = true;
  expanded.encryption = SHARE_ENCRYPTION;
  expanded.shareFormatVersion = envelopeVersion;
  return expanded;
}

export async function decodeSharePayload(encoded) {
  const text = String(encoded || '');
  if (encryptedParts(text)) return decodeEncryptedShare(text);
  const expanded = await core.decodeSharePayload(text);
  expanded.user = { publicId: '', nickname: expanded.user?.nickname || '匿名' };
  expanded.legacyEncryption = false;
  return expanded;
}
