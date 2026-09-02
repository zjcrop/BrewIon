#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const core = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'coffee-qr-codebook/coffee_qr_codebook_v6.json'), 'utf8'));
const knowledgeDir = path.resolve(ROOT, 'coffee-knowledge');
const manifest = JSON.parse(fs.readFileSync(path.join(knowledgeDir, 'knowledge-manifest_v1.json'), 'utf8'));
const knowledge = JSON.parse(fs.readFileSync(path.resolve(knowledgeDir, manifest.mainKnowledge), 'utf8'));
const identities = JSON.parse(fs.readFileSync(path.resolve(knowledgeDir, manifest.entityIdentityModule), 'utf8'));
const catalogModules = (manifest.catalogModules || []).map((modulePath) => JSON.parse(fs.readFileSync(path.resolve(knowledgeDir, modulePath), 'utf8')));

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((x) => x.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}
function rowToObject(row, index) {
  const columns = core._columns?.entities || [];
  return { ...Object.fromEntries(columns.map((name, i) => [name, row[i] ?? null])), qrIndex: index + 1 };
}
function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[\s\-_/.,;:()\[\]{}&]+/g, '')
    .trim();
}
function isPlaceholder(entity) {
  return /placeholder|generic/i.test(String(entity.entityType || ''));
}
function isCandidate(entity) {
  return String(entity.status || '').toLowerCase() === 'candidate';
}

const entities = (core.entities || []).map(rowToObject);
const groupedByCode = new Map();
for (const group of identities.groups || []) {
  for (const code of group.coreCodes || []) groupedByCode.set(code, group);
}

const entityKnowledgeRecords = [
  ...(knowledge.entityDetails || []),
  ...catalogModules.flatMap((module) => module.entityDetails || [])
].filter((record) => record?.coreCode);
const verifiedKnowledgeByCode = new Map();
for (const record of entityKnowledgeRecords) {
  const confidence = Number(record.confidence ?? 0);
  if (confidence < 0.9) continue;
  const evidence = String(record.evidenceStatus || 'knowledge_enriched');
  if (/candidate_only|pending_source|legacy_core/i.test(evidence)) continue;
  verifiedKnowledgeByCode.set(String(record.coreCode), record);
}

const enGroups = new Map();
const zhGroups = new Map();
for (const entity of entities) {
  const enKey = `${entity.countryCode}|${normalize(entity.nameEn)}`;
  const zhKey = `${entity.countryCode}|${normalize(entity.nameZh)}`;
  if (normalize(entity.nameEn)) {
    if (!enGroups.has(enKey)) enGroups.set(enKey, []);
    enGroups.get(enKey).push(entity);
  }
  if (normalize(entity.nameZh)) {
    if (!zhGroups.has(zhKey)) zhGroups.set(zhKey, []);
    zhGroups.get(zhKey).push(entity);
  }
}

const flagged = entities.filter((entity) => isPlaceholder(entity) || isCandidate(entity));
const queue = flagged.map((entity) => {
  const identity = groupedByCode.get(entity.code) || null;
  const verifiedKnowledge = verifiedKnowledgeByCode.get(entity.code) || null;
  const peers = new Map();
  const en = enGroups.get(`${entity.countryCode}|${normalize(entity.nameEn)}`) || [];
  const zh = zhGroups.get(`${entity.countryCode}|${normalize(entity.nameZh)}`) || [];
  for (const peer of [...en, ...zh]) if (peer.code !== entity.code) peers.set(peer.code, peer);
  const exactPeers = [...peers.values()];
  const establishedPeers = exactPeers.filter((peer) => !isPlaceholder(peer) && !isCandidate(peer) && String(peer.status || '').toLowerCase() === 'active');
  const flaggedPeers = exactPeers.filter((peer) => isPlaceholder(peer) || isCandidate(peer));

  let reviewClass = 'source_required';
  let priority = 50;
  if (identity) { reviewClass = 'canonical_identity_already_resolved'; priority = 100; }
  else if (verifiedKnowledge) { reviewClass = 'knowledge_verified_core_candidate_retained'; priority = 95; }
  else if (establishedPeers.length) { reviewClass = 'exact_duplicate_with_established_review'; priority = 90; }
  else if (flaggedPeers.length) { reviewClass = 'exact_duplicate_among_flagged_review'; priority = 80; }
  else if (isCandidate(entity) && !isPlaceholder(entity)) { reviewClass = 'named_candidate_source_review'; priority = 65; }
  else if (isCandidate(entity) && isPlaceholder(entity)) { reviewClass = 'placeholder_candidate_source_review'; priority = 60; }

  return {
    priority,
    reviewClass,
    code: entity.code,
    qrIndex: entity.qrIndex,
    countryCode: entity.countryCode,
    entityType: entity.entityType,
    status: entity.status,
    nameZh: entity.nameZh,
    nameEn: entity.nameEn,
    existingCanonicalIdentityId: identity?.canonicalIdentityId || null,
    verifiedKnowledgeId: verifiedKnowledge?.id || null,
    verifiedKnowledgeEvidenceStatus: verifiedKnowledge?.evidenceStatus || null,
    exactEstablishedPeerCodes: establishedPeers.map((peer) => peer.code),
    exactFlaggedPeerCodes: flaggedPeers.map((peer) => peer.code),
    automaticCoreMutationAllowed: false,
    requiredNextEvidence: identity
      ? 'none_identity_layer_already_resolves_display_deduplication'
      : verifiedKnowledge
        ? 'none_for_entity_existence_core_candidate_status_remains_frozen'
        : establishedPeers.length
          ? 'authoritative_or_independently_corroborated_identity_evidence_before_canonical_grouping'
          : 'authoritative_or_independently_corroborated_entity_evidence'
  };
}).sort((a, b) => b.priority - a.priority || a.qrIndex - b.qrIndex);

