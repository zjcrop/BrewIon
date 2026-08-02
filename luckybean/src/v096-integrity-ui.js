import { all } from './db.js';
import { loadCodebook, makeIndex, displayName } from './codebook.js';
import { fieldCandidates, normalizeEvidenceValue } from './recognition-candidates.js';
import { sensoryTagLabels } from './sensory-codec-v096.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

const EVIDENCE_FIELDS = Object.freeze({
  '国家': 'countryCode',
  '产区': 'regionCode',
  '庄园/处理站': 'entityCode',
  '庄园 / 处理站': 'entityCode',
  '豆种': 'varietyCode',
  '处理法': 'processCode',
  '烘焙度': 'roastCode',
  '烘焙日期': 'roastDate',
  '海拔': 'altitude',
  '初始克重': 'initialWeight',
  '价格': 'price'
});

const FIELD_CONTROLS = Object.freeze({
  countryCode: 'beanCountry',
  regionCode: 'beanRegion',
  entityCode: 'beanEntity',
  varietyCode: 'beanVariety',
  processCode: 'beanProcess',
  roastCode: 'beanRoast',
  roastDate: 'beanRoastDate',
  altitude: 'beanAltitude',
  initialWeight: 'beanInitialWeight',
  price: 'beanPrice'
});

const PROFESSIONAL_STEP_LABELS = Object.freeze({
  dry: '干香/湿香', high: '高温', mid: '中温', low: '低温',
  aftertaste: '余韵', acidity: '酸质', sweetness: '甜感', mouthfeel: '口感'
});
const AROMA_AXES = ['花香', '果香', '茶感', '坚果', '酵感'];
const STYLE_AXES = ['风味', '余韵', '酸质', '甜感', '醇厚'];

let codebookPromise;
let dataPromise;
let observerQueued = false;
let professionalDraft = emptyProfessionalDraft();

function emptyProfessionalDraft() {
  return { selections: {}, intensities: {}, radar: { aroma: [], style: [] }, affective: {} };
}

async function codebookContext() {
  if (!codebookPromise) codebookPromise = loadCodebook().then(result => ({ book: result.data, index: makeIndex(result.data) }));
  return codebookPromise;
}

async function dataContext(force = false) {
  if (!dataPromise || force) {
    dataPromise = Promise.all([all('beans'), all('brewSessions'), all('sensoryRecords'), codebookContext()])
      .then(([beans, sessions, records, context]) => ({ beans, sessions, records, ...context }));
  }
  return dataPromise;
}

function formattedDate(value) {
  const date = String(value || '').slice(0, 10);
  return date || '日期未记';
}

function beanName(bean, index) {
  if (!bean) return '已删除豆卡';
  const country = displayName(index, 'countries', bean.countryCode, '未定国家');
  const variety = displayName(index, 'varieties', bean.varietyCode, '未定豆种');
  return `${country} · ${variety}`;
}

function currentEvidenceContext() {
  return {
    countryCode: $('#beanCountry')?.value || '',
    regionCode: $('#beanRegion')?.value || ''
  };
}

function controlDisplay(control) {
  if (!control) return '未填入';
  if (control instanceof HTMLSelectElement) return control.selectedOptions?.[0]?.textContent?.trim() || control.value || '未选择';
  return control.value ? String(control.value) : '未填入';
}

function roastCandidates(evidence) {
  const text = String(evidence || '').toLocaleLowerCase('zh-CN');
  const rows = [
    [/极浅|lightest|ultra\s*light/, 'RL-L0', '极浅烘'],
    [/浅中|medium\s*light/, 'RL-L2', '浅中烘'],
    [/浅烘|浅度|\blight\b/, 'RL-L1', '浅烘'],
    [/中深|medium\s*dark/, 'RL-L4', '中深烘'],
    [/中烘|中度|\bmedium\b/, 'RL-L3', '中烘'],
    [/极深|法式|very\s*dark/, 'RL-L6', '极深烘'],
    [/深烘|深度|\bdark\b/, 'RL-L5', '深烘']
  ];
  return rows.filter(([regex]) => regex.test(text)).map(([, value, label]) => ({ field: 'roastCode', value, code: value, label, score: 0.96 }));
}

