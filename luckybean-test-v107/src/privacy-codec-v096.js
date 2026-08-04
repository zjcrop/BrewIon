export const PRIVATE_ENVELOPE_FORMAT = 'LB-PRIVATE-1';
// This module is covered by the full integrity browser gate.

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
  if (!globalThis.CompressionStream) return { format: 'raw', bytes };
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return compressed.length < bytes.length ? { format: 'deflate-raw', bytes: compressed } : { format: 'raw', bytes };
  } catch {
    return { format: 'raw', bytes };
  }
}

async function decompress(bytes, format) {
  if (format !== 'deflate-raw') return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function keyFromSecret(secret, usages) {
  return crypto.subtle.importKey('raw', secret, { name: 'AES-GCM' }, false, usages);
}

export async function sealPrivateJson(value, secret, purpose = 'private') {
  if (!crypto?.subtle || !secret) throw new Error('当前环境无法加密私有字段');
  const packed = await compress(encoder.encode(JSON.stringify(value ?? null)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromSecret(secret, ['encrypt']);
  const additionalData = encoder.encode(`LuckyBean:${purpose}:${PRIVATE_ENVELOPE_FORMAT}`);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, packed.bytes));
  return {
    format: PRIVATE_ENVELOPE_FORMAT,
    purpose,
    compression: packed.format,
    encryption: 'AES-GCM-256',
    iv: base64UrlEncode(iv),
    cipher: base64UrlEncode(cipher)
  };
}

export async function openPrivateJson(envelope, secret, expectedPurpose = '') {
  if (!envelope || envelope.format !== PRIVATE_ENVELOPE_FORMAT) return envelope;
  if (!crypto?.subtle || !secret) throw new Error('当前环境无法解密私有字段');
  if (expectedPurpose && envelope.purpose !== expectedPurpose) throw new Error('私有字段用途校验失败');
  const key = await keyFromSecret(secret, ['decrypt']);
  const additionalData = encoder.encode(`LuckyBean:${envelope.purpose}:${PRIVATE_ENVELOPE_FORMAT}`);
  const plain = new Uint8Array(await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: base64UrlDecode(envelope.iv),
    additionalData
  }, key, base64UrlDecode(envelope.cipher)));
  return JSON.parse(decoder.decode(await decompress(plain, envelope.compression)));
}
