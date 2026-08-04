const UI_KEY = 'luckybean.ui.v095';
const LEGACY_UI_KEY = 'luckybean.ui.v094';
const DEFAULT_UI = { theme: 'dark', splash: 'red' };
const SPLASH = {
  red: './public/splash-red.jpg?v=095',
  white: './public/splash-white.jpg?v=095'
};

let ui = loadUi();
let syncQueued = false;
let wizardState = null;

function q(selector, root = document) { return root.querySelector(selector); }
function qa(selector, root = document) { return [...root.querySelectorAll(selector)]; }
function clamp(value, min = 0, max = 100) { return Math.min(max, Math.max(min, Number(value) || 0)); }
function sleep(ms = 0) { return new Promise(resolve => setTimeout(resolve, ms)); }
function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch])); }

function loadUi() {
  try {
    return {
      ...DEFAULT_UI,
      ...JSON.parse(localStorage.getItem(LEGACY_UI_KEY) || '{}'),
      ...JSON.parse(localStorage.getItem(UI_KEY) || '{}')
    };
  } catch {
    return { ...DEFAULT_UI };
  }
}
function saveUi() {
  const value = JSON.stringify(ui);
  try {
    localStorage.setItem(UI_KEY, value);
    localStorage.setItem(LEGACY_UI_KEY, value);
  } catch (error) {
    console.warn('界面偏好无法写入本地存储，当前会话仍继续生效。', error);
  }
}
async function waitFor(selector, timeout = 4000) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    const node = q(selector);
    if (node) return node;
    await sleep(30);
  }
  throw new Error(`等待界面元素超时：${selector}`);
}

function themeIcon(theme) {
  return theme === 'dark'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15.2A8.5 8.5 0 0 1 8.8 3 8.5 8.5 0 1 0 21 15.2Z"/></svg>';
}
function applyTheme() {
  document.documentElement.dataset.theme = ui.theme;
  const button = q('#themeToggleBtn');
  if (button) {
    if (button.dataset.v095ThemeIcon !== ui.theme) {
      button.innerHTML = themeIcon(ui.theme);
      button.dataset.v095ThemeIcon = ui.theme;
    }
    button.setAttribute('aria-label', ui.theme === 'dark' ? '切换到白色模式' : '切换到黑色模式');
    button.title = ui.theme === 'dark' ? '白色模式' : '黑色模式';
  }
  const setting = q('#v095ThemeSettingBtn');
  if (setting) setting.textContent = ui.theme === 'dark' ? '黑色模式' : '白色模式';
  const meta = q('meta[name="theme-color"]');
  if (meta) meta.content = ui.theme === 'dark' ? '#080909' : '#ececea';
}
function toggleTheme() {
  ui.theme = ui.theme === 'dark' ? 'light' : 'dark';
  saveUi();
  applyTheme();
}
function bindThemeButton() {
  const button = q('#themeToggleBtn');
  if (!button) return;
  button.dataset.v095Bound = '1';
  button.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    toggleTheme();
  };
}
function applySplash() {
  const image = q('#splashImage') || q('#splashScreen img');
  if (!image) return;
  image.src = SPLASH[ui.splash] || SPLASH.red;
  image.alt = ui.splash === 'white' ? '富贵盒子白色启动画面' : '富贵盒子红色启动画面';
}

