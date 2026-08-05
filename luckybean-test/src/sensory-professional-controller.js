import { get } from './db.js';
import { loadCodebook, makeIndex, displayName } from './codebook.js';

const $ = (selector, root = document) => root?.querySelector?.(selector) || null;
const $$ = (selector, root = document) => root?.querySelectorAll ? [...root.querySelectorAll(selector)] : [];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const DESCRIPTORS = [
  '花香', '茉莉', '玫瑰', '橙花', '洋甘菊', '柑橘', '柠檬', '莓果', '桃子', '苹果', '葡萄', '热带水果',
  '干果', '茶感', '红茶', '乌龙茶', '香料', '坚果', '可可', '巧克力', '蜂蜜', '蔗糖', '红糖', '焦糖',
  '酒香', '发酵感', '草本', '谷物', '烘烤', '烟熏', '木质', '纸味', '土味', '霉味', '药感', '橡胶'
];
const AFTERTASTE = ['干净', '持久', '短促', '甜感延续', '果香延续', '茶感延续', '可可', '香料', '苦感', '涩感', '干燥', '杂味'];
const ACIDITY = ['明亮', '活泼', '圆润', '柔和', '柑橘酸', '苹果酸', '酒石酸', '醋酸感', '尖锐', '发酵酸'];
const SWEETNESS = ['蜂蜜', '蔗糖', '红糖', '焦糖', '糖浆', '果糖感', '成熟水果', '甜感清晰', '甜感弱', '无明显甜感'];
const MOUTHFEEL = ['轻盈', '丝滑', '顺滑', '圆润', '奶油感', '饱满', '厚重', '多汁', '茶汤感', '粗糙', '干涩', '收敛'];
const AROMA_AXES = ['花香', '果香', '茶感', '坚果', '酵感'];
const STYLE_AXES = ['风味', '余韵', '酸质', '甜感', '醇厚', '干净度', '一致性', '平衡度'];
const DEFECT_GROUPS = Object.freeze({ major: { label: '明缺陷', note: '霉腐，坏发酵', tags: ['霉腐', '坏发酵'], multiplier: 2 }, minor: { label: '暗缺陷', note: '轻微涩', tags: ['轻微涩'], multiplier: 1 } });
const AFFECTIVE = ['香气 / 干湿香', '风味 / 余韵', '酸质', '甜感', '口感'];

const STEPS = [
  { id: 'dry', title: '干香 / 湿香', subtitle: '勾选香气描述，并记录整体强度。', tags: DESCRIPTORS, intensity: true },
  { id: 'high', title: '高温', subtitle: '破渣后高温阶段的主要风味描述。', tags: DESCRIPTORS, intensity: true },
  { id: 'mid', title: '中温', subtitle: '降温后更清晰的风味、酸甜与香气描述。', tags: DESCRIPTORS, intensity: true },
  { id: 'low', title: '低温', subtitle: '低温阶段仍然存在或新出现的风味描述。', tags: DESCRIPTORS, intensity: true },
  { id: 'aftertaste', title: '余韵', subtitle: '勾选余韵性质与持续感。', tags: AFTERTASTE, intensity: true },
  { id: 'acidity', title: '酸质', subtitle: '勾选酸质性质，并记录酸质强度。', tags: ACIDITY, intensity: true },
  { id: 'sweetness', title: '甜感', subtitle: '勾选甜感性质，并记录甜感强度。', tags: SWEETNESS, intensity: true },
  { id: 'mouthfeel', title: '口感', subtitle: '勾选触感和醇厚度描述。', tags: MOUTHFEEL, intensity: true }
];

let wizard = null;
let codebookPromise = null;
let transferBusy = false;

function waitFor(selector, timeout = 5000) {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const found = $(selector);
      if (found) return resolve(found);
      if (performance.now() - startedAt >= timeout) return reject(new Error(`等待界面元素超时：${selector}`));
      requestAnimationFrame(check);
    };
    check();
  });
}
async function codebookContext() {
  if (!codebookPromise) {
    codebookPromise = loadCodebook().then(result => ({ book: result.data, index: makeIndex(result.data) }));
  }
  return codebookPromise;
}

