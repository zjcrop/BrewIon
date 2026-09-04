import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  adaptRecognitionDocument,
  assertCompatibleContract,
  buildRecognitionBook,
  compareSyncRevision,
  createCoffeeArchive,
  createAtomicFoundationActivator,
  createNormalizationAdapter,
  createSyncRevision,
  normalizeMatchKey,
  parseCoffeeDate,
  resolveRecognitionValue,
  sha256Text,
  verifyArtifactText,
  verifyCoffeeArchive
} from '../runtime/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const json = (relative) => JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));
const codebook = json('coffee-qr-codebook/coffee_qr_codebook_v6.json');
const lexicon = json('coffee-qr-codebook/coffee_label_lexicon_v1.json');
const knowledge = json('coffee-knowledge/releases/coffee-knowledge-1.0.0-alpha.7.json');

test('normalization is deterministic across Chinese, English, Japanese and Korean input', () => {
  const ja = createNormalizationAdapter({ locale: 'ja-JP' });
  const ko = createNormalizationAdapter({ locale: 'ko-KR' });
  assert.equal(ja.normalize(' Ｇｅｉｓｈａ ').matchKey, 'geisha');
  assert.equal(ko.normalize('카보닉  매서레이션').matchKey, '카보닉매서레이션');
  assert.equal(normalizeMatchKey('二氧化碳・浸渍'), '二氧化碳浸渍');
  assert.equal(createNormalizationAdapter({ locale: 'zh-CN' }).normalize('烘培日期').display, '烘焙日期');
});

test('date parser supports Chinese ordinary, financial and omitted-year forms', () => {
  for (const value of ['2026年7月15日', '二〇二六年七月十五日', '贰零贰陆年柒月拾伍日', '二千零二十六年七月十五日']) {
    const decision = parseCoffeeDate(value, { locale: 'zh-CN', field: 'roastDate' });
    assert.equal(decision.status, 'confirmed', value);
    assert.equal(decision.canonicalDate, '2026-07-15', value);
  }
  const partial = parseCoffeeDate('烘焙日期：柒月拾伍日', { locale: 'zh-CN', field: 'roastDate' });
  assert.equal(partial.status, 'review');
  assert.equal(partial.reason, 'missing-year');
  assert.deepEqual(partial.components, { year: null, month: 7, day: 15 });
  const inferred = parseCoffeeDate('七月十五日', { locale: 'zh-CN', field: 'roastDate', referenceDate: '2026-07-14', inferMissingYear: true });
  assert.equal(inferred.status, 'review');
  assert.equal(inferred.canonicalDate, '2025-07-15');
  assert.equal(inferred.reason, 'year-inferred-from-reference-requires-confirmation');
});

test('date parser supports English month names and blocks unresolved numeric order', () => {
  for (const value of ['July 15, 2026', '15th July 2026', '15 JUL 2026', '2026 JUL 15']) {
    const decision = parseCoffeeDate(value, { locale: 'en', field: 'roastDate' });
    assert.equal(decision.status, 'confirmed', value);
    assert.equal(decision.canonicalDate, '2026-07-15', value);
  }
  assert.equal(parseCoffeeDate('03/04/2026', { locale: 'en' }).status, 'conflict');
  assert.equal(parseCoffeeDate('03/04/2026', { locale: 'en-US' }).canonicalDate, '2026-03-04');
  assert.equal(parseCoffeeDate('03/04/2026', { locale: 'en-GB' }).canonicalDate, '2026-04-03');
  assert.equal(parseCoffeeDate('15 JUL 26', { locale: 'en' }).reason, 'two-digit-year-requires-confirmation');
});

test('date parser supports Japanese eras and Korean written dates', () => {
  for (const value of ['令和8年7月15日', 'R8.7.15']) {
    const decision = parseCoffeeDate(value, { locale: 'ja-JP', field: 'roastDate' });
    assert.equal(decision.status, 'confirmed', value);
    assert.equal(decision.canonicalDate, '2026-07-15', value);
  }
  assert.equal(parseCoffeeDate('平成31年5月1日', { locale: 'ja-JP' }).reason, 'date-outside-calendar-era');
  for (const value of ['2026년 7월 15일', '이천이십육년 칠월 십오일']) {
    const decision = parseCoffeeDate(value, { locale: 'ko-KR', field: 'roastDate' });
    assert.equal(decision.status, 'confirmed', value);
    assert.equal(decision.canonicalDate, '2026-07-15', value);
  }
  for (const value of ['民國115年7月15日', 'ROC 115/7/15']) {
    const decision = parseCoffeeDate(value, { locale: 'zh-TW', field: 'roastDate' });
    assert.equal(decision.status, 'confirmed', value);
    assert.equal(decision.canonicalDate, '2026-07-15', value);
  }
});

