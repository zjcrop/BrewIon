const UI_KEY = 'luckybean.ui.v094';
const defaultUi = { theme: 'dark', splash: 'red', sensoryMode: 'segmented' };
let ui = loadUi();
let nativeBypass = false;
let observerQueued = false;

function loadUi() {
  try { return { ...defaultUi, ...JSON.parse(localStorage.getItem(UI_KEY) || '{}') }; }
  catch { return { ...defaultUi }; }
}
function saveUi() { localStorage.setItem(UI_KEY, JSON.stringify(ui)); }
function q(selector, root = document) { return root.querySelector(selector); }
function qa(selector, root = document) { return [...root.querySelectorAll(selector)]; }
function clamp(value, min = 0, max = 100) { return Math.min(max, Math.max(min, Number(value) || 0)); }
function sleep(ms = 0) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitFor(selector, timeout = 2500) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const node = q(selector);
    if (node) return node;
    await sleep(25);
  }
  throw new Error(`等待界面元素超时：${selector}`);
}

function themeIcon(theme) {
  return theme === 'light'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15.2A8.5 8.5 0 0 1 8.8 3 8.5 8.5 0 1 0 21 15.2Z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg>';
}
function applyTheme() {
  document.documentElement.dataset.theme = ui.theme;
  const button = q('#themeToggleBtn');
  if (button) {
    button.innerHTML = themeIcon(ui.theme);
    button.setAttribute('aria-label', ui.theme === 'dark' ? '切换到白天模式' : '切换到夜间模式');
    button.title = ui.theme === 'dark' ? '白天模式' : '夜间模式';
  }
  const meta = q('meta[name="theme-color"]');
  if (meta) meta.content = ui.theme === 'dark' ? '#080909' : '#e7e7e3';
}
function bindThemeButton() {
  const button = q('#themeToggleBtn');
  if (!button || button.dataset.v094Bound) return;
  button.dataset.v094Bound = '1';
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    ui.theme = ui.theme === 'dark' ? 'light' : 'dark';
    saveUi();
    applyTheme();
  });
}

const splashSources = {
  red: './public/splash-red.svg?v=094',
  alt: './public/splash-alt.svg?v=094'
};
function applySplash() {
  const image = q('#splashImage') || q('#splashScreen img');
  if (image) image.src = splashSources[ui.splash] || splashSources.red;
}
function injectSplashSetting() {
  const root = q('#settingsContent .settings-categories');
  if (!root || q('#v094AppearanceSettings')) return;
  const details = document.createElement('details');
  details.className = 'settings-category';
  details.id = 'v094AppearanceSettings';
  details.innerHTML = `<summary><span>界面</span><small>启动页和明暗模式</small></summary><div class="settings-category-body">
    <div class="v094-setting-line"><span>界面模式</span><button id="v094ThemeSettingBtn" class="button" type="button">${ui.theme === 'dark' ? '夜间模式' : '白天模式'}</button></div>
    <div class="v094-splash-choice" role="radiogroup" aria-label="启动页图片">
      <button type="button" data-splash-choice="red" class="${ui.splash === 'red' ? 'selected' : ''}"><img src="${splashSources.red}" alt="红色启动页"><span>红色版本（默认）</span></button>
      <button type="button" data-splash-choice="alt" class="${ui.splash === 'alt' ? 'selected' : ''}"><img src="${splashSources.alt}" alt="第二启动页"><span>第二版本</span></button>
    </div>
  </div>`;
  root.prepend(details);
  q('#v094ThemeSettingBtn', details)?.addEventListener('click', () => {
    ui.theme = ui.theme === 'dark' ? 'light' : 'dark';
    saveUi(); applyTheme();
    q('#v094ThemeSettingBtn', details).textContent = ui.theme === 'dark' ? '夜间模式' : '白天模式';
  });
  qa('[data-splash-choice]', details).forEach(button => button.addEventListener('click', () => {
    ui.splash = button.dataset.splashChoice;
    saveUi(); applySplash();
    qa('[data-splash-choice]', details).forEach(item => item.classList.toggle('selected', item === button));
  }));
}

