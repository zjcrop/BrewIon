#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const corePath = path.resolve(ROOT, 'coffee-qr-codebook/coffee_qr_codebook_v6.json');
const knowledgePath = path.resolve(ROOT, 'coffee-knowledge/coffee_origin_knowledge_v1.json');
const varietyModulePath = path.resolve(ROOT, 'coffee-knowledge/catalog/v6_variety_details_remaining_v1.json');

const core = JSON.parse(fs.readFileSync(corePath, 'utf8'));
const knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
const varietyModule = fs.existsSync(varietyModulePath)
  ? JSON.parse(fs.readFileSync(varietyModulePath, 'utf8'))
  : { varietyDetails: [] };

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((x) => x.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}
function rowToObject(table, row) {
  return Object.fromEntries((core._columns?.[table] || []).map((name, index) => [name, row[index] ?? null]));
}
function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[\s\-_/.,;:()\[\]{}]+/g, '')
    .trim();
}
function groupDuplicates(records, keyFn) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFn(record);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, rows }));
}

const countries = (core.countries || []).map((row, index) => ({ ...rowToObject('countries', row), qrIndex: index + 1 }));
const regions = (core.regions || []).map((row, index) => ({ ...rowToObject('regions', row), qrIndex: index + 1 }));
const entities = (core.entities || []).map((row, index) => ({ ...rowToObject('entities', row), qrIndex: index + 1 }));
const varieties = (core.varieties || []).map((row, index) => ({ ...rowToObject('varieties', row), qrIndex: index + 1 }));
const processes = (core.processes || []).map((row, index) => ({ ...rowToObject('processes', row), qrIndex: index + 1 }));
const flavors = (core.flavors || []).map((row, index) => ({ ...rowToObject('flavors', row), qrIndex: index + 1 }));
const relations = (core.relations || []).map((row, index) => ({ ...rowToObject('relations', row), rowIndex: index }));

const countryCodes = new Set(countries.map((x) => x.code));
const allIndexedCodes = new Set([...countries, ...regions, ...entities, ...varieties, ...processes, ...flavors].map((x) => x.code));

const exactRegionEnglishDuplicates = groupDuplicates(regions, (x) => `${x.countryCode}|${normalize(x.nameEn)}`);
const exactRegionChineseDuplicates = groupDuplicates(regions, (x) => `${x.countryCode}|${normalize(x.nameZh)}`);
const exactEntityEnglishDuplicates = groupDuplicates(entities, (x) => `${x.countryCode}|${normalize(x.nameEn)}`);
const exactEntityChineseDuplicates = groupDuplicates(entities, (x) => `${x.countryCode}|${normalize(x.nameZh)}`);
const entityShortNameCollisions = groupDuplicates(entities, (x) => `${x.countryCode}|${normalize(x.shortName)}`)
  .filter((group) => new Set(group.rows.map((x) => normalize(x.nameEn))).size > 1);

