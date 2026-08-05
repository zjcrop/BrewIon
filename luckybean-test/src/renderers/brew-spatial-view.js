const COLORS = Object.freeze({
  bg: '#ffffff', path: '#202225', space: 'rgba(188,223,241,.18)', floor: 'rgba(205,230,244,.10)',
  grid: 'rgba(146,153,160,.22)', axis: 'rgba(78,84,91,.50)', text: '#4d5258', startEnd: '#202225'
});
const PALETTES = Object.freeze({
  floral: { start: [218,199,235], end: [244,234,183], label: '#8d6ca1' },
  fruity: { start: [236,174,151], end: [241,207,151], label: '#b67655' },
  sweetness: { start: [232,180,177], end: [237,197,214], label: '#b67586' },
  acidity: { start: [153,201,169], end: [198,218,159], label: '#628c64' },
  bitterness: { start: [145,117,97], end: [187,158,136], label: '#765b49' },
  astringency: { start: [190,193,198], end: [181,198,210], label: '#6c7d89' },
  default: { start: [215,215,209], end: [237,237,230], label: '#757a80' }
});
const DEFAULT_AXES = Object.freeze({
  x: { label: '时间', unit: 's', id: 'time_s' },
  y: { label: '粉床温度', unit: '°C', id: 'bed_temperature_c' },
  z: { label: '累计注水量', unit: 'g', id: 'cumulative_water_g' }
});
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
const lerp = (a, b, t) => a + (b - a) * t;
const mixRgb = (a, b, t) => a.map((value, index) => Math.round(lerp(value, b[index], t)));
const rgba = (rgb, alpha) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
const distance2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function createElement(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function axis(scene, key) {
  const value = scene?.axes?.[key];
  return value && typeof value === 'object' ? { ...DEFAULT_AXES[key], ...value } : DEFAULT_AXES[key];
}
function formatAxis(value, key) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (key === 'y') return number.toFixed(1);
  if (Math.abs(number) >= 100) return String(Math.round(number));
  return number.toFixed(number % 1 === 0 ? 0 : 1);
}
function palette(target) { return PALETTES[target?.id] || PALETTES.default; }
function boundsOf(scene) {
  if (Array.isArray(scene?.bounds?.min) && Array.isArray(scene?.bounds?.max)) return structuredClone(scene.bounds);
  const rows = [...(scene.path || [])];
  for (const target of scene.targets || []) rows.push(...(target.points || []));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of rows) for (let index = 0; index < 3; index += 1) {
    const value = Number(point[index]);
    if (!Number.isFinite(value)) continue;
    min[index] = Math.min(min[index], value);
    max[index] = Math.max(max[index], value);
  }
  min[0] = Math.min(0, min[0]); min[2] = Math.min(0, min[2]);
  for (let index = 0; index < 3; index += 1) if (!Number.isFinite(min[index]) || !Number.isFinite(max[index]) || min[index] === max[index]) { min[index] = 0; max[index] = 1; }
  return { min, max };
}
function normalizeScene(scene) {
  if (!scene || scene.schemaVersion !== 'brew-spatial/1.1' || !Array.isArray(scene.path) || scene.path.length < 2) return null;
  return { ...structuredClone(scene), bounds: boundsOf(scene) };
}

export class BrewSpatialView {
  constructor() {
    this.scene = null;
    this.overlay = null;
    this.canvas = null;
    this.ctx = null;
    this.pointInfo = null;
    this.rotationX = -0.42;
    this.rotationY = 0.70;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.dpr = 1;
    this.pointers = new Map();
    this.lastPinch = 0;
    this.lastCenter = null;
    this.raf = 0;
    this.opened = false;
    this.targetVisuals = [];
    this.pathVisuals = [];
    this.tapCandidate = null;
    this.selection = null;
    this.preview = null;
  }

  setScene(scene) {
    this.scene = normalizeScene(scene);
    this.selection = null;
    this.updateInfo(null);
    this.updateSummary();
    if (this.opened) { this.resize(); this.schedule(); }
    return Boolean(this.scene);
  }