function injectAppearanceSettings() {
  const root = q('#settingsContent .settings-categories');
  if (!root || q('#v095AppearanceSettings')) return;
  q('#v094AppearanceSettings')?.remove();
  const details = document.createElement('details');
  details.className = 'settings-category';
  details.id = 'v095AppearanceSettings';
  details.innerHTML = `<summary><span>界面</span><small>启动页与黑白模式</small></summary>
    <div class="settings-category-body">
      <div class="v095-setting-line"><span>显示模式</span><button id="v095ThemeSettingBtn" class="button" type="button">${ui.theme === 'dark' ? '黑色模式' : '白色模式'}</button></div>
      <div class="v095-splash-choice" role="radiogroup" aria-label="启动页图片">
        <button type="button" data-splash-choice="red" class="${ui.splash === 'red' ? 'selected' : ''}"><img src="${SPLASH.red}" alt="红色启动页"><span>红色版本（默认）</span></button>
        <button type="button" data-splash-choice="white" class="${ui.splash === 'white' ? 'selected' : ''}"><img src="${SPLASH.white}" alt="白色启动页"><span>白色版本</span></button>
      </div>
    </div>`;
  root.prepend(details);
  q('#v095ThemeSettingBtn', details)?.addEventListener('click', toggleTheme);
  qa('[data-splash-choice]', details).forEach(button => button.addEventListener('click', () => {
    ui.splash = button.dataset.splashChoice;
    saveUi();
    applySplash();
    qa('[data-splash-choice]', details).forEach(item => item.classList.toggle('selected', item === button));
  }));
}
function injectSettingsMascot() {
  const container = q('#settingsContent');
  if (!container || q('#v095SettingsMascot')) return;
  const figure = document.createElement('figure');
  figure.id = 'v095SettingsMascot';
  figure.className = 'v095-settings-mascot';
  figure.innerHTML = '<img src="./public/settings-mascot.png?v=095" alt="富贵盒子品牌猫"><figcaption><span>富贵的盒子</span><small>Lucky Bean</small></figcaption>';
  container.append(figure);
}

const TEXT_REPLACEMENTS = [
  ['放入撷吉', '移至溯旧'], ['移入撷吉', '移至溯旧'], ['放入诹吉', '移至溯旧'],
  ['移出诹吉', '移出溯旧'], ['酌一味', '小酌'], ['拾味', '小酌'], ['撷取', '溯旧']
];
function replaceText(root = document.body) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    let next = node.nodeValue;
    for (const [oldText, newText] of TEXT_REPLACEMENTS) next = next.replaceAll(oldText, newText);
    if (next !== node.nodeValue) node.nodeValue = next;
  });
}
function fixStaticLabels() {
  const title = q('#titleBrew');
  if (title) title.textContent = '小酌';
  const nav = q('[data-page-target="brew"]');
  if (nav) {
    q('span', nav)?.replaceChildren(document.createTextNode('酌'));
    nav.setAttribute('aria-label', '小酌：冲煮制作');
  }
  qa('.cup-action').forEach(button => { button.textContent = '酌'; });
  replaceText();
}
function fixBeanCards() {
  qa('.bean-card.compact').forEach(card => {
    const copy = q('.compact-bean-copy', card);
    const heading = q('h3', copy);
    const process = heading?.nextElementSibling;
    if (heading && process?.tagName === 'SMALL' && !process.classList.contains('v095-process-inline')) {
      process.classList.add('v095-process-inline');
      heading.append(process);
    }
    q('.frozen-mark', card)?.classList.add('v095-frozen-inline');
  });
}
function fixBeanDetailActions() {
  qa('.management-stack').forEach(row => row.classList.add('v095-detail-actions'));
}

function fieldFor(control) { return control?.closest('.field'); }
function reflowBrewForm() {
  const grid = q('.brew-form .brew-compact-grid');
  if (!grid || grid.dataset.v095Reflowed) return;
  const dose = q('#brewDose'), ratio = q('#brewRatio'), dripper = q('#brewDripper'), paper = q('#brewFilterPaper');
  const profile = q('#brewProfile'), segments = q('#brewSegments');
  if (!dose || !ratio || !dripper || !paper || !profile || !segments) return;

  const row4 = document.createElement('div');
  row4.className = 'v095-brew-row four-source';
  const doseField = fieldFor(dose), ratioField = fieldFor(ratio), dripperField = fieldFor(dripper);
  const paperField = document.createElement('label');
  paperField.className = 'field';
  paperField.innerHTML = '<span>滤纸</span>';
  paper.classList.remove('sub-control');
  paperField.append(paper);
  [doseField, ratioField, dripperField, paperField].forEach(node => row4.append(node));

  const row2 = document.createElement('div');
  row2.className = 'v095-brew-row two-source';
  [fieldFor(profile), fieldFor(segments)].forEach(node => row2.append(node));

  const detailFields = [q('#brewWaterProfile'), q('#openFlavorTargetBtn'), q('#openBrewTuneBtn'), q('#firstCoolingMode'), q('#tailCoolingMode')]
    .map(fieldFor).filter(Boolean);
  const details = document.createElement('details');
  details.className = 'v095-brew-details';
  details.innerHTML = '<summary>细节设定 <span aria-hidden="true">⌄</span></summary><div class="v095-brew-details-body"></div>';
  detailFields.forEach(node => q('.v095-brew-details-body', details).append(node));

  grid.prepend(details);
  grid.prepend(row2);
  grid.prepend(row4);
  qa('.brew-row', grid).forEach(row => { if (!row.children.length) row.remove(); });
  grid.dataset.v095Reflowed = '1';
}
function fixPlanHeadings() {
  const trajectory = q('#trajectoryTitleBtn');
  if (trajectory && !q('.v095-inline-arrow', trajectory)) trajectory.insertAdjacentHTML('beforeend', '<span class="v095-inline-arrow" aria-hidden="true">⌄</span>');
  const professional = q('.professional-result > summary');
  if (professional && !q('.v095-inline-arrow', professional)) {
    professional.textContent = '专业内容';
    professional.insertAdjacentHTML('beforeend', '<span class="v095-inline-arrow" aria-hidden="true">⌄</span>');
  }
}

