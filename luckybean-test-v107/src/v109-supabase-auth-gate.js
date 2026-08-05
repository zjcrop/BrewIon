import { getSetting, setSetting } from './db.js';

const SUPABASE_URL = 'https://vaxwncdcuvbpvdbbketb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_MsB0RFoxxf5zJbbT9PPBjQ_WP7GBMMn';
const SESSION_KEY = 'luckybean.supabase.session.v099d';
const SOURCE_APP = 'luckybean';
const MIN_SPLASH_MS = 420;
const STARTED_AT = performance.now();
let busy = false;
let bypassNativeIntercept = false;
let verifyPromise = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function session() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}

function storeSession(value) {
  if (value?.access_token) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
}

function decodeJwtPayload(token) {
  try {
    const encoded = String(token || '').split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    return JSON.parse(decodeURIComponent([...atob(normalized)].map(char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')));
  } catch {
    return null;
  }
}

function accessTokenValid(active, skewSeconds = 20) {
  const exp = Number(decodeJwtPayload(active?.access_token)?.exp || 0);
  return exp > Math.floor(Date.now() / 1000) + skewSeconds;
}

function cachedUser(active) {
  const user = active?.user || active?.verified_user || null;
  return user?.email ? user : null;
}

function errorMessage(payload, fallback) {
  return payload?.msg || payload?.message || payload?.error_description || payload?.error || fallback;
}

async function request(path, { method = 'POST', body, token, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(errorMessage(payload, `账户服务请求失败（${response.status}）`));
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('账号验证超时，请检查网络后重试。');
      timeoutError.code = 'AUTH_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function setSplashStatus(message) {
  const node = document.querySelector('#splashStatus');
  if (node) node.textContent = message;
}

function setLoginStatus(message = '') {
  const node = document.querySelector('#loginStatus');
  if (node) node.textContent = message;
}

async function respectMinimumSplash() {
  const remaining = MIN_SPLASH_MS - (performance.now() - STARTED_AT);
  if (remaining > 0) await sleep(remaining);
}

async function setGate(state, message = '') {
  if (state !== 'checking') await respectMinimumSplash();
  document.documentElement.dataset.authGate = state;
  const splash = document.querySelector('#splashScreen');
  const login = document.querySelector('#loginScreen');
  const shell = document.querySelector('#appShell');
  if (state === 'checking') {
    splash?.classList.remove('hidden');
    login?.classList.add('hidden');
    shell?.classList.add('hidden');
    setSplashStatus(message || '正在验证账号…');
    return;
  }
  splash?.classList.add('hidden');
  if (state === 'login') {
    login?.classList.remove('hidden');
    shell?.classList.add('hidden');
    setLoginStatus(message || '请登录后进入富贵盒子。');
    return;
  }
  login?.classList.add('hidden');
  shell?.classList.remove('hidden');
}

function notifyAuth(type, detail = {}) {
  document.documentElement.dataset.authState = type;
  document.dispatchEvent(new CustomEvent(`luckybean:auth-${type}`, { detail }));
}

async function persistVerifiedIdentity(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email) throw new Error('云端账户缺少邮箱。');
  const nickname = user?.user_metadata?.nickname || email.split('@')[0] || '云端用户';
  const settings = await getSetting('app.settings', {});
  const current = settings?.identity || {};
  await setSetting('app.settings', {
    ...(settings || {}),
    identity: {
      ...current,
      mode: 'email',
      nickname,
      email,
      verified: true,
      cloudUserId: user?.id || current.cloudUserId || '',
      publicId: current.publicId || user?.id || ''
    }
  });
}

async function refreshSession(active = session()) {
  if (!active?.refresh_token) return null;
  const next = await request('/auth/v1/token?grant_type=refresh_token', {
    body: { refresh_token: active.refresh_token },
    timeoutMs: 5000
  });
  const merged = { ...next, user: next.user || active.user || null };
  storeSession(merged);
  return merged;
}

async function fetchCurrentUser(active = session()) {
  if (!active?.access_token) return null;
  return request('/auth/v1/user', {
    method: 'GET',
    token: active.access_token,
    timeoutMs: 4200
  });
}

function root() { return document.querySelector('#overlayRoot'); }
function close() { if (root()) root().innerHTML = ''; }
function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formValues() {
  return {
    nickname: document.querySelector('#v109AuthNickname')?.value?.trim() || '',
    email: document.querySelector('#v109AuthEmail')?.value?.trim().toLowerCase() || '',
    password: document.querySelector('#v109AuthPassword')?.value || '',
    confirm: document.querySelector('#v109AuthConfirm')?.value || ''
  };
}

function formMessage(value) {
  const node = document.querySelector('.v109-auth-message');
  if (node) {
    node.textContent = value;
    node.classList.add('show');
  }
}

function render(mode = 'login', notice = '', values = {}) {
  const host = root();
  if (!host) return;
  const register = mode === 'register';
  host.innerHTML = `<div class="overlay" data-overlay="supabase-auth"><div class="dialog v099d-auth-dialog">
    <div class="dialog-header"><div><h2>${register ? '注册富贵盒子' : '登录富贵盒子'}</h2><p>账号验证通过后进入应用；登录状态会安全保存在本机，以缩短下次启动时间。</p></div><button class="close-button" type="button" data-auth-close>×</button></div>
    ${register ? `<label class="field"><span>昵称</span><input id="v109AuthNickname" class="control" maxlength="24" autocomplete="nickname" value="${esc(values.nickname || '')}"></label>` : ''}
    <label class="field"><span>邮箱</span><input id="v109AuthEmail" class="control" type="email" autocomplete="email" value="${esc(values.email || '')}" placeholder="name@example.com"></label>
    <label class="field"><span>密码</span><input id="v109AuthPassword" class="control" type="password" minlength="8" autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="至少8位"></label>
    ${register ? '<label class="field"><span>确认密码</span><input id="v109AuthConfirm" class="control" type="password" minlength="8" autocomplete="new-password"></label>' : ''}
    <p class="v109-auth-message${notice ? ' show' : ''}" role="status">${esc(notice)}</p>
    <div class="v099d-auth-actions"><button class="button subtle" type="button" data-auth-switch="${register ? 'login' : 'register'}">${register ? '已有账户，去登录' : '没有账户，去注册'}</button><button class="button primary" type="button" data-auth-submit="${mode}">${register ? '注册' : '登录'}</button></div>
  </div></div>`;
  bindForm(mode);
}

async function waitForAppBindings(timeoutMs = 3200) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const shell = document.querySelector('#appShell');
    if (shell && !shell.classList.contains('hidden')) return true;
    await sleep(100);
  }
  return false;
}

async function enterThroughNativeIdentity(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  const nickname = user?.user_metadata?.nickname || email.split('@')[0] || '云端用户';
  const nativeButton = document.querySelector('#emailIdentityBtn');
  if (!nativeButton) return false;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    bypassNativeIntercept = true;
    nativeButton.click();
    bypassNativeIntercept = false;
    await sleep(80);
    const emailInput = document.querySelector('#identityEmail');
    const nicknameInput = document.querySelector('#identityNickname');
    const saveButton = document.querySelector('#saveEmailIdentityBtn');
    if (emailInput && nicknameInput && saveButton) {
      emailInput.value = email;
      nicknameInput.value = nickname;
      saveButton.click();
      if (await waitForAppBindings(2600)) return true;
    }
    await sleep(120);
  }
  return false;
}