async function beanContext(beanId) {
  const [{ index }, bean] = await Promise.all([codebookContext(), get('beans', beanId)]);
  const original = (bean?.flavorCodes || []).map(code => displayName(index, 'flavors', code, code)).filter(Boolean);
  return { bean, original: [...new Set(original)] };
}

function modePanel() {
  return `<div class="v095-sensory-modes v095-sensory-modes-v2" data-mode-version="professional-v2" aria-label="品鉴模式">
    <button type="button" data-v095-mode="professional"><strong>专业品鉴</strong><small>专业杯测品鉴 / 雷达图 / 札记</small></button>
    <button type="button" data-v095-mode="player"><strong>玩家互动品鉴</strong><small>风味互动 / 札记</small></button>
    <button type="button" data-v095-mode="note"><strong>札记</strong><small>自然语言记录，评分</small></button>
  </div>`;
}

function replaceModePanel() {
  const startPanel = $('#sensoryContent .sensory-start-panel');
  if (!startPanel) return;
  const action = $('.sensory-start-action', startPanel);
  const native = $('#startSensoryBtn', startPanel);
  if (!action || !native) return;
  native.classList.add('v095-native-start');
  const current = $('.v095-sensory-modes', action);
  if (current?.dataset.modeVersion === 'professional-v2') return;
  current?.remove();
  action.insertAdjacentHTML('beforeend', modePanel());
  $$('[data-v095-mode]', action).forEach(button => button.addEventListener('click', () => startMode(button.dataset.v095Mode)));
}

async function selectedBeanId() {
  return $('#sensoryBeanSelect')?.value || '';
}

async function startMode(mode) {
  if (transferBusy) return;
  const beanId = await selectedBeanId();
  if (!beanId) return;
  if (mode === 'player') {
    await startNative(beanId);
    return;
  }
  if (mode === 'note') {
    await startNative(beanId);
    await skipNativeToScore({}, { hidden: true });
    return;
  }
  const context = await beanContext(beanId);
  wizard = {
    beanId,
    bean: context.bean,
    original: context.original,
    step: 0,
    selections: Object.fromEntries(STEPS.map(step => [step.id, []])),
    intensities: Object.fromEntries(STEPS.map(step => [step.id, 7.5])),
    radar: { aroma: [5, 5, 5, 5, 5], style: [5, 5, 5, 5, 5, 5, 5, 5] },
    defects: { major: [], minor: [] },
    selectedRadar: null,
    score: 0
  };
  renderWizard();
}

async function startNative(beanId) {
  const select = await waitFor('#sensoryBeanSelect');
  select.value = beanId;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  const native = await waitFor('#startSensoryBtn');
  native.click();
  await sleep(120);
}

function closeWizard() {
  $('#v095ProfessionalOverlay')?.remove();
  wizard = null;
}

function toggleTag(stepId, tag) {
  const selected = wizard.selections[stepId];
  const index = selected.indexOf(tag);
  if (index >= 0) selected.splice(index, 1);
  else selected.push(tag);
  renderWizard();
}

function setIntensity(stepId, value) {
  wizard.intensities[stepId] = clamp(value, 0, 10);
  const output = $(`[data-v095-intensity-output="${stepId}"]`);
  if (output) output.textContent = Number(wizard.intensities[stepId]).toFixed(1);
}

function axisButtons(group, labels, values) {
  return labels.map((label, index) => `<button type="button" class="v095-radar-axis${wizard.selectedRadar?.group === group && wizard.selectedRadar?.index === index ? ' active' : ''}" data-v095-radar-group="${group}" data-v095-radar-index="${index}"><span>${esc(label)}</span><strong>${Number(values[index] || 0).toFixed(1)}</strong></button>`).join('');
}

