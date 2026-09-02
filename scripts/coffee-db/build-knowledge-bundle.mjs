#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const manifestPath = path.resolve(ROOT, 'coffee-knowledge/knowledge-manifest_v1.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const knowledgeDir = path.dirname(manifestPath);

function readRelative(baseDir, relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(baseDir, relativePath), 'utf8'));
}
function rowToObject(columns, row) {
  return Object.fromEntries(columns.map((name, index) => [name, row[index] ?? null]));
}
function mergeUniqueById(records) {
  const map = new Map();
  for (const record of records) {
    if (!record?.id) continue;
    if (map.has(record.id)) throw new Error(`Duplicate knowledge id while building bundle: ${record.id}`);
    map.set(record.id, record);
  }
  return [...map.values()];
}
function indexByCoreCode(records) {
  const map = new Map();
  for (const record of records) {
    if (!record?.coreCode) continue;
    if (map.has(record.coreCode)) throw new Error(`Duplicate enrichment for coreCode ${record.coreCode}`);
    map.set(record.coreCode, record);
  }
  return map;
}
function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}
function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObjectKeys(value[key])]));
}
function stableJson(value) {
  return `${JSON.stringify(sortObjectKeys(value), null, 2)}\n`;
}
function outputArg() {
  const arg = process.argv.slice(2).find((x) => x.startsWith('--output='));
  if (arg) return path.resolve(arg.slice('--output='.length));
  if (process.argv.includes('--write')) return path.resolve(ROOT, 'coffee-knowledge/releases');
  return path.resolve(ROOT, '.coffee-knowledge-build');
}

const core = readRelative(knowledgeDir, manifest.coreCodebook);
const knowledge = readRelative(knowledgeDir, manifest.mainKnowledge);
const sourceRegistry = readRelative(knowledgeDir, manifest.sourceRegistry);
const catalogs = (manifest.catalogModules || []).map((modulePath) => ({
  modulePath,
  data: readRelative(knowledgeDir, modulePath),
}));
const supplementalModels = (manifest.supplementalModels || []).map((modulePath) => ({
  modulePath,
  data: readRelative(knowledgeDir, modulePath),
}));
const entityIdentity = manifest.entityIdentityModule
  ? readRelative(knowledgeDir, manifest.entityIdentityModule)
  : { groups: [] };
const geoIdentity = manifest.geoIdentityModule
  ? readRelative(knowledgeDir, manifest.geoIdentityModule)
  : { identityGroups: [], hierarchyCorrections: [] };

const moduleSpecies = catalogs.flatMap((x) => x.data.species || []);
const moduleVarieties = catalogs.flatMap((x) => x.data.varietyDetails || []);
const moduleLocalizedNames = catalogs.flatMap((x) => x.data.localizedNames || []);
const moduleLocalizedAliases = catalogs.flatMap((x) => x.data.localizedAliases || []);

const species = mergeUniqueById([...(knowledge.species || []), ...moduleSpecies]);
const varietyDetails = mergeUniqueById([...(knowledge.varietyDetails || []), ...moduleVarieties]);
const geoDetails = mergeUniqueById(knowledge.geoDetails || []);
const entityDetails = mergeUniqueById(knowledge.entityDetails || []);
const processDetails = mergeUniqueById(knowledge.processDetails || []);

const geoByCore = indexByCoreCode(geoDetails);
const entityByCore = indexByCoreCode(entityDetails);
const varietyByCore = indexByCoreCode(varietyDetails);
const processByCore = indexByCoreCode(processDetails);

