#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const outputArg = process.argv.slice(2).find((x) => x.startsWith('--output='));
const releaseDir = outputArg
  ? path.resolve(outputArg.slice('--output='.length))
  : path.resolve(ROOT, 'coffee-knowledge/releases');
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

for (const table of ['countries', 'regions', 'entities', 'varieties', 'processes', 'flavors']) {
  if (!Array.isArray(bundle[table])) throw new Error(`${table} missing from bundle.`);
  const expected = Number(manifest.counts?.[table]);
  if (bundle[table].length !== expected) throw new Error(`${table} count mismatch.`);
  bundle[table].forEach((record, index) => {
    if (record.qrIndex !== index + 1) throw new Error(`${table}[${index}] qrIndex changed.`);
    if (!record.code) throw new Error(`${table}[${index}] code missing.`);
  });
}

if (bundle.counts.enrichedVarieties !== bundle.counts.varieties) throw new Error('Variety knowledge coverage is not complete.');
if (bundle.counts.enrichedProcesses !== bundle.counts.processes) throw new Error('Process knowledge coverage is not complete.');
if (!Array.isArray(bundle.sourceRegistry?.sources) || bundle.sourceRegistry.sources.length < 1) throw new Error('Source registry missing.');

const groups = Array.isArray(bundle.entityIdentityGroups) ? bundle.entityIdentityGroups : [];
if (groups.length !== Number(manifest.counts?.canonicalEntityIdentityGroups || 0)) throw new Error('Canonical entity identity group count mismatch.');
const entityCodes = new Set(bundle.entities.map((x) => x.code));
const groupedCodes = new Set();
const groupIds = new Set();
for (const group of groups) {
  if (!group.canonicalIdentityId || groupIds.has(group.canonicalIdentityId)) throw new Error(`Invalid or duplicate canonicalIdentityId ${group.canonicalIdentityId}`);
  groupIds.add(group.canonicalIdentityId);
  if (!Array.isArray(group.coreCodes) || group.coreCodes.length < 2) throw new Error(`${group.canonicalIdentityId} must include at least two coreCodes.`);
  for (const code of group.coreCodes) {
    if (!entityCodes.has(code)) throw new Error(`${group.canonicalIdentityId} references missing entity ${code}`);
    if (groupedCodes.has(code)) throw new Error(`Entity ${code} appears in multiple canonical identity groups.`);
    groupedCodes.add(code);
    const materialized = bundle.entities.find((x) => x.code === code);
    if (materialized?.canonicalIdentityId !== group.canonicalIdentityId) throw new Error(`Entity ${code} canonicalIdentityId was not materialized correctly.`);
  }
}
if (groupedCodes.size !== Number(manifest.counts?.groupedEntityCoreCodes || 0)) throw new Error('Grouped entity core-code count mismatch.');

console.log(JSON.stringify({
  verified: true,
  artifact: manifest.artifact.name,
  sha256: actualHash,
  counts: manifest.counts,
}, null, 2));
