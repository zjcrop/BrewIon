#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const manifestPath = path.resolve(ROOT, 'coffee-knowledge/knowledge-manifest_v1.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const knowledgeDir = path.dirname(manifestPath);
const knowledge = JSON.parse(fs.readFileSync(path.resolve(knowledgeDir, manifest.mainKnowledge), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.resolve(knowledgeDir, manifest.sourceRegistry), 'utf8'));
const core = JSON.parse(fs.readFileSync(path.resolve(knowledgeDir, manifest.coreCodebook), 'utf8'));
const catalogModules = (manifest.catalogModules || []).map((modulePath) => ({ modulePath, data: JSON.parse(fs.readFileSync(path.resolve(knowledgeDir, modulePath), 'utf8')) }));
const entityIdentity = manifest.entityIdentityModule ? JSON.parse(fs.readFileSync(path.resolve(knowledgeDir, manifest.entityIdentityModule), 'utf8')) : { groups: [] };
const geoIdentity = manifest.geoIdentityModule ? JSON.parse(fs.readFileSync(path.resolve(knowledgeDir, manifest.geoIdentityModule), 'utf8')) : { identityGroups: [], hierarchyCorrections: [] };
const errors = [];
const warnings = [];

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function arrayOf(object, name, label = name) {
  if (!Array.isArray(object?.[name])) fail(`${label} must be an array`);
  return Array.isArray(object?.[name]) ? object[name] : [];
}
function validConfidence(value) {
  if (value === undefined || value === null || value === '') return true;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1;
}

const supported = new Set(knowledge.languagePolicy?.supportedLanguages || []);
for (const required of ['zh-Hans', 'en']) if (!supported.has(required)) fail(`supportedLanguages must contain ${required}`);

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
const coreEntityByCode = new Map();
const coreRegionByCode = new Map();
const coreCountryCodes = new Set();
for (const table of ['countries', 'regions', 'entities', 'varieties', 'processes', 'flavors']) {
  for (const row of core[table] || []) {
    if (!row?.[0]) continue;
    const code = String(row[0]);
    coreCodes.add(code);
    if (table === 'countries') coreCountryCodes.add(code);
    if (table === 'varieties') coreVarietyCodes.add(code);
    if (table === 'entities') coreEntityByCode.set(code, { countryCode: String(row[1] || ''), entityType: String(row[2] || '') });
    if (table === 'regions') coreRegionByCode.set(code, { countryCode: String(row[1] || '') });
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
    if (varietyCodeOwners.has(record.coreCode)) fail(`variety coreCode ${record.coreCode} materialized more than once: ${varietyCodeOwners.get(record.coreCode)} and ${record.id}`);
    varietyCodeOwners.set(record.coreCode, record.id);
    materializedVarietyCodes.add(record.coreCode);
  }
}

