import { getSetting, setSetting } from '../db.js';

const SUPABASE_URL = 'https://vaxwncdcuvbpvdbbketb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_MsB0RFoxxf5zJbbT9PPBjQ_WP7GBMMn';
const SESSION_KEY = 'luckybean.supabase.session.v099d';
const REMEMBER_UNTIL_KEY = 'luckybean.cloud.remember.until.v1';
const LAST_SERVER_ACTIVITY_KEY = 'luckybean.cloud.last.server.activity.v1';
const REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCE_APP = 'luckybean';
let refreshPromise = null;
let dialogBusy = false;

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}

function writeSession(value) {
  if (value?.access_token || value?.refresh_token) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
}

function rememberUntil() {
  return Number(localStorage.getItem(REMEMBER_UNTIL_KEY) || 0);
}

function markServerActivity() {
  const now = Date.now();
  localStorage.setItem(LAST_SERVER_ACTIVITY_KEY, String(now));
  localStorage.setItem(REMEMBER_UNTIL_KEY, String(now + REMEMBER_MS));
}

function decodeJwtPayload(token) {
  try {
    const encoded = String(token || '').split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    return JSON.parse(decodeURIComponent([...atob(normalized)].map(char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')));
  } catch { return null; }
}

function accessTokenValid(active, skewSeconds = 60) {
  const exp = Number(decodeJwtPayload(active?.access_token)?.exp || 0);
  return exp > Math.floor(Date.now() / 1000) + skewSeconds;
}

function emit(state, detail = {}) {
  document.documentElement.dataset.cloudAuth = state;
  document.dispatchEvent(new CustomEvent('luckybean:cloud-auth-state', { detail: { state, ...detail } }));
}

function messageFrom(payload, fallback) {
  return payload?.msg || payload?.message || payload?.error_description || payload?.error || fallback;
}

async function rawRequest(path, { method = 'POST', body, token, timeoutMs = 6000, headers = {} } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) {
      const error = new Error(messageFrom(payload, `云端请求失败（${response.status}）`));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('云端连接超时');
      timeoutError.code = 'NETWORK_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function persistIdentity(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email) return;
  const settings = await getSetting('app.settings', {});
  const identity = settings?.identity || {};
  await setSetting('app.settings', {
    ...(settings || {}),
    identity: {
      ...identity,
      mode: 'email',
      nickname: user?.user_metadata?.nickname || identity.nickname || email.split('@')[0] || '云端用户',
      email,
      verified: true,
      cloudUserId: user?.id || identity.cloudUserId || '',
      publicId: identity.publicId || user?.id || ''
    }
  });
}

async function refreshSession({ force = false, reason = 'background' } = {}) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    let active = readSession();
    if (!active?.refresh_token) {
      emit('signed-out');
      return null;
    }
    if (rememberUntil() && Date.now() > rememberUntil()) {
      writeSession(null);
      emit('expired', { reason: 'seven-day-inactivity' });
      return null;
    }
    if (!navigator.onLine) {
      emit('offline', { session: active });
      return accessTokenValid(active, 0) ? active : null;
    }
    if (!force && accessTokenValid(active)) {
      emit('authenticated', { user: active.user, cached: true });
      return active;
    }
    emit('connecting', { reason });
    try {
      const payload = await rawRequest('/auth/v1/token?grant_type=refresh_token', {
        body: { refresh_token: active.refresh_token },
        timeoutMs: 5000
      });
      active = { ...payload, user: payload?.user || active.user || null };
      writeSession(active);
      markServerActivity();
      if (active.user) await persistIdentity(active.user);
      emit('authenticated', { user: active.user, refreshed: true });
      return active;
    } catch (error) {
      if ([400, 401, 403].includes(Number(error.status))) {
        writeSession(null);
        emit('reauth-required', { error: error.message });
        return null;
      }
      emit('offline', { error: error.message, session: active });
      return accessTokenValid(active, 0) ? active : null;
    }
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function getAccessToken({ forceRefresh = false } = {}) {
  const active = readSession();
  if (!forceRefresh && accessTokenValid(active)) return active.access_token;
  const refreshed = await refreshSession({ force: true, reason: 'api-request' });
  return refreshed?.access_token || '';
}

async function apiRequest(path, options = {}) {
  const run = async forceRefresh => {
    const token = await getAccessToken({ forceRefresh });
    if (!token) throw new Error('请先登录云端账号');
    return rawRequest(path, { ...options, token });
  };
  try { return await run(false); }
  catch (error) {
    if (Number(error.status) !== 401) throw error;
    return run(true);
  }
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function overlayRoot() { return document.querySelector('#overlayRoot'); }
function closeDialog() { const root = overlayRoot(); if (root) root.innerHTML = ''; }

function values() {
  return {
    nickname: document.querySelector('#cloudAuthNickname')?.value?.trim() || '',
    email: document.querySelector('#cloudAuthEmail')?.value?.trim().toLowerCase() || '',
    password: document.querySelector('#cloudAuthPassword')?.value || '',
    confirm: document.querySelector('#cloudAuthConfirm')?.value || ''
  };
}

function setDialogMessage(message) {
  const node = document.querySelector('[data-cloud-auth-message]');
  if (node) node.textContent = message;
}

function openDialog(mode = 'login', notice = '', preset = {}) {
  const root = overlayRoot();
  if (!root) return;
  const register = mode === 'register';
  root.innerHTML = `<div class="overlay" data-overlay="cloud-auth"><div class="dialog v099d-auth-dialog">
    <div class="dialog-header"><div><h2>${register ? '注册云端账号' : '登录云端账号'}</h2><p>本地功能无需登录。账号仅用于云端同步，密码不会保存在设备中。</p></div><button class="close-button" type="button" data-cloud-auth-close>×</button></div>
    ${register ? `<label class="field"><span>昵称</span><input id="cloudAuthNickname" class="control" maxlength="24" autocomplete="nickname" value="${esc(preset.nickname || '')}"></label>` : ''}
    <label class="field"><span>邮箱</span><input id="cloudAuthEmail" class="control" type="email" autocomplete="email" value="${esc(preset.email || '')}" placeholder="name@example.com"></label>
    <label class="field"><span>密码</span><input id="cloudAuthPassword" class="control" type="password" minlength="8" autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="至少8位"></label>
    ${register ? '<label class="field"><span>确认密码</span><input id="cloudAuthConfirm" class="control" type="password" minlength="8" autocomplete="new-password"></label>' : ''}
    <p class="muted small" data-cloud-auth-message role="status">${esc(notice)}</p>
    <div class="v099d-auth-actions"><button class="button subtle" type="button" data-cloud-auth-switch="${register ? 'login' : 'register'}">${register ? '已有账号' : '注册账号'}</button><button class="button primary" type="button" data-cloud-auth-submit="${mode}">${register ? '注册' : '登录'}</button></div>
  </div></div>`;
  root.querySelector('[data-cloud-auth-close]')?.addEventListener('click', closeDialog);
  root.querySelector('[data-cloud-auth-switch]')?.addEventListener('click', event => openDialog(event.currentTarget.dataset.cloudAuthSwitch, '', values()));
  root.querySelector('[data-cloud-auth-submit]')?.addEventListener('click', () => submit(mode));
  root.querySelector('[data-overlay="cloud-auth"]')?.addEventListener('click', event => { if (event.target.matches('[data-overlay="cloud-auth"]')) closeDialog(); });
  root.querySelectorAll('input').forEach(input => input.addEventListener('keydown', event => { if (event.key === 'Enter') submit(mode); }));
}

async function submit(mode) {
  if (dialogBusy) return;
  const input = values();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return setDialogMessage('邮箱格式无效');
  if (input.password.length < 8) return setDialogMessage('密码至少需要8位');
  if (mode === 'register' && input.password !== input.confirm) return setDialogMessage('两次输入的密码不一致');
  dialogBusy = true;
  const button = document.querySelector('[data-cloud-auth-submit]');
  if (button) { button.disabled = true; button.textContent = mode === 'register' ? '注册中…' : '登录中…'; }
  try {
    if (mode === 'register') {
      const redirect = `${location.origin}${location.pathname}`;
      const payload = await rawRequest(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirect)}`, {
        body: { email: input.email, password: input.password, data: { nickname: input.nickname || input.email.split('@')[0], source_app: SOURCE_APP } },
        timeoutMs: 10000
      });
      if (!payload?.access_token) {
        openDialog('login', '注册请求已提交。完成邮箱验证后使用相同账号登录。', { email: input.email });
        return;
      }
      writeSession(payload);
      markServerActivity();
      await persistIdentity(payload.user);
      emit('authenticated', { user: payload.user, login: true });
      closeDialog();
      document.dispatchEvent(new CustomEvent('luckybean:cloud-login-success'));
      return;
    }
    const payload = await rawRequest('/auth/v1/token?grant_type=password', {
      body: { email: input.email, password: input.password },
      timeoutMs: 10000
    });
    writeSession(payload);
    markServerActivity();
    await persistIdentity(payload.user);
    emit('authenticated', { user: payload.user, login: true });
    closeDialog();
    document.dispatchEvent(new CustomEvent('luckybean:cloud-login-success'));
  } catch (error) {
    setDialogMessage(error.message || '登录失败');
  } finally {
    dialogBusy = false;
    const current = document.querySelector('[data-cloud-auth-submit]');
    if (current) { current.disabled = false; current.textContent = mode === 'register' ? '注册' : '登录'; }
  }
}

async function signOut() {
  const active = readSession();
  if (active?.access_token) await rawRequest('/auth/v1/logout', { token: active.access_token, timeoutMs: 3500 }).catch(() => {});
  writeSession(null);
  localStorage.removeItem(REMEMBER_UNTIL_KEY);
  emit('signed-out');
}

async function warmSession() {
  const active = readSession();
  if (!active?.refresh_token) {
    emit('signed-out');
    return null;
  }
  return refreshSession({ force: true, reason: 'startup' });
}

globalThis.LuckyBeanCloudAuth = {
  revision: 'cloud-auth-service-v1',
  getSession: readSession,
  warmSession,
  refreshSession,
  getAccessToken,
  apiRequest,
  openDialog,
  signOut,
  isRemembered: () => Boolean(readSession()?.refresh_token && Date.now() <= rememberUntil()),
  rememberUntil
};

queueMicrotask(() => warmSession().catch(error => emit('offline', { error: error.message })));
