import { all, bulkPut, getSetting, setSetting } from './db.js';

const SNAPSHOT_FORMAT = 'luckybean-native-snapshot';
const SNAPSHOT_VERSION = 1;
const STORES = ['beans', 'brewSessions', 'sensoryRecords', 'inventoryEvents', 'customCodes', 'shareDrafts'];
const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
const encoder = new TextEncoder();
let installed = false;
let saveTimer = 0;
let saving = false;
let saveAgain = false;

function bridge() {
  const value = globalThis.LuckyBeanAndroid;
  return value && typeof value.saveBackupSnapshot === 'function' && typeof value.readBackupSnapshot === 'function'
    ? value
    : null;
}

function countRows(data = {}) {
  return Object.fromEntries(STORES.map(name => [name, Array.isArray(data[name]) ? data[name].length : 0]));
}

function hasRows(counts = {}) {
  return Object.values(counts).some(value => Number(value) > 0);
}

function sanitize(value, depth = 0) {
  if (depth > 24) return null;
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (/^data:(?:image|audio|video)\//i.test(value) && value.length > 4096) return '[binary-omitted]';
    return value.length > 200000 ? `${value.slice(0, 200000)}…[truncated]` : value;
  }
  if (Array.isArray(value)) return value.map(item => sanitize(item, depth + 1));
  if (typeof value !== 'object') return null;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:image|photo|thumbnail|blob|binary)(?:Data|Base64|Bytes)?$/i.test(key)) continue;
    output[key] = sanitize(item, depth + 1);
  }
  return output;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function collectData() {
  const values = await Promise.all(STORES.map(name => all(name).catch(() => [])));
  const data = Object.fromEntries(STORES.map((name, index) => [name, sanitize(values[index])]));
  const settings = sanitize(await getSetting('app.settings', {}));
  if (settings && typeof settings === 'object') delete settings.identity;
  data.settings = settings || {};
  return data;
}

async function buildEnvelope() {
  const data = await collectData();
  const body = {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    schemaVersion: Number(globalThis.__LUCKYBEAN_SCHEMA_VERSION || 0),
    createdAt: new Date().toISOString(),
    counts: countRows(data),
    data
  };
  const serialized = JSON.stringify(body);
  const envelope = { ...body, sha256: await sha256(serialized) };
  const output = JSON.stringify(envelope);
  if (encoder.encode(output).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('自动备份超过20MB；图片已排除，请先手工导出完整备份');
  return output;
}

async function verifyEnvelope(envelope) {
  if (!envelope || envelope.format !== SNAPSHOT_FORMAT || Number(envelope.version) !== SNAPSHOT_VERSION) {
    throw new Error('系统备份格式不兼容');
  }
  const body = { ...envelope };
  const expected = String(body.sha256 || '');
  delete body.sha256;
  const actual = await sha256(JSON.stringify(body));
  if (!expected || expected !== actual) throw new Error('系统备份哈希校验失败');
  if (!body.data || typeof body.data !== 'object') throw new Error('系统备份缺少数据');
  return body;
}

async function localCounts() {
  const values = await Promise.all(STORES.slice(0, 4).map(name => all(name).catch(() => [])));
  return Object.fromEntries(STORES.slice(0, 4).map((name, index) => [name, values[index].length]));
}

export async function restoreNativeBackupIfNeeded() {
  const native = bridge();
  if (!native) return { available: false, restored: false };
  const existing = await localCounts();
  if (hasRows(existing)) return { available: true, restored: false, reason: 'local-data-present', counts: existing };
  const raw = String(native.readBackupSnapshot() || '').trim();
  if (!raw) return { available: true, restored: false, reason: 'no-system-snapshot' };
  if (encoder.encode(raw).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('系统备份文件超过安全上限');
  const parsed = JSON.parse(raw);
  const envelope = await verifyEnvelope(parsed);
  const data = envelope.data;
  for (const name of STORES) {
    const rows = data[name];
    if (rows !== undefined && !Array.isArray(rows)) throw new Error(`${name} 备份结构无效`);
    if (Array.isArray(rows) && rows.length) await bulkPut(name, rows);
  }
  if (data.settings && typeof data.settings === 'object') {
    const current = await getSetting('app.settings', {});
    await setSetting('app.settings', {
      ...data.settings,
      identity: current?.identity || data.settings.identity || undefined
    });
  }
  return { available: true, restored: true, counts: envelope.counts || countRows(data), createdAt: envelope.createdAt };
}

export async function flushNativeBackup() {
  const native = bridge();
  if (!native) return { available: false, saved: false };
  if (saving) {
    saveAgain = true;
    return { available: true, saved: false, queued: true };
  }
  saving = true;
  try {
    const payload = await buildEnvelope();
    native.saveBackupSnapshot(payload);
    return { available: true, saved: true, bytes: encoder.encode(payload).byteLength };
  } finally {
    saving = false;
    if (saveAgain) {
      saveAgain = false;
      scheduleNativeBackup(500);
    }
  }
}

export function scheduleNativeBackup(delay = 1500) {
  if (!bridge()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushNativeBackup().catch(error => console.warn('原生自动备份失败', error)), delay);
}

export function installNativeBackupBridge() {
  if (installed || !bridge()) return false;
  installed = true;
  window.addEventListener('luckybean:data-changed', () => scheduleNativeBackup());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushNativeBackup().catch(error => console.warn('后台备份失败', error));
  });
  window.addEventListener('pagehide', () => flushNativeBackup().catch(() => {}));
  scheduleNativeBackup(800);
  return true;
}

export function nativeBackupStatus() {
  return { available: Boolean(bridge()), installed, format: SNAPSHOT_FORMAT, version: SNAPSHOT_VERSION };
}