test('date parser preserves field and calendar safety boundaries', () => {
  const mismatch = parseCoffeeDate('Best before: July 15, 2026', { locale: 'en', field: 'roastDate' });
  assert.equal(mismatch.status, 'review');
  assert.equal(mismatch.reason, 'date-label-field-mismatch');
  assert.equal(mismatch.detectedLabel.field, 'bestBeforeDate');
  assert.equal(mismatch.candidates[0].canonicalDate, '2026-07-15');
  assert.equal(parseCoffeeDate('农历七月十五日', { locale: 'zh-CN', field: 'roastDate' }).reason, 'unsupported-non-gregorian-calendar');
  assert.equal(parseCoffeeDate('烘焙日期：昨天', { locale: 'zh-CN', field: 'roastDate' }).reason, 'relative-date-requires-explicit-date');
  assert.equal(parseCoffeeDate('2026-02-30', { locale: 'en' }).status, 'invalid');
  assert.equal(parseCoffeeDate('Best before: 2026-02-30', { locale: 'en', field: 'roastDate' }).status, 'invalid');
  assert.equal(parseCoffeeDate('03/04/26', { locale: 'en' }).status, 'conflict');
});

test('date expression corpus remains compatible across supported scripts', () => {
  const expressions = [
    '2026年7月15日', '二〇二六年七月十五日', '二零二六年七月十五号',
    '贰零贰陆年柒月拾伍日', '貳零貳陸年柒月拾伍日', '二千零二十六年七月十五',
    '２０２６年７月１５日', '2026/07/15', '2026.7.15', '20260715',
    'July 15, 2026', 'Jul 15 2026', 'Jul. 15th, 2026', '15 July 2026',
    '15th of July, 2026', '15-JUL-2026', 'JUL-15-2026', '2026 JUL 15', '2026-07-15',
    '令和8年7月15日', '令和八年七月十五日', 'R8.7.15', 'R8年7月15日',
    '2026년 7월 15일', '이천이십육년 칠월 십오일', '2026. 7. 15.',
    '民國115年7月15日', '民国一百一十五年七月十五日', 'ROC 115/7/15'
  ];
  for (const value of expressions) {
    const decision = parseCoffeeDate(value, { locale: 'en' });
    assert.equal(decision.status, 'confirmed', value);
    assert.equal(decision.canonicalDate, '2026-07-15', value);
  }
});

test('RecognitionBook preserves every frozen core code and QR row index', () => {
  const book = buildRecognitionBook({ codebook, lexicon, knowledge });
  assert.equal(book.schemaVersion, 'recognition-book/1.0');
  for (const [table, field] of Object.entries({ countries: 'country', regions: 'region', entities: 'entity', varieties: 'variety', processes: 'process', flavors: 'flavor' })) {
    const entries = book.entries.filter((entry) => entry.coreTable === table);
    assert.equal(entries.length, codebook[table].length, `${table} row count changed`);
    entries.forEach((entry, index) => {
      assert.equal(entry.field, field);
      assert.equal(entry.coreCode, codebook[table][index][0]);
      assert.equal(entry.qrIndex, index + 1);
      assert.equal(entry.qrEligible, true);
    });
  }
});

test('verified localized aliases resolve to existing core IDs', () => {
  const book = buildRecognitionBook({ codebook, lexicon, knowledge });
  const decision = resolveRecognitionValue(book, { field: 'variety', value: '瑰夏', locale: 'zh-CN', evidenceRefs: ['block-1'] });
  assert.equal(decision.status, 'confirmed');
  assert.equal(decision.selected?.coreCode, 'VA-GE');
  assert.equal(decision.selected?.qrEligible, true);
  assert.deepEqual(decision.evidenceRefs, ['block-1']);
});

test('application field names normalize to shared Foundation fields', () => {
  const book = buildRecognitionBook({ codebook, lexicon, knowledge });
  const farm = resolveRecognitionValue(book, { field: 'farm', value: 'Mountain Top Estate', locale: 'en' });
  assert.equal(farm.field, 'entity');
  assert.equal(farm.status, 'confirmed');
  assert.equal(farm.selected?.coreCode, 'ST-AU-MTN');
  const aroma = resolveRecognitionValue(book, { field: 'aroma', value: 'Sweet', locale: 'en' });
  assert.equal(aroma.field, 'flavor');
  assert.equal(aroma.selected?.coreCode, 'FV-001');
});

test('knowledge-only varieties can never acquire a QR/core code automatically', () => {
  const book = buildRecognitionBook({ codebook, lexicon, knowledge });
  const decision = resolveRecognitionValue(book, { field: 'variety', value: 'Anacafe 14', locale: 'en' });
  assert.equal(decision.status, 'review');
  assert.equal(decision.reason, 'knowledge-only-manual-confirmation');
  assert.equal(decision.selected?.coreCode, null);
  assert.equal(decision.selected?.qrEligible, false);
  assert.equal(decision.selected?.knowledgeOnly, true);
});