function radarSvg(values, labels, size = 260) {
  const center = size / 2;
  const radius = size * .34;
  const points = values.map((value, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / values.length);
    const r = radius * clamp(value, 0, 10) / 10;
    return `${center + Math.cos(angle) * r},${center + Math.sin(angle) * r}`;
  }).join(' ');
  const grid = [2.5, 5, 7.5, 10].map(level => {
    const ring = values.map((_, index) => {
      const angle = -Math.PI / 2 + index * (Math.PI * 2 / values.length);
      const r = radius * level / 10;
      return `${center + Math.cos(angle) * r},${center + Math.sin(angle) * r}`;
    }).join(' ');
    return `<polygon points="${ring}" fill="none" stroke="rgba(190,151,80,.22)"/>`;
  }).join('');
  const axes = values.map((_, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / values.length);
    return `<line x1="${center}" y1="${center}" x2="${center + Math.cos(angle) * radius}" y2="${center + Math.sin(angle) * radius}" stroke="rgba(190,151,80,.22)"/>`;
  }).join('');
  const text = labels.map((label, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / labels.length);
    const r = radius + 22;
    return `<text x="${center + Math.cos(angle) * r}" y="${center + Math.sin(angle) * r}" fill="currentColor" text-anchor="middle" dominant-baseline="middle" font-size="11">${esc(label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" aria-label="感官雷达图">${grid}${axes}<polygon points="${points}" fill="rgba(190,151,80,.3)" stroke="rgba(190,151,80,.9)" stroke-width="2"/>${text}</svg>`;
}

function defectPanel() {
  return Object.entries(DEFECT_GROUPS).map(([key, group]) => `<section class="v095-defect-group"><header><strong>${group.label}</strong><small>${group.note}</small></header>${group.tags.map(tag => `<button type="button" data-v095-defect-group="${key}" data-v095-defect-tag="${esc(tag)}" class="${wizard.defects[key].includes(tag) ? 'active' : ''}">${esc(tag)}</button>`).join('')}</section>`).join('');
}

