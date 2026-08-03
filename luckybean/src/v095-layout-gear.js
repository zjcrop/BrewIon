const GEAR_MARK = 'luckybean-v095-gear-event-driven';
let syncQueued = false;
let grinderRecords = [];
let observedSettingsRoot = null;
let settingsObserver = null;
let observedOverlayRoot = null;
let overlayObserver = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const id = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function replaceLegacyLabels(root = document.body) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    let value = node.nodeValue;
    value = value.replaceAll('拾余', '余量');
    value = value.replaceAll('诹吉', '溯旧');
    value = value.replaceAll('撷吉', '溯旧');
    if (value !== node.nodeValue) node.nodeValue = value;
  }
}

function repairRecommendationMenu() {
  const option = $('[data-recommend-mode="remaining"]');
  if (!option) return;
  const label = $('.recommend-label', option);
  const dot = $('.recommend-dot', option);
  if (label && label.textContent !== '余量') label.textContent = '余量';
  if (dot && dot.dataset.v095Grey !== '1') {
    dot.style.background = '#8b8b87';
    dot.dataset.v095Grey = '1';
  }
  option.setAttribute('aria-label', '余量');
}

function removeManageHistory() {
  $$('[data-manage-action="history"]').forEach(button => button.remove());
}

function normalizeDripperSection() {
  const details = $('.gear-drippers');
  if (!details) return;
  details.classList.add('v095-gear-section', 'v095-dripper-section');
  const summary = $(':scope > summary', details);
  const addButton = $('#addDripperBtn', details);
  if (!summary || summary.dataset.v095Normalized === '1') return;
  summary.dataset.v095Normalized = '1';
  summary.classList.add('v095-gear-heading');
  summary.innerHTML = '<span><strong>滤杯</strong><small>名称、类型和价格</small></span>';
  if (addButton) {
    addButton.textContent = '添';
    addButton.classList.add('v095-gear-add');
    summary.append(addButton);
    addButton.addEventListener('click', event => event.stopPropagation());
  }
}

function normalizeFilterSection() {
  const section = $('#addFilterBtn')?.closest('.gear-subpage');
  if (!section) return;
  section.classList.add('v095-gear-section', 'v095-filter-section');
  const header = $('.panel-title', section);
  if (header) header.classList.add('v095-gear-heading');
  const title = $('h3', header);
  if (title && title.textContent !== '滤纸') title.textContent = '滤纸';
}

function parseGrinders(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.filter(item => item && typeof item === 'object').map(item => ({
        id: String(item.id || id('grinder')),
        brand: String(item.brand || ''),
        name: String(item.name || item.model || '未命名磨豆机'),
        rangeStart: String(item.rangeStart ?? item.start ?? ''),
        rangeEnd: String(item.rangeEnd ?? item.end ?? ''),
        unit: String(item.unit || '格')
      }));
    }
  } catch { /* legacy plain text */ }
  return [{ id: id('grinder'), brand: '', name: text, rangeStart: '', rangeEnd: '', unit: '格' }];
}

function serializeGrinders(records) {
  return JSON.stringify(records.map(item => ({
    id: item.id,
    brand: item.brand,
    name: item.name,
    rangeStart: item.rangeStart,
    rangeEnd: item.rangeEnd,
    unit: item.unit
  })));
}

function persistGrinders() {
  const input = $('#gearGrinders');
  const save = $('#saveGearTextBtn');
  if (!input || !save) return;
  input.value = serializeGrinders(grinderRecords);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  save.click();
  renderGrinderSection(true);
}

function grinderRangeText(item) {
  if (!item.rangeStart && !item.rangeEnd) return '常用刻度范围未设';
  return `${item.rangeStart || '—'}–${item.rangeEnd || '—'}${item.unit || ''}`;
}

