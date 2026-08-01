import { get } from './db.js';
import { loadCodebook, makeIndex, displayName } from './codebook.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
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
const STYLE_AXES = ['风味', '余韵', '酸质', '甜感', '醇厚'];
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
let observerQueued = false;
let transferBusy = false;

function waitFor(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const found = $(selector);
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const node = $(selector);
      if (node) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(node);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`等待界面元素超时：${selector}`));
    }, timeout);
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
  const action = $('.sensory-start-action', startPanel);
  const native = $('#startSensoryBtn', startPanel);
  if (!startPanel || !action || !native) return;
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
    radar: { aroma: [5, 5, 5, 5, 5], style: [5, 5, 5, 5, 5] },
    selectedRadar: null,
    affective: Object.fromEntries(AFFECTIVE.map(label => [label, 5]))
  };
  renderWizard();
}

async function startNative(beanId) {
  const select = $('#sensoryBeanSelect');
  if (select) select.value = beanId;
  const button = $('#startSensoryBtn');
  if (!button) throw new Error('未找到品鉴入口');
  button.click();
  return waitFor('.sensory-evaluation');
}

function phaseOrder(id) {
  return wizard.selections[id] || [];
}

function originalSet() {
  return new Set(wizard?.original || []);
}

function orderedPool(step) {
  const originals = wizard.original.filter(label => step.tags.includes(label) || DESCRIPTORS.includes(label));
  return [...new Set([...originals, ...step.tags])];
}

function descriptorStep(step, index) {
  const selected = phaseOrder(step.id);
  const originals = originalSet();
  return `<section class="v095-pro-card" data-pro-step="${step.id}">
    <p class="v095-step">描述性评估 ${index + 1} / ${STEPS.length}</p>
    <h2>${esc(step.title)}</h2><p>${esc(step.subtitle)}</p>
    <strong class="v095-sort-hint">排序靠前的标签代表强度更高</strong>
    <div class="v095-selected-tags" data-selected-list="${step.id}" aria-label="已选风味排序">${selected.length ? selected.map((label, position) => `<button type="button" draggable="true" class="v095-selected-tag" data-selected-tag="${esc(label)}" data-position="${position}"><span>${esc(label)}</span>${originals.has(label) ? '<small>原</small>' : ''}<b aria-hidden="true">⋮⋮</b></button>`).join('') : '<span class="muted small">尚未选择风味标签</span>'}</div>
    <div class="v095-tag-pool">${orderedPool(step).map(label => `<button type="button" class="v095-cata-tag${selected.includes(label) ? ' selected' : ''}" data-cata-tag="${esc(label)}">${esc(label)}${originals.has(label) ? '<small>原</small>' : ''}</button>`).join('')}</div>
    ${step.intensity ? `<label class="v095-descriptive-intensity"><span>${esc(step.title)}整体强度</span><input type="range" min="0" max="15" step="0.5" value="${wizard.intensities[step.id]}" data-intensity-step="${step.id}"><output>${Number(wizard.intensities[step.id]).toFixed(1)}</output><small>0–15 描述性强度</small></label>` : ''}
  </section>`;
}

function radarPoints(values, center = 120, radius = 88) {
  return values.map((value, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / values.length;
    const length = radius * clamp(value, 0, 10) / 10;
    return `${(center + Math.cos(angle) * length).toFixed(1)},${(center + Math.sin(angle) * length).toFixed(1)}`;
  }).join(' ');
}

