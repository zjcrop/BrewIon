#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const core = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'coffee-qr-codebook/coffee_qr_codebook_v6.json'), 'utf8'));
const moduleData = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'coffee-knowledge/catalog/verified_named_candidate_entities_v1.json'), 'utf8'));
const errors = [];
const allowedRoles = new Set(['farm','estate','producer','cooperative','factory','washing_station','wet_mill','dry_mill','processor','exporter','trader','research_station']);

const columns = core._columns?.entities || [];
const entities = new Map((core.entities || []).map((row, index) => [String(row?.[0] || ''), {
  ...Object.fromEntries(columns.map((name, i) => [name, row[i] ?? null])),
  qrIndex: index + 1
}]));

function fail(message) { errors.push(message); }
function validConfidence(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1;
}

if (moduleData?._format !== 'coffee-verified-named-candidate-entities') fail('Unexpected module format.');
if (moduleData?.policy?.coreMutation !== false) fail('Module policy must forbid coreMutation.');
if (moduleData?.policy?.qrIndexChanged !== false) fail('Module policy must state qrIndexChanged=false.');
if (moduleData?.policy?.coreStatusPromotion !== false) fail('Module policy must forbid coreStatusPromotion.');

const ids = new Set();
const coreCodes = new Set();
const records = Array.isArray(moduleData?.entityDetails) ? moduleData.entityDetails : [];
if (records.length !== 14) fail(`Expected 14 verified entity records, got ${records.length}.`);

for (const record of records) {
  const id = String(record?.id || '').trim();
  const coreCode = String(record?.coreCode || '').trim();
  if (!id) fail('Entity record missing id.');
  if (ids.has(id)) fail(`Duplicate entity knowledge id ${id}`);
  ids.add(id);
  if (!coreCode) fail(`${id || 'unknown'} missing coreCode.`);
  if (coreCodes.has(coreCode)) fail(`Duplicate entity coreCode ${coreCode}`);
  coreCodes.add(coreCode);
  const coreEntity = entities.get(coreCode);
  if (!coreEntity) { fail(`${id} references missing entity coreCode ${coreCode}`); continue; }
  if (String(record.countryCode || '') !== String(coreEntity.countryCode || '')) fail(`${id} countryCode mismatch for ${coreCode}`);
  if (!String(record.canonicalNameEn || '').trim()) fail(`${id} missing canonicalNameEn`);
  if (record.canonicalNameZh) fail(`${id} must not promote an unverified Chinese canonical name; use legacyNameZh until source-verified.`);
  if (record.legacyNameZh && record.nameZhVerificationStatus !== 'legacy_core_not_source_verified') fail(`${id} legacyNameZh must be explicitly marked unverified.`);
  if (!Array.isArray(record.roles) || !record.roles.length) fail(`${id} requires at least one role.`);
  for (const role of record.roles || []) if (!allowedRoles.has(role)) fail(`${id} has unsupported role ${role}`);
  if (!Array.isArray(record.sourceUrls) || !record.sourceUrls.length) fail(`${id} requires sourceUrls.`);
  for (const url of record.sourceUrls || []) if (!/^https:\/\//.test(String(url))) fail(`${id} source URL must use https: ${url}`);
  if (!validConfidence(record.confidence)) fail(`${id} confidence must be 0..1.`);
  if (!String(record.evidenceStatus || '').trim()) fail(`${id} missing evidenceStatus.`);
  if (!String(record.verificationScope || '').trim()) fail(`${id} missing verificationScope.`);
}

const summary = {
  moduleVersion: String(moduleData.version || ''),
  verifiedEntityRecords: records.length,
  distinctCoreCodes: coreCodes.size,
  coreEntityCount: entities.size,
  coreRowsModified: 0,
  qrIndexesChanged: false,
  errors: errors.length
};
console.log(JSON.stringify(summary, null, 2));
for (const error of errors) console.error(`ERROR: ${error}`);
if (errors.length) process.exit(1);