const coreEntityRows = (core.entities || []).map((row, index) => ({ ...rowToObject(core._columns.entities, row), qrIndex: index + 1 }));
const coreEntityByCode = new Map(coreEntityRows.map((x) => [x.code, x]));
const entityIdentityIds = new Set();
const entityIdentityByCore = new Map();
for (const group of entityIdentity.groups || []) {
  const canonicalIdentityId = String(group.canonicalIdentityId || '').trim();
  if (!canonicalIdentityId) throw new Error('Entity identity group is missing canonicalIdentityId.');
  if (entityIdentityIds.has(canonicalIdentityId)) throw new Error(`Duplicate canonicalIdentityId ${canonicalIdentityId}`);
  entityIdentityIds.add(canonicalIdentityId);
  if (!Array.isArray(group.coreCodes) || group.coreCodes.length < 2) throw new Error(`${canonicalIdentityId} must group at least two core entity codes.`);
  for (const coreCode of group.coreCodes) {
    const coreEntity = coreEntityByCode.get(coreCode);
    if (!coreEntity) throw new Error(`${canonicalIdentityId} references missing entity coreCode ${coreCode}`);
    if (group.countryCode && group.countryCode !== coreEntity.countryCode) {
      throw new Error(`${canonicalIdentityId} country mismatch for ${coreCode}: ${group.countryCode} != ${coreEntity.countryCode}`);
    }
    if (entityIdentityByCore.has(coreCode)) throw new Error(`Entity coreCode ${coreCode} belongs to multiple canonical identity groups.`);
    entityIdentityByCore.set(coreCode, group);
  }
}

const coreRegionRows = (core.regions || []).map((row, index) => ({ ...rowToObject(core._columns.regions, row), qrIndex: index + 1 }));
const coreRegionByCode = new Map(coreRegionRows.map((x) => [x.code, x]));
const geoIdentityIds = new Set();
const geoIdentityByCore = new Map();
for (const group of geoIdentity.identityGroups || []) {
  const canonicalGeoIdentityId = String(group.canonicalGeoIdentityId || '').trim();
  if (!canonicalGeoIdentityId) throw new Error('Geo identity group is missing canonicalGeoIdentityId.');
  if (geoIdentityIds.has(canonicalGeoIdentityId)) throw new Error(`Duplicate canonicalGeoIdentityId ${canonicalGeoIdentityId}`);
  geoIdentityIds.add(canonicalGeoIdentityId);
  if (!Array.isArray(group.coreCodes) || group.coreCodes.length < 2) throw new Error(`${canonicalGeoIdentityId} must group at least two core region codes.`);
  for (const coreCode of group.coreCodes) {
    const coreRegion = coreRegionByCode.get(coreCode);
    if (!coreRegion) throw new Error(`${canonicalGeoIdentityId} references missing region coreCode ${coreCode}`);
    if (group.countryCode && group.countryCode !== coreRegion.countryCode) {
      throw new Error(`${canonicalGeoIdentityId} country mismatch for ${coreCode}: ${group.countryCode} != ${coreRegion.countryCode}`);
    }
    if (geoIdentityByCore.has(coreCode)) throw new Error(`Region coreCode ${coreCode} belongs to multiple canonical geo identity groups.`);
    geoIdentityByCore.set(coreCode, group);
  }
}

const countryCodes = new Set((core.countries || []).map((row) => String(row?.[0] || '')));
const geoCorrectionByCore = new Map();
for (const correction of geoIdentity.hierarchyCorrections || []) {
  const coreCode = String(correction.coreCode || '').trim();
  if (!coreCode || !countryCodes.has(coreCode)) throw new Error(`Geo hierarchy correction references missing/non-country coreCode ${coreCode}`);
  if (geoCorrectionByCore.has(coreCode)) throw new Error(`Duplicate geo hierarchy correction for ${coreCode}`);
  geoCorrectionByCore.set(coreCode, correction);
}