function replaceDynamicText() {
  const title = q('#titleBrew');
  if (title && title.textContent !== '小酌') title.textContent = '小酌';
  const brewNav = q('[data-page-target="brew"] span');
  if (brewNav && brewNav.textContent !== '酌') brewNav.textContent = '酌';
  q('[data-page-target="brew"]')?.setAttribute('aria-label', '小酌：冲煮制作');
  qa('.cup-action').forEach(button => {
    if (button.textContent.trim() === '拾') button.textContent = '酌';
    const label = button.getAttribute('aria-label') || '';
    if (label.includes('拾')) button.setAttribute('aria-label', label.replaceAll('拾', '酌'));
  });
  qa('.empty-state p').forEach(node => {
    node.textContent = node.textContent.replace('“添”', '“添丁”').replace('“寻”', '“搜索”');
  });
  qa('.professional-result > summary').forEach(summary => { if (summary.textContent.trim() !== '专业内容') summary.textContent = '专业内容'; });
}

function fieldByLabel(root, label) {
  return qa('.field', root).find(field => q(':scope > span', field)?.textContent.trim() === label) || null;
}
function restructureBrew() {
  const grid = q('#brewContent .brew-compact-grid');
  if (!grid || grid.dataset.v094Structured) return;
  grid.dataset.v094Structured = '1';
  const dose = fieldByLabel(grid, '粉量');
  const ratio = fieldByLabel(grid, '粉水比');
  const dripper = fieldByLabel(grid, '滤杯');
  const profile = fieldByLabel(grid, '冲煮法');
  const segments = fieldByLabel(grid, '分段方式');
  if (dose && ratio) {
    const row = document.createElement('div'); row.className = 'brew-row two v094-primary-row';
    dose.parentElement.insertBefore(row, dose); row.append(dose, ratio);
  }
  if (dripper) {
    const filterSelect = q('#brewFilterPaper', dripper);
    const row = document.createElement('div'); row.className = 'brew-row two v094-primary-row';
    dripper.parentElement.insertBefore(row, dripper); row.append(dripper);
    if (filterSelect) {
      const filter = document.createElement('label'); filter.className = 'field'; filter.innerHTML = '<span>滤纸</span>';
      filter.append(filterSelect); row.append(filter);
    }
  }
  if (profile && segments && profile.parentElement !== segments.parentElement) {
    const row = document.createElement('div'); row.className = 'brew-row two v094-primary-row';
    profile.parentElement.insertBefore(row, profile); row.append(profile, segments);
  }
  const labels = ['调水方案', '风味设定', '微调', '首段降温', '尾段降温'];
  const fields = labels.map(label => fieldByLabel(grid, label)).filter(Boolean);
  if (fields.length) {
    const details = document.createElement('details'); details.className = 'v094-brew-details';
    details.innerHTML = '<summary>细节设定</summary><div class="v094-brew-details-body"></div>';
    const anchor = q('.brew-generate-row', grid);
    grid.insertBefore(details, anchor || null);
    const body = q('.v094-brew-details-body', details);
    const row = document.createElement('div'); row.className = 'brew-row two'; body.append(row);
    fields.forEach((field, index) => {
      if (index && index % 2 === 0) { const next = document.createElement('div'); next.className = 'brew-row two'; body.append(next); }
      body.lastElementChild.append(field);
    });
  }
  qa('.brew-row', grid).forEach(row => { if (!row.children.length) row.remove(); });
}

function enhancePlan() {
  const trajectory = q('.trajectory-title-row');
  if (trajectory && !trajectory.dataset.v094Enhanced) {
    trajectory.dataset.v094Enhanced = '1';
    q('#trajectoryTitleBtn h3', trajectory)?.insertAdjacentHTML('afterend', '<span class="v094-dropdown-arrow" aria-hidden="true">⌄</span>');
  }
  qa('.professional-result > summary').forEach(summary => {
    summary.textContent = '专业内容';
    summary.classList.add('v094-centered-summary');
  });
}

