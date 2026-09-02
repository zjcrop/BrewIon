#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const core = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'coffee-qr-codebook/coffee_qr_codebook_v6.json'), 'utf8'));
const verified = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'coffee-knowledge/catalog/verified_named_candidate_entities_v2.json'), 'utf8'));
const audit = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'coffee-knowledge/audits/remaining_named_candidate_resolution_v1.json'), 'utf8'));
const errors = [];

function fail(message) { errors.push(message); }
function validHttps(url) { return /^https:\/\//.test(String(url || '')); }
function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[’'`´]/g, '').replace(/[\s\-_/.,;:()\[\]{}&]+/g, '').trim();
}

const cols = core._columns?.entities || [];
const entities = new Map((core.entities || []).map((row, index) => [String(row?.[0] || ''), {
  ...Object.fromEntries(cols.map((name, i) => [name, row[i] ?? null])),
  qrIndex: index + 1
}]));

const expectedReviewed = new Set([
  'ST-BR-PRI@深度研究','ST-CN-ZHU@深度研究','ST-CO-JOS@深度研究','ST-CO-NEG@深度研究','ST-CO-MIR@深度研究',
  'ST-CO-DIV@深度研究','ST-GT-SEN@深度研究','ST-GT-MOR@深度研究','ST-PE-HUA@深度研究'
]);
const expectedVerified = new Set(['ST-BR-PRI@深度研究','ST-CO-NEG@深度研究','ST-GT-SEN@深度研究','ST-GT-MOR@深度研究']);

if (verified?._format !== 'coffee-verified-named-candidate-entities') fail('Unexpected verified v2 format.');
if (verified?.policy?.coreMutation !== false || verified?.policy?.qrIndexChanged !== false || verified?.policy?.coreStatusPromotion !== false) fail('Verified v2 policy must freeze core/QR status.');
const verifiedRecords = Array.isArray(verified?.entityDetails) ? verified.entityDetails : [];
if (verifiedRecords.length !== 4) fail(`Expected 4 verified v2 records, got ${verifiedRecords.length}.`);
const verifiedCodes = new Set();
for (const record of verifiedRecords) {
  const code = String(record.coreCode || '');
  if (!expectedVerified.has(code)) fail(`Unexpected verified coreCode ${code}`);
  if (verifiedCodes.has(code)) fail(`Duplicate verified coreCode ${code}`);
  verifiedCodes.add(code);
  const entity = entities.get(code);
  if (!entity) { fail(`Verified record references missing core entity ${code}`); continue; }
  if (String(entity.status || '').toLowerCase() !== 'candidate') fail(`${code} must remain candidate in frozen v6 core.`);
  if (/placeholder|generic/i.test(String(entity.entityType || ''))) fail(`${code} must be an explicitly named non-placeholder candidate.`);
  if (String(record.countryCode || '') !== String(entity.countryCode || '')) fail(`${code} country mismatch.`);
  if (normalize(record.canonicalNameEn) !== normalize(entity.nameEn)) fail(`${code} canonicalNameEn must match the frozen explicit English name.`);
  if (record.canonicalNameZh) fail(`${code} may not promote Chinese canonical name without source verification.`);
  if (record.legacyNameZh && record.nameZhVerificationStatus !== 'legacy_core_not_source_verified') fail(`${code} legacy Chinese name must remain explicitly unverified.`);
  if (!Array.isArray(record.sourceUrls) || record.sourceUrls.length < 2) fail(`${code} requires at least two evidence URLs in this batch.`);
  for (const url of record.sourceUrls || []) if (!validHttps(url)) fail(`${code} has invalid source URL ${url}`);
  if (!(Number(record.confidence) >= 0.9 && Number(record.confidence) <= 1)) fail(`${code} confidence must be 0.9..1.`);
}
for (const code of expectedVerified) if (!verifiedCodes.has(code)) fail(`Missing verified record ${code}`);

if (audit?._format !== 'coffee-remaining-named-candidate-resolution-audit') fail('Unexpected audit format.');
if (audit?.policy?.coreMutation !== false || audit?.policy?.automaticPromotion !== false) fail('Audit must forbid core mutation and automatic promotion.');
const findings = Array.isArray(audit?.findings) ? audit.findings : [];
if (findings.length !== 9) fail(`Expected 9 audit findings, got ${findings.length}.`);
const findingCodes = new Set();
const computed = { verified: 0, ambiguous: 0, geography: 0, taxonomy: 0, auto: 0 };
for (const finding of findings) {
  const code = String(finding.coreCode || '');
  if (!expectedReviewed.has(code)) fail(`Unexpected audited coreCode ${code}`);
  if (findingCodes.has(code)) fail(`Duplicate audited coreCode ${code}`);
  findingCodes.add(code);
  const entity = entities.get(code);
  if (!entity) { fail(`Audit references missing core entity ${code}`); continue; }
  if (String(entity.status || '').toLowerCase() !== 'candidate') fail(`${code} must remain candidate in v6 core.`);
  if (/placeholder|generic/i.test(String(entity.entityType || ''))) fail(`${code} is not an explicitly named candidate.`);
  if (normalize(finding.nameEn) !== normalize(entity.nameEn)) fail(`${code} audit name does not match core.`);
  if (!Array.isArray(finding.sourceUrls) || !finding.sourceUrls.length) fail(`${code} audit finding requires evidence URLs.`);
  for (const url of finding.sourceUrls || []) if (!validHttps(url)) fail(`${code} audit has invalid source URL ${url}`);
  if (finding.classification === 'verified_entity_existence_matchable') computed.verified++;
  else if (finding.classification === 'same_name_identity_ambiguous') computed.ambiguous++;
  else if (finding.classification === 'source_geography_conflict') computed.geography++;
  else if (finding.classification === 'likely_taxonomy_misclassification') computed.taxonomy++;
  else fail(`${code} has unsupported classification ${finding.classification}`);
  if (finding.materializeKnowledge === true && finding.classification !== 'verified_entity_existence_matchable') fail(`${code} non-verified finding may not materialize knowledge.`);
  if (finding.materializeKnowledge === true && !expectedVerified.has(code)) fail(`${code} materialization not in approved verified set.`);
  if (finding.materializeKnowledge === false && expectedVerified.has(code)) fail(`${code} expected verified finding is not materialized.`);
}
for (const code of expectedReviewed) if (!findingCodes.has(code)) fail(`Missing audit finding ${code}`);
if (computed.verified !== 4 || computed.ambiguous !== 3 || computed.geography !== 1 || computed.taxonomy !== 1) fail(`Unexpected class counts ${JSON.stringify(computed)}`);
if (Number(audit?.summary?.automaticCoreMutations || 0) !== 0) { computed.auto++; fail('Audit summary authorizes core mutations.'); }
if (audit?.summary?.reviewed !== 9 || audit?.summary?.materializedAsVerifiedKnowledge !== 4 || audit?.summary?.sameNameIdentityAmbiguous !== 3 || audit?.summary?.sourceGeographyConflict !== 1 || audit?.summary?.likelyTaxonomyMisclassification !== 1) fail('Audit summary does not match expected evidence classes.');

const summary = {
  reviewedNamedCandidates: findings.length,
  verifiedForKnowledge: computed.verified,
  sameNameAmbiguous: computed.ambiguous,
  sourceGeographyConflict: computed.geography,
  likelyTaxonomyMisclassification: computed.taxonomy,
  v6CoreRowsModified: 0,
  qrIndexesChanged: false,
  errors: errors.length
};
console.log(JSON.stringify(summary, null, 2));
for (const error of errors) console.error(`ERROR: ${error}`);
if (errors.length) process.exit(1);
