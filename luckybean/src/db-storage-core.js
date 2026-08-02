import { SCHEMA_VERSION, assertPlainObject } from './utils.js';
import { SENSORY_STORAGE_FORMAT, sealSensoryRecord, openSensoryRecord } from './sensory-codec-v096.js';

const DB_NAME = 'luckybean';
const LEGACY_DB_NAME = 'coffee_cellar_local_mvp_v1';
const STORES = ['beans', 'brewSessions', 'sensoryRecords', 'inventoryEvents', 'settings', 'customCodes', 'codebookCache', 'syncMetadata', 'shareDrafts'];
const SENSORY_KEY_ID = 'local.sensory.key.v1';
let dbPromise;
let sensorySecretPromise;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'));
  });
}

function keyPathForStore(name) {
  if (['settings', 'codebookCache', 'syncMetadata'].includes(name)) return 'id';
  if (name === 'customCodes') return 'code';
  return 'id';
}

function createMissingStores(db) {
  for (const name of STORES) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: keyPathForStore(name) });
  }
}

function missingStores(db) {
  return STORES.filter(name => !db.objectStoreNames.contains(name));
}

function attachVersionChangeHandler(db) {
  db.onversionchange = () => db.close();
  return db;
}

function openDatabase(version) {
  return new Promise((resolve, reject) => {
    const request = version == null ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => createMissingStores(request.result);
    request.onsuccess = () => resolve(attachVersionChangeHandler(request.result));
    request.onerror = () => reject(request.error || new Error('数据库打开失败'));
    request.onblocked = () => reject(new Error('数据库升级被其他页面占用，请关闭其他富贵盒子页面后重试'));
  });
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    if (!globalThis.indexedDB) throw new Error('当前浏览器不支持 IndexedDB');
    const current = await openDatabase();
    const missing = missingStores(current);
    if (current.version >= SCHEMA_VERSION && missing.length === 0) return current;
    const targetVersion = Math.max(SCHEMA_VERSION, current.version + (missing.length ? 1 : 0));
    current.close();
    return openDatabase(targetVersion);
  })().catch(error => {
    dbPromise = undefined;
    throw error;
  });
  return dbPromise;
}

async function store(name, mode = 'readonly') {
  if (!STORES.includes(name)) throw new Error(`未知数据表：${name}`);
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(String(value || '')), char => char.charCodeAt(0));
}

async function ensureSensorySecret() {
  if (sensorySecretPromise) return sensorySecretPromise;
  sensorySecretPromise = (async () => {
    if (!crypto?.getRandomValues) return null;
    const objectStore = await store('syncMetadata', 'readwrite');
    const existing = await requestToPromise(objectStore.get(SENSORY_KEY_ID));
    if (existing?.secret) return base64ToBytes(existing.secret);
    const secret = crypto.getRandomValues(new Uint8Array(32));
    await requestToPromise(objectStore.put({
      id: SENSORY_KEY_ID,
      secret: bytesToBase64(secret),
      algorithm: 'AES-GCM-256',
      scope: 'local-device',
      createdAt: new Date().toISOString()
    }));
    return secret;
  })().catch(error => {
    sensorySecretPromise = undefined;
    console.warn('品鉴记录本地密钥初始化失败，回退为仅压缩存储', error);
    return null;
  });
  return sensorySecretPromise;
}

async function transformForWrite(name, value) {
  if (name !== 'sensoryRecords' || value?.storageFormat === SENSORY_STORAGE_FORMAT) return structuredClone(value);
  const secret = await ensureSensorySecret();
  return sealSensoryRecord(value, secret);
}

async function transformForRead(name, value) {
  if (name !== 'sensoryRecords' || !value || value.storageFormat !== SENSORY_STORAGE_FORMAT) return value;
  try {
    return await openSensoryRecord(value, await ensureSensorySecret());
  } catch (error) {
    console.error('品鉴记录解密失败', error);
    return {
      id: value.id,
      beanId: value.beanId,
      brewSessionId: value.brewSessionId || '',
      createdAt: value.createdAt || '',
      updatedAt: value.updatedAt || value.createdAt || '',
      answers: {},
      summary: ['记录解密失败'],
      naturalNote: '',
      autoScore: 0,
      subjectiveScore: 0,
      score: 0,
      scoreDelta: 0,
      storageError: error.message
    };
  }
}

