import { all } from './db.js';
import { loadCodebook } from './codebook.js';
import { fieldCandidates } from './recognition-candidates.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));

const PROFILE_TO_SEGMENT = Object.freeze({
  'one-pour': '1',
  'two-pulse': '2',
  'three-pulse': '3',
  'four-six-v17': '4',
  'flat46-clean': '4',
  'five-pulse': '5',
  'pulse-30x15': '5'
});
const SEGMENT_TO_PROFILE = Object.freeze({
  '1': 'one-pour',
  '2': 'two-pulse',
  '3': 'three-pulse',
  '5': 'five-pulse'
});
const EXPLICIT_PROFILES = new Set(Object.keys(PROFILE_TO_SEGMENT));

const FIELD_CONTROLS = Object.freeze({
  countryCode: 'beanCountry',
  regionCode: 'beanRegion',
  entityCode: 'beanEntity',
  varietyCode: 'beanVariety',
  processCode: 'beanProcess',
  roastCode: 'beanRoast',
  roastColor: 'beanRoastColor',
  roastDate: 'beanRoastDate',
  altitude: 'beanAltitude',
  initialWeight: 'beanInitialWeight',
  price: 'beanPrice',
  roasterName: 'beanRoaster'
});

const LABEL_DEFINITIONS = Object.freeze([
  ['countryCode', /^(?:国家|产国|原产国|产地国家|COUNTRY|ORIGIN(?:\s+COUNTRY)?|COUNTRY\s+OF\s+ORIGIN)$/i],
  ['regionCode', /^(?:产区|地区|区域|REGION|AREA|PROVINCE|DISTRICT)$/i],
  ['entityCode', /^(?:庄园|农场|合作社|处理站|水洗站|工厂|ESTATE|FARM|FINCA|COOPERATIVE|CO-OP|WASHING\s+STATION|STATION|MILL|PRODUCER)$/i],
  ['varietyCode', /^(?:豆种|品种|树种|VARIETY|VARIETAL|CULTIVAR|BOTANICAL\s+VARIETY)$/i],
  ['processCode', /^(?:处理法|处理方式|处理工艺|PROCESS(?:ING)?(?:\s+METHOD)?|METHOD)$/i],
  ['roastColor', /^(?:烘焙色值|色值|AGTRON|ROAST\s+COLOU?R)$/i],
  ['roastCode', /^(?:烘焙度|烘焙程度|焙度|ROAST(?!ER|ERY|ED)(?:\s+LEVEL)?|ROASTING\s+LEVEL)$/i],
  ['roastDate', /^(?:烘焙日期|烘焙日|生产日期|ROAST(?:ED)?\s+(?:ON|DATE)|ROASTED)$/i],
  ['altitude', /^(?:海拔|种植海拔|ALTITUDE|ELEVATION)$/i],
  ['initialWeight', /^(?:初始克重|净重|重量|规格|NET\s+WEIGHT|WEIGHT)$/i],
  ['price', /^(?:购买价格|价格|售价|PRICE|COST)$/i],
  ['roasterName', /^(?:烘焙商|烘焙厂|烘焙品牌|品牌|ROASTER|ROASTERY|BRAND)$/i]
]);

const LABEL_SOURCE = [
  '国家','产国','原产国','产地国家','COUNTRY','ORIGIN(?:\\s+COUNTRY)?','COUNTRY\\s+OF\\s+ORIGIN',
  '产区','地区','区域','REGION','AREA','PROVINCE','DISTRICT',
  '庄园','农场','合作社','处理站','水洗站','工厂','ESTATE','FARM','FINCA','COOPERATIVE','CO-OP','WASHING\\s+STATION','STATION','MILL','PRODUCER',
  '豆种','品种','树种','VARIETY','VARIETAL','CULTIVAR','BOTANICAL\\s+VARIETY',
  '处理法','处理方式','处理工艺','PROCESS(?:ING)?(?:\\s+METHOD)?','METHOD',
  '烘焙色值','色值','AGTRON','ROAST\\s+COLOU?R',
  '烘焙度','烘焙程度','焙度','ROAST(?!ER|ERY|ED)(?:\\s+LEVEL)?','ROASTING\\s+LEVEL',
  '烘焙日期','烘焙日','生产日期','ROAST(?:ED)?\\s+(?:ON|DATE)','ROASTED',
  '海拔','种植海拔','ALTITUDE','ELEVATION',
  '初始克重','净重','重量','规格','NET\\s+WEIGHT','WEIGHT',
  '购买价格','价格','售价','PRICE','COST',
  '烘焙商','烘焙厂','烘焙品牌','品牌','ROASTER','ROASTERY','BRAND'
].sort((left, right) => right.length - left.length).join('|');
const LINE_LABEL_INSERTION = new RegExp(`(^|[\\n|；;,，])\\s*(${LABEL_SOURCE})\\s*[:：=\\-]?`, 'gim');
const INLINE_LABEL_INSERTION = new RegExp(`([^\\n|；;,，])\\s+(${LABEL_SOURCE})\\s*[:：=]`, 'gi');