const aromaOptions = ['花香','果香','茶感','坚果','酵感'];
const phaseFlavorOptions = ['白花','茉莉','玫瑰','橙花','紫罗兰','洋甘菊','柑橘','莓果','桃子','苹果','葡萄','热带水果','干果','茶感','香料','坚果','巧克力','酒香','草本','蜂蜜','蔗糖','红糖','焦糖','柠檬','醋栗'];
const phases = [
  { id:'dry', label:'干香', intensity:false },
  { id:'high', label:'高温', intensity:true },
  { id:'mid', label:'中温', intensity:true },
  { id:'low', label:'低温', intensity:true }
];
function phaseTemplate(phase, selected = [], intensity = 50) {
  return `<section class="v094-phase-card" data-phase-card="${phase.id}"><h3>${phase.label}</h3><p>${phase.id === 'dry' ? '仅标记干香风味，不记录强度。' : '可跳过当前温区，或不标记任何风味直接继续。'}</p>
    <div class="v094-chip-grid">${phaseFlavorOptions.map(item => `<button type="button" data-phase-flavor="${item}" class="${selected.includes(item)?'selected':''}">${item}</button>`).join('')}</div>
    ${phase.intensity ? `<label class="v094-intensity"><span>整体强度</span><input type="range" min="0" max="100" step="5" value="${intensity}" data-phase-intensity><output>${intensity}</output></label>` : ''}
    <div class="v094-phase-actions"><button type="button" data-clear-phase>跳过风味标记</button><button type="button" data-skip-phase>跳过当前温区</button><button type="button" class="primary" data-next-phase>下一项</button></div></section>`;
}
function selectedText(values) { return values.length ? values.join('、') : '未标记'; }