function materialize(tableName, enrichmentMap = null) {
  const columns = core._columns?.[tableName];
  if (!Array.isArray(columns)) throw new Error(`Missing core columns for ${tableName}`);
  return (core[tableName] || []).map((row, index) => {
    const base = rowToObject(columns, row);
    const enrichment = enrichmentMap?.get(base.code) || null;
    const identityGroup = tableName === 'entities' ? entityIdentityByCore.get(base.code) || null : null;
    const geoGroup = tableName === 'regions' ? geoIdentityByCore.get(base.code) || null : null;
    const geoCorrection = tableName === 'countries' ? geoCorrectionByCore.get(base.code) || null : null;
    return {
      ...base,
      qrIndex: index + 1,
      evidenceStatus: enrichment ? (enrichment.evidenceStatus || 'knowledge_enriched') : 'legacy_core',
      ...(enrichment ? { knowledge: enrichment } : {}),
      ...(identityGroup ? {
        canonicalIdentityId: identityGroup.canonicalIdentityId,
        canonicalIdentity: {
          canonicalNameZh: identityGroup.canonicalNameZh || null,
          canonicalNameEn: identityGroup.canonicalNameEn || null,
          resolution: identityGroup.resolution || null,
          confidence: identityGroup.confidence ?? null,
        },
      } : {}),
      ...(geoGroup ? {
        canonicalGeoIdentityId: geoGroup.canonicalGeoIdentityId,
        canonicalGeoIdentity: {
          canonicalNameZh: geoGroup.canonicalNameZh || null,
          canonicalNameEn: geoGroup.canonicalNameEn || null,
          geoType: geoGroup.geoType || null,
          resolution: geoGroup.resolution || null,
          confidence: geoGroup.confidence ?? null,
        },
      } : {}),
      ...(geoCorrection ? {
        canonicalGeo: {
          canonicalType: geoCorrection.canonicalCoreType || null,
          canonicalNameZh: geoCorrection.canonicalNameZh || null,
          canonicalNameEn: geoCorrection.canonicalNameEn || null,
          resolution: geoCorrection.resolution || null,
          confidence: geoCorrection.confidence ?? null,
          childGeoNodes: geoCorrection.childGeoNodes || [],
        },
      } : {}),
    };
  });
}

const countries = materialize('countries', geoByCore);
const regions = materialize('regions', geoByCore);
const entities = materialize('entities', entityByCore);
const varieties = materialize('varieties', varietyByCore);
const processes = materialize('processes', processByCore);
const flavors = materialize('flavors', null);
const relations = (core.relations || []).map((row) => rowToObject(core._columns.relations, row));
const aliases = (core.aliases || []).map((row) => rowToObject(core._columns.aliases, row));

const boundCoreCodes = new Set([
  ...countries.map((x) => x.code),
  ...regions.map((x) => x.code),
  ...entities.map((x) => x.code),
  ...varieties.map((x) => x.code),
  ...processes.map((x) => x.code),
  ...flavors.map((x) => x.code),
]);
const unboundGeoDetails = geoDetails.filter((x) => !x.coreCode || !boundCoreCodes.has(x.coreCode));
const unboundEntityDetails = entityDetails.filter((x) => !x.coreCode || !boundCoreCodes.has(x.coreCode));
const unboundVarietyDetails = varietyDetails.filter((x) => !x.coreCode || !boundCoreCodes.has(x.coreCode));
const unboundProcessDetails = processDetails.filter((x) => !x.coreCode || !boundCoreCodes.has(x.coreCode));

const localizedNames = [
  ...(knowledge.localizedNames || []),
  ...moduleLocalizedNames,
];
const localizedAliases = [
  ...(knowledge.localizedAliases || []),
  ...moduleLocalizedAliases,
];