const AUTO_FIELD_ORDER = Object.freeze([
  'countryCode', 'regionCode', 'entityCode', 'varietyCode', 'processCode',
  'roastColor', 'roastCode', 'roastDate', 'altitude', 'initialWeight', 'price', 'roasterName'
]);
const REQUIRED_FIELDS = Object.freeze([
  ['countryCode', '国家'], ['varietyCode', '豆种'], ['processCode', '处理法'],
  ['roastCode', '烘焙度'], ['roastDate', '烘焙日期'], ['initialWeight', '初始克重']
]);

let codebookPromise;
let syncQueued = false;
let historyBusy = false;
let brewSyncBusy = false;
let requestedProfileId = '';
let fabDrag = null;
let suppressFabClick = false;

function codebook() {
  if (!codebookPromise) codebookPromise = loadCodebook().then(result => result.data);
  return codebookPromise;
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function profileLabel(session) {
  return session?.profile?.label
    || session?.recommendation?.selected?.profile?.label
    || String(session?.profileVersion || '').split('@')[0]
    || '冲煮方案';
}

export function abbreviateBrewMethod(label, maximum = 5) {
  const characters = [...String(label || '冲煮方案').trim()];
  return characters.length > maximum
    ? `${characters.slice(0, maximum).join('')}……`
    : characters.join('');
}

function formattedDate(value) {
  const raw = String(value || '');
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '日期未记' : date.toISOString().slice(0, 10);
}

function sensoryForSession(session, recordsById, recordsBySession) {
  return recordsById.get(session.sensoryRecordId)
    || recordsBySession.get(session.id)
    || null;
}

async function compactBrewHistory() {
  if (historyBusy) return;
  const buttons = $$('[data-replay-session]');
  if (!buttons.length) return;
  historyBusy = true;
  try {
    const [sessions, records] = await Promise.all([all('brewSessions'), all('sensoryRecords')]);
    const sessionsById = new Map(sessions.map(item => [item.id, item]));
    const recordsById = new Map(records.map(item => [item.id, item]));
    const recordsBySession = new Map(records.filter(item => item.brewSessionId).map(item => [item.brewSessionId, item]));

    for (const button of buttons) {
      const session = sessionsById.get(button.dataset.replaySession);
      if (!session) continue;
      const sensory = sensoryForSession(session, recordsById, recordsBySession);
      const score = Number(sensory?.subjectiveScore ?? sensory?.score ?? session.subjectiveScore);
      const fullMethod = profileLabel(session);
      const method = abbreviateBrewMethod(fullMethod, 5);
      const scoreText = Number.isFinite(score) && score > 0 ? score.toFixed(1) : '—';
      const signature = `${formattedDate(session.createdAt)}|${method}|${scoreText}`;
      if (button.dataset.v097History === signature
          && button.classList.contains('brew-history-compact-v097')
          && button.children.length === 4) continue;

      button.dataset.v097History = signature;
      button.classList.remove('brew-history-rich');
      button.classList.add('brew-history-compact-v097');
      button.innerHTML = [
        `<time>${esc(formattedDate(session.createdAt))}</time>`,
        `<span class="brew-method-short" title="${esc(fullMethod)}">${esc(method)}</span>`,
        `<strong>${scoreText}</strong>`,
        '<span class="brew-replay-label">复刻</span>'
      ].join('');
    }
  } finally {
    historyBusy = false;
  }
}

function normalizeSegmentOptionLabels(select) {
  if (!select || select.dataset.v097Labels === '1') return;
  const labels = {
    '1': '一刀流（闷蒸 + 一次主体注水）',
    '2': '两段式（闷蒸 + 两段注水）',
    '3': '三段式（闷蒸 + 三段注水）',
    '4': '四段注水（闷蒸 + 四段注水）',
    '5': '五段式（闷蒸 + 五段注水）'
  };
  for (const option of select.options) {
    if (labels[option.value]) option.textContent = labels[option.value];
  }
  select.dataset.v097Labels = '1';
}

function setControlValue(control, value) {
  if (!control || !value || control.value === value) return false;
  if (![...control.options].some(option => option.value === value)) return false;
  control.value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function synchronizeBrewControls(event) {
  if (brewSyncBusy) return;
  const profile = $('#brewProfile');
  const segments = $('#brewSegments');
  if (!profile || !segments) return;
  normalizeSegmentOptionLabels(segments);

  brewSyncBusy = true;
  try {
    if (event?.target === profile) {
      requestedProfileId = EXPLICIT_PROFILES.has(profile.value) ? profile.value : '';
      const mapped = PROFILE_TO_SEGMENT[profile.value];
      if (mapped) setControlValue(segments, mapped);
      return;
    }

    if (event?.target === segments) {
      const mapped = SEGMENT_TO_PROFILE[segments.value];
      if (mapped) {
        requestedProfileId = mapped;
        setControlValue(profile, mapped);
      } else if (segments.value === 'auto') {
        requestedProfileId = profile.value === 'recommended' ? '' : profile.value;
      }
      return;
    }

    if (EXPLICIT_PROFILES.has(profile.value)) {
      requestedProfileId = profile.value;
      const mapped = PROFILE_TO_SEGMENT[profile.value];
      if (mapped) setControlValue(segments, mapped);
    } else if (segments.value !== 'auto' && SEGMENT_TO_PROFILE[segments.value]) {
      requestedProfileId = SEGMENT_TO_PROFILE[segments.value];
      setControlValue(profile, requestedProfileId);
    }
  } finally {
    brewSyncBusy = false;
  }
}

function enforceBrewSelection() {
  const profile = $('#brewProfile');
  const segments = $('#brewSegments');
  if (!profile || !segments) return;

  const explicit = EXPLICIT_PROFILES.has(profile.value)
    ? profile.value
    : (SEGMENT_TO_PROFILE[segments.value] || requestedProfileId);
  if (!explicit || !EXPLICIT_PROFILES.has(explicit)) return;

  requestedProfileId = explicit;
  profile.value = explicit;
  const mappedSegment = PROFILE_TO_SEGMENT[explicit];
  if (mappedSegment) segments.value = mappedSegment;
  profile.dataset.v097ExplicitProfile = explicit;
  segments.dataset.v097ExplicitProfile = explicit;
}

function preserveTrajectoryChart(svg) {
  if (!svg || svg.dataset.v097TrajectoryPreserved === '1') return;
  svg.dataset.v097TrajectoryPreserved = '1';
  svg.setAttribute('aria-label', '按时间拟合的温度、流量、累计注水、花香、酸、甜与苦涩风险轨迹图');
  $$('.v097-flavor-coverage', svg).forEach(node => node.remove());

  const legend = svg.parentElement?.querySelector('.trajectory-legend');
  if (legend) {
    legend.innerHTML = [
      '<span class="temperature">温度</span>',
      '<span class="flow">流量</span>',
      '<span class="water">累计注水</span>',
      '<span class="floral">花香</span>',
      '<span class="acidity">酸</span>',
      '<span class="sweetness">甜</span>',
      '<span class="risk">苦涩风险</span>'
    ].join('');
  }
}

function fieldForLabel(label) {
  const normalized = String(label || '').trim();
  return LABEL_DEFINITIONS.find(([, pattern]) => pattern.test(normalized))?.[0] || '';
}

function recognitionFragments(text) {
  const normalized = String(text || '')
    .normalize('NFKC')
    .replace(/[‐‑‒–—―−﹣－]/g, '-')
    .replace(/\r/g, '\n')
    .replace(/[|；;]/g, '\n')
    .replace(LINE_LABEL_INSERTION, '\n$2:')
    .replace(INLINE_LABEL_INSERTION, '$1\n$2:');

  const fields = Object.create(null);
  const free = [];
  for (const rawChunk of normalized.split(/\n+/)) {
    const chunk = rawChunk.trim().replace(/^[-•·]+/, '').trim();
    if (!chunk) continue;
    const match = chunk.match(/^([^:：]{1,40})[:：]\s*(.*)$/);
    const field = match ? fieldForLabel(match[1]) : '';
    if (field && match[2]?.trim()) {
      (fields[field] ||= []).push(match[2].trim());
      continue;
    }
    free.push(chunk);
  }

  const fragments = [...new Set(free.flatMap(chunk => {
    const pieces = chunk.split(/[，,、/／·•]+/).map(value => value.trim()).filter(Boolean);
    return [chunk, ...pieces, ...pieces.flatMap(value => value.split(/\s+/).filter(Boolean))];
  }).filter(value => value.length <= 120))];

  return { normalized, fields, fragments };
}

export function extractRecognitionEvidence(text) {
  const parsed = recognitionFragments(text);
  const evidence = {};
  for (const field of Object.keys(FIELD_CONTROLS)) {
    const labeled = parsed.fields[field] || [];
    evidence[field] = labeled.length ? labeled.join('\n') : parsed.fragments.join('\n');
  }
  return { ...parsed, evidence };
}

function bestCandidateDecision(candidates, { minimum = 0.9, margin = 0.07 } = {}) {
  const sorted = [...(candidates || [])].sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
  const best = sorted[0];
  if (!best || Number(best.score || 0) < minimum) return null;
  const second = sorted[1];
  if (second
      && Number(best.score || 0) - Number(second.score || 0) < margin
      && Number(best.score || 0) < 0.985) return null;
  return best;
}

function directScalarCandidate(field, source, explicitlyLabeled = false) {
  const text = String(source || '').normalize('NFKC');
  let match;
  if (field === 'roastDate') {
    match = text.match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
    if (match) {
      const value = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
      return { field, value, label: value, score: 0.995 };
    }
  }
  if (field === 'altitude') {
    match = text.match(/(\d{3,4})(?:\s*[-~至到]\s*\d{3,4})?\s*(?:M|米|MASL)/i);
    if (match) return { field, value: Number(match[1]), label: `${match[1]} m`, score: 0.99 };
  }
  if (field === 'initialWeight') {
    match = text.match(/(\d{1,5}(?:\.\d+)?)\s*(?:G|克|GRAMS?)(?!\s*\/)/i);
    if (match) return { field, value: Number(match[1]), label: `${match[1]} g`, score: 0.99 };
  }
  if (field === 'roastColor') {
    match = text.match(/(?:AGTRON|色值)?\s*[:：]?\s*(\d{2,3})/i);
    if (match && Number(match[1]) >= 20 && Number(match[1]) <= 120) {
      return { field, value: Number(match[1]), label: `Agtron ${match[1]}`, score: explicitlyLabeled ? 0.99 : 0.95 };
    }
  }
  if (field === 'price') {
    match = text.match(/(?:¥|￥|RMB|CNY|USD|\$)\s*(\d+(?:\.\d+)?)/i)
      || (explicitlyLabeled ? text.match(/(\d+(?:\.\d+)?)/) : null);
    if (match) return { field, value: Number(match[1]), label: match[1], score: explicitlyLabeled ? 0.97 : 0.91 };
  }
  return null;
}

function localRoastCandidate(text) {
  const value = String(text || '').toLocaleLowerCase('zh-CN');
  const rows = [
    [/极浅|ultra\s*light|lightest/, 'RL-L0', '极浅烘'],
    [/浅中|medium\s*light/, 'RL-L2', '浅中烘'],
    [/浅烘|浅度|\blight\b/, 'RL-L1', '浅烘'],
    [/中深|medium\s*dark/, 'RL-L4', '中深烘'],
    [/中烘|中度|\bmedium\b/, 'RL-L3', '中烘'],
    [/极深|very\s*dark|french/, 'RL-L6', '极深烘'],
    [/深烘|深度|\bdark\b/, 'RL-L5', '深烘']
  ];
  const match = rows.find(([pattern]) => pattern.test(value));
  return match ? { field: 'roastCode', value: match[1], code: match[1], label: match[2], score: 0.98 } : null;
}

function textCandidate(field, evidence) {
  const value = String(evidence || '').split(/\n/)[0]?.trim();
  if (!value) return null;
  return { field, value: value.slice(0, 60), label: value.slice(0, 60), score: 0.98 };
}

function currentEvidenceContext() {
  return {
    countryCode: $('#beanCountry')?.value || '',
    regionCode: $('#beanRegion')?.value || ''
  };
}

function controlIsEmpty(control) {
  if (!control) return true;
  const value = String(control.value || '').trim();
  const label = control instanceof HTMLSelectElement
    ? control.selectedOptions?.[0]?.textContent?.trim() || ''
    : value;
  return !value || /请选择|未选择|未定|自动生成|先选择/.test(label);
}

async function applyFieldCandidate(field, candidate, { overwrite = true } = {}) {
  const control = $(`#${FIELD_CONTROLS[field]}`);
  if (!control || !candidate) return false;
  const next = String(candidate.code ?? candidate.value ?? '').trim();
  if (!next) return false;
  if (!overwrite && !controlIsEmpty(control)) return false;

  if (control instanceof HTMLSelectElement && ![...control.options].some(option => option.value === next)) {
    control.add(new Option(candidate.label || next, next));
  }
  if (control.value === next) return false;

  control.disabled = false;
  control.value = next;
  control.dataset.v097AutoFilled = '1';
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
  await delay(field === 'countryCode' ? 100 : field === 'regionCode' ? 70 : 20);
  return true;
}

function candidateThreshold(field, labeled) {
  if (labeled) return {
    countryCode: 0.80, regionCode: 0.82, entityCode: 0.84,
    varietyCode: 0.80, processCode: 0.80
  }[field] || 0.90;
  return {
    countryCode: 0.89, regionCode: 0.91, entityCode: 0.94,
    varietyCode: 0.89, processCode: 0.88
  }[field] || 0.92;
}

function updateRecognitionWarning(recognizedFields = new Set(), { clearUnrecognizedDate = true } = {}) {
  const form = $('#beanForm');
  if (!form) return;
  form.querySelector('.v097-recognition-warning')?.remove();

  if (clearUnrecognizedDate && !recognizedFields.has('roastDate')) {
    const date = $('#beanRoastDate');
    if (date?.dataset.v097AutoFilled !== '1') date.value = '';
  }

  const missing = REQUIRED_FIELDS
    .filter(([field]) => controlIsEmpty($(`#${FIELD_CONTROLS[field]}`)))
    .map(([, label]) => label);
  if (!missing.length) return;

  const warning = document.createElement('p');
  warning.className = 'status-warn small v097-recognition-warning';
  warning.textContent = `以下字段未能可靠识别，请手工确认：${missing.join('、')}。`;
  form.querySelector('.row')?.before(warning);
}

export async function autoFillRecognition(text, { overwrite = true } = {}) {
  const normalized = String(text || '').trim();
  if (!normalized || !$('#beanForm')) return;

  const parsed = extractRecognitionEvidence(normalized);
  const book = await codebook();
  const recognizedFields = new Set();

  for (const field of AUTO_FIELD_ORDER) {
    const labeled = Boolean(parsed.fields[field]?.length);
    const evidence = parsed.evidence[field] || normalized;
    let candidate = null;

    if (field === 'roasterName') {
      candidate = labeled ? textCandidate(field, evidence) : null;
    } else if (field === 'roastCode') {
      candidate = localRoastCandidate(labeled ? evidence : normalized);
    } else if (['roastDate', 'altitude', 'initialWeight', 'roastColor', 'price'].includes(field)) {
      candidate = directScalarCandidate(field, labeled ? evidence : normalized, labeled);
      if (!candidate && (labeled || field !== 'price')) {
        candidate = bestCandidateDecision(fieldCandidates(field, evidence, book, currentEvidenceContext(), 5), {
          minimum: labeled ? 0.84 : 0.94,
          margin: 0.05
        });
      }
    } else {
      candidate = bestCandidateDecision(fieldCandidates(field, evidence, book, currentEvidenceContext(), 8), {
        minimum: candidateThreshold(field, labeled),
        margin: field === 'entityCode' ? 0.09 : 0.055
      });
    }

    if (!candidate) continue;
    const applied = await applyFieldCandidate(field, candidate, { overwrite });
    if (applied || String($(`#${FIELD_CONTROLS[field]}`)?.value || '') === String(candidate.code ?? candidate.value ?? '')) {
      recognizedFields.add(field);
    }
  }

  updateRecognitionWarning(recognizedFields, { clearUnrecognizedDate: overwrite });
  globalThis.LuckyBeanIntegrityUI?.refresh?.();
}

function interceptRecognitionParse(event) {
  if (!event.target.closest?.('#parseTextBtn')) return;
  const text = $('#recognitionText')?.value || '';
  const overwrite = $('#overwriteRecognizedFields')?.checked !== false;
  setTimeout(() => autoFillRecognition(text, { overwrite }).catch(console.error), 90);
}

function fabBounds(width, height) {
  const margin = 10;
  const navTop = $('#bottomNav')?.getBoundingClientRect().top || innerHeight;
  return {
    minX: margin,
    maxX: Math.max(margin, innerWidth - width - margin),
    minY: margin,
    maxY: Math.max(margin, navTop - height - margin)
  };
}

function clampFabPosition(x, y, node) {
  const rect = node.getBoundingClientRect();
  const bounds = fabBounds(rect.width, rect.height);
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, y))
  };
}

