if (!globalThis.__LuckyBeanV099iVoiceSettingsLoaded && 'speechSynthesis' in globalThis) {
  globalThis.__LuckyBeanV099iVoiceSettingsLoaded = true;

  const STORAGE_KEY = 'luckybean.voice.v099i';
  const synth = globalThis.speechSynthesis;
  const nativeSpeak = synth.speak.bind(synth);
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const FEMALE_HINT = /xiaoxiao|xiaoyi|huihui|yaoyao|tingting|meijia|sin-ji|samantha|victoria|female|女|晓晓|晓伊|慧慧|瑶瑶|婷婷/i;
  const MALE_HINT = /yunxi|yunyang|kangkang|zhiwei|daniel|alex|male|男|云希|云扬|康康|智威/i;
  let voices = [];
  let mountQueued = false;

  function loadConfig() {
    try {
      return { mode: 'auto', voiceURI: '', rate: 1.05, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch { return { mode: 'auto', voiceURI: '', rate: 1.05 }; }
  }

  function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  function refreshVoices() {
    voices = synth.getVoices().filter(Boolean);
    const panel = $('#v099iVoiceSettings');
    if (panel) populateVoiceSelect(panel);
  }

  function chineseVoices() {
    const chinese = voices.filter(voice => /^zh(?:-|_)/i.test(voice.lang || '') || /chinese|mandarin|中文|普通话/i.test(`${voice.name} ${voice.lang}`));
    return chinese.length ? chinese : voices;
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

  function applyVoice(utterance) {
    const config = loadConfig();
    const voice = pickVoice(config);
    if (voice) utterance.voice = voice;
    utterance.rate = Math.min(1.3, Math.max(.75, Number(config.rate) || 1.05));
    if (config.mode === 'female' && !voice?.name?.match(FEMALE_HINT)) utterance.pitch = Math.max(Number(utterance.pitch) || 1, 1.06);
    if (config.mode === 'male' && !voice?.name?.match(MALE_HINT)) utterance.pitch = Math.min(Number(utterance.pitch) || 1, .92);
    return utterance;
  }

  try {
    synth.speak = utterance => nativeSpeak(applyVoice(utterance));
  } catch {
    globalThis.LuckyBeanApplyVoice = applyVoice;
  }

  function voiceOptions() {
    return chineseVoices().map(voice => {
      const key = voice.voiceURI || `${voice.name}|${voice.lang}`;
      const local = voice.localService ? '本地' : '网络';
      return `<option value="${esc(key)}">${esc(voice.name)} · ${esc(voice.lang || '')} · ${local}</option>`;
    }).join('');
  }

  function populateVoiceSelect(panel) {
    const select = $('[data-v099i-voice]', panel);
    if (!select) return;
    const current = loadConfig().voiceURI;
    select.innerHTML = `<option value="">按声音倾向自动选择</option>${voiceOptions()}`;
    if ([...select.options].some(option => option.value === current)) select.value = current;
  }

  function mount() {
    mountQueued = false;
    const root = $('#settingsContent .settings-categories') || $('#settingsContent');
    if (!root || $('#v099iVoiceSettings')) return;
    const config = loadConfig();
    const details = document.createElement('details');
    details.className = 'settings-category';
    details.id = 'v099iVoiceSettings';
    details.innerHTML = `<summary><span>语音播报</span><small>声音、语速与试听</small></summary><div class="settings-category-body v099i-voice-body">
      <label class="field"><span>声音倾向</span><select class="control" data-v099i-voice-mode><option value="auto">自动</option><option value="female">偏女声</option><option value="male">偏男声</option></select></label>
      <label class="field"><span>当前设备声音</span><select class="control" data-v099i-voice><option value="">正在读取系统声音…</option></select></label>
      <label class="field"><span>语速 <output data-v099i-rate-output>${Number(config.rate).toFixed(2)}</output></span><input class="control" type="range" min="0.75" max="1.30" step="0.05" value="${Number(config.rate) || 1.05}" data-v099i-rate></label>
      <p class="muted small">浏览器只提供声音名称和语言，没有统一的男女声字段。“偏男声/偏女声”按系统声音名称匹配，具体音色取决于当前浏览器和操作系统。</p>
      <div class="v099i-voice-actions"><button class="button" type="button" data-v099i-preview>试听</button><button class="button primary" type="button" data-v099i-save>确定</button></div>
    </div>`;
    root.append(details);
    $('[data-v099i-voice-mode]', details).value = config.mode;
    populateVoiceSelect(details);
    const rate = $('[data-v099i-rate]', details);
    rate?.addEventListener('input', () => { $('[data-v099i-rate-output]', details).textContent = Number(rate.value).toFixed(2); });
    $('[data-v099i-preview]', details)?.addEventListener('click', () => {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance('富贵盒子语音播报试听。下一段，请按计划注水。');
      utterance.lang = 'zh-CN';
      const draft = {
        mode: $('[data-v099i-voice-mode]', details).value,
        voiceURI: $('[data-v099i-voice]', details).value,
        rate: Number(rate.value)
      };
      const old = loadConfig();
      saveConfig(draft);
      nativeSpeak(applyVoice(utterance));
      saveConfig(old);
    });
    $('[data-v099i-save]', details)?.addEventListener('click', () => {
      saveConfig({
        mode: $('[data-v099i-voice-mode]', details).value,
        voiceURI: $('[data-v099i-voice]', details).value,
        rate: Number(rate.value)
      });
      details.open = false;
      const toast = $('#toast');
      if (toast) {
        toast.textContent = '语音播报设置已保存';
        toast.className = 'toast show status-good';
        setTimeout(() => { toast.className = 'toast'; }, 2400);
      }
    });
  }

  function queueMount() {
    if (mountQueued) return;
    mountQueued = true;
    requestAnimationFrame(mount);
  }

  synth.addEventListener?.('voiceschanged', refreshVoices);
  refreshVoices();
  new MutationObserver(records => {
    if (records.some(record => record.target?.id === 'settingsContent' || [...record.addedNodes].some(node => node.nodeType === 1 && (node.id === 'settingsContent' || node.querySelector?.('#settingsContent'))))) queueMount();
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', event => { if (event.target.closest?.('[data-page-target="settings"]')) setTimeout(queueMount, 40); });
  queueMount();
  globalThis.LuckyBeanVoiceSettings = { applyVoice, refreshVoices };
}
