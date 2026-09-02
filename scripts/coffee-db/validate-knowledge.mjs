#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const knowledgePath = path.resolve(ROOT, 'coffee-knowledge/coffee_origin_knowledge_v1.json');
const sourcesPath = path.resolve(ROOT, 'coffee-knowledge/source_registry_v1.json');
const corePath = path.resolve(ROOT, 'coffee-qr-codebook/coffee_qr_codebook_v6.json');
const varietyModulePath = path.resolve(ROOT, 'coffee-knowledge/catalog/v6_variety_details_remaining_v1.json');

const knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
const registry = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
const core = JSON.parse(fs.readFileSync(corePath, 'utf8'));
const varietyModule = fs.existsSync(varietyModulePath)
  ? JSON.parse(fs.readFileSync(varietyModulePath, 'utf8'))
  : { species: [], varietyDetails: [], localizedNames: [], localizedAliases: [] };
const errors = [];
const warnings = [];

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function arrayOf(object, name) {
  if (!Array.isArray(object?.[name])) fail(`${name} must be an array`);
  return Array.isArray(object?.[name]) ? object[name] : [];
}
function validConfidence(value) {
  if (value === undefined || value === null || value === '') return true;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1;
}

const supported = new Set(knowledge.languagePolicy?.supportedLanguages || []);
for (const required of ['zh-Hans', 'en']) {
  if (!supported.has(required)) fail(`supportedLanguages must contain ${required}`);
}