const countsByClass = Object.fromEntries([...new Set(queue.map((x) => x.reviewClass))].sort().map((key) => [key, queue.filter((x) => x.reviewClass === key).length]));
const placeholderCount = entities.filter(isPlaceholder).length;
const candidateCount = entities.filter(isCandidate).length;
const overlapCount = entities.filter((x) => isPlaceholder(x) && isCandidate(x)).length;
const namedCandidateCount = entities.filter((x) => isCandidate(x) && !isPlaceholder(x)).length;
const alreadyCanonical = queue.filter((x) => x.reviewClass === 'canonical_identity_already_resolved').length;
const knowledgeVerified = queue.filter((x) => x.reviewClass === 'knowledge_verified_core_candidate_retained').length;
const resolvedAtKnowledgeLayer = alreadyCanonical + knowledgeVerified;
const unresolved = queue.length - resolvedAtKnowledgeLayer;
const unresolvedNamedCandidates = queue.filter((x) => x.reviewClass === 'named_candidate_source_review').length;

const report = {
  _format: 'coffee-legacy-entity-resolution-queue',
  _schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  coreVersion: String(core.version || ''),
  knowledgeVersion: String(manifest.version || ''),
  policy: {
    qrCompatibility: 'Read-only audit. No core row is deleted, reordered, renamed or re-coded.',
    evidenceBoundary: 'Exact-name equality is only a review signal. It never proves physical entity identity by itself.',
    knowledgeResolution: 'A source-verified knowledge enrichment may resolve entity-existence review while the frozen v6 candidate/status remains untouched.',
    automation: 'No unresolved legacy entity may be promoted, merged or rewritten automatically.'
  },
  summary: {
    totalEntities: entities.length,
    placeholderEntities: placeholderCount,
    candidateEntities: candidateCount,
    placeholderCandidateOverlap: overlapCount,
    namedCandidateEntities: namedCandidateCount,
    flaggedUniqueEntities: queue.length,
    canonicalIdentityAlreadyResolved: alreadyCanonical,
    knowledgeVerifiedCoreCandidatesRetained: knowledgeVerified,
    resolvedAtKnowledgeLayer,
    unresolvedFlaggedEntities: unresolved,
    unresolvedNamedCandidates,
    exactDuplicateWithEstablishedReview: queue.filter((x) => x.reviewClass === 'exact_duplicate_with_established_review').length,
    exactDuplicateAmongFlaggedReview: queue.filter((x) => x.reviewClass === 'exact_duplicate_among_flagged_review').length,
    automaticCoreMutations: queue.filter((x) => x.automaticCoreMutationAllowed).length
  },
  countsByClass,
  queue
};

const output = arg('output');
const json = `${JSON.stringify(report, null, 2)}\n`;
if (output) {
  const full = path.resolve(ROOT, output);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, json, 'utf8');
}
console.log(JSON.stringify(report.summary, null, 2));
if (report.summary.automaticCoreMutations !== 0) throw new Error('Unresolved legacy audit must never authorize automatic core mutation.');
