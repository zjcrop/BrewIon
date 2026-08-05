import { get, put, getSetting, setSetting } from '../db.js';
import {
  SYNC_FORMAT, CHUNK_FORMAT, SYNC_SCHEMA_VERSION,
  buildLogicalPackets, encodePacket, decodePacket, compressBytes, decompressBytes, restorePackets
} from '../cloud-codec.js';

const ENABLE_KEY = 'cloud.sync.enabled.v3';
const STATE_ID = 'cloud.sync.state.v3';
const DEVICE_ID = 'cloud.device.id.v3';
const DIRTY_KEY = 'luckybean.cloud.dirty.v3';
const DEBOUNCE_MS = 8000;
const enc = new TextEncoder();
let timer = null;
let busy = false;
let pendingRun = false;

const auth = () => globalThis.LuckyBeanCloudAuth;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function emit(state, detail = {}) {
  document.documentElement.dataset.cloudSync = state;
  document.dispatchEvent(new CustomEvent('luckybean:cloud-sync-state', { detail: { state, ...detail } }));
}

function readDirty() {
  try { return JSON.parse(localStorage.getItem(DIRTY_KEY) || 'null'); }
  catch { return null; }
}

function clearDirty() { localStorage.removeItem(DIRTY_KEY); }

async function enabled() {
  return (await getSetting(ENABLE_KEY, true)) !== false;
}

async function setEnabled(value) {
  await setSetting(ENABLE_KEY, Boolean(value));
  if (value) scheduleSync(500, 'enabled');
  else clearTimeout(timer);
  emit(value ? 'idle' : 'disabled');
}

async function deviceId() {
  const record = await get('syncMetadata', DEVICE_ID);
  if (record?.value) return record.value;
  const value = crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  await put('syncMetadata', { id: DEVICE_ID, value, createdAt: new Date().toISOString() });
  return value;
}

async function stateRecord() {
  return (await get('syncMetadata', STATE_ID)) || { id: STATE_ID, lastRemoteRevision: '', lastSuccessfulSyncAt: '', lastStatus: 'never' };
}

async function saveState(patch) {
  const current = await stateRecord();
  const next = { ...current, ...patch, id: STATE_ID, updatedAt: new Date().toISOString() };
  await put('syncMetadata', next);
  return next;
}

function bytesToB64(bytes) {
  let binary = '';
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) binary += String.fromCharCode(...bytes.subarray(index, index + size));
  return btoa(binary);
}

function b64ToBytes(value) {
  return Uint8Array.from(atob(String(value || '')), char => char.charCodeAt(0));
}

