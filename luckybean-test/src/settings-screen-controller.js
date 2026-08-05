import { getSetting, setSetting } from './db.js';

if (!globalThis.__LuckyBeanV099pSettingsRebuildLoaded) {
  globalThis.__LuckyBeanV099pSettingsRebuildLoaded = true;

  const RELEASE = '099s';
  const UI_KEY = 'luckybean.ui.v095';
  const LEGACY_UI_KEY = 'luckybean.ui.v094';
  const VOICE_KEY = 'luckybean.voice.v099i';
  const SESSION_KEY = 'luckybean.supabase.session.v099d';
  const CLOUD_ENABLE_KEY = 'cloud.sync.enabled.v2';
  const CLOUD_MODE_KEY = 'cloud.sync.mode.v2';
  const CLOUD_LAST_KEY = 'cloud.sync.last.v2';
  const SPLASH = {
    red: `./public/splash-art-red.webp?v=${RELEASE}`,
    white: `./public/splash-art-light.webp?v=${RELEASE}`
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  let openKey = '';
  let mountTimer = 0;
  let voices = [];
  let nativeSpeak = null;

  function safeJson(value, fallback = {}) {
    try { return { ...fallback, ...JSON.parse(value || '{}') }; } catch { return { ...fallback }; }
  }

  function toast(message, kind = '') {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.className = `toast show ${kind}`;
    setTimeout(() => { node.className = 'toast'; }, 2600);
  }

  function authSession() {
    const session = safeJson(localStorage.getItem(SESSION_KEY), {});
    return session?.access_token && session?.user?.id ? session : null;
  }

  function uiConfig() {
    return {
      theme: 'dark', splash: 'red',
      ...safeJson(localStorage.getItem(LEGACY_UI_KEY), {}),
      ...safeJson(localStorage.getItem(UI_KEY), {})
    };
  }

  function saveUi(config) {
    const value = JSON.stringify(config);
    localStorage.setItem(UI_KEY, value);
    localStorage.setItem(LEGACY_UI_KEY, value);
  }

  function voiceConfig() {
    return safeJson(localStorage.getItem(VOICE_KEY), { mode: 'auto', voiceURI: '', rate: 1.05 });
  }

  function saveVoice(config) {
    localStorage.setItem(VOICE_KEY, JSON.stringify(config));
  }

  function categoryKey(details) {
    return details?.dataset.settingsKey || '';
  }

  function topLevel(container = $('#settingsContent .settings-categories')) {
    return container ? $$(':scope > details.settings-category', container) : [];
  }

  function findOriginalSections(container) {
    const result = {};
    for (const section of topLevel(container)) {
      const title = section.querySelector(':scope > summary span')?.textContent?.trim() || '';
      if (/账户|账号/.test(title)) result.account ||= section;
      else if (/私器/.test(title)) result.gear ||= section;
      else if (/数藏/.test(title)) result.data ||= section;
      else if (/本物|关于/.test(title)) result.about ||= section;
    }
    return result;
  }

  function appearanceSection() {
    const config = uiConfig();
    const section = document.createElement('details');
    section.className = 'settings-category v099p-settings-section';
    section.id = 'v095AppearanceSettings';
    section.dataset.settingsKey = 'appearance';
    section.innerHTML = `<summary><span>界面</span><small>显示模式与起始页</small></summary>
      <div class="settings-category-body v099p-settings-body" id="v099pAppearanceBody">
        <div class="v099p-setting-row"><div><strong>显示模式</strong><small>黑色与浅色界面</small></div><button class="button" type="button" data-v099p-theme>${config.theme === 'light' ? '浅色模式' : '黑色模式'}</button></div>
        <div class="v095-splash-choice v099p-splash-grid" role="radiogroup" aria-label="起始页方案">
          <button type="button" data-splash-choice="red" class="${config.splash === 'red' ? 'selected' : ''}"><img src="${SPLASH.red}" alt="红色起始页预览"><span>红色版本</span></button>
          <button type="button" data-splash-choice="white" class="${config.splash === 'white' ? 'selected' : ''}"><img src="${SPLASH.white}" alt="浅米白起始页预览"><span>浅米白版本</span></button>
        </div>
      </div>`;
    return section;
  }

  function voiceSection() {
    const config = voiceConfig();
    const section = document.createElement('details');
    section.className = 'settings-category v099p-settings-section';
    section.id = 'v099iVoiceSettings';
    section.dataset.settingsKey = 'voice';
    section.innerHTML = `<summary><span>语音</span><small>声音、语速与试听</small></summary>
      <div class="settings-category-body v099p-settings-body v099p-voice-body">
        <div class="grid-2">
          <label class="field"><span>声音倾向</span><select class="control" data-v099p-voice-mode><option value="auto">自动</option><option value="female">偏女声</option><option value="male">偏男声</option></select></label>
          <label class="field"><span>当前设备声音</span><select class="control" data-v099p-voice><option value="">正在读取系统声音…</option></select></label>
        </div>
        <label class="field"><span>语速 <output data-v099p-rate-output>${Number(config.rate || 1.05).toFixed(2)}</output></span><input class="control" type="range" min="0.75" max="1.30" step="0.05" value="${Number(config.rate || 1.05)}" data-v099p-rate></label>
        <p class="muted small">声音来自当前浏览器和操作系统；男女声倾向按可用声音名称匹配。</p>
        <div class="row end"><button class="button" type="button" data-v099p-voice-preview>试听</button><button class="button primary" type="button" data-v099p-voice-save>保存语音</button></div>
      </div>`;
    return section;
  }

  function cloudPanelHtml() {
    const active = authSession();
    return `<section class="v099p-cloud-panel" data-v099p-cloud-panel>
      <div class="v099p-setting-row"><div><strong>账号状态</strong><small>${active ? esc(active.user.email || '已登录') : '未登录'}</small></div><div class="text-actions"><button type="button" class="button" data-v099p-login>登录</button><button type="button" class="button" data-v099p-register>注册</button></div></div>
      <label class="toggle"><input type="checkbox" data-v099p-cloud-enabled>上传并同步云端</label>
      <div class="v099p-sync-mode"><label><input type="radio" name="v099pSyncMode" value="manual" checked> 手动同步</label><label><input type="radio" name="v099pSyncMode" value="auto"> 自动同步</label></div>
      <p class="muted small">默认只保存到本机。开启云端后，数据在本机编码、分包、压缩和AES-GCM加密后上传。</p>
      <div class="text-actions"><button type="button" class="button" data-v099p-unlock ${active ? '' : 'disabled'}>解锁云端密码</button><button type="button" class="button primary" data-v099p-sync-now ${active ? '' : 'disabled'}>立即同步</button><button type="button" class="button" data-v099p-download ${active ? '' : 'disabled'}>下载并合并</button><button type="button" class="button" data-v099p-cloud-save>保存储存设置</button></div>
      <output class="muted small" data-v099p-cloud-status>正在读取储存设置…</output>
    </section>`;
  }

  function normalizeSections(container) {
    document.querySelectorAll('[data-v099e-cloud-panel], .v099e-cloud-panel, [data-v099e-account-actions]').forEach(node => node.remove());
    $('#settingsContent > #v095SettingsMascot')?.remove();
    const original = findOriginalSections(container);
    if (!original.account || !original.gear || !original.data || !original.about) return null;

    original.account.dataset.settingsKey = 'account';
    original.gear.dataset.settingsKey = 'gear';
    original.data.dataset.settingsKey = 'data';
    original.about.dataset.settingsKey = 'about';
    original.account.classList.add('v099p-settings-section');
    original.gear.classList.add('v099p-settings-section');
    original.data.classList.add('v099p-settings-section');
    original.about.classList.add('v099p-settings-section');

    const accountTitle = original.account.querySelector(':scope > summary span');
    if (accountTitle) accountTitle.textContent = '账号';
    const accountHint = original.account.querySelector(':scope > summary small');
    if (accountHint) accountHint.textContent = '个人信息与云端储存';
    const gearHint = original.gear.querySelector(':scope > summary small');
    if (gearHint) gearHint.textContent = '滤纸、滤杯与磨豆机';
    const dataHint = original.data.querySelector(':scope > summary small');
    if (dataHint) dataHint.textContent = '备份、接口与分析';

    const accountBody = original.account.querySelector(':scope > .settings-category-body');
    if (accountBody && !accountBody.querySelector('[data-v099p-cloud-panel]')) accountBody.insertAdjacentHTML('beforeend', cloudPanelHtml());

    const dataBody = original.data.querySelector(':scope > .settings-category-body');
    if (dataBody && !dataBody.querySelector('[data-v099p-data-analysis]')) {
      dataBody.insertAdjacentHTML('beforeend', `<section class="v099p-data-analysis" data-v099p-data-analysis><h3>数藏分析</h3><div class="v099p-analysis-actions"><button type="button" data-v099f-preference>风味喜好数字侧写</button><button type="button" data-v099f-world>咖啡世界</button></div></section>`);
    }

    const aboutBody = original.about.querySelector(':scope > .settings-category-body');
    if (aboutBody && !aboutBody.querySelector('#v095SettingsMascot')) {
      aboutBody.insertAdjacentHTML('beforeend', `<figure id="v095SettingsMascot" class="v095-settings-mascot v099p-settings-mascot"><img src="./public/settings-mascot.webp?v=${RELEASE}" alt="富贵盒子品牌猫"><figcaption><span>富贵的盒子</span><small>Lucky Bean</small></figcaption></figure>`);
      aboutBody.querySelector('#v095SettingsMascot img')?.addEventListener('error', event => { event.currentTarget.closest('figure').hidden = true; }, { once: true });
    }

    const appearance = appearanceSection();
    const voice = voiceSection();
    container.replaceChildren(appearance, original.account, original.gear, voice, original.data, original.about);
    return { appearance, account: original.account, gear: original.gear, voice, data: original.data, about: original.about };
  }

  function bindAccordion(container) {
    if (container.dataset.v099pAccordionBound === '1') return;
    container.dataset.v099pAccordionBound = '1';
    container.addEventListener('click', event => {
      const summary = event.target.closest('summary');
      if (!summary || !container.contains(summary)) return;
      if (event.target.closest('button,a,input,select,textarea,label') && event.target !== summary) return;
      const details = summary.parentElement;
      if (!(details instanceof HTMLDetailsElement)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const isTop = details.parentElement === container;
      const willOpen = !details.open;
      if (isTop) {
        for (const other of topLevel(container)) if (other !== details) other.open = false;
        details.open = willOpen;
        openKey = willOpen ? categoryKey(details) : '';
      } else {
        details.open = willOpen;
      }
      summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');
    }, true);
  }

  function restoreOpen(container) {
    for (const section of topLevel(container)) {
      const shouldOpen = Boolean(openKey) && categoryKey(section) === openKey;
      section.open = shouldOpen;
      section.querySelector(':scope > summary')?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    }
  }

  function applyAppearance(section) {
    const config = uiConfig();
    $('[data-v099p-theme]', section)?.addEventListener('click', () => {
      $('#themeToggleBtn')?.click();
      setTimeout(() => mount({ preserveOpen: true }), 0);
    });
    $$('[data-splash-choice]', section).forEach(button => button.addEventListener('click', () => {
      const next = { ...uiConfig(), splash: button.dataset.splashChoice === 'white' ? 'white' : 'red' };
      saveUi(next);
      const screen = $('#splashScreen');
      const image = $('#splashImage');
      if (screen) screen.dataset.splashVariant = next.splash;
      if (image) image.src = SPLASH[next.splash];
      $$('[data-splash-choice]', section).forEach(item => item.classList.toggle('selected', item === button));
    }));
    const themeButton = $('[data-v099p-theme]', section);
    if (themeButton) themeButton.textContent = config.theme === 'light' ? '浅色模式' : '黑色模式';
  }

  const FEMALE_HINT = /xiaoxiao|xiaoyi|huihui|yaoyao|tingting|meijia|samantha|victoria|female|女|晓晓|晓伊|慧慧|瑶瑶|婷婷/i;
  const MALE_HINT = /yunxi|yunyang|kangkang|zhiwei|daniel|alex|male|男|云希|云扬|康康|智威/i;

  function chineseVoices() {
    const list = voices.filter(voice => /^zh(?:-|_)/i.test(voice.lang || '') || /chinese|mandarin|中文|普通话/i.test(`${voice.name} ${voice.lang}`));
    return list.length ? list : voices;
  }

  function pickVoice(config) {
    if (config.voiceURI) {
      const exact = voices.find(voice => voice.voiceURI === config.voiceURI || `${voice.name}|${voice.lang}` === config.voiceURI);
      if (exact) return exact;
    }
    const candidates = chineseVoices();
    if (config.mode === 'female') return candidates.find(voice => FEMALE_HINT.test(voice.name)) || candidates.find(voice => voice.default) || candidates[0] || null;
    if (config.mode === 'male') return candidates.find(voice => MALE_HINT.test(voice.name)) || candidates.find(voice => voice.default) || candidates[0] || null;
    return candidates.find(voice => voice.default) || candidates[0] || null;
  }

  function applyVoice(utterance, config = voiceConfig()) {
    const voice = pickVoice(config);
    if (voice) utterance.voice = voice;
    utterance.rate = Math.min(1.3, Math.max(.75, Number(config.rate) || 1.05));
    if (config.mode === 'female' && !FEMALE_HINT.test(voice?.name || '')) utterance.pitch = 1.06;
    if (config.mode === 'male' && !MALE_HINT.test(voice?.name || '')) utterance.pitch = .92;
    return utterance;
  }

  function populateVoiceSelect(section) {
  const select = $('[data-v099p-voice]', section);
  if (!select) return;
  const config = voiceConfig();
  select.innerHTML = `<option value="">按声音倾向自动选择</option>${chineseVoices().map(voice => {
    const key = voice.voiceURI || `${voice.name}|${voice.lang}`;
    return `<option value="${esc(key)}">${esc(voice.name)} · ${esc(voice.lang || '')}${voice.localService ? ' · 本地' : ''}</option>`;
  }).join('')}`;
  if ([...select.options].some(option => option.value === config.voiceURI)) select.value = config.voiceURI;
}

function bindVoice(section) {
  if (!('speechSynthesis' in globalThis)) {
    section.querySelector('.settings-category-body').innerHTML = '<p class="muted">当前浏览器不支持语音播报。</p>';
    return;
  }
  const config = voiceConfig();
  const mode = $('[data-v099p-voice-mode]', section);
  const select = $('[data-v099p-voice]', section);
  const rate = $('[data-v099p-rate]', section);
  if (mode) mode.value = config.mode;
  populateVoiceSelect(section);
  if (section.dataset.v099pVoiceBound === '1') return;
  section.dataset.v099pVoiceBound = '1';
  rate?.addEventListener('input', () => { $('[data-v099p-rate-output]', section).textContent = Number(rate.value).toFixed(2); });
  $('[data-v099p-voice-preview]', section)?.addEventListener('click', () => {
    speechSynthesis.cancel();
    const draft = { mode: mode.value, voiceURI: select.value, rate: Number(rate.value) };
    const utterance = applyVoice(new SpeechSynthesisUtterance('富贵盒子语音播报试听。下一段，请按计划注水。'), draft);
    utterance.lang = 'zh-CN';
    (nativeSpeak || speechSynthesis.speak.bind(speechSynthesis))(utterance);
  });
  $('[data-v099p-voice-save]', section)?.addEventListener('click', () => {
    saveVoice({ mode: mode.value, voiceURI: select.value, rate: Number(rate.value) });
    section.open = false;
    openKey = '';
    toast('语音播报设置已保存', 'status-good');
  });
}

async function hydrateCloud(section) {
    const panel = $('[data-v099p-cloud-panel]', section);
    if (!panel || panel.dataset.hydrated === '1') return;
    panel.dataset.hydrated = '1';
    const [enabled, mode, last] = await Promise.all([
      getSetting(CLOUD_ENABLE_KEY, false), getSetting(CLOUD_MODE_KEY, 'manual'), getSetting(CLOUD_LAST_KEY, null)
    ]);
    $('[data-v099p-cloud-enabled]', panel).checked = Boolean(enabled);
    const modeInput = $(`input[name="v099pSyncMode"][value="${mode === 'auto' ? 'auto' : 'manual'}"]`, panel);
    if (modeInput) modeInput.checked = true;
    const status = $('[data-v099p-cloud-status]', panel);
    if (status) status.textContent = last?.at ? `上次同步：${new Date(last.at).toLocaleString('zh-CN')} · ${last.changed || 0}个变更分包` : '上次同步：尚未同步';
  }

  function cloudApi() {
    const api = globalThis.LuckyBeanCloudSyncV2;
    if (!api) throw new Error('云端同步模块尚未完成加载');
    return api;
  }

  function bindCloud(section) {
    const panel = $('[data-v099p-cloud-panel]', section);
    if (!panel || panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';
    $('[data-v099p-login]', panel)?.addEventListener('click', () => $('#emailIdentityBtn')?.click());
    $('[data-v099p-register]', panel)?.addEventListener('click', () => $('#wechatIdentityBtn')?.click());
    $('[data-v099p-unlock]', panel)?.addEventListener('click', event => {
      try { cloudApi().unlock(); event.currentTarget.textContent = '本次会话已解锁'; toast('云端密码已解锁', 'status-good'); }
      catch (error) { toast(error.message, 'status-bad'); }
    });
    const run = async type => {
      const status = $('[data-v099p-cloud-status]', panel);
      const buttons = $$('button', panel);
      buttons.forEach(button => { button.disabled = true; });
      try {
        status.textContent = type === 'upload' ? '正在编码、分包、压缩、加密并上传…' : '正在下载、校验、解密并合并…';
        const result = type === 'upload' ? await cloudApi().upload({ interactive: true }) : await cloudApi().download({ interactive: true });
        if (type === 'upload') {
          status.textContent = `同步完成：${result.changed || 0}个变更分包，上传${result.uploadedBytes || 0} B`;
          toast('云端增量同步完成', 'status-good');
        } else {
          status.textContent = `恢复完成：${result.packets || 0}个分包`;
          toast('云端数据已合并到本地', 'status-good');
          document.dispatchEvent(new CustomEvent('luckybean:request-app-refresh', { detail: { source: 'cloud-restore-settings' } }));
        }
      } catch (error) {
        status.textContent = error.message;
        toast(error.message, 'status-bad');
      } finally {
        const active = authSession();
        buttons.forEach(button => { button.disabled = false; });
        $('[data-v099p-unlock]', panel).disabled = !active;
        $('[data-v099p-sync-now]', panel).disabled = !active;
        $('[data-v099p-download]', panel).disabled = !active;
      }
    };
    $('[data-v099p-sync-now]', panel)?.addEventListener('click', () => run('upload'));
    $('[data-v099p-download]', panel)?.addEventListener('click', () => run('download'));
    $('[data-v099p-cloud-save]', panel)?.addEventListener('click', async () => {
      const enabled = $('[data-v099p-cloud-enabled]', panel).checked;
      const mode = $('input[name="v099pSyncMode"]:checked', panel)?.value || 'manual';
      if (enabled && !authSession()) return toast('开启云端前必须登录并激活账号', 'status-bad');
      try {
        if (enabled && mode === 'auto') cloudApi().unlock();
        await Promise.all([setSetting(CLOUD_ENABLE_KEY, enabled), setSetting(CLOUD_MODE_KEY, mode)]);
        section.open = false;
        openKey = '';
        toast(enabled ? `已设为${mode === 'auto' ? '自动' : '手动'}云端同步` : '已设为仅本地储存', 'status-good');
      } catch (error) { toast(error.message, 'status-bad'); }
    });
    hydrateCloud(section);
  }

  function installVoicePatch() {
    if (!('speechSynthesis' in globalThis) || nativeSpeak) return;
    voices = speechSynthesis.getVoices().filter(Boolean);
    nativeSpeak = speechSynthesis.speak.bind(speechSynthesis);
    try { speechSynthesis.speak = utterance => nativeSpeak(applyVoice(utterance)); } catch { globalThis.LuckyBeanApplyVoice = applyVoice; }
    speechSynthesis.addEventListener?.('voiceschanged', () => {
      voices = speechSynthesis.getVoices().filter(Boolean);
      const section = $('#v099iVoiceSettings');
      if (section) populateVoiceSelect(section);
    });
  }

  function patchSettingsWindowScroll() {
  const native = window.scrollTo.bind(window);
  if (window.__luckyBean099pScrollPatched) return;
  window.scrollTo = function patchedScrollTo(arg1, arg2) {
    if ($('#pageSettings.active') && typeof arg1 === 'object' && arg1) {
      return native({ ...arg1, behavior: 'auto' });
    }
    return native(arg1, arg2);
  };
  window.__luckyBean099pScrollPatched = true;
}


  function mount({ preserveOpen = false } = {}) {
    clearTimeout(mountTimer);
    const root = $('#settingsContent');
    const container = root?.querySelector(':scope > .settings-categories');
    if (!root || !container || !$('#pageSettings.active')) return;
    if (!preserveOpen) openKey = '';
    const scrollY = window.scrollY;
    const keys = new Set(topLevel(container).map(categoryKey));
    const ready = ['appearance', 'account', 'gear', 'voice', 'data', 'about'].every(key => keys.has(key));
    const sections = ready ? {
      appearance: container.querySelector(':scope > [data-settings-key="appearance"]'),
      account: container.querySelector(':scope > [data-settings-key="account"]'),
      gear: container.querySelector(':scope > [data-settings-key="gear"]'),
      voice: container.querySelector(':scope > [data-settings-key="voice"]'),
      data: container.querySelector(':scope > [data-settings-key="data"]'),
      about: container.querySelector(':scope > [data-settings-key="about"]')
    } : normalizeSections(container);
    if (!sections) return;
    bindAccordion(container);
    restoreOpen(container);
    applyAppearance(sections.appearance);
    bindVoice(sections.voice);
    bindCloud(sections.account);
    root.dataset.v099pRebuilt = '1';
    document.documentElement.classList.add('v099p-settings-active');
    requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'auto' }));
  }

  function scheduleMount({ preserveOpen = false, delays = [0, 80] } = {}) {
    delays.forEach(delay => setTimeout(() => mount({ preserveOpen }), delay));
  }

  document.addEventListener('click', event => {
    const nav = event.target.closest?.('[data-page-target]');
    if (nav) {
      const entering = nav.dataset.pageTarget === 'settings';
      document.documentElement.classList.toggle('v099p-settings-active', entering);
      if (entering) scheduleMount({ preserveOpen: false });
      return;
    }
    if (event.target.closest?.('#saveIdentityBtn,#saveFilterBtn,#deleteDripperBtn,#saveDripperBtn,#deleteFilterBtn,#saveGearTextBtn,#updateCodebookBtn')) {
      scheduleMount({ preserveOpen: true, delays: [100, 260] });
    }
  }, true);

  window.addEventListener('pageshow', () => {
    installVoicePatch();
    if ($('#pageSettings.active')) scheduleMount({ preserveOpen: false });
  });

  patchSettingsWindowScroll();
  installVoicePatch();
  if ($('#pageSettings.active')) scheduleMount({ preserveOpen: false });

  globalThis.LuckyBeanSettingsV099p = { mount, applyVoice, scheduleMount };
}
