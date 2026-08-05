import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEX_TABLES, MUTABLE_TABLES, artifact, compareReleases, ensureCodebookShape, normalizeSemver, stableStringify, writeJson } from './provider-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const args = process.argv.slice(2);
const writeMode = args.includes('--write');
const outputArg = args.find((arg) => arg.startsWith('--output='));
const outputDir = outputArg ? path.resolve(outputArg.slice('--output='.length)) : writeMode ? path.join(repoRoot, 'provider/releases') : fs.mkdtempSync(path.join(os.tmpdir(), 'brewion-provider-'));
const sourcePath = path.join(repoRoot, 'coffee-qr-codebook/coffee_qr_codebook_v6.json');
const codebook = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
ensureCodebookShape(codebook);
const dataVersion = normalizeSemver(codebook.version);
const latestPath = path.join(repoRoot, 'provider/releases/latest.json');
let previousManifest = null;
let previous = null;
if (fs.existsSync(latestPath)) {
  previousManifest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  const full = previousManifest.artifacts?.find((item) => item.kind === 'full');
  if (full) {
    const candidate = path.join(repoRoot, 'provider/releases', full.path);
    if (fs.existsSync(candidate)) previous = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  }
}
if (previousManifest?.dataVersion === dataVersion && previous && JSON.stringify(previous) === JSON.stringify(codebook)) {
  previousManifest = null;
  previous = null;
}
const compared = compareReleases(previous, codebook);
const fullRel = `full/coffee-codebook-${dataVersion}.json`;
const deltaRel = `delta/coffee-codebook-${previousManifest?.dataVersion ?? 'bootstrap'}-to-${dataVersion}.json`;
const correctionsRel = `corrections/coffee-codebook-${previousManifest?.dataVersion ?? 'bootstrap'}-to-${dataVersion}.json`;
writeJson(path.join(outputDir, fullRel), codebook);
writeJson(path.join(outputDir, deltaRel), {
  contract: 'coffee-codebook/1.0',
  fromVersion: previousManifest?.dataVersion ?? null,
  toVersion: dataVersion,
  appendOnly: true,
  startingIndexes: compared.startingIndexes,
  tables: compared.tables
});
writeJson(path.join(outputDir, correctionsRel), {
  contract: 'coffee-codebook-corrections/1.0',
  fromVersion: previousManifest?.dataVersion ?? null,
  toVersion: dataVersion,
  operations: compared.operations
});
const counts = Object.fromEntries([...INDEX_TABLES, ...MUTABLE_TABLES].map((table) => [table, codebook[table].length]));
const rawBase = 'https://raw.githubusercontent.com/zjcrop/BrewIon/main/provider/releases/';
const artifacts = [
  artifact(outputDir, 'full', fullRel, { url: rawBase + fullRel, tables: [...INDEX_TABLES, ...MUTABLE_TABLES] }),
  artifact(outputDir, 'delta', deltaRel, { url: rawBase + deltaRel, fromVersion: previousManifest?.dataVersion ?? null, tables: INDEX_TABLES }),
  artifact(outputDir, 'corrections', correctionsRel, { url: rawBase + correctionsRel, fromVersion: previousManifest?.dataVersion ?? null, tables: [...INDEX_TABLES, ...MUTABLE_TABLES] })
];
const manifest = {
  provider: 'brewion',
  contract: 'coffee-codebook/1.0',
  releaseId: `brewion-codebook-${dataVersion}`,
  dataVersion,
  schemaVersion: '1.0',
  generatedAt: codebook.updatedAt ? `${codebook.updatedAt}T00:00:00.000Z` : new Date(0).toISOString(),
  status: 'stable',
  appendOnly: true,
  source: { repository: 'zjcrop/BrewIon', ref: 'main', path: 'coffee-qr-codebook/coffee_qr_codebook_v6.json', commit: process.env.SOURCE_COMMIT ?? null },
  compatibility: {
    minimumConsumerContract: 'coffee-codebook/1.0',
    previousReleaseId: previousManifest?.releaseId ?? null,
    previousDataVersion: previousManifest?.dataVersion ?? null
  },
  counts,
  artifacts,
  warnings: [
    'Indexed table codes and row positions are immutable; new rows are appended only.',
    'Existing-row metadata changes and mutable relations/aliases are delivered through the corrections artifact.'
  ],
  metadata: { sourceVersion: String(codebook.version), sourceUpdatedAt: codebook.updatedAt ?? null }
};
fs.writeFileSync(path.join(outputDir, 'latest.json'), stableStringify(manifest), 'utf8');
console.log(JSON.stringify({ outputDir, dataVersion, counts, appended: Object.fromEntries(INDEX_TABLES.map((table) => [table, compared.tables[table].length])), corrections: compared.operations.length }, null, 2));
