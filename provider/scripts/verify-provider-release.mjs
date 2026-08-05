import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDeltaAndCorrections, ensureCodebookShape, sha256Text } from './provider-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const outputArg = process.argv.slice(2).find((arg) => arg.startsWith('--output='));
const releaseDir = outputArg ? path.resolve(outputArg.slice('--output='.length)) : path.join(repoRoot, 'provider/releases');
const manifestPath = path.join(releaseDir, 'latest.json');
if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const key of ['provider', 'contract', 'releaseId', 'dataVersion', 'schemaVersion', 'generatedAt', 'status', 'source', 'compatibility', 'artifacts']) {
  if (!(key in manifest)) throw new Error(`Manifest missing ${key}.`);
}
if (manifest.provider !== 'brewion' || manifest.contract !== 'coffee-codebook/1.0') throw new Error('Unexpected provider contract.');
for (const item of manifest.artifacts) {
  const file = path.join(releaseDir, item.path);
  const text = fs.readFileSync(file, 'utf8');
  if (Buffer.byteLength(text) !== item.bytes) throw new Error(`Byte count mismatch: ${item.path}`);
  if (sha256Text(text) !== item.sha256) throw new Error(`SHA-256 mismatch: ${item.path}`);
  JSON.parse(text);
}
const fullItem = manifest.artifacts.find((item) => item.kind === 'full');
const deltaItem = manifest.artifacts.find((item) => item.kind === 'delta');
const correctionsItem = manifest.artifacts.find((item) => item.kind === 'corrections');
const full = JSON.parse(fs.readFileSync(path.join(releaseDir, fullItem.path), 'utf8'));
ensureCodebookShape(full);
const source = JSON.parse(fs.readFileSync(path.join(repoRoot, manifest.source.path), 'utf8'));
if (JSON.stringify(source) !== JSON.stringify(full)) throw new Error('Published full artifact differs from source codebook.');
if (manifest.compatibility.previousDataVersion) {
  const previousFull = manifest.metadata?.previousFullPath;
  if (previousFull) {
    const previous = JSON.parse(fs.readFileSync(path.join(releaseDir, previousFull), 'utf8'));
    const rebuilt = applyDeltaAndCorrections(previous, JSON.parse(fs.readFileSync(path.join(releaseDir, deltaItem.path), 'utf8')), JSON.parse(fs.readFileSync(path.join(releaseDir, correctionsItem.path), 'utf8')));
    if (JSON.stringify(rebuilt) !== JSON.stringify(full)) throw new Error('Delta + corrections do not rebuild full artifact.');
  }
}
console.log(JSON.stringify({ valid: true, releaseId: manifest.releaseId, dataVersion: manifest.dataVersion, artifactCount: manifest.artifacts.length, counts: manifest.counts }, null, 2));