function renderWizard() {
  if (!wizard) return;
  $('#v095ProfessionalOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'v095ProfessionalOverlay';
  overlay.className = 'overlay full v095-professional-overlay';
  const step = STEPS[wizard.step];
  const sensoryStep = wizard.step < STEPS.length;
  overlay.innerHTML = `<div class="dialog v095-professional-dialog">
    <div class="dialog-header"><div><h2>专业品鉴</h2><p>${sensoryStep ? `${wizard.step + 1}/${STEPS.length + 2} · ${step.title}` : wizard.step === STEPS.length ? '雷达与缺陷' : '确认结果'}</p></div><button class="close-button" type="button" data-v095-close>×</button></div>
    ${sensoryStep ? `<section class="v095-wizard-step"><p>${esc(step.subtitle)}</p><div class="v095-tag-grid">${step.tags.map(tag => `<button type="button" data-v095-tag="${esc(tag)}" class="${wizard.selections[step.id].includes(tag) ? 'active' : ''}">${esc(tag)}</button>`).join('')}</div>${step.intensity ? `<label class="v095-intensity"><span>强度 <output data-v095-intensity-output="${step.id}">${Number(wizard.intensities[step.id]).toFixed(1)}</output></span><input type="range" min="0" max="10" step="0.1" value="${wizard.intensities[step.id]}" data-v095-intensity="${step.id}"></label>` : ''}</section>` : wizard.step === STEPS.length ? `<section class="v095-radar-stage"><div class="v095-radar-stack"><div>${radarSvg(wizard.radar.aroma, AROMA_AXES)}<div class="v095-radar-buttons">${axisButtons('aroma', AROMA_AXES, wizard.radar.aroma)}</div></div><div>${radarSvg(wizard.radar.style, STYLE_AXES)}<div class="v095-radar-buttons">${axisButtons('style', STYLE_AXES, wizard.radar.style)}</div></div></div><label class="v095-intensity"><span>当前轴值 <output data-v095-radar-output>${wizard.selectedRadar ? Number(wizard.radar[wizard.selectedRadar.group][wizard.selectedRadar.index]).toFixed(1) : '选择轴'}</output></span><input type="range" min="0" max="10" step="0.1" value="${wizard.selectedRadar ? wizard.radar[wizard.selectedRadar.group][wizard.selectedRadar.index] : 5}" data-v095-radar-value ${wizard.selectedRadar ? '' : 'disabled'}></label><div class="v095-defects">${defectPanel()}</div></section>` : `<section class="v095-summary-stage"><h3>${esc(wizard.bean?.name || '未命名咖啡')}</h3><pre>${esc(professionalSummary())}</pre><p>映射评分：${affectiveMappedScore().toFixed(1)}</p></section>`}
    <div class="v095-wizard-actions"><button type="button" class="button" data-v095-prev ${wizard.step <= 0 ? 'disabled' : ''}>上一步</button><button type="button" class="button primary" data-v095-next>${wizard.step >= STEPS.length + 1 ? '写入品鉴' : '下一步'}</button></div>
  </div>`;
  document.body.append(overlay);
  $('[data-v095-close]', overlay)?.addEventListener('click', closeWizard);
  $$('[data-v095-tag]', overlay).forEach(button => button.addEventListener('click', () => toggleTag(step.id, button.dataset.v095Tag)));
  $$('[data-v095-intensity]', overlay).forEach(input => input.addEventListener('input', () => setIntensity(input.dataset.v095Intensity, input.value)));
  $$('[data-v095-radar-group]', overlay).forEach(button => button.addEventListener('click', () => { wizard.selectedRadar = { group: button.dataset.v095RadarGroup, index: Number(button.dataset.v095RadarIndex) }; renderWizard(); }));
  $('[data-v095-radar-value]', overlay)?.addEventListener('input', event => {
    if (!wizard.selectedRadar) return;
    wizard.radar[wizard.selectedRadar.group][wizard.selectedRadar.index] = Number(event.target.value);
    $('[data-v095-radar-output]', overlay).textContent = Number(event.target.value).toFixed(1);
  });
  $$('[data-v095-defect-group]', overlay).forEach(button => button.addEventListener('click', () => {
    const list = wizard.defects[button.dataset.v095DefectGroup];
    const tag = button.dataset.v095DefectTag;
    const index = list.indexOf(tag);
    if (index >= 0) list.splice(index, 1); else list.push(tag);
    renderWizard();
  }));
  $('[data-v095-prev]', overlay)?.addEventListener('click', () => { wizard.step = Math.max(0, wizard.step - 1); renderWizard(); });
  $('[data-v095-next]', overlay)?.addEventListener('click', async () => {
    if (wizard.step < STEPS.length + 1) { wizard.step += 1; renderWizard(); }
    else await finishProfessional();
  });
}

function professionalSummary() {
  const lines = [];
  for (const step of STEPS) {
    const tags = wizard.selections[step.id];
    if (tags.length) lines.push(`${step.title}：${tags.join('、')}；强度 ${Number(wizard.intensities[step.id]).toFixed(1)}`);
  }
  lines.push(`香气雷达：${AROMA_AXES.map((label, index) => `${label}${Number(wizard.radar.aroma[index]).toFixed(1)}`).join('、')}`);
  lines.push(`风格雷达：${STYLE_AXES.map((label, index) => `${label}${Number(wizard.radar.style[index]).toFixed(1)}`).join('、')}`);
  const defects = Object.entries(wizard.defects).flatMap(([key, tags]) => tags.map(tag => `${DEFECT_GROUPS[key].label}-${tag}`));
  if (defects.length) lines.push(`缺陷：${defects.join('、')}`);
  return lines.join('\n');
}

function affectiveMappedScore() {
  const selected = AFFECTIVE.map((_, index) => wizard.radar.style[index] || 0);
  const average = selected.reduce((sum, value) => sum + value, 0) / selected.length;
  const defectPenalty = Object.entries(wizard.defects).reduce((sum, [key, tags]) => sum + tags.length * DEFECT_GROUPS[key].multiplier, 0);
  return clamp(70 + average * 3 - defectPenalty, 0, 100);
}

function nativePreferences() {
  const preferences = {};
  const selected = wizard.selections;
  const allTags = Object.values(selected).flat();
  if (allTags.some(tag => /花|茉莉|玫瑰|橙花/.test(tag))) preferences.floral = ['花香'];
  if (allTags.some(tag => /柑橘|柠檬|莓果|桃|苹果|葡萄|水果/.test(tag))) preferences.fruit = ['果香'];
  if (allTags.some(tag => /茶|坚果|巧克力|可可|酒|香料/.test(tag))) preferences.other = ['其他风味'];
  if (selected.sweetness.length) preferences.sweet = selected.sweetness;
  if (selected.acidity.length) preferences.acid = selected.acidity;
  if (selected.mouthfeel.length) preferences.mouthfeel = selected.mouthfeel;
  return preferences;
}

async function skipNativeToScore(preferences = {}, { hidden = false } = {}) {
  const root = await waitFor('#sensoryContent');
  if (hidden) root.classList.add('v095-sensory-hidden-transfer');
  for (let attempt = 0; attempt < 14; attempt++) {
    const title = $('#sensoryContent h2')?.textContent || '';
    if (/总分|评分/.test(title) || $('#sensoryDeltaWheel')) break;
    const active = $('.sensory-node.active', root) || $('.sensory-node', root);
    const label = active?.querySelector('h2,h3,strong')?.textContent || '';
    const options = preferences[Object.keys(preferences).find(key => label.includes(key))] || [];
    $$('button', active).forEach(button => { if (options.some(option => button.textContent.includes(option))) button.click(); });
    const next = $('#nextSensoryNodeBtn');
    if (!next) break;
    next.click();
    await sleep(90);
  }
}

function injectProfessionalNote(summary) {
  const apply = () => {
    const note = $('#sensoryNaturalNote');
    if (!note) return false;
    note.value = `${note.value ? `${note.value.trim()}\n\n` : ''}${summary}`;
    note.dispatchEvent(new Event('input', { bubbles: true }));
    note.focus();
    note.setSelectionRange(note.value.length, note.value.length);
    return true;
  };
  if (apply()) return;
  const observer = new MutationObserver(() => { if (apply()) observer.disconnect(); });
  observer.observe($('#sensoryContent') || document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 10000);
}

async function finishProfessional() {
  if (!wizard || transferBusy) return;
  const beanId = wizard.beanId;
  const summary = professionalSummary();
  const targetScore = affectiveMappedScore();
  const preferences = nativePreferences();
  closeWizard();
  transferBusy = true;
  await startNative(beanId);
  document.documentElement.classList.add('v095-native-bypass');
  try {
    await skipNativeToScore(preferences, { hidden: true });
    const auto = Number($('#sensoryAutoScore')?.textContent || 0);
    const wheel = $('#sensoryDeltaWheel');
    if (!wheel) throw new Error('评分控件未出现');
    wheel.value = clamp(targetScore - auto, -10, 10).toFixed(1);
    wheel.dispatchEvent(new Event('input', { bubbles: true }));
    $('#nextSensoryNodeBtn')?.click();
    await waitFor('#sensoryNaturalNote');
    injectProfessionalNote(summary);
  } finally {
    document.documentElement.classList.remove('v095-native-bypass');
    transferBusy = false;
  }
}

export function syncSensoryModePanel() { replaceModePanel(); }

document.addEventListener('luckybean:sensory-rendered', replaceModePanel);
document.addEventListener('DOMContentLoaded', replaceModePanel, { once: true });
replaceModePanel();
