const STYLE_ID = 'v099e-cloud-style';
if (!document.getElementById(STYLE_ID)) {
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = './styles-v099e.css?v=099e';
  document.head.append(link);
}
function injectAccountActions() {
  const panel = document.querySelector('[data-v099e-cloud-panel] .settings-category-body');
  if (!panel || panel.querySelector('[data-v099e-account-actions]')) return;
  const session = (() => { try { return JSON.parse(localStorage.getItem('luckybean.supabase.session.v099d') || 'null'); } catch { return null; } })();
  if (session?.access_token) return;
  const wrap = document.createElement('div');
  wrap.dataset.v099eAccountActions = '';
  wrap.className = 'v099e-cloud-actions';
  wrap.innerHTML = '<button class="button primary" type="button" data-v099e-login>登录账号</button><button class="button" type="button" data-v099e-register>注册并升级游客数据</button>';
  panel.insertBefore(wrap, panel.firstChild);
  wrap.querySelector('[data-v099e-login]').addEventListener('click', () => document.querySelector('#emailIdentityBtn')?.click());
  wrap.querySelector('[data-v099e-register]').addEventListener('click', () => document.querySelector('#wechatIdentityBtn')?.click());
}
new MutationObserver(injectAccountActions).observe(document.documentElement, { childList: true, subtree: true });
setTimeout(injectAccountActions, 700);
