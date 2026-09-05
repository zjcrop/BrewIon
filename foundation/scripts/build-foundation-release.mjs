import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const refArg = process.argv.find((arg) => arg.startsWith('--ref='));
const ref = refArg?.slice('--ref='.length) || '';
if (!/^[a-f0-9]{40}$/.test(ref)) throw new Error('Pass the immutable source commit as --ref=<40-char-sha>.');

const versionArg = process.argv.find((arg) => arg.startsWith('--version='));
const version = versionArg?.slice('--version='.length) || '1.0.0';
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Pass a semantic version as --version=x.y.z.');
const releaseId = `coffee-foundation-${version}`;
const files = [
  'foundation/foundation-manifest.json',
  'foundation/schemas/recognition-document-v1.1.schema.json',
  'foundation/schemas/coffee-canonical-record-v1.schema.json',
  'foundation/schemas/coffee-date-decision-v1.schema.json',
  'foundation/schemas/ai-enrichment-result-v1.schema.json',
  'foundation/schemas/recognition-book-v1.schema.json',
  'foundation/schemas/coffee-field-decision-v1.schema.json',
  'foundation/schemas/foundation-candidate-v1.schema.json',
  'foundation/schemas/sync-revision-v1.schema.json',
  'foundation/schemas/coffee-archive-v1.schema.json',
  'foundation/schemas/migration-result-v1.schema.json',
  'foundation/runtime/index.mjs',
  'foundation/runtime/normalization-adapter.mjs',
  'foundation/runtime/date-parser.mjs',
  'foundation/runtime/recognition-book.mjs',
  'foundation/runtime/contract-adapter.mjs',
  'foundation/runtime/artifact-activation.mjs',
  'foundation/runtime/sync-revision.mjs',
  'foundation/runtime/ai-adapter.mjs',
  'foundation/dictionaries/defect-dictionary-v1.json',
  'foundation/AI_POLICY.md',
  'foundation/DATE_COMPATIBILITY.md',
  'provider/releases/latest.json',
  'provider/releases/full/coffee-codebook-6.0.0.json',
  'coffee-qr-codebook/coffee_label_lexicon_v1.json',
  'coffee-knowledge/releases/latest.json',
  'coffee-knowledge/releases/coffee-knowledge-1.0.0-alpha.7.json'
];

function descriptor(relative) {
  const bytes = fs.readFileSync(path.join(repoRoot, relative));
  const mediaType = relative.endsWith('.json')
    ? 'application/json'
    : relative.endsWith('.md')
      ? 'text/markdown'
      : 'text/javascript';
  return {
    kind: relative,
    url: `https://raw.githubusercontent.com/zjcrop/BrewIon/${ref}/${relative}`,
    mediaType,
    bytes: bytes.byteLength,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  };
}

const release = {
  schemaVersion: 'coffee-foundation-candidate/1.0',
  contract: 'coffee-foundation/1.0',
  releaseId,
  artifacts: files.map(descriptor)
};
const outputDir = path.join(repoRoot, 'foundation/releases');
fs.mkdirSync(outputDir, { recursive: true });
const text = `${JSON.stringify(release, null, 2)}\n`;
fs.writeFileSync(path.join(outputDir, `${releaseId}.json`), text);
fs.writeFileSync(path.join(outputDir, 'latest.json'), text);
console.log(JSON.stringify({ releaseId, ref, artifactCount: release.artifacts.length }, null, 2));
