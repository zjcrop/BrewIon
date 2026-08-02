import * as core from './db-storage-core.js';
import { sealPrivateJson, openPrivateJson, PRIVATE_ENVELOPE_FORMAT } from './privacy-codec-v096.js';

export * from './db-storage-core.js';

const PRIVACY_KEY_ID = 'local.privacy.key.v1';
let privacySecretPromise;

function bytesToBase64(bytes) {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(String(value || '')), char => char.charCodeAt(0));
}

async function privacySecret() {
  if (privacySecretPromise) return privacySecretPromise;
  privacySecretPromise = (async () => {
    if (!crypto?.getRandomValues) return null;
    const existing = await core.get('syncMetadata', PRIVACY_KEY_ID);
    if (existing?.secret) return base64ToBytes(existing.secret);
    const secret = crypto.getRandomValues(new Uint8Array(32));
    await core.put('syncMetadata', {
      id: PRIVACY_KEY_ID,
      secret: bytesToBase64(secret),
      algorithm: 'AES-GCM-256',
      scope: 'local-device',
      createdAt: new Date().toISOString()
    });
    return secret;
  })().catch(error => {
    privacySecretPromise = undefined;
    console.warn('私有设置密钥初始化失败', error);
    return null;
  });
  return privacySecretPromise;
}

async function prepareWrite(name, original) {
  const value = structuredClone(original);
  if (name === 'brewSessions') {
    delete value.sensoryNote;
    delete value.userId;
    delete value.publicId;
    return value;
  }
  if (name !== 'settings' || value?.id !== 'app.settings' || !value.value?.identity) return value;
  const identity = structuredClone(value.value.identity);
  const secret = await privacySecret();
  if (!secret) {
    delete value.value.identity.publicId;
    delete value.value.identity.idSalt;
    delete value.value.identity.email;
    delete value.value.identity.phone;
    delete value.value.identity.wechat;
    delete value.value.identity.qq;
    value.value.identity.protected = false;
    return value;
  }
  value.privateIdentity = await sealPrivateJson(identity, secret, 'identity');
  value.value.identity = {
    mode: identity.mode || 'guest',
    nickname: '本地用户',
    publicId: '',
    verified: Boolean(identity.verified),
    protected: true,
    hasIdentity: Boolean(identity.publicId)
  };
  return value;
}

async function restoreRead(name, original) {
  if (!original || name !== 'settings' || original.id !== 'app.settings' || original.privateIdentity?.format !== PRIVATE_ENVELOPE_FORMAT) return original;
  const value = structuredClone(original);
  try {
    value.value.identity = await openPrivateJson(value.privateIdentity, await privacySecret(), 'identity');
  } catch (error) {
    console.error('登录身份解密失败', error);
    value.value.identity = {
      mode: value.value.identity?.mode || 'guest',
      nickname: '本地用户',
      publicId: '',
      verified: false,
      protected: true,
      decryptionError: error.message
    };
  }
  return value;
}

export async function get(name, key) {
  return restoreRead(name, await core.get(name, key));
}

export async function all(name) {
  const values = await core.all(name);
  if (name !== 'settings') return values;
  return Promise.all(values.map(value => restoreRead(name, value)));
}

export async function put(name, value) {
  return core.put(name, await prepareWrite(name, value));
}

export async function bulkPut(name, values) {
  if (!Array.isArray(values)) throw new Error('批量写入数据必须是数组');
  return core.bulkPut(name, await Promise.all(values.map(value => prepareWrite(name, value))));
}

export async function getSetting(id, fallback = null) {
  const value = await get('settings', id);
  return value?.value ?? fallback;
}

export async function setSetting(id, value) {
  return put('settings', { id, value, updatedAt: new Date().toISOString() });
}

export async function clearAll() {
  privacySecretPromise = undefined;
  return core.clearAll();
}