for (const name of ['species','processFamilies','geoDetails','entityDetails','varietyDetails','processDetails','fermentationMethods','dryingMethods','lots']) {
  for (const record of arrayOf(knowledge, name)) registerRecord(record, name);
}
for (const module of catalogModules) {
  for (const record of arrayOf(module.data, 'species', `${module.modulePath}.species`)) registerRecord(record, 'species');
  for (const record of arrayOf(module.data, 'varietyDetails', `${module.modulePath}.varietyDetails`)) registerRecord(record, 'varietyDetails');
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
for (const module of catalogModules) for (const species of module.data.species || []) validateNames(species.names, species.id);

function validateLocalizedCollection(records, collectionName) {
  for (const [index, record] of records.entries()) {
    if (!supported.has(String(record.language || ''))) fail(`${collectionName}[${index}] unsupported language ${record.language}`);
    if (!String(record.name || record.alias || '').trim()) fail(`${collectionName}[${index}] has empty text`);
    if (!record.targetCode && !record.targetId) fail(`${collectionName}[${index}] missing targetCode/targetId`);
    if (record.targetCode && !coreCodes.has(record.targetCode)) fail(`${collectionName}[${index}] missing core target ${record.targetCode}`);
    if (record.targetId && !knowledgeIds.has(record.targetId)) fail(`${collectionName}[${index}] missing knowledge target ${record.targetId}`);
    for (const ref of record.sourceRefs || []) if (!sourceIds.has(ref)) fail(`${collectionName}[${index}] references missing source ${ref}`);
    if (!validConfidence(record.confidence)) fail(`${collectionName}[${index}] confidence must be 0..1`);
    if (['ai_translated','ai_transliterated'].includes(record.nameType) && !String(record.reviewStatus || '').startsWith('pending')) fail(`${collectionName}[${index}] AI-generated alias must remain pending review`);
  }
}
validateLocalizedCollection(arrayOf(knowledge, 'localizedNames'), 'localizedNames');
validateLocalizedCollection(arrayOf(knowledge, 'localizedAliases'), 'localizedAliases');
for (const module of catalogModules) {
  validateLocalizedCollection(arrayOf(module.data, 'localizedNames', `${module.modulePath}.localizedNames`), `${module.modulePath}.localizedNames`);
  validateLocalizedCollection(arrayOf(module.data, 'localizedAliases', `${module.modulePath}.localizedAliases`), `${module.modulePath}.localizedAliases`);
}

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

const identityIds = new Set();
const identityCodeOwners = new Map();
for (const [index, group] of arrayOf(entityIdentity, 'groups').entries()) {
  const id = String(group.canonicalIdentityId || '').trim();
  if (!id) { fail(`entityIdentity.groups[${index}] missing canonicalIdentityId`); continue; }
  if (identityIds.has(id)) fail(`duplicate canonicalIdentityId ${id}`);
  identityIds.add(id);
  if (!String(group.canonicalNameZh || '').trim() || !String(group.canonicalNameEn || '').trim()) fail(`${id} must have zh/en canonical names`);
  if (!validConfidence(group.confidence)) fail(`${id} confidence must be 0..1`);
  if (!Array.isArray(group.sourceUrls) || group.sourceUrls.length < 1) fail(`${id} requires at least one sourceUrl`);
  for (const url of group.sourceUrls || []) if (!/^https:\/\//.test(String(url))) fail(`${id} sourceUrl must use https: ${url}`);
  if (!Array.isArray(group.coreCodes) || group.coreCodes.length < 2) fail(`${id} must contain at least two coreCodes`);
  for (const coreCode of group.coreCodes || []) {
    const entity = coreEntityByCode.get(coreCode);
    if (!entity) { fail(`${id} references non-entity or missing coreCode ${coreCode}`); continue; }
    if (group.countryCode && group.countryCode !== entity.countryCode) fail(`${id} country mismatch for ${coreCode}`);
    if (identityCodeOwners.has(coreCode)) fail(`${coreCode} assigned to multiple canonical identity groups`);
    identityCodeOwners.set(coreCode, id);
  }
}

const geoIdentityIds = new Set();
const geoCodeOwners = new Map();
for (const [index, group] of arrayOf(geoIdentity, 'identityGroups').entries()) {
  const id = String(group.canonicalGeoIdentityId || '').trim();
  if (!id) { fail(`geoIdentity.identityGroups[${index}] missing canonicalGeoIdentityId`); continue; }
  if (geoIdentityIds.has(id)) fail(`duplicate canonicalGeoIdentityId ${id}`);
  geoIdentityIds.add(id);
  if (!String(group.canonicalNameZh || '').trim() || !String(group.canonicalNameEn || '').trim()) fail(`${id} must have zh/en canonical names`);
  if (!Array.isArray(group.sourceUrls) || group.sourceUrls.length < 1) fail(`${id} requires at least one sourceUrl`);
  if (!validConfidence(group.confidence)) fail(`${id} confidence must be 0..1`);
  for (const coreCode of group.coreCodes || []) {
    const region = coreRegionByCode.get(coreCode);
    if (!region) { fail(`${id} references non-region or missing coreCode ${coreCode}`); continue; }
    if (group.countryCode && group.countryCode !== region.countryCode) fail(`${id} country mismatch for ${coreCode}`);
    if (geoCodeOwners.has(coreCode)) fail(`${coreCode} assigned to multiple canonical geo identity groups`);
    geoCodeOwners.set(coreCode, id);
  }
}
const correctionCodes = new Set();
for (const [index, correction] of arrayOf(geoIdentity, 'hierarchyCorrections').entries()) {
  if (!correction.id) fail(`geoIdentity.hierarchyCorrections[${index}] missing id`);
  if (!coreCountryCodes.has(String(correction.coreCode || ''))) fail(`${correction.id || index} must target a core country code`);
  if (correctionCodes.has(correction.coreCode)) fail(`duplicate hierarchy correction for ${correction.coreCode}`);
  correctionCodes.add(correction.coreCode);
  if (!String(correction.canonicalNameZh || '').trim() || !String(correction.canonicalNameEn || '').trim()) fail(`${correction.id} must have zh/en canonical names`);
  if (!Array.isArray(correction.sourceUrls) || correction.sourceUrls.length < 1) fail(`${correction.id} requires sourceUrls`);
  for (const child of correction.childGeoNodes || []) if (child.parentCoreCode !== correction.coreCode) fail(`${correction.id} child ${child.id} parentCoreCode mismatch`);
}

const missingVarietyCoverage = [...coreVarietyCodes].filter((code) => !materializedVarietyCodes.has(code));
if (missingVarietyCoverage.length) fail(`v6 variety semantic coverage incomplete: missing ${missingVarietyCoverage.join(', ')}`);

const localizedNamesCount = (knowledge.localizedNames?.length || 0) + catalogModules.reduce((n,m)=>n+(m.data.localizedNames?.length||0),0);
const localizedAliasesCount = (knowledge.localizedAliases?.length || 0) + catalogModules.reduce((n,m)=>n+(m.data.localizedAliases?.length||0),0);
const summary = {
  species: knowledgeIds.size,
  varietySemanticCoverage: `${materializedVarietyCodes.size}/${coreVarietyCodes.size}`,
  canonicalEntityIdentityGroups: identityIds.size,
  groupedEntityCoreCodes: identityCodeOwners.size,
  canonicalGeoIdentityGroups: geoIdentityIds.size,
  groupedRegionCoreCodes: geoCodeOwners.size,
  geoHierarchyCorrections: correctionCodes.size,
  localizedNames: localizedNamesCount,
  localizedAliases: localizedAliasesCount,
  sources: registry.sources?.length || 0,
  warnings: warnings.length,
  errors: errors.length,
};
console.log(JSON.stringify(summary, null, 2));
for (const message of warnings) console.warn(`WARN: ${message}`);
for (const message of errors) console.error(`ERROR: ${message}`);
if (errors.length) process.exit(1);
