import { getSetting, setSetting } from './db.js';
import {
  SYNC_FORMAT, CHUNK_FORMAT, SYNC_SCHEMA_VERSION, KDF_ITERATIONS,
  buildLogicalPackets, encodePacket, decodePacket, compressBytes, decompressBytes, restorePackets
} from './v099f-cloud-codec.js';

if (!globalThis.__LuckyBeanV099fCloudSyncLoaded) {
  globalThis.__LuckyBeanV099fCloudSyncLoaded = true;

  const SUPABASE_URL = 'https://vaxwncdcuvbpvdbbketb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_MsB0RFoxxf5zJbbT9PPBjQ_WP7GBMMn';
  const SESSION_KEY = 'luckybean.supabase.session.v099d';
  const ENABLE_KEY = 'cloud.sync.enabled.v2';
  const MODE_KEY = 'cloud.sync.mode.v2';
  const DEVICE_KEY = 'cloud.device.id.v2';
  const LAST_KEY = 'cloud.sync.last.v2';
  const PASSPHRASE_KEY = 'luckybean.cloud.passphrase.v2';
  const enc = new TextEncoder();
  let busy = false;
  let autoTimer = null;
  let injectQueued = false;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const randomBytes = length => crypto.getRandomValues(new Uint8Array(length));
  const bytesToB64 = bytes => {
    let binary = '';
    const size = 0x8000;
    for (let index = 0; index < bytes.length; index += size) binary += String.fromCharCode(...bytes.subarray(index, index + size));
    return btoa(binary);
  };
  const b64ToBytes = value => Uint8Array.from(atob(String(value || '')), char => char.charCodeAt(0));
  const bytesToB64Url = bytes => bytesToB64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

  function toast(message, kind = '') {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.className = `toast show ${kind}`;
    setTimeout(() => { node.className = 'toast'; }, 3000);
  }

  function authSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!value?.access_token || !value?.user?.id) return null;
      return value;
    } catch { return null; }
  }

  async function deviceId() {
    let id = await getSetting(DEVICE_KEY, '');
    if (!id) {
      id = crypto.randomUUID();
      await setSetting(DEVICE_KEY, id);
    }
    return id;
  }

  async function digest(bytes) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  }
  async function digestB64(bytes) {
    return bytesToB64(await digest(bytes));
  }
  async function chunkId(logicalKey) {
    return bytesToB64Url(await digest(enc.encode(logicalKey))).slice(0, 32);
  }

  async function deriveMasterKey(password, salt, iterations = KDF_ITERATIONS) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function request(path, options = {}) {
    const active = authSession();
    if (!active) throw new Error('请先登录并完成邮箱激活');
    const response = await fetch(`${SUPABASE_URL}${path}`, {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${active.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) throw new Error(body?.message || body?.error_description || body?.hint || `云端请求失败 HTTP ${response.status}`);
    return body;
  }

  function sessionPassphrase() {
    return sessionStorage.getItem(PASSPHRASE_KEY) || '';
  }
  function setSessionPassphrase(value) {
    if (value) sessionStorage.setItem(PASSPHRASE_KEY, value);
    else sessionStorage.removeItem(PASSPHRASE_KEY);
  }
  function promptPassphrase(message = '输入云端数据密码（至少8位）。密码只在本次浏览器会话中保留，不上传服务器。') {
    const current = sessionPassphrase();
    if (current) return current;
    const value = prompt(message) || '';
    if (value.length < 8) throw new Error('云端数据密码至少8位');
    setSessionPassphrase(value);
    return value;
  }

  async function remoteManifest(userId) {
    const rows = await request(`/rest/v1/luckybean_sync_manifests?user_id=eq.${encodeURIComponent(userId)}&select=*`, { method: 'GET' });
    return rows?.[0] || null;
  }

  async function encryptPacket(packetInfo, key, userId, device, now) {
    const plain = encodePacket(packetInfo.packet);
    const compressed = await compressBytes(plain);
    const id = await chunkId(packetInfo.logicalKey);
    const iv = randomBytes(12);
    const aad = enc.encode(`${CHUNK_FORMAT}|${userId}|${id}`);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, compressed.bytes));
    return {
      meta: {
        chunk_id: id,
        content_hash: await digestB64(plain),
        logical_hash: await digestB64(enc.encode(packetInfo.logicalKey)),
        plain_bytes: plain.byteLength,
        compressed_bytes: compressed.bytes.byteLength,
        cipher_bytes: cipher.byteLength,
        client_updated_at: now
      },
      row: {
        user_id: userId,
        chunk_id: id,
        format: CHUNK_FORMAT,
        schema_version: SYNC_SCHEMA_VERSION,
        compression: compressed.algorithm,
        cipher: 'AES-GCM-256',
        iv: bytesToB64(iv),
        payload: bytesToB64(cipher),
        content_hash: await digestB64(plain),
        plain_bytes: plain.byteLength,
        compressed_bytes: compressed.bytes.byteLength,
        cipher_bytes: cipher.byteLength,
        source_device_id: device,
        client_updated_at: now,
        uploaded_at: now
      }
    };
  }

  async function decryptChunk(row, key, userId) {
    if (row?.format !== CHUNK_FORMAT || Number(row?.schema_version) !== SYNC_SCHEMA_VERSION) throw new Error('云端分包版本不兼容');
    const aad = enc.encode(`${CHUNK_FORMAT}|${userId}|${row.chunk_id}`);
    const packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(row.iv), additionalData: aad }, key, b64ToBytes(row.payload)));
    const plain = await decompressBytes(packed, row.compression);
    if (await digestB64(plain) !== row.content_hash) throw new Error(`分包 ${row.chunk_id} 完整性校验失败`);
    return decodePacket(plain);
  }

  async function uploadSync({ interactive = true } = {}) {
    const active = authSession();
    if (!active) throw new Error('云端同步必须先登录并激活账号');
    const enabled = await getSetting(ENABLE_KEY, false);
    if (!enabled && !interactive) return { skipped: true, reason: 'disabled' };
    let password = sessionPassphrase();
    if (!password && interactive) password = promptPassphrase();
    if (!password) return { skipped: true, reason: 'locked' };

    const built = await buildLogicalPackets();
    const existing = await remoteManifest(active.user.id);
    const salt = existing?.kdf_salt ? b64ToBytes(existing.kdf_salt) : randomBytes(16);
    const iterations = Number(existing?.kdf_iterations || KDF_ITERATIONS);
    const key = await deriveMasterKey(password, salt, iterations);
    const device = await deviceId();
    const now = new Date().toISOString();
    const remoteChunks = new Map((existing?.chunks || []).map(item => [item.chunk_id, item]));
    const nextChunks = [];
    const changedRows = [];

    for (const packetInfo of built.packets) {
      const plain = encodePacket(packetInfo.packet);
      const id = await chunkId(packetInfo.logicalKey);
      const contentHash = await digestB64(plain);
      const previous = remoteChunks.get(id);
      if (previous?.content_hash === contentHash) {
        nextChunks.push({ ...previous, logical_hash: await digestB64(enc.encode(packetInfo.logicalKey)) });
        continue;
      }
      const sealed = await encryptPacket(packetInfo, key, active.user.id, device, now);
      changedRows.push(sealed.row);
      nextChunks.push(sealed.meta);
    }

    for (const row of changedRows) {
      await request('/rest/v1/luckybean_sync_chunks?on_conflict=user_id,chunk_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row)
      });
    }

    const activeIds = new Set(nextChunks.map(item => item.chunk_id));
    const stale = [...remoteChunks.keys()].filter(id => !activeIds.has(id));
    for (const id of stale) {
      await request(`/rest/v1/luckybean_sync_chunks?user_id=eq.${encodeURIComponent(active.user.id)}&chunk_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    }

    const manifest = {
      user_id: active.user.id,
      format: SYNC_FORMAT,
      schema_version: SYNC_SCHEMA_VERSION,
      codebook_version: built.codebookVersion,
      kdf: 'PBKDF2-SHA256',
      kdf_iterations: iterations,
      kdf_salt: bytesToB64(salt),
      chunks: nextChunks,
      source_device_id: device,
      client_updated_at: now,
      uploaded_at: now
    };
    await request('/rest/v1/luckybean_sync_manifests?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(manifest)
    });
    await setSetting(LAST_KEY, { at: now, changed: changedRows.length, deleted: stale.length, packets: nextChunks.length, counts: built.counts, uploadedBytes: changedRows.reduce((sum, row) => sum + Number(row.cipher_bytes || 0), 0) });
    return { changed: changedRows.length, deleted: stale.length, packets: nextChunks.length, counts: built.counts, uploadedBytes: changedRows.reduce((sum, row) => sum + Number(row.cipher_bytes || 0), 0) };
  }

  async function downloadSync({ interactive = true } = {}) {
    const active = authSession();
    if (!active) throw new Error('请先登录并完成邮箱激活');
    const manifest = await remoteManifest(active.user.id);
    if (!manifest) throw new Error('云端没有可恢复的增量数据');
    let password = sessionPassphrase();
    if (!password && interactive) password = promptPassphrase('输入云端数据密码以下载、解密并合并到本地。');
    if (!password) throw new Error('云端数据尚未解锁');
    const key = await deriveMasterKey(password, b64ToBytes(manifest.kdf_salt), Number(manifest.kdf_iterations || KDF_ITERATIONS));
    const chunks = manifest.chunks || [];
    const packets = [];
    for (const meta of chunks) {
      const rows = await request(`/rest/v1/luckybean_sync_chunks?user_id=eq.${encodeURIComponent(active.user.id)}&chunk_id=eq.${encodeURIComponent(meta.chunk_id)}&select=*`, { method: 'GET' });
      if (!rows?.[0]) throw new Error(`云端缺少分包 ${meta.chunk_id}`);
      packets.push(await decryptChunk(rows[0], key, active.user.id));
    }
    const restored = await restorePackets(packets);
    await setSetting('cloud.sync.last.download.v2', { at: new Date().toISOString(), packets: packets.length, restored });
    return { packets: packets.length, restored };
  }

  function syncPanelHtml({ active, enabled, mode, last }) {
    const lastText = last?.at ? `${new Date(last.at).toLocaleString('zh-CN')} · ${last.changed || 0}个变更分包 · ${last.uploadedBytes || 0} B` : '尚未同步';
    return `<section class="v099f-account-sync" data-v099f-account-sync>
      <div class="v099f-account-status"><span>账号状态</span><strong>${active ? `已登录 ${active.user.email || ''}` : '未登录'}</strong></div>
      <div class="v099f-account-actions">
        <button type="button" class="button" data-v099f-login>登录</button>
        <button type="button" class="button" data-v099f-register>注册</button>
        <button type="button" class="button subtle" data-v099f-unlock ${active ? '' : 'disabled'}>${sessionPassphrase() ? '本次会话已解锁' : '解锁云端密码'}</button>
      </div>
      <div class="v099f-storage-config">
        <label class="toggle"><input type="checkbox" data-v099f-cloud-enabled ${enabled ? 'checked' : ''}>上传并同步云端</label>
        <div class="v099f-sync-mode" role="radiogroup" aria-label="同步方式">
          <label><input type="radio" name="v099fSyncMode" value="manual" ${mode !== 'auto' ? 'checked' : ''}>手动同步</label>
          <label><input type="radio" name="v099fSyncMode" value="auto" ${mode === 'auto' ? 'checked' : ''}>自动同步</label>
        </div>
        <p class="muted small">数据始终先保存在本地。开启云端后，按豆卡和月份分包，编码去重、GZIP压缩并在本机AES-GCM加密后上传。自动同步仅在账号已登录且本次会话已解锁时执行。</p>
        <div class="v099f-sync-actions">
          <button type="button" class="button primary" data-v099f-sync-now ${active ? '' : 'disabled'}>立即同步</button>
          <button type="button" class="button" data-v099f-download ${active ? '' : 'disabled'}>下载并合并</button>
          <button type="button" class="button" data-v099f-storage-confirm>确定</button>
        </div>
        <output class="muted small" data-v099f-sync-status>上次同步：${lastText}</output>
      </div>
    </section>`;
  }

  function findAccountDetails(root) {
    return $$('.settings-category', root).find(section => /账户|账号/.test(section.querySelector('summary')?.textContent || '')) || null;
  }

  async function injectPanel() {
    injectQueued = false;
    const root = $('#settingsContent');
    if (!root) return;
    $$('.v099e-cloud-panel,[data-v099e-cloud-panel]', root).forEach(node => node.remove());
    const account = findAccountDetails(root);
    if (!account) return;
    const summaryLabel = account.querySelector('summary span');
    if (summaryLabel) summaryLabel.textContent = '账号';
    const body = $('.settings-category-body', account);
    if (!body) return;
    const existing = $$('[data-v099f-account-sync]', body);
    existing.slice(1).forEach(node => node.remove());
    if (existing[0]) return;
    const [enabled, mode, last] = await Promise.all([getSetting(ENABLE_KEY, false), getSetting(MODE_KEY, 'manual'), getSetting(LAST_KEY, null)]);
    body.insertAdjacentHTML('beforeend', syncPanelHtml({ active: authSession(), enabled, mode, last }));
    bindPanel(account);
  }

  function queueInject() {
    if (injectQueued) return;
    injectQueued = true;
    requestAnimationFrame(() => requestAnimationFrame(injectPanel));
  }

  function bindPanel(account) {
    const panel = $('[data-v099f-account-sync]', account);
    if (!panel || panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';
    $('[data-v099f-login]', panel)?.addEventListener('click', () => $('#emailIdentityBtn')?.click());
    $('[data-v099f-register]', panel)?.addEventListener('click', () => $('#wechatIdentityBtn')?.click());
    $('[data-v099f-unlock]', panel)?.addEventListener('click', event => {
      try {
        promptPassphrase();
        event.currentTarget.textContent = '本次会话已解锁';
        toast('云端数据密码已在本次会话中解锁', 'status-good');
      } catch (error) { toast(error.message, 'status-bad'); }
    });
    const run = async action => {
      if (busy) return;
      busy = true;
      const status = $('[data-v099f-sync-status]', panel);
      try {
        status.textContent = action === uploadSync ? '正在编码、分包、压缩、加密并增量上传…' : '正在下载、校验、解密并合并…';
        const result = await action({ interactive: true });
        if (action === uploadSync) {
          status.textContent = `同步完成：${result.changed}个变更分包，${result.deleted}个旧分包，上传密文${result.uploadedBytes} B`;
          toast('云端增量同步完成', 'status-good');
        } else {
          status.textContent = `恢复完成：${result.packets}个分包；豆卡${result.restored.beans}、冲煮${result.restored.brews}、品鉴${result.restored.sensory}`;
          toast('云端数据已合并到本地，页面即将刷新', 'status-good');
          setTimeout(() => location.reload(), 800);
        }
      } catch (error) {
        status.textContent = error.message;
        toast(error.message, 'status-bad');
      } finally { busy = false; }
    };
    $('[data-v099f-sync-now]', panel)?.addEventListener('click', () => run(uploadSync));
    $('[data-v099f-download]', panel)?.addEventListener('click', () => run(downloadSync));
    $('[data-v099f-storage-confirm]', panel)?.addEventListener('click', async () => {
      const enabled = $('[data-v099f-cloud-enabled]', panel)?.checked || false;
      const mode = $('input[name="v099fSyncMode"]:checked', panel)?.value || 'manual';
      if (enabled && !authSession()) return toast('开启云端同步前必须登录并激活账号', 'status-bad');
      await Promise.all([setSetting(ENABLE_KEY, enabled), setSetting(MODE_KEY, mode)]);
      if (enabled && mode === 'auto' && !sessionPassphrase()) {
        try { promptPassphrase(); } catch (error) { return toast(error.message, 'status-bad'); }
      }
      configureAutoSync(enabled, mode);
      account.open = false;
      toast(enabled ? `已设为${mode === 'auto' ? '自动' : '手动'}云端同步` : '已设为仅本地储存', 'status-good');
    });
  }

  function configureAutoSync(enabled, mode) {
    clearInterval(autoTimer);
    autoTimer = null;
    if (!enabled || mode !== 'auto') return;
    autoTimer = setInterval(() => uploadSync({ interactive: false }).catch(() => {}), 15 * 60 * 1000);
  }

  async function initializeAutoSync() {
    const [enabled, mode] = await Promise.all([getSetting(ENABLE_KEY, false), getSetting(MODE_KEY, 'manual')]);
    configureAutoSync(enabled, mode);
    if (enabled && mode === 'auto' && sessionPassphrase() && authSession()) setTimeout(() => uploadSync({ interactive: false }).catch(() => {}), 3500);
  }

  const settingsObserver = new MutationObserver(queueInject);
  settingsObserver.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-page-target="settings"]')) setTimeout(queueInject, 30);
  });
  window.addEventListener('online', async () => {
    if (await getSetting(ENABLE_KEY, false) && await getSetting(MODE_KEY, 'manual') === 'auto') uploadSync({ interactive: false }).catch(() => {});
  });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden' && await getSetting(ENABLE_KEY, false) && await getSetting(MODE_KEY, 'manual') === 'auto') uploadSync({ interactive: false }).catch(() => {});
  });

  queueInject();
  initializeAutoSync();
  globalThis.LuckyBeanCloudSyncV2 = { upload: uploadSync, download: downloadSync, unlock: promptPassphrase, lock: () => setSessionPassphrase('') };
}
