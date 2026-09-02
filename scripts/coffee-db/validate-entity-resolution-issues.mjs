#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const core = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'coffee-qr-codebook/coffee_qr_codebook_v6.json'), 'utf8'));
const issues = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'coffee-knowledge/catalog/entity_resolution_issues_v1.json'), 'utf8'));
const errors = [];

function fail(message) { errors.push(message); }
function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[’'`´]/g, '').replace(/[\s\-_/.,;:()\[\]{}&]+/g, '').trim();
}

const cols = core._columns?.entities || [];
const entities = new Map((core.entities || []).map((row, index) => [String(row?.[0] || ''), {
  ...Object.fromEntries(cols.map((name, i) => [name, row[i] ?? null])),
  qrIndex: index + 1
}]));
const expectedCodes = new Set([
  'ST-CN-ZHU@深度研究',
  'ST-CO-JOS@深度研究',
  'ST-CO-MIR@深度研究',
  'ST-CO-DIV@深度研究',
  'ST-PE-HUA@深度研究'
]);
const allowedClasses = new Set(['same_name_identity_ambiguous','source_geography_conflict','likely_taxonomy_misclassification']);
const allowedPolicies = new Set(['require_context','manual_confirmation_required']);

if (issues?._format !== 'coffee-entity-resolution-issues') fail('Unexpected entity resolution issue format.');
if (issues?.policy?.coreMutation !== false) fail('Issue policy must forbid core mutation.');
if (issues?.policy?.qrIndexChanged !== false) fail('Issue policy must preserve QR indexes.');
if (issues?.policy?.defaultConsumerAction !== 'manual_confirmation_required') fail('Default consumer action must be manual_confirmation_required.');

const records = Array.isArray(issues?.issues) ? issues.issues : [];
if (records.length !== 5) fail(`Expected exactly 5 resolution issues, got ${records.length}.`);
const seenIds = new Set();
const seenCodes = new Set();
const classes = { same_name_identity_ambiguous: 0, source_geography_conflict: 0, likely_taxonomy_misclassification: 0 };
for (const record of records) {
  const id = String(record.id || '');
  const code = String(record.coreCode || '');
  if (!id) fail('Resolution issue missing id.');
  if (seenIds.has(id)) fail(`Duplicate resolution issue id ${id}`);
  seenIds.add(id);
  if (!expectedCodes.has(code)) fail(`Unexpected resolution issue coreCode ${code}`);
  if (seenCodes.has(code)) fail(`Duplicate resolution issue coreCode ${code}`);
  seenCodes.add(code);
  const entity = entities.get(code);
  if (!entity) { fail(`${id} references missing core entity ${code}`); continue; }
  if (String(entity.status || '').toLowerCase() !== 'candidate') fail(`${code} must remain candidate in frozen v6 core.`);
  if (/placeholder|generic/i.test(String(entity.entityType || ''))) fail(`${code} must remain an explicitly named non-placeholder candidate.`);
  if (normalize(record.legacyNameEn) !== normalize(entity.nameEn)) fail(`${code} legacyNameEn does not match frozen core.`);
  if (normalize(record.legacyNameZh) !== normalize(entity.nameZh)) fail(`${code} legacyNameZh does not match frozen core.`);
  if (!allowedClasses.has(record.issueClass)) fail(`${code} unsupported issueClass ${record.issueClass}`);
  else classes[record.issueClass]++;
  if (record.blockAutomaticEntityResolution !== true) fail(`${code} must block automatic entity resolution.`);
  if (!allowedPolicies.has(record.automaticRecognitionPolicy)) fail(`${code} unsupported automaticRecognitionPolicy ${record.automaticRecognitionPolicy}`);
  if (!Array.isArray(record.requiredContext) || !record.requiredContext.length) fail(`${code} requires contextual discriminators.`);
  if (record.legacyProvenance?.relationType !== 'country_has_estate_station_from_user_list') fail(`${code} legacy provenance relation type mismatch.`);
  if (record.legacyProvenance?.relationConfidence !== 'low') fail(`${code} legacy provenance must remain low confidence.`);
  if (!Array.isArray(record.sourceUrls) || record.sourceUrls.length < 2) fail(`${code} requires at least two evidence URLs.`);
  for (const url of record.sourceUrls || []) if (!/^https:\/\//.test(String(url))) fail(`${code} has non-HTTPS evidence URL ${url}`);
  if (!String(record.finding || '').trim()) fail(`${code} missing evidence finding.`);
}
for (const code of expectedCodes) if (!seenCodes.has(code)) fail(`Missing resolution issue for ${code}`);
if (classes.same_name_identity_ambiguous !== 3 || classes.source_geography_conflict !== 1 || classes.likely_taxonomy_misclassification !== 1) {
  fail(`Unexpected issue class distribution: ${JSON.stringify(classes)}`);
}

const summary = {
  coreEntities: entities.size,
  resolutionIssues: records.length,
  sameNameAmbiguous: classes.same_name_identity_ambiguous,
  sourceGeographyConflict: classes.source_geography_conflict,
  likelyTaxonomyMisclassification: classes.likely_taxonomy_misclassification,
  blockedAutomaticResolution: records.filter((x) => x.blockAutomaticEntityResolution === true).length,
  coreRowsModified: 0,
  qrIndexesChanged: false,
  errors: errors.length
};
console.log(JSON.stringify(summary, null, 2));
for (const error of errors) console.error(`ERROR: ${error}`);
if (errors.length) process.exit(1);
