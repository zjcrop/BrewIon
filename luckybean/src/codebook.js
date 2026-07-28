import { get, put, activateCodebook } from './db.js';
import { sha256Hex } from './utils.js';

export const REMOTE_CODEBOOK_URL = 'https://raw.githubusercontent.com/zjcrop/BrewIon/main/coffee-qr-codebook/coffee_qr_codebook_v6.json';
export const FALLBACK_CODEBOOK_URL = './public/fallback-codebook.json';

const REQUIRED_TABLES = ['countries', 'regions', 'entities', 'varieties', 'processes', 'flavors'];

export function validateCodebook(book) {
  if (!book || typeof book !== 'object' || Array.isArray(book)) throw new Error('编码表不是对象');
  for (const table of REQUIRED_TABLES) {
    if (!Array.isArray(book[table])) throw new Error(`编码表缺少 ${table}`);
    const seen = new Set();
    for (const row of book[table]) {
      if (!Array.isArray(row) || !row[0]) throw new Error(`${table} 存在无效条目`);
      if (seen.has(row[0])) throw new Error(`${table} 存在重复编码 ${row[0]}`);
      seen.add(row[0]);
    }
  }
  return book;
}

export function makeIndex(book) {
  const index = {};
  for (const table of REQUIRED_TABLES) {
    index[table] = new Map(book[table].map((row, i) => [row[0], { row, index: i + 1 }]));
  }
  index.aliases = new Map();
  for (const table of REQUIRED_TABLES) {
    for (const row of book[table]) {
      const values = row.slice(1).filter(v => typeof v === 'string' && v && !['active', 'candidate'].includes(v));
      for (const value of values) {
        for (const alias of value.split(/[\/、,，;；]/).map(x => x.trim()).filter(Boolean)) {
          const key = alias.toLocaleLowerCase('zh-CN');
          if (!index.aliases.has(key)) index.aliases.set(key, []);
          index.aliases.get(key).push({ table, code: row[0], row });
        }
      }
    }
  }
  return index;
}

export function displayName(index, table, code, fallback = '—') {
  return index?.[table]?.get(code)?.row?.[table === 'entities' ? 3 : 1] || fallback;
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    return { data: JSON.parse(text), text, url };
  } finally { clearTimeout(timer); }
}

export async function loadCodebook() {
  const cached = await get('codebookCache', 'active').catch(() => null);
  if (cached?.data) {
    try { return { data: validateCodebook(cached.data), source: 'cache', meta: cached }; } catch { /* fall through */ }
  }
  const fallback = await fetchJson(FALLBACK_CODEBOOK_URL, 5000);
  const data = validateCodebook(fallback.data);
  const hash = await sha256Hex(fallback.text);
  const record = { id: 'active', data, source: 'embedded', hash, version: String(data.version || '6'), updatedAt: data.updatedAt || '', checkedAt: new Date().toISOString() };
  await put('codebookCache', record).catch(() => {});
  return { data, source: 'embedded', meta: record };
}

export async function checkCodebookUpdate({ force = false } = {}) {
  const remote = await fetchJson(REMOTE_CODEBOOK_URL, force ? 12000 : 8000);
  const data = validateCodebook(remote.data);
  const hash = await sha256Hex(remote.text);
  const active = await get('codebookCache', 'active').catch(() => null);
  if (active?.hash === hash) {
    active.checkedAt = new Date().toISOString();
    active.source = 'remote';
    await put('codebookCache', active);
    return { updated: false, data: active.data, meta: active };
  }
  const candidate = { id: 'candidate', data, source: 'remote', hash, version: String(data.version || data._version || 'unknown'), updatedAt: data.updatedAt || '', checkedAt: new Date().toISOString() };
  await activateCodebook(candidate);
  return { updated: true, data, meta: candidate };
}

export function optionsHtml(rows, selected = '', labelIndex = 1, blank = '请选择') {
  return [`<option value="">${blank}</option>`, ...rows.map(row => `<option value="${row[0]}"${row[0] === selected ? ' selected' : ''}>${row[labelIndex] || row[0]}</option>`)].join('');
}

export function relatedRows(book, table, parentCode) {
  const rows = book[table] || [];
  if (!parentCode) return rows;
  if (table === 'regions') return rows.filter(row => row[1] === parentCode);
  if (table === 'entities') return rows.filter(row => row[1] === parentCode || row[2] === parentCode);
  return rows;
}

export function parseNaturalLanguage(text, book) {
  const source = String(text || '').trim();
  const lower = source.toLocaleLowerCase('zh-CN');
  const result = { confidence: {}, evidence: {}, sourceText: source };
  const tableMap = {
    countries: 'countryCode', regions: 'regionCode', entities: 'entityCode',
    varieties: 'varietyCode', processes: 'processCode'
  };

  for (const [table, field] of Object.entries(tableMap)) {
    let best = null;
    for (const row of book[table] || []) {
      const aliases = row.slice(1).filter(v => typeof v === 'string' && v && !['active', 'candidate'].includes(v));
      for (const alias of aliases.flatMap(v => v.split(/[\/、,，;；]/)).map(v => v.trim()).filter(v => v.length >= 2)) {
        const needle = alias.toLocaleLowerCase('zh-CN');
        if (lower.includes(needle) && (!best || needle.length > best.alias.length)) best = { code: row[0], alias, row };
      }
    }
    if (best) {
      result[field] = best.code;
      result.confidence[field] = Math.min(0.98, 0.62 + best.alias.length / 20);
      result.evidence[field] = best.alias;
    }
  }

  const roastMap = [
    [/极浅|超浅|lightest/i, 'RL-L0'], [/浅中|medium\s*light/i, 'RL-L2'], [/浅烘|浅度|light/i, 'RL-L1'],
    [/中深|medium\s*dark/i, 'RL-L4'], [/中烘|中度|medium/i, 'RL-L3'], [/极深|法式|very\s*dark/i, 'RL-L6'], [/深烘|深度|dark/i, 'RL-L5']
  ];
  for (const [regex, code] of roastMap) if (regex.test(source)) { result.roastCode = code; result.confidence.roastCode = 0.9; result.evidence.roastCode = source.match(regex)?.[0]; break; }

  const date = source.match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
  if (date) {
    result.roastDate = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
    result.confidence.roastDate = 0.98;
    result.evidence.roastDate = date[0];
  }
  const altitude = source.match(/(?:海拔|altitude)?\s*(\d{3,4})\s*(?:m|米)/i);
  if (altitude) { result.altitude = Number(altitude[1]); result.confidence.altitude = 0.95; result.evidence.altitude = altitude[0]; }
  const weight = source.match(/(?:净重|克重|重量)?\s*(\d{2,4}(?:\.\d+)?)\s*(?:g|克)/i);
  if (weight) { result.initialWeight = Number(weight[1]); result.confidence.initialWeight = 0.82; result.evidence.initialWeight = weight[0]; }
  const price = source.match(/(?:价格|售价|购买价)\s*[¥￥]?\s*(\d+(?:\.\d+)?)/);
  if (price) { result.price = Number(price[1]); result.confidence.price = 0.9; result.evidence.price = price[0]; }

  const flavorMatches = [];
  for (const row of book.flavors || []) {
    const aliases = row.slice(1, 4).filter(v => typeof v === 'string');
    if (aliases.some(v => v.length >= 2 && lower.includes(v.toLocaleLowerCase('zh-CN')))) flavorMatches.push(row[0]);
  }
  result.flavorCodes = [...new Set(flavorMatches)].slice(0, 8);
  return result;
}
