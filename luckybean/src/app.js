import { APP_VERSION, SCHEMA_VERSION, $, $$, uid, esc, clamp, todayISO, formatDate, freshness, downloadBlob, safeJsonParse, assertPlainObject, assertSafeJson, browserTitle, parseNumber } from './utils.js';
import { openDb, all, get, put, remove, bulkPut, getSetting, setSetting, clearAll, migrateLegacy } from './db.js';
import { loadCodebook, checkCodebookUpdate, makeIndex, displayName, optionsHtml, relatedRows, parseNaturalLanguage, REMOTE_CODEBOOK_URL } from './codebook.js';
import { CameraScanner, scanQrFile, decodeJsQrResult } from './qr.js';
import { computeFallbackPlan, requestPrivatePlan, validatePlan, FALLBACK_ENGINE_VERSION } from './brew-engine.js';

const PAGE_META = {
  beans: { nav: '藏', title: '豆藏', browser: '豆藏' },
  brew: { nav: '烹', title: '手作', browser: '手作' },
  sensory: { nav: '鉴', title: '品鉴', browser: '品鉴' },
  settings: { nav: '器', title: '器设', browser: '器设' }
};

const ROASTS = [
  ['RL-L0', '极浅烘'], ['RL-L1', '浅烘'], ['RL-L2', '浅中烘'], ['RL-L3', '中烘'],
  ['RL-L4', '中深烘'], ['RL-L5', '深烘'], ['RL-L6', '极深烘']
];
const ROAST_NAME = new Map(ROASTS);
const STATUS_COLOR = { resting: '#5f8a73', peak: '#de9a42', good: '#bc8d55', decline: '#77736c', urgent: '#575757' };
const DEFAULT_SETTINGS = {
  ui: { planVisualsExpanded: true },
  brew: { apiEndpoint: '', method: 'pourover', doseG: 15, ratio: 15.5, segments: 4, dripper: '平底滤杯', grinder: '', water: '平衡水' },
  identity: { mode: 'guest', nickname: '游客', publicId: '', verified: false, email: '', phone: '', wechat: '', qq: '' },
  groupMethod: 'country'
};
const SENSORY_NODES = [
  { id: 'floral', label: '花香', type: 'multi', groups: [{ label: '香气', options: ['无', '白花', '茉莉', '玫瑰', '橙花', '紫罗兰', '洋甘菊'] }] },
  { id: 'fruit', label: '果香', type: 'multi', groups: [{ label: '果香', options: ['无', '柑橘', '莓果', '桃子', '苹果', '葡萄', '热带水果', '干果'] }] },
  { id: 'other', label: '其他', type: 'multi', groups: [{ label: '其他风味', options: ['无', '茶感', '香料', '坚果', '巧克力', '酒香', '草本', '豆腐/豆味'] }] },
  { id: 'sweet', label: '甜', type: 'grouped', groups: [
    { label: '风味倾向', single: false, options: ['蜂蜜', '蔗糖', '红糖', '焦糖', '枫糖', '糖浆', '太妃糖'] },
    { label: '风味强度', single: true, options: ['无', '低', '适中', '高'] }
  ] },
  { id: 'acid', label: '酸', type: 'grouped', groups: [
    { label: '风味倾向 / 指向性', single: false, options: ['柑橘', '醋酸', '柠檬', '醋栗', '苹果', '葡萄'] },
    { label: '风味强度', single: true, options: ['无', '微酸', '圆润舒适', '尖锐'] }
  ] },
  { id: 'bitter', label: '苦', type: 'single', groups: [{ label: '苦感', single: true, options: ['无', '低', '适中', '偏高', '焦苦'] }] },
  { id: 'mouthfeel', label: '口感', type: 'multi', groups: [{ label: '质地', options: ['轻盈', '顺滑', '圆润', '奶油感', '厚重', '干涩', '收敛'] }] },
  { id: 'negative', label: '负面', type: 'multi', groups: [{ label: '负面风味', options: ['无', '纸味', '木质', '土味', '霉味', '发酵过度', '药感', '橡胶', '金属感'] }] },
  { id: 'score', label: '总分', type: 'score', groups: [] }
];

const state = {
  db: null, codebook: null, codebookIndex: null, codebookMeta: null,
  beans: [], brewSessions: [], sensoryRecords: [], inventoryEvents: [],
  settings: structuredClone(DEFAULT_SETTINGS), page: 'beans', selectedBeanId: null,
  filter: { search: '', country: '', process: '', flavors: [], sort: 'freshness', dir: 'asc' },
  recommendedBeanId: null, currentPlan: null, currentBrewInput: null,
  beanFormSource: null, beanFormDraft: null, cameraScanner: null,
  timer: { interval: null, paused: false, stageIndex: 0, remaining: 0 },
  evaluation: null, sensoryFilter: { beanId: '', minScore: '', maxScore: '', start: '', end: '', expanded: false }
};

let toastTimer;
function toast(message, kind = '') {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.className = 'toast', 2600);
}

function showOverlay(content, { full = false, id = 'dialog' } = {}) {
  const root = $('#overlayRoot');
  root.innerHTML = `<div class="overlay${full ? ' full' : ''}" data-overlay="${esc(id)}"><div class="dialog">${content}</div></div>`;
  const overlay = root.firstElementChild;
  overlay.addEventListener('click', event => { if (event.target === overlay) closeOverlay(); });
  return overlay;
}
function closeOverlay() {
  state.cameraScanner?.stop();
  state.cameraScanner = null;
  $('#overlayRoot').innerHTML = '';
}
function dialogHeader(title, subtitle = '') {
  return `<div class="dialog-header"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button class="close-button" type="button" data-close-overlay aria-label="关闭">×</button></div>`;
}
function bindClose(root = document) { $$('[data-close-overlay]', root).forEach(btn => btn.addEventListener('click', closeOverlay)); }

async function loadSettings() {
  const saved = await getSetting('app.settings', null);
  state.settings = {
    ...structuredClone(DEFAULT_SETTINGS), ...(saved || {}),
    ui: { ...DEFAULT_SETTINGS.ui, ...(saved?.ui || {}) },
    brew: { ...DEFAULT_SETTINGS.brew, ...(saved?.brew || {}) },
    identity: { ...DEFAULT_SETTINGS.identity, ...(saved?.identity || {}) }
  };
}
async function saveSettings() { await setSetting('app.settings', state.settings); }