  mountPreview(host, scene) {
    if (!host) return null;
    this.setScene(scene);
    host.querySelector('[data-brew-spatial-preview]')?.remove();
    if (!this.scene) return null;
    const card = createElement('section', 'spatial-analysis-card');
    card.dataset.brewSpatialPreview = 'true';
    const head = createElement('div', 'spatial-analysis-head');
    const title = createElement('div', 'spatial-analysis-title');
    title.append(createElement('h3', '', '风味靶区空间预览'));
    title.append(createElement('p', '', '轻点进入全屏三维视图；单指旋转，双指缩放和平移，路径与靶区均可读取三轴参数。'));
    head.append(title);
    const open = createElement('button', 'spatial-open-btn', '打开全屏三维视图');
    open.type = 'button';
    open.addEventListener('click', () => this.open());
    const summary = createElement('div', 'spatial-summary');
    summary.dataset.spatialPredictionSummary = 'true';
    card.append(head, open, summary);
    host.append(card);
    this.preview = card;
    this.updateSummary();
    return card;
  }

  updateSummary() {
    const node = this.preview?.querySelector('[data-spatial-prediction-summary]');
    if (!node) return;
    const prediction = this.scene?.prediction;
    if (!prediction) { node.textContent = '尚无空间预测结果。'; return; }
    node.innerHTML = '';
    node.append(createElement('div', 'spatial-verdict', prediction.verdict || ''));
    const row = createElement('div', 'spatial-score-row');
    row.append(createElement('span', '', `适配度 ${Math.round((prediction.suitability || 0) * 100)}%`));
    row.append(createElement('span', '', `正负覆盖比 ${Number(prediction.positiveNegativeRatio || 0).toFixed(2)}`));
    row.append(createElement('span', '', `置信度：${prediction.confidence || '实验性'}`));
    node.append(row);
    const notes = [...(prediction.strengths || []), ...(prediction.risks || [])];
    if (notes.length) {
      const list = createElement('ul', 'spatial-note-list');
      notes.forEach(note => list.append(createElement('li', '', String(note))));
      node.append(list);
    }
  }

