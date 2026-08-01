export const APP_VERSION = '0.9.5';
export const SCHEMA_VERSION = 6;

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function uid(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('zh-CN');
}

export function daysBetween(a, b = new Date()) {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
  return Math.floor((db - da) / 86400000);
}

export function debounce(fn, wait = 160) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function downloadBlob(filename, content, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function parseNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  if (!crypto?.subtle) return '';
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function safeJsonParse(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}

export function assertSafeJson(value, path = 'root', depth = 0) {
  if (depth > 20) throw new Error(`${path} 嵌套层级过深`);
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 100000) throw new Error(`${path} 数组过大`);
    value.forEach((item, index) => assertSafeJson(item, `${path}[${index}]`, depth + 1));
    return value;
  }
  if (typeof value !== 'object') throw new Error(`${path} 包含不支持的数据类型`);
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`${path} 包含危险字段 ${key}`);
    assertSafeJson(item, `${path}.${key}`, depth + 1);
  }
  return value;
}

export function assertPlainObject(value, label = '对象') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式无效`);
  for (const key of Object.keys(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`${label}包含危险字段`);
  }
  return value;
}

export function browserTitle(pageTitle) {
  document.title = `${pageTitle} · 富贵盒子`;
}

export function freshnessProfile(bean, now = new Date()) {
  const rawAge = Math.max(0, daysBetween(bean.roastDate, now));
  const roast = bean.roastCode || 'RL-L2';
  const frozen = Boolean(bean.refrigerated);
  const frozenDays = frozen ? Math.max(0, daysBetween(bean.freezeDate || bean.roastDate, now)) : 0;
  const effectiveAge = Math.max(0, rawAge - frozenDays * 0.78);
  const ranges = {
    'RL-L0': [10, 35, 65], 'RL-L1': [8, 30, 55], 'RL-L2': [7, 25, 45],
    'RL-L3': [5, 20, 35], 'RL-L4': [4, 16, 28], 'RL-L5': [3, 12, 22], 'RL-L6': [2, 9, 16]
  };
  let [start, peakEnd, end] = ranges[roast] || ranges['RL-L2'];
  const variety = String(bean.varietyCode || '').toUpperCase();
  const process = String(bean.processCode || '').toUpperCase();
  if (/GE|GESHA|JA58|JA10|JA12|SL28|SL34|PB|SID/.test(variety)) { start += 3; peakEnd += 7; end += 8; }
  if (/NA|ANA|CM|FERM|DF|TS/.test(process)) { peakEnd += 3; end += 5; }
  const peakDay = start + (peakEnd - start) * 0.58;
  const fullDay = end + 7;
  const progress = clamp(0.2 + 0.8 * effectiveAge / Math.max(1, fullDay), 0.2, 1);
  let stage;
  if (effectiveAge < start * .33) stage = 0;
  else if (effectiveAge < start * .67) stage = 1;
  else if (effectiveAge < start) stage = 2;
  else if (effectiveAge < peakDay - 4) stage = 3;
  else if (effectiveAge < peakDay - 1) stage = 4;
  else if (effectiveAge <= peakDay + 2) stage = 5;
  else if (effectiveAge <= peakEnd) stage = 6;
  else if (effectiveAge <= end) stage = 7;
  else if (effectiveAge <= end + 7) stage = 8;
  else stage = 9;
  const colors = ['#ff8a24','#f69a24','#e8b72d','#d5d83b','#8dc75b','#3fa56a','#74a566','#8b9383','#747474','#595959'];
  const labels = ['养豆初期','养豆中','养豆末期','风味上升','接近高峰','赏味高峰','高峰后段','风味衰减','赏味期后','尽快处理'];
  const sigma = Math.max(5, (end - start) / 2.2);
  let flavorScore = 100 * Math.exp(-((effectiveAge - peakDay) ** 2) / (2 * sigma ** 2));
  if (effectiveAge > end) flavorScore *= Math.exp(-(effectiveAge - end) / 22);
  flavorScore = clamp(flavorScore, 0, 100);
  const rising = effectiveAge < peakDay;
  return {
    age: rawAge, effectiveAge, start, peakDay, peakEnd, end, fullDay,
    stage, color: colors[stage], label: labels[stage], progress,
    flavorScore: Math.round(flavorScore), trend: rising ? '上升' : '下降', rising,
    remaining: end - effectiveAge,
    key: stage <= 2 ? 'resting' : stage <= 6 ? 'peak' : stage === 7 ? 'good' : stage === 8 ? 'decline' : 'urgent',
    rank: 10 - stage
  };
}

export function freshness(bean) {
  return freshnessProfile(bean);
}