function radarMarkup(key, title, labels, values) {
  const center = 120, radius = 88;
  const rings = [2, 4, 6, 8, 10].map(level => `<polygon points="${radarPoints(Array(5).fill(level), center, radius)}"></polygon>`).join('');
  const axes = labels.map((label, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / labels.length;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    const lx = center + Math.cos(angle) * (radius + 22);
    const ly = center + Math.sin(angle) * (radius + 22);
    return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}"></line><text class="v095-radar-axis-label" data-radar-axis="${key}:${index}" x="${lx}" y="${ly}">${esc(label)}</text>`;
  }).join('');
  const handles = values.map((value, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / values.length;
    const length = radius * value / 10;
    const selected = wizard.selectedRadar?.key === key && wizard.selectedRadar?.index === index;
    return `<circle class="v095-radar-handle${selected ? ' selected' : ''}" data-radar-axis="${key}:${index}" cx="${center + Math.cos(angle) * length}" cy="${center + Math.sin(angle) * length}" r="8" tabindex="0"><title>${esc(labels[index])} ${Number(value).toFixed(1)}</title></circle>`;
  }).join('');
  return `<section class="v095-radar" data-radar-card="${key}"><h3>${esc(title)}</h3><p>点击一个轴点后，在图下方拖动横向强度轴。</p><svg data-radar-svg="${key}" viewBox="0 0 240 240" role="img" aria-label="${esc(title)}"><g class="grid">${rings}${axes}</g><polygon class="value" points="${radarPoints(values, center, radius)}"></polygon>${handles}</svg>${radarSlider(key, labels, values)}</section>`;
}

function radarSlider(key, labels, values) {
  if (!wizard.selectedRadar || wizard.selectedRadar.key !== key) return '<div class="v095-radar-slider-slot" aria-hidden="true"></div>';
  const index = wizard.selectedRadar.index;
  return `<label class="v095-radar-slider"><span>${esc(labels[index])}强度</span><input type="range" min="0" max="10" step="0.1" value="${values[index]}" data-radar-slider="${key}:${index}"><output>${Number(values[index]).toFixed(1)}</output></label>`;
}

function radarStep() {
  return `<section class="v095-pro-card wide"><p class="v095-step">雷达图</p><h2>风格标定</h2><p>雷达图是富贵盒子的视觉表达，不属于 SCA 官方表单字段。</p><div class="v095-radar-grid">${radarMarkup('aroma', '香气倾向', AROMA_AXES, wizard.radar.aroma)}${radarMarkup('style', '整体风格', STYLE_AXES, wizard.radar.style)}</div></section>`;
}

function affectiveMappedScore() {
  const values = Object.values(wizard.affective).map(Number);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return clamp(50 + (average - 1) * 5.625, 50, 95);
}

function affectiveStep() {
  return `<section class="v095-pro-card wide"><p class="v095-step">最终评分</p><h2>偏好 / 质量印象</h2><p>分别记录各项质量印象；1 表示极不喜欢，9 表示极喜欢。评分完成后直接进入札记。</p><div class="v095-affective-grid">${AFFECTIVE.map(label => `<fieldset class="v095-affective-item"><legend>${esc(label)}</legend><div class="v095-nine-scale">${Array.from({ length: 9 }, (_, index) => index + 1).map(value => `<button type="button" data-affective="${esc(label)}" data-affective-value="${value}" class="${wizard.affective[label] === value ? 'selected' : ''}">${value}</button>`).join('')}</div><small>当前 ${wizard.affective[label]} / 9</small></fieldset>`).join('')}</div><div class="v095-pro-score"><span>应用映射建议分</span><strong>${affectiveMappedScore().toFixed(1)}</strong><small>用于兼容富贵盒子现有 100 分记录；不是 SCA 官方总分公式。</small></div></section>`;
}

function currentStepKind() {
  if (wizard.step < STEPS.length) return 'descriptor';
  if (wizard.step === STEPS.length) return 'radar';
  return 'affective';
}