function radarMarkup(id, title, labels, values) {
  const center = 160, radius = 108;
  const points = labels.map((_, i) => {
    const angle = (-90 + i * 360 / labels.length) * Math.PI / 180;
    return { x:center + Math.cos(angle) * radius, y:center + Math.sin(angle) * radius, ux:Math.cos(angle), uy:Math.sin(angle) };
  });
  const grids = [0.25,0.5,0.75,1].map(scale => `<polygon points="${points.map(p=>`${center+(p.x-center)*scale},${center+(p.y-center)*scale}`).join(' ')}"/>`).join('');
  const axes = points.map(p=>`<line x1="${center}" y1="${center}" x2="${p.x}" y2="${p.y}"/>`).join('');
  const labelsSvg = points.map((p,i)=>`<text x="${center+(p.x-center)*1.18}" y="${center+(p.y-center)*1.18}" text-anchor="middle" dominant-baseline="middle">${labels[i]}</text>`).join('');
  return `<section class="v094-radar-editor" data-radar="${id}"><h3>${title}</h3><p>拖拽圆点标定各轴强度。</p><svg viewBox="0 0 320 320" role="group" aria-label="${title}"><g class="grid">${grids}${axes}</g><polygon class="area" points=""></polygon>${labelsSvg}${points.map((p,i)=>`<circle class="handle" data-axis="${i}" cx="${center+p.ux*radius*values[i]/100}" cy="${center+p.uy*radius*values[i]/100}" r="10" tabindex="0" aria-label="${labels[i]} ${values[i]}"></circle>`).join('')}</svg><div class="v094-radar-values">${labels.map((label,i)=>`<label><span>${label}</span><input type="range" min="0" max="100" step="1" value="${values[i]}" data-radar-range="${i}"><output>${values[i]}</output></label>`).join('')}</div></section>`;
}
function bindRadar(root, state, key) {
  const editor = q(`[data-radar="${key}"]`, root); if (!editor) return;
  const svg = q('svg', editor), handles = qa('.handle', editor), area = q('.area', editor), ranges = qa('[data-radar-range]', editor);
  const labels = key === 'aroma' ? aromaOptions : ['风味','余韵','酸质','甜感','醇厚'];
  const center = 160, radius = 108;
  const units = labels.map((_, i) => { const a=(-90+i*360/labels.length)*Math.PI/180; return {x:Math.cos(a),y:Math.sin(a)}; });
  const update = () => {
    const values = state[key];
    handles.forEach((handle,i)=>{
      handle.setAttribute('cx', center + units[i].x * radius * values[i]/100);
      handle.setAttribute('cy', center + units[i].y * radius * values[i]/100);
      handle.setAttribute('aria-label', `${labels[i]} ${Math.round(values[i])}`);
    });
    area.setAttribute('points', values.map((value,i)=>`${center+units[i].x*radius*value/100},${center+units[i].y*radius*value/100}`).join(' '));
    ranges.forEach((range,i)=>{ range.value=values[i]; range.nextElementSibling.textContent=Math.round(values[i]); });
  };
  let active = -1;
  const setFromPointer = event => {
    if (active < 0) return;
    const rect=svg.getBoundingClientRect();
    const x=(event.clientX-rect.left)*320/rect.width-center;
    const y=(event.clientY-rect.top)*320/rect.height-center;
    state[key][active]=clamp((x*units[active].x+y*units[active].y)/radius*100);
    update();
  };
  handles.forEach((handle,i)=>{
    handle.addEventListener('pointerdown', event=>{ active=i; handle.setPointerCapture(event.pointerId); setFromPointer(event); });
    handle.addEventListener('pointermove', setFromPointer);
    handle.addEventListener('pointerup', ()=>{ active=-1; });
    handle.addEventListener('keydown', event=>{
      if (!['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(event.key)) return;
      event.preventDefault(); state[key][i]=clamp(state[key][i]+(['ArrowUp','ArrowRight'].includes(event.key)?5:-5)); update();
    });
  });
  ranges.forEach((range,i)=>range.addEventListener('input',()=>{state[key][i]=Number(range.value);update();}));
  update();
}

function makeSensorySummary(data) {
  const phaseText = phases.map(phase => `${phase.label}：${data.skipped.includes(phase.id) ? '跳过' : selectedText(data.phase[phase.id].flavors)}${phase.intensity && !data.skipped.includes(phase.id) ? `（强度${data.phase[phase.id].intensity}）` : ''}`).join('；');
  const aroma = aromaOptions.map((label,i)=>`${label}${Math.round(data.aroma[i])}`).join('、');
  const styleLabels=['风味','余韵','酸质','甜感','醇厚'];
  const style=styleLabels.map((label,i)=>`${label}${Math.round(data.style[i])}`).join('、');
  return `分段互动：${phaseText}\n香气倾向：${aroma}\n整体风格：${style}\n系统建议分：${data.suggested.toFixed(1)}`;
}
function calculateSuggested(data) {
  const mean = arr => arr.reduce((sum,value)=>sum+value,0)/arr.length;
  const quality = data.style[0]*.25 + data.style[1]*.2 + data.style[2]*.15 + data.style[3]*.2 + data.style[4]*.2;
  const aroma = mean(data.aroma);
  const balance = Math.sqrt(data.style.reduce((sum,v)=>sum+(v-mean(data.style))**2,0)/data.style.length);
  const phaseBonus = ['high','mid','low'].filter(id=>data.phase[id].flavors.length).length * 1.2;
  return clamp(55 + quality*.35 + aroma*.1 - balance*.05 + phaseBonus, 45, 98);
}
function buildNativeAnswerMap(data) {
  const all = [...new Set(phases.flatMap(phase=>data.phase[phase.id].flavors))];
  const floral = all.filter(v=>['白花','茉莉','玫瑰','橙花','紫罗兰','洋甘菊'].includes(v));
  const fruit = all.filter(v=>['柑橘','莓果','桃子','苹果','葡萄','热带水果','干果'].includes(v));
  const other = all.filter(v=>['茶感','香料','坚果','巧克力','酒香','草本'].includes(v));
  const sweet = all.filter(v=>['蜂蜜','蔗糖','红糖','焦糖'].includes(v));
  const acid = all.filter(v=>['柑橘','柠檬','醋栗','苹果','葡萄'].includes(v));
  const avgIntensity = Math.round((data.phase.high.intensity+data.phase.mid.intensity+data.phase.low.intensity)/3);
  const intensity = avgIntensity<25?'低':avgIntensity<70?'中':'强';
  const sweetIntensity = data.style[3]<25?'无':data.style[3]<55?'低':data.style[3]<80?'适中':'高';
  const acidIntensity = data.style[2]<25?'无':data.style[2]<55?'微酸':data.style[2]<80?'圆润舒适':'尖锐';
  const mouthfeel = data.style[4]<25?'轻盈':data.style[4]<55?'顺滑':data.style[4]<80?'圆润':'厚重';
  return {
    花香: [floral.length?floral:['无'], [floral.length?intensity:'无']],
    果香: [fruit.length?fruit:['无'], [fruit.length?intensity:'无']],
    其他: [other.length?other:['无'], [other.length?intensity:'无'], [data.aroma[4]>55?'中':'无'], ['无']],
    甜: [sweet.length?sweet:['蜂蜜'], [sweetIntensity]],
    酸: [acid.length?acid:['柑橘'], [acidIntensity]],
    苦: [[data.style[3]>70?'低':'无']],
    口感: [[mouthfeel]],
    负面: [['无']]
  };
}
async function clickOption(groupIndex, value) {
  for (let attempt=0; attempt<3; attempt++) {
    const button=qa('.sensory-option').find(item=>Number(item.dataset.groupIndex)===groupIndex && item.dataset.sensoryOption===value);
    if (button) { if (!button.classList.contains('selected')) { button.click(); await sleep(35); } return true; }
    await sleep(35);
  }
  return false;
}
async function advanceNativeToScore(data, quick = false) {
  const map = quick ? {
    花香:[['无'],['无']], 果香:[['无'],['无']], 其他:[['无'],['无'],['无'],['无']],
    甜:[['蜂蜜'],['无']], 酸:[['柑橘'],['无']], 苦:[['无']], 口感:[['轻盈']], 负面:[['无']]
  } : buildNativeAnswerMap(data);
  for (let step=0; step<8; step++) {
    const title = (await waitFor('.sensory-evaluation h2')).textContent.trim();
    const groups = map[title] || [];
    for (let groupIndex=0; groupIndex<groups.length; groupIndex++) {
      for (const value of groups[groupIndex]) await clickOption(groupIndex, value);
    }
    const next = await waitFor('#nextSensoryNodeBtn'); next.click(); await sleep(45);
  }
  await waitFor('#sensoryDeltaWheel');
  if (!quick) {
    const auto = Number(q('#sensoryAutoScore')?.textContent || 0);
    const delta = clamp(data.suggested-auto, -10, 10);
    const wheel=q('#sensoryDeltaWheel'); wheel.value=delta.toFixed(1); wheel.dispatchEvent(new Event('input',{bubbles:true}));
    const panel=q('.score-comparison');
    if (panel && !q('.v094-score-summary', panel)) panel.insertAdjacentHTML('beforebegin', `<div class="v094-score-summary"><strong>分段互动建议 ${data.suggested.toFixed(1)}</strong><p>${makeSensorySummary(data).replaceAll('\n','<br>')}</p></div>`);
  }
}
function prefillNote(data) {
  const apply = async () => {
    const note = await waitFor('#sensoryNaturalNote').catch(()=>null); if (!note) return;
    if (!note.value.trim()) { note.value = makeSensorySummary(data); note.dispatchEvent(new Event('input',{bubbles:true})); }
  };
  const watch = new MutationObserver(()=>{ if(q('#sensoryNaturalNote')) { watch.disconnect(); apply(); } });
  watch.observe(q('#sensoryContent') || document.body,{childList:true,subtree:true});
  apply();
}

function openSegmentedWizard(beanId, nativeStartButton) {
  const data = {
    beanId, step:0, skipped:[],
    phase:Object.fromEntries(phases.map(phase=>[phase.id,{flavors:[],intensity:50}])),
    aroma:[50,50,50,50,50], style:[60,60,60,60,60], suggested:0
  };
  const overlay=document.createElement('div'); overlay.className='v094-sensory-overlay'; overlay.innerHTML='<div class="v094-sensory-dialog"></div>'; document.body.append(overlay);
  const dialog=q('.v094-sensory-dialog',overlay);
  const renderPhase=()=>{
    const phase=phases[data.step]; dialog.innerHTML=`<header><button type="button" data-close-v094>×</button><div><small>分段互动 ${data.step+1}/6</small><h2>${phase.label}</h2></div></header>${phaseTemplate(phase,data.phase[phase.id].flavors,data.phase[phase.id].intensity)}`;
    const card=q('[data-phase-card]',dialog);
    qa('[data-phase-flavor]',card).forEach(button=>button.addEventListener('click',()=>{const values=data.phase[phase.id].flavors;const value=button.dataset.phaseFlavor;data.phase[phase.id].flavors=values.includes(value)?values.filter(v=>v!==value):[...values,value];button.classList.toggle('selected');}));
    const range=q('[data-phase-intensity]',card); if(range) range.addEventListener('input',()=>{data.phase[phase.id].intensity=Number(range.value);range.nextElementSibling.textContent=range.value;});
    q('[data-clear-phase]',card).addEventListener('click',()=>{data.phase[phase.id].flavors=[];qa('[data-phase-flavor]',card).forEach(b=>b.classList.remove('selected'));});
    q('[data-skip-phase]',card).addEventListener('click',()=>{if(!data.skipped.includes(phase.id))data.skipped.push(phase.id);data.phase[phase.id].flavors=[];next();});
    q('[data-next-phase]',card).addEventListener('click',next);
    q('[data-close-v094]',dialog).addEventListener('click',()=>overlay.remove());
  };
  const renderRadars=()=>{
    dialog.innerHTML=`<header><button type="button" data-close-v094>×</button><div><small>分段互动 5/6</small><h2>风格标定</h2></div></header><div class="v094-radar-grid">${radarMarkup('aroma','香气倾向',aromaOptions,data.aroma)}${radarMarkup('style','整体风格',['风味','余韵','酸质','甜感','醇厚'],data.style)}</div><div class="v094-wizard-footer"><button type="button" data-back-radar>返回低温</button><button type="button" class="primary" data-review-radar>生成综合判断</button></div>`;
    bindRadar(dialog,data,'aroma'); bindRadar(dialog,data,'style');
    q('[data-close-v094]',dialog).addEventListener('click',()=>overlay.remove());
    q('[data-back-radar]',dialog).addEventListener('click',()=>{data.step=3;renderPhase();});
    q('[data-review-radar]',dialog).addEventListener('click',renderReview);
  };
  const renderReview=()=>{
    data.suggested=calculateSuggested(data);
    dialog.innerHTML=`<header><button type="button" data-close-v094>×</button><div><small>分段互动 6/6</small><h2>综合判断</h2></div></header><div class="v094-review"><strong>${data.suggested.toFixed(1)}</strong><p>${makeSensorySummary(data).replaceAll('\n','<br>')}</p></div><div class="v094-wizard-footer"><button type="button" data-back-review>返回雷达图</button><button type="button" class="primary" data-enter-score>进入打分与札记</button></div>`;
    q('[data-close-v094]',dialog).addEventListener('click',()=>overlay.remove());
    q('[data-back-review]',dialog).addEventListener('click',renderRadars);
    q('[data-enter-score]',dialog).addEventListener('click',async()=>{
      overlay.remove(); nativeBypass=true; nativeStartButton.click(); await sleep(50); nativeBypass=false;
      try { await advanceNativeToScore(data,false); prefillNote(data); }
      catch(error){ console.error(error); showExtensionError('分段结果转入原生打分失败',error); }
    });
  };
  const next=()=>{data.step+=1;if(data.step<4)renderPhase();else renderRadars();};
  renderPhase();
}
function showExtensionError(title,error){
  const box=document.createElement('div');box.className='v094-extension-error';box.innerHTML=`<strong>${title}</strong><p>${String(error?.message||error)}</p><button type="button">关闭</button>`;document.body.append(box);q('button',box).addEventListener('click',()=>box.remove());
}
function injectSensoryModes() {
  const start=q('#startSensoryBtn'); if(!start || q('#v094SensoryModes') || start.dataset.v094Intercepted) return;
  const wrapper=document.createElement('div');wrapper.id='v094SensoryModes';wrapper.className='v094-sensory-modes';wrapper.innerHTML=`<button type="button" data-sensory-mode="segmented" class="${ui.sensoryMode==='segmented'?'selected':''}"><strong>分段互动</strong><span>干香 / 高中低温 / 雷达图 / 札记 / 打分</span></button><button type="button" data-sensory-mode="quick" class="${ui.sensoryMode==='quick'?'selected':''}"><strong>札记 / 打分</strong><span>跳过分段互动，直接进入评分与记录</span></button>`;
  start.closest('.sensory-start-action')?.before(wrapper);
  qa('[data-sensory-mode]',wrapper).forEach(button=>button.addEventListener('click',()=>{ui.sensoryMode=button.dataset.sensoryMode;saveUi();qa('[data-sensory-mode]',wrapper).forEach(item=>item.classList.toggle('selected',item===button));}));
  start.dataset.v094Intercepted='1';
  start.addEventListener('click',async event=>{
    if(nativeBypass)return;
    const beanId=q('#sensoryBeanSelect')?.value;
    if(!beanId)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(ui.sensoryMode==='segmented') openSegmentedWizard(beanId,start);
    else {
      nativeBypass=true;start.click();await sleep(50);nativeBypass=false;
      try{await advanceNativeToScore(null,true);}catch(error){showExtensionError('快速品鉴进入打分失败',error);}
    }
  },true);
}

function ensureEnhancements() {
  observerQueued=false;
  bindThemeButton(); applyTheme(); applySplash(); replaceDynamicText(); injectSplashSetting(); restructureBrew(); enhancePlan(); injectSensoryModes();
}
function queueEnhancements(){if(observerQueued)return;observerQueued=true;requestAnimationFrame(ensureEnhancements);}

applyTheme();
document.addEventListener('DOMContentLoaded',()=>{ensureEnhancements();const observer=new MutationObserver(queueEnhancements);observer.observe(document.body,{childList:true,subtree:true});});
if(document.readyState!=='loading'){ensureEnhancements();const observer=new MutationObserver(queueEnhancements);observer.observe(document.body,{childList:true,subtree:true});}