function b64Url(bytes) {
  return bytesToB64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function digest(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

async function digestB64(bytes) { return bytesToB64(await digest(bytes)); }
async function chunkId(logicalKey) { return b64Url(await digest(enc.encode(logicalKey))).slice(0, 32); }

async function remoteManifest(userId) {
  const rows = await auth().apiRequest(`/rest/v1/luckybean_sync_manifests?user_id=eq.${encodeURIComponent(userId)}&select=*`, { method: 'GET', timeoutMs: 6000 });
  return rows?.[0] || null;
}

async function upload({ reason = 'auto', forceMigration = false } = {}) {
  const active = auth()?.getSession?.();
  if (!active?.user?.id) throw new Error('请先登录云端账号');
  const userId = active.user.id;
  const existing = await remoteManifest(userId);
  const localState = await stateRecord();
  const device = await deviceId();
  const remoteRevision = String(existing?.client_updated_at || '');
  const remoteChangedElsewhere = Boolean(
    existing && localState.lastRemoteRevision && remoteRevision !== localState.lastRemoteRevision && existing.source_device_id !== device
  );
  if (remoteChangedElsewhere && !forceMigration) {
    await saveState({ lastStatus: 'conflict', conflictRemoteRevision: remoteRevision });
    emit('conflict', { message: '云端存在其他设备的新数据，已停止自动覆盖' });
    return { conflict: true };
  }

  emit('syncing', { reason });
  const built = await buildLogicalPackets();
  const remoteChunks = new Map((existing?.chunks || []).map(item => [item.chunk_id, item]));
  const nextChunks = [];
  const changedRows = [];
  const now = new Date().toISOString();

  for (const packetInfo of built.packets) {
    const plain = encodePacket(packetInfo.packet);
    const id = await chunkId(packetInfo.logicalKey);
    const contentHash = await digestB64(plain);
    const previous = remoteChunks.get(id);
    const plainCompatible = previous?.cipher === 'none' || previous?.transport === 'plain-compressed-v1';
    if (previous?.content_hash === contentHash && plainCompatible && !forceMigration) {
      nextChunks.push(previous);
      continue;
    }
    const compressed = await compressBytes(plain);
    const row = {
      user_id: userId,
      chunk_id: id,
      format: CHUNK_FORMAT,
      schema_version: SYNC_SCHEMA_VERSION,
      compression: compressed.algorithm,
      cipher: 'none',
      iv: '',
      payload: bytesToB64(compressed.bytes),
      content_hash: contentHash,
      plain_bytes: plain.byteLength,
      compressed_bytes: compressed.bytes.byteLength,
      cipher_bytes: compressed.bytes.byteLength,
      source_device_id: device,
      client_updated_at: now,
      uploaded_at: now
    };
    changedRows.push(row);
    nextChunks.push({
      chunk_id: id,
      content_hash: contentHash,
      logical_hash: await digestB64(enc.encode(packetInfo.logicalKey)),
      plain_bytes: plain.byteLength,
      compressed_bytes: compressed.bytes.byteLength,
      cipher_bytes: compressed.bytes.byteLength,
      cipher: 'none',
      transport: 'plain-compressed-v1',
      client_updated_at: now
    });
    await sleep(0);
  }

  if (changedRows.length) {
    await auth().apiRequest('/rest/v1/luckybean_sync_chunks?on_conflict=user_id,chunk_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: changedRows,
      timeoutMs: 12000
    });
  }

  const activeIds = new Set(nextChunks.map(item => item.chunk_id));
  const stale = [...remoteChunks.keys()].filter(id => !activeIds.has(id));
  for (const id of stale) {
    await auth().apiRequest(`/rest/v1/luckybean_sync_chunks?user_id=eq.${encodeURIComponent(userId)}&chunk_id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { Prefer: 'return=minimal' }, timeoutMs: 6000
    });
  }

  const manifest = {
    user_id: userId,
    format: SYNC_FORMAT,
    schema_version: SYNC_SCHEMA_VERSION,
    codebook_version: built.codebookVersion,
    kdf: 'none',
    kdf_iterations: 0,
    kdf_salt: '',
    chunks: nextChunks,
    source_device_id: device,
    client_updated_at: now,
    uploaded_at: now
  };
  await auth().apiRequest('/rest/v1/luckybean_sync_manifests?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: manifest,
    timeoutMs: 10000
  });

  clearDirty();
  await saveState({
    lastRemoteRevision: now,
    lastSuccessfulSyncAt: now,
    lastStatus: 'synced',
    changedPackets: changedRows.length,
    deletedPackets: stale.length,
    packetCount: nextChunks.length,
    uploadedBytes: changedRows.reduce((sum, row) => sum + Number(row.compressed_bytes || 0), 0)
  });
  emit('synced', { changed: changedRows.length, deleted: stale.length, packetCount: nextChunks.length });
  return { changed: changedRows.length, deleted: stale.length, packetCount: nextChunks.length };
}

async function download(manifest, { interactive = false } = {}) {
  const active = auth()?.getSession?.();
  if (!active?.user?.id || !manifest) return { skipped: true };
  emit('downloading');
  const rows = await auth().apiRequest(`/rest/v1/luckybean_sync_chunks?user_id=eq.${encodeURIComponent(active.user.id)}&select=*`, {
    method: 'GET', timeoutMs: 10000
  });
  const byId = new Map((rows || []).map(row => [row.chunk_id, row]));
  const packets = [];
  for (const meta of manifest.chunks || []) {
    const row = byId.get(meta.chunk_id);
    if (!row) throw new Error(`云端缺少分包 ${meta.chunk_id}`);
    if (row.cipher && row.cipher !== 'none') {
      const message = '检测到旧版密码加密云端数据。请在原设备产生一次新修改后自动迁移，或使用旧版本手动恢复。';
      await saveState({ lastStatus: 'legacy-encrypted', legacyEncryptedAt: new Date().toISOString() });
      emit('legacy-encrypted', { message });
      if (interactive) throw new Error(message);
      return { legacyEncrypted: true };
    }
    const packed = b64ToBytes(row.payload);
    const plain = await decompressBytes(packed, row.compression);
    if (await digestB64(plain) !== row.content_hash) throw new Error(`分包 ${row.chunk_id} 完整性校验失败`);
    packets.push(decodePacket(plain));
  }
  globalThis.__LuckyBeanCloudRestoreActive = true;
  try {
    const restored = await restorePackets(packets);
    clearDirty();
    await saveState({
      lastRemoteRevision: String(manifest.client_updated_at || ''),
      lastSuccessfulSyncAt: new Date().toISOString(),
      lastStatus: 'downloaded',
      restored
    });
    emit('downloaded', { restored });
    document.dispatchEvent(new CustomEvent('luckybean:cloud-data-restored', { detail: { restored } }));
    return { restored };
  } finally {
    globalThis.__LuckyBeanCloudRestoreActive = false;
  }
}

async function reconcile({ reason = 'startup', interactive = false, forcePull = false } = {}) {
  if (busy) {
    pendingRun = true;
    return { queued: true };
  }
  if (!(await enabled())) {
    emit('disabled');
    return { skipped: true, reason: 'disabled' };
  }
  const active = auth()?.getSession?.();
  if (!active?.user?.id) {
    emit('waiting-for-login');
    return { skipped: true, reason: 'signed-out' };
  }
  if (navigator.scheduling?.isInputPending?.()) {
    scheduleSync(1500, reason);
    return { queued: true, reason: 'input-pending' };
  }
  busy = true;
  try {
    const manifest = await remoteManifest(active.user.id);
    const localState = await stateRecord();
    const dirty = readDirty();
    const remoteRevision = String(manifest?.client_updated_at || '');
    const remoteChanged = Boolean(manifest && remoteRevision && remoteRevision !== localState.lastRemoteRevision);

    if (forcePull && manifest) return await download(manifest, { interactive: true });
    if (dirty) return await upload({ reason });
    if (remoteChanged) return await download(manifest, { interactive });

    await saveState({ lastStatus: 'idle', lastCheckedAt: new Date().toISOString(), lastRemoteRevision: remoteRevision || localState.lastRemoteRevision });
    emit('idle');
    return { idle: true };
  } catch (error) {
    await saveState({ lastStatus: 'error', lastError: error.message, lastErrorAt: new Date().toISOString() }).catch(() => {});
    emit('error', { error: error.message });
    if (interactive) throw error;
    return { error: error.message };
  } finally {
    busy = false;
    if (pendingRun) {
      pendingRun = false;
      scheduleSync(1000, 'queued-change');
    }
  }
}

function scheduleSync(delay = DEBOUNCE_MS, reason = 'local-change') {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (document.visibilityState === 'hidden') {
      scheduleSync(2000, reason);
      return;
    }
    reconcile({ reason }).catch(() => {});
  }, delay);
}

document.addEventListener('luckybean:data-changed', () => scheduleSync(DEBOUNCE_MS, 'local-change'));
document.addEventListener('luckybean:cloud-auth-state', event => {
  if (event.detail?.state === 'authenticated') scheduleSync(350, 'auth-ready');
});
document.addEventListener('luckybean:cloud-login-success', () => scheduleSync(250, 'login'));
window.addEventListener('online', () => scheduleSync(500, 'network-online'));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && readDirty()) scheduleSync(800, 'foreground');
});

globalThis.LuckyBeanCloudSync = {
  revision: 'cloud-sync-service-v1',
  reconcile,
  syncNow: () => reconcile({ reason: 'manual', interactive: true }),
  pullNow: () => reconcile({ reason: 'manual-pull', interactive: true, forcePull: true }),
  enabled,
  setEnabled,
  getState: stateRecord,
  hasPendingChanges: () => Boolean(readDirty())
};

if (readDirty()) scheduleSync(1200, 'startup-dirty');
