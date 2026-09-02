#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const outputArg = process.argv.slice(2).find((x) => x.startsWith('--output='));
const releaseDir = outputArg ? path.resolve(outputArg.slice('--output='.length)) : path.resolve(ROOT, 'coffee-knowledge/releases');
const manifestPath = path.join(releaseDir, 'latest.json');
if (!fs.existsSync(manifestPath)) throw new Error(`Missing release manifest: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.provider !== 'brewion') throw new Error('Unexpected provider.');
if (manifest.contract !== 'coffee-knowledge/1.0') throw new Error(`Unexpected contract ${manifest.contract}`);
if (!manifest.artifact?.name || !manifest.artifact?.sha256) throw new Error('Release artifact metadata is incomplete.');

const artifactPath = path.join(releaseDir, manifest.artifact.name);
if (!fs.existsSync(artifactPath)) throw new Error(`Missing knowledge artifact: ${artifactPath}`);
const artifactBytes = fs.readFileSync(artifactPath);
const actualHash = crypto.createHash('sha256').update(artifactBytes).digest('hex');
if (actualHash !== manifest.artifact.sha256) throw new Error(`SHA-256 mismatch: ${actualHash} != ${manifest.artifact.sha256}`);
if (artifactBytes.length !== Number(manifest.artifact.bytes)) throw new Error(`Byte count mismatch: ${artifactBytes.length} != ${manifest.artifact.bytes}`);

const bundle = JSON.parse(artifactBytes.toString('utf8'));
if (bundle._format !== 'coffee-knowledge-bundle') throw new Error(`Unexpected bundle format ${bundle._format}`);
if (bundle.contract !== manifest.contract) throw new Error('Bundle/manifest contract mismatch.');
if (bundle.version !== manifest.version) throw new Error('Bundle/manifest version mismatch.');
if (String(bundle.coreCodebook?.version) !== String(manifest.coreCodebookVersion)) throw new Error('Core codebook version mismatch.');

for (const table of ['countries','regions','entities','varieties','processes','flavors']) {
  if (!Array.isArray(bundle[table])) throw new Error(`${table} missing from bundle.`);
  if (bundle[table].length !== Number(manifest.counts?.[table])) throw new Error(`${table} count mismatch.`);
  bundle[table].forEach((record,index)=>{
    if (record.qrIndex !== index + 1) throw new Error(`${table}[${index}] qrIndex changed.`);
    if (!record.code) throw new Error(`${table}[${index}] code missing.`);
  });
}
if (bundle.counts.enrichedVarieties !== bundle.counts.varieties) throw new Error('Variety knowledge coverage is not complete.');
if (bundle.counts.enrichedProcesses !== bundle.counts.processes) throw new Error('Process knowledge coverage is not complete.');
if (!Array.isArray(bundle.sourceRegistry?.sources) || bundle.sourceRegistry.sources.length < 1) throw new Error('Source registry missing.');
if (!Array.isArray(bundle.localizedAliases)) throw new Error('localizedAliases missing.');
if (bundle.localizedAliases.length !== Number(manifest.counts?.localizedAliases || 0)) throw new Error('localizedAliases count mismatch.');
for (const alias of bundle.localizedAliases) {
  if (['ai_translated','ai_transliterated'].includes(alias.nameType) && !String(alias.reviewStatus || '').startsWith('pending')) {
    throw new Error(`AI alias ${alias.targetCode || alias.targetId}:${alias.alias || alias.name} is not pending review.`);
  }
}

const groups = Array.isArray(bundle.entityIdentityGroups) ? bundle.entityIdentityGroups : [];
if (groups.length !== Number(manifest.counts?.canonicalEntityIdentityGroups || 0)) throw new Error('Canonical entity identity group count mismatch.');
const entityCodes = new Set(bundle.entities.map((x) => x.code));
const groupedCodes = new Set();
const groupIds = new Set();
for (const group of groups) {
  if (!group.canonicalIdentityId || groupIds.has(group.canonicalIdentityId)) throw new Error(`Invalid or duplicate canonicalIdentityId ${group.canonicalIdentityId}`);
  groupIds.add(group.canonicalIdentityId);
  for (const code of group.coreCodes || []) {
    if (!entityCodes.has(code)) throw new Error(`${group.canonicalIdentityId} references missing entity ${code}`);
    if (groupedCodes.has(code)) throw new Error(`Entity ${code} appears in multiple canonical identity groups.`);
    groupedCodes.add(code);
    if (bundle.entities.find((x)=>x.code===code)?.canonicalIdentityId !== group.canonicalIdentityId) throw new Error(`Entity ${code} canonicalIdentityId was not materialized correctly.`);
  }
}
if (groupedCodes.size !== Number(manifest.counts?.groupedEntityCoreCodes || 0)) throw new Error('Grouped entity core-code count mismatch.');

const geoGroups = Array.isArray(bundle.geoIdentityGroups) ? bundle.geoIdentityGroups : [];
if (geoGroups.length !== Number(manifest.counts?.canonicalGeoIdentityGroups || 0)) throw new Error('Canonical geo identity group count mismatch.');
const regionCodes = new Set(bundle.regions.map((x)=>x.code));
const groupedRegionCodes = new Set();
const geoGroupIds = new Set();
for (const group of geoGroups) {
  if (!group.canonicalGeoIdentityId || geoGroupIds.has(group.canonicalGeoIdentityId)) throw new Error(`Invalid or duplicate canonicalGeoIdentityId ${group.canonicalGeoIdentityId}`);
  geoGroupIds.add(group.canonicalGeoIdentityId);
  for (const code of group.coreCodes || []) {
    if (!regionCodes.has(code)) throw new Error(`${group.canonicalGeoIdentityId} references missing region ${code}`);
    if (groupedRegionCodes.has(code)) throw new Error(`Region ${code} appears in multiple canonical geo identity groups.`);
    groupedRegionCodes.add(code);
    if (bundle.regions.find((x)=>x.code===code)?.canonicalGeoIdentityId !== group.canonicalGeoIdentityId) throw new Error(`Region ${code} canonicalGeoIdentityId was not materialized correctly.`);
  }
}
if (groupedRegionCodes.size !== Number(manifest.counts?.groupedRegionCoreCodes || 0)) throw new Error('Grouped region core-code count mismatch.');

const corrections = Array.isArray(bundle.geoHierarchyCorrections) ? bundle.geoHierarchyCorrections : [];
if (corrections.length !== Number(manifest.counts?.geoHierarchyCorrections || 0)) throw new Error('Geo hierarchy correction count mismatch.');
for (const correction of corrections) {
  const country = bundle.countries.find((x)=>x.code===correction.coreCode);
  if (!country) throw new Error(`Geo correction ${correction.id} references missing country ${correction.coreCode}`);
  if (!country.canonicalGeo || country.canonicalGeo.canonicalNameEn !== correction.canonicalNameEn) throw new Error(`Geo correction ${correction.id} was not materialized.`);
}

console.log(JSON.stringify({ verified:true, artifact:manifest.artifact.name, sha256:actualHash, counts:manifest.counts }, null, 2));