const suspiciousCountries = countries.filter((x) => /\//.test(String(x.nameEn || '')) || /\//.test(String(x.nameZh || '')));
const placeholderEntities = entities.filter((x) => /placeholder|generic/i.test(String(x.entityType || '')));
const candidateEntities = entities.filter((x) => String(x.status || '').toLowerCase() === 'candidate');
const nonActiveIndexed = [...countries, ...regions, ...entities, ...varieties, ...processes, ...flavors]
  .filter((x) => String(x.status || '').toLowerCase() !== 'active');
const missingBilingual = [
  ...countries.filter((x) => !String(x.nameZh || '').trim() || !String(x.nameEn || '').trim()).map((x) => ({ table: 'countries', code: x.code })),
  ...regions.filter((x) => !String(x.nameZh || '').trim() || !String(x.nameEn || '').trim()).map((x) => ({ table: 'regions', code: x.code })),
  ...entities.filter((x) => !String(x.nameZh || '').trim() || !String(x.nameEn || '').trim()).map((x) => ({ table: 'entities', code: x.code })),
  ...varieties.filter((x) => !String(x.nameZh || '').trim() || !String(x.nameEn || '').trim()).map((x) => ({ table: 'varieties', code: x.code })),
  ...processes.filter((x) => !String(x.nameZh || '').trim() || !String(x.nameEn || '').trim()).map((x) => ({ table: 'processes', code: x.code })),
  ...flavors.filter((x) => !String(x.nameZh || '').trim() || !String(x.nameEn || '').trim()).map((x) => ({ table: 'flavors', code: x.code })),
];

const missingRegionCountryRefs = regions.filter((x) => !countryCodes.has(x.countryCode)).map((x) => x.code);
const missingEntityCountryRefs = entities.filter((x) => !countryCodes.has(x.countryCode)).map((x) => x.code);
const brokenRelations = relations.filter((x) => !allIndexedCodes.has(x.parentCode) || !allIndexedCodes.has(x.childCode));
const selfRelations = relations.filter((x) => x.parentCode === x.childCode);
const duplicateRelations = groupDuplicates(relations, (x) => `${x.parentCode}|${x.childCode}|${x.relationType}`);

const geoEnrichedCodes = new Set((knowledge.geoDetails || []).map((x) => x.coreCode).filter(Boolean));
const entityEnrichedCodes = new Set((knowledge.entityDetails || []).map((x) => x.coreCode).filter(Boolean));
const varietyEnrichedCodes = new Set([
  ...(knowledge.varietyDetails || []).map((x) => x.coreCode),
  ...(varietyModule.varietyDetails || []).map((x) => x.coreCode),
].filter(Boolean));
const processEnrichedCodes = new Set((knowledge.processDetails || []).map((x) => x.coreCode).filter(Boolean));

const entityTypeCounts = Object.fromEntries([...new Set(entities.map((x) => x.entityType))]
  .sort()
  .map((type) => [type, entities.filter((x) => x.entityType === type).length]));
const entityStatusCounts = Object.fromEntries([...new Set(entities.map((x) => x.status))]
  .sort()
  .map((status) => [status, entities.filter((x) => x.status === status).length]));

const priorityQueue = [];
for (const country of suspiciousCountries) priorityQueue.push({ priority: 100, kind: 'country_hierarchy_conflation', codes: [country.code], note: `${country.nameEn}` });
for (const group of exactRegionEnglishDuplicates) priorityQueue.push({ priority: 95, kind: 'region_exact_duplicate_en', codes: group.rows.map((x) => x.code), note: group.rows[0].nameEn });
for (const group of exactRegionChineseDuplicates) priorityQueue.push({ priority: 90, kind: 'region_exact_duplicate_zh', codes: group.rows.map((x) => x.code), note: group.rows[0].nameZh });
for (const group of exactEntityEnglishDuplicates) priorityQueue.push({ priority: 90, kind: 'entity_exact_duplicate_en', codes: group.rows.map((x) => x.code), note: group.rows[0].nameEn });
for (const group of exactEntityChineseDuplicates) priorityQueue.push({ priority: 85, kind: 'entity_exact_duplicate_zh', codes: group.rows.map((x) => x.code), note: group.rows[0].nameZh });
for (const group of entityShortNameCollisions) priorityQueue.push({ priority: 75, kind: 'entity_short_name_collision', codes: group.rows.map((x) => x.code), note: group.rows[0].shortName });
for (const entity of placeholderEntities) priorityQueue.push({ priority: 65, kind: 'entity_placeholder_type', codes: [entity.code], note: entity.nameEn });
for (const entity of candidateEntities) priorityQueue.push({ priority: 55, kind: 'entity_candidate_status', codes: [entity.code], note: entity.nameEn });
priorityQueue.sort((a, b) => b.priority - a.priority || a.codes.join(',').localeCompare(b.codes.join(',')));

const report = {
  _format: 'coffee-legacy-core-structural-audit',
  _schemaVersion: 1,
  generatedFrom: {
    coreVersion: core.version,
    coreUpdatedAt: core.updatedAt,
  },
  summary: {
    countries: countries.length,
    regions: regions.length,
    entities: entities.length,
    varieties: varieties.length,
    processes: processes.length,
    flavors: flavors.length,
    relations: relations.length,
    suspiciousCountries: suspiciousCountries.length,
    exactRegionEnglishDuplicateGroups: exactRegionEnglishDuplicates.length,
    exactRegionChineseDuplicateGroups: exactRegionChineseDuplicates.length,
    exactEntityEnglishDuplicateGroups: exactEntityEnglishDuplicates.length,
    exactEntityChineseDuplicateGroups: exactEntityChineseDuplicates.length,
    entityShortNameCollisionGroups: entityShortNameCollisions.length,
    placeholderEntities: placeholderEntities.length,
    candidateEntities: candidateEntities.length,
    nonActiveIndexedRows: nonActiveIndexed.length,
    missingBilingualRows: missingBilingual.length,
    brokenRelations: brokenRelations.length,
    selfRelations: selfRelations.length,
    duplicateRelationGroups: duplicateRelations.length,
    enrichedRegions: regions.filter((x) => geoEnrichedCodes.has(x.code)).length,
    enrichedEntities: entities.filter((x) => entityEnrichedCodes.has(x.code)).length,
    enrichedVarieties: varieties.filter((x) => varietyEnrichedCodes.has(x.code)).length,
    enrichedProcesses: processes.filter((x) => processEnrichedCodes.has(x.code)).length,
  },
  knowledgeCoverage: {
    regions: { enriched: regions.filter((x) => geoEnrichedCodes.has(x.code)).length, total: regions.length },
    entities: { enriched: entities.filter((x) => entityEnrichedCodes.has(x.code)).length, total: entities.length },
    varieties: { enriched: varieties.filter((x) => varietyEnrichedCodes.has(x.code)).length, total: varieties.length },
    processes: { enriched: processes.filter((x) => processEnrichedCodes.has(x.code)).length, total: processes.length },
  },
  entityTypeCounts,
  entityStatusCounts,
  highRisk: {
    suspiciousCountries,
    exactRegionEnglishDuplicates,
    exactRegionChineseDuplicates,
    exactEntityEnglishDuplicates,
    exactEntityChineseDuplicates,
    entityShortNameCollisions,
    placeholderEntities,
    candidateEntities,
    missingBilingual,
    missingRegionCountryRefs,
    missingEntityCountryRefs,
    brokenRelations,
    selfRelations,
    duplicateRelations,
  },
  priorityQueue,
  interpretation: {
    structuralOnly: true,
    rule: 'A structural duplicate/collision is a review candidate, not an automatic merge instruction.',
    sourceRequirement: 'Any correction, deprecation or canonical merge still requires authoritative or independently corroborated evidence.',
  },
};

const output = arg('output');
const json = `${JSON.stringify(report, null, 2)}\n`;
if (output) {
  const full = path.resolve(ROOT, output);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, json, 'utf8');
  console.log(JSON.stringify({ output: full, summary: report.summary, priorityItems: priorityQueue.length }, null, 2));
} else {
  console.log(json);
}

if (missingRegionCountryRefs.length || missingEntityCountryRefs.length || brokenRelations.length || selfRelations.length) {
  process.exitCode = 1;
}