async function enterVerifiedApp(user) {
  setSplashStatus('账号已确认，正在进入…');
  await persistVerifiedIdentity(user);
  close();

  if (!(await waitForAppBindings(1800))) {
    const entered = await enterThroughNativeIdentity(user);
    if (!entered && !(await waitForAppBindings(900))) {
      throw new Error('主界面初始化未完成，请重新打开应用。');
    }
  }

  await persistVerifiedIdentity(user);
  await setGate('ready');
  notifyAuth('verified', { user });
  document.dispatchEvent(new CustomEvent('luckybean:auth-ready', { detail: { user } }));
}

async function submit(mode) {
  if (busy) return;
  const input = formValues();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return formMessage('邮箱格式无效。');
  if (input.password.length < 8) return formMessage('密码至少需要8位。');
  if (mode === 'register' && input.password !== input.confirm) return formMessage('两次输入的密码不一致。');

  busy = true;
  const button = document.querySelector('[data-auth-submit]');
  if (button) {
    button.disabled = true;
    button.textContent = mode === 'register' ? '注册中…' : '登录中…';
  }

  try {
    if (mode === 'register') {
      const redirect = `${location.origin}${location.pathname}?v=1.0.9-test`;
      const payload = await request(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirect)}`, {
        body: {
          email: input.email,
          password: input.password,
          data: { nickname: input.nickname || input.email.split('@')[0], source_app: SOURCE_APP }
        },
        timeoutMs: 10000
      });
      if (!payload?.access_token) {
        render('login', '注册请求已提交。请完成邮箱验证后，再使用相同邮箱和密码登录。', { email: input.email });
        return;
      }
      const user = payload.user || await fetchCurrentUser(payload);
      const active = { ...payload, user };
      storeSession(active);
      await setGate('checking', '注册成功，正在进入…');
      await enterVerifiedApp(user);
      return;
    }

    const payload = await request('/auth/v1/token?grant_type=password', {
      body: { email: input.email, password: input.password },
      timeoutMs: 10000
    });
    const user = payload.user || await fetchCurrentUser(payload);
    const active = { ...payload, user };
    storeSession(active);
    await setGate('checking', '登录成功，正在进入…');
    await enterVerifiedApp(user);
  } catch (error) {
    await setGate('login', error.message);
    render(mode, error.message, input);
  } finally {
    busy = false;
    const current = document.querySelector('[data-auth-submit]');
    if (current) {
      current.disabled = false;
      current.textContent = mode === 'register' ? '注册' : '登录';
    }
  }
}

function bindForm(mode) {
  document.querySelector('[data-auth-close]')?.addEventListener('click', close);
  document.querySelector('[data-auth-switch]')?.addEventListener('click', event => render(event.currentTarget.dataset.authSwitch, '', formValues()));
  document.querySelector('[data-auth-submit]')?.addEventListener('click', () => submit(mode));
  document.querySelector('[data-overlay="supabase-auth"]')?.addEventListener('click', event => {
    if (event.target.matches('[data-overlay="supabase-auth"]')) close();
  });
  document.querySelectorAll('.v099d-auth-dialog input').forEach(input => input.addEventListener('keydown', event => {
    if (event.key === 'Enter') submit(mode);
  }));
}

function intercept(event) {
  if (bypassNativeIntercept) return;
  const login = event.target.closest?.('#emailIdentityBtn');
  const register = event.target.closest?.('#wechatIdentityBtn');
  const retry = event.target.closest?.('#retryAuthBtn');
  if (retry) {
    event.preventDefault();
    verifySession({ force: true }).catch(() => {});
    return;
  }
  if (!login && !register) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  render(register ? 'register' : 'login');
}

document.addEventListener('click', intercept, true);

async function verifySession({ force = false } = {}) {
  if (verifyPromise && !force) return verifyPromise;
  verifyPromise = (async () => {
    await setGate('checking', '正在验证账号…');
    let active = session();
    if (!active?.access_token && !active?.refresh_token) {
      notifyAuth('missing');
      await setGate('login', '尚未登录，请先登录账号。');
      return null;
    }

    try {
      let user;
      if (accessTokenValid(active)) {
        user = await fetchCurrentUser(active);
      } else {
        setSplashStatus('登录状态已过期，正在快速续期…');
        active = await refreshSession(active);
        if (!active?.access_token) throw new Error('登录状态已失效，请重新登录。');
        user = cachedUser(active) || await fetchCurrentUser(active);
      }
      if (!user?.email) throw new Error('无法读取云端账户信息。');
      storeSession({ ...active, user });
      await enterVerifiedApp(user);
      return user;
    } catch (error) {
      if ([400, 401, 403].includes(Number(error.status))) storeSession(null);
      notifyAuth('missing', { error: error.message });
      await setGate('login', error.message || '账号验证失败，请重新登录。');
      return null;
    }
  })().finally(() => { verifyPromise = null; });
  return verifyPromise;
}

globalThis.LuckyBeanSupabaseAuth = {
  revision: '109-gated-fast-verify',
  sourceApp: SOURCE_APP,
  verifySession,
  signOut: async () => {
    const active = session();
    if (active?.access_token) {
      await request('/auth/v1/logout', { token: active.access_token, timeoutMs: 3500 }).catch(() => {});
    }
    storeSession(null);
    notifyAuth('missing');
    await setGate('login', '已退出登录。');
  }
};

verifySession().catch(async error => {
  notifyAuth('missing', { error: error.message });
  await setGate('login', error.message || '账号验证失败。');
});
