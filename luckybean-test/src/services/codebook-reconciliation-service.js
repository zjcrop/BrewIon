import { openDb } from '../db.js';

const TABLE_ALIASES = Object.freeze({
  country: 'countries', countries: 'countries',
  region: 'regions', regions: 'regions',
  entity: 'entities', entities: 'entities', farm: 'entities', station: 'entities', producer: 'entities',
  variety: 'varieties', varieties: 'varieties',
  process: 'processes', processes: 'processes',
  flavor: 'flavors', flavors: 'flavors'
});
const SCALAR_FIELDS = Object.freeze({
  countries: ['countryCode'],
  regions: ['regionCode'],
  entities: ['entityCode','farmCode','estateCode','stationCode','producerCode','cooperativeCode'],
  varieties: ['varietyCode'],
  processes: ['processCode']
});

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('编码归并数据库请求失败'));
  });
}
function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('编码归并事务失败'));
    tx.onabort = () => reject(tx.error || new Error('编码归并事务已回滚'));
  });
}
function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN')
    .replace(/[‐‑‒–—―−﹣－_]/g, '-')
    .replace(/[\s·•、，,。.;；:：()（）[\]【】'"`]/g, '')
    .trim();
}
function customTable(record) { return TABLE_ALIASES[String(record.table || record.type || record.category || '').toLowerCase()] || ''; }
function customNames(record) {
  return [...new Set([
    record.name, record.label, record.value, record.zh, record.en,
    ...(Array.isArray(record.aliases) ? record.aliases : [])
  ].map(normalize).filter(Boolean))];
}
function officialNames(row) {
  return [...new Set((row || []).slice(1).filter(value => typeof value === 'string' && !['active','candidate','deprecated'].includes(value)).flatMap(value => value.split(/[\/、,，;；|]/)).map(normalize).filter(Boolean))];
}
function parentCompatible(table, record, row) {
  const country = record.countryCode || record.parentCountryCode || '';
  const region = record.regionCode || record.parentRegionCode || '';
  if (table === 'regions' && country && row[1] && country !== row[1]) return false;
  if (table === 'entities') {
    if (country && row[1] && country !== row[1]) return false;
    if (region && row[2] && region !== row[2]) return false;
  }
  return true;
}
function buildOfficialIndex(codebook) {
  const index = {};
  for (const table of Object.values(TABLE_ALIASES)) {
    if (index[table]) continue;
    index[table] = new Map();
    for (const row of codebook?.[table] || []) {
      for (const name of officialNames(row)) {
        if (!index[table].has(name)) index[table].set(name, []);
        index[table].get(name).push(row);
      }
    }
  }
  return index;
}
function candidatesFor(record, codebook, index) {
  const table = customTable(record);
  if (!table) return { table: '', rows: [] };
  const rows = new Map();
  for (const name of customNames(record)) for (const row of index[table].get(name) || []) {
    if (parentCompatible(table, record, row)) rows.set(row[0], row);
  }
  return { table, rows: [...rows.values()] };
}
function replaceBeanCodes(bean, table, oldCode, newCode) {
  let changed = false;
  const next = structuredClone(bean);
  for (const field of SCALAR_FIELDS[table] || []) if (next[field] === oldCode) { next[field] = newCode; changed = true; }
  if (table === 'flavors' && Array.isArray(next.flavorCodes) && next.flavorCodes.includes(oldCode)) {
    next.flavorCodes = [...new Set(next.flavorCodes.map(code => code === oldCode ? newCode : code))]; changed = true;
  }
  if (changed) {
    next.codeMigrations = [...(next.codeMigrations || []), { from: oldCode, to: newCode, source: 'brewion-reconciliation', at: new Date().toISOString() }];
    next.updatedAt = new Date().toISOString();
  }
  return { changed, bean: next };
}

export async function reconcileCustomCodes(codebook, { automatic = true } = {}) {
  if (!codebook || typeof codebook !== 'object') throw new Error('缺少BrewIon正式编码表');
  const db = await openDb();
  const readTx = db.transaction(['customCodes','beans'], 'readonly');
  const customs = await requestValue(readTx.objectStore('customCodes').getAll());
  const beans = await requestValue(readTx.objectStore('beans').getAll());
  const index = buildOfficialIndex(codebook);
  const decisions = [];
  for (const record of customs) {
    if (record.status === 'merged_to_official') continue;
    const { table, rows } = candidatesFor(record, codebook, index);
    if (!table || !rows.length) decisions.push({ record, table, status: 'custom_active', candidates: [] });
    else if (rows.length === 1 && automatic) decisions.push({ record, table, status: 'merged_to_official', official: rows[0] });
    else decisions.push({ record, table, status: rows.length === 1 ? 'custom_matched' : 'custom_conflict', candidates: rows });
  }
  const tx = db.transaction(['customCodes','beans','syncMetadata'], 'readwrite');
  const customStore = tx.objectStore('customCodes');
  const beanStore = tx.objectStore('beans');
  const metadata = tx.objectStore('syncMetadata');
  let merged = 0, pending = 0, changedBeans = 0;
  const mappings = [];
  for (const decision of decisions) {
    const record = decision.record;
    if (decision.status !== 'merged_to_official') {
      customStore.put({ ...record, status: decision.status, officialCandidates: (decision.candidates || []).map(row => row[0]), checkedAt: new Date().toISOString() });
      if (decision.status !== 'custom_active') pending += 1;
      continue;
    }
    const newCode = decision.official[0];
    const oldCode = record.code;
    for (const bean of beans) {
      const result = replaceBeanCodes(bean, decision.table, oldCode, newCode);
      if (result.changed) { beanStore.put(result.bean); changedBeans += 1; }
    }
    const mapping = { oldCode, newCode, table: decision.table, at: new Date().toISOString(), reason: 'unique-normalized-name-and-parent-match' };
    mappings.push(mapping);
    customStore.put({ ...record, status: 'merged_to_official', mergedTo: newCode, mergedAt: mapping.at, preservedAliases: [...new Set([...(record.aliases || []), record.name, record.label].filter(Boolean))] });
    merged += 1;
  }
  metadata.put({ id: 'codebook.reconciliation.latest', merged, pending, changedBeans, mappings, checkedAt: new Date().toISOString() });
  await done(tx);
  document.dispatchEvent(new CustomEvent('luckybean:codebook-reconciled', { detail: { merged, pending, changedBeans, mappings } }));
  return { merged, pending, changedBeans, mappings };
}

export async function confirmCustomCodeMerge(oldCode, newCode, table, codebook) {
  const row = (codebook?.[table] || []).find(item => item[0] === newCode);
  if (!row) throw new Error('指定的正式编码不存在');
  const db = await openDb();
  const readTx = db.transaction(['customCodes','beans'], 'readonly');
  const record = await requestValue(readTx.objectStore('customCodes').get(oldCode));
  const beans = await requestValue(readTx.objectStore('beans').getAll());
  if (!record) throw new Error('本地自定义编码不存在');
  const tx = db.transaction(['customCodes','beans','syncMetadata'], 'readwrite');
  const at = new Date().toISOString();
  tx.objectStore('customCodes').put({ ...record, status: 'merged_to_official', mergedTo: newCode, mergedAt: at, mergeConfirmedByUser: true });
  let changedBeans = 0;
  for (const bean of beans) { const result = replaceBeanCodes(bean, table, oldCode, newCode); if (result.changed) { tx.objectStore('beans').put(result.bean); changedBeans += 1; } }
  tx.objectStore('syncMetadata').put({ id: `codebook.mapping.${oldCode}`, oldCode, newCode, table, at, confirmed: true });
  await done(tx);
  return { oldCode, newCode, table, changedBeans };
}
