import { getSetting, setSetting } from './db.js';

if (!globalThis.__LuckyBeanV099gAccountStabilizerLoaded) {
  globalThis.__LuckyBeanV099gAccountStabilizerLoaded = true;

  const SESSION_KEY = 'luckybean.supabase.session.v099d';
  const ENABLE_KEY = 'cloud.sync.enabled.v2';
  const MODE_KEY = 'cloud.sync.mode.v2';
  const LAST_KEY = 'cloud.sync.last.v2';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>\"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let mountFrame = 0;
  let observedRoot = null;
  let rootObserver = null;

  function authSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return value?.access_token && value?.user?.id ? value : null;
    } catch { return null; }
  }

  function toast(message, kind = '') {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.className = `toast show ${kind}`;
    setTimeout(() => { node.className = 'toast'; }, 2800);
  }

  function findAccount(root) {
    return $$('.settings-category', root).find(section => /账户|账号/.test(section.querySelector('summary')?.textContent || '')) || null;
  }

  function panelHtml() {
    const active = authSession();
    return `<section class="v099f-account-sync v099g-account-sync" data-v099f-account-sync data-v099g-account-sync>
      <div class="v099f-account-status"><span>账号状态</span><strong data-v099g-account-state>${active ? `已登录 ${esc(active.user.email || '')}` : '未登录'}</strong></div>
      <div class="v099f-account-actions">
        <button type="button" class="button" data-v099g-login>登录</button>
        <button type="button" class="button" data-v099g-register>注册</button>
        <button type="button" class="button subtle" data-v099g-unlock ${active ? '' : 'disabled'}>解锁云端密码</button>
      </div>
      <div class="v099f-storage-config">
        <label class="toggle"><input type="checkbox" data-v099g-cloud-enabled>上传并同步云端</label>
        <div class="v099f-sync-mode" role="radiogroup" aria-label="同步方式">
          <label><input type="radio" name="v099gSyncMode" value="manual" checked>手动同步</label>
          <label><input type="radio" name="v099gSyncMode" value="auto">自动同步</label>
        </div>
        <p class="muted small">数据默认保存在本地。开启云端后按豆卡和月份分包，在本机编码、压缩和AES-GCM加密后上传。</p>
        <div class="v099f-sync-actions">
          <button type="button" class="button primary" data-v099g-sync-now ${active ? '' : 'disabled'}>立即同步</button>
          <button type="button" class="button" data-v099g-download ${active ? '' : 'disabled'}>下载并合并</button>
          <button type="button" class="button" data-v099g-confirm>确定</button>
        </div>
        <output class="muted small" data-v099g-status>正在读取储存设置…</output>
      </div>
    </section>`;
  }

  async function hydrate(panel) {
    if (!panel?.isConnected || panel.dataset.hydrated === '1') return;
    panel.dataset.hydrated = '1';
    const [enabled, mode, last] = await Promise.all([
      getSetting(ENABLE_KEY, false),
      getSetting(MODE_KEY, 'manual'),
      getSetting(LAST_KEY, null)
    ]);
    if (!panel.isConnected) return;
    const enabledInput = $('[data-v099g-cloud-enabled]', panel);
    const modeInput = $(`input[name="v099gSyncMode"][value="${mode === 'auto' ? 'auto' : 'manual'}"]`, panel);
    if (enabledInput) enabledInput.checked = Boolean(enabled);
    if (modeInput) modeInput.checked = true;
    panel.dataset.initialEnabled = enabled ? '1' : '0';
    panel.dataset.initialMode = mode === 'auto' ? 'auto' : 'manual';
    const status = $('[data-v099g-status]', panel);
    if (status) status.textContent = last?.at
      ? `上次同步：${new Date(last.at).toLocaleString('zh-CN')} · ${last.changed || 0}个变更分包 · ${last.uploadedBytes || 0} B`
      : '上次同步：尚未同步';
  }

  function cloudApi() {
    const api = globalThis.LuckyBeanCloudSyncV2;
    if (!api) throw new Error('云端同步模块尚未完成加载，请稍后再试');
    return api;
  }

  function bind(panel, account) {
    if (!panel || panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';
    $('[data-v099g-login]', panel)?.addEventListener('click', () => $('#emailIdentityBtn')?.click());
    $('[data-v099g-register]', panel)?.addEventListener('click', () => $('#wechatIdentityBtn')?.click());
    $('[data-v099g-unlock]', panel)?.addEventListener('click', event => {
      try {
        cloudApi().unlock();
        event.currentTarget.textContent = '本次会话已解锁';
        toast('云端数据密码已解锁', 'status-good');
      } catch (error) { toast(error.message, 'status-bad'); }
    });

    const run = async type => {
      const status = $('[data-v099g-status]', panel);
      const buttons = $$('button', panel);
      buttons.forEach(button => { button.disabled = true; });
      try {
        if (status) status.textContent = type === 'upload' ? '正在编码、分包、压缩、加密并上传…' : '正在下载、校验、解密并合并…';
        const api = cloudApi();
        const result = type === 'upload' ? await api.upload({ interactive: true }) : await api.download({ interactive: true });
        if (type === 'upload') {
          if (status) status.textContent = `同步完成：${result.changed || 0}个变更分包，上传密文${result.uploadedBytes || 0} B`;
          toast('云端增量同步完成', 'status-good');
        } else {
          if (status) status.textContent = `恢复完成：${result.packets || 0}个分包`;
          toast('云端数据已合并到本地', 'status-good');
          setTimeout(() => location.reload(), 700);
        }
      } catch (error) {
        if (status) status.textContent = error.message;
        toast(error.message, 'status-bad');
      } finally {
        const active = authSession();
        buttons.forEach(button => { button.disabled = false; });
        const unlock = $('[data-v099g-unlock]', panel);
        const sync = $('[data-v099g-sync-now]', panel);
        const download = $('[data-v099g-download]', panel);
        if (unlock) unlock.disabled = !active;
        if (sync) sync.disabled = !active;
        if (download) download.disabled = !active;
      }
    };

    $('[data-v099g-sync-now]', panel)?.addEventListener('click', () => run('upload'));
    $('[data-v099g-download]', panel)?.addEventListener('click', () => run('download'));
    $('[data-v099g-confirm]', panel)?.addEventListener('click', async () => {
      const enabled = Boolean($('[data-v099g-cloud-enabled]', panel)?.checked);
      const mode = $('input[name="v099gSyncMode"]:checked', panel)?.value || 'manual';
      if (enabled && !authSession()) return toast('开启云端同步前必须登录并激活账号', 'status-bad');
      try {
        if (enabled && mode === 'auto') cloudApi().unlock();
        await Promise.all([setSetting(ENABLE_KEY, enabled), setSetting(MODE_KEY, mode)]);
        account.open = false;
        toast(enabled ? `已设为${mode === 'auto' ? '自动' : '手动'}云端同步` : '已设为仅本地储存', 'status-good');
        const changedFromAuto = panel.dataset.initialMode === 'auto' && mode !== 'auto';
        const disabledFromAuto = panel.dataset.initialEnabled === '1' && !enabled;
        if (changedFromAuto || disabledFromAuto) setTimeout(() => location.reload(), 420);
      } catch (error) { toast(error.message, 'status-bad'); }
    });
  }

  function mountNow() {
    mountFrame = 0;
    const root = $('#settingsContent');
    if (!root) return;
    const account = findAccount(root);
    if (!account) return;

    const summary = account.querySelector('summary span');
    if (summary && summary.textContent.trim() !== '账号') summary.textContent = '账号';

    const body = $('.settings-category-body', account);
    if (!body) return;

    const legacyPanels = $$('.v099e-cloud-panel,[data-v099e-cloud-panel]', root);
    if (legacyPanels.length) legacyPanels.forEach(node => node.remove());

    const panels = $$('[data-v099f-account-sync]', body);
    let panel = panels.find(node => node.hasAttribute('data-v099g-account-sync')) || null;
    if (panels.length > 1) panels.filter(node => node !== panel).forEach(node => node.remove());
    if (!panel) {
      body.insertAdjacentHTML('beforeend', panelHtml());
      panel = $('[data-v099g-account-sync]', body);
    }
    bind(panel, account);
    hydrate(panel);
  }

  function queueMount() {
    if (mountFrame) return;
    mountFrame = requestAnimationFrame(mountNow);
  }

  function observeSettingsRoot() {
    const root = $('#settingsContent');
    if (!root || root === observedRoot) return;
    rootObserver?.disconnect();
    observedRoot = root;
    rootObserver = new MutationObserver(records => {
      if (records.some(record => record.target === root && record.type === 'childList')) queueMount();
    });
    rootObserver.observe(root, { childList: true });
  }

  document.addEventListener('click', event => {
    if (!event.target.closest?.('[data-page-target="settings"]')) return;
    setTimeout(() => {
      observeSettingsRoot();
      queueMount();
    }, 0);
  }, true);

  addEventListener('pageshow', () => {
    observeSettingsRoot();
    queueMount();
  });

  observeSettingsRoot();
  queueMount();
}