  ensureOverlay() {
    if (this.overlay?.isConnected) return this.overlay;
    const overlay = createElement('div', 'spatial-fullscreen-overlay');
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', '全屏三维风味靶区视图');
    const header = createElement('div', 'spatial-fullscreen-header');
    const title = createElement('div', 'spatial-fullscreen-title');
    title.append(createElement('strong', '', '三维风味靶区'));
    title.append(createElement('span', '', '单指旋转，双指缩放与平移；轻点路径或靶区查看三轴参数'));
    const reset = createElement('button', 'spatial-reset-btn', '复位视角'); reset.type = 'button'; reset.addEventListener('click', () => this.reset());
    header.append(title, reset);
    const viewport = createElement('div', 'spatial-fullscreen-viewport');
    const canvas = createElement('canvas', 'spatial-canvas');
    canvas.setAttribute('aria-label', 'X时间、Y粉床温度、Z累计注水量三维风味靶区图');
    const legend = createElement('div', 'spatial-axis-legend');
    legend.innerHTML = '<span><b>X</b> 时间 / s</span><span><b>Y</b> 粉床温度 / °C</span><span><b>Z</b> 累计注水量 / g</span>';
    const badge = createElement('div', 'spatial-model-badge', '服务端模型 · 本地实时渲染');
    const info = createElement('div', 'spatial-point-info'); info.hidden = true;
    viewport.append(canvas, legend, badge, info);
    const footer = createElement('div', 'spatial-fullscreen-footer');
    const close = createElement('button', 'spatial-close-btn', '退出全屏'); close.type = 'button'; close.addEventListener('click', () => this.close());
    footer.append(close); overlay.append(header, viewport, footer); document.body.append(overlay);
    this.overlay = overlay; this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false }); this.pointInfo = info;
    this.bindCanvas();
    new ResizeObserver(() => { if (this.opened) this.resize(); }).observe(viewport);
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && this.opened) this.close(); });
    return overlay;
  }

  open() {
    if (!this.scene) return;
    const overlay = this.ensureOverlay(); overlay.hidden = false; this.opened = true;
    document.body.classList.add('spatial-fullscreen-open');
    requestAnimationFrame(() => { this.resize(); this.schedule(); overlay.querySelector('.spatial-close-btn')?.focus({ preventScroll: true }); });
  }
  close() {
    if (!this.overlay) return;
    this.overlay.hidden = true; this.opened = false; this.pointers.clear(); this.lastPinch = 0; this.lastCenter = null; this.selection = null; this.updateInfo(null);
    document.body.classList.remove('spatial-fullscreen-open');
  }
  reset() { this.rotationX = -0.42; this.rotationY = 0.70; this.zoom = 1; this.panX = 0; this.panY = 0; this.schedule(); }
  resize() {
    if (!this.canvas || !this.opened) return;
    const rect = this.canvas.getBoundingClientRect(); if (rect.width <= 0 || rect.height <= 0) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * this.dpr)); const height = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; this.schedule(); }
  }
  pinchDistance() { const values = [...this.pointers.values()]; return values.length < 2 ? 0 : Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y); }
  pinchCenter() { const values = [...this.pointers.values()]; return values.length < 2 ? null : { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 }; }
  bindCanvas() {
    const canvas = this.canvas; canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', event => {
      event.preventDefault(); canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, px: event.clientX, py: event.clientY });
      this.tapCandidate = this.pointers.size === 1 ? { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false } : null;
      if (this.pointers.size === 2) { this.lastPinch = this.pinchDistance(); this.lastCenter = this.pinchCenter(); }
    });
    canvas.addEventListener('pointermove', event => {
      const point = this.pointers.get(event.pointerId); if (!point) return; event.preventDefault();
      point.px = point.x; point.py = point.y; point.x = event.clientX; point.y = event.clientY;
      if (this.tapCandidate && Math.hypot(event.clientX - this.tapCandidate.x, event.clientY - this.tapCandidate.y) > 6) this.tapCandidate.moved = true;
      if (this.pointers.size === 1) { this.rotationY += (point.x - point.px) * 0.012; this.rotationX = clamp(this.rotationX + (point.y - point.py) * 0.009, -1.2, 0.55); }
      else if (this.pointers.size === 2) {
        const distance = this.pinchDistance(); const center = this.pinchCenter();
        if (this.lastPinch > 0) this.zoom = Math.max(0.65, this.zoom * distance / this.lastPinch);
        if (center && this.lastCenter) { this.panX += center.x - this.lastCenter.x; this.panY += center.y - this.lastCenter.y; }
        this.lastPinch = distance; this.lastCenter = center; this.tapCandidate = null;
      }
      this.schedule();
    });
    const release = event => {
      const select = this.tapCandidate && this.tapCandidate.id === event.pointerId && !this.tapCandidate.moved && this.pointers.size === 1;
      this.pointers.delete(event.pointerId); this.lastPinch = this.pointers.size === 2 ? this.pinchDistance() : 0; this.lastCenter = this.pointers.size === 2 ? this.pinchCenter() : null; this.tapCandidate = null;
      if (select) this.selectAt(event.clientX, event.clientY);
    };
    canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', event => { event.preventDefault(); this.zoom = Math.max(0.65, this.zoom * Math.exp(-event.deltaY * 0.001)); this.schedule(); }, { passive: false });
    canvas.addEventListener('dblclick', () => this.reset());
  }

  modelPoint(point) {
    const bounds = this.scene.bounds;
    return {
      x: (Number(point[0]) - bounds.min[0]) / (bounds.max[0] - bounds.min[0]) * 2 - 1,
      y: (Number(point[1]) - bounds.min[1]) / (bounds.max[1] - bounds.min[1]) * 2 - 1,
      z: ((Number(point[2]) - bounds.min[2]) / (bounds.max[2] - bounds.min[2]) * 2 - 1) * 0.58
    };
  }
  rotate(point) {
    const cy = Math.cos(this.rotationY), sy = Math.sin(this.rotationY), cx = Math.cos(this.rotationX), sx = Math.sin(this.rotationX);
    const x = point.x * cy - point.z * sy; let z = point.x * sy + point.z * cy; const y = point.y * cx - z * sx; z = point.y * sx + z * cx;
    return { x, y, z };
  }
  project(point) {
    const rotated = this.rotate(point); const camera = 3.4; const depth = camera - rotated.z; const scale = Math.min(this.canvas.width, this.canvas.height) * 0.38 * this.zoom / depth;
    return { x: this.canvas.width / 2 + this.panX * this.dpr + rotated.x * scale, y: this.canvas.height / 2 + this.panY * this.dpr - rotated.y * scale, z: rotated.z };
  }
  line3(a, b, color, width = 1) {
    const p1 = this.project(a), p2 = this.project(b); this.ctx.strokeStyle = color; this.ctx.lineWidth = width; this.ctx.beginPath(); this.ctx.moveTo(p1.x, p1.y); this.ctx.lineTo(p2.x, p2.y); this.ctx.stroke();
  }
  fillFace(points, color) {
    const projected = points.map(point => this.project(point)); this.ctx.fillStyle = color; this.ctx.beginPath(); projected.forEach((point, index) => index ? this.ctx.lineTo(point.x, point.y) : this.ctx.moveTo(point.x, point.y)); this.ctx.closePath(); this.ctx.fill();
  }
  drawSpace() {
    this.fillFace([{x:-1,y:-1,z:-.58},{x:1,y:-1,z:-.58},{x:1,y:1,z:-.58},{x:-1,y:1,z:-.58}], COLORS.space);
    this.fillFace([{x:-1,y:-1,z:-.58},{x:1,y:-1,z:-.58},{x:1,y:-1,z:.58},{x:-1,y:-1,z:.58}], COLORS.floor);
    for (const value of [-1,-.5,0,.5,1]) {
      this.line3({x:value,y:-1,z:-.58},{x:value,y:1,z:-.58},COLORS.grid);
      this.line3({x:-1,y:value,z:-.58},{x:1,y:value,z:-.58},COLORS.grid);
      this.line3({x:-1,y:-1,z:value*.58},{x:1,y:-1,z:value*.58},COLORS.grid);
      this.line3({x:-1,y:value,z:-.58},{x:-1,y:value,z:.58},COLORS.grid);
    }
    const edges = [[[-1,-1,-.58],[1,-1,-.58]],[[1,-1,-.58],[1,1,-.58]],[[1,1,-.58],[-1,1,-.58]],[[-1,1,-.58],[-1,-1,-.58]],[[-1,-1,.58],[1,-1,.58]],[[1,-1,.58],[1,1,.58]],[[1,1,.58],[-1,1,.58]],[[-1,1,.58],[-1,-1,.58]],[[-1,-1,-.58],[-1,-1,.58]],[[1,-1,-.58],[1,-1,.58]],[[1,1,-.58],[1,1,.58]],[[-1,1,-.58],[-1,1,.58]]];
    edges.forEach(([a,b]) => this.line3({x:a[0],y:a[1],z:a[2]},{x:b[0],y:b[1],z:b[2]},COLORS.axis,1.25));
  }
  targetVisual(target) {
    const raw = (target.points || []).filter(point => Array.isArray(point) && point.length >= 3); if (!raw.length) return null;
    const models = raw.map(point => this.modelPoint(point)); const center = models.reduce((sum, point) => ({x:sum.x+point.x,y:sum.y+point.y,z:sum.z+point.z}), {x:0,y:0,z:0});
    center.x /= models.length; center.y /= models.length; center.z /= models.length;
    const projectedCenter = this.project(center); const points = models.map((point,index) => ({ screen:this.project(point), raw:raw[index] })); let rx=0, ry=0;
    points.forEach(item => { rx=Math.max(rx,Math.abs(item.screen.x-projectedCenter.x)); ry=Math.max(ry,Math.abs(item.screen.y-projectedCenter.y)); });
    return { target, center:projectedCenter, rx:Math.max(rx*.62,16*this.dpr), ry:Math.max(ry*.62,14*this.dpr), palette:palette(target), points };
  }
  drawTargets() {
    const visuals = (this.scene.targets || []).map(target => this.targetVisual(target)).filter(Boolean).sort((a,b)=>a.center.z-b.center.z);
    for (const visual of visuals) {
      const mid = mixRgb(visual.palette.start, visual.palette.end, .48); this.ctx.save(); this.ctx.translate(visual.center.x, visual.center.y); this.ctx.scale(1, visual.ry / visual.rx);
      const gradient = this.ctx.createRadialGradient(-visual.rx*.32,-visual.rx*.30,visual.rx*.08,0,0,visual.rx); gradient.addColorStop(0,rgba(visual.palette.start,.84)); gradient.addColorStop(.55,rgba(mid,.62)); gradient.addColorStop(1,rgba(visual.palette.end,.28));
      this.ctx.fillStyle=gradient; this.ctx.beginPath(); this.ctx.arc(0,0,visual.rx,0,Math.PI*2); this.ctx.fill(); this.ctx.restore();
    }
    this.targetVisuals = visuals; return visuals;
  }
  drawPath() {
    const rows = this.scene.path.map(raw => ({ raw, screen:this.project(this.modelPoint(raw)) })); this.ctx.strokeStyle=COLORS.path; this.ctx.lineWidth=Math.max(3,Math.min(this.canvas.width,this.canvas.height)*.007); this.ctx.lineCap='round'; this.ctx.lineJoin='round';
    this.ctx.beginPath(); this.ctx.moveTo(rows[0].screen.x,rows[0].screen.y);
    for(let index=1;index<rows.length-1;index+=1){const mx=(rows[index].screen.x+rows[index+1].screen.x)/2,my=(rows[index].screen.y+rows[index+1].screen.y)/2;this.ctx.quadraticCurveTo(rows[index].screen.x,rows[index].screen.y,mx,my);} this.ctx.lineTo(rows.at(-1).screen.x,rows.at(-1).screen.y); this.ctx.stroke();
    [rows[0].screen,rows.at(-1).screen].forEach(point=>{this.ctx.fillStyle=COLORS.startEnd;this.ctx.strokeStyle='#fff';this.ctx.lineWidth=2*this.dpr;this.ctx.beginPath();this.ctx.arc(point.x,point.y,5.5*this.dpr,0,Math.PI*2);this.ctx.fill();this.ctx.stroke();});
    this.pathVisuals=rows; return rows;
  }
  drawLabels(visuals, pathRows) {
    this.ctx.font=`${11*this.dpr}px sans-serif`; this.ctx.textAlign='center'; this.ctx.textBaseline='middle';
    for(const visual of visuals){const direction=['astringency','acidity'].includes(visual.target.id)?1:-1;const y=visual.center.y+direction*(visual.ry+9*this.dpr);this.ctx.fillStyle=visual.palette.label;this.ctx.fillText(visual.target.label||visual.target.id,visual.center.x,y);}
    const definitions={x:axis(this.scene,'x'),y:axis(this.scene,'y'),z:axis(this.scene,'z')}; const bounds=this.scene.bounds;
    const axisPoint=(key,t)=>key==='x'?{x:-1+2*t,y:-1,z:-.58}:key==='y'?{x:-1,y:-1+2*t,z:-.58}:{x:-1,y:-1,z:-.58+1.16*t};
    ['x','y','z'].forEach((key,index)=>{const end=this.project(axisPoint(key,1));this.ctx.fillStyle=COLORS.text;this.ctx.font=`600 ${11*this.dpr}px sans-serif`;this.ctx.textAlign=key==='y'?'right':'left';this.ctx.fillText(`${key.toUpperCase()} · ${definitions[key].label} / ${definitions[key].unit}`,end.x+(key==='y'?-8:8)*this.dpr,end.y+(key==='x'?5:-5)*this.dpr);this.ctx.font=`${8.5*this.dpr}px sans-serif`;for(let tick=0;tick<=4;tick+=1){const fraction=tick/4,screen=this.project(axisPoint(key,fraction)),raw=lerp(bounds.min[index],bounds.max[index],fraction);this.ctx.textAlign=key==='x'?'center':key==='y'?'right':'left';this.ctx.fillText(formatAxis(raw,key),screen.x+(key==='y'?-7:key==='z'?7:0)*this.dpr,screen.y+(key==='x'?9:0)*this.dpr);}});
    this.ctx.font=`${10*this.dpr}px sans-serif`;this.ctx.fillStyle=COLORS.text;this.ctx.textAlign='right';this.ctx.fillText('起点',pathRows[0].screen.x-8*this.dpr,pathRows[0].screen.y-8*this.dpr);this.ctx.textAlign='left';this.ctx.fillText('终点',pathRows.at(-1).screen.x+8*this.dpr,pathRows.at(-1).screen.y-8*this.dpr);
  }
  selectAt(clientX,clientY){const rect=this.canvas.getBoundingClientRect(),point={x:(clientX-rect.left)*this.dpr,y:(clientY-rect.top)*this.dpr};let best=null,distance=Infinity;for(const item of this.pathVisuals){const current=distance2(point,item.screen);if(current<distance){distance=current;best={kind:'path',point:item.raw};}}for(const visual of this.targetVisuals){const nx=(point.x-visual.center.x)/Math.max(1,visual.rx),ny=(point.y-visual.center.y)/Math.max(1,visual.ry);if(nx*nx+ny*ny>1.35)continue;for(const item of visual.points){const current=distance2(point,item.screen);if(current<distance){distance=current;best={kind:'target',targetId:visual.target.id,label:visual.target.label,point:item.raw};}}}this.selection=best&&distance<=Math.pow(24*this.dpr,2)?best:null;this.updateInfo(this.selection);this.schedule();}
  updateInfo(selection){if(!this.pointInfo)return;if(!selection){this.pointInfo.hidden=true;this.pointInfo.innerHTML='';return;}const point=selection.point||[];this.pointInfo.innerHTML=`<strong>${selection.kind==='target'?(selection.label||'靶区采样点'):'冲煮路径点'}</strong><span>时间：${formatAxis(point[0],'x')} s</span><span>粉床温度：${formatAxis(point[1],'y')} °C</span><span>累计注水量：${formatAxis(point[2],'z')} g</span>`;this.pointInfo.hidden=false;}
  drawSelection(){if(!this.selection)return;let screen=null;if(this.selection.kind==='path')screen=this.pathVisuals.find(item=>item.raw===this.selection.point)?.screen;else screen=this.targetVisuals.find(item=>item.target.id===this.selection.targetId)?.points.find(item=>item.raw===this.selection.point)?.screen;if(!screen)return;this.ctx.strokeStyle='#202225';this.ctx.fillStyle='rgba(255,255,255,.78)';this.ctx.lineWidth=2*this.dpr;this.ctx.beginPath();this.ctx.arc(screen.x,screen.y,7*this.dpr,0,Math.PI*2);this.ctx.fill();this.ctx.stroke();}
  draw(){this.raf=0;if(!this.opened||!this.ctx||!this.canvas||!this.scene)return;this.ctx.fillStyle=COLORS.bg;this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);this.drawSpace();const visuals=this.drawTargets();const path=this.drawPath();this.drawLabels(visuals,path);this.drawSelection();}
  schedule(){if(!this.raf)this.raf=requestAnimationFrame(()=>this.draw());}
}

export const brewSpatialView = new BrewSpatialView();
