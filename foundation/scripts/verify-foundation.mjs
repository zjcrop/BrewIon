import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const exists = (relative) => fs.existsSync(path.join(root, relative));
const isSha256 = (value) => /^[a-f0-9]{64}$/i.test(String(value || ''));

const manifest = readJson('foundation/foundation-manifest.json');
assert.equal(manifest._format, 'coffee-foundation-manifest');
assert.equal(manifest._schemaVersion, 1);
assert.equal(manifest.provider, 'brewion');
assert.equal(manifest.contract, 'coffee-foundation/1.0');
assert.equal(manifest.status, 'stable');
assert.equal(manifest.authority?.repository, 'zjcrop/BrewIon');
assert.equal(manifest.authority?.ref, 'main');

assert.equal(manifest.policies?.stableId, 'immutable');
assert.equal(manifest.policies?.indexedTables, 'append-only');
assert.equal(manifest.policies?.lowConfidence, 'review-only');
assert.equal(manifest.policies?.conflict, 'review-only');
assert.equal(manifest.policies?.aiAuthority, 'advisory-only-never-overwrite-fact');
assert.equal(manifest.policies?.artifactIntegrity, 'sha256-required');
assert.equal(manifest.policies?.failure, 'retain-last-known-good');
assert.equal(manifest.consumerRules?.applicationToApplicationDependencyForbidden, true);
assert.equal(manifest.consumerRules?.platformAdaptersMustEmitRecognitionDocument, true);
assert.equal(manifest.consumerRules?.unknownValuesMustRemainUnknown, true);

for (const locale of ['zh-Hans', 'en', 'ja', 'ko']) {
  assert.ok(manifest.locales?.supported?.includes(locale), `missing locale ${locale}`);
}

const contracts = manifest.contracts || {};
const schemaContracts = [
  ['recognitionDocument', 'recognition-document/1.1'],
  ['canonicalCoffeeRecord', 'coffee-canonical-record/1.0'],
  ['aiEnrichmentResult', 'ai-enrichment-result/1.0']
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

const canonical = readJson('foundation/schemas/coffee-canonical-record-v1.schema.json');
assert.equal(canonical.properties?.schemaVersion?.const, 'coffee-canonical-record/1.0');
for (const field of ['id', 'countryCode', 'regionCode', 'entityCode', 'varietyCode', 'processCode', 'roastCode', 'altitude', 'roastDate', 'flavorTags', 'cropSeason', 'evidence', 'review']) {
  assert.ok(canonical.required.includes(field), `Canonical record missing ${field}`);
}

const ai = readJson('foundation/schemas/ai-enrichment-result-v1.schema.json');
assert.equal(ai.properties?.schemaVersion?.const, 'ai-enrichment-result/1.0');
assert.equal(ai.properties?.policy?.properties?.authority?.const, 'advisory');
assert.equal(ai.properties?.policy?.properties?.mayOverwriteFact?.const, false);

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
assert.match(registry.manifestUrl, /zjcrop\/BrewIon\/main\/foundation\/foundation-manifest\.json$/);

console.log(JSON.stringify({
  ok: true,
  foundation: manifest.contract,
  recognition: contracts.recognitionDocument.contract,
  canonical: contracts.canonicalCoffeeRecord.contract,
  ai: contracts.aiEnrichmentResult.contract,
  codebook: provider.releaseId,
  knowledge: knowledge.version
}, null, 2));
