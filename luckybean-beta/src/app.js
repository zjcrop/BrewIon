import { APP_VERSION, SCHEMA_VERSION, $, $$, uid, esc, clamp, todayISO, formatDate, freshness, downloadBlob, safeJsonParse, assertPlainObject, assertSafeJson, browserTitle, parseNumber } from './utils.js';
import { openDb, all, get, put, remove, bulkPut, getSetting, setSetting, clearAll, migrateLegacy } from './db.js';
import { loadCodebook, checkCodebookUpdate, makeIndex, displayName, optionsHtml, relatedRows, parseNaturalLanguage, REMOTE_CODEBOOK_URL } from './codebook.js';
import { CameraScanner, scanQrFile, decodeJsQrResult } from './qr.js';
import { computeFallbackPlan, requestPrivatePlan, validatePlan, FALLBACK_ENGINE_VERSION, buildCorrectedPlan, listBrewProfiles } from './brew-engine.js';
import { listWaterProfiles, inferWaterProfile } from './water-profiles.js';
import { buildCompactSharePayload, encodeSharePayload, decodeSharePayload } from './share-codec.js';
import { computeAutomaticScore, sensoryPreferenceTags, buildPreferenceModel, recommendedBeanIds } from './preference-model.js';

const PAGE_META = {
  beans: { nav: '藏', title: '豆藏', browser: '豆藏' },
  brew: { nav: '拾', title: '拾味', browser: '拾味' },
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
  brew: {
    apiEndpoint: '', mode: 'simple', method: 'pourover', doseG: 15, ratio: 15.5,
    profileId: 'recommended', segmentMode: 'auto', segments: 3, lowTempFirst: true,
    dripper: '平底滤杯', grinder: '', waterProfileId: 'auto', waterVolumeL: 5,
    temperatureTune: 0, grindTune: 0, bloomTune: 0, repeatability: false
  },
  identity: { mode: 'guest', nickname: '访客', publicId: '', idSalt: '', verified: false, email: '', phone: '', wechat: '', qq: '' },
  gear: { filterTypes: '', filterStock: '', drippers: '平底滤杯', grinders: '' },
  sensoryRecentLimit: 50,
  shareRecordLimit: 5,
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
  { id: 'score', label: '总分', type: 'score', groups: [] },
  { id: 'note', label: '札记', type: 'note', groups: [] }
];

const state = {
  db: null, codebook: null, codebookIndex: null, codebookMeta: null,
  beans: [], brewSessions: [], sensoryRecords: [], inventoryEvents: [], preferenceModel: null, recommendedIds: new Set(),
  settings: structuredClone(DEFAULT_SETTINGS), page: 'beans', selectedBeanId: null,
  filter: { search: '', country: '', variety: '', process: '', flavors: [], sort: 'freshness', dir: 'asc' },
  recommendedBeanId: null, currentPlan: null, currentBrewInput: null,
  beanFormSource: null, beanFormDraft: null, cameraScanner: null,
  timer: { interval: null, paused: false, stageIndex: 0, remaining: 0 },
  activeGroupKey: null, preferenceBoardOpen: false,
  evaluation: null, sensoryHistoryOpen: false, sensoryFilter: { beanId: '', minScore: '', maxScore: '', start: '', end: '', expanded: false }
};

let toastTimer;
function toast(message, kind = '') {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.className = 'toast', 2600);
}

function showOverlay(content, { full = false, id = 'dialog', backdropClose = false, dialogClass = '' } = {}) {
  const root = $('#overlayRoot');
  root.innerHTML = `<div class="overlay${full ? ' full' : ''}" data-overlay="${esc(id)}"><div class="dialog${dialogClass ? ` ${esc(dialogClass)}` : ''}">${content}</div></div>`;
  const overlay = root.firstElementChild;
  if (backdropClose) overlay.addEventListener('click', event => { if (event.target === overlay) closeOverlay(); });
  requestAnimationFrame(() => bindControlStates(overlay));
  return overlay;
}

function closeOverlay() {
  state.cameraScanner?.stop();
  state.cameraScanner = null;
  $('#overlayRoot').innerHTML = '';
}
function dialogHeader(title, subtitle = '', { closable = true, centered = false } = {}) {
  return `<div class="dialog-header${centered ? ' centered' : ''}"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${closable ? '<button class="close-button" type="button" data-close-overlay aria-label="关闭">×</button>' : ''}</div>`;
}

function bindClose(root = document) { $$('[data-close-overlay]', root).forEach(btn => btn.addEventListener('click', closeOverlay)); }

async function loadSettings() {
  const saved = await getSetting('app.settings', null);
  state.settings = {
    ...structuredClone(DEFAULT_SETTINGS), ...(saved || {}),
    ui: { ...DEFAULT_SETTINGS.ui, ...(saved?.ui || {}) },
    brew: { ...DEFAULT_SETTINGS.brew, ...(saved?.brew || {}) },
    identity: { ...DEFAULT_SETTINGS.identity, ...(saved?.identity || {}) },
    gear: { ...DEFAULT_SETTINGS.gear, ...(saved?.gear || {}) }
  };
  state.settings.sensoryRecentLimit = clamp(state.settings.sensoryRecentLimit || 50, 5, 200);
}

async function saveSettings() { await setSetting('app.settings', state.settings); }