export async function all(name) {
  const values = await requestToPromise((await store(name)).getAll());
  if (name !== 'sensoryRecords') return values;
  return Promise.all(values.map(value => transformForRead(name, value)));
}

export async function get(name, key) {
  return transformForRead(name, await requestToPromise((await store(name)).get(key)));
}

export async function put(name, value) {
  assertPlainObject(value, name);
  const prepared = await transformForWrite(name, value);
  return requestToPromise((await store(name, 'readwrite')).put(prepared));
}

export async function remove(name, key) { return requestToPromise((await store(name, 'readwrite')).delete(key)); }
export async function clear(name) { return requestToPromise((await store(name, 'readwrite')).clear()); }

export async function bulkPut(name, values) {
  if (!Array.isArray(values)) throw new Error('批量写入数据必须是数组');
  const prepared = await Promise.all(values.map(value => transformForWrite(name, value)));
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const objectStore = tx.objectStore(name);
    prepared.forEach(value => objectStore.put(structuredClone(value)));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('批量写入失败'));
    tx.onabort = () => reject(tx.error || new Error('批量写入中止'));
  });
}

export async function activateCodebook(candidate) {
  assertPlainObject(candidate, '编码表候选');
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('codebookCache', 'readwrite');
    const objectStore = tx.objectStore('codebookCache');
    objectStore.put(structuredClone({ ...candidate, id: 'candidate' }));
    objectStore.put(structuredClone({ ...candidate, id: 'active' }));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('编码表原子替换失败'));
    tx.onabort = () => reject(tx.error || new Error('编码表原子替换中止'));
  });
}

export async function getSetting(id, fallback = null) {
  const value = await get('settings', id);
  return value?.value ?? fallback;
}

export async function setSetting(id, value) { return put('settings', { id, value, updatedAt: new Date().toISOString() }); }

export async function clearAll() {
  const db = await openDb();
  await Promise.all(STORES.map(name => new Promise((resolve, reject) => {
    const request = db.transaction(name, 'readwrite').objectStore(name).clear();
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  })));
  sensorySecretPromise = undefined;
}

export async function migrateLegacy() {
  const done = await getSetting('migration.legacy.v1', false);
  if (done) return { migrated: false, reason: 'already-done' };

  const legacyExists = await new Promise(resolve => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    let created = false;
    request.onupgradeneeded = () => { created = true; request.transaction.abort(); };
    request.onsuccess = () => { request.result.close(); resolve(!created); };
    request.onerror = () => resolve(false);
  });
  if (!legacyExists) {
    await setSetting('migration.legacy.v1', true);
    return { migrated: false, reason: 'not-found' };
  }

  const legacy = await new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const read = name => new Promise(resolve => {
    if (!legacy.objectStoreNames.contains(name)) return resolve([]);
    const request = legacy.transaction(name).objectStore(name).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });
  const [beans, records, customCodes, settings] = await Promise.all(['beans', 'records', 'customCodes', 'settings'].map(read));
  legacy.close();

  await put('syncMetadata', {
    id: 'migration.legacy.backup.v1',
    capturedAt: new Date().toISOString(),
    sourceDatabase: LEGACY_DB_NAME,
    data: { beans, records, customCodes, settings }
  });

  const migratedBeans = beans.map(bean => ({
    ...bean,
    id: bean.id,
    name: bean.name || bean.beanName || '未命名豆卡',
    initialWeight: Number(bean.initialWeight ?? bean.startWeight ?? bean.remainingWeight ?? 0),
    remainingWeight: Number(bean.remainingWeight ?? bean.initialWeight ?? bean.startWeight ?? 0),
    flavorCodes: Array.isArray(bean.flavorCodes) ? bean.flavorCodes : [],
    legacyCode: bean.legacyCode || null,
    updatedAt: bean.updatedAt || new Date().toISOString()
  }));
  if (migratedBeans.length) await bulkPut('beans', migratedBeans);
  if (records.length) await bulkPut('sensoryRecords', records.map(record => ({ ...record, id: record.id, migratedFrom: 'records' })));
  if (customCodes.length) await bulkPut('customCodes', customCodes);
  for (const item of settings) if (item?.id) await put('settings', item);
  await setSetting('migration.legacy.v1', true);
  return { migrated: true, beans: migratedBeans.length, records: records.length, customCodes: customCodes.length };
}
