import { sha256Text } from './artifact-activation.mjs';

export const SYNC_REVISION_CONTRACT = 'coffee-sync-revision/1.0';
export const ARCHIVE_CONTRACT = 'coffee-archive/1.0';
export const CANONICAL_HASH_ALGORITHM = 'sha256-canonical-json-v1';

function canonical(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

export async function contentHash(value) {
  return sha256Text(canonicalJson(value));
}

export async function createSyncRevision({ revisionId, parentRevisionId = null, entityType, entityId, sequence = 0, createdAt = new Date().toISOString(), payloadContract, payload, tombstone = false, extensions } = {}) {
  if (!revisionId || !entityType || !entityId || !payloadContract) throw new Error('revisionId, entityType, entityId and payloadContract are required');
  const hashPayload = { entityType, entityId, sequence, payloadContract, payload, tombstone };
  return {
    schemaVersion: SYNC_REVISION_CONTRACT,
    revisionId: String(revisionId),
    parentRevisionId: parentRevisionId == null ? null : String(parentRevisionId),
    entityType: String(entityType),
    entityId: String(entityId),
    sequence: Number(sequence),
    createdAt: String(createdAt),
    hashAlgorithm: CANONICAL_HASH_ALGORITHM,
    contentHash: await contentHash(hashPayload),
    payloadContract: String(payloadContract),
    payload,
    tombstone: Boolean(tombstone),
    ...(extensions && typeof extensions === 'object' ? { extensions } : {})
  };
}

export function compareSyncRevision(existing, incoming) {
  if (!existing) return { ok: true, status: 'created', revisionId: incoming.revisionId, contentHash: incoming.contentHash };
  if (existing.revisionId !== incoming.revisionId) throw new Error('compareSyncRevision requires the same revisionId');
  if (existing.contentHash === incoming.contentHash) return { ok: true, status: 'already_present', revisionId: incoming.revisionId, contentHash: incoming.contentHash };
  return {
    ok: false,
    error: 'REVISION_CONFLICT',
    revisionId: incoming.revisionId,
    existingHash: existing.contentHash,
    incomingHash: incoming.contentHash
  };
}

export async function createCoffeeArchive({ archiveId, createdAt = new Date().toISOString(), producer, foundationReleaseId, records = [], extensions } = {}) {
  if (!archiveId || !producer || !foundationReleaseId) throw new Error('archiveId, producer and foundationReleaseId are required');
  const outputRecords = [];
  for (const item of records) {
    outputRecords.push({
      recordId: String(item.recordId),
      recordContract: String(item.recordContract),
      hashAlgorithm: CANONICAL_HASH_ALGORITHM,
      contentHash: await contentHash(item.record),
      record: item.record
    });
  }
  return {
    schemaVersion: ARCHIVE_CONTRACT,
    archiveId: String(archiveId),
    createdAt: String(createdAt),
    producer: String(producer),
    foundationReleaseId: String(foundationReleaseId),
    records: outputRecords,
    ...(extensions && typeof extensions === 'object' ? { extensions } : {})
  };
}

export async function verifyCoffeeArchive(archive, { supportedContractMajors = {} } = {}) {
  if (archive?.schemaVersion !== ARCHIVE_CONTRACT) throw new Error('Unsupported coffee archive contract');
  for (const item of archive.records || []) {
    const expectedMajor = supportedContractMajors[item.recordContract.split('/')[0]];
    if (expectedMajor != null) {
      const actual = Number(item.recordContract.split('/')[1]?.split('.')[0]);
      if (actual !== expectedMajor) throw new Error(`Unsupported record contract: ${item.recordContract}`);
    }
    if (item.hashAlgorithm !== CANONICAL_HASH_ALGORITHM) throw new Error(`Unsupported record hash algorithm: ${item.hashAlgorithm}`);
    if (await contentHash(item.record) !== item.contentHash) throw new Error(`Archive record hash mismatch: ${item.recordId}`);
  }
  return { ok: true, recordCount: archive.records.length };
}