function candidateList(field, evidence, book) {
  if (field === 'roastCode') return roastCandidates(evidence);
  return fieldCandidates(field, evidence, book, currentEvidenceContext(), 5);
}

function applyCandidate(field, value, label) {
  const control = $(`#${FIELD_CONTROLS[field]}`);
  if (!control) return;
  const next = String(value ?? '');
  if (control instanceof HTMLSelectElement && next && ![...control.options].some(option => option.value === next)) {
    const option = new Option(label || next, next);
    control.add(option);
  }
  control.value = next;
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
  enhanceEvidence(true);
}

async function enhanceEvidence(force = false) {
  const container = $('.text-evidence');
  if (!container || (!force && container.dataset.integrityEvidence === '1')) return;
  const { book } = await codebookContext();
  const sourceRows = $$('.evidence-row', container).map(row => {
    const spans = $$(':scope > span', row);
    return {
      label: spans[0]?.textContent?.trim() || '',
      evidence: normalizeEvidenceValue(spans[1]?.textContent || ''),
      confidence: spans[2]?.textContent?.trim() || '—'
    };
  });
  if (!sourceRows.length) return;
  container.dataset.integrityEvidence = '1';
  container.innerHTML = `<div class="evidence-table-head"><span>字段</span><span>当前值 / 候选</span><span>置信度</span><span>原始证据</span></div>${sourceRows.map(row => {
    const field = EVIDENCE_FIELDS[row.label];
    const control = field ? $(`#${FIELD_CONTROLS[field]}`) : null;
    const candidates = field ? candidateList(field, row.evidence, book) : [];
    const candidateHtml = candidates.length
      ? `<div class="evidence-candidates">${candidates.map(candidate => {
          const value = candidate.code ?? candidate.value ?? '';
          const score = Math.round(Number(candidate.score || 0) * 100);
          return `<button type="button" data-evidence-field="${esc(field)}" data-evidence-value="${esc(value)}" data-evidence-label="${esc(candidate.label || value)}"><strong>${esc(candidate.label || value)}</strong><small>${score || '—'}%</small></button>`;
        }).join('')}</div>`
      : '<small class="muted">没有可靠候选，请手工选择</small>';
    return `<div class="evidence-row evidence-row-v2"><strong>${esc(row.label)}</strong><div><span class="evidence-current">${esc(controlDisplay(control))}</span>${candidateHtml}</div><span class="evidence-confidence">${esc(row.confidence)}</span><code>${esc(row.evidence || '—')}</code></div>`;
  }).join('')}`;
  $$('[data-evidence-field]', container).forEach(button => button.addEventListener('click', () => {
    applyCandidate(button.dataset.evidenceField, button.dataset.evidenceValue, button.dataset.evidenceLabel);
  }));
}

function captureDescriptorStep(root) {
  const card = $('[data-pro-step]', root);
  if (!card) return false;
  const id = card.dataset.proStep;
  professionalDraft.selections[id] = $$('.v095-selected-tag[data-selected-tag]', card).map(node => node.dataset.selectedTag);
  professionalDraft.intensities[id] = Number($('[data-intensity-step]', card)?.value || 0);
  return true;
}

function readRadarValues(card) {
  return $$('.v095-radar-handle title', card).map(title => Number(String(title.textContent || '').match(/(-?\d+(?:\.\d+)?)\s*$/)?.[1] || 0));
}

function captureRadarStep(root) {
  const aroma = $('[data-radar-card="aroma"]', root);
  const style = $('[data-radar-card="style"]', root);
  if (!aroma && !style) return false;
  if (aroma) professionalDraft.radar.aroma = readRadarValues(aroma);
  if (style) professionalDraft.radar.style = readRadarValues(style);
  return true;
}

function captureAffectiveStep(root) {
  const selected = $$('[data-affective].selected', root);
  if (!selected.length) return false;
  professionalDraft.affective = Object.fromEntries(selected.map(button => [button.dataset.affective, Number(button.dataset.affectiveValue || 0)]));
  return true;
}

function mappedScore(affective) {
  const values = Object.values(affective || {}).map(Number).filter(Number.isFinite);
  if (!values.length) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.min(95, Math.max(50, 50 + (average - 1) * 5.625));
}

function captureProfessionalProgress(event) {
  const button = event.target.closest?.('[data-pro-next]');
  if (!button) return;
  const root = $('#v095ProfessionalWizard');
  if (!root) return;
  captureDescriptorStep(root) || captureRadarStep(root) || captureAffectiveStep(root);
  if (!/确认评分/.test(button.textContent || '')) return;
  const beanId = $('#sensoryBeanSelect')?.value || '';
  globalThis.LuckyBeanPendingSensoryMeta = {
    beanId,
    professional: {
      mode: 'professional',
      selections: structuredClone(professionalDraft.selections),
      intensities: structuredClone(professionalDraft.intensities),
      radar: structuredClone(professionalDraft.radar),
      affective: structuredClone(professionalDraft.affective),
      mappedScore: mappedScore(professionalDraft.affective)
    }
  };
}

function resetProfessionalDraft(event) {
  if (event.target.closest?.('[data-v095-mode="professional"]')) professionalDraft = emptyProfessionalDraft();
  if (event.target.closest?.('[data-pro-cancel]')) professionalDraft = emptyProfessionalDraft();
}

function enforceNoteLimit() {
  const note = $('#sensoryNaturalNote');
  if (!note) return;
  note.maxLength = 300;
  note.setAttribute('maxlength', '300');
  note.placeholder = '仅记录札记，最多300字；专业标签、雷达图和评分会另行结构化保存。';
  if (/^【专业品鉴】/.test(note.value)) {
    const userPart = note.value.split(/\n\n札记：/).slice(1).join('\n\n札记：').trim();
    note.value = userPart.slice(0, 300);
    note.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (note.value.length > 300) note.value = note.value.slice(0, 300);
  let counter = note.parentElement?.querySelector('.sensory-note-counter');
  if (!counter) {
    counter = document.createElement('small');
    counter.className = 'sensory-note-counter';
    note.insertAdjacentElement('afterend', counter);
  }
  counter.textContent = `${note.value.length}/300`;
  if (!note.dataset.integrityBound) {
    note.dataset.integrityBound = '1';
    note.addEventListener('input', () => {
      if (note.value.length > 300) note.value = note.value.slice(0, 300);
      counter.textContent = `${note.value.length}/300`;
    });
  }
}

function enterSensoryChoice(event) {
  const button = event.target.closest?.('#directSensoryBtn, #planToSensoryBtn');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  queueMicrotask(() => $('[data-page-target="sensory"]')?.click());
}

function radarPoints(values, center = 44, radius = 31) {
  const safe = values.length === 5 ? values : [5, 5, 5, 5, 5];
  return safe.map((value, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
    const length = radius * Math.max(0, Math.min(10, Number(value || 0))) / 10;
    return `${(center + Math.cos(angle) * length).toFixed(1)},${(center + Math.sin(angle) * length).toFixed(1)}`;
  }).join(' ');
}

function derivedRadar(tags = []) {
  const has = regex => tags.some(tag => regex.test(tag));
  return [
    has(/花|茉莉|玫瑰|橙花/) ? 8 : 4,
    has(/果|莓|柑|橘|柠檬|桃|苹果|葡萄/) ? 8 : 4,
    has(/茶|红茶|乌龙/) ? 7 : 3,
    has(/坚果|可可|巧克力/) ? 7 : 3,
    has(/发酵|酒香/) ? 7 : 3
  ];
}

function radarFigure(record, tags) {
  const aroma = record.professional?.radar?.aroma?.length === 5 ? record.professional.radar.aroma : derivedRadar(tags);
  const style = record.professional?.radar?.style?.length === 5 ? record.professional.radar.style : [6, 6, 6, 6, 6];
  const grid = [3.3, 6.6, 10].map(value => `<polygon points="${radarPoints(Array(5).fill(value))}"></polygon>`).join('');
  return `<figure class="sensory-record-visual" aria-label="品鉴雷达缩略图"><svg viewBox="0 0 88 88"><g>${grid}</g><polygon class="aroma" points="${radarPoints(aroma)}"></polygon><polygon class="style" points="${radarPoints(style)}"></polygon></svg></figure>`;
}

function tagMarkup(tags) {
  return tags.length ? `<div class="sensory-record-tags">${tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div>` : '<span class="muted small">未记录标签</span>';
}

function richSensoryRecord(record, bean, index, { compact = false } = {}) {
  const tags = sensoryTagLabels(record);
  const score = Number(record.subjectiveScore ?? record.score ?? 0);
  const note = String(record.naturalNote || '').slice(0, 300);
  return `<article class="sensory-record-card${compact ? ' compact' : ''}" data-sensory-record-id="${esc(record.id)}">${radarFigure(record, tags)}<div class="sensory-record-main"><div class="sensory-record-heading"><strong>${esc(beanName(bean, index))}</strong><time>${esc(formattedDate(record.createdAt))}</time><b>${score.toFixed(1)}</b></div>${tagMarkup(tags)}${note ? `<p>${esc(note)}</p>` : ''}</div></article>`;
}

async function enrichSensoryHistory() {
  const containers = [
    $('.sensory-history .record-list'),
    $('[data-overlay="sensory-records"] .record-list')
  ].filter(Boolean);
  if (!containers.length) return;
  const { beans, records, index } = await dataContext(true);
  const beanMap = new Map(beans.map(bean => [bean.id, bean]));
  const sorted = [...records].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  for (const container of containers) {
    const limit = container.closest('.sensory-history') ? 5 : 200;
    const html = sorted.slice(0, limit).map(record => richSensoryRecord(record, beanMap.get(record.beanId), index)).join('');
    if (container.dataset.integrityHtml === html) continue;
    container.dataset.integrityHtml = html;
    container.classList.add('sensory-rich-list');
    container.innerHTML = html || '<p class="muted small">尚无品鉴记录</p>';
  }
}

function sessionSensory(session, records) {
  return records.find(record => record.id === session.sensoryRecordId)
    || records.find(record => record.brewSessionId && record.brewSessionId === session.id)
    || null;
}

async function enrichBrewHistory() {
  const buttons = $$('[data-replay-session]');
  if (!buttons.length) return;
  const { beans, sessions, records, index } = await dataContext(true);
  const beanMap = new Map(beans.map(bean => [bean.id, bean]));
  const sessionMap = new Map(sessions.map(session => [session.id, session]));
  for (const button of buttons) {
    const session = sessionMap.get(button.dataset.replaySession);
    if (!session) continue;
    const sensory = sessionSensory(session, records);
    const corrected = session.status === 'corrected' || session.correction;
    const tags = sensory ? sensoryTagLabels(sensory) : [];
    const note = String(sensory?.naturalNote || session.sensoryNote || '').slice(0, 300);
    const score = Number(sensory?.subjectiveScore ?? session.subjectiveScore ?? 0);
    const profile = session.profile?.label || String(session.profileVersion || '').split('@')[0] || '冲煮方案';
    const html = `${sensory ? radarFigure(sensory, tags) : '<figure class="sensory-record-visual empty"><span>酌</span></figure>'}<div class="brew-history-main"><div class="sensory-record-heading"><strong>${esc(profile)}${corrected ? '<em>修</em>' : ''}</strong><time>${esc(formattedDate(session.createdAt))}</time><b>${score ? score.toFixed(1) : `${Number(session.totals?.waterG || 0).toFixed(0)}g`}</b></div>${tags.length ? tagMarkup(tags) : ''}${note ? `<p>${esc(note)}</p>` : ''}<small>${esc(beanName(beanMap.get(session.beanId), index))}</small></div>`;
    if (button.dataset.integrityHtml === html) continue;
    button.dataset.integrityHtml = html;
    button.classList.add('brew-history-rich');
    button.innerHTML = html;
  }
}

function syncAll() {
  enhanceEvidence().catch(console.error);
  enforceNoteLimit();
  enrichSensoryHistory().catch(console.error);
  enrichBrewHistory().catch(console.error);
}

function queueSync() {
  if (observerQueued) return;
  observerQueued = true;
  requestAnimationFrame(() => {
    observerQueued = false;
    syncAll();
  });
}

document.addEventListener('click', captureProfessionalProgress, true);
document.addEventListener('click', resetProfessionalDraft, true);
document.addEventListener('click', enterSensoryChoice, true);
document.addEventListener('luckybean:data-changed', () => { dataPromise = null; queueSync(); });
new MutationObserver(queueSync).observe(document.documentElement, { childList: true, subtree: true });
queueSync();

globalThis.LuckyBeanIntegrityUI = {
  refresh() { dataPromise = null; queueSync(); },
  captureProfessionalProgress
};
