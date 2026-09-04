#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const core = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'coffee-qr-codebook/coffee_qr_codebook_v6.json'), 'utf8'));
const seed = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'coffee-knowledge/catalog/localized_aliases_seed_v1.json'), 'utf8'));
const errors = [];
const coreCodes = new Set();
for (const table of ['countries','regions','entities','varieties','processes','flavors']) {
  for (const row of core[table] || []) if (row?.[0]) coreCodes.add(String(row[0]));
}

function fail(message) { errors.push(message); }
function normalize(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US'); }

if (seed?._format !== 'coffee-localized-alias-seed') fail('unexpected _format');
if (!/^\d+\.\d+\.\d+$/.test(String(seed?.version || ''))) fail('version must be semantic version');
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(seed?.updatedAt || ''))) fail('updatedAt must be YYYY-MM-DD');

const rows = Array.isArray(seed?.localizedAliases) ? seed.localizedAliases : [];
if (!rows.length) fail('localizedAliases must be non-empty');
const seen = new Set();
const languageCounts = new Map();
for (const [index, row] of rows.entries()) {
  const code = String(row?.targetCode || '');
  const language = String(row?.language || '');
  const alias = String(row?.alias || '').trim();
  if (!coreCodes.has(code)) fail(`localizedAliases[${index}] missing core target ${code}`);
  if (!['ja','ko'].includes(language)) fail(`localizedAliases[${index}] language must be ja or ko`);
  if (!alias) fail(`localizedAliases[${index}] alias is empty`);
  const confidence = Number(row?.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) fail(`localizedAliases[${index}] confidence must be 0..1`);
  if (String(row?.nameType || '').startsWith('ai_') && !String(row?.reviewStatus || '').startsWith('pending')) {
    fail(`localizedAliases[${index}] AI alias must remain pending review`);
  }
  const key = `${code}|${language}|${normalize(alias)}`;
  if (seen.has(key)) fail(`duplicate localized alias ${key}`);
  seen.add(key);
  languageCounts.set(language, (languageCounts.get(language) || 0) + 1);
}
for (const language of ['ja','ko']) if (!languageCounts.get(language)) fail(`missing ${language} aliases`);

console.log(JSON.stringify({
  version: seed.version,
  aliases: rows.length,
  ja: languageCounts.get('ja') || 0,
  ko: languageCounts.get('ko') || 0,
  errors: errors.length
}, null, 2));
for (const error of errors) console.error(`ERROR: ${error}`);
if (errors.length) process.exit(1);