async function refreshData() {
  [state.beans, state.brewSessions, state.sensoryRecords, state.inventoryEvents] = await Promise.all([
    all('beans'), all('brewSessions'), all('sensoryRecords'), all('inventoryEvents')
  ]);
  state.beans.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function migrateLegacyFlavorCodes() {
  const done = await getSetting('migration.flavors.brewion.v1', false);
  if (done) return { migrated: 0, unmapped: 0 };
  let mapping = {};
  try {
    const response = await fetch('./public/legacy-flavor-map.json');
    if (response.ok) mapping = (await response.json()).mapping || {};
  } catch { /* 保留原代码，稍后可再次迁移 */ }
  if (!Object.keys(mapping).length) return { migrated: 0, unmapped: 0 };
  let migrated = 0, unmapped = 0;
  for (const bean of state.beans) {
    const original = Array.isArray(bean.flavorCodes) ? bean.flavorCodes : [];
    const legacy = original.filter(code => String(code).startsWith('FL-'));
    if (!legacy.length) continue;
    const mapped = legacy.map(code => mapping[code]).filter(Boolean);
    const missing = legacy.filter(code => !mapping[code]);
    bean.flavorCodes = [...new Set([...original.filter(code => !String(code).startsWith('FL-')), ...mapped])];
    if (missing.length) { bean.legacyFlavorCodes = [...new Set([...(bean.legacyFlavorCodes || []), ...missing])]; unmapped += missing.length; }
    bean.updatedAt = new Date().toISOString();
    await put('beans', bean); migrated += 1;
  }
  await setSetting('migration.flavors.brewion.v1', true);
  if (migrated) await refreshData();
  return { migrated, unmapped };
}

function pageElement(page) { return $(`#page${page[0].toUpperCase()}${page.slice(1)}`); }
function switchPage(page, { preserveOverlay = false } = {}) {
  if (!PAGE_META[page]) return;
  if (!preserveOverlay) closeOverlay();
  state.page = page;
  $$('.page').forEach(node => node.classList.toggle('active', node.dataset.page === page));
  $$('.nav-button').forEach(button => {
    const active = button.dataset.pageTarget === page;
    button.classList.toggle('active', active);
    active ? button.setAttribute('aria-current', 'page') : button.removeAttribute('aria-current');
  });
  $('#fabWrap').classList.toggle('hidden', page !== 'beans');
  browserTitle(PAGE_META[page].browser);
  if (page === 'beans') renderBeans();
  if (page === 'brew') renderBrew();
  if (page === 'sensory') renderSensory();
  if (page === 'settings') renderSettings();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function identityLabel() {
  const identity = state.settings.identity;
  return identity.nickname?.trim()?.slice(0, 1) || (identity.mode === 'guest' ? '客' : '富');
}
function enterApp() {
  $('#loginScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  $('#profileBtn').textContent = identityLabel();
  switchPage('beans');
}

async function setIdentity(mode, details = {}) {
  const nickname = details.nickname || $('#loginNickname')?.value?.trim() || (mode === 'guest' ? '游客' : '本机用户');
  if (mode === 'wechat') {
    showInfoDialog('微信注册尚未接通', '微信 OAuth 需要后端回调、会话和隐私协议。本版本不伪造注册成功，可先以游客或本机邮箱身份使用。');
    return;
  }
  const publicId = state.settings.identity.publicId || `LB-${crypto.randomUUID?.().slice(0, 8).toUpperCase() || Date.now().toString(36).toUpperCase()}`;
  state.settings.identity = { ...state.settings.identity, ...details, mode, nickname, publicId, verified: false };
  await saveSettings();
  enterApp();
}

function openEmailIdentityDialog() {
  const overlay = showOverlay(`${dialogHeader('邮箱身份', '当前仅保存在本机，未发送验证邮件，也不代表真实注册')}<label class="field"><span>昵称</span><input id="identityNickname" class="control" maxlength="24" value="${esc($('#loginNickname')?.value || '')}"></label><label class="field"><span>邮箱</span><input id="identityEmail" class="control" type="email" autocomplete="email" placeholder="name@example.com"></label><div class="row end"><button id="saveEmailIdentityBtn" class="button primary" type="button">保存本机身份</button></div>`);
  bindClose(overlay);
  $('#saveEmailIdentityBtn').addEventListener('click', async () => {
    const email = $('#identityEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('邮箱格式无效', 'status-bad');
    await setIdentity('local-email', { email, nickname: $('#identityNickname').value.trim() || '本机用户' });
    closeOverlay();
  });
}

function showInfoDialog(title, message) {
  const overlay = showOverlay(`${dialogHeader(title)}<p class="muted">${esc(message)}</p><div class="row end"><button class="button primary" data-close-overlay type="button">知道了</button></div>`);
  bindClose(overlay);
}

async function seedDemo() {
  if (state.beans.length) return;
  const today = new Date();
  const demo = [
    ['花园瑰夏', 'CO-PA', 'VA-GE', 'PR-WA', 'RL-L1', 7, 150, 138, ['FV-100', 'FX-002', 'FV-093']],
    ['古吉日晒', 'CO-EA', 'VA-EH', 'PR-NA', 'RL-L1', 13, 200, 158, ['FV-009', 'FV-017', 'FV-096']],
    ['慧兰水洗', 'CO-CO', 'VA-CAT', 'PR-WA', 'RL-L2', 20, 250, 128, ['FV-015', 'FV-091', 'FV-086']],
    ['肯尼亚AA', 'CO-KE', 'VA-SL28', 'PR-WA', 'RL-L1', 28, 200, 108, ['FV-020', 'FV-025', 'FV-091']],
    ['曼特宁', 'CO-ID', 'VA-TY', 'PR-WH', 'RL-L4', 18, 250, 96, ['FV-082', 'FV-087', 'FV-079']],
    ['巴西黄波旁', 'CO-BR', 'VA-BOU', 'PR-NA', 'RL-L3', 32, 250, 218, ['FV-084', 'FV-092', 'FV-086']],
    ['云南厌氧', 'CO-CN', 'VA-CAT', 'PR-AN', 'RL-L2', 10, 150, 75, ['FV-036', 'FV-017', 'FV-093']]
  ].map((row, i) => {
    const date = new Date(today); date.setDate(date.getDate() - row[5]);
    return {
      id: uid('bean'), name: row[0], countryCode: row[1], varietyCode: row[2], processCode: row[3], roastCode: row[4],
      roastDate: date.toISOString().slice(0, 10), initialWeight: row[6], remainingWeight: row[7],
      price: 88 + i * 19, roasterName: '示例烘焙商', refrigerated: i === 3, flavorCodes: row[8],
      archived: false, source: 'demo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  });
  await bulkPut('beans', demo);
  await refreshData();
}

function codeName(table, code, fallback = '—') { return displayName(state.codebookIndex, table, code, fallback); }
function beanNameSummary(bean) {
  return `${codeName('countries', bean.countryCode, '未定产地')} · ${codeName('varieties', bean.varietyCode, '未定豆种')}`;
}
function scoreForBean(beanId) {
  const records = state.sensoryRecords.filter(r => r.beanId === beanId && Number.isFinite(Number(r.score)));
  if (!records.length) return 0;
  return records.reduce((sum, r) => sum + Number(r.score), 0) / records.length;
}

function recommendationScore(bean) {
  const sensory = scoreForBean(bean.id) || 70;
  const fresh = freshness(bean);
  const freshnessWeight = { resting: 45, peak: 100, good: 82, decline: 64, urgent: 52 }[fresh.key] || 50;
  const initial = Math.max(1, Number(bean.initialWeight) || Number(bean.remainingWeight) || 1);
  const usePriority = clamp(1 - (Number(bean.remainingWeight) || 0) / initial, 0, 1) * 100;
  return sensory * 0.55 + freshnessWeight * 0.3 + usePriority * 0.15;
}

function filteredBeans({ includeArchived = false } = {}) {
  let beans = state.beans.filter(bean => includeArchived ? Boolean(bean.archived) : !bean.archived && Number(bean.remainingWeight) > 0);
  const query = state.filter.search.trim().toLocaleLowerCase('zh-CN');
  if (query) beans = beans.filter(bean => [bean.name, bean.roasterName, bean.notes, codeName('countries', bean.countryCode, ''), codeName('regions', bean.regionCode, ''), codeName('entities', bean.entityCode, ''), codeName('varieties', bean.varietyCode, ''), codeName('processes', bean.processCode, '')].join(' ').toLocaleLowerCase('zh-CN').includes(query));
  if (state.filter.country) beans = beans.filter(bean => bean.countryCode === state.filter.country);
  if (state.filter.process) beans = beans.filter(bean => bean.processCode === state.filter.process);
  if (state.filter.flavors?.length) beans = beans.filter(bean => state.filter.flavors.some(code => (bean.flavorCodes || []).includes(code)));
  const direction = state.filter.dir === 'desc' ? -1 : 1;
  const value = bean => {
    if (state.filter.sort === 'name') return bean.name || '';
    if (state.filter.sort === 'roastDate') return bean.roastDate || '';
    if (state.filter.sort === 'remaining') return Number(bean.remainingWeight) || 0;
    if (state.filter.sort === 'price') return Number(bean.price) || 0;
    if (state.filter.sort === 'score') return scoreForBean(bean.id);
    if (state.filter.sort === 'recommended') return recommendationScore(bean);
    return freshness(bean).remaining;
  };
  beans.sort((a, b) => {
    const av = value(a), bv = value(b);
    return typeof av === 'string' ? av.localeCompare(bv, 'zh-CN') * direction : (av - bv) * direction;
  });
  return beans;
}

function groupKey(bean, method) {
  if (method === 'variety') return codeName('varieties', bean.varietyCode, '未记录豆种');
  if (method === 'roast') return ROAST_NAME.get(bean.roastCode) || '未记录烘焙度';
  if (method === 'process') return codeName('processes', bean.processCode, '未记录工法');
  return codeName('countries', bean.countryCode, '未记录国家');
}
function beanCardHtml(bean) {
  const fresh = freshness(bean);
  const score = scoreForBean(bean.id);
  return `<article class="bean-card${bean.id === state.recommendedBeanId ? ' recommended' : ''}${bean.archived ? ' archived' : ''}" data-bean-id="${esc(bean.id)}" tabindex="0">
    <span class="bean-status-line" style="--status:${STATUS_COLOR[fresh.key] || '#777'}"></span>
    <div class="bean-card-header"><div class="grow"><h3>${esc(bean.name)}</h3><div class="origin">${esc(beanNameSummary(bean))}</div></div><button class="cup-action" type="button" data-brew-bean="${esc(bean.id)}" aria-label="用这只豆整一杯"><svg viewBox="0 0 24 24"><path d="M5 5h14l-2 10H7L5 5Z"></path><path d="M8 19h8M9 15v4M15 15v4"></path></svg></button></div>
    <div class="meta"><span>${esc(ROAST_NAME.get(bean.roastCode) || '烘焙度未记')}</span><span>${esc(codeName('processes', bean.processCode, '工法未记'))}</span>${bean.refrigerated ? '<span>冷藏</span>' : ''}</div>
    <div class="bean-card-footer"><div><div class="small muted">${esc(fresh.label)} · ${formatDate(bean.roastDate)}</div><strong>${Number(bean.remainingWeight || 0).toFixed(1)}g</strong></div><div class="small muted">${score ? `${score.toFixed(1)} 分` : '暂无评分'}</div></div>
  </article>`;
}

function renderBeans() {
  const container = $('#beanGroups');
  const beans = filteredBeans();
  const filterParts = [];
  if (state.filter.search) filterParts.push(`关键词：${state.filter.search}`);
  if (state.filter.country) filterParts.push(`国家：${codeName('countries', state.filter.country)}`);
  if (state.filter.process) filterParts.push(`工法：${codeName('processes', state.filter.process)}`);
  if (state.filter.flavors?.length) filterParts.push(`风味：${state.filter.flavors.length}项`);
  const bar = $('#activeFilterBar');
  bar.classList.toggle('hidden', !filterParts.length);
  bar.innerHTML = filterParts.length ? `${filterParts.map(v => `<span class="tag">${esc(v)}</span>`).join('')}<button class="button subtle small" id="clearActiveFilters" type="button">清除</button>` : '';
  $('#filterSummaryBtn').textContent = filterParts.length ? `筛选 ${filterParts.length}` : '筛选';
  if (!beans.length) {
    container.innerHTML = `<div class="empty-state"><strong>盒子里没有符合条件的豆卡</strong><p>使用右下角 +1 录入，或清除筛选条件。</p></div>`;
    return;
  }
  const groupMethod = state.settings.groupMethod || 'country';
  if (beans.length <= 6) {
    container.innerHTML = `<div class="bean-grid">${beans.map(beanCardHtml).join('')}</div>`;
    return;
  }
  const groups = new Map();
  for (const bean of beans) {
    const key = groupKey(bean, groupMethod);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bean);
  }
  container.innerHTML = [...groups.entries()].map(([label, items]) => `<section class="group-section"><div class="group-heading"><h2>${esc(label)}</h2><span>${items.length}只</span></div><div class="bean-grid">${items.map(beanCardHtml).join('')}</div></section>`).join('');
}

function positionPopup(anchor, popup, { above = false } = {}) {
  const rect = anchor.getBoundingClientRect();
  if (above) {
    popup.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
    popup.style.bottom = `${Math.max(90, window.innerHeight - rect.top + 8)}px`;
  } else {
    popup.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
    popup.style.top = `${rect.bottom + 6}px`;
  }
}
function closePopups() { $$('.popup-menu,.recommend-menu').forEach(node => node.remove()); }
function openGroupMenu() {
  closePopups();
  const popup = document.createElement('div');
  popup.className = 'popup-menu';
  popup.innerHTML = [['country', '按国家'], ['variety', '按豆种'], ['roast', '按烘焙度'], ['process', '按处理工法']].map(([value, label]) => `<button type="button" data-group-method="${value}">${label}${state.settings.groupMethod === value ? ' ✓' : ''}</button>`).join('');
  document.body.append(popup); positionPopup($('#groupBtn'), popup);
  popup.addEventListener('click', async event => {
    const button = event.target.closest('[data-group-method]'); if (!button) return;
    state.settings.groupMethod = button.dataset.groupMethod; await saveSettings(); closePopups(); renderBeans();
  });
}
function openManageMenu() {
  closePopups();
  const popup = document.createElement('div'); popup.className = 'popup-menu';
  popup.innerHTML = `<button type="button" data-manage-action="export">导出数据</button><button type="button" data-manage-action="import">导入数据</button><button type="button" data-manage-action="history">打开老黄历</button>`;
  document.body.append(popup); positionPopup($('#manageBtn'), popup);
}

function openSearchDialog() {
  closePopups();
  const selectedFlavors = new Set(state.filter.flavors || []);
  const content = `${dialogHeader('搜索豆卡', '文字、标签、排序和方向统一在此设置')}
    <div class="form-grid">
      <div class="form-field"><label>关键词</label><input id="searchInput" class="control" value="${esc(state.filter.search)}" placeholder="豆名、产地、烘焙商等"></div>
      <div class="form-field"><label>国家标签</label><select id="searchCountry" class="control">${optionsHtml(state.codebook.countries, state.filter.country, 1, '全部国家')}</select></div>
      <div class="form-field"><label>处理工法</label><select id="searchProcess" class="control">${optionsHtml(state.codebook.processes, state.filter.process, 1, '全部工法')}</select></div>
      <div class="form-field"><label>排序方式</label><select id="searchSort" class="control">${[['recommended','推荐'],['freshness','赏味期'],['name','名称'],['roastDate','烘焙日期'],['remaining','剩余克重'],['price','价格'],['score','品鉴得分']].map(([v,l])=>`<option value="${v}"${state.filter.sort===v?' selected':''}>${l}</option>`).join('')}</select></div>
      <div class="form-field"><label>方向</label><select id="searchDir" class="control"><option value="asc"${state.filter.dir==='asc'?' selected':''}>升序</option><option value="desc"${state.filter.dir==='desc'?' selected':''}>降序</option></select></div>
    </div>
    <details class="details-block"${selectedFlavors.size ? ' open' : ''}><summary>风味标签（多选，任一匹配）</summary><div class="details-content"><div class="flavor-grid compact">${state.codebook.flavors.map(row=>`<button type="button" class="flavor-button filter-flavor${selectedFlavors.has(row[0])?' selected':''}" data-filter-flavor="${esc(row[0])}">${esc(row[1])}</button>`).join('')}</div></div></details>
    <div class="row end"><button id="resetSearchBtn" class="button subtle" type="button">重置</button><button id="applySearchBtn" class="button primary" type="button">确认</button></div>`;
  const overlay = showOverlay(content, { full: true, id: 'bean-search' }); bindClose(overlay);
  overlay.addEventListener('click', event => {
    const button = event.target.closest('[data-filter-flavor]');
    if (button) button.classList.toggle('selected');
  });
  $('#resetSearchBtn').addEventListener('click', () => {
    state.filter = { search: '', country: '', process: '', flavors: [], sort: 'freshness', dir: 'asc' }; closeOverlay(); renderBeans();
  });
  $('#applySearchBtn').addEventListener('click', () => {
    state.filter = {
      search: $('#searchInput').value.trim(), country: $('#searchCountry').value, process: $('#searchProcess').value,
      flavors: $$('[data-filter-flavor].selected', overlay).map(button => button.dataset.filterFlavor),
      sort: $('#searchSort').value, dir: $('#searchDir').value
    };
    closeOverlay(); renderBeans();
  });
}

function openRecommendMenu() {
  closePopups();
  const popup = document.createElement('div'); popup.className = 'recommend-menu';
  const items = [
    ['preference', '喜好', '#c74f4f', false], ['freshness', '赏味期', '#5e9a68', false], ['price', '价格', '#c9a45f', false],
    ['remaining', '余粮', '#f1f1ed', false], ['random', '点兵点将', '#e88b3d', true]
  ];
  popup.innerHTML = items.map(([mode, label, color, large]) => `<button type="button" class="recommend-option" data-recommend-mode="${mode}" aria-label="${label}"><span class="recommend-label">${label}</span><span class="recommend-dot${large?' random':''}" style="background:${color}"></span></button>`).join('');
  document.body.append(popup); positionPopup($('#fabRecommendBtn'), popup, { above: true });
}

async function recommendBean(mode) {
  closePopups();
  const beans = filteredBeans();
  if (!beans.length) return toast('没有可推荐的豆卡');
  let selected;
  if (mode === 'preference') selected = [...beans].sort((a,b)=>scoreForBean(b.id)-scoreForBean(a.id))[0];
  else if (mode === 'freshness') selected = [...beans].sort((a,b)=>freshness(a).remaining-freshness(b).remaining)[0];
  else if (mode === 'price') selected = [...beans].sort((a,b)=>(Number(b.price)||0)-(Number(a.price)||0))[0];
  else if (mode === 'remaining') selected = [...beans].sort((a,b)=>(Number(a.remainingWeight)||0)-(Number(b.remainingWeight)||0))[0];
  else {
    const n = Math.floor(Math.random() * 6) + 4;
    const cards = $$('.bean-card');
    for (let i = 0; i < Math.min(cards.length * 2, n + 6); i++) {
      cards.forEach(card => card.classList.remove('recommended'));
      cards[i % cards.length]?.classList.add('recommended');
      await new Promise(resolve => setTimeout(resolve, 85 + i * 5));
    }
    selected = beans[(n - 1) % beans.length];
  }
  state.recommendedBeanId = selected.id; renderBeans();
  requestAnimationFrame(() => document.querySelector(`[data-bean-id="${CSS.escape(selected.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  toast(`推荐：${selected.name}`);
}

function openAddMenu() {
  closePopups();
  const popup = document.createElement('div'); popup.className = 'popup-menu';
  popup.innerHTML = `<button type="button" data-add-mode="photo">拍照识别</button><button type="button" data-add-mode="qr">二维码识别</button><button type="button" data-add-mode="text">文字识别</button>`;
  document.body.append(popup); positionPopup($('#fabAddBtn'), popup, { above: true });
}

function selectOptions(rows, selected, labelIndex = 1, blank = '请选择') { return optionsHtml(rows, selected, labelIndex, blank); }
function formValue(id) { return $(`#${id}`)?.value?.trim?.() ?? ''; }
function selectedFlavorCodes(root = document) { return $$('[data-flavor-code].selected', root).map(button => button.dataset.flavorCode); }

function beanFormHtml(bean = {}, source = {}) {
  const regions = relatedRows(state.codebook, 'regions', bean.countryCode);
  const entities = relatedRows(state.codebook, 'entities', bean.countryCode);
  const flavors = bean.flavorCodes || [];
  return `${dialogHeader(bean.id ? '编辑豆卡' : '新增豆卡', `来源：${source.type || bean.source || '手工录入'} · 编码表 v${state.codebookMeta?.version || state.codebook.version || '6'}`)}
    <form id="beanForm" novalidate>
      <div class="form-grid">
        ${fieldHtml('beanName','豆卡名称',`<input id="beanName" class="control" maxlength="40" value="${esc(bean.name || '')}">`,'required')}
        ${fieldHtml('beanCountry','国家',`<select id="beanCountry" class="control">${selectOptions(state.codebook.countries,bean.countryCode)}</select>`,'required')}
        ${fieldHtml('beanRegion','产区',`<select id="beanRegion" class="control">${selectOptions(regions,bean.regionCode)}</select>`)}
        ${fieldHtml('beanEntity','庄园 / 处理站',`<select id="beanEntity" class="control">${selectOptions(entities,bean.entityCode,3)}</select>`)}
        ${fieldHtml('beanVariety','豆种',`<select id="beanVariety" class="control">${selectOptions(state.codebook.varieties,bean.varietyCode)}</select>`,'required')}
        ${fieldHtml('beanProcess','处理法',`<select id="beanProcess" class="control">${selectOptions(state.codebook.processes,bean.processCode)}</select>`,'required')}
        ${fieldHtml('beanRoast','烘焙度',`<select id="beanRoast" class="control">${ROASTS.map(([v,l])=>`<option value="${v}"${bean.roastCode===v?' selected':''}>${l}</option>`).join('')}</select>`,'required')}
        ${fieldHtml('beanRoastDate','烘焙日期',`<input id="beanRoastDate" class="control" type="date" value="${esc(bean.roastDate || todayISO())}">`,'required')}
        ${fieldHtml('beanInitialWeight','初始克重',`<input id="beanInitialWeight" class="control" type="number" min="1" max="10000" step="0.1" value="${esc(bean.initialWeight || '')}">`,'required')}
        ${fieldHtml('beanRefrigerated','是否冷藏',`<select id="beanRefrigerated" class="control"><option value="false"${!bean.refrigerated?' selected':''}>否</option><option value="true"${bean.refrigerated?' selected':''}>是</option></select>`,'recommended')}
        ${fieldHtml('beanPrice','购买价格',`<input id="beanPrice" class="control" type="number" min="0" step="0.01" value="${esc(bean.price || '')}">`,'recommended')}
        ${fieldHtml('beanRoaster','烘焙商',`<input id="beanRoaster" class="control" maxlength="60" value="${esc(bean.roasterName || bean.roaster || '')}">`,'recommended')}
        ${fieldHtml('beanAltitude','海拔',`<input id="beanAltitude" class="control" type="number" min="0" max="5000" value="${esc(bean.altitude || '')}">`)}
        ${fieldHtml('beanNotes','备注',`<input id="beanNotes" class="control" maxlength="300" value="${esc(bean.notes || '')}">`)}
      </div>
      <section class="panel"><div class="panel-title"><div><h3>风味标签</h3><p>统一使用 BrewIon 风味编码</p></div><button id="editFlavorsBtn" class="button" type="button">编辑风味标签</button></div><div id="formFlavorSummary" class="flavor-summary">${flavors.map(code=>`<span class="tag" data-summary-code="${esc(code)}">${esc(codeName('flavors',code,code))}</span>`).join('') || '<span class="muted small">尚未选择</span>'}</div></section>
      ${source.evidence ? evidenceHtml(source.evidence, source.confidence) : ''}
      <div class="row"><button id="beanFormBackBtn" class="button subtle" type="button">返回</button><span class="grow"></span><button class="button primary" type="submit">保存豆卡</button></div>
    </form>`;
}
function fieldHtml(id, label, control, level = '') {
  const badge = level === 'required' ? '<span class="badge required">*必填</span>' : (level === 'recommended' ? '<span class="badge">推荐</span>' : '');
  return `<div class="form-field${level === 'required' ? ' required' : ''}${level === 'recommended' ? ' is-recommended' : ''}" data-field="${id}"><label for="${id}"><span>${label}</span>${badge}</label>${control}</div>`;
}
function evidenceHtml(evidence = {}, confidence = {}) {
  const labels = { countryCode:'国家',regionCode:'产区',entityCode:'庄园/处理站',varietyCode:'豆种',processCode:'处理法',roastCode:'烘焙度',roastDate:'烘焙日期',altitude:'海拔',initialWeight:'初始克重',price:'价格' };
  const rows = Object.entries(evidence).map(([key, value]) => `<div class="evidence-row"><span>${esc(labels[key]||key)}</span><span>${esc(value)}</span><span>${Math.round((confidence[key]||0)*100)}%</span></div>`).join('');
  return rows ? `<section class="panel"><div class="panel-title"><div><h3>识别证据</h3><p>低置信度字段请人工确认</p></div></div><div class="text-evidence">${rows}</div></section>` : '';
}

function openBeanForm(bean = {}, source = { type: 'manual' }) {
  state.beanFormSource = source;
  state.beanFormDraft = structuredClone(bean);
  const overlay = showOverlay(beanFormHtml(bean, source), { full: true, id: 'bean-form' }); bindClose(overlay);
  const form = $('#beanForm');
  $('#beanCountry').addEventListener('change', () => {
    const country = $('#beanCountry').value;
    $('#beanRegion').innerHTML = selectOptions(relatedRows(state.codebook, 'regions', country), '');
    $('#beanEntity').innerHTML = selectOptions(relatedRows(state.codebook, 'entities', country), '', 3);
  });
  $('#editFlavorsBtn').addEventListener('click', () => openFlavorEditor(selectedSummaryCodes(), bean, source));
  $('#beanFormBackBtn').addEventListener('click', () => {
    if (source.type === 'text') openTextRecognition(source.text || '', captureBeanFormDraft()); else closeOverlay();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const required = [['beanName','豆卡名称'],['beanCountry','国家'],['beanVariety','豆种'],['beanProcess','处理法'],['beanRoast','烘焙度'],['beanRoastDate','烘焙日期'],['beanInitialWeight','初始克重']];
    for (const [id,label] of required) if (!formValue(id)) return toast(`请填写${label}`, 'status-bad');
    const initialWeight = parseNumber(formValue('beanInitialWeight'));
    if (initialWeight <= 0) return toast('初始克重必须大于 0', 'status-bad');
    const now = new Date().toISOString();
    const record = {
      ...bean, id: bean.id || uid('bean'), name: formValue('beanName'), countryCode: formValue('beanCountry'), regionCode: formValue('beanRegion'), entityCode: formValue('beanEntity'),
      varietyCode: formValue('beanVariety'), processCode: formValue('beanProcess'), roastCode: formValue('beanRoast'), roastDate: formValue('beanRoastDate'), initialWeight,
      remainingWeight: bean.id ? Number(bean.remainingWeight) : initialWeight, refrigerated: formValue('beanRefrigerated') === 'true', freezeDate: formValue('beanRefrigerated') === 'true' ? (bean.freezeDate || todayISO()) : '',
      price: parseNumber(formValue('beanPrice'), 0), roasterName: formValue('beanRoaster'), altitude: parseNumber(formValue('beanAltitude'), 0), notes: formValue('beanNotes'),
      flavorCodes: selectedSummaryCodes(), archived: Boolean(bean.archived), source: source.type || bean.source || 'manual',
      codebookSchemaVersion: Number(state.codebook._schemaVersion || 1), codebookDataVersion: String(state.codebook.version || '6'),
      createdAt: bean.createdAt || now, updatedAt: now
    };
    await put('beans', record); await refreshData(); closeOverlay(); renderBeans(); toast(bean.id ? '豆卡已更新' : '豆卡已加入盒子', 'status-good');
  });
}
function selectedSummaryCodes() { return $$('#formFlavorSummary [data-summary-code]').map(node => node.dataset.summaryCode); }
function captureBeanFormDraft() {
  return { ...state.beanFormDraft, name: formValue('beanName'), countryCode: formValue('beanCountry'), regionCode: formValue('beanRegion'), entityCode: formValue('beanEntity'), varietyCode: formValue('beanVariety'), processCode: formValue('beanProcess'), roastCode: formValue('beanRoast'), roastDate: formValue('beanRoastDate'), initialWeight: formValue('beanInitialWeight'), refrigerated: formValue('beanRefrigerated') === 'true', price: formValue('beanPrice'), roasterName: formValue('beanRoaster'), altitude: formValue('beanAltitude'), notes: formValue('beanNotes'), flavorCodes: selectedSummaryCodes() };
}
function openFlavorEditor(selected, bean, source) {
  const draft = captureBeanFormDraft();
  const set = new Set(selected);
  const content = `${dialogHeader('编辑风味标签', '选择后返回豆卡表单，最多 12 项')}<div class="flavor-grid">${state.codebook.flavors.map(row=>`<button type="button" class="flavor-button${set.has(row[0])?' selected':''}" data-flavor-code="${esc(row[0])}">${esc(row[1])}</button>`).join('')}</div><div class="row end"><button id="clearFlavorsBtn" class="button subtle" type="button">清空</button><button id="confirmFlavorsBtn" class="button primary" type="button">确定</button></div>`;
  const overlay = showOverlay(content, { full: true, id: 'flavors' }); bindClose(overlay);
  overlay.addEventListener('click', event => {
    const button = event.target.closest('[data-flavor-code]'); if (!button) return;
    if (!button.classList.contains('selected') && $$('.flavor-button.selected', overlay).length >= 12) return toast('风味标签最多选择 12 项');
    button.classList.toggle('selected');
  });
  $('#clearFlavorsBtn').addEventListener('click', () => $$('.flavor-button.selected', overlay).forEach(button => button.classList.remove('selected')));
  $('#confirmFlavorsBtn').addEventListener('click', () => {
    draft.flavorCodes = selectedFlavorCodes(overlay); openBeanForm(draft, source);
  });
}

function openTextRecognition(text = '', existingDraft = null) {
  if (existingDraft) state.beanFormDraft = structuredClone(existingDraft);
  const content = `${dialogHeader('文字识别', '粘贴豆袋文字，系统按 BrewIon 词表提取字段')}<label class="field"><span>豆袋文字</span><textarea id="recognitionText" class="control" placeholder="例如：埃塞俄比亚 古吉 日晒 Heirloom，浅烘，2026-07-20，海拔2100m，净重150g，茉莉、蓝莓、蜂蜜">${esc(text)}</textarea></label><label class="toggle"><input id="overwriteRecognizedFields" type="checkbox" checked>识别结果覆盖已有表单字段</label><p class="muted small">语音识别可能由浏览器联网服务处理；识别证据和置信度会在表单中显示。</p><div class="row"><button id="speechTextBtn" class="button" type="button">语音输入</button><button id="clearRecognitionTextBtn" class="button subtle" type="button">清空</button><button id="manualBeanFormBtn" class="button subtle" type="button">直接填表</button><span class="grow"></span><button id="parseTextBtn" class="button primary" type="button">识别并填表</button></div>`;
  const overlay = showOverlay(content, { full: true, id: 'text-recognition' }); bindClose(overlay);
  $('#clearRecognitionTextBtn').addEventListener('click', () => { $('#recognitionText').value = ''; $('#recognitionText').focus(); });
  $('#manualBeanFormBtn').addEventListener('click', () => openBeanForm(existingDraft || {}, { type: 'manual' }));
  $('#parseTextBtn').addEventListener('click', () => {
    const sourceText = $('#recognitionText').value.trim();
    if (!sourceText) return toast('请先输入文字');
    const parsed = parseNaturalLanguage(sourceText, state.codebook);
    const existing = existingDraft || {};
    const overwrite = $('#overwriteRecognizedFields').checked;
    const merged = overwrite ? { ...existing, ...parsed } : { ...parsed, ...Object.fromEntries(Object.entries(existing).filter(([, value]) => value !== '' && value !== null && value !== undefined)) };
    merged.name = merged.name || [codeName('countries', merged.countryCode, ''), codeName('varieties', merged.varietyCode, '')].filter(Boolean).join(' ') || '新豆卡';
    merged.roastDate ||= todayISO();
    openBeanForm(merged, { type: 'text', text: sourceText, evidence: parsed.evidence, confidence: parsed.confidence });
  });
  $('#speechTextBtn').addEventListener('click', startSpeechRecognition);
}

function startSpeechRecognition() {
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Recognition) return toast('当前浏览器不支持语音识别');
  const recognition = new Recognition(); recognition.lang = 'zh-CN'; recognition.interimResults = false;
  recognition.onresult = event => { $('#recognitionText').value += `${$('#recognitionText').value ? ' ' : ''}${event.results[0][0].transcript}`; };
  recognition.onerror = () => toast('语音识别失败'); recognition.start(); toast('请开始说话');
}

function openCameraDialog() {
  const content = `${dialogHeader('二维码识别', '实时扫描 BrewIon 二维码')}<video id="cameraVideo" class="camera-video" playsinline muted></video><p id="cameraStatus" class="muted small">正在申请相机权限…</p><div class="row end"><button id="cameraFileBtn" class="button" type="button">改用图片</button></div>`;
  const overlay = showOverlay(content, { full: true, id: 'camera' }); bindClose(overlay);
  state.cameraScanner = new CameraScanner($('#cameraVideo'), result => handleQrResult(result), status => $('#cameraStatus').textContent = status);
  state.cameraScanner.start().catch(error => { $('#cameraStatus').textContent = error.message; });
  $('#cameraFileBtn').addEventListener('click', () => $('#qrImageInput').click());
}
async function handleQrResult(result) {
  try {
    const decoded = decodeJsQrResult(result, state.codebook);
    decoded.name = [codeName('countries', decoded.countryCode, ''), codeName('varieties', decoded.varietyCode, '')].filter(Boolean).join(' ') || '扫码豆卡';
    decoded.notes = [`扫码识别`, decoded.agtron ? `Agtron ${decoded.agtron}` : '', decoded.harvestYear ? `产季 ${decoded.harvestYear}` : ''].filter(Boolean).join('；');
    openBeanForm(decoded, { type: 'qr' }); toast('二维码解码成功', 'status-good');
  } catch (error) { toast(error.message, 'status-bad'); }
}
async function handleQrFile(file) {
  if (!file) return;
  try { const result = await scanQrFile(file); await handleQrResult(result); }
  catch (error) { toast(error.message, 'status-bad'); }
  finally { $('#qrImageInput').value = ''; }
}

function detailBean(beanId) {
  const bean = state.beans.find(item => item.id === beanId); if (!bean) return;
  state.selectedBeanId = bean.id;
  const fresh = freshness(bean);
  const totalRange = 85;
  const marker = clamp(((Math.max(0, -fresh.remaining) + 25) / totalRange) * 100, 2, 98);
  const flavors = (bean.flavorCodes || []).map(code => `<span class="tag">${esc(codeName('flavors', code, code))}</span>`).join('');
  const records = state.sensoryRecords.filter(r => r.beanId === bean.id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,3);
  const content = `${dialogHeader(bean.name, beanNameSummary(bean))}
    <div class="detail-layout"><div class="freshness-card"><div><div class="small muted">赏味状态</div><h2>${esc(fresh.label)}</h2><p class="muted small">烘焙日期 ${formatDate(bean.roastDate)} · 剩余 ${Number(bean.remainingWeight||0).toFixed(1)}g</p></div><div><div class="freshness-bar"><span class="freshness-marker" style="left:${marker}%"></span></div><div class="row small muted"><span>养豆</span><span class="grow"></span><span>高峰</span><span class="grow"></span><span>衰减</span></div></div></div>
    <div class="management-stack"><button id="correctWeightBtn" class="button" type="button">修正克重</button><button id="toggleColdBtn" class="button${bean.refrigerated?' bluegray':''}" type="button">${bean.refrigerated?'解除冷藏':'设为冷藏'}</button><button id="archiveBeanBtn" class="button brown" type="button">${bean.archived?'移出老黄历':'放老黄历'}</button></div></div>
    <div class="detail-tags">${flavors}</div>
    <section class="panel"><div class="panel-title"><div><h3>最近品鉴</h3></div></div>${records.length ? records.map(r=>`<div class="record-item"><span>${formatDate(r.createdAt)}</span><span>${esc((r.summary||[]).join(' · '))}</span><strong>${Number(r.score||0).toFixed(1)}</strong></div>`).join('') : '<p class="muted small">尚无品鉴记录</p>'}</section>
    <div class="detail-actions"><button id="brewThisBeanBtn" class="button primary" type="button">整一杯</button><button id="editBeanBtn" class="square-icon-button" type="button" aria-label="编辑"><svg viewBox="0 0 24 24"><path d="m4 16 12-12 4 4L8 20H4v-4Z"></path></svg></button><button id="copyBeanBtn" class="square-icon-button" type="button" aria-label="复制豆卡"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V5H5v11h3"></path></svg></button><button id="shareBeanBtn" class="square-icon-button" type="button" aria-label="分享"><svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2"></circle><circle cx="18" cy="6" r="2"></circle><circle cx="18" cy="18" r="2"></circle><path d="m8 11 8-4M8 13l8 4"></path></svg></button></div>`;
  const overlay = showOverlay(content, { id: 'bean-detail' }); bindClose(overlay);
  $('#correctWeightBtn').addEventListener('click', () => correctWeightDialog(bean));
  $('#toggleColdBtn').addEventListener('click', async () => { bean.refrigerated = !bean.refrigerated; bean.freezeDate = bean.refrigerated ? todayISO() : ''; bean.updatedAt = new Date().toISOString(); await put('beans', bean); await refreshData(); detailBean(bean.id); });
  $('#archiveBeanBtn').addEventListener('click', async () => { bean.archived = !bean.archived; bean.updatedAt = new Date().toISOString(); await put('beans', bean); await refreshData(); closeOverlay(); renderBeans(); toast(bean.archived?'已放入老黄历':'已恢复到豆藏'); });
  $('#brewThisBeanBtn').addEventListener('click', () => { closeOverlay(); state.selectedBeanId = bean.id; switchPage('brew'); });
  $('#editBeanBtn').addEventListener('click', () => openBeanForm(bean, { type: 'manual' }));
  $('#copyBeanBtn').addEventListener('click', async () => { const copy = { ...bean, id: undefined, name: `${bean.name} 复制`, createdAt: undefined, updatedAt: undefined, remainingWeight: bean.initialWeight }; openBeanForm(copy, { type: 'copy' }); });
  $('#shareBeanBtn').addEventListener('click', () => openShareDialog(bean));
}

function correctWeightDialog(bean) {
  const overlay = showOverlay(`${dialogHeader('修正克重', bean.name)}<label class="field"><span>当前剩余克重</span><input id="correctWeightInput" class="control" type="number" min="0" step="0.1" value="${Number(bean.remainingWeight||0)}"></label><label class="field"><span>修正原因</span><input id="correctWeightNote" class="control" maxlength="100" placeholder="盘点、撒粉、录入误差等"></label><div class="row end"><button id="saveWeightBtn" class="button primary" type="button">记录修正</button></div>`);
  bindClose(overlay);
  $('#saveWeightBtn').addEventListener('click', async () => {
    const next = parseNumber($('#correctWeightInput').value, -1); if (next < 0) return toast('克重不能小于 0');
    const delta = next - Number(bean.remainingWeight || 0);
    const event = { id: uid('inv'), beanId: bean.id, type: 'correct', amountG: delta, resultingWeightG: next, note: $('#correctWeightNote').value.trim(), createdAt: new Date().toISOString() };
    bean.remainingWeight = next; bean.updatedAt = new Date().toISOString(); await Promise.all([put('inventoryEvents', event), put('beans', bean)]); await refreshData(); detailBean(bean.id); toast('克重修正已写入日志');
  });
}

function buildBrewInput(bean) {
  return {
    schemaVersion: 1,
    bean: { countryCode: bean.countryCode, regionCode: bean.regionCode, entityCode: bean.entityCode, varietyCode: bean.varietyCode, processCode: bean.processCode, roastCode: bean.roastCode, roastDate: bean.roastDate },
    brew: { method: $('#brewMethod')?.value || 'pourover', doseG: parseNumber($('#brewDose')?.value, 15), ratio: parseNumber($('#brewRatio')?.value, 15.5), segments: parseNumber($('#brewSegments')?.value, 4), dripperCode: $('#brewDripper')?.value || '平底滤杯', grinder: $('#brewGrinder')?.value || '' },
    water: { profile: $('#brewWater')?.value || '平衡水', tdsMgL: parseNumber($('#brewTds')?.value, 85) },
    targets: { floral: parseNumber($('#targetFloral')?.value, 2), acidity: parseNumber($('#targetAcidity')?.value, 1), sweetness: parseNumber($('#targetSweet')?.value, 2), body: parseNumber($('#targetBody')?.value, 1) }
  };
}

function renderBrew() {
  const container = $('#brewContent');
  const activeBeans = state.beans.filter(b => !b.archived && Number(b.remainingWeight) > 0);
  if (!state.selectedBeanId && activeBeans.length) state.selectedBeanId = activeBeans[0].id;
  const selected = activeBeans.find(b => b.id === state.selectedBeanId);
  const settings = state.settings.brew;
  container.innerHTML = `<section class="panel"><div class="brew-inputs"><div class="brew-main-row"><label class="field"><span>制作方法</span><select id="brewMethod" class="control"><option value="pourover">手冲咖啡</option><option value="aeropress">爱乐压</option><option value="coldbrew">冷萃</option><option value="espresso">意式</option></select></label><label class="field"><span>粉量</span><input id="brewDose" class="control" type="number" min="5" max="40" step="0.1" value="${settings.doseG}"></label></div>
  <div class="grid-2"><label class="field"><span>豆卡</span><select id="brewBean" class="control">${activeBeans.map(bean=>`<option value="${esc(bean.id)}"${bean.id===state.selectedBeanId?' selected':''}>${esc(bean.name)}</option>`).join('')}</select></label><label class="field"><span>粉水比</span><input id="brewRatio" class="control" type="number" min="8" max="25" step="0.1" value="${settings.ratio}"></label><label class="field"><span>滤杯</span><select id="brewDripper" class="control"><option>平底滤杯</option><option>锥形滤杯</option><option>混合式滤杯</option></select></label><label class="field"><span>研磨设备 / 刻度</span><input id="brewGrinder" class="control" value="${esc(settings.grinder)}" placeholder="例如 C40 22格"></label><label class="field"><span>调水方案</span><select id="brewWater" class="control"><option>平衡水</option><option>花香水</option><option>抑酸水</option></select></label><label class="field"><span>TDS mg/L</span><input id="brewTds" class="control" type="number" min="20" max="250" value="85"></label><label class="field"><span>分段</span><select id="brewSegments" class="control">${[2,3,4,5].map(v=>`<option value="${v}"${Number(settings.segments)===v?' selected':''}>${v+1}段（含闷蒸）</option>`).join('')}</select></label><label class="field"><span>目标：花香 / 酸 / 甜 / 体感</span><div class="grid-3"><input id="targetFloral" class="control" type="number" min="0" max="3" value="2"><input id="targetAcidity" class="control" type="number" min="0" max="3" value="1"><input id="targetSweet" class="control" type="number" min="0" max="3" value="2"></div><input id="targetBody" class="control hidden" type="number" value="1"></label></div>
  <button id="generatePlanBtn" class="button primary" type="button"${selected?'':' disabled'}>生成方案</button></div></section><div id="planResult">${state.currentPlan && state.currentPlan.beanId === state.selectedBeanId ? planHtml(state.currentPlan) : ''}</div>`;
  $('#brewBean')?.addEventListener('change', event => { state.selectedBeanId = event.target.value; state.currentPlan = null; renderBrew(); });
  $('#generatePlanBtn')?.addEventListener('click', generatePlan);
  bindPlanActions();
}

async function generatePlan() {
  const bean = state.beans.find(b => b.id === $('#brewBean').value); if (!bean) return toast('请先选择豆卡');
  const button = $('#generatePlanBtn');
  state.selectedBeanId = bean.id;
  const input = buildBrewInput(bean); state.currentBrewInput = input;
  button.disabled = true; button.textContent = '正在计算…';
  try {
    let plan, apiError = '';
    try { plan = await requestPrivatePlan(state.settings.brew.apiEndpoint, input); }
    catch (error) { apiError = error.message; plan = await computeFallbackPlan(input); }
    plan.beanId = bean.id; plan.id = uid('brew'); plan.createdAt = new Date().toISOString();
    if (apiError) plan.warnings = [...(plan.warnings || []), `私有 API：${apiError}`];
    validatePlan(plan); state.currentPlan = plan;
    const session = { ...plan, input, status: 'planned' }; await put('brewSessions', session); await refreshData();
    state.settings.brew = { ...state.settings.brew, method: input.brew.method, doseG: input.brew.doseG, ratio: input.brew.ratio, segments: input.brew.segments, grinder: input.brew.grinder }; await saveSettings();
    $('#planResult').innerHTML = planHtml(plan); bindPlanActions();
    requestAnimationFrame(() => $('#planResult').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  } catch (error) {
    console.error(error);
    toast(`方案生成失败：${error.message}`, 'status-bad');
  } finally {
    if (button?.isConnected) { button.disabled = false; button.textContent = state.currentPlan ? '重新生成方案' : '生成方案'; }
  }
}
function planHtml(plan) {
  const expanded = state.settings.ui.planVisualsExpanded ? ' open' : '';
  const flavor = plan.flavorFit || {};
  return `<section class="panel" id="generatedPlan"><div class="panel-title"><div><h2>冲煮方案</h2><p>${esc(plan.engineVersion)} · ${esc(plan.profileVersion)} · ${plan.source === 'private-api' ? '私有引擎' : '本地回退'}</p></div></div>${(plan.warnings||[]).map(w=>`<p class="small status-warn">${esc(w)}</p>`).join('')}
  <div>${plan.stages.map(stage=>`<article class="plan-stage"><div class="stage-index">${stage.index}</div><div class="stage-lines"><div class="stage-line"><div class="stage-cell"><span>本段注水</span><strong>${Number(stage.stageWaterG).toFixed(0)}g</strong></div><div class="stage-cell"><span>累计注水</span><strong>${Number(stage.cumulativeWaterG).toFixed(0)}g</strong></div><div class="stage-cell"><span>阶段</span><strong>${esc(stage.name)}</strong></div></div><div class="stage-line"><div class="stage-cell"><span>水温</span><strong>${Number(stage.temperatureC).toFixed(0)}°C</strong></div><div class="stage-cell"><span>时间</span><strong>${Number(stage.durationSec).toFixed(0)}s</strong></div><div class="stage-cell"><span>注水方法</span><strong>${esc(stage.method)}</strong></div></div></div></article>`).join('')}</div>
  <details class="details-block"${expanded}><summary>萃取轨迹</summary><div class="details-content">${(plan.trajectory||[]).map((p,i)=>`<div class="bar-row"><span>阶段${i+1}</span><div class="bar-track"><div class="bar-fill" style="width:${clamp(p.y*100,0,100)}%"></div></div><strong>${Math.round(p.y*100)}</strong></div>`).join('') || '<p class="muted small">远程方案未提供轨迹数据</p>'}</div></details>
  <details class="details-block"${expanded}><summary>风味拟合</summary><div class="details-content bar-chart">${Object.entries({花香:flavor.floral,酸质:flavor.acidity,甜感:flavor.sweetness,体感:flavor.body}).map(([k,v])=>`<div class="bar-row"><span>${k}</span><div class="bar-track"><div class="bar-fill" style="width:${clamp(Number(v||0)*100,0,100)}%"></div></div><strong>${Math.round(Number(v||0)*100)}</strong></div>`).join('')}</div></details>
  <div class="row"><button id="startBrewBtn" class="button primary grow" type="button">开始制作</button><button id="planToSensoryBtn" class="button" type="button">完成并品鉴</button></div></section>`;
}
function bindPlanActions() {
  $('#startBrewBtn')?.addEventListener('click', startTimer);
  $('#planToSensoryBtn')?.addEventListener('click', () => promptRecordConsumption('complete'));
}

function speak(text) {
  if (!globalThis.speechSynthesis || !text) return;
  speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'zh-CN'; utterance.rate = 1.05; speechSynthesis.speak(utterance);
}
function startTimer() {
  if (!state.currentPlan) return;
  state.timer.stageIndex = 0; state.timer.remaining = Number(state.currentPlan.stages[0].durationSec); state.timer.paused = false;
  renderTimerDialog(); startTimerInterval(); speak(`第一段，${state.currentPlan.stages[0].name}，${state.timer.remaining}秒`);
}
function startTimerInterval() {
  clearInterval(state.timer.interval);
  state.timer.interval = setInterval(() => {
    if (state.timer.paused) return;
    state.timer.remaining -= 1;
    if ([10,5,3,2,1].includes(state.timer.remaining)) speak(String(state.timer.remaining));
    if (state.timer.remaining <= 0) advanceTimerStage();
    renderTimerValues();
  }, 1000);
}
function renderTimerDialog() {
  const stage = state.currentPlan.stages[state.timer.stageIndex];
  const content = `${dialogHeader('制作计时', `${stage.name} · ${stage.stageWaterG}g · ${stage.temperatureC}°C`)}<div class="timer-card"><div id="timerClock" class="timer-clock">${formatSeconds(state.timer.remaining)}</div><p id="timerStageText">${esc(stage.method)}</p><div class="timer-actions"><button id="timerPauseBtn" class="button" type="button" aria-label="暂停">⏸</button><button id="timerSkipBtn" class="button" type="button" aria-label="跳过并结束">&gt;&gt;</button><button id="timerExitBtn" class="button" type="button" aria-label="退出">🔙</button></div></div>`;
  const overlay = showOverlay(content, { id: 'timer' }); bindClose(overlay);
  $('#timerPauseBtn').addEventListener('click', () => { state.timer.paused = !state.timer.paused; $('#timerPauseBtn').textContent = state.timer.paused ? '▶' : '⏸'; if (state.timer.paused) speak('已暂停'); });
  $('#timerSkipBtn').addEventListener('click', () => promptRecordConsumption('skip'));
  $('#timerExitBtn').addEventListener('click', () => promptRecordConsumption('exit'));
}
function formatSeconds(seconds) { const value = Math.max(0, Number(seconds)||0); return `${Math.floor(value/60).toString().padStart(2,'0')}:${(value%60).toString().padStart(2,'0')}`; }
function renderTimerValues() { const clock = $('#timerClock'); if (clock) clock.textContent = formatSeconds(state.timer.remaining); }
function advanceTimerStage() {
  const next = state.timer.stageIndex + 1;
  if (next >= state.currentPlan.stages.length) { clearInterval(state.timer.interval); promptRecordConsumption('complete'); return; }
  state.timer.stageIndex = next; state.timer.remaining = Number(state.currentPlan.stages[next].durationSec); state.timer.paused = false;
  const stage = state.currentPlan.stages[next]; $('#timerStageText').textContent = stage.method; speak(`第${stage.index}段，${stage.name}，${stage.stageWaterG}克，${stage.durationSec}秒`);
}
function promptRecordConsumption(reason) {
  clearInterval(state.timer.interval); state.timer.paused = true;
  const bean = state.beans.find(b => b.id === state.selectedBeanId); const dose = Number(state.currentPlan?.totals?.doseG || state.currentBrewInput?.brew?.doseG || 15);
  const overlay = showOverlay(`${dialogHeader('是否记录咖啡豆消耗', `${bean?.name || '当前豆卡'} · ${dose}g`)}<p class="muted">记录后扣除本次粉量并进入品鉴；不记录则返回方案编辑状态。</p><div class="grid-2"><button id="recordConsumptionBtn" class="button primary" type="button">记录</button><button id="skipConsumptionBtn" class="button" type="button">不记录</button></div>`, { id: 'consume-confirm' }); bindClose(overlay);
  $('#recordConsumptionBtn').addEventListener('click', async () => { await consumeBean(bean, dose, state.currentPlan?.id, reason); closeOverlay(); startEvaluation(bean.id); switchPage('sensory', { preserveOverlay: true }); renderSensory(); });
  $('#skipConsumptionBtn').addEventListener('click', () => { closeOverlay(); switchPage('brew'); });
}
async function consumeBean(bean, amount, sessionId, note = '') {
  if (!bean) return;
  const consumed = Math.min(Number(bean.remainingWeight)||0, amount); bean.remainingWeight = Math.max(0, Number(bean.remainingWeight||0) - consumed); bean.updatedAt = new Date().toISOString();
  const event = { id: uid('inv'), beanId: bean.id, type: 'consume', amountG: -consumed, resultingWeightG: bean.remainingWeight, sessionId, note, createdAt: new Date().toISOString() };
  await Promise.all([put('beans', bean), put('inventoryEvents', event)]); await refreshData();
}

function startEvaluation(beanId = state.selectedBeanId) {
  state.selectedBeanId = beanId;
  state.evaluation = { id: uid('sensory'), beanId, brewSessionId: state.currentPlan?.id || '', engineVersion: state.currentPlan?.engineVersion || '', profileVersion: state.currentPlan?.profileVersion || '', nodeIndex: 0, answers: {}, score: 80, createdAt: new Date().toISOString() };
}
function filteredSensoryRecords() {
  const f = state.sensoryFilter;
  let records = [...state.sensoryRecords];
  if (f.beanId) records = records.filter(r => r.beanId === f.beanId);
  if (f.minScore !== '') records = records.filter(r => Number(r.score) >= Number(f.minScore));
  if (f.maxScore !== '') records = records.filter(r => Number(r.score) <= Number(f.maxScore));
  if (f.start) records = records.filter(r => String(r.createdAt).slice(0,10) >= f.start);
  if (f.end) records = records.filter(r => String(r.createdAt).slice(0,10) <= f.end);
  records.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  return records.slice(0, f.expanded ? 50 : 10);
}
function renderSensory() {
  const container = $('#sensoryContent');
  const records = filteredSensoryRecords();
  const current = state.evaluation;
  container.innerHTML = `<section class="panel"><div class="panel-title"><div><h2>最近品鉴记录</h2><p>默认显示最近 10 条</p></div><div class="row"><button id="sensoryFilterBtn" class="button" type="button">筛选</button><button id="sensoryExpandBtn" class="button" type="button" aria-label="展开更多记录">⌄</button></div></div><div class="record-list">${records.length?records.map(recordHtml).join(''):'<p class="muted small">尚无品鉴记录</p>'}</div></section>
  ${current ? evaluationHtml(current) : `<section class="panel"><div class="panel-title"><div><h2>开始品鉴</h2><p>九节点：花香、果香、其他、甜、酸、苦、口感、负面、总分</p></div></div><label class="field"><span>豆卡</span><select id="sensoryBeanSelect" class="control">${state.beans.filter(b=>!b.archived).map(b=>`<option value="${esc(b.id)}"${b.id===state.selectedBeanId?' selected':''}>${esc(b.name)}</option>`).join('')}</select></label><button id="startSensoryBtn" class="button primary" type="button">开始九节点品鉴</button></section>`}`;
  $('#sensoryFilterBtn').addEventListener('click', openSensoryFilter);
  $('#sensoryExpandBtn').addEventListener('click', () => { state.sensoryFilter.expanded = !state.sensoryFilter.expanded; renderSensory(); });
  $('#startSensoryBtn')?.addEventListener('click', () => { const beanId = $('#sensoryBeanSelect').value; if (!beanId) return toast('请先选择豆卡'); startEvaluation(beanId); renderSensory(); });
  bindEvaluationEvents();
}
function recordHtml(record) {
  const bean = state.beans.find(b=>b.id===record.beanId);
  return `<div class="record-item"><span>${formatDate(record.createdAt)}</span><span>${esc(bean?.name || '已删除豆卡')} · ${esc((record.summary||[]).slice(0,3).join(' / '))}</span><strong>${Number(record.score||0).toFixed(1)}</strong></div>`;
}
function evaluationHtml(evaluation) {
  const node = SENSORY_NODES[evaluation.nodeIndex];
  return `<section class="panel"><div class="panel-title"><div><h2>${evaluation.nodeIndex+1}. ${node.label}</h2><p>${state.beans.find(b=>b.id===evaluation.beanId)?.name || ''}</p></div><button id="cancelEvaluationBtn" class="button subtle" type="button">取消</button></div><div class="sensory-progress">${SENSORY_NODES.map((_,i)=>`<span class="${i<evaluation.nodeIndex?'done':i===evaluation.nodeIndex?'current':''}"></span>`).join('')}</div>${node.type==='score'?scoreNodeHtml(evaluation):node.groups.map((group,index)=>questionGroupHtml(node,group,index,evaluation.answers[node.id]||{})).join('')}<div class="row"><button id="prevSensoryNodeBtn" class="button" type="button"${evaluation.nodeIndex===0?' disabled':''}>上一步</button><span class="grow"></span><button id="nextSensoryNodeBtn" class="button primary" type="button">${evaluation.nodeIndex===SENSORY_NODES.length-1?'完成品鉴':'下一步'}</button></div></section>`;
}
function questionGroupHtml(node, group, groupIndex, answer) {
  const selected = new Set(answer[groupIndex] || []);
  return `<div class="question-group"><h4>${esc(group.label)}</h4><div class="sensory-options">${group.options.map(option=>`<button type="button" class="sensory-option${selected.has(option)?' selected':''}" data-sensory-option="${esc(option)}" data-group-index="${groupIndex}" data-single="${Boolean(group.single)}">${esc(option)}</button>`).join('')}</div></div>`;
}
function scoreNodeHtml(evaluation) {
  return `<div class="question-group"><h4>总分</h4><input id="sensoryScore" class="control" type="number" min="0" max="100" step="0.1" value="${Number(evaluation.score||80)}"><p class="muted small">建议以 80 分为基准，结合洁净度、甜感、酸质、余韵和整体平衡调整。</p></div>`;
}
function bindEvaluationEvents() {
  $('#cancelEvaluationBtn')?.addEventListener('click', () => { state.evaluation = null; renderSensory(); });
  $$('.sensory-option').forEach(button => button.addEventListener('click', () => {
    const node = SENSORY_NODES[state.evaluation.nodeIndex]; const groupIndex = Number(button.dataset.groupIndex);
    state.evaluation.answers[node.id] ||= {}; state.evaluation.answers[node.id][groupIndex] ||= [];
    let selected = state.evaluation.answers[node.id][groupIndex];
    if (button.dataset.single === 'true') selected = selected.includes(button.dataset.sensoryOption) ? [] : [button.dataset.sensoryOption];
    else selected = selected.includes(button.dataset.sensoryOption) ? selected.filter(v=>v!==button.dataset.sensoryOption) : [...selected, button.dataset.sensoryOption];
    state.evaluation.answers[node.id][groupIndex] = selected; renderSensory();
  }));
  $('#prevSensoryNodeBtn')?.addEventListener('click', () => { state.evaluation.nodeIndex = Math.max(0, state.evaluation.nodeIndex-1); renderSensory(); });
  $('#nextSensoryNodeBtn')?.addEventListener('click', async () => {
    const node = SENSORY_NODES[state.evaluation.nodeIndex];
    if (state.evaluation.nodeIndex === SENSORY_NODES.length - 1) {
      const score = parseNumber($('#sensoryScore').value, -1); if (score < 0 || score > 100) return toast('总分必须在 0–100'); state.evaluation.score = score; await saveEvaluation();
    } else {
      const answers = state.evaluation.answers[node.id] || {};
      const incomplete = node.groups.some((_, index) => !Array.isArray(answers[index]) || answers[index].length === 0);
      if (incomplete) return toast(`请完成“${node.label}”节点；没有感知时请选择“无”`, 'status-warn');
      state.evaluation.nodeIndex += 1; renderSensory();
    }
  });
}
async function saveEvaluation() {
  const evaluation = state.evaluation;
  const summary = [];
  for (const node of SENSORY_NODES.slice(0,-1)) {
    const values = Object.values(evaluation.answers[node.id] || {}).flat();
    if (values.length && !values.every(v=>v==='无')) summary.push(`${node.label}:${values.join('/')}`);
  }
  const record = { ...evaluation, summary, updatedAt: new Date().toISOString() };
  delete record.nodeIndex; await put('sensoryRecords', record); await refreshData(); state.evaluation = null;
  switchPage('beans'); requestAnimationFrame(()=>detailBean(record.beanId));
  if (Number(record.score) < 75) toast('品鉴已保存；建议检查研磨均匀度、水温和尾段萃取', 'status-warn'); else toast('品鉴记录已保存', 'status-good');
}
function openSensoryFilter() {
  const f = state.sensoryFilter;
  const overlay = showOverlay(`${dialogHeader('筛选品鉴记录')}<div class="form-grid"><label class="field"><span>咖啡豆</span><select id="filterSensoryBean" class="control"><option value="">全部豆卡</option>${state.beans.map(b=>`<option value="${esc(b.id)}"${f.beanId===b.id?' selected':''}>${esc(b.name)}</option>`).join('')}</select></label><label class="field"><span>最低分</span><input id="filterMinScore" class="control" type="number" min="0" max="100" value="${esc(f.minScore)}"></label><label class="field"><span>最高分</span><input id="filterMaxScore" class="control" type="number" min="0" max="100" value="${esc(f.maxScore)}"></label><label class="field"><span>开始日期</span><input id="filterStartDate" class="control" type="date" value="${esc(f.start)}"></label><label class="field"><span>结束日期</span><input id="filterEndDate" class="control" type="date" value="${esc(f.end)}"></label></div><div class="row end"><button id="resetSensoryFilter" class="button subtle" type="button">重置</button><button id="applySensoryFilter" class="button primary" type="button">应用</button></div>`);
  bindClose(overlay);
  $('#resetSensoryFilter').addEventListener('click',()=>{state.sensoryFilter={beanId:'',minScore:'',maxScore:'',start:'',end:'',expanded:false};closeOverlay();renderSensory();});
  $('#applySensoryFilter').addEventListener('click',()=>{state.sensoryFilter={...state.sensoryFilter,beanId:$('#filterSensoryBean').value,minScore:$('#filterMinScore').value,maxScore:$('#filterMaxScore').value,start:$('#filterStartDate').value,end:$('#filterEndDate').value};closeOverlay();renderSensory();});
}

async function ensureQrCodeLibrary() {
  if (globalThis.QRCode) return globalThis.QRCode;
  return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';script.onload=()=>globalThis.QRCode?resolve(globalThis.QRCode):reject(new Error('二维码生成库加载失败'));script.onerror=()=>reject(new Error('二维码生成库加载失败'));document.head.append(script);});
}
function sharePayload(bean) {
  const sessions = state.brewSessions.filter(s=>s.beanId===bean.id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,1);
  const records = state.sensoryRecords.filter(r=>r.beanId===bean.id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,1);
  return { schemaVersion:1, appVersion:APP_VERSION, sharedAt:new Date().toISOString(), user:{publicId:state.settings.identity.publicId||'',nickname:state.settings.identity.nickname||'匿名'}, bean:{name:bean.name,country:codeName('countries',bean.countryCode,''),region:codeName('regions',bean.regionCode,''),entity:codeName('entities',bean.entityCode,''),variety:codeName('varieties',bean.varietyCode,''),process:codeName('processes',bean.processCode,''),roast:ROAST_NAME.get(bean.roastCode)||'',roastDate:bean.roastDate,flavors:(bean.flavorCodes||[]).map(c=>codeName('flavors',c,c))}, plan:sessions[0]?{engineVersion:sessions[0].engineVersion,profileVersion:sessions[0].profileVersion,stages:sessions[0].stages,totals:sessions[0].totals}:null, sensory:records[0]?{score:records[0].score,summary:records[0].summary}:null };
}
function encodeShare(payload) { const bytes=new TextEncoder().encode(JSON.stringify(payload)); let binary=''; bytes.forEach(v=>binary+=String.fromCharCode(v)); return btoa(binary).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
function decodeShare(encoded) { const base64=encoded.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-encoded.length%4)%4); const binary=atob(base64); return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary,c=>c.charCodeAt(0)))); }
function shareHtmlDocument(payload) {
  const plan = payload.plan?.stages?.map(s=>`<li>${esc(s.name)}：${Number(s.stageWaterG).toFixed(0)}g，累计${Number(s.cumulativeWaterG).toFixed(0)}g，${Number(s.temperatureC).toFixed(0)}°C，${Number(s.durationSec).toFixed(0)}s，${esc(s.method)}</li>`).join('') || '<li>未分享方案</li>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(payload.bean.name)} · 富贵盒子</title><style>body{max-width:680px;margin:auto;padding:24px;background:#090a0a;color:#f4f2eb;font-family:system-ui;line-height:1.7}.card{border:1px solid #333;border-radius:20px;padding:18px;margin:12px 0;background:#121414}.muted{color:#9aa}li{margin:8px 0}</style></head><body><h1>${esc(payload.bean.name)}</h1><p class="muted">由 ${esc(payload.user.nickname||'匿名')} 分享 · ${formatDate(payload.sharedAt)}</p><section class="card"><h2>豆卡</h2><p>${esc([payload.bean.country,payload.bean.region,payload.bean.variety,payload.bean.process,payload.bean.roast].filter(Boolean).join(' · '))}</p><p>${esc((payload.bean.flavors||[]).join('、'))}</p></section><section class="card"><h2>冲煮方案</h2><ol>${plan}</ol></section><section class="card"><h2>品鉴</h2><p>${payload.sensory?`${Number(payload.sensory.score).toFixed(1)} 分 · ${esc((payload.sensory.summary||[]).join('；'))}`:'未分享品鉴记录'}</p></section><p class="muted">生成于富贵盒子 ${esc(payload.appVersion)}</p></body></html>`;
}

function openShareDialog(bean) {
  const payload = sharePayload(bean); const encoded = encodeShare(payload); const link = `${location.origin}${location.pathname}#share=${encoded}`; const tooLong = encoded.length > 6000;
  const content = `${dialogHeader('分享豆卡', tooLong?'内容超过安全链接长度，请保存网页文件':'二维码或链接均只包含公开白名单字段')}<div class="row"><button id="shareQrTab" class="button primary" type="button">二维码分享</button><button id="shareLinkTab" class="button" type="button">链接分享</button></div><div id="shareQrPanel"><div id="shareQrBox" class="qr-box"><span class="muted">正在生成二维码…</span></div></div><div id="shareLinkPanel" class="hidden"><div class="share-link-row"><div class="control ellipsis">${esc(tooLong?'内容过长，不生成 URL':link)}</div><button id="copyShareLinkBtn" class="button" type="button"${tooLong?' disabled':''}>复制</button></div></div><div class="grid-2"><button id="saveQrBtn" class="button" type="button"${tooLong?' disabled':''}>保存二维码 PNG</button><button id="saveShareHtmlBtn" class="button" type="button">保存分享网页</button></div><label class="field"><span>本机备注（不会同步给访问者）</span><textarea id="shareLocalNote" class="control" placeholder="仅保存在当前设备"></textarea></label>`;
  const overlay = showOverlay(content,{id:'share'});bindClose(overlay);
  const showTab = tab => { $('#shareQrPanel').classList.toggle('hidden',tab!=='qr');$('#shareLinkPanel').classList.toggle('hidden',tab!=='link');$('#shareQrTab').classList.toggle('primary',tab==='qr');$('#shareLinkTab').classList.toggle('primary',tab==='link'); };
  $('#shareQrTab').addEventListener('click',()=>showTab('qr'));$('#shareLinkTab').addEventListener('click',()=>showTab('link'));
  $('#copyShareLinkBtn').addEventListener('click',async()=>{await navigator.clipboard.writeText(link);toast('完整链接已复制');});
  $('#saveShareHtmlBtn').addEventListener('click',()=>downloadBlob(`${bean.name}_富贵盒子分享.html`,shareHtmlDocument(payload),'text/html;charset=utf-8'));
  get('shareDrafts', bean.id).then(draft => { if (draft?.note && $('#shareLocalNote')) $('#shareLocalNote').value = draft.note; }).catch(() => {});
  $('#shareLocalNote').addEventListener('change', () => put('shareDrafts', { id: bean.id, note: $('#shareLocalNote').value.slice(0, 1000), updatedAt: new Date().toISOString() }));
  if (!tooLong) ensureQrCodeLibrary().then(()=>{const box=$('#shareQrBox');box.innerHTML='';new QRCode(box,{text:link,width:220,height:220,correctLevel:QRCode.CorrectLevel.L});}).catch(error=>$('#shareQrBox').textContent=error.message);
  $('#saveQrBtn').addEventListener('click',()=>{const canvas=$('#shareQrBox canvas');const image=$('#shareQrBox img');if(canvas)canvas.toBlob(blob=>downloadBlob(`${bean.name}_分享二维码.png`,blob,'image/png'));else if(image)fetch(image.src).then(r=>r.blob()).then(blob=>downloadBlob(`${bean.name}_分享二维码.png`,blob,'image/png'));else toast('二维码尚未生成');});
}
function renderSharedPayload(payload) {
  assertPlainObject(payload,'分享数据');
  $('#loginScreen').classList.add('hidden'); $('#appShell').classList.add('hidden');
  document.body.innerHTML = shareHtmlDocument(payload).match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || '<p>分享数据无效</p>';
}

function openHistory() {
  const archived = state.beans.filter(b=>b.archived || Number(b.remainingWeight)<=0);
  const content = `${dialogHeader('老黄历', '归档或余量为零的豆卡')}<div class="bean-grid">${archived.length?archived.map(beanCardHtml).join(''):'<p class="muted">老黄历为空</p>'}</div>`;
  const overlay = showOverlay(content,{id:'history'});bindClose(overlay);
  overlay.addEventListener('click', event => { const card = event.target.closest('[data-bean-id]'); if (card) detailBean(card.dataset.beanId); });
}

function renderSettings() {
  const meta = state.codebookMeta || {};
  $('#settingsContent').innerHTML = `<section class="panel"><div class="panel-title"><div><h2>数据与接口</h2><p>BrewIon 负责公开编码表；私有冲煮通过服务端 API</p></div></div><div class="setting-list"><div class="setting-row"><div><h3>BrewIon 编码表</h3><p>版本 ${esc(meta.version||state.codebook.version||'6')} · ${esc(meta.source||'embedded')} · ${esc(meta.checkedAt||'尚未检查')}</p></div><button id="updateCodebookBtn" class="button" type="button">检查更新</button></div><div class="setting-row"><div class="grow"><h3>私有冲煮 API</h3><p>不得填写 GitHub Token；填写由服务端托管的 HTTPS 端点。</p><input id="brewApiEndpoint" class="control" type="url" placeholder="https://your-worker.example.com/api/brew" value="${esc(state.settings.brew.apiEndpoint||'')}"></div><button id="saveApiBtn" class="button" type="button">保存</button></div><div class="setting-row"><div><h3>萃取轨迹与风味拟合</h3><p>控制生成方案后默认展开或折叠</p></div><label class="toggle"><input id="planVisualToggle" type="checkbox"${state.settings.ui.planVisualsExpanded?' checked':''}>默认展开</label></div></div></section>
  <section class="panel"><div class="panel-title"><div><h2>本机身份</h2><p>${esc(state.settings.identity.mode)} · ${esc(state.settings.identity.publicId||'无公开 ID')} · 仅本机保存，未经服务端验证</p></div></div><div class="grid-2"><label class="field"><span>昵称</span><input id="settingsNickname" class="control" maxlength="24" value="${esc(state.settings.identity.nickname||'')}"></label><label class="field"><span>邮箱</span><input id="settingsEmail" class="control" type="email" value="${esc(state.settings.identity.email||'')}"></label><label class="field"><span>手机</span><input id="settingsPhone" class="control" inputmode="tel" value="${esc(state.settings.identity.phone||'')}"></label><label class="field"><span>微信</span><input id="settingsWechat" class="control" value="${esc(state.settings.identity.wechat||'')}"></label><label class="field"><span>QQ</span><input id="settingsQq" class="control" inputmode="numeric" value="${esc(state.settings.identity.qq||'')}"></label></div><p class="muted small">这些联系方式不会进入分享链接；正式绑定仍需后端验证。</p><button id="saveIdentityBtn" class="button" type="button">保存本机身份</button></section>
  <section class="panel"><div class="panel-title"><div><h2>器具偏好</h2></div></div><div class="grid-2"><label class="field"><span>默认滤杯</span><select id="defaultDripper" class="control"><option>平底滤杯</option><option>锥形滤杯</option><option>混合式滤杯</option></select></label><label class="field"><span>磨豆机与刻度</span><input id="defaultGrinder" class="control" value="${esc(state.settings.brew.grinder||'')}"></label></div></section>
  <section class="panel"><div class="panel-title"><div><h2>数据管理</h2><p>导出文件包含版本和 Schema；导入前校验结构。</p></div></div><div class="grid-2"><button id="settingsExportBtn" class="button" type="button">导出备份</button><button id="settingsImportBtn" class="button" type="button">导入备份</button><button id="clearAllDataBtn" class="button danger" type="button">清空本地数据</button><button id="aboutVersionBtn" class="button subtle" type="button">版本 ${APP_VERSION}</button></div></section>`;
  $('#updateCodebookBtn').addEventListener('click', updateCodebook);
  $('#saveApiBtn').addEventListener('click',async()=>{state.settings.brew.apiEndpoint=$('#brewApiEndpoint').value.trim();await saveSettings();toast('API 地址已保存');});
  $('#planVisualToggle').addEventListener('change',async e=>{state.settings.ui.planVisualsExpanded=e.target.checked;await saveSettings();});
  $('#saveIdentityBtn').addEventListener('click',async()=>{state.settings.identity={...state.settings.identity,nickname:$('#settingsNickname').value.trim()||'游客',email:$('#settingsEmail').value.trim(),phone:$('#settingsPhone').value.trim(),wechat:$('#settingsWechat').value.trim(),qq:$('#settingsQq').value.trim()};await saveSettings();$('#profileBtn').textContent=identityLabel();toast('本机身份已保存');});
  $('#defaultGrinder').addEventListener('change',async e=>{state.settings.brew.grinder=e.target.value.trim();await saveSettings();});
  $('#settingsExportBtn').addEventListener('click',exportData); $('#settingsImportBtn').addEventListener('click',()=>$('#importInput').click());
  $('#clearAllDataBtn').addEventListener('click',confirmClearAll); $('#aboutVersionBtn').addEventListener('click',()=>showInfoDialog('富贵盒子',`版本 ${APP_VERSION} · 数据 Schema ${SCHEMA_VERSION} · 回退引擎 ${FALLBACK_ENGINE_VERSION}`));
}
async function updateCodebook() {
  const button=$('#updateCodebookBtn');button.disabled=true;button.textContent='检查中…';
  try { const result=await checkCodebookUpdate({force:true});state.codebook=result.data;state.codebookIndex=makeIndex(result.data);state.codebookMeta=result.meta;$('#syncStatus').textContent=`编码表 v${result.meta.version} · ${result.updated?'已更新':'已是最新'}`;renderSettings();toast(result.updated?'编码表已更新':'编码表已是最新','status-good'); }
  catch(error){button.disabled=false;button.textContent='检查更新';toast(`更新失败：${error.message}`,'status-bad');}
}

async function exportData() {
  const payload={format:'luckybean-backup',schemaVersion:SCHEMA_VERSION,appVersion:APP_VERSION,exportedAt:new Date().toISOString(),beans:state.beans,brewSessions:state.brewSessions,sensoryRecords:state.sensoryRecords,inventoryEvents:state.inventoryEvents,settings:state.settings};
  downloadBlob(`luckybean_backup_${todayISO()}.json`,JSON.stringify(payload,null,2),'application/json;charset=utf-8');
}
async function importData(file) {
  if (!file) return; if (file.size>5*1024*1024) return toast('导入文件不能超过 5MB','status-bad');
  try { const text=await file.text();const parsed=JSON.parse(text);assertSafeJson(parsed);const payload=assertPlainObject(parsed,'备份文件');if(payload.format!=='luckybean-backup')throw new Error('不是富贵盒子备份');if(Number(payload.schemaVersion)>SCHEMA_VERSION)throw new Error('备份 Schema 版本高于当前应用');
    for(const key of ['beans','brewSessions','sensoryRecords','inventoryEvents'])if(payload[key]!==undefined&&!Array.isArray(payload[key]))throw new Error(`${key} 必须是数组`);
    await Promise.all([bulkPut('beans',payload.beans||[]),bulkPut('brewSessions',payload.brewSessions||[]),bulkPut('sensoryRecords',payload.sensoryRecords||[]),bulkPut('inventoryEvents',payload.inventoryEvents||[])]);if(payload.settings){state.settings={...state.settings,...payload.settings};await saveSettings();}await refreshData();renderBeans();toast('备份导入完成','status-good');
  } catch(error){toast(`导入失败：${error.message}`,'status-bad');} finally{$('#importInput').value='';}
}
function confirmClearAll() {
  const overlay=showOverlay(`${dialogHeader('清空本地数据','此操作不可撤销')}<p class="status-bad">将删除豆卡、库存、方案、品鉴、设置和编码表缓存。</p><label class="field"><span>输入“清空”确认</span><input id="clearConfirmInput" class="control"></label><button id="confirmClearBtn" class="button danger" type="button">永久清空</button>`);bindClose(overlay);
  $('#confirmClearBtn').addEventListener('click',async()=>{if($('#clearConfirmInput').value!=='清空')return toast('请输入“清空”');await clearAll();location.reload();});
}

function openProfileDialog() {
  const identity=state.settings.identity;
  const overlay=showOverlay(`${dialogHeader('本机身份','真实邮箱、微信、QQ、手机绑定需要后端账号服务')}<div class="panel"><p><strong>${esc(identity.nickname)}</strong></p><p class="mono">${esc(identity.publicId||'未生成公开 ID')}</p><p class="muted small">状态：${identity.verified?'已验证':'仅本机，未验证'}</p></div><button id="goIdentitySettings" class="button primary" type="button">前往器设</button>`);bindClose(overlay);$('#goIdentitySettings').addEventListener('click',()=>{closeOverlay();switchPage('settings');});
}

function bindGlobalEvents() {
  $('#guestBtn').addEventListener('click',()=>setIdentity('guest')); $('#emailIdentityBtn').addEventListener('click',openEmailIdentityDialog); $('#wechatIdentityBtn').addEventListener('click',()=>setIdentity('wechat'));
  $('#testBtn').addEventListener('click',async()=>{await setIdentity('guest');await seedDemo();renderBeans();});
  $('#profileBtn').addEventListener('click',openProfileDialog);
  $('#bottomNav').addEventListener('click',event=>{const button=event.target.closest('[data-page-target]');if(button)switchPage(button.dataset.pageTarget);});
  $('#beanGroups').addEventListener('click',event=>{const brew=event.target.closest('[data-brew-bean]');if(brew){event.stopPropagation();state.selectedBeanId=brew.dataset.brewBean;switchPage('brew');return;}const card=event.target.closest('[data-bean-id]');if(card)detailBean(card.dataset.beanId);});
  $('#beanGroups').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-bean-id]'))detailBean(event.target.dataset.beanId);});
  $('#activeFilterBar').addEventListener('click',event=>{if(event.target.id==='clearActiveFilters'){state.filter={search:'',country:'',process:'',flavors:[],sort:'freshness',dir:'asc'};renderBeans();}});
  $('#groupBtn').addEventListener('click',openGroupMenu); $('#filterSummaryBtn').addEventListener('click',openSearchDialog); $('#manageBtn').addEventListener('click',openManageMenu);
  $('#fabSearchBtn').addEventListener('click',openSearchDialog); $('#fabRecommendBtn').addEventListener('click',openRecommendMenu); $('#fabHistoryBtn').addEventListener('click',openHistory); $('#fabAddBtn').addEventListener('click',openAddMenu);
  document.addEventListener('click',event=>{
    const manage=event.target.closest('[data-manage-action]');if(manage){const action=manage.dataset.manageAction;closePopups();if(action==='export')exportData();if(action==='import')$('#importInput').click();if(action==='history')openHistory();return;}
    const add=event.target.closest('[data-add-mode]');if(add){const mode=add.dataset.addMode;closePopups();if(mode==='photo')$('#qrImageInput').click();if(mode==='qr')openCameraDialog();if(mode==='text')openTextRecognition();return;}
    const recommend=event.target.closest('[data-recommend-mode]');if(recommend){recommendBean(recommend.dataset.recommendMode);return;}
    if(!event.target.closest('.popup-menu,.recommend-menu,#groupBtn,#manageBtn,#fabRecommendBtn,#fabAddBtn'))closePopups();
  });
  $('#qrImageInput').addEventListener('change',event=>handleQrFile(event.target.files[0])); $('#importInput').addEventListener('change',event=>importData(event.target.files[0]));
  window.addEventListener('pagehide',()=>state.cameraScanner?.stop()); document.addEventListener('visibilitychange',()=>{if(document.hidden)state.cameraScanner?.stop();});
}

async function handleSharedHash() {
  if (!location.hash.startsWith('#share=')) return false;
  try { const encoded=location.hash.slice(7);if(encoded.length>12000)throw new Error('分享数据过长');const payload=decodeShare(encoded);renderSharedPayload(payload);return true; }
  catch(error){location.hash='';toast(`分享数据无效：${error.message}`,'status-bad');return false;}
}

async function init() {
  if (await handleSharedHash()) return;
  state.db = await openDb(); const migration = await migrateLegacy().catch(error=>({error:error.message}));
  await loadSettings(); const loaded = await loadCodebook(); state.codebook=loaded.data;state.codebookMeta=loaded.meta;state.codebookIndex=makeIndex(loaded.data);
  await refreshData(); const flavorMigration = await migrateLegacyFlavorCodes(); bindGlobalEvents();
  $('#syncStatus').textContent=`编码表 v${state.codebookMeta?.version||state.codebook.version||'6'} · ${loaded.source}${migration?.migrated?` · 已迁移${migration.beans}只豆卡`:''}${flavorMigration.migrated?` · 风味迁移${flavorMigration.migrated}只`:''}`;
  if (state.settings.identity.publicId) enterApp();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  setTimeout(()=>checkCodebookUpdate().then(result=>{state.codebook=result.data;state.codebookIndex=makeIndex(result.data);state.codebookMeta=result.meta;$('#syncStatus').textContent=`编码表 v${result.meta.version} · ${result.updated?'已更新':'已校验'}`;}).catch(()=>{}),800);
}

init().catch(error=>{console.error(error);showInfoDialog('初始化失败',error.message);});