function renderGrinderSection(force = false) {
  const manager = $('.gear-manager');
  const input = $('#gearGrinders');
  const save = $('#saveGearTextBtn');
  if (!manager || !input || !save) return;
  input.closest('.field')?.classList.add('v095-legacy-grinder-field');
  save.classList.add('v095-legacy-grinder-save');
  grinderRecords = parseGrinders(input.value);
  const renderKey = serializeGrinders(grinderRecords);

  let section = $('#v095GrinderSection');
  if (!section) {
    section = document.createElement('section');
    section.id = 'v095GrinderSection';
    section.className = 'gear-subpage v095-gear-section v095-grinder-section';
    manager.append(section);
  }
  if (!force && section.dataset.renderKey === renderKey) return;
  section.dataset.renderKey = renderKey;
  section.innerHTML = `<div class="panel-title v095-gear-heading"><div><h3>磨豆机</h3><p>型号与手冲常用刻度范围</p></div><button id="addGrinderBtn" class="button v095-gear-add" type="button">添</button></div>
    <div class="gear-list">${grinderRecords.length ? grinderRecords.map(item => `<button class="gear-item" type="button" data-grinder-item="${esc(item.id)}"><span><strong>${esc([item.brand, item.name].filter(Boolean).join(' '))}</strong><small>手冲常用刻度范围：${esc(grinderRangeText(item))}</small></span><b>设</b></button>`).join('') : '<p class="muted small">尚未添加磨豆机。</p>'}</div>`;
  $('#addGrinderBtn', section)?.addEventListener('click', () => openGrinderEditor());
  $$('[data-grinder-item]', section).forEach(button => button.addEventListener('click', () => openGrinderEditor(button.dataset.grinderItem)));
}

function closeEditor() {
  $('#v095GearEditor')?.remove();
}

function openGrinderEditor(recordId = '') {
  closeEditor();
  const existing = grinderRecords.find(item => item.id === recordId) || { id: '', brand: '', name: '', rangeStart: '', rangeEnd: '', unit: '格' };
  const root = document.createElement('div');
  root.id = 'v095GearEditor';
  root.className = 'overlay v095-gear-editor-overlay';
  root.innerHTML = `<div class="dialog v095-gear-editor" role="dialog" aria-modal="true" aria-labelledby="v095GrinderTitle">
    <div class="dialog-header centered"><div><h2 id="v095GrinderTitle">${recordId ? '编辑磨豆机' : '添加磨豆机'}</h2><p>刻度必须录入为起始值与结束值组成的范围</p></div><button type="button" class="close-button" data-close-grinder aria-label="关闭">×</button></div>
    <div class="grid-2">
      <label class="field"><span>品牌</span><input id="v095GrinderBrand" class="control" value="${esc(existing.brand)}"></label>
      <label class="field"><span>型号 *</span><input id="v095GrinderName" class="control" value="${esc(existing.name)}"></label>
      <label class="field"><span>手冲常用刻度范围 · 起始 *</span><input id="v095GrinderStart" class="control" inputmode="decimal" value="${esc(existing.rangeStart)}" placeholder="例如 18"></label>
      <label class="field"><span>手冲常用刻度范围 · 结束 *</span><input id="v095GrinderEnd" class="control" inputmode="decimal" value="${esc(existing.rangeEnd)}" placeholder="例如 24"></label>
      <label class="field"><span>刻度单位</span><select id="v095GrinderUnit" class="control">${['格', '圈', '档', '数字'].map(unit => `<option${unit === existing.unit ? ' selected' : ''}>${unit}</option>`).join('')}</select></label>
    </div>
    <div class="row end">${recordId ? '<button id="deleteGrinderBtn" class="button danger" type="button">删除</button>' : ''}<button id="saveGrinderBtn" class="button primary" type="button">确定</button></div>
  </div>`;
  (document.body || document.documentElement).append(root);
  $('[data-close-grinder]', root)?.addEventListener('click', closeEditor);
  root.addEventListener('click', event => { if (event.target === root) closeEditor(); });
  $('#saveGrinderBtn', root)?.addEventListener('click', () => {
    const name = $('#v095GrinderName', root).value.trim();
    const rangeStart = $('#v095GrinderStart', root).value.trim();
    const rangeEnd = $('#v095GrinderEnd', root).value.trim();
    if (!name || !rangeStart || !rangeEnd) {
      root.querySelector('.dialog-header p').textContent = '型号、起始刻度和结束刻度均为必填项。';
      root.querySelector('.dialog-header p').classList.add('status-bad');
      return;
    }
    const startNumber = Number(rangeStart);
    const endNumber = Number(rangeEnd);
    if (Number.isFinite(startNumber) && Number.isFinite(endNumber) && startNumber > endNumber) {
      root.querySelector('.dialog-header p').textContent = '起始刻度不能大于结束刻度。';
      root.querySelector('.dialog-header p').classList.add('status-bad');
      return;
    }
    const record = {
      id: existing.id || id('grinder'),
      brand: $('#v095GrinderBrand', root).value.trim(),
      name,
      rangeStart,
      rangeEnd,
      unit: $('#v095GrinderUnit', root).value
    };
    const index = grinderRecords.findIndex(item => item.id === record.id);
    if (index >= 0) grinderRecords[index] = record;
    else grinderRecords.push(record);
    closeEditor();
    persistGrinders();
  });
  $('#deleteGrinderBtn', root)?.addEventListener('click', () => {
    grinderRecords = grinderRecords.filter(item => item.id !== recordId);
    closeEditor();
    persistGrinders();
  });
}