const sourceIds = new Set();
for (const source of registry.sources || []) {
  if (!source.id) fail('source missing id');
  if (sourceIds.has(source.id)) fail(`duplicate source id ${source.id}`);
  sourceIds.add(source.id);
  if (!/^https:\/\//.test(String(source.url || ''))) fail(`source ${source.id} must use https`);
  if (!['A', 'B', 'C', 'D'].includes(source.authorityLevel)) fail(`source ${source.id} has invalid authorityLevel`);
}

const coreCodes = new Set();
const coreVarietyCodes = new Set();
for (const table of ['countries', 'regions', 'entities', 'varieties', 'processes', 'flavors']) {
  for (const row of core[table] || []) {
    if (!row?.[0]) continue;
    const code = String(row[0]);
    coreCodes.add(code);
    if (table === 'varieties') coreVarietyCodes.add(code);
  }
}

const knowledgeIds = new Set();
const materializedVarietyCodes = new Set();
const varietyCodeOwners = new Map();

function registerRecord(record, collectionName) {
  if (!record.id) { fail(`${collectionName} record missing id`); return; }
  if (knowledgeIds.has(record.id)) fail(`duplicate knowledge id ${record.id}`);
  knowledgeIds.add(record.id);
  for (const ref of record.sourceRefs || []) if (!sourceIds.has(ref)) fail(`${record.id} references missing source ${ref}`);
  if (record.coreCode && !coreCodes.has(record.coreCode)) fail(`${record.id} references missing coreCode ${record.coreCode}`);
  if (!validConfidence(record.confidence)) fail(`${record.id} confidence must be 0..1`);
  if (collectionName === 'varietyDetails' && record.coreCode) {
    if (varietyCodeOwners.has(record.coreCode)) {
      fail(`variety coreCode ${record.coreCode} materialized more than once: ${varietyCodeOwners.get(record.coreCode)} and ${record.id}`);
    }
    varietyCodeOwners.set(record.coreCode, record.id);
    materializedVarietyCodes.add(record.coreCode);
  }
}

const mainCollections = [
  'species',
  'processFamilies',
  'geoDetails',
  'entityDetails',
  'varietyDetails',
  'processDetails',
  'fermentationMethods',
  'dryingMethods',
  'lots',
];
for (const name of mainCollections) {
  for (const record of arrayOf(knowledge, name)) registerRecord(record, name);
}
for (const record of arrayOf(varietyModule, 'species')) registerRecord(record, 'species');
for (const record of arrayOf(varietyModule, 'varietyDetails')) registerRecord(record, 'varietyDetails');

function validateNames(names, owner) {
  if (!Array.isArray(names)) return;
  const langSet = new Set();
  for (const item of names) {
    const lang = String(item.language || '');
    if (!supported.has(lang)) fail(`${owner} uses unsupported language ${lang}`);
    if (!String(item.name || '').trim()) fail(`${owner} has empty localized name`);
    if (lang) langSet.add(lang);
  }
  if (!langSet.has('zh-Hans') || !langSet.has('en')) warn(`${owner} does not have both zh-Hans and en`);
}

for (const species of [...(knowledge.species || []), ...(varietyModule.species || [])]) validateNames(species.names, species.id);

function validateLocalizedCollection(records, collectionName) {
  for (const [index, record] of records.entries()) {
    if (!supported.has(String(record.language || ''))) fail(`${collectionName}[${index}] unsupported language ${record.language}`);
    if (!String(record.name || record.alias || '').trim()) fail(`${collectionName}[${index}] has empty text`);
    const target = record.targetCode || record.targetId;
    if (!target) fail(`${collectionName}[${index}] missing targetCode/targetId`);
    if (record.targetCode && !coreCodes.has(record.targetCode)) fail(`${collectionName}[${index}] missing core target ${record.targetCode}`);
    if (record.targetId && !knowledgeIds.has(record.targetId)) fail(`${collectionName}[${index}] missing knowledge target ${record.targetId}`);
    for (const ref of record.sourceRefs || []) if (!sourceIds.has(ref)) fail(`${collectionName}[${index}] references missing source ${ref}`);
    if (!validConfidence(record.confidence)) fail(`${collectionName}[${index}] confidence must be 0..1`);
  }
}
validateLocalizedCollection(arrayOf(knowledge, 'localizedNames'), 'localizedNames');
validateLocalizedCollection(arrayOf(knowledge, 'localizedAliases'), 'localizedAliases');
validateLocalizedCollection(arrayOf(varietyModule, 'localizedNames'), 'module.localizedNames');
validateLocalizedCollection(arrayOf(varietyModule, 'localizedAliases'), 'module.localizedAliases');

for (const [index, rel] of arrayOf(knowledge, 'varietyLineage').entries()) {
  if (!rel.parentId || !rel.childId) fail(`varietyLineage[${index}] missing parentId/childId`);
  if (rel.parentId && !knowledgeIds.has(rel.parentId) && !coreCodes.has(rel.parentId)) fail(`varietyLineage[${index}] parent ${rel.parentId} is not registered`);
  if (rel.childId && !knowledgeIds.has(rel.childId) && !coreCodes.has(rel.childId)) fail(`varietyLineage[${index}] child ${rel.childId} is not registered`);
  if (!validConfidence(rel.confidence)) fail(`varietyLineage[${index}] confidence must be 0..1`);
}

const fermentationIds = new Set((knowledge.fermentationMethods || []).map((x) => x.id));
const processFamilyIds = new Set((knowledge.processFamilies || []).map((x) => x.id));
for (const [index, record] of arrayOf(knowledge, 'processDetails').entries()) {
  if (record.baseProcessId && !processFamilyIds.has(record.baseProcessId)) fail(`processDetails[${index}] missing baseProcessId ${record.baseProcessId}`);
  if (record.fermentationId && !fermentationIds.has(record.fermentationId)) fail(`processDetails[${index}] missing fermentationId ${record.fermentationId}`);
}

for (const [index, rel] of arrayOf(knowledge, 'temporalRelations').entries()) {
  if (!rel.subject || !rel.object || !rel.relationType) fail(`temporalRelations[${index}] missing subject/object/relationType`);
  if (!validConfidence(rel.confidence)) fail(`temporalRelations[${index}] confidence must be 0..1`);
}

const missingVarietyCoverage = [...coreVarietyCodes].filter((code) => !materializedVarietyCodes.has(code));
const foreignVarietyCoverage = [...materializedVarietyCodes].filter((code) => !coreVarietyCodes.has(code));
if (missingVarietyCoverage.length) fail(`v6 variety semantic coverage incomplete: missing ${missingVarietyCoverage.join(', ')}`);
if (foreignVarietyCoverage.length) fail(`materialized variety codes are not in v6 core: ${foreignVarietyCoverage.join(', ')}`);

const summary = {
  species: (knowledge.species?.length || 0) + (varietyModule.species?.length || 0),
  geoDetails: knowledge.geoDetails?.length || 0,
  entityDetails: knowledge.entityDetails?.length || 0,
  varietyDetailsMain: knowledge.varietyDetails?.length || 0,
  varietyDetailsModule: varietyModule.varietyDetails?.length || 0,
  varietySemanticCoverage: `${materializedVarietyCodes.size}/${coreVarietyCodes.size}`,
  processDetails: knowledge.processDetails?.length || 0,
  processFamilies: knowledge.processFamilies?.length || 0,
  fermentationMethods: knowledge.fermentationMethods?.length || 0,
  sources: registry.sources?.length || 0,
  localizedNames: (knowledge.localizedNames?.length || 0) + (varietyModule.localizedNames?.length || 0),
  localizedAliases: (knowledge.localizedAliases?.length || 0) + (varietyModule.localizedAliases?.length || 0),
  warnings: warnings.length,
  errors: errors.length,
};
console.log(JSON.stringify(summary, null, 2));
for (const message of warnings) console.warn(`WARN: ${message}`);
for (const message of errors) console.error(`ERROR: ${message}`);
if (errors.length) process.exit(1);
