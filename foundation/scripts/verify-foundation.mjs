import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const root = process.cwd();
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const exists = (relative) => fs.existsSync(path.join(root, relative));
const isSha256 = (value) => /^[a-f0-9]{64}$/i.test(String(value || ''));
const fileIntegrity = (relative) => {
  const bytes = fs.readFileSync(path.join(root, relative));
  return { bytes: bytes.byteLength, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
};

const manifest = readJson('foundation/foundation-manifest.json');
assert.equal(manifest._format, 'coffee-foundation-manifest');
assert.equal(manifest._schemaVersion, 1);
assert.equal(manifest.provider, 'brewion');
assert.equal(manifest.contract, 'coffee-foundation/1.0');
assert.equal(manifest.status, 'stable');
assert.equal(manifest.authority?.repository, 'zjcrop/BrewIon');
assert.equal(manifest.authority?.refPolicy, 'immutable-commit');
assert.match(manifest.authority?.releaseManifest || '', /^foundation\/releases\/coffee-foundation-\d+\.\d+\.\d+\.json$/);

assert.equal(manifest.policies?.stableId, 'immutable');
assert.equal(manifest.policies?.indexedTables, 'append-only');
assert.equal(manifest.policies?.lowConfidence, 'review-only');
assert.equal(manifest.policies?.conflict, 'review-only');
assert.equal(manifest.policies?.dateCanonicalForm, 'YYYY-MM-DD');
assert.equal(manifest.policies?.ambiguousDate, 'review-only');
assert.equal(manifest.policies?.missingDateYear, 'review-only');
assert.equal(manifest.policies?.dateLabelMismatch, 'review-only');
assert.equal(manifest.policies?.nonGregorianDate, 'explicit-calendar-no-silent-conversion');
assert.equal(manifest.policies?.aiAuthority, 'advisory-only-never-overwrite-fact');
assert.equal(manifest.policies?.artifactIntegrity, 'sha256-required');
assert.equal(manifest.policies?.failure, 'retain-last-known-good');
assert.equal(manifest.policies?.migration, 'unknown-major-reject-no-partial-write');
assert.equal(manifest.policies?.paidExternalService, 'forbidden');
assert.equal(manifest.policies?.aiAvailability, 'optional-core-must-work-without-ai');
assert.equal(manifest.policies?.aiProviderPolicy, 'consumer-configured-free-only');
assert.equal(manifest.consumerRules?.applicationToApplicationDependencyForbidden, true);
assert.equal(manifest.consumerRules?.platformAdaptersMustEmitRecognitionDocument, true);
assert.equal(manifest.consumerRules?.unknownValuesMustRemainUnknown, true);
assert.equal(manifest.consumerRules?.dateWriteRequiresConfirmedDecision, true);
assert.equal(manifest.consumerRules?.consumerMustPinImmutableRelease, true);
assert.equal(manifest.consumerRules?.consumerMustNotLoadMainOrLatestAtRuntime, true);
assert.equal(manifest.consumerRules?.sameRevisionSameHashIsIdempotent, true);
assert.equal(manifest.consumerRules?.sameRevisionDifferentHashIsConflict, true);
assert.equal(manifest.runtime?.dependencies?.length, 0);
assert.ok(exists(path.posix.join('foundation', manifest.runtime?.entry)), 'foundation runtime entry missing');

for (const locale of ['zh-Hans', 'en', 'ja', 'ko']) {
  assert.ok(manifest.locales?.supported?.includes(locale), `missing locale ${locale}`);
}

const contracts = manifest.contracts || {};
const schemaContracts = [
  ['recognitionDocument', 'recognition-document/1.1'],
  ['canonicalCoffeeRecord', 'coffee-canonical-record/1.0'],
  ['dateDecision', 'coffee-date-decision/1.0'],
  ['aiEnrichmentResult', 'ai-enrichment-result/1.0'],
  ['recognitionBook', 'recognition-book/1.0'],
  ['fieldDecision', 'coffee-field-decision/1.0'],
  ['foundationCandidate', 'coffee-foundation-candidate/1.0'],
  ['syncRevision', 'coffee-sync-revision/1.0'],
  ['archive', 'coffee-archive/1.0'],
  ['migrationResult', 'coffee-migration-result/1.0']
];

for (const [key, expectedContract] of schemaContracts) {
  const entry = contracts[key];
  assert.equal(entry?.contract, expectedContract, `${key} contract drift`);
  const schemaPath = path.posix.join('foundation', entry.schema);
  assert.ok(exists(schemaPath), `${key} schema missing: ${schemaPath}`);
  const schema = readJson(schemaPath);
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
}

const recognition = readJson('foundation/schemas/recognition-document-v1.1.schema.json');
assert.equal(recognition.properties?.schemaVersion?.const, 'recognition-document/1.1');
assert.equal(recognition.additionalProperties, false);
for (const field of ['schemaVersion', 'parserVersion', 'engine', 'createdAt', 'images', 'blocks', 'fullText']) {
  assert.ok(recognition.required.includes(field), `RecognitionDocument missing required field ${field}`);
}
const roleEnum = recognition.properties?.images?.items?.properties?.role?.enum || [];
for (const role of ['front', 'back', 'side', 'date', 'text']) assert.ok(roleEnum.includes(role), `missing role ${role}`);
for (const field of ['box', 'fieldAnchor', 'fieldAnchorConfidence']) {
  assert.ok(field in recognition.properties?.blocks?.items?.properties, `RecognitionDocument schema rejects consumer block.${field}`);
}
for (const field of ['id', 'imageId', 'imageRole', 'label', 'mode', 'score']) {
  assert.ok(field in recognition.properties?.relations?.items?.properties, `RecognitionDocument schema rejects consumer relation.${field}`);
}

const canonical = readJson('foundation/schemas/coffee-canonical-record-v1.schema.json');
assert.equal(canonical.properties?.schemaVersion?.const, 'coffee-canonical-record/1.0');
for (const field of ['id', 'countryCode', 'regionCode', 'entityCode', 'varietyCode', 'processCode', 'roastCode', 'altitude', 'roastDate', 'flavorTags', 'cropSeason', 'evidence', 'review']) {
  assert.ok(canonical.required.includes(field), `Canonical record missing ${field}`);
}

const dateDecision = readJson('foundation/schemas/coffee-date-decision-v1.schema.json');
assert.equal(dateDecision.properties?.schemaVersion?.const, 'coffee-date-decision/1.0');
assert.equal(dateDecision.additionalProperties, false);
for (const field of ['rawValue', 'normalizedValue', 'detectedLabel', 'status', 'reason', 'canonicalDate', 'components', 'candidates', 'evidenceRefs']) {
  assert.ok(dateDecision.required.includes(field), `Date decision missing ${field}`);
}
assert.ok(exists('foundation/runtime/date-parser.mjs'), 'date parser runtime missing');
assert.ok(exists('foundation/DATE_COMPATIBILITY.md'), 'date compatibility specification missing');
assert.ok(exists('foundation/runtime/ai-adapter.mjs'), 'AI adapter runtime missing');
const defectDictionary = readJson('foundation/dictionaries/defect-dictionary-v1.json');
assert.equal(defectDictionary.schemaVersion, 'coffee-defect-dictionary/1.0');
assert.ok(defectDictionary.items.length >= 9, 'defect dictionary coverage regressed');
assert.equal(new Set(defectDictionary.items.map((item) => item.id)).size, defectDictionary.items.length, 'duplicate defect id');
for (const item of defectDictionary.items) {
  assert.ok(item.names?.['zh-Hans'] && item.names?.en, `defect ${item.id} lacks bilingual canonical names`);
}

const ai = readJson('foundation/schemas/ai-enrichment-result-v1.schema.json');
assert.equal(ai.properties?.schemaVersion?.const, 'ai-enrichment-result/1.0');
assert.equal(ai.properties?.policy?.properties?.authority?.const, 'advisory');
assert.equal(ai.properties?.policy?.properties?.mayOverwriteFact?.const, false);

const recognitionBook = readJson('foundation/schemas/recognition-book-v1.schema.json');
assert.equal(recognitionBook.properties?.schemaVersion?.const, 'recognition-book/1.0');
const fieldDecision = readJson('foundation/schemas/coffee-field-decision-v1.schema.json');
assert.equal(fieldDecision.properties?.schemaVersion?.const, 'coffee-field-decision/1.0');
const candidate = readJson('foundation/schemas/foundation-candidate-v1.schema.json');
assert.equal(candidate.properties?.schemaVersion?.const, 'coffee-foundation-candidate/1.0');
const syncRevision = readJson('foundation/schemas/sync-revision-v1.schema.json');
assert.equal(syncRevision.properties?.schemaVersion?.const, 'coffee-sync-revision/1.0');
const archive = readJson('foundation/schemas/coffee-archive-v1.schema.json');
assert.equal(archive.properties?.schemaVersion?.const, 'coffee-archive/1.0');
const migration = readJson('foundation/schemas/migration-result-v1.schema.json');
assert.equal(migration.properties?.schemaVersion?.const, 'coffee-migration-result/1.0');

const provider = readJson('provider/releases/latest.json');
assert.equal(contracts.codebookProvider?.contract, 'coffee-codebook/1.0');
assert.equal(provider.contract, contracts.codebookProvider.contract);
assert.equal(provider.provider, 'brewion');
assert.equal(provider.appendOnly, true);
assert.ok(Array.isArray(provider.artifacts) && provider.artifacts.length > 0);
for (const artifact of provider.artifacts) {
  assert.ok(isSha256(artifact.sha256), `provider artifact lacks valid sha256: ${artifact.path || artifact.kind}`);
}

const knowledge = readJson('coffee-knowledge/releases/latest.json');
assert.equal(contracts.coffeeKnowledge?.contract, 'coffee-knowledge/1.0');
assert.equal(knowledge.contract, contracts.coffeeKnowledge.contract);
assert.equal(knowledge.provider, 'brewion');
assert.ok(isSha256(knowledge.artifact?.sha256), 'coffee knowledge artifact lacks valid sha256');
assert.equal(knowledge.compatibility?.localizationPolicy, 'ai-candidates-never-overwrite-official-names');

const registry = readJson('foundation/registry-entry.json');
assert.equal(registry.contract, manifest.contract);
assert.equal(registry.required, true);
assert.equal(registry.failurePolicy, 'retain-last-known-good');
assert.equal(registry.updatePolicy, 'background-check-stage-verify-atomic-activate');
assert.match(registry.releaseId, /^coffee-foundation-\d+\.\d+\.\d+$/);
assert.match(registry.manifestUrl, new RegExp(`zjcrop/BrewIon/[a-f0-9]{40}/foundation/releases/${registry.releaseId.replaceAll('.', '\\.')}\\.json$`));
assert.doesNotMatch(registry.manifestUrl, /\/(?:main|latest)\//);

const release = readJson(manifest.authority.releaseManifest);
const latestRelease = readJson('foundation/releases/latest.json');
assert.deepEqual(latestRelease, release, 'latest discovery pointer differs from the stable versioned release');
assert.equal(release.schemaVersion, 'coffee-foundation-candidate/1.0');
assert.equal(release.contract, manifest.contract);
assert.equal(release.releaseId, registry.releaseId);
assert.ok(release.artifacts.length >= 25, 'foundation release is missing required artifacts');
for (const item of release.artifacts) {
  assert.match(item.url, /^https:\/\/raw\.githubusercontent\.com\/zjcrop\/BrewIon\/[a-f0-9]{40}\//, `artifact is not immutable: ${item.kind}`);
  assert.doesNotMatch(item.url, /\/(?:main|latest)\//, `artifact follows mutable branch: ${item.kind}`);
  assert.ok(exists(item.kind), `release artifact missing locally: ${item.kind}`);
  const actual = fileIntegrity(item.kind);
  assert.equal(item.bytes, actual.bytes, `release artifact byte drift: ${item.kind}`);
  assert.equal(item.sha256, actual.sha256, `release artifact SHA-256 drift: ${item.kind}`);
}

console.log(JSON.stringify({
  ok: true,
  foundation: manifest.contract,
  recognition: contracts.recognitionDocument.contract,
  canonical: contracts.canonicalCoffeeRecord.contract,
  dateDecision: contracts.dateDecision.contract,
  ai: contracts.aiEnrichmentResult.contract,
  recognitionBook: contracts.recognitionBook.contract,
  fieldDecision: contracts.fieldDecision.contract,
  syncRevision: contracts.syncRevision.contract,
  archive: contracts.archive.contract,
  migration: contracts.migrationResult.contract,
  codebook: provider.releaseId,
  knowledge: knowledge.version
}, null, 2));