function normalizeDripperEditor() {
  const dialog = $('.overlay[data-overlay="dripper-editor"] .dialog');
  if (!dialog || dialog.dataset.v095Normalized) return;
  dialog.dataset.v095Normalized = '1';
  dialog.classList.add('v095-equipment-editor', 'v095-dripper-editor');
  $('.dialog-header', dialog)?.classList.add('v095-equipment-editor-header');
}

function normalizeFilterEditor() {
  const dialog = $('.overlay[data-overlay="filter-editor"] .dialog');
  if (!dialog || dialog.dataset.v095Normalized) return;
  dialog.dataset.v095Normalized = '1';
  dialog.classList.add('v095-equipment-editor', 'v095-filter-editor');
  $('.dialog-header', dialog)?.classList.add('v095-equipment-editor-header');
}

function syncLayoutAndGear() {
  replaceLegacyLabels();
  repairRecommendationMenu();
  removeManageHistory();
  normalizeFilterSection();
  normalizeDripperSection();
  renderGrinderSection();
  normalizeDripperEditor();
  normalizeFilterEditor();
  document.documentElement.dataset.v095Gear = GEAR_MARK;
}

function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => {
    syncQueued = false;
    syncLayoutAndGear();
  });
}

function connectLocalObservers() {
  const settingsRoot = $('#settingsContent');
  if (settingsRoot && settingsRoot !== observedSettingsRoot) {
    settingsObserver?.disconnect();
    observedSettingsRoot = settingsRoot;
    settingsObserver = new MutationObserver(records => {
      if (records.some(record => record.target === settingsRoot && record.type === 'childList')) queueSync();
    });
    settingsObserver.observe(settingsRoot, { childList: true });
  }

  const overlayRoot = $('#overlayRoot');
  if (overlayRoot && overlayRoot !== observedOverlayRoot) {
    overlayObserver?.disconnect();
    observedOverlayRoot = overlayRoot;
    overlayObserver = new MutationObserver(records => {
      if (records.some(record => record.type === 'childList')) queueSync();
    });
    overlayObserver.observe(overlayRoot, { childList: true, subtree: true });
  }
}

function scheduleAfterInteraction(event) {
  if (!event.target.closest?.('[data-page-target="settings"],#fabRecommendBtn,#manageBtn,#addDripperBtn,#addFilterBtn,[data-dripper-item],[data-filter-item]')) return;
  setTimeout(() => {
    connectLocalObservers();
    queueSync();
  }, 0);
}

document.addEventListener('DOMContentLoaded', () => {
  connectLocalObservers();
  queueSync();
}, { once: true });
document.addEventListener('luckybean:settings-mounted', queueSync);
document.addEventListener('click', scheduleAfterInteraction, true);
window.addEventListener('pageshow', () => {
  connectLocalObservers();
  queueSync();
});

connectLocalObservers();
queueSync();