function applyFabPosition(position, node = $('#fabWrap')) {
  if (!node || !position) return;
  const next = clampFabPosition(Number(position.x), Number(position.y), node);
  node.style.left = `${next.x}px`;
  node.style.top = `${next.y}px`;
  node.style.right = 'auto';
  node.style.bottom = 'auto';
  node.dataset.v097Floating = '1';
}

function restoreFabPosition() {
  const node = $('#fabWrap');
  if (!node || node.dataset.v097DragBound === '1') return;
  node.dataset.v097DragBound = '1';

  try {
    const saved = JSON.parse(localStorage.getItem('luckybean.fab.position.v1') || 'null');
    if (saved) requestAnimationFrame(() => applyFabPosition(saved, node));
  } catch { /* Ignore invalid legacy position. */ }

  node.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = node.getBoundingClientRect();
    fabDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false
    };
    node.setPointerCapture?.(event.pointerId);
    node.classList.add('is-dragging');
  });

  node.addEventListener('pointermove', event => {
    if (!fabDrag || event.pointerId !== fabDrag.pointerId) return;
    const deltaX = event.clientX - fabDrag.startX;
    const deltaY = event.clientY - fabDrag.startY;
    if (!fabDrag.moved && Math.hypot(deltaX, deltaY) < 6) return;
    fabDrag.moved = true;
    event.preventDefault();
    applyFabPosition({ x: fabDrag.originX + deltaX, y: fabDrag.originY + deltaY }, node);
  });

  const finish = event => {
    if (!fabDrag || event.pointerId !== fabDrag.pointerId) return;
    const moved = fabDrag.moved;
    fabDrag = null;
    node.classList.remove('is-dragging');
    node.releasePointerCapture?.(event.pointerId);
    if (!moved) return;

    suppressFabClick = true;
    const rect = node.getBoundingClientRect();
    localStorage.setItem('luckybean.fab.position.v1', JSON.stringify({ x: rect.left, y: rect.top }));
    setTimeout(() => { suppressFabClick = false; }, 0);
  };

  node.addEventListener('pointerup', finish);
  node.addEventListener('pointercancel', finish);
  node.addEventListener('click', event => {
    if (!suppressFabClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

function blankGroupCollapse(event) {
  const collapseZone = event.target.closest?.('.group-collapse-zone,[data-collapse-group]');
  if (collapseZone) return;
  const panel = event.target.closest?.('.active-group-panel');
  if (!panel || event.target.closest('button,a,input,select,textarea,label,.bean-card,[role="button"],.active-group-title')) return;
  ($('.group-collapse', panel) || $('.group-collapse', panel.parentElement))?.click();
}

function enhanceCollapseTarget() {
  $$('.group-collapse-zone,[data-collapse-group]').forEach(zone => {
    zone.classList.add('group-collapse-zone-v097');
    zone.setAttribute('title', '点击空白区域收起分组');
  });
}

function sync() {
  synchronizeBrewControls();
  compactBrewHistory().catch(console.error);
  $$('.trajectory-chart.detailed').forEach(preserveTrajectoryChart);
  restoreFabPosition();
  enhanceCollapseTarget();
}

function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    sync();
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('change', event => {
    if (event.target.matches?.('#brewProfile,#brewSegments')) synchronizeBrewControls(event);
  }, true);
  document.addEventListener('input', event => {
    if (event.target.matches?.('#brewProfile,#brewSegments')) synchronizeBrewControls(event);
  }, true);
  document.addEventListener('click', event => {
    if (event.target.closest?.('#generatePlanBtn')) enforceBrewSelection();
  }, true);
  document.addEventListener('click', interceptRecognitionParse, true);
  document.addEventListener('click', blankGroupCollapse, true);
  window.addEventListener('resize', () => {
    const node = $('#fabWrap');
    if (node?.dataset.v097Floating === '1') {
      const rect = node.getBoundingClientRect();
      applyFabPosition({ x: rect.left, y: rect.top }, node);
    }
  });
  new MutationObserver(queueSync).observe(document.body, { childList: true, subtree: true });
  queueSync();
}

globalThis.LuckyBeanV097Fixes = {
  abbreviateBrewMethod,
  autoFillRecognition,
  extractRecognitionEvidence,
  preserveTrajectoryChart,
  synchronizeBrewControls,
  enforceBrewSelection
};