function renderWizard() {
  let root = $('#v095ProfessionalWizard');
  if (!root) {
    root = document.createElement('div');
    root.id = 'v095ProfessionalWizard';
    document.body.append(root);
  }
  const kind = currentStepKind();
  const body = kind === 'descriptor' ? descriptorStep(STEPS[wizard.step], wizard.step) : kind === 'radar' ? radarStep() : affectiveStep();
  const final = kind === 'affective';
  root.innerHTML = `<div class="v095-wizard-overlay v095-professional-overlay"><div class="v095-wizard-dialog v095-professional-dialog">${body}<div class="v095-wizard-actions"><button type="button" class="button subtle" data-pro-cancel>取消</button><button type="button" class="button" data-pro-back${wizard.step === 0 ? ' disabled' : ''}>返回</button><button type="button" class="button primary" data-pro-next>${final ? '确认评分，进入札记' : '继续'}</button></div></div></div>`;
  $('[data-pro-cancel]', root)?.addEventListener('click', closeWizard);
  $('[data-pro-back]', root)?.addEventListener('click', () => { if (wizard.step > 0) { wizard.step -= 1; wizard.selectedRadar = null; renderWizard(); } });
  $('[data-pro-next]', root)?.addEventListener('click', () => final ? finishProfessional() : advanceProfessional());
  if (kind === 'descriptor') bindDescriptorStep(STEPS[wizard.step]);
  if (kind === 'radar') bindRadarStep();
  if (kind === 'affective') bindAffectiveStep();
}

function closeWizard() {
  $('#v095ProfessionalWizard')?.remove();
  wizard = null;
}

function advanceProfessional() {
  wizard.step += 1;
  wizard.selectedRadar = null;
  renderWizard();
}

function toggleTag(step, label) {
  const selected = wizard.selections[step.id];
  wizard.selections[step.id] = selected.includes(label) ? selected.filter(item => item !== label) : [...selected, label];
  renderWizard();
}

function reorderTag(stepId, source, target) {
  const list = [...wizard.selections[stepId]];
  const from = list.indexOf(source);
  const to = list.indexOf(target);
  if (from < 0 || to < 0 || from === to) return;
  list.splice(to, 0, list.splice(from, 1)[0]);
  wizard.selections[stepId] = list;
}

function bindDescriptorStep(step) {
  $$('[data-cata-tag]').forEach(button => button.addEventListener('click', () => toggleTag(step, button.dataset.cataTag)));
  $('[data-intensity-step]')?.addEventListener('input', event => {
    wizard.intensities[step.id] = Number(event.target.value);
    event.target.nextElementSibling.textContent = Number(event.target.value).toFixed(1);
  });
  const list = $('[data-selected-list]');
  if (!list) return;
  let dragLabel = '';
  $$('.v095-selected-tag', list).forEach(chip => {
    chip.addEventListener('click', event => {
      if (event.detail === 0) return;
      toggleTag(step, chip.dataset.selectedTag);
    });
    chip.addEventListener('dragstart', event => {
      dragLabel = chip.dataset.selectedTag;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragLabel);
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    chip.addEventListener('dragover', event => event.preventDefault());
    chip.addEventListener('drop', event => {
      event.preventDefault();
      reorderTag(step.id, event.dataTransfer.getData('text/plain') || dragLabel, chip.dataset.selectedTag);
      renderWizard();
    });
    chip.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse') return;
      dragLabel = chip.dataset.selectedTag;
      chip.setPointerCapture(event.pointerId);
      chip.classList.add('dragging');
    });
    chip.addEventListener('pointermove', event => {
      if (!dragLabel || event.pointerType === 'mouse') return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.v095-selected-tag');
      if (!target || target === chip) return;
      reorderTag(step.id, dragLabel, target.dataset.selectedTag);
      const sourceNode = $(`.v095-selected-tag[data-selected-tag="${CSS.escape(dragLabel)}"]`, list);
      if (sourceNode && target.parentNode === list) list.insertBefore(sourceNode, target);
    });
    const end = () => { dragLabel = ''; chip.classList.remove('dragging'); };
    chip.addEventListener('pointerup', end);
    chip.addEventListener('pointercancel', end);
  });
}

function radarLabels(key) {
  return key === 'aroma' ? AROMA_AXES : STYLE_AXES;
}

function setRadarSelection(key, index) {
  wizard.selectedRadar = { key, index };
  renderWizard();
}