async function refreshData() {
  [state.beans, state.brewSessions, state.sensoryRecords, state.inventoryEvents] = await Promise.all([
    all('beans'), all('brewSessions'), all('sensoryRecords'), all('inventoryEvents')
  ]);
  state.beans.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const activeBeans = state.beans.filter(bean => !bean.archived && Number(bean.remainingWeight) > 0);
  state.preferenceModel = buildPreferenceModel(activeBeans, state.sensoryRecords);
  state.recommendedIds = recommendedBeanIds(activeBeans, state.sensoryRecords);
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

function enterApp() {
  $('#loginScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  switchPage('beans');
  bindControlStates(document);
}

async function setIdentity(mode, details = {}) {
  const nickname = details.nickname || $('#loginNickname')?.value?.trim() || (mode === 'guest' ? '访客' : '本机用户');
  if (mode === 'wechat') {
    showInfoDialog('微信注册尚未接通', '微信 OAuth 需要后端回调、会话和隐私协议。本版本不伪造注册成功，可先使用访客或本机邮箱身份。');
    return;
  }
  const nextIdentity = { ...state.settings.identity, ...details, mode, nickname, verified: false };
  Object.assign(nextIdentity, await derivePublicId(nextIdentity));
  state.settings.identity = nextIdentity;
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
function beanDisplayName(bean) {
  return `${codeName('countries', bean.countryCode, '未定国家')} · ${codeName('varieties', bean.varietyCode, '未定豆种')}`;
}
function roastFromColor(value) {
  const color = Number(value);
  if (!Number.isFinite(color) || color <= 0) return '';
  if (color >= 95) return 'RL-L0';
  if (color >= 85) return 'RL-L1';
  if (color >= 75) return 'RL-L2';
  if (color >= 65) return 'RL-L3';
  if (color >= 55) return 'RL-L4';
  if (color >= 45) return 'RL-L5';
  return 'RL-L6';
}
function uniqueRowsFromBeans(table, field, beans = state.beans.filter(bean => !bean.archived)) {
  const codes = new Set(beans.map(bean => bean[field]).filter(Boolean));
  return (state.codebook?.[table] || []).filter(row => codes.has(row[0]));
}
function availableFlavorRows(beans = state.beans.filter(bean => !bean.archived)) {
  const codes = new Set(beans.flatMap(bean => bean.flavorCodes || []).filter(Boolean));
  return (state.codebook?.flavors || []).filter(row => codes.has(row[0]));
}
function refreshControlState(control) {
  if (!control?.classList?.contains('control')) return;
  const empty = !String(control.value ?? '').trim();
  control.classList.toggle('is-empty', empty);
  control.classList.toggle('is-filled', !empty);
}
function bindControlStates(root = document) {
  $$('input.control,select.control,textarea.control', root).forEach(control => {
    refreshControlState(control);
    if (!control.dataset.stateBound) {
      control.dataset.stateBound = '1';
      control.addEventListener('input', () => refreshControlState(control));
      control.addEventListener('change', () => refreshControlState(control));
    }
  });
}
async function derivePublicId(identity) {
  const salt = identity.idSalt || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const seed = [salt, identity.nickname, identity.email, identity.phone, identity.wechat, identity.qq, identity.mode].map(value => String(value || '').trim().toLocaleLowerCase('zh-CN')).join('|');
  let token = '';
  if (crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
    token = [...new Uint8Array(digest)].slice(0, 6).map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  } else token = Math.abs([...seed].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0)).toString(36).toUpperCase().padStart(10, '0').slice(0, 12);
  return { publicId: `LB-${token}`, idSalt: salt };
}
function resolvedSegmentCount(bean, mode = 'auto') {
  if (mode !== 'auto') return clamp(Number(mode) || Number(state.settings.brew.segments) || 4, 2, 5);
  const roast = Number(String(bean?.roastCode || 'RL-L2').replace(/\D/g, '')) || 2;
  const dose = parseNumber($('#brewDose')?.value, state.settings.brew.doseG || 15);
  if (roast <= 1 && dose >= 18) return 5;
  if (roast >= 4) return 3;
  return 4;
}
function trajectorySvg(plan) {
  const points = plan.trajectory || [];
  if (!points.length) return '<p class="muted small">当前方案没有轨迹数据</p>';
  const width = 320, height = 150, pad = 18;
  const xy = points.map(point => ({ x: pad + clamp(point.x, 0, 1) * (width - pad * 2), y: height - pad - clamp(point.y, 0, 1) * (height - pad * 2) }));
  const path = xy.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  return `<svg class="trajectory-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="萃取轨迹图"><path class="trajectory-axis" d="M${pad},${pad}V${height-pad}H${width-pad}"/><path class="trajectory-line" d="${path}"/>${xy.map((point,index)=>`<circle cx="${point.x}" cy="${point.y}" r="4"><title>阶段${index+1} · ${Math.round(points[index].y*100)}</title></circle>`).join('')}</svg>`;
}
function beanNameSummary(bean) {
  return [codeName('regions', bean.regionCode, ''), codeName('processes', bean.processCode, '')].filter(Boolean).join(' · ') || '产区与处理法未记录';
}

function scoreForBean(beanId) {
  const records = state.sensoryRecords.filter(record => record.beanId === beanId && Number.isFinite(Number(record.subjectiveScore ?? record.score)));
  if (!records.length) return 0;
  return records.reduce((sum, record) => sum + Number(record.subjectiveScore ?? record.score), 0) / records.length;
}

function currentPreferenceModel() {
  return state.preferenceModel || buildPreferenceModel(state.beans.filter(bean => !bean.archived), state.sensoryRecords);
}

function currentRecommendedIds() {
  return state.recommendedIds || new Set();
}

function recommendationScore(bean) {
  const sensory = scoreForBean(bean.id) || 70;
  const preference = currentPreferenceModel().beanStats.get(bean.id)?.preferenceScore || 0;
  const fresh = freshness(bean);
  const freshnessWeight = { resting: 45, peak: 100, good: 82, decline: 64, urgent: 52 }[fresh.key] || 50;
  const initial = Math.max(1, Number(bean.initialWeight) || Number(bean.remainingWeight) || 1);
  const usePriority = clamp(1 - (Number(bean.remainingWeight) || 0) / initial, 0, 1) * 100;
  return sensory * 0.34 + preference * 0.34 + freshnessWeight * 0.22 + usePriority * 0.10;
}

function filteredBeans({ includeArchived = false } = {}) {
  let beans = state.beans.filter(bean => includeArchived ? Boolean(bean.archived) : !bean.archived && Number(bean.remainingWeight) > 0);
  const query = state.filter.search.trim().toLocaleLowerCase('zh-CN');
  if (query) beans = beans.filter(bean => [beanDisplayName(bean), bean.roasterName, bean.notes, codeName('regions', bean.regionCode, ''), codeName('entities', bean.entityCode, ''), codeName('processes', bean.processCode, ''), ...(bean.flavorCodes || []).map(code => codeName('flavors', code, ''))].join(' ').toLocaleLowerCase('zh-CN').includes(query));
  if (state.filter.country) beans = beans.filter(bean => bean.countryCode === state.filter.country);
  if (state.filter.variety) beans = beans.filter(bean => bean.varietyCode === state.filter.variety);
  if (state.filter.process) beans = beans.filter(bean => bean.processCode === state.filter.process);
  if (state.filter.flavors?.length) beans = beans.filter(bean => state.filter.flavors.some(code => (bean.flavorCodes || []).includes(code)));
  const direction = state.filter.dir === 'desc' ? -1 : 1;
  const value = bean => {
    if (state.filter.sort === 'name') return beanDisplayName(bean);
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
  const score = scoreForBean(bean.id);
  const recommended = currentRecommendedIds().has(bean.id);
  const process = codeName('processes', bean.processCode, '处理法未记');
  return `<article class="bean-card compact${bean.id === state.recommendedBeanId ? ' recommended' : ''}${bean.archived ? ' archived' : ''}" data-bean-id="${esc(bean.id)}" tabindex="0">
    <div class="compact-bean-copy"><h3>${esc(beanDisplayName(bean))}</h3><small>${esc(process)}</small><div class="compact-bean-row"><strong>${Number(bean.remainingWeight || 0).toFixed(1)}g</strong><span class="compact-score">${score ? `${score.toFixed(1)}分` : '未评分'}${recommended ? '<em>荐</em>' : ''}</span></div></div>
    <button class="cup-action compact-pick" type="button" data-brew-bean="${esc(bean.id)}" aria-label="用这只豆拾一味">拾</button>
  </article>`;
}

function groupCardHtml(label, items) {
  const totalWeight = items.reduce((sum, bean) => sum + Number(bean.remainingWeight || 0), 0);
  return `<button class="group-card" type="button" data-open-group="${esc(label)}"><span>${esc(label)}</span><small>${items.length}只 · ${totalWeight.toFixed(1)}g</small></button>`;
}

function recommendationLeaderboardRows(limit = 6) {
  const model = currentPreferenceModel();
  return state.beans.filter(bean => !bean.archived && Number(bean.remainingWeight) > 0)
    .map(bean => ({ bean, score: model.beanStats.get(bean.id)?.preferenceScore || 0, sensory: scoreForBean(bean.id) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function recommendationLeaderboardHtml() {
  const rows = recommendationLeaderboardRows(3);
  if (!state.sensoryRecords.length || !rows.length) return '';
  return `<button class="preference-board-line" type="button" data-open-recommend-board><span>荐榜</span>${rows.map((row, index) => `<span>${index + 1}. ${esc(beanDisplayName(row.bean))}</span>`).join('')}</button>`;
}

function openRecommendationLeaderboard() {
  const rows = recommendationLeaderboardRows(50);
  const content = `${dialogHeader('荐榜', '综合主观得分、自动分差与个人标签累计', { closable: false })}<div class="recommendation-board">${rows.length ? rows.map((row, index) => `<button type="button" data-board-bean="${esc(row.bean.id)}"><span>${index + 1}</span><strong>${esc(beanDisplayName(row.bean))}</strong><small>${row.score.toFixed(1)} · 品鉴${row.sensory ? row.sensory.toFixed(1) : '—'}</small></button>`).join('') : '<p class="muted">完成品鉴后生成个人荐榜。</p>'}</div><button class="bottom-return" type="button" data-close-overlay>退</button>`;
  const overlay = showOverlay(content, { id: 'recommendation-board', backdropClose: true, dialogClass: 'bottom-sheet' });
  bindClose(overlay);
  overlay.addEventListener('click', event => { const button = event.target.closest('[data-board-bean]'); if (!button) return; closeOverlay(); detailBean(button.dataset.boardBean); });
}

function renderBeans() {
  const container = $('#beanGroups');
  const beans = filteredBeans();
  const filterParts = [];
  if (state.filter.search) filterParts.push(`关键词：${state.filter.search}`);
  if (state.filter.country) filterParts.push(`国家：${codeName('countries', state.filter.country)}`);
  if (state.filter.variety) filterParts.push(`豆种：${codeName('varieties', state.filter.variety)}`);
  if (state.filter.process) filterParts.push(`工法：${codeName('processes', state.filter.process)}`);
  if (state.filter.flavors?.length) filterParts.push(`风味：${state.filter.flavors.length}项`);
  const bar = $('#activeFilterBar');
  bar.classList.toggle('hidden', !filterParts.length);
  bar.innerHTML = filterParts.length ? `${filterParts.map(value => `<span class="tag">${esc(value)}</span>`).join('')}<button class="button subtle small" id="clearActiveFilters" type="button">清除</button>` : '';
  $('#filterSummaryBtn').textContent = filterParts.length ? `筛选 ${filterParts.length}` : '筛选';
  if (!beans.length) {
    state.activeGroupKey = null;
    container.innerHTML = `<div class="empty-state"><strong>没有符合条件的豆卡</strong><p>点击“添”录入，或清除筛选。</p></div>`;
    return;
  }
  const board = recommendationLeaderboardHtml();
  if (beans.length <= 6) {
    state.activeGroupKey = null;
    container.innerHTML = `${board}<div class="bean-grid compact-grid">${beans.map(beanCardHtml).join('')}</div>`;
    return;
  }
  const groupMethod = state.settings.groupMethod || 'country';
  const groups = new Map();
  for (const bean of beans) {
    const key = groupKey(bean, groupMethod);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bean);
  }
  if (state.activeGroupKey && !groups.has(state.activeGroupKey)) state.activeGroupKey = null;
  if (!state.activeGroupKey) {
    container.innerHTML = `${board}<div class="bean-grid compact-grid group-grid">${[...groups.entries()].map(([label, items]) => groupCardHtml(label, items)).join('')}</div>`;
    return;
  }
  const items = groups.get(state.activeGroupKey) || [];
  container.innerHTML = `${board}<div class="active-group-title"><span>${esc(state.activeGroupKey)}</span><small>${items.length}只</small></div><div class="bean-grid compact-grid">${items.map(beanCardHtml).join('')}</div><button class="group-collapse" type="button" data-collapse-group>收</button>`;
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
    state.settings.groupMethod = button.dataset.groupMethod; state.activeGroupKey = null;
    await saveSettings(); closePopups(); renderBeans();
  });
}

function openManageMenu() {
  closePopups();
  const popup = document.createElement('div'); popup.className = 'popup-menu';
  popup.innerHTML = `<button type="button" data-manage-action="export">导出数据</button><button type="button" data-manage-action="import">导入数据</button><button type="button" data-manage-action="history">诹吉</button>`;
  document.body.append(popup); positionPopup($('#manageBtn'), popup);
}

function openSearchDialog() {
  closePopups();
  const activeBeans = state.beans.filter(bean => !bean.archived && Number(bean.remainingWeight) > 0);
  const countryRows = uniqueRowsFromBeans('countries', 'countryCode', activeBeans);
  const varietyRows = uniqueRowsFromBeans('varieties', 'varietyCode', activeBeans);
  const processRows = uniqueRowsFromBeans('processes', 'processCode', activeBeans);
  const flavorRows = availableFlavorRows(activeBeans);
  const selectedFlavors = new Set(state.filter.flavors || []);
  const content = `${dialogHeader('寻', '选项只来自当前豆藏中的豆卡', { closable: false })}
    <div class="form-grid search-grid">
      <div class="form-field"><label>关键词</label><input id="searchInput" class="control" value="${esc(state.filter.search)}" placeholder="产区、烘焙商、风味等"></div>
      <div class="form-field"><label>国家</label><select id="searchCountry" class="control">${optionsHtml(countryRows, state.filter.country, 1, '全部现有国家')}</select></div>
      <div class="form-field"><label>豆种</label><select id="searchVariety" class="control">${optionsHtml(varietyRows, state.filter.variety, 1, '全部现有豆种')}</select></div>
      <div class="form-field"><label>处理法</label><select id="searchProcess" class="control">${optionsHtml(processRows, state.filter.process, 1, '全部现有处理法')}</select></div>
      <div class="form-field"><label>排序</label><select id="searchSort" class="control">${[['recommended','推荐'],['freshness','赏味期'],['name','名称'],['roastDate','烘焙日期'],['remaining','剩余克重'],['price','价格'],['score','品鉴得分']].map(([value,label])=>`<option value="${value}"${state.filter.sort===value?' selected':''}>${label}</option>`).join('')}</select></div>
      <div class="form-field"><label>方向</label><select id="searchDir" class="control"><option value="asc"${state.filter.dir==='asc'?' selected':''}>升序</option><option value="desc"${state.filter.dir==='desc'?' selected':''}>降序</option></select></div>
    </div>
    <details class="details-block"${selectedFlavors.size ? ' open' : ''}><summary>现有风味</summary><div class="details-content"><div class="flavor-grid compact">${flavorRows.length ? flavorRows.map(row=>`<button type="button" class="flavor-button filter-flavor${selectedFlavors.has(row[0])?' selected':''}" data-filter-flavor="${esc(row[0])}">${esc(row[1])}</button>`).join('') : '<span class="muted small">当前豆卡尚无风味标签</span>'}</div></div></details>
    <div class="row menu-row"><button id="resetSearchBtn" class="button subtle" type="button">重置</button><button id="applySearchBtn" class="button primary" type="button">确认</button></div>`;
  const overlay = showOverlay(content, { id: 'bean-search', backdropClose: true, dialogClass: 'bottom-sheet' });
  overlay.addEventListener('click', event => {
    const button = event.target.closest('[data-filter-flavor]');
    if (button) button.classList.toggle('selected');
  });
  $('#resetSearchBtn').addEventListener('click', () => {
    state.filter = { search: '', country: '', variety: '', process: '', flavors: [], sort: 'freshness', dir: 'asc' }; state.activeGroupKey = null; closeOverlay(); renderBeans();
  });
  $('#applySearchBtn').addEventListener('click', () => {
    state.filter = {
      search: $('#searchInput').value.trim(), country: $('#searchCountry').value, variety: $('#searchVariety').value, process: $('#searchProcess').value,
      flavors: $$('[data-filter-flavor].selected', overlay).map(button => button.dataset.filterFlavor),
      sort: $('#searchSort').value, dir: $('#searchDir').value
    };
    state.activeGroupKey = null; closeOverlay(); renderBeans();
  });
}

function openRecommendMenu() {
  closePopups();
  const popup = document.createElement('div'); popup.className = 'recommend-menu';
  const items = [
    ['leaderboard', '荐榜', '#c9a45f', false], ['preference', '喜好', '#c74f4f', false], ['freshness', '赏味期', '#5e9a68', false],
    ['price', '价格', '#c9a45f', false], ['remaining', '余粮', '#f1f1ed', false], ['random', '点兵点将', '#e88b3d', true]
  ];
  popup.innerHTML = items.map(([mode, label, color, large]) => `<button type="button" class="recommend-option" data-recommend-mode="${mode}" aria-label="${label}"><span class="recommend-label">${label}</span><span class="recommend-dot${large?' random':''}" style="background:${color}"></span></button>`).join('');
  document.body.append(popup); positionPopup($('#fabRecommendBtn'), popup, { above: true });
}

async function recommendBean(mode) {
  closePopups();
  if (mode === 'leaderboard') { openRecommendationLeaderboard(); return; }
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
  toast(`推荐：${beanDisplayName(selected)}`);
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
  const colorValue = bean.roastColor || '';
  const roastValue = colorValue ? roastFromColor(colorValue) : (bean.roastCode || '');
  return `${dialogHeader(bean.id ? '编辑豆卡' : '新增豆卡', `来源：${source.type || bean.source || '手工录入'}`)}
    <form id="beanForm" novalidate>
      <div class="form-grid">
        ${fieldHtml('beanCountry','国家',`<select id="beanCountry" class="control">${selectOptions(state.codebook.countries,bean.countryCode)}</select>`,'required')}
        ${fieldHtml('beanRegion','产区',`<select id="beanRegion" class="control">${selectOptions(regions,bean.regionCode,1,bean.countryCode?'请选择产区':'先选择国家')}</select>`)}
        ${fieldHtml('beanEntity','庄园 / 处理站',`<select id="beanEntity" class="control">${selectOptions(entities,bean.entityCode,3,bean.countryCode?'请选择庄园 / 处理站':'先选择国家')}</select>`)}
        ${fieldHtml('beanVariety','豆种',`<select id="beanVariety" class="control">${selectOptions(state.codebook.varieties,bean.varietyCode)}</select>`,'required')}
        ${fieldHtml('beanProcess','处理法',`<select id="beanProcess" class="control">${selectOptions(state.codebook.processes,bean.processCode)}</select>`,'required')}
        ${fieldHtml('beanRoastColor','烘焙色值',`<input id="beanRoastColor" class="control" type="number" min="20" max="120" step="1" value="${esc(colorValue)}" placeholder="Agtron 20–120">`,'recommended')}
        ${fieldHtml('beanRoast','烘焙度',`<select id="beanRoast" class="control"><option value="">填写色值自动生成</option>${ROASTS.map(([value,label])=>`<option value="${value}"${roastValue===value?' selected':''}>${label}</option>`).join('')}</select>`,'required')}
        ${fieldHtml('beanRoastDate','烘焙日期',`<input id="beanRoastDate" class="control" type="date" value="${esc(bean.roastDate || todayISO())}">`,'required')}
        ${fieldHtml('beanInitialWeight','初始克重',`<input id="beanInitialWeight" class="control" type="number" min="1" max="10000" step="0.1" value="${esc(bean.initialWeight || '')}">`,'required')}
        ${fieldHtml('beanRefrigerated','是否冷藏',`<select id="beanRefrigerated" class="control"><option value="false"${!bean.refrigerated?' selected':''}>否</option><option value="true"${bean.refrigerated?' selected':''}>是</option></select>`,'recommended')}
        ${fieldHtml('beanPrice','购买价格',`<input id="beanPrice" class="control" type="number" min="0" step="0.01" value="${esc(bean.price || '')}">`,'recommended')}
        ${fieldHtml('beanRoaster','烘焙商',`<input id="beanRoaster" class="control" maxlength="60" value="${esc(bean.roasterName || bean.roaster || '')}">`,'recommended')}
        ${fieldHtml('beanAltitude','海拔',`<input id="beanAltitude" class="control" type="number" min="0" max="5000" value="${esc(bean.altitude || '')}">`)}
        ${fieldHtml('beanNotes','备注',`<input id="beanNotes" class="control" maxlength="300" value="${esc(bean.notes || '')}">`)}
      </div>
      <section class="panel"><div class="panel-title"><div><h3>风味标签</h3><p>${state.codebook.flavors?.length || 0}项可用</p></div><button id="editFlavorsBtn" class="button" type="button">编辑</button></div><div id="formFlavorSummary" class="flavor-summary">${flavors.map(code=>`<span class="tag" data-summary-code="${esc(code)}">${esc(codeName('flavors',code,code))}</span>`).join('') || '<span class="muted small">尚未选择</span>'}</div></section>
      ${source.evidence ? evidenceHtml(source.evidence, source.confidence) : ''}
      <div class="row"><button id="beanFormBackBtn" class="button subtle" type="button">返回</button><span class="grow"></span><button class="button primary" type="submit">保存</button></div>
    </form>`;
}

function fieldHtml(id, label, control, level = '') {
  const badge = level === 'required' ? '<span class="badge required">必填</span>' : (level === 'recommended' ? '<span class="badge">建议</span>' : '');
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
  const syncRoastColor = () => {
    const color = formValue('beanRoastColor');
    const select = $('#beanRoast');
    if (color) {
      select.value = roastFromColor(color);
      select.dataset.autoFromColor = 'true';
      select.disabled = true;
    } else if (select.dataset.autoFromColor === 'true') {
      select.value = '';
      delete select.dataset.autoFromColor;
      select.disabled = false;
    }
    refreshControlState(select);
  };
  $('#beanCountry').addEventListener('change', () => {
    const country = $('#beanCountry').value;
    $('#beanRegion').innerHTML = selectOptions(relatedRows(state.codebook, 'regions', country), '', 1, country ? '请选择产区' : '先选择国家');
    $('#beanEntity').innerHTML = selectOptions(relatedRows(state.codebook, 'entities', country), '', 3, country ? '请选择庄园 / 处理站' : '先选择国家');
    bindControlStates(form);
  });
  $('#beanRoastColor').addEventListener('input', syncRoastColor);
  if (formValue('beanRoastColor')) { $('#beanRoast').dataset.autoFromColor = 'true'; syncRoastColor(); }
  $('#editFlavorsBtn').addEventListener('click', () => openFlavorEditor(selectedSummaryCodes(), bean, source));
  $('#beanFormBackBtn').addEventListener('click', () => {
    if (source.type === 'text') openTextRecognition(source.text || '', captureBeanFormDraft()); else closeOverlay();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const required = [['beanCountry','国家'],['beanVariety','豆种'],['beanProcess','处理法'],['beanRoast','烘焙度'],['beanRoastDate','烘焙日期'],['beanInitialWeight','初始克重']];
    for (const [id,label] of required) if (!formValue(id)) return toast(`请填写${label}`, 'status-bad');
    const initialWeight = parseNumber(formValue('beanInitialWeight'));
    if (initialWeight <= 0) return toast('初始克重必须大于 0', 'status-bad');
    const countryCode = formValue('beanCountry');
    const varietyCode = formValue('beanVariety');
    const now = new Date().toISOString();
    const record = {
      ...bean, id: bean.id || uid('bean'), name: `${codeName('countries', countryCode, '未定国家')} · ${codeName('varieties', varietyCode, '未定豆种')}`,
      countryCode, regionCode: formValue('beanRegion'), entityCode: formValue('beanEntity'), varietyCode, processCode: formValue('beanProcess'),
      roastColor: parseNumber(formValue('beanRoastColor'), 0) || '', roastCode: formValue('beanRoast'), roastDate: formValue('beanRoastDate'), initialWeight,
      remainingWeight: bean.id ? Number(bean.remainingWeight) : initialWeight, refrigerated: formValue('beanRefrigerated') === 'true', freezeDate: formValue('beanRefrigerated') === 'true' ? (bean.freezeDate || todayISO()) : '',
      price: parseNumber(formValue('beanPrice'), 0), roasterName: formValue('beanRoaster'), altitude: parseNumber(formValue('beanAltitude'), 0), notes: formValue('beanNotes'),
      flavorCodes: selectedSummaryCodes(), archived: Boolean(bean.archived), source: source.type || bean.source || 'manual',
      codebookSchemaVersion: Number(state.codebook._schemaVersion || 1), codebookDataVersion: String(state.codebook.version || '6'),
      createdAt: bean.createdAt || now, updatedAt: now
    };
    await put('beans', record); await refreshData(); closeOverlay(); renderBeans(); toast(bean.id ? '豆卡已更新' : '豆卡已加入豆藏', 'status-good');
  });
  bindControlStates(form);
}

function selectedSummaryCodes() { return $$('#formFlavorSummary [data-summary-code]').map(node => node.dataset.summaryCode); }
function captureBeanFormDraft() {
  return { ...state.beanFormDraft, countryCode: formValue('beanCountry'), regionCode: formValue('beanRegion'), entityCode: formValue('beanEntity'), varietyCode: formValue('beanVariety'), processCode: formValue('beanProcess'), roastColor: formValue('beanRoastColor'), roastCode: formValue('beanRoast'), roastDate: formValue('beanRoastDate'), initialWeight: formValue('beanInitialWeight'), refrigerated: formValue('beanRefrigerated') === 'true', price: formValue('beanPrice'), roasterName: formValue('beanRoaster'), altitude: formValue('beanAltitude'), notes: formValue('beanNotes'), flavorCodes: selectedSummaryCodes() };
}

function openFlavorEditor(selected, bean, source) {
  const draft = captureBeanFormDraft();
  const set = new Set(selected);
  const rows = state.codebook.flavors || [];
  const content = `${dialogHeader('风味标签', `可用 ${rows.length} 项，最多选择 12 项`)}<div class="flavor-grid">${rows.length ? rows.map(row=>`<button type="button" class="flavor-button${set.has(row[0])?' selected':''}" data-flavor-code="${esc(row[0])}">${esc(row[1])}</button>`).join('') : '<p class="status-bad">风味数据库未载入，请到器设 → 数藏检查数据源。</p>'}</div><div class="row end"><button id="clearFlavorsBtn" class="button subtle" type="button">清空</button><button id="confirmFlavorsBtn" class="button primary" type="button">确定</button></div>`;
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
  $('#speechTextBtn').addEventListener('click', () => startSpeechRecognition('recognitionText'));
}

function startSpeechRecognition(targetId = 'recognitionText') {
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Recognition) return toast('当前浏览器不支持语音识别');
  const target = $(`#${targetId}`); if (!target) return toast('未找到文字输入区域');
  const recognition = new Recognition(); recognition.lang = 'zh-CN'; recognition.interimResults = false;
  recognition.onresult = event => { target.value += `${target.value ? ' ' : ''}${event.results[0][0].transcript}`; target.dispatchEvent(new Event('input', { bubbles: true })); };
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
  const records = state.sensoryRecords.filter(record => record.beanId === bean.id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,3);
  const sessions = state.brewSessions.filter(session => session.beanId === bean.id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,5);
  const content = `${dialogHeader(beanDisplayName(bean), beanNameSummary(bean))}
    <div class="detail-layout"><div class="freshness-card"><div><div class="small muted">赏味状态</div><h2>${esc(fresh.label)}</h2><p class="muted small">烘焙日期 ${formatDate(bean.roastDate)} · 剩余 ${Number(bean.remainingWeight||0).toFixed(1)}g</p></div><div><div class="freshness-bar"><span class="freshness-marker" style="left:${marker}%"></span></div><div class="row small muted"><span>养豆</span><span class="grow"></span><span>高峰</span><span class="grow"></span><span>衰减</span></div></div></div>
    <div class="management-stack"><button id="correctWeightBtn" class="button" type="button">修正克重</button><button id="toggleColdBtn" class="button${bean.refrigerated?' active':''}" type="button">${bean.refrigerated?'解除冷藏':'设为冷藏'}</button><button id="archiveBeanBtn" class="button" type="button">${bean.archived?'移出诹吉':'放入诹吉'}</button></div></div>
    <div class="detail-tags">${flavors || '<span class="muted small">风味待录</span>'}</div>
    <section class="panel"><div class="panel-title"><div><h3>冲煮记录</h3><p>点击可载入完整方案复刻</p></div></div><div class="record-list">${sessions.length ? sessions.map(sessionRecordHtml).join('') : '<p class="muted small">尚无冲煮记录</p>'}</div></section>
    <section class="panel"><div class="panel-title"><div><h3>最近品鉴</h3></div></div>${records.length ? records.map(record=>`<div class="record-item"><span>${formatDate(record.createdAt)}</span><span>${esc((record.summary||[]).join(' · '))}${record.naturalNote ? `<small>${esc(record.naturalNote)}</small>` : ''}</span><strong>${Number(record.subjectiveScore ?? record.score ?? 0).toFixed(1)}</strong></div>`).join('') : '<p class="muted small">尚无品鉴记录</p>'}</section>
    <div class="detail-actions menu-row"><button id="brewThisBeanBtn" class="button primary" type="button">拾一味</button><button id="editBeanBtn" class="button" type="button">编辑</button><button id="copyBeanBtn" class="button" type="button">复制</button><button id="shareBeanBtn" class="button" type="button">分享</button></div>`;
  const overlay = showOverlay(content, { id: 'bean-detail' }); bindClose(overlay);
  $('#correctWeightBtn').addEventListener('click', () => correctWeightDialog(bean));
  $('#toggleColdBtn').addEventListener('click', async () => { bean.refrigerated = !bean.refrigerated; bean.freezeDate = bean.refrigerated ? todayISO() : ''; bean.updatedAt = new Date().toISOString(); await put('beans', bean); await refreshData(); detailBean(bean.id); });
  $('#archiveBeanBtn').addEventListener('click', async () => { bean.archived = !bean.archived; bean.updatedAt = new Date().toISOString(); await put('beans', bean); await refreshData(); closeOverlay(); renderBeans(); toast(bean.archived?'已放入诹吉':'已恢复到豆藏'); });
  $('#brewThisBeanBtn').addEventListener('click', () => { closeOverlay(); state.selectedBeanId = bean.id; state.currentPlan = null; switchPage('brew'); });
  $('#editBeanBtn').addEventListener('click', () => openBeanForm(bean, { type: 'manual' }));
  $('#copyBeanBtn').addEventListener('click', () => { const copy = { ...bean, id: undefined, createdAt: undefined, updatedAt: undefined, remainingWeight: bean.initialWeight }; openBeanForm(copy, { type: 'copy' }); });
  $('#shareBeanBtn').addEventListener('click', () => openShareDialog(bean));
  overlay.addEventListener('click', event => { const replay = event.target.closest('[data-replay-session]'); if (replay) loadBrewSession(replay.dataset.replaySession); });
}

function sessionRecordHtml(session) {
  const corrected = session.status === 'corrected' || session.correction;
  const score = Number(session.subjectiveScore ?? 0);
  return `<button class="record-item brew-record" type="button" data-replay-session="${esc(session.id)}"><span>${formatDate(session.createdAt)}</span><span>${esc(session.profile?.label || String(session.profileVersion || '').split('@')[0] || '冲煮方案')}${corrected ? '<em>修</em>' : ''}${session.sensoryNote ? `<small>${esc(session.sensoryNote)}</small>` : ''}</span><strong>${score ? score.toFixed(1) : `${Number(session.totals?.waterG || 0).toFixed(0)}g`}</strong></button>`;
}

function loadBrewSession(sessionId) {
  const session = state.brewSessions.find(item => item.id === sessionId); if (!session) return toast('冲煮记录不存在');
  closeOverlay(); state.selectedBeanId = session.beanId; state.currentPlan = structuredClone(session); state.currentBrewInput = structuredClone(session.input || null);
  switchPage('brew'); requestAnimationFrame(() => $('#generatedPlan')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); toast(session.correction ? '已载入修正方案' : '已载入历史方案');
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
  const segmentMode = $('#brewSegments')?.value || 'auto';
  const segments = resolvedSegmentCount(bean, segmentMode);
  const waterProfileId = $('#brewWaterProfile')?.value || state.settings.brew.waterProfileId || 'auto';
  return {
    schemaVersion: 2,
    bean: { countryCode: bean.countryCode, regionCode: bean.regionCode, entityCode: bean.entityCode, varietyCode: bean.varietyCode, processCode: bean.processCode, roastCode: bean.roastCode, roastColor: bean.roastColor || null, roastDate: bean.roastDate, altitude: bean.altitude || null },
    brew: {
      mode: state.settings.brew.mode || 'simple', method: $('#brewMethod')?.value || 'pourover', doseG: parseNumber($('#brewDose')?.value, 15), ratio: parseNumber($('#brewRatio')?.value, 15.5),
      profileId: $('#brewProfile')?.value || 'recommended', segmentMode, segments, lowTempFirst: $('#lowTempFirst')?.checked ?? true,
      dripperCode: $('#brewDripper')?.value || '平底滤杯', filterPaper: $('#brewFilterPaper')?.value || '', grinder: $('#brewGrinder')?.value || '',
      temperatureTune: parseNumber($('#brewTemperatureTune')?.value, 0), grindTune: parseNumber($('#brewGrindTune')?.value, 0), bloomTune: parseNumber($('#brewBloomTune')?.value, 0),
      repeatability: $('#brewRepeatability')?.checked ?? false, waterProfileId: waterProfileId === 'auto' ? inferWaterProfile(bean) : waterProfileId
    },
    water: { profileId: waterProfileId === 'auto' ? inferWaterProfile(bean) : waterProfileId, recipeVolumeL: parseNumber($('#brewWaterVolume')?.value, 5), tdsMgL: parseNumber($('#brewTds')?.value, 90) },
    targets: { floral: parseNumber($('#targetFloral')?.value, 2), acidity: parseNumber($('#targetAcidity')?.value, 1.5), sweetness: parseNumber($('#targetSweet')?.value, 2), body: parseNumber($('#targetBody')?.value, 1), bitterness: parseNumber($('#targetBitterness')?.value, 2) }
  };
}

function renderBrew() {
  const container = $('#brewContent');
  const activeBeans = state.beans.filter(bean => !bean.archived && Number(bean.remainingWeight) > 0);
  if (!state.selectedBeanId && activeBeans.length) state.selectedBeanId = activeBeans[0].id;
  const selected = activeBeans.find(bean => bean.id === state.selectedBeanId);
  const settings = state.settings.brew;
  const recommendedSegments = resolvedSegmentCount(selected, 'auto');
  const waterProfiles = listWaterProfiles();
  const inferredWater = selected ? inferWaterProfile(selected) : 'custom';
  const currentWater = settings.waterProfileId || 'auto';
  const recentSessions = state.brewSessions.filter(session => session.beanId === state.selectedBeanId).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,5);
  container.innerHTML = `<section class="panel brew-form"><div class="brew-inputs">
    <div class="brew-main-row"><label class="field"><span>豆卡</span><select id="brewBean" class="control">${activeBeans.map(bean=>`<option value="${esc(bean.id)}"${bean.id===state.selectedBeanId?' selected':''}>${esc(beanDisplayName(bean))}</option>`).join('')}</select></label><label class="field"><span>粉量</span><input id="brewDose" class="control" type="number" min="5" max="40" step="0.1" value="${settings.doseG}"></label></div>
    <div class="grid-2"><label class="field"><span>粉水比</span><input id="brewRatio" class="control" type="number" min="8" max="25" step="0.1" value="${settings.ratio}"></label><label class="field"><span>滤杯</span><select id="brewDripper" class="control"><option${settings.dripper==='平底滤杯'?' selected':''}>平底滤杯</option><option${settings.dripper==='锥形滤杯'?' selected':''}>锥形滤杯</option><option${settings.dripper==='混合式滤杯'?' selected':''}>混合式滤杯</option><option${settings.dripper==='低旁路滤杯'?' selected':''}>低旁路滤杯</option></select></label></div>
    <details class="details-block professional-config"><summary>专业设定……</summary><div class="details-content">
      <div class="grid-2"><label class="field"><span>冲煮法</span><select id="brewProfile" class="control">${listBrewProfiles().map(profile=>`<option value="${profile.id}"${settings.profileId===profile.id?' selected':''}>${profile.label}</option>`).join('')}</select></label><label class="field"><span>分段方式</span><select id="brewSegments" class="control"><option value="auto"${settings.segmentMode==='auto'?' selected':''}>模型自动推荐：${recommendedSegments+1}段</option>${[1,2,3,4,5].map(value=>`<option value="${value}"${String(settings.segmentMode)===String(value)?' selected':''}>${value+1}段（含闷蒸）</option>`).join('')}</select></label>
      <label class="field"><span>研磨设备 / 刻度</span><input id="brewGrinder" class="control" value="${esc(settings.grinder)}" placeholder="例如 C40 22格"></label><label class="field"><span>滤纸</span><input id="brewFilterPaper" class="control" value="${esc(settings.filterPaper || '')}" placeholder="例如 Wave 185"></label>
      <label class="field"><span>调水方案</span><select id="brewWaterProfile" class="control"><option value="auto"${currentWater==='auto'?' selected':''}>模型推荐：${esc(waterProfiles.find(item=>item.id===inferredWater)?.name || inferredWater)}</option>${waterProfiles.map(profile=>`<option value="${profile.id}"${currentWater===profile.id?' selected':''}>${esc(profile.name)}</option>`).join('')}</select></label><label class="field"><span>调水计算体积</span><input id="brewWaterVolume" class="control" type="number" min="1" max="20" step="1" value="${settings.waterVolumeL || 5}"></label>
      <label class="field"><span>TDS mg/L</span><input id="brewTds" class="control" type="number" min="20" max="250" value="${settings.tdsMgL || 90}"></label><label class="field"><span>制作方法</span><select id="brewMethod" class="control"><option value="pourover">手冲咖啡</option><option value="aeropress">爱乐压</option><option value="coldbrew">冷萃</option></select></label></div>
      <label class="field"><span>目标：花香 / 酸 / 甜 / 体感 / 抑苦</span><div class="grid-5"><input id="targetFloral" class="control" type="number" min="0" max="3" step="0.5" value="${settings.targetFloral ?? 2}"><input id="targetAcidity" class="control" type="number" min="0" max="3" step="0.5" value="${settings.targetAcidity ?? 1.5}"><input id="targetSweet" class="control" type="number" min="0" max="3" step="0.5" value="${settings.targetSweet ?? 2}"><input id="targetBody" class="control" type="number" min="0" max="3" step="0.5" value="${settings.targetBody ?? 1}"><input id="targetBitterness" class="control" type="number" min="0" max="3" step="0.5" value="${settings.targetBitterness ?? 2}"></div></label>
      <div class="grid-3"><label class="field"><span>温度微调 °C</span><input id="brewTemperatureTune" class="control" type="number" min="-6" max="6" value="${settings.temperatureTune || 0}"></label><label class="field"><span>研磨微调</span><input id="brewGrindTune" class="control" type="number" min="-4" max="4" value="${settings.grindTune || 0}"></label><label class="field"><span>闷蒸秒数微调</span><input id="brewBloomTune" class="control" type="number" min="-20" max="40" value="${settings.bloomTune || 0}"></label></div>
      <div class="menu-row"><label class="toggle"><input id="lowTempFirst" type="checkbox"${settings.lowTempFirst!==false?' checked':''}>首段降温</label><label class="toggle"><input id="brewRepeatability" type="checkbox"${settings.repeatability?' checked':''}>复刻优先</label></div>
    </div></details>
    <div class="brew-generate-row menu-row"><button id="generatePlanBtn" class="button primary" type="button"${selected?'':' disabled'}>生成方案</button><button id="directSensoryBtn" class="button" type="button"${selected?'':' disabled'}>直接品鉴</button></div>
  </div></section>
  <div id="planResult">${state.currentPlan && state.currentPlan.beanId === state.selectedBeanId ? planHtml(state.currentPlan) : ''}</div>
  ${recentSessions.length ? `<section class="panel"><div class="panel-title"><div><h3>往次方案</h3><p>点击复刻，修正方案标“修”</p></div></div><div class="record-list">${recentSessions.map(sessionRecordHtml).join('')}</div></section>` : ''}`;
  $('#brewBean')?.addEventListener('change', event => { state.selectedBeanId = event.target.value; state.currentPlan = null; renderBrew(); });
  $('#generatePlanBtn')?.addEventListener('click', generatePlan);
  $('#directSensoryBtn')?.addEventListener('click', () => { if (!state.selectedBeanId) return; startEvaluation(state.selectedBeanId, { direct: true }); switchPage('sensory'); });
  container.addEventListener('click', event => { const replay = event.target.closest('[data-replay-session]'); if (replay) loadBrewSession(replay.dataset.replaySession); });
  bindPlanActions(); bindControlStates(container);
}

async function generatePlan() {
  const bean = state.beans.find(item => item.id === $('#brewBean').value); if (!bean) return toast('请先选择豆卡');
  const button = $('#generatePlanBtn'); state.selectedBeanId = bean.id;
  const input = buildBrewInput(bean); state.currentBrewInput = input;
  button.disabled = true; button.textContent = '正在计算…';
  try {
    let plan, apiError = '';
    try { plan = await requestPrivatePlan(state.settings.brew.apiEndpoint, input); }
    catch (error) { apiError = error.message; plan = await computeFallbackPlan(input); }
    plan.beanId = bean.id; plan.id = uid('brew'); plan.createdAt = new Date().toISOString(); plan.status = 'planned'; plan.input = input;
    if (apiError) plan.warnings = [...(plan.warnings || []), '私有冲煮服务未接通，当前使用浏览器兼容模型；私有仓库代码未暴露到网页。'];
    validatePlan(plan); state.currentPlan = plan;
    await put('brewSessions', plan); await refreshData();
    state.settings.brew = {
      ...state.settings.brew, method: input.brew.method, doseG: input.brew.doseG, ratio: input.brew.ratio,
      profileId: input.brew.profileId, segmentMode: input.brew.segmentMode, segments: input.brew.segments, lowTempFirst: input.brew.lowTempFirst,
      dripper: input.brew.dripperCode, filterPaper: input.brew.filterPaper, grinder: input.brew.grinder, waterProfileId: $('#brewWaterProfile')?.value || 'auto', waterVolumeL: input.water.recipeVolumeL,
      temperatureTune: input.brew.temperatureTune, grindTune: input.brew.grindTune, bloomTune: input.brew.bloomTune, repeatability: input.brew.repeatability,
      targetFloral: input.targets.floral, targetAcidity: input.targets.acidity, targetSweet: input.targets.sweetness, targetBody: input.targets.body, targetBitterness: input.targets.bitterness,
      tdsMgL: input.water.tdsMgL
    };
    await saveSettings(); $('#planResult').innerHTML = planHtml(plan); bindPlanActions();
    requestAnimationFrame(() => $('#planResult').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  } catch (error) {
    console.error(error); toast(`方案生成失败：${error.message}`, 'status-bad');
  } finally {
    if (button?.isConnected) { button.disabled = false; button.textContent = state.currentPlan ? '重新生成' : '生成方案'; }
  }
}

function planHtml(plan) {
  const flavor = plan.flavorFit || {};
  const first = plan.stages?.[0];
  const water = plan.water;
  const candidates = plan.recommendation?.candidates || [];
  const corrected = Boolean(plan.correction);
  return `<section class="panel generated-plan" id="generatedPlan"><div class="panel-title"><div><h2>冲煮方案${corrected ? ' · 修正' : ''}</h2><p>${Number(plan.totals?.doseG||0).toFixed(1)}g · ${Number(plan.totals?.waterG||0).toFixed(0)}g · ${formatSeconds(plan.totals?.targetTimeSec||0)}</p></div><span class="plan-profile-label">${esc(plan.profile?.label || String(plan.profileVersion || '').split('@')[0])}</span></div>
  ${(plan.warnings||[]).map(warning=>`<p class="small status-warn">${esc(warning)}</p>`).join('')}
  ${first ? `<p class="low-temp-note">首段建议 ${Number(first.temperatureC).toFixed(0)}°C：${esc(plan.firstPourReason || '控制初段释放并保留香气与甜感。')}</p>` : ''}
  <div>${plan.stages.map(stage=>`<article class="plan-stage"><div class="stage-index">${stage.index}</div><div class="stage-lines"><div class="stage-line"><div class="stage-cell"><span>本段注水</span><strong>${Number(stage.stageWaterG).toFixed(0)}g</strong></div><div class="stage-cell"><span>累计注水</span><strong>${Number(stage.cumulativeWaterG).toFixed(0)}g</strong></div><div class="stage-cell"><span>阶段</span><strong>${esc(stage.name)}</strong></div></div><div class="stage-line"><div class="stage-cell"><span>水温</span><strong>${Number(stage.temperatureC).toFixed(0)}°C</strong></div><div class="stage-cell"><span>时间</span><strong>${Number(stage.durationSec).toFixed(0)}s</strong></div><div class="stage-cell"><span>注水方法</span><strong>${esc(stage.method)}</strong><small>${stage.methodCode ? `编码 ${esc(stage.methodCode)}` : ''}</small></div></div></div></article>`).join('')}</div>
  <section class="visual-section"><h3>萃取轨迹</h3>${trajectorySvg(plan)}<p class="muted small">相对可溶物释放轨迹，不等同于折光仪实测萃取率。</p></section>
  <details class="details-block professional-result"><summary>专业内容……</summary><div class="details-content">
    <section class="visual-section"><h3>风味拟合</h3><div class="bar-chart">${Object.entries({花香:flavor.floral,酸质:flavor.acidity,甜感:flavor.sweetness,体感:flavor.body,苦感:flavor.bitterness,洁净度:flavor.clarity}).map(([key,value])=>`<div class="bar-row"><span>${key}</span><div class="bar-track"><div class="bar-fill" style="width:${clamp(Number(value||0)*100,0,100)}%"></div></div><strong>${Math.round(Number(value||0)*100)}</strong></div>`).join('')}</div></section>
    <dl class="professional-list"><dt>研磨建议</dt><dd>${esc(plan.grinder ? `${plan.grinder.label} ${plan.grinder.recommended}${plan.grinder.unit}` : '未提供')}</dd><dt>调水方案</dt><dd>${esc(water?.profile?.name || '未提供')} ${water?.profile ? `· Ca ${water.profile.ca} / Mg ${water.profile.mg} / HCO₃ ${water.profile.hco3} mg/L` : ''}</dd><dt>调水版本</dt><dd>${esc(water?.modelVersion || '—')}</dd><dt>平均流速</dt><dd>${esc(String(plan.professional?.hydraulics?.averageFlowGPerSec ?? '—'))} g/s</dd></dl>
    ${water?.doses ? `<details class="nested-settings"><summary>调水粉剂换算</summary><div class="nested-content"><p class="muted small">按 ${Number(water.volumeL||5)}L RO水；称量值含纯度修正。</p>${water.doses.map(item=>`<div class="record-item"><span>${esc(item.name)}</span><span>${esc(item.id)}</span><strong>${Number(item.grams).toFixed(4)}g</strong></div>`).join('')}<p class="status-warn small">${esc(water.warning || '')}</p></div></details>` : ''}
    ${candidates.length ? `<details class="nested-settings"><summary>方案推荐排序</summary><div class="nested-content">${candidates.map(item=>`<div class="record-item"><span>${esc(item.profile?.label || item.id)}</span><span>${esc(item.reason || '')}</span><strong>${Math.round(Number(item.score||0)*100)}</strong></div>`).join('')}</div></details>` : ''}
    ${(plan.explanation||[]).map(value=>`<p class="muted small">${esc(value)}</p>`).join('')}
    ${(plan.professional?.modelLimitations||[]).map(value=>`<p class="status-warn small">${esc(value)}</p>`).join('')}
    ${plan.correction?.changes ? `<div class="correction-note"><strong>修正依据</strong>${plan.correction.changes.map(value=>`<p>${esc(value)}</p>`).join('')}</div>` : ''}
    <div class="plan-export-row"><select id="planExportFormat" class="control"><option value="json">JSON脚本</option><option value="txt">TXT</option><option value="md">Markdown</option></select><button id="exportPlanBtn" class="button" type="button">导出方案</button></div>
  </div></details>
  <div class="row menu-row"><button id="startBrewBtn" class="button primary" type="button">开始计时</button><button id="planToSensoryBtn" class="button" type="button">直接品鉴</button></div></section>`;
}

function bindPlanActions() {
  $('#startBrewBtn')?.addEventListener('click', startTimer);
  $('#planToSensoryBtn')?.addEventListener('click', () => { if (!state.selectedBeanId) return; startEvaluation(state.selectedBeanId, { direct: true }); switchPage('sensory'); });
  $('#exportPlanBtn')?.addEventListener('click', () => exportCurrentPlan($('#planExportFormat')?.value || 'json'));
}

function planExportDocument(plan, format, bean) {
  const title = bean ? beanDisplayName(bean) : '咖啡豆';
  const rows = (plan.stages || []).map(stage => `${stage.index}. ${stage.name}｜${stage.durationSec}s｜${stage.stageWaterG}g｜${stage.temperatureC}°C｜${stage.method}${stage.methodCode ? `｜${stage.methodCode}` : ''}`);
  if (format === 'json') return JSON.stringify({ format: 'luckybean-brew-plan', version: APP_VERSION, bean: { id: bean?.id || '', name: title, varietyCode: bean?.varietyCode || '' }, plan }, null, 2);
  if (format === 'md') return `# ${title} · 冲煮方案\n\n- 引擎：${plan.engineVersion}\n- 方案：${plan.profile?.label || plan.profileVersion}\n- 粉量：${plan.totals?.doseG}g\n- 水量：${plan.totals?.waterG}g\n- 粉水比：1:${plan.totals?.ratio}\n- 目标时间：${formatSeconds(plan.totals?.targetTimeSec)}\n\n## 分段\n\n${rows.map(row=>`- ${row}`).join('\n')}\n\n## 调水\n\n${plan.water ? `${plan.water.profile?.name}；Ca ${plan.water.profile?.ca}、Mg ${plan.water.profile?.mg}、HCO₃ ${plan.water.profile?.hco3} mg/L。` : '未记录'}\n`;
  return `${title} · 冲煮方案\n引擎：${plan.engineVersion}\n方案：${plan.profile?.label || plan.profileVersion}\n粉量：${plan.totals?.doseG}g\n水量：${plan.totals?.waterG}g\n粉水比：1:${plan.totals?.ratio}\n目标时间：${formatSeconds(plan.totals?.targetTimeSec)}\n\n${rows.join('\n')}\n`;
}

function exportCurrentPlan(format = 'json') {
  const plan = state.currentPlan; if (!plan) return toast('尚未生成方案');
  const bean = state.beans.find(item => item.id === plan.beanId || item.id === state.selectedBeanId);
  const safeName = (bean ? beanDisplayName(bean) : '咖啡豆').replace(/[\\/:*?"<>|]/g, '_');
  const ext = format === 'md' ? 'md' : format === 'txt' ? 'txt' : 'json';
  const mime = format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8';
  downloadBlob(`${safeName}_冲煮方案.${ext}`, planExportDocument(plan, format, bean), mime); toast(`已导出 ${ext.toUpperCase()} 方案`);
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
  const content = `<div class="timer-full"><div class="timer-top"><span id="timerStageCounter">${state.timer.stageIndex+1}/${state.currentPlan.stages.length}</span></div><div class="timer-stage-name" id="timerStageName">${esc(stage.name)}</div><div id="timerClock" class="timer-clock">${formatSeconds(state.timer.remaining)}</div><div class="timer-totals"><span>总时长 <strong id="timerTotal">${formatSeconds(state.currentPlan.totals?.targetTimeSec||0)}</strong></span><span>已进行 <strong id="timerElapsed">00:00</strong></span><span>总剩余 <strong id="timerTotalRemaining">${formatSeconds(state.currentPlan.totals?.targetTimeSec||0)}</strong></span></div><div class="timer-stage-grid"><div><span>本段</span><strong id="timerStageWater">${Number(stage.stageWaterG).toFixed(0)}g</strong></div><div><span>累计</span><strong id="timerCumulativeWater">${Number(stage.cumulativeWaterG).toFixed(0)}g</strong></div><div><span>水温</span><strong id="timerTemperature">${Number(stage.temperatureC).toFixed(0)}°C</strong></div></div><p id="timerStageText">${esc(stage.method)}</p><div class="timer-progress"><span id="timerProgressFill"></span></div><div class="timer-actions four"><button id="timerPrevBtn" class="button" type="button">退</button><button id="timerPauseBtn" class="button active" type="button">驻</button><button id="timerNextBtn" class="button" type="button">进</button><button id="timerEndBtn" class="button" type="button">终</button></div></div>`;
  showOverlay(content, { full: true, id: 'timer' });
  $('#timerPauseBtn').addEventListener('click', () => { state.timer.paused = !state.timer.paused; $('#timerPauseBtn').textContent = state.timer.paused ? '续' : '驻'; $('#timerPauseBtn').classList.toggle('active', state.timer.paused); if (state.timer.paused) speak('已暂停'); });
  $('#timerPrevBtn').addEventListener('click', () => moveTimerStage(-1));
  $('#timerNextBtn').addEventListener('click', () => moveTimerStage(1));
  $('#timerEndBtn').addEventListener('click', () => { state.timer.stageIndex = state.currentPlan.stages.length - 1; state.timer.remaining = 0; renderTimerValues(); promptRecordConsumption('terminated'); });
  renderTimerValues();
}

function formatSeconds(seconds) { const value = Math.max(0, Number(seconds)||0); return `${Math.floor(value/60).toString().padStart(2,'0')}:${(value%60).toString().padStart(2,'0')}`; }
function renderTimerValues() {
  const clock = $('#timerClock'); if (!clock || !state.currentPlan) return;
  const stages = state.currentPlan.stages;
  const stage = stages[state.timer.stageIndex];
  const elapsedBefore = stages.slice(0, state.timer.stageIndex).reduce((sum,item)=>sum+Number(item.durationSec||0),0);
  const stageElapsed = Math.max(0, Number(stage.durationSec||0)-state.timer.remaining);
  const elapsed = elapsedBefore + stageElapsed;
  const total = Number(state.currentPlan.totals?.targetTimeSec || stages.reduce((sum,item)=>sum+Number(item.durationSec||0),0));
  clock.textContent = formatSeconds(state.timer.remaining);
  $('#timerElapsed').textContent = formatSeconds(elapsed);
  $('#timerTotalRemaining').textContent = formatSeconds(Math.max(0,total-elapsed));
  $('#timerStageCounter').textContent = `${state.timer.stageIndex+1}/${stages.length}`;
  $('#timerStageName').textContent = stage.name;
  $('#timerStageText').textContent = stage.method;
  $('#timerStageWater').textContent = `${Number(stage.stageWaterG).toFixed(0)}g`;
  $('#timerCumulativeWater').textContent = `${Number(stage.cumulativeWaterG).toFixed(0)}g`;
  $('#timerTemperature').textContent = `${Number(stage.temperatureC).toFixed(0)}°C`;
  $('#timerProgressFill').style.width = `${clamp((1-state.timer.remaining/Math.max(1,Number(stage.durationSec)))*100,0,100)}%`;
}

function advanceTimerStage() { moveTimerStage(1, true); }
function moveTimerStage(direction = 1, automatic = false) {
  const next = state.timer.stageIndex + direction;
  if (next < 0) return;
  if (next >= state.currentPlan.stages.length) { clearInterval(state.timer.interval); promptRecordConsumption('complete'); return; }
  state.timer.stageIndex = next; state.timer.remaining = Number(state.currentPlan.stages[next].durationSec); state.timer.paused = false;
  const stage = state.currentPlan.stages[next];
  if ($('#timerPauseBtn')) { $('#timerPauseBtn').textContent = '驻'; $('#timerPauseBtn').classList.remove('active'); }
  renderTimerValues();
  speak(`${automatic?'进入':'切换到'}第${stage.index}段，${stage.name}，${stage.stageWaterG}克，${stage.durationSec}秒`);
}

function promptRecordConsumption(reason) {
  clearInterval(state.timer.interval); state.timer.paused = true;
  const bean = state.beans.find(item => item.id === state.selectedBeanId);
  const dose = Number(state.currentPlan?.totals?.doseG || state.currentBrewInput?.brew?.doseG || 15);
  const subtitle = bean ? `${codeName('countries', bean.countryCode, '未定国家')} · ${codeName('varieties', bean.varietyCode, '未定豆种')}` : '当前豆卡';
  const content = `<div class="consume-confirm">${dialogHeader('记录本次消耗', subtitle, { closable: false, centered: true })}<div class="consume-dose">${dose.toFixed(1)}g</div><div class="consume-actions"><button id="recordConsumptionBtn" class="button primary" type="button">扣除克重进入品鉴</button><button id="skipConsumptionBtn" class="button" type="button">不记录则返回拾味</button></div></div>`;
  const overlay = showOverlay(content, { id: 'consume-confirm', dialogClass: 'consume-dialog' });
  $('#recordConsumptionBtn').addEventListener('click', async () => {
    await consumeBean(bean, dose, state.currentPlan?.id, reason);
    if (state.currentPlan?.id) { const session = state.brewSessions.find(item => item.id === state.currentPlan.id); if (session) { session.status = reason === 'terminated' ? 'terminated' : 'completed'; session.completedAt = new Date().toISOString(); await put('brewSessions', session); await refreshData(); } }
    closeOverlay(); startEvaluation(bean.id, { brewSessionId: state.currentPlan?.id || '' }); switchPage('sensory', { preserveOverlay: true }); renderSensory();
  });
  $('#skipConsumptionBtn').addEventListener('click', () => { closeOverlay(); switchPage('brew'); });
}

async function consumeBean(bean, amount, sessionId, note = '') {
  if (!bean) return;
  const consumed = Math.min(Number(bean.remainingWeight)||0, amount); bean.remainingWeight = Math.max(0, Number(bean.remainingWeight||0) - consumed); bean.updatedAt = new Date().toISOString();
  const event = { id: uid('inv'), beanId: bean.id, type: 'consume', amountG: -consumed, resultingWeightG: bean.remainingWeight, sessionId, note, createdAt: new Date().toISOString() };
  await Promise.all([put('beans', bean), put('inventoryEvents', event)]); await refreshData();
}

function startEvaluation(beanId = state.selectedBeanId, options = {}) {
  state.selectedBeanId = beanId;
  const sessionId = options.brewSessionId ?? state.currentPlan?.id ?? '';
  state.evaluation = {
    id: uid('sensory'), beanId, brewSessionId: sessionId,
    engineVersion: state.currentPlan?.engineVersion || '', profileVersion: state.currentPlan?.profileVersion || '',
    nodeIndex: 0, answers: {}, autoScore: 0, subjectiveScore: 0, scoreDelta: 0,
    naturalNote: '', direct: Boolean(options.direct), createdAt: new Date().toISOString()
  };
}

function filteredSensoryRecords(limit = null) {
  const filter = state.sensoryFilter;
  let records = [...state.sensoryRecords];
  if (filter.beanId) records = records.filter(record => record.beanId === filter.beanId);
  if (filter.minScore !== '') records = records.filter(record => Number(record.score) >= Number(filter.minScore));
  if (filter.maxScore !== '') records = records.filter(record => Number(record.score) <= Number(filter.maxScore));
  if (filter.start) records = records.filter(record => String(record.createdAt).slice(0,10) >= filter.start);
  if (filter.end) records = records.filter(record => String(record.createdAt).slice(0,10) <= filter.end);
  records.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  return limit == null ? records : records.slice(0, limit);
}

function renderSensory() {
  const container = $('#sensoryContent');
  const recent = filteredSensoryRecords(5);
  const current = state.evaluation;
  container.innerHTML = `<section class="panel sensory-history"><button id="sensoryHistoryToggle" class="history-toggle${state.sensoryHistoryOpen?' active':''}" type="button"><span>往昔……</span><span>${state.sensoryHistoryOpen?'⌃':'⌄'}</span></button>${state.sensoryHistoryOpen ? `<div class="record-list">${recent.length?recent.map(recordHtml).join(''):'<p class="muted small">尚无品鉴记录</p>'}</div><button id="sensoryMoreBtn" class="button" type="button">更多</button>` : ''}</section>
  ${current ? evaluationHtml(current) : `<section class="panel"><div class="panel-title"><div><h2>开始品鉴</h2><p>花香、果香、其他、甜、酸、苦、口感、负面、总分</p></div></div><label class="field"><span>豆卡</span><select id="sensoryBeanSelect" class="control">${state.beans.filter(bean=>!bean.archived).map(bean=>`<option value="${esc(bean.id)}"${bean.id===state.selectedBeanId?' selected':''}>${esc(beanDisplayName(bean))}</option>`).join('')}</select></label><button id="startSensoryBtn" class="button primary" type="button">开始品鉴</button></section>`}`;
  $('#sensoryHistoryToggle').addEventListener('click', () => { state.sensoryHistoryOpen = !state.sensoryHistoryOpen; renderSensory(); });
  $('#sensoryMoreBtn')?.addEventListener('click', openSensoryRecordsPage);
  $('#startSensoryBtn')?.addEventListener('click', () => { const beanId = $('#sensoryBeanSelect').value; if (!beanId) return toast('请先选择豆卡'); startEvaluation(beanId); renderSensory(); });
  bindEvaluationEvents(); bindControlStates(container);
}

function recordHtml(record) {
  const bean = state.beans.find(item=>item.id===record.beanId);
  const subjective = Number(record.subjectiveScore ?? record.score ?? 0);
  const auto = Number(record.autoScore || 0);
  const delta = Number(record.scoreDelta || 0);
  return `<div class="record-item"><span>${formatDate(record.createdAt)}</span><span>${esc(bean ? beanDisplayName(bean) : '已删除豆卡')} · ${esc((record.summary||[]).slice(0,3).join(' / '))}${record.naturalNote ? `<small>${esc(record.naturalNote)}</small>` : ''}</span><strong>${subjective.toFixed(1)}${auto ? `<small>自${delta>=0?'+':''}${delta.toFixed(1)}</small>` : ''}</strong></div>`;
}

function evaluationHtml(evaluation) {
  const node = SENSORY_NODES[evaluation.nodeIndex];
  const body = node.type === 'score' ? scoreNodeHtml(evaluation) : node.type === 'note' ? noteNodeHtml(evaluation) : node.groups.map((group,index)=>questionGroupHtml(node,group,index,evaluation.answers[node.id]||{})).join('');
  const last = evaluation.nodeIndex === SENSORY_NODES.length - 1;
  return `<section class="panel"><div class="panel-title"><div><h2>${evaluation.nodeIndex+1}. ${node.label}</h2><p>${beanDisplayName(state.beans.find(b=>b.id===evaluation.beanId) || {})}</p></div><button id="cancelEvaluationBtn" class="button subtle" type="button">取消</button></div><div class="sensory-progress">${SENSORY_NODES.map((_,i)=>`<span class="${i<evaluation.nodeIndex?'done':i===evaluation.nodeIndex?'current':''}"></span>`).join('')}</div>${body}<div class="row menu-row"><button id="prevSensoryNodeBtn" class="button" type="button"${evaluation.nodeIndex===0?' disabled':''}>退</button><button id="nextSensoryNodeBtn" class="button primary" type="button">${last?'完成品鉴':node.type==='score'?'继续札记':'进'}</button></div></section>`;
}

function questionGroupHtml(node, group, groupIndex, answer) {
  const selected = new Set(answer[groupIndex] || []);
  return `<div class="question-group"><h4>${esc(group.label)}</h4><div class="sensory-options">${group.options.map(option=>`<button type="button" class="sensory-option${selected.has(option)?' selected':''}" data-sensory-option="${esc(option)}" data-group-index="${groupIndex}" data-single="${Boolean(group.single)}">${esc(option)}</button>`).join('')}</div></div>`;
}
function scoreNodeHtml(evaluation) {
  const autoScore = computeAutomaticScore(evaluation.answers);
  const subjective = Number(evaluation.subjectiveScore || autoScore);
  const delta = subjective - autoScore;
  return `<div class="question-group score-comparison"><div><span>自动得分</span><strong id="sensoryAutoScore">${autoScore.toFixed(1)}</strong></div><label class="field"><span>主观得分</span><input id="sensoryScore" class="control" type="number" min="0" max="100" step="0.1" value="${subjective.toFixed(1)}"></label><div><span>主观分差</span><strong id="sensoryScoreDelta">${delta>=0?'+':''}${delta.toFixed(1)}</strong></div><p class="muted small">自动得分由感官节点的甜、酸、苦、口感和负面项计算；主观得分用于学习个人偏好，不替代杯测规范。</p></div>`;
}

function noteNodeHtml(evaluation) {
  return `<div class="question-group"><h4>自然文字记录</h4><textarea id="sensoryNaturalNote" class="control natural-note" maxlength="1200" placeholder="描述本次冲煮的香气、酸甜、口感、问题及下一次调整方向……">${esc(evaluation.naturalNote || '')}</textarea><div class="row menu-row"><button id="sensoryVoiceNoteBtn" class="button" type="button">语记</button><span class="muted small">文字将写入品鉴记录和对应冲煮记录。</span></div></div>`;
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
  $('#sensoryScore')?.addEventListener('input', event => {
    const auto = computeAutomaticScore(state.evaluation.answers); const subjective = parseNumber(event.target.value, auto);
    state.evaluation.autoScore = auto; state.evaluation.subjectiveScore = subjective; state.evaluation.scoreDelta = Number((subjective - auto).toFixed(1));
    if ($('#sensoryScoreDelta')) $('#sensoryScoreDelta').textContent = `${state.evaluation.scoreDelta>=0?'+':''}${state.evaluation.scoreDelta.toFixed(1)}`;
  });
  $('#sensoryNaturalNote')?.addEventListener('input', event => { state.evaluation.naturalNote = event.target.value; });
  $('#sensoryVoiceNoteBtn')?.addEventListener('click', () => startSpeechRecognition('sensoryNaturalNote'));
  $('#prevSensoryNodeBtn')?.addEventListener('click', () => { state.evaluation.nodeIndex = Math.max(0, state.evaluation.nodeIndex-1); renderSensory(); });
  $('#nextSensoryNodeBtn')?.addEventListener('click', async () => {
    const node = SENSORY_NODES[state.evaluation.nodeIndex];
    if (node.type === 'note') {
      state.evaluation.naturalNote = $('#sensoryNaturalNote')?.value.trim() || '';
      await saveEvaluation(); return;
    }
    if (node.type === 'score') {
      const auto = computeAutomaticScore(state.evaluation.answers);
      const subjective = parseNumber($('#sensoryScore').value, -1); if (subjective < 0 || subjective > 100) return toast('主观得分必须在 0–100');
      state.evaluation.autoScore = auto; state.evaluation.subjectiveScore = subjective; state.evaluation.score = subjective; state.evaluation.scoreDelta = Number((subjective - auto).toFixed(1));
      state.evaluation.nodeIndex += 1; renderSensory(); return;
    }
    const answers = state.evaluation.answers[node.id] || {};
    const incomplete = node.groups.some((_, index) => !Array.isArray(answers[index]) || answers[index].length === 0);
    if (incomplete) return toast(`请完成“${node.label}”节点；没有感知时请选择“无”`, 'status-warn');
    state.evaluation.nodeIndex += 1; renderSensory();
  });
}

async function saveEvaluation() {
  const evaluation = state.evaluation; if (!evaluation) return;
  const bean = state.beans.find(item => item.id === evaluation.beanId);
  const summary = [];
  for (const node of SENSORY_NODES.filter(item => !['score','note'].includes(item.type))) {
    const values = Object.values(evaluation.answers[node.id] || {}).flat();
    if (values.length && !values.every(value => value === '无')) summary.push(`${node.label}:${values.join('/')}`);
  }
  const autoScore = Number(evaluation.autoScore || computeAutomaticScore(evaluation.answers));
  const subjectiveScore = Number(evaluation.subjectiveScore || autoScore);
  const record = {
    ...evaluation, summary, autoScore, subjectiveScore, score: subjectiveScore,
    scoreDelta: Number((subjectiveScore - autoScore).toFixed(1)), naturalNote: String(evaluation.naturalNote || '').trim(),
    preferenceTags: sensoryPreferenceTags({ ...evaluation, autoScore, subjectiveScore }, bean || {}), updatedAt: new Date().toISOString()
  };
  delete record.nodeIndex;

  let correctionSaved = false;
  const session = state.brewSessions.find(item => item.id === record.brewSessionId);
  if (session) {
    session.sensoryRecordId = record.id; session.sensoryNote = record.naturalNote;
    session.autoScore = autoScore; session.subjectiveScore = subjectiveScore; session.scoreDelta = record.scoreDelta;
    session.status = session.status === 'planned' ? 'evaluated' : session.status;
    if (subjectiveScore < autoScore && session.input) {
      const corrected = await buildCorrectedPlan(session.input, record, session);
      const hasIssue = Object.values(corrected.correction?.issues || {}).some(Boolean);
      if (hasIssue) {
        corrected.id = uid('brew'); corrected.beanId = record.beanId; corrected.createdAt = new Date().toISOString(); corrected.status = 'corrected'; corrected.input = corrected.input || session.input;
        record.correctedPlanId = corrected.id; session.correctedPlanId = corrected.id;
        await put('brewSessions', corrected); correctionSaved = true;
      }
    }
    await put('brewSessions', session);
  }
  await put('sensoryRecords', record); await refreshData(); state.evaluation = null;
  switchPage('beans'); requestAnimationFrame(()=>detailBean(record.beanId));
  if (correctionSaved) toast('品鉴已保存，并生成下一次修正方案', 'status-warn');
  else if (subjectiveScore < autoScore) toast('品鉴已保存；主观分低于自动分，已记录分差', 'status-warn');
  else toast('品鉴与个人偏好已保存', 'status-good');
}

function openSensoryRecordsPage() {
  const limit = clamp(state.settings.sensoryRecentLimit || 50, 5, 200);
  const records = filteredSensoryRecords(limit);
  const overlay = showOverlay(`${dialogHeader('品鉴记录', `显示最近 ${limit} 条，较早记录可在诹吉中查找`)}<div class="row end"><button id="sensoryRecordSettingsBtn" class="button active" type="button">设</button><button id="sensoryRecordFilterBtn" class="button" type="button">筛选</button></div><div class="record-list">${records.length?records.map(recordHtml).join(''):'<p class="muted">尚无记录</p>'}</div>`, { full: true, id: 'sensory-records' });
  bindClose(overlay);
  $('#sensoryRecordSettingsBtn').addEventListener('click', openSensoryRetentionSettings);
  $('#sensoryRecordFilterBtn').addEventListener('click', openSensoryFilter);
}
function openSensoryRetentionSettings() {
  const overlay = showOverlay(`${dialogHeader('记录保留显示数', '可设 5–200 条；更早记录不会删除，统一进入诹吉')}<label class="field"><span>显示条数</span><input id="sensoryRecentLimitInput" class="control" type="number" min="5" max="200" step="5" value="${clamp(state.settings.sensoryRecentLimit || 50,5,200)}"></label><button id="saveSensoryLimitBtn" class="button primary" type="button">保存</button>`, { id: 'sensory-limit' });
  bindClose(overlay);
  $('#saveSensoryLimitBtn').addEventListener('click', async () => { state.settings.sensoryRecentLimit = clamp(parseNumber($('#sensoryRecentLimitInput').value,50),5,200); await saveSettings(); closeOverlay(); openSensoryRecordsPage(); });
}
function openSensoryFilter() {
  const f = state.sensoryFilter;
  const overlay = showOverlay(`${dialogHeader('筛选品鉴记录')}<div class="form-grid"><label class="field"><span>咖啡豆</span><select id="filterSensoryBean" class="control"><option value="">全部豆卡</option>${state.beans.map(b=>`<option value="${esc(b.id)}"${f.beanId===b.id?' selected':''}>${esc(beanDisplayName(b))}</option>`).join('')}</select></label><label class="field"><span>最低分</span><input id="filterMinScore" class="control" type="number" min="0" max="100" value="${esc(f.minScore)}"></label><label class="field"><span>最高分</span><input id="filterMaxScore" class="control" type="number" min="0" max="100" value="${esc(f.maxScore)}"></label><label class="field"><span>开始日期</span><input id="filterStartDate" class="control" type="date" value="${esc(f.start)}"></label><label class="field"><span>结束日期</span><input id="filterEndDate" class="control" type="date" value="${esc(f.end)}"></label></div><div class="row end"><button id="resetSensoryFilter" class="button subtle" type="button">重置</button><button id="applySensoryFilter" class="button primary" type="button">应用</button></div>`);
  bindClose(overlay);
  $('#resetSensoryFilter').addEventListener('click',()=>{state.sensoryFilter={beanId:'',minScore:'',maxScore:'',start:'',end:'',expanded:false};closeOverlay();renderSensory();});
  $('#applySensoryFilter').addEventListener('click',()=>{state.sensoryFilter={...state.sensoryFilter,beanId:$('#filterSensoryBean').value,minScore:$('#filterMinScore').value,maxScore:$('#filterMaxScore').value,start:$('#filterStartDate').value,end:$('#filterEndDate').value};closeOverlay();renderSensory();});
}

async function ensureQrCodeLibrary() {
  if (globalThis.QRCode) return globalThis.QRCode;
  return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';script.onload=()=>globalThis.QRCode?resolve(globalThis.QRCode):reject(new Error('二维码生成库加载失败'));script.onerror=()=>reject(new Error('二维码生成库加载失败'));document.head.append(script);});
}
function sharePayload(bean) {
  const sessions = state.brewSessions.filter(session => session.beanId === bean.id);
  const records = state.sensoryRecords.filter(record => record.beanId === bean.id);
  return buildCompactSharePayload({
    appVersion: APP_VERSION,
    user: { publicId: state.settings.identity.publicId || '', nickname: state.settings.identity.nickname || '匿名' },
    bean,
    brewSessions: sessions,
    sensoryRecords: records,
    names: { displayName: beanDisplayName(bean) }
  });
}

async function encodeShare(payload) {
  return encodeSharePayload(payload);
}

async function decodeShare(encoded) {
  if (String(encoded).startsWith('LB8')) return decodeSharePayload(encoded);
  const base64 = encoded.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-encoded.length%4)%4);
  const binary = atob(base64);
  const legacy = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
  return { ...legacy, brewSessions: legacy.plan ? [legacy.plan] : [], sensoryRecords: legacy.sensory ? [legacy.sensory] : [], legacy: true };
}

function shareHtmlDocument(payload) {
  const bean = payload.bean || {};
  const display = bean.name || [codeName('countries', bean.countryCode, ''), codeName('varieties', bean.varietyCode, '')].filter(Boolean).join(' · ') || '分享豆卡';
  const sessions = payload.brewSessions || (payload.plan ? [payload.plan] : []);
  const sensory = payload.sensoryRecords || (payload.sensory ? [payload.sensory] : []);
  const planBlocks = sessions.length ? sessions.map((plan, index) => `<section class="card"><h2>冲煮记录 ${index + 1}${plan.correction ? ' · 修正方案' : ''}</h2><p class="muted">${esc(plan.profile?.label || plan.profileVersion || '')} · ${formatDate(plan.createdAt)}</p><ol>${(plan.stages || []).map(stage=>`<li>${Number(stage.durationSec).toFixed(0)}s / ${Number(stage.stageWaterG).toFixed(0)}g / ${esc(stage.methodCode || '')} / ${Number(stage.temperatureC).toFixed(0)}°C · ${esc(stage.method || '')}</li>`).join('')}</ol>${plan.correction?.changes ? `<p>${esc(plan.correction.changes.join('；'))}</p>` : ''}</section>`).join('') : '<section class="card"><h2>冲煮记录</h2><p>未分享方案</p></section>';
  const sensoryBlocks = sensory.length ? sensory.map(record=>`<div class="record"><strong>${Number(record.subjectiveScore ?? record.score ?? 0).toFixed(1)}</strong><span>自动 ${Number(record.autoScore || 0).toFixed(1)} · 分差 ${Number(record.scoreDelta || 0).toFixed(1)}</span><p>${esc((record.summary || []).join('；'))}</p>${record.naturalNote ? `<p>${esc(record.naturalNote)}</p>` : ''}</div>`).join('') : '<p>未分享品鉴记录</p>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(display)} · 富贵盒子</title><style>body{max-width:720px;margin:auto;padding:24px;background:#090a0a;color:#f4f2eb;font-family:system-ui;line-height:1.7}.card{padding:10px 0;margin:16px 0;background:#090a0a}.muted{color:#92928e}li{margin:8px 0}.record{padding:12px 0;border-bottom:1px dashed #665}.record strong{font-size:24px;margin-right:12px}.record span{color:#b6a47a}</style></head><body><h1>${esc(display)}</h1><p class="muted">由 ${esc(payload.user?.nickname || '匿名')} 分享 · ${formatDate(payload.sharedAt)}</p><section class="card"><h2>豆卡</h2><p>${esc([codeName('countries',bean.countryCode,''),codeName('regions',bean.regionCode,''),codeName('varieties',bean.varietyCode,''),codeName('processes',bean.processCode,''),ROAST_NAME.get(bean.roastCode)||''].filter(Boolean).join(' · '))}</p><p>${esc((bean.flavorCodes||[]).map(code=>codeName('flavors',code,code)).join('、'))}</p></section>${planBlocks}<section class="card"><h2>品鉴</h2>${sensoryBlocks}</section><p class="muted">Lucky Bean compact share v0.8 · BrewIon code fields</p></body></html>`;
}

async function openShareDialog(bean) {
  const compact = sharePayload(bean);
  let encoded;
  try { encoded = await encodeShare(compact); }
  catch (error) { return toast(`分享编码失败：${error.message}`, 'status-bad'); }
  const payload = await decodeShare(encoded);
  const link = `${location.origin}${location.pathname}#share=${encoded}`;
  const tooLong = encoded.length > 8000;
  const content = `${dialogHeader('分享豆卡', tooLong ? '内容超过安全链接长度，请保存网页文件' : `已压缩 ${payload.brewSessions?.length || 0} 条冲煮和 ${payload.sensoryRecords?.length || 0} 条品鉴`)}<div class="row menu-row"><button id="shareQrTab" class="button primary" type="button">二维码</button><button id="shareLinkTab" class="button" type="button">链接</button></div><div id="shareQrPanel"><div id="shareQrBox" class="qr-box"><span class="muted">正在生成二维码…</span></div></div><div id="shareLinkPanel" class="hidden"><div class="share-link-row"><div class="control ellipsis">${esc(tooLong?'内容过长，不生成 URL':link)}</div><button id="copyShareLinkBtn" class="button" type="button"${tooLong?' disabled':''}>复制</button></div></div><div class="grid-2"><button id="saveQrBtn" class="button" type="button"${tooLong?' disabled':''}>保存二维码 PNG</button><button id="saveShareHtmlBtn" class="button" type="button">保存分享网页</button></div><label class="field"><span>本机备注（不会同步给访问者）</span><textarea id="shareLocalNote" class="control" placeholder="仅保存在当前设备"></textarea></label><p class="muted small">编码字段使用 BrewIon 国家、豆种、处理法与风味代码；冲煮阶段采用“时间/克重/注水法编码/温度”结构。</p>`;
  const overlay = showOverlay(content,{id:'share'});bindClose(overlay);
  const showTab = tab => { $('#shareQrPanel').classList.toggle('hidden',tab!=='qr');$('#shareLinkPanel').classList.toggle('hidden',tab!=='link');$('#shareQrTab').classList.toggle('primary',tab==='qr');$('#shareLinkTab').classList.toggle('primary',tab==='link'); };
  $('#shareQrTab').addEventListener('click',()=>showTab('qr'));$('#shareLinkTab').addEventListener('click',()=>showTab('link'));
  $('#copyShareLinkBtn').addEventListener('click',async()=>{await navigator.clipboard.writeText(link);toast('压缩分享链接已复制');});
  $('#saveShareHtmlBtn').addEventListener('click',()=>downloadBlob(`${beanDisplayName(bean)}_富贵盒子分享.html`,shareHtmlDocument(payload),'text/html;charset=utf-8'));
  get('shareDrafts', bean.id).then(draft => { if (draft?.note && $('#shareLocalNote')) $('#shareLocalNote').value = draft.note; }).catch(() => {});
  $('#shareLocalNote').addEventListener('change', () => put('shareDrafts', { id: bean.id, note: $('#shareLocalNote').value.slice(0, 1000), updatedAt: new Date().toISOString() }));
  if (!tooLong) ensureQrCodeLibrary().then(()=>{const box=$('#shareQrBox');box.innerHTML='';new QRCode(box,{text:link,width:220,height:220,correctLevel:QRCode.CorrectLevel.L});}).catch(error=>$('#shareQrBox').textContent=error.message);
  $('#saveQrBtn').addEventListener('click',()=>{const canvas=$('#shareQrBox canvas');const image=$('#shareQrBox img');if(canvas)canvas.toBlob(blob=>downloadBlob(`${beanDisplayName(bean)}_分享二维码.png`,blob,'image/png'));else if(image)fetch(image.src).then(response=>response.blob()).then(blob=>downloadBlob(`${beanDisplayName(bean)}_分享二维码.png`,blob,'image/png'));else toast('二维码尚未生成');});
}

function renderSharedPayload(payload) {
  assertPlainObject(payload,'分享数据');
  $('#loginScreen').classList.add('hidden'); $('#appShell').classList.add('hidden');
  document.body.innerHTML = shareHtmlDocument(payload).match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || '<p>分享数据无效</p>';
}

function openHistory() {
  const archived = state.beans.filter(bean=>bean.archived || Number(bean.remainingWeight)<=0);
  const recentLimit = clamp(state.settings.sensoryRecentLimit || 50, 5, 200);
  const oldSensory = [...state.sensoryRecords].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(recentLimit);
  const oldBrews = [...state.brewSessions].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(recentLimit);
  const content = `${dialogHeader('撷', '诹吉中的豆卡与较早记录', { closable: false })}<div class="history-scroll"><details class="details-block" open><summary>豆卡旧藏 · ${archived.length}</summary><div class="details-content"><div class="bean-grid compact-grid">${archived.length?archived.map(beanCardHtml).join(''):'<p class="muted">暂无归档豆卡</p>'}</div></div></details><details class="details-block"><summary>旧品鉴 · ${oldSensory.length}</summary><div class="details-content record-list">${oldSensory.length?oldSensory.slice(0,200).map(recordHtml).join(''):'<p class="muted">暂无较早品鉴</p>'}</div></details><details class="details-block"><summary>旧冲煮 · ${oldBrews.length}</summary><div class="details-content record-list">${oldBrews.length?oldBrews.slice(0,200).map(sessionRecordHtml).join(''):'<p class="muted">暂无较早冲煮</p>'}</div></details></div><button class="bottom-return" type="button" data-close-overlay>退</button>`;
  const overlay = showOverlay(content,{id:'history',backdropClose:true,dialogClass:'history-sheet bottom-sheet'});bindClose(overlay);
  overlay.addEventListener('click', event => {
    const replay = event.target.closest('[data-replay-session]'); if (replay) return loadBrewSession(replay.dataset.replaySession);
    const card = event.target.closest('[data-bean-id]'); if (card) detailBean(card.dataset.beanId);
  });
}

function renderSettings() {
  const meta = state.codebookMeta || {};
  const identity = state.settings.identity;
  const gear = state.settings.gear || DEFAULT_SETTINGS.gear;
  $('#settingsContent').innerHTML = `<div class="settings-categories">
  <details class="settings-category"><summary><span>账户</span><small>${esc(identity.nickname || '访客')}</small></summary><div class="settings-category-body"><div class="grid-2"><label class="field"><span>昵称</span><input id="settingsNickname" class="control" maxlength="24" value="${esc(identity.nickname||'')}"></label><label class="field"><span>邮箱</span><input id="settingsEmail" class="control" type="email" value="${esc(identity.email||'')}"></label><label class="field"><span>手机</span><input id="settingsPhone" class="control" inputmode="tel" value="${esc(identity.phone||'')}"></label><label class="field"><span>微信</span><input id="settingsWechat" class="control" value="${esc(identity.wechat||'')}"></label><label class="field"><span>QQ</span><input id="settingsQq" class="control" inputmode="numeric" value="${esc(identity.qq||'')}"></label><div class="field"><span>个人 ID</span><div class="static-value mono">${esc(identity.publicId||'保存账户后生成')}</div></div></div><p class="muted small">个人 ID 由本机随机盐、昵称和账户信息生成，用于分享时标记来源，不公开原始联系方式。</p><button id="saveIdentityBtn" class="button primary" type="button">保存账户</button></div></details>
  <details class="settings-category"><summary><span>私器</span><small>滤纸 · 滤杯 · 磨豆机</small></summary><div class="settings-category-body"><div class="grid-2"><label class="field"><span>滤纸种类</span><input id="gearFilterTypes" class="control" value="${esc(gear.filterTypes||'')}" placeholder="例如 漂白纸、原木纸"></label><label class="field"><span>滤纸数量</span><input id="gearFilterStock" class="control" type="number" min="0" step="1" value="${esc(gear.filterStock||'')}"></label><label class="field"><span>滤杯</span><input id="gearDrippers" class="control" value="${esc(gear.drippers||'')}" placeholder="多个器具用顿号分隔"></label><label class="field"><span>磨豆机 / 刻度</span><input id="gearGrinders" class="control" value="${esc(gear.grinders||'')}" placeholder="例如 C40 22格"></label></div><button id="saveGearBtn" class="button primary" type="button">保存私器</button></div></details>
  <details class="settings-category"><summary><span>数藏</span><small>备份 · 恢复 · 数据源</small></summary><div class="settings-category-body"><div class="text-actions"><button id="settingsExportBtn" class="button" type="button">导出备份</button><button id="settingsImportBtn" class="button" type="button">导入备份</button><button id="clearAllDataBtn" class="button danger" type="button">清空本地数据</button></div><details class="nested-settings"><summary>数据源与接口</summary><div class="nested-content"><div class="setting-row"><div><h3>数据源</h3><p>仅在需要时检查更新；技术信息请见本物。</p></div><button id="updateCodebookBtn" class="button" type="button">检查更新</button></div><label class="field"><span>私有冲煮 API</span><input id="brewApiEndpoint" class="control" type="url" placeholder="HTTPS 服务端地址" value="${esc(state.settings.brew.apiEndpoint||'')}"></label><button id="saveApiBtn" class="button" type="button">保存接口</button><label class="toggle"><input id="planVisualToggle" type="checkbox"${state.settings.ui.planVisualsExpanded?' checked':''}>默认显示萃取图</label></div></details></div></details>
  <details class="settings-category"><summary><span>本物</span><small>关于富贵盒子</small></summary><div class="settings-category-body about-content"><h2>富贵盒子</h2><p>咖啡豆管理、拾味冲煮辅助、品鉴记录与本地数据归档工具。</p><dl><dt>版本</dt><dd>${APP_VERSION}</dd><dt>数据结构</dt><dd>${SCHEMA_VERSION}</dd><dt>离线引擎</dt><dd>${esc(FALLBACK_ENGINE_VERSION)}</dd><dt>数据源</dt><dd>公开编码数据 ${esc(meta.version||state.codebook.version||'6')}</dd><dt>开发与维护</dt><dd>zjcrop</dd><dt>微信</dt><dd>zj_crop</dd><dt>小红书</dt><dd>端茶倒水的秦始皇🐻</dd></dl><p class="muted small">真实注册、跨设备同步和私有冲煮服务需要独立后端。当前数据默认保存在本机浏览器。</p></div></details>
  </div>`;
  $('#updateCodebookBtn').addEventListener('click', updateCodebook);
  $('#saveApiBtn').addEventListener('click',async()=>{state.settings.brew.apiEndpoint=$('#brewApiEndpoint').value.trim();await saveSettings();toast('接口地址已保存');});
  $('#planVisualToggle').addEventListener('change',async event=>{state.settings.ui.planVisualsExpanded=event.target.checked;await saveSettings();});
  $('#saveIdentityBtn').addEventListener('click',async()=>{const next={...state.settings.identity,nickname:$('#settingsNickname').value.trim()||'访客',email:$('#settingsEmail').value.trim(),phone:$('#settingsPhone').value.trim(),wechat:$('#settingsWechat').value.trim(),qq:$('#settingsQq').value.trim()};Object.assign(next,await derivePublicId(next));state.settings.identity=next;await saveSettings();renderSettings();toast('账户信息与个人 ID 已保存');});
  $('#saveGearBtn').addEventListener('click',async()=>{state.settings.gear={filterTypes:$('#gearFilterTypes').value.trim(),filterStock:$('#gearFilterStock').value.trim(),drippers:$('#gearDrippers').value.trim(),grinders:$('#gearGrinders').value.trim()};if(state.settings.gear.drippers)state.settings.brew.dripper=state.settings.gear.drippers.split(/[、,，]/)[0].trim();if(state.settings.gear.grinders)state.settings.brew.grinder=state.settings.gear.grinders.split(/[、,，]/)[0].trim();await saveSettings();toast('私器已保存');});
  $('#settingsExportBtn').addEventListener('click',exportData); $('#settingsImportBtn').addEventListener('click',()=>$('#importInput').click());
  $('#clearAllDataBtn').addEventListener('click',confirmClearAll); bindControlStates($('#settingsContent'));
}

async function updateCodebook() {
  const button=$('#updateCodebookBtn');button.disabled=true;button.textContent='检查中…';
  try { const result=await checkCodebookUpdate({force:true});state.codebook=result.data;state.codebookIndex=makeIndex(result.data);state.codebookMeta=result.meta;renderSettings();toast(result.updated?'数据源已更新':'数据源已是最新','status-good'); }
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
  const overlay=showOverlay(`${dialogHeader('清空本地数据','此操作不可撤销')}<p class="status-bad">将删除豆卡、库存、方案、品鉴、设置和本地数据缓存。</p><label class="field"><span>输入“清空”确认</span><input id="clearConfirmInput" class="control"></label><button id="confirmClearBtn" class="button danger" type="button">永久清空</button>`);bindClose(overlay);
  $('#confirmClearBtn').addEventListener('click',async()=>{if($('#clearConfirmInput').value!=='清空')return toast('请输入“清空”');await clearAll();location.reload();});
}

function openProfileDialog() { switchPage('settings'); }

function bindGlobalEvents() {
  $('#guestBtn').addEventListener('click',()=>setIdentity('guest')); $('#emailIdentityBtn').addEventListener('click',openEmailIdentityDialog); $('#wechatIdentityBtn').addEventListener('click',()=>setIdentity('wechat'));
  $('#testBtn').addEventListener('click',async()=>{await setIdentity('guest');await seedDemo();renderBeans();});
  $('#bottomNav').addEventListener('click',event=>{const button=event.target.closest('[data-page-target]');if(button)switchPage(button.dataset.pageTarget);});
  $('#beanGroups').addEventListener('click',event=>{
    const board = event.target.closest('[data-open-recommend-board]'); if (board) return openRecommendationLeaderboard();
    const group = event.target.closest('[data-open-group]'); if (group) { state.activeGroupKey = group.dataset.openGroup; renderBeans(); return; }
    if (event.target.closest('[data-collapse-group]')) { state.activeGroupKey = null; renderBeans(); return; }
    const brew=event.target.closest('[data-brew-bean]');if(brew){event.stopPropagation();state.selectedBeanId=brew.dataset.brewBean;state.currentPlan=null;switchPage('brew');return;}
    const card=event.target.closest('[data-bean-id]');if(card)detailBean(card.dataset.beanId);
  });
  $('#beanGroups').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-bean-id]'))detailBean(event.target.dataset.beanId);});
  $('#activeFilterBar').addEventListener('click',event=>{if(event.target.id==='clearActiveFilters'){state.filter={search:'',country:'',variety:'',process:'',flavors:[],sort:'freshness',dir:'asc'};state.activeGroupKey=null;renderBeans();}});
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
  try {
    const encoded = location.hash.slice(7); if (encoded.length > 16000) throw new Error('分享数据过长');
    const payload = await decodeShare(encoded); renderSharedPayload(payload); return true;
  } catch(error) {
    location.hash=''; toast(`分享数据无效：${error.message}`,'status-bad'); return false;
  }
}

async function init() {
  state.db = await openDb();
  await migrateLegacy().catch(error=>({error:error.message}));
  await loadSettings();
  const loaded = await loadCodebook(); state.codebook=loaded.data;state.codebookMeta=loaded.meta;state.codebookIndex=makeIndex(loaded.data);
  if (await handleSharedHash()) return;
  await refreshData(); await migrateLegacyFlavorCodes(); bindGlobalEvents();
  if (state.settings.identity.publicId) enterApp();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  setTimeout(()=>checkCodebookUpdate().then(result=>{state.codebook=result.data;state.codebookIndex=makeIndex(result.data);state.codebookMeta=result.meta;if(state.page==='settings')renderSettings();}).catch(()=>{}),800);
}


init().catch(error => {
  console.error(error);
  showInfoDialog('初始化失败', error.message);
});
