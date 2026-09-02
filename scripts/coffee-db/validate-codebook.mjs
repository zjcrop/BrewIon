#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INDEXED_TABLES = ['countries', 'regions', 'entities', 'varieties', 'processes', 'flavors'];
const ALL_TABLES = [...INDEXED_TABLES, 'relations', 'aliases'];
const MIN_COLS = {
  countries: 5,
  regions: 6,
  varieties: 5,
  processes: 5,
  entities: 7,
  relations: 4,
  aliases: 2,
  flavors: 9,
};

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((x) => x.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function readJson(file) {
  const full = path.resolve(ROOT, file);
  return { full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}

function fail(errors, message) {
  errors.push(message);
}

function validateShape(book, errors) {
  if (!book || typeof book !== 'object' || Array.isArray(book)) {
    fail(errors, 'root must be a JSON object');
    return;
  }
  if (!String(book.version || '').trim()) fail(errors, 'version is required');
  if (!String(book.updatedAt || '').trim()) fail(errors, 'updatedAt is required');

  for (const table of ALL_TABLES) {
    if (!Array.isArray(book[table])) {
      fail(errors, `${table} must be an array`);
      continue;
    }
    book[table].forEach((row, index) => {
      if (!Array.isArray(row) || row.length < MIN_COLS[table]) {
        fail(errors, `${table}[${index}] has fewer than ${MIN_COLS[table]} columns`);
      }
    });
  }
}

function buildCodeIndex(book, errors) {
  const allCodes = new Set();
  const tableCodes = {};
  for (const table of INDEXED_TABLES) {
    const seen = new Set();
    tableCodes[table] = seen;
    for (let i = 0; i < (book[table] || []).length; i += 1) {
      const code = String(book[table][i]?.[0] || '').trim();
      if (!code) {
        fail(errors, `${table}[${i}] code is empty`);
        continue;
      }
      if (seen.has(code)) fail(errors, `${table} duplicate code: ${code}`);
      if (allCodes.has(code)) fail(errors, `code reused across indexed tables: ${code}`);
      seen.add(code);
      allCodes.add(code);
    }
  }
  return { allCodes, tableCodes };
}

function validateReferences(book, indexes, errors, warnings) {
  const countries = indexes.tableCodes.countries || new Set();
  (book.regions || []).forEach((row, i) => {
    if (!countries.has(String(row[1] || ''))) fail(errors, `regions[${i}] references missing country ${row[1]}`);
  });
  (book.entities || []).forEach((row, i) => {
    if (!countries.has(String(row[1] || ''))) fail(errors, `entities[${i}] references missing country ${row[1]}`);
  });

  (book.relations || []).forEach((row, i) => {
    const parent = String(row[0] || '');
    const child = String(row[1] || '');
    if (!indexes.allCodes.has(parent)) fail(errors, `relations[${i}] missing parent code ${parent}`);
    if (!indexes.allCodes.has(child)) fail(errors, `relations[${i}] missing child code ${child}`);
    const confidence = Number(row[3]);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      fail(errors, `relations[${i}] confidence must be 0..1`);
    }
  });

  (book.aliases || []).forEach((row, i) => {
    const target = String(row[0] || '');
    const alias = String(row[1] || '').trim();
    if (!alias) fail(errors, `aliases[${i}] alias is empty`);
    if (!indexes.allCodes.has(target)) warnings.push(`aliases[${i}] target ${target} is not an indexed code (allowed only for a documented reserved module)`);
  });
}

function validateBilingual(book, warnings) {
  const checks = [
    ['countries', 1, 2],
    ['regions', 2, 3],
    ['entities', 3, 4],
    ['varieties', 1, 2],
    ['processes', 1, 2],
    ['flavors', 4, 5],
  ];
  for (const [table, zhCol, enCol] of checks) {
    (book[table] || []).forEach((row, i) => {
      if (!String(row[zhCol] || '').trim() || !String(row[enCol] || '').trim()) {
        warnings.push(`${table}[${i}] is not bilingual (zh/en)`);
      }
    });
  }
}

function validateCompatibility(baseline, candidate, errors) {
  let indexedChanged = false;
  for (const table of INDEXED_TABLES) {
    const base = baseline[table] || [];
    const next = candidate[table] || [];
    if (next.length < base.length) {
      fail(errors, `${table}: candidate has fewer rows than baseline (${next.length} < ${base.length})`);
      continue;
    }
    for (let i = 0; i < base.length; i += 1) {
      const oldCode = String(base[i]?.[0] || '');
      const newCode = String(next[i]?.[0] || '');
      if (oldCode !== newCode) fail(errors, `${table}[${i}] code/order changed: ${oldCode} -> ${newCode}`);
    }
    if (next.length > base.length) indexedChanged = true;
  }
  if (indexedChanged && String(candidate.version) === String(baseline.version)) {
    fail(errors, 'indexed rows were appended but version was not increased');
  }
}

const candidatePath = arg('candidate', 'coffee-qr-codebook/coffee_qr_codebook_v6.json');
const baselinePath = arg('baseline');
const errors = [];
const warnings = [];

const { data: candidate } = readJson(candidatePath);
validateShape(candidate, errors);
const indexes = buildCodeIndex(candidate, errors);
validateReferences(candidate, indexes, errors, warnings);
validateBilingual(candidate, warnings);

if (baselinePath) {
  const { data: baseline } = readJson(baselinePath);
  validateCompatibility(baseline, candidate, errors);
}

const counts = Object.fromEntries(ALL_TABLES.map((table) => [table, Array.isArray(candidate[table]) ? candidate[table].length : 0]));
console.log(JSON.stringify({ candidate: candidatePath, baseline: baselinePath, counts, warnings: warnings.length, errors: errors.length }, null, 2));
for (const warning of warnings) console.warn(`WARN: ${warning}`);
for (const error of errors) console.error(`ERROR: ${error}`);
if (errors.length) process.exit(1);