function updateRadarValue(key, index, value) {
  wizard.radar[key][index] = Math.round(clamp(value, 0, 10) * 10) / 10;
  const card = $(`[data-radar-card="${key}"]`);
  if (!card) return;
  const polygon = $('.value', card);
  if (polygon) polygon.setAttribute('points', radarPoints(wizard.radar[key]));
  const handle = $(`[data-radar-axis="${key}:${index}"].v095-radar-handle`, card);
  if (handle) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
    const length = 88 * wizard.radar[key][index] / 10;
    handle.setAttribute('cx', 120 + Math.cos(angle) * length);
    handle.setAttribute('cy', 120 + Math.sin(angle) * length);
    $('title', handle).textContent = `${radarLabels(key)[index]} ${wizard.radar[key][index].toFixed(1)}`;
  }
  const slider = $(`[data-radar-slider="${key}:${index}"]`, card);
  if (slider) {
    slider.value = wizard.radar[key][index];
    slider.nextElementSibling.textContent = wizard.radar[key][index].toFixed(1);
  }
}

function pointerRadarValue(event, svg, index) {
  const rect = svg.getBoundingClientRect();
  const x = (event.clientX - rect.left) * 240 / rect.width - 120;
  const y = (event.clientY - rect.top) * 240 / rect.height - 120;
  const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
  return ((x * Math.cos(angle) + y * Math.sin(angle)) / 88) * 10;
}

function bindRadarStep() {
  $$('[data-radar-axis]').forEach(node => node.addEventListener('click', event => {
    const [key, index] = event.currentTarget.dataset.radarAxis.split(':');
    setRadarSelection(key, Number(index));
  }));
  $$('.v095-radar-handle').forEach(handle => handle.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    const [key, indexText] = handle.dataset.radarAxis.split(':');
    const index = Number(indexText);
    wizard.selectedRadar = { key, index };
    const svg = handle.ownerSVGElement;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging', 'selected');
    const move = moveEvent => updateRadarValue(key, index, pointerRadarValue(moveEvent, svg, index));
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      renderWizard();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    updateRadarValue(key, index, pointerRadarValue(event, svg, index));
  }));
  $('[data-radar-slider]')?.addEventListener('input', event => {
    const [key, index] = event.target.dataset.radarSlider.split(':');
    updateRadarValue(key, Number(index), Number(event.target.value));
  });
}

function bindAffectiveStep() {
  $$('[data-affective]').forEach(button => button.addEventListener('click', () => {
    wizard.affective[button.dataset.affective] = Number(button.dataset.affectiveValue);
    renderWizard();
  }));
}

function intensityWord(value) {
  const number = Number(value);
  if (number < 3) return '低';
  if (number < 7) return '中';
  if (number < 11) return '强';
  return '高';
}

function professionalSummary() {
  const lines = ['【专业品鉴】'];
  for (const step of STEPS) {
    const tags = wizard.selections[step.id];
    lines.push(`${step.title}：${tags.length ? tags.join(' ＞ ') : '未标记'}；强度 ${Number(wizard.intensities[step.id]).toFixed(1)}/15`);
  }
  lines.push(`香气倾向：${AROMA_AXES.map((label, index) => `${label}${wizard.radar.aroma[index].toFixed(1)}`).join('、')}`);
  lines.push(`整体风格：${STYLE_AXES.map((label, index) => `${label}${wizard.radar.style[index].toFixed(1)}`).join('、')}`);
  lines.push(`偏好评分：${AFFECTIVE.map(label => `${label}${wizard.affective[label]}/9`).join('、')}`);
  lines.push(`应用映射建议分：${affectiveMappedScore().toFixed(1)}`);
  return lines.join('\n');
}

