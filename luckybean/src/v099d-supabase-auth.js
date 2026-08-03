const SUPABASE_URL = 'https://phwqpxmnrogddrajwpqm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_owicJe5BeJ-4e1ckFwGBjA_luAdvDCO';
const SESSION_KEY = 'luckybean.supabase.session.v099d';
const SOURCE_APP = 'luckybean';
let busy = false;
let bypassNativeIntercept = false;

function session() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function storeSession(value) {
  if (value?.access_token) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
}
function errorMessage(payload, fallback) {
  return payload?.msg || payload?.message || payload?.error_description || payload?.error || fallback;
}
async function request(path, { method = 'POST', body, token } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(payload, `账户服务请求失败（${response.status}）`));
  return payload;
}
async function refreshSession() {
  const active = session();
  if (!active?.refresh_token) return null;
  try {
    const next = await request('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: active.refresh_token } });
    storeSession(next);
    return next;
  } catch {
    storeSession(null);
    return null;
  }
}
async function currentUser(active = session()) {
  if (!active?.access_token) return null;
  try {
    return await request('/auth/v1/user', { method: 'GET', token: active.access_token });
  } catch (error) {
    const refreshed = await refreshSession();
    if (!refreshed?.access_token) throw error;
    return request('/auth/v1/user', { method: 'GET', token: refreshed.access_token });
  }
}
function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function root() { return document.querySelector('#overlayRoot'); }
function close() { if (root()) root().innerHTML = ''; }
function formValues() {
  return {
    nickname: document.querySelector('#v099dAuthNickname')?.value?.trim() || '',
    email: document.querySelector('#v099dAuthEmail')?.value?.trim().toLowerCase() || '',
    password: document.querySelector('#v099dAuthPassword')?.value || '',
    confirm: document.querySelector('#v099dAuthConfirm')?.value || ''
  };
}
function message(value) {
  const node = document.querySelector('.v099d-auth-message');
  if (node) { node.textContent = value; node.classList.add('show'); }
}
function render(mode = 'login', notice = '', values = {}) {
  const host = root();
  if (!host) return;
  const register = mode === 'register';
  host.innerHTML = `<div class="overlay" data-overlay="supabase-auth"><div class="dialog v099d-auth-dialog">
    <div class="dialog-header"><div><h2>${register ? '注册富贵盒子' : '登录富贵盒子'}</h2><p>账户认证复用 Grind-PSD 的 Supabase 项目；两款应用的业务记录保持隔离。</p></div><button class="close-button" type="button" data-auth-close>×</button></div>
    ${register ? `<label class="field"><span>昵称</span><input id="v099dAuthNickname" class="control" maxlength="24" autocomplete="nickname" value="${esc(values.nickname || '')}"></label>` : ''}
    <label class="field"><span>邮箱</span><input id="v099dAuthEmail" class="control" type="email" autocomplete="email" value="${esc(values.email || '')}" placeholder="name@example.com"></label>
    <label class="field"><span>密码</span><input id="v099dAuthPassword" class="control" type="password" minlength="8" autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="至少8位"></label>
    ${register ? '<label class="field"><span>确认密码</span><input id="v099dAuthConfirm" class="control" type="password" minlength="8" autocomplete="new-password"></label>' : ''}
    <p class="v099d-auth-message${notice ? ' show' : ''}" role="status">${esc(notice)}</p>
    <div class="v099d-auth-actions"><button class="button subtle" type="button" data-auth-switch="${register ? 'login' : 'register'}">${register ? '已有账户，去登录' : '没有账户，去注册'}</button><button class="button primary" type="button" data-auth-submit="${mode}">${register ? '注册' : '登录'}</button></div>
  </div></div>`;
  bind(mode);
}
function enterThroughNativeIdentity(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email) throw new Error('云端账户缺少邮箱');
  const nickname = user?.user_metadata?.nickname || email.split('@')[0] || '云端用户';
  close();
  const nativeButton = document.querySelector('#emailIdentityBtn');
  if (!nativeButton) throw new Error('本机身份入口尚未就绪');
  bypassNativeIntercept = true;
  nativeButton.click();
  bypassNativeIntercept = false;
  queueMicrotask(() => {
    const emailInput = document.querySelector('#identityEmail');
    const nicknameInput = document.querySelector('#identityNickname');
    if (!emailInput || !nicknameInput) return;
    emailInput.value = email;
    nicknameInput.value = nickname;
    document.querySelector('#saveEmailIdentityBtn')?.click();
  });
}
async function submit(mode) {
  if (busy) return;
  const input = formValues();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return message('邮箱格式无效。');
  if (input.password.length < 8) return message('密码至少需要8位。');
  if (mode === 'register' && input.password !== input.confirm) return message('两次输入的密码不一致。');
  busy = true;
  const submitButton = document.querySelector('[data-auth-submit]');
  if (submitButton) { submitButton.disabled = true; submitButton.textContent = '处理中…'; }
  try {
    if (mode === 'register') {
      const redirect = `${location.origin}${location.pathname}?v=099d`;
      const payload = await request(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirect)}`, {
        body: { email: input.email, password: input.password, data: { nickname: input.nickname || input.email.split('@')[0], source_app: SOURCE_APP } }
      });
      if (payload?.access_token) {
        storeSession(payload);
        enterThroughNativeIdentity(payload.user);
      } else {
        render('login', '注册请求已提交。请完成邮箱验证后，再使用相同邮箱和密码登录。', { email: input.email });
      }
      return;
    }
    const payload = await request('/auth/v1/token?grant_type=password', { body: { email: input.email, password: input.password } });
    storeSession(payload);
    enterThroughNativeIdentity(payload.user || await currentUser(payload));
  } catch (error) {
    message(error.message);
  } finally {
    busy = false;
    const current = document.querySelector('[data-auth-submit]');
    if (current) { current.disabled = false; current.textContent = mode === 'register' ? '注册' : '登录'; }
  }
}
function bind(mode) {
  document.querySelector('[data-auth-close]')?.addEventListener('click', close);
  document.querySelector('[data-auth-switch]')?.addEventListener('click', event => render(event.currentTarget.dataset.authSwitch, '', formValues()));
  document.querySelector('[data-auth-submit]')?.addEventListener('click', () => submit(mode));
  document.querySelector('[data-overlay="supabase-auth"]')?.addEventListener('click', event => { if (event.target.matches('[data-overlay="supabase-auth"]')) close(); });
  document.querySelectorAll('.v099d-auth-dialog input').forEach(input => input.addEventListener('keydown', event => { if (event.key === 'Enter') submit(mode); }));
}
function intercept(event) {
  if (bypassNativeIntercept) return;
  const login = event.target.closest?.('#emailIdentityBtn');
  const register = event.target.closest?.('#wechatIdentityBtn');
  if (!login && !register) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  render(register ? 'register' : 'login');
}
document.addEventListener('click', intercept, true);
async function restore() {
  const active = session();
  if (!active?.access_token || !document.querySelector('#loginScreen:not(.hidden)')) return;
  try {
    const user = await currentUser(active);
    if (user) enterThroughNativeIdentity(user);
  } catch { /* login page remains available */ }
}
document.addEventListener('DOMContentLoaded', () => setTimeout(restore, 0), { once: true });
if (document.readyState !== 'loading') setTimeout(restore, 0);
globalThis.LuckyBeanSupabaseAuth = {
  revision: '099d', sourceApp: SOURCE_APP,
  signOut: async () => {
    const active = session();
    if (active?.access_token) await request('/auth/v1/logout', { token: active.access_token }).catch(() => {});
    storeSession(null);
    location.reload();
  }
};