const AROMA_AXES = ['花香', '果香', '茶感', '坚果', '酵感'];
const STYLE_AXES = ['风味', '余韵', '酸质', '甜感', '醇厚'];
function freshWizard(mode) {
  return {
    mode,
    step: 0,
    phases: {
      dry: { note: '', intensity: null }, high: { note: '', intensity: null },
      mid: { note: '', intensity: null }, low: { note: '', intensity: null }
    },
    aroma: [5, 5, 5, 5, 5],
    style: [5, 5, 5, 5, 5],
    overall: ''
  };
}
function sensoryModePanel() {
  return `<div class="v095-sensory-modes" aria-label="品鉴模式">
    <button type="button" data-v095-sensory="full"><strong>雷达图 / 互动品鉴 / 札记</strong><small>品鉴全流程</small></button>
    <button type="button" data-v095-sensory="interactive"><strong>互动品鉴 / 札记</strong><small>仅作分段互动 / 札记 / 打分</small></button>
    <button type="button" data-v095-sensory="note"><strong>札记</strong><small>仅作札记 / 打分</small></button>
  </div>`;
}
function injectSensoryModes() {
  const panel = q('#sensoryContent .sensory-start-panel');
  const action = q('.sensory-start-action', panel);
  const native = q('#startSensoryBtn', panel);
  if (!panel || !action || !native || q('.v095-sensory-modes', panel)) return;
  native.classList.add('v095-native-start');
  action.insertAdjacentHTML('beforeend', sensoryModePanel());
  qa('[data-v095-sensory]', action).forEach(button => button.addEventListener('click', async () => {
    const mode = button.dataset.v095Sensory;
    if (mode === 'note') {
      await startNativeSensory();
      await skipNativeToNote();
      return;
    }
    openSegmentedWizard(mode);
  }));
}
async function startNativeSensory() {
  const button = q('#startSensoryBtn');
  if (!button) throw new Error('未找到原生品鉴入口');
  button.click();
  return waitFor('.sensory-evaluation');
}
async function skipNativeToNote() {
  document.documentElement.classList.add('v095-native-bypass');
  try {
    for (let step = 0; step < 12; step += 1) {
      if (q('#sensoryDeltaWheel')) return;
      const next = await waitFor('#nextSensoryNodeBtn');
      next.click();
      await sleep(60);
    }
    throw new Error('未能进入打分节点');
  } finally {
    document.documentElement.classList.remove('v095-native-bypass');
  }
}
function attachNativeSummary(summary = '', suggested = null) {
  const apply = () => {
    const note = q('#sensoryNaturalNote');
    if (note && summary && !note.value.trim()) {
      note.value = summary;
      note.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const wheel = q('#sensoryDeltaWheel');
    const autoText = q('#sensoryAutoScore')?.textContent || '';
    const auto = Number(autoText.match(/[\d.]+/)?.[0]);
    if (wheel && suggested != null && Number.isFinite(auto)) {
      wheel.value = clamp(suggested - auto, -10, 10).toFixed(1);
      wheel.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return Boolean(note) && (suggested == null || Boolean(wheel));
  };
  if (apply()) return;
  const observer = new MutationObserver(() => { if (apply()) observer.disconnect(); });
  observer.observe(q('#sensoryContent') || document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 180000);
}

function openSegmentedWizard(mode) {
  wizardState = freshWizard(mode);
  let root = q('#v095WizardRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'v095WizardRoot';
    document.body.append(root);
  }
  renderWizard();
}
function closeWizard() {
  q('#v095WizardRoot')?.remove();
  wizardState = null;
}
function phaseLabel(key) { return ({ dry: '干香', high: '高温', mid: '中温', low: '低温' })[key]; }
function phaseStep(key, index) {
  const item = wizardState.phases[key];
  return `<section class="v095-wizard-card"><p class="v095-step">${index + 1} / ${wizardState.mode === 'full' ? 5 : 4}</p><h2>${phaseLabel(key)}</h2><p>${key === 'dry' ? '先记录干香；干香不设置强度。' : '记录当前温区风味；允许留空或跳过。'}</p>
    <label class="field"><span>风味与描述</span><textarea id="v095PhaseNote" class="control" rows="5" placeholder="可留空">${esc(item.note)}</textarea></label>
    ${key === 'dry' ? '' : `<div class="v095-intensity"><span>整体强度</span>${['低', '中', '高'].map((value, i) => `<button type="button" data-intensity="${i + 1}" class="${item.intensity === i + 1 ? 'selected' : ''}">${value}</button>`).join('')}</div>`}
  </section>`;
}
function polygonPoints(values, radius = 86, center = 110) {
  return values.map((value, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / values.length;
    const r = radius * clamp(value, 0, 10) / 10;
    return `${(center + Math.cos(angle) * r).toFixed(1)},${(center + Math.sin(angle) * r).toFixed(1)}`;
  }).join(' ');
}
function radarMarkup(id, title, labels, values) {
  const center = 110, radius = 86;
  const rings = [2, 4, 6, 8, 10].map(level => `<polygon points="${polygonPoints(Array(5).fill(level), radius, center)}"></polygon>`).join('');
  const axes = labels.map((label, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / labels.length;
    const x = center + Math.cos(angle) * radius, y = center + Math.sin(angle) * radius;
    const lx = center + Math.cos(angle) * (radius + 18), ly = center + Math.sin(angle) * (radius + 18);
    return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}"></line><text x="${lx}" y="${ly}">${label}</text>`;
  }).join('');
  const handles = values.map((value, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / values.length;
    const r = radius * value / 10;
    return `<circle class="v095-radar-handle" data-radar="${id}" data-index="${index}" cx="${center + Math.cos(angle) * r}" cy="${center + Math.sin(angle) * r}" r="7" tabindex="0"><title>${labels[index]} ${value.toFixed(1)}</title></circle>`;
  }).join('');
  return `<div class="v095-radar"><h3>${title}</h3><svg data-radar-chart="${id}" viewBox="0 0 220 220" role="img" aria-label="${title}可拖拽雷达图"><g class="grid">${rings}${axes}</g><polygon class="value" points="${polygonPoints(values, radius, center)}"></polygon>${handles}</svg><p>${labels.map((label, i) => `<span>${label} ${values[i].toFixed(1)}</span>`).join('')}</p></div>`;
}
function radarStep() {
  return `<section class="v095-wizard-card wide"><p class="v095-step">5 / 5</p><h2>雷达图与综合评分</h2><p>拖拽各轴圆点；建议分为确定性辅助值，仍可在正式打分页调整。</p><div class="v095-radar-grid">${radarMarkup('aroma', '香气倾向', AROMA_AXES, wizardState.aroma)}${radarMarkup('style', '整体风格', STYLE_AXES, wizardState.style)}</div><label class="field"><span>整体描述</span><textarea id="v095Overall" class="control" rows="4" placeholder="可留空">${esc(wizardState.overall)}</textarea></label><div class="v095-suggested-score">建议分 <strong>${suggestedScore().toFixed(1)}</strong></div></section>`;
}
function suggestedScore() {
  const style = wizardState.style.reduce((a, b) => a + b, 0) / 5;
  const aroma = wizardState.aroma.reduce((a, b) => a + b, 0) / 5;
  return clamp(55 + style * 4.5 + aroma * 0.5, 55, 100);
}
function saveWizardInputs() {
  if (!wizardState) return;
  if (wizardState.step < 4) {
    const key = ['dry', 'high', 'mid', 'low'][wizardState.step];
    wizardState.phases[key].note = q('#v095PhaseNote')?.value.trim() || '';
  } else {
    wizardState.overall = q('#v095Overall')?.value.trim() || '';
  }
}
function renderWizard() {
  const root = q('#v095WizardRoot');
  if (!root || !wizardState) return;
  const isRadar = wizardState.mode === 'full' && wizardState.step === 4;
  const key = ['dry', 'high', 'mid', 'low'][wizardState.step];
  root.innerHTML = `<div class="v095-wizard-overlay"><div class="v095-wizard-dialog">${isRadar ? radarStep() : phaseStep(key, wizardState.step)}<div class="v095-wizard-actions"><button id="v095WizardCancel" class="button subtle" type="button">取消</button><button id="v095WizardSkip" class="button" type="button">${isRadar ? '使用当前值' : `跳过${phaseLabel(key)}`}</button><button id="v095WizardNext" class="button primary" type="button">${isRadar || (wizardState.mode !== 'full' && wizardState.step === 3) ? '进入互动品鉴' : '继续'}</button></div></div></div>`;
  q('#v095WizardCancel')?.addEventListener('click', closeWizard);
  qa('[data-intensity]').forEach(button => button.addEventListener('click', () => {
    const phase = wizardState.phases[key];
    phase.intensity = Number(button.dataset.intensity);
    qa('[data-intensity]').forEach(item => item.classList.toggle('selected', item === button));
  }));
  q('#v095WizardSkip')?.addEventListener('click', () => advanceWizard(true));
  q('#v095WizardNext')?.addEventListener('click', () => advanceWizard(false));
  if (isRadar) bindRadarDragging();
}
async function advanceWizard(skip) {
  if (!wizardState) return;
  if (skip && wizardState.step < 4) {
    const key = ['dry', 'high', 'mid', 'low'][wizardState.step];
    wizardState.phases[key] = { note: '', intensity: null };
  } else {
    saveWizardInputs();
  }
  const last = wizardState.mode === 'full' ? wizardState.step === 4 : wizardState.step === 3;
  if (!last) {
    wizardState.step += 1;
    renderWizard();
    return;
  }
  const summary = wizardSummary();
  const score = wizardState.mode === 'full' ? suggestedScore() : null;
  closeWizard();
  await startNativeSensory();
  attachNativeSummary(summary, score);
}
function wizardSummary() {
  const phaseText = Object.entries(wizardState.phases)
    .filter(([, value]) => value.note || value.intensity)
    .map(([key, value]) => `${phaseLabel(key)}：${value.note || '未标记'}${value.intensity ? `（强度${['', '低', '中', '高'][value.intensity]}）` : ''}`);
  if (wizardState.mode === 'full') {
    phaseText.push(`香气倾向：${AROMA_AXES.map((label, i) => `${label}${wizardState.aroma[i].toFixed(1)}`).join('、')}`);
    phaseText.push(`整体风格：${STYLE_AXES.map((label, i) => `${label}${wizardState.style[i].toFixed(1)}`).join('、')}`);
    if (wizardState.overall) phaseText.push(`整体描述：${wizardState.overall}`);
  }
  return phaseText.join('\n');
}
function bindRadarDragging() {
  qa('.v095-radar-handle').forEach(handle => {
    const update = event => {
      const svg = handle.ownerSVGElement;
      const rect = svg.getBoundingClientRect();
      const x = (event.clientX - rect.left) * 220 / rect.width;
      const y = (event.clientY - rect.top) * 220 / rect.height;
      const index = Number(handle.dataset.index);
      const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
      const projection = (x - 110) * Math.cos(angle) + (y - 110) * Math.sin(angle);
      const value = clamp(projection / 86 * 10, 0, 10);
      wizardState[handle.dataset.radar][index] = Math.round(value * 10) / 10;
      renderWizard();
    };
    handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const move = moveEvent => update(moveEvent);
      const end = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
  });
}

function syncUi() {
  applyTheme();
  applySplash();
  bindThemeButton();
  fixStaticLabels();
  fixBeanCards();
  fixBeanDetailActions();
  reflowBrewForm();
  fixPlanHeadings();
  injectAppearanceSettings();
  injectSettingsMascot();
  injectSensoryModes();
}
function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => {
    syncQueued = false;
    syncUi();
  });
}

applyTheme();
applySplash();
document.addEventListener('DOMContentLoaded', syncUi, { once: true });
new MutationObserver(queueSync).observe(document.documentElement, { childList: true, subtree: true });
queueSync();