function nativePreferences() {
  const all = [...new Set(STEPS.flatMap(step => wizard.selections[step.id]))];
  const find = regex => all.find(item => regex.test(item));
  const averageIntensity = STEPS.reduce((sum, step) => sum + Number(wizard.intensities[step.id]), 0) / STEPS.length;
  const intensity = intensityWord(averageIntensity);
  return {
    花香: { 0: [find(/花|茉莉|玫瑰|橙花|洋甘菊/) || '无'], 1: [find(/花|茉莉|玫瑰|橙花|洋甘菊/) ? intensity : '无'] },
    果香: { 0: [find(/果|莓|柑|橘|柠檬|桃|苹果|葡萄/) || '无'], 1: [find(/果|莓|柑|橘|柠檬|桃|苹果|葡萄/) ? intensity : '无'] },
    其他: { 0: [find(/茶|香料|坚果|巧克力|酒香|草本/) || '无'], 1: [all.length ? intensity : '无'], 2: [find(/发酵|酒香/) ? intensity : '无'], 3: ['无'] },
    甜: { 0: [find(/蜂蜜|蔗糖|红糖|焦糖|糖浆/) || '蜂蜜'], 1: [Number(wizard.intensities.sweetness) < 2 ? '无' : Number(wizard.intensities.sweetness) < 6 ? '低' : Number(wizard.intensities.sweetness) < 11 ? '适中' : '高'] },
    酸: { 0: [find(/柑橘|柠檬|苹果|葡萄|醋酸/) || '柑橘'], 1: [Number(wizard.intensities.acidity) < 2 ? '无' : Number(wizard.intensities.acidity) < 6 ? '微酸' : Number(wizard.intensities.acidity) < 11 ? '圆润舒适' : '尖锐'] },
    苦: { 0: ['无'] },
    口感: { 0: [find(/轻盈|顺滑|圆润|奶油|厚重|干涩|收敛/) || '顺滑'] },
    负面: { 0: [find(/纸味|木质|土味|霉味|药感|橡胶/) || '无'] }
  };
}

async function chooseNativeOption(groupIndex, preferences = []) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const buttons = $$(`.sensory-option[data-group-index="${groupIndex}"]`);
    if (!buttons.length) { await sleep(30); continue; }
    const preferred = preferences.find(value => buttons.some(button => button.dataset.sensoryOption === value));
    const target = buttons.find(button => button.dataset.sensoryOption === preferred)
      || buttons.find(button => button.dataset.sensoryOption === '无')
      || buttons[0];
    if (!target.classList.contains('selected')) {
      target.click();
      await sleep(45);
    }
    return;
  }
}

async function skipNativeToScore(preferences = {}, { hidden = false } = {}) {
  transferBusy = true;
  if (hidden) document.documentElement.classList.add('v095-native-bypass');
  try {
    for (let step = 0; step < 12; step += 1) {
      if ($('#sensoryDeltaWheel')) return;
      const heading = $('.sensory-evaluation h2')?.textContent.trim() || '';
      const groups = [...new Set($$('.sensory-option').map(button => Number(button.dataset.groupIndex)))].sort((a, b) => a - b);
      for (const groupIndex of groups) await chooseNativeOption(groupIndex, preferences[heading]?.[groupIndex] || []);
      const next = await waitFor('#nextSensoryNodeBtn');
      next.click();
      await sleep(70);
    }
    throw new Error('未能进入评分节点');
  } finally {
    transferBusy = false;
    if (!$('#sensoryDeltaWheel')) document.documentElement.classList.remove('v095-native-bypass');
  }
}

function injectProfessionalNote(summary) {
  const apply = () => {
    const note = $('#sensoryNaturalNote');
    const group = note?.closest('.question-group');
    if (!note || !group) return false;
    if (!$('#v095ProfessionalSummary', group)) {
      group.insertAdjacentHTML('afterbegin', `<section id="v095ProfessionalSummary" class="v095-professional-summary"><strong>专业品鉴摘要</strong><pre>${esc(summary)}</pre></section>`);
    }
    if (!note.value.trim()) {
      note.value = `${summary}\n\n札记：`;
      note.dispatchEvent(new Event('input', { bubbles: true }));
      note.focus();
      note.setSelectionRange(note.value.length, note.value.length);
    }
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

function queueSync() {
  if (observerQueued) return;
  observerQueued = true;
  requestAnimationFrame(() => {
    observerQueued = false;
    replaceModePanel();
  });
}

document.addEventListener('DOMContentLoaded', replaceModePanel, { once: true });
new MutationObserver(queueSync).observe(document.documentElement, { childList: true, subtree: true });
queueSync();