const bundle = {
  _format: 'coffee-knowledge-bundle',
  _schemaVersion: 1,
  contract: manifest.contract,
  version: manifest.version,
  updatedAt: manifest.updatedAt,
  coreCodebook: {
    format: core._format,
    schemaVersion: core._schemaVersion,
    version: core.version,
    updatedAt: core.updatedAt,
  },
  languagePolicy: knowledge.languagePolicy,
  confidencePolicy: knowledge.confidencePolicy,
  counts: {
    countries: countries.length,
    regions: regions.length,
    entities: entities.length,
    varieties: varieties.length,
    processes: processes.length,
    flavors: flavors.length,
    relations: relations.length,
    aliases: aliases.length,
    species: species.length,
    localizedNames: localizedNames.length,
    localizedAliases: localizedAliases.length,
    pendingLocalizedAliases: localizedAliases.filter((x) => String(x.reviewStatus || '').startsWith('pending')).length,
    enrichedCountries: countries.filter((x) => x.knowledge).length,
    enrichedRegions: regions.filter((x) => x.knowledge).length,
    enrichedEntities: entities.filter((x) => x.knowledge).length,
    enrichedVarieties: varieties.filter((x) => x.knowledge).length,
    enrichedProcesses: processes.filter((x) => x.knowledge).length,
    canonicalEntityIdentityGroups: entityIdentityIds.size,
    groupedEntityCoreCodes: entityIdentityByCore.size,
    canonicalGeoIdentityGroups: geoIdentityIds.size,
    groupedRegionCoreCodes: geoIdentityByCore.size,
    geoHierarchyCorrections: geoCorrectionByCore.size,
  },
  countries,
  regions,
  entities,
  varieties,
  processes,
  flavors,
  relations,
  aliases,
  species,
  entityIdentityGroups: entityIdentity.groups || [],
  geoIdentityGroups: geoIdentity.identityGroups || [],
  geoHierarchyCorrections: geoIdentity.hierarchyCorrections || [],
  processFamilies: knowledge.processFamilies || [],
  fermentationMethods: knowledge.fermentationMethods || [],
  dryingMethods: knowledge.dryingMethods || [],
  varietyLineage: knowledge.varietyLineage || [],
  temporalRelations: knowledge.temporalRelations || [],
  lots: knowledge.lots || [],
  localizedNames,
  localizedAliases,
  unboundKnowledge: {
    geoDetails: unboundGeoDetails,
    entityDetails: unboundEntityDetails,
    varietyDetails: unboundVarietyDetails,
    processDetails: unboundProcessDetails,
  },
  sourceRegistry,
  supplementalModels: Object.fromEntries(supplementalModels.map((x) => [x.modulePath, x.data])),
};

if (bundle.counts.countries !== (core.countries || []).length) throw new Error('Country count mismatch.');
if (bundle.counts.regions !== (core.regions || []).length) throw new Error('Region count mismatch.');
if (bundle.counts.entities !== (core.entities || []).length) throw new Error('Entity count mismatch.');
if (bundle.counts.varieties !== (core.varieties || []).length) throw new Error('Variety count mismatch.');
if (bundle.counts.processes !== (core.processes || []).length) throw new Error('Process count mismatch.');
if (bundle.counts.flavors !== (core.flavors || []).length) throw new Error('Flavor count mismatch.');
if (bundle.counts.enrichedVarieties !== (core.varieties || []).length) throw new Error(`Every v6 variety must be enriched; got ${bundle.counts.enrichedVarieties}/${bundle.counts.varieties}.`);
if (bundle.counts.enrichedProcesses !== (core.processes || []).length) throw new Error(`Every v6 process must be enriched; got ${bundle.counts.enrichedProcesses}/${bundle.counts.processes}.`);

const bundleText = stableJson(bundle);
const bundleHash = sha256(bundleText);
const releaseDir = outputArg();
fs.mkdirSync(releaseDir, { recursive: true });
const artifactName = `coffee-knowledge-${manifest.version}.json`;
const artifactPath = path.join(releaseDir, artifactName);
fs.writeFileSync(artifactPath, bundleText, 'utf8');

const releaseManifest = {
  _format: 'coffee-knowledge-release-manifest',
  _schemaVersion: 1,
  provider: 'brewion',
  type: 'knowledge_dataset',
  contract: manifest.contract,
  version: manifest.version,
  updatedAt: manifest.updatedAt,
  coreCodebookVersion: String(core.version),
  artifact: {
    name: artifactName,
    sha256: bundleHash,
    bytes: Buffer.byteLength(bundleText),
  },
  counts: bundle.counts,
  compatibility: {
    qrIndexesChanged: false,
    baselinePolicy: 'materialize-core-then-overlay-knowledge',
    canonicalEntityIdentityPolicy: 'deduplicate-display-preserve-core-code',
    canonicalGeoIdentityPolicy: 'deduplicate-display-preserve-core-code',
    localizationPolicy: 'ai-candidates-never-overwrite-official-names',
  },
};
fs.writeFileSync(path.join(releaseDir, 'latest.json'), stableJson(releaseManifest), 'utf8');

console.log(JSON.stringify({ releaseDir, artifactName, sha256: bundleHash, counts: bundle.counts }, null, 2));
