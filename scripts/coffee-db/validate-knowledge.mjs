#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const knowledgePath = path.resolve(ROOT, 'coffee-knowledge/coffee_origin_knowledge_v1.json');
const sourcesPath = path.resolve(ROOT, 'coffee-knowledge/source_registry_v1.json');
const corePath = path.resolve(ROOT, 'coffee-qr-codebook/coffee_qr_codebook_v6.json');

const knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
const registry = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
const core = JSON.parse(fs.readFileSync(corePath, 'utf8'));
const errors = [];
const warnings = [];

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function ensureArray(name) {
  if (!Array.isArray(knowledge[name])) fail(`${name} must be an array`);
  return Array.isArray(knowledge[name]) ? knowledge[name] : [];
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
for (const table of ['countries', 'regions', 'entities', 'varieties', 'processes', 'flavors']) {
  for (const row of core[table] || []) if (row?.[0]) coreCodes.add(String(row[0]));
}

const knowledgeIds = new Set();
const idCollections = [
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
for (const name of idCollections) {
  for (const record of ensureArray(name)) {
    if (!record.id) { fail(`${name} record missing id`); continue; }
    if (knowledgeIds.has(record.id)) fail(`duplicate knowledge id ${record.id}`);
    knowledgeIds.add(record.id);
    for (const ref of record.sourceRefs || []) if (!sourceIds.has(ref)) fail(`${record.id} references missing source ${ref}`);
    if (record.coreCode && !coreCodes.has(record.coreCode)) fail(`${record.id} references missing coreCode ${record.coreCode}`);
    if (!validConfidence(record.confidence)) fail(`${record.id} confidence must be 0..1`);
  }
}

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

for (const species of knowledge.species || []) validateNames(species.names, species.id);

for (const name of ['localizedNames', 'localizedAliases']) {
  for (const [index, record] of ensureArray(name).entries()) {
    if (!supported.has(String(record.language || ''))) fail(`${name}[${index}] unsupported language ${record.language}`);
    if (!String(record.name || record.alias || '').trim()) fail(`${name}[${index}] has empty text`);
    const target = record.targetCode || record.targetId;
    if (!target) fail(`${name}[${index}] missing targetCode/targetId`);
    if (record.targetCode && !coreCodes.has(record.targetCode)) fail(`${name}[${index}] missing core target ${record.targetCode}`);
    if (record.targetId && !knowledgeIds.has(record.targetId)) fail(`${name}[${index}] missing knowledge target ${record.targetId}`);
    for (const ref of record.sourceRefs || []) if (!sourceIds.has(ref)) fail(`${name}[${index}] references missing source ${ref}`);
    if (!validConfidence(record.confidence)) fail(`${name}[${index}] confidence must be 0..1`);
  }
}

for (const [index, rel] of ensureArray('varietyLineage').entries()) {
  if (!rel.parentId || !rel.childId) fail(`varietyLineage[${index}] missing parentId/childId`);
  if (rel.parentId && !knowledgeIds.has(rel.parentId) && !coreCodes.has(rel.parentId)) fail(`varietyLineage[${index}] parent ${rel.parentId} is not registered`);
  if (rel.childId && !knowledgeIds.has(rel.childId) && !coreCodes.has(rel.childId)) fail(`varietyLineage[${index}] child ${rel.childId} is not registered`);
  if (!validConfidence(rel.confidence)) fail(`varietyLineage[${index}] confidence must be 0..1`);
}

const fermentationIds = new Set((knowledge.fermentationMethods || []).map((x) => x.id));
const processFamilyIds = new Set((knowledge.processFamilies || []).map((x) => x.id));
for (const [index, record] of ensureArray('processDetails').entries()) {
  if (record.baseProcessId && !processFamilyIds.has(record.baseProcessId)) fail(`processDetails[${index}] missing baseProcessId ${record.baseProcessId}`);
  if (record.fermentationId && !fermentationIds.has(record.fermentationId)) fail(`processDetails[${index}] missing fermentationId ${record.fermentationId}`);
}

for (const [index, rel] of ensureArray('temporalRelations').entries()) {
  if (!rel.subject || !rel.object || !rel.relationType) fail(`temporalRelations[${index}] missing subject/object/relationType`);
  if (!validConfidence(rel.confidence)) fail(`temporalRelations[${index}] confidence must be 0..1`);
}

const summary = {
  species: knowledge.species?.length || 0,
  geoDetails: knowledge.geoDetails?.length || 0,
  entityDetails: knowledge.entityDetails?.length || 0,
  varietyDetails: knowledge.varietyDetails?.length || 0,
  processDetails: knowledge.processDetails?.length || 0,
  processFamilies: knowledge.processFamilies?.length || 0,
  fermentationMethods: knowledge.fermentationMethods?.length || 0,
  sources: registry.sources?.length || 0,
  localizedNames: knowledge.localizedNames?.length || 0,
  localizedAliases: knowledge.localizedAliases?.length || 0,
  warnings: warnings.length,
  errors: errors.length,
};
console.log(JSON.stringify(summary, null, 2));
for (const message of warnings) console.warn(`WARN: ${message}`);
for (const message of errors) console.error(`ERROR: ${message}`);
if (errors.length) process.exit(1);
