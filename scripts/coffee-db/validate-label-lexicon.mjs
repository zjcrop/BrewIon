#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const filePath = path.resolve(ROOT, 'coffee-qr-codebook/coffee_label_lexicon_v1.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const errors = [];

function fail(message) { errors.push(message); }
function normalized(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US'); }

if (data?._format !== 'brewion-coffee-label-lexicon') fail('unexpected _format');
if (!/^\d+\.\d+\.\d+$/.test(String(data?.version || ''))) fail('version must be semantic version');
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data?.updatedAt || ''))) fail('updatedAt must be YYYY-MM-DD');

const languages = new Set(Array.isArray(data?.language) ? data.language : []);
for (const language of ['zh-CN', 'en', 'ja', 'ko']) {
  if (!languages.has(language)) fail(`language must include ${language}`);
}

const requiredFields = [
  'country','region','producer','farm','cooperative','station','lot','species','variety','process',
  'roastLevel','roastDate','productionDate','packDate','bestBefore','expiryDate','harvest','roaster',
  'altitude','flavor','roastColor','weight','grade'
];
for (const field of requiredFields) {
  const record = data?.fields?.[field];
  if (!record || typeof record !== 'object') { fail(`missing field ${field}`); continue; }
  if (!String(record.nameZh || '').trim()) fail(`${field} missing nameZh`);
  if (!String(record.nameEn || '').trim()) fail(`${field} missing nameEn`);
  if (!Array.isArray(record.aliases) || !record.aliases.length) { fail(`${field} aliases must be non-empty`); continue; }
  const seen = new Set();
  for (const alias of record.aliases) {
    const key = normalized(alias);
    if (!key) fail(`${field} contains empty alias`);
    if (seen.has(key)) fail(`${field} contains duplicate alias ${alias}`);
    seen.add(key);
  }
}

for (const groupName of ['species', 'process', 'roastLevel']) {
  const group = data?.valueAliases?.[groupName];
  if (!group || typeof group !== 'object' || Array.isArray(group)) { fail(`valueAliases.${groupName} must be an object`); continue; }
  for (const [key, aliases] of Object.entries(group)) {
    if (!Array.isArray(aliases) || !aliases.length) { fail(`valueAliases.${groupName}.${key} must be non-empty`); continue; }
    const seen = new Set();
    for (const alias of aliases) {
      const normalizedAlias = normalized(alias);
      if (!normalizedAlias) fail(`valueAliases.${groupName}.${key} contains empty alias`);
      if (seen.has(normalizedAlias)) fail(`valueAliases.${groupName}.${key} contains duplicate alias ${alias}`);
      seen.add(normalizedAlias);
    }
  }
}

if (data?.dateRecognition?.storageFormat !== 'YYYY-MM-DD') fail('dateRecognition.storageFormat must remain YYYY-MM-DD');
if (!Array.isArray(data?.dateRecognition?.formats) || !data.dateRecognition.formats.length) fail('dateRecognition.formats must be non-empty');
if (!Array.isArray(data?.harvestRecognition?.formats) || !data.harvestRecognition.formats.length) fail('harvestRecognition.formats must be non-empty');
for (const source of data?.sources || []) {
  if (!/^https:\/\//.test(String(source?.url || ''))) fail(`source URL must use https: ${source?.url || ''}`);
}

console.log(JSON.stringify({
  version: data.version,
  languages: [...languages],
  fields: Object.keys(data.fields || {}).length,
  errors: errors.length
}, null, 2));
for (const error of errors) console.error(`ERROR: ${error}`);
if (errors.length) process.exit(1);