test('ambiguous aliases remain conflicts instead of silently choosing a code', () => {
  const book = {
    schemaVersion: 'recognition-book/1.0',
    entries: [
      { field: 'entity', canonicalId: 'A', coreCode: 'ST-A', names: ['San Jose'], aliases: [], confidence: 1, qrEligible: true, knowledgeOnly: false, automaticResolution: 'allowed' },
      { field: 'entity', canonicalId: 'B', coreCode: 'ST-B', names: ['San Jose'], aliases: [], confidence: 1, qrEligible: true, knowledgeOnly: false, automaticResolution: 'allowed' }
    ]
  };
  const decision = resolveRecognitionValue(book, { field: 'entity', value: 'San Jose' });
  assert.equal(decision.status, 'conflict');
  assert.equal(decision.selected, null);
  assert.equal(decision.candidates.length, 2);
});

test('RecognitionDocument adapter emits fields accepted by the 1.1 schema', () => {
  const document = adaptRecognitionDocument({
    parserVersion: 'luckybean-test',
    engine: 'manual-text',
    images: [{ id: 'front', role: 'front', roleLabel: '正面' }],
    blocks: [{
      id: 'front:block-1', imageId: 'front', imageRole: 'front', order: 0,
      text: 'VARIETY: Gesha', confidence: 0.98, polygon: null, box: null,
      fieldAnchor: 'variety', fieldAnchorConfidence: 1, engine: 'manual-text'
    }],
    relations: [{ field: 'variety', value: 'Gesha', score: 0.98 }]
  });
  const schema = json('foundation/schemas/recognition-document-v1.1.schema.json');
  assert.equal(document.schemaVersion, 'recognition-document/1.1');
  for (const key of Object.keys(document.blocks[0])) assert.ok(key in schema.properties.blocks.items.properties, `schema rejects block.${key}`);
  for (const key of Object.keys(document.relations[0])) assert.ok(key in schema.properties.relations.items.properties, `schema rejects relation.${key}`);
});

test('artifact verification rejects byte and digest drift', async () => {
  const text = '{"ok":true}\n';
  const descriptor = { bytes: new TextEncoder().encode(text).byteLength, sha256: await sha256Text(text) };
  assert.deepEqual(await verifyArtifactText(text, descriptor), descriptor);
  await assert.rejects(() => verifyArtifactText(`${text} `, descriptor), /byte mismatch/);
  await assert.rejects(() => verifyArtifactText('{"ok":fals}\n', descriptor), /SHA-256 mismatch/);
});

test('migration gate accepts compatible minors and rejects unknown majors or families', () => {
  assert.equal(assertCompatibleContract('coffee-foundation/1.0', 'coffee-foundation/1.9'), true);
  assert.throws(() => assertCompatibleContract('coffee-foundation/1.0', 'coffee-foundation/2.0'), /Incompatible contract/);
  assert.throws(() => assertCompatibleContract('coffee-foundation/1.0', 'other/1.0'), /Incompatible contract/);
});

test('atomic activation retains the last verified release after a bad candidate', async () => {
  let active = { releaseId: 'foundation-good' };
  const staged = new Map();
  const storage = {
    async readActive() { return active; },
    async stage(value) { staged.set(value.releaseId, value); },
    async activate(releaseId) { active = staged.get(releaseId); },
    async discard(releaseId) { staged.delete(releaseId); }
  };
  const activator = createAtomicFoundationActivator(storage);
  const result = await activator.install({
    schemaVersion: 'coffee-foundation-candidate/1.0',
    contract: 'coffee-foundation/1.0',
    releaseId: 'foundation-bad',
    artifacts: [{ kind: 'manifest', url: 'memory:test', bytes: 2, sha256: '0'.repeat(64) }]
  }, { loadArtifact: async () => '{}' });
  assert.equal(result.ok, false);
  assert.equal(result.retainedReleaseId, 'foundation-good');
  assert.equal((await activator.active()).releaseId, 'foundation-good');
});

test('sync revisions are deterministic, idempotent and conflict-safe', async () => {
  const base = {
    revisionId: 'rev-1', entityType: 'bean', entityId: 'bean-1', sequence: 1,
    createdAt: '2026-09-04T00:00:00.000Z', payloadContract: 'coffee-canonical-record/1.0'
  };
  const first = await createSyncRevision({ ...base, payload: { b: 2, a: 1 } });
  const replay = await createSyncRevision({ ...base, payload: { a: 1, b: 2 } });
  assert.equal(first.contentHash, replay.contentHash);
  assert.equal(compareSyncRevision(first, replay).status, 'already_present');
  const changed = await createSyncRevision({ ...base, payload: { a: 1, b: 3 } });
  assert.equal(compareSyncRevision(first, changed).error, 'REVISION_CONFLICT');
});

test('archive verification detects record mutation before import', async () => {
  const archive = await createCoffeeArchive({
    archiveId: 'archive-1', producer: 'foundation-test', foundationReleaseId: 'coffee-foundation-1.0.1',
    records: [{ recordId: 'bean-1', recordContract: 'coffee-canonical-record/1.0', record: { id: 'bean-1', label: 'Gesha' } }]
  });
  assert.deepEqual(await verifyCoffeeArchive(archive, { supportedContractMajors: { 'coffee-canonical-record': 1 } }), { ok: true, recordCount: 1 });
  archive.records[0].record.label = 'mutated';
  await assert.rejects(() => verifyCoffeeArchive(archive), /hash mismatch/);
});
