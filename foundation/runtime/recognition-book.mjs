import { createNormalizationAdapter, normalizeMatchKey } from './normalization-adapter.mjs';

export const RECOGNITION_BOOK_CONTRACT = 'recognition-book/1.0';
export const FIELD_DECISION_CONTRACT = 'coffee-field-decision/1.0';

const CORE_TABLES = Object.freeze({
  countries: { field: 'country', names: [1, 2, 3], status: 4 },
  regions: { field: 'region', names: [2, 3, 4], status: 5 },
  entities: { field: 'entity', names: [3, 4, 5], status: 6 },
  varieties: { field: 'variety', names: [1, 2, 3], status: 4 },
  processes: { field: 'process', names: [1, 2, 3], status: 4 },
  flavors: { field: 'flavor', names: [4, 5, 6], status: 8 }
});

const CODE_FIELD_PREFIX = Object.freeze({
  CO: 'country',
  RG: 'region',
  ST: 'entity',
  VA: 'variety',
  PR: 'process',
  FV: 'flavor'
});

const FIELD_ALIASES = Object.freeze({
  origin: 'country',
  countryCode: 'country',
  regionCode: 'region',
  farm: 'entity',
  producer: 'entity',
  station: 'entity',
  cooperative: 'entity',
  entityCode: 'entity',
  varietyCode: 'variety',
  species: 'variety',
  processCode: 'process',
  flavorCodes: 'flavor',
  flavorNotes: 'flavor',
  aroma: 'flavor'
});

const BOOK_INDEX_CACHE = new WeakMap();

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function fieldForCode(code) {
  return CODE_FIELD_PREFIX[String(code || '').split('-')[0]] || null;
}

function coreEntries(codebook) {
  const entries = [];
  const byCode = new Map();
  for (const [table, config] of Object.entries(CORE_TABLES)) {
    for (const [index, row] of (codebook?.[table] || []).entries()) {
      if (!Array.isArray(row) || !row[0]) continue;
      const entry = {
        field: config.field,
        canonicalId: row[0],
        coreCode: row[0],
        coreTable: table,
        qrIndex: index + 1,
        qrEligible: true,
        knowledgeOnly: false,
        status: String(row[config.status] || 'active'),
        names: uniqueStrings(config.names.map((cell) => row[cell])),
        aliases: [],
        confidence: 1,
        source: 'core-codebook'
      };
      entries.push(entry);
      byCode.set(entry.coreCode, entry);
    }
  }

  for (const row of codebook?.aliases || []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const entry = byCode.get(row[0]);
    if (entry) entry.aliases.push(String(row[1]));
  }
  return { entries, byCode };
}

function applyKnowledge(entries, byCode, knowledge) {
  for (const item of [...(knowledge?.localizedNames || []), ...(knowledge?.localizedAliases || [])]) {
    const entry = byCode.get(item?.targetCode);
    const text = item?.name || item?.alias;
    if (entry && text) entry.aliases.push(String(text));
  }

  for (const item of knowledge?.unboundKnowledge?.varietyDetails || []) {
    if (!item?.id || !item?.canonicalNameEn) continue;
    entries.push({
      field: 'variety',
      canonicalId: String(item.id),
      coreCode: null,
      coreTable: null,
      qrIndex: null,
      qrEligible: false,
      knowledgeOnly: true,
      status: String(item.coreEligibility || 'knowledge-only'),
      names: uniqueStrings([item.canonicalNameZh, item.canonicalNameEn]),
      aliases: uniqueStrings(item.aliases || []),
      confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0.8,
      source: 'coffee-knowledge'
    });
  }
}

function blockedCoreCodes(knowledge) {
  const issues = knowledge?.supplementalModels?.['catalog/entity_resolution_issues_v1.json']?.issues || [];
  return new Set(issues.filter((item) => item?.blockAutomaticEntityResolution).map((item) => item.coreCode));
}

function fieldAliases(lexicon) {
  return Object.entries(lexicon?.fields || {}).map(([field, item]) => ({
    field,
    names: uniqueStrings([item?.nameZh, item?.nameEn]),
    aliases: uniqueStrings(item?.aliases || [])
  }));
}

export function buildRecognitionBook({ codebook, lexicon = {}, knowledge = null } = {}) {
  if (!codebook || typeof codebook !== 'object') throw new TypeError('codebook is required');
  const { entries, byCode } = coreEntries(codebook);
  if (knowledge) applyKnowledge(entries, byCode, knowledge);
  const blocked = blockedCoreCodes(knowledge);
  for (const entry of entries) {
    entry.aliases = uniqueStrings(entry.aliases).filter((alias) => !entry.names.includes(alias));
    if (blocked.has(entry.coreCode)) entry.automaticResolution = 'blocked';
    else if (entry.knowledgeOnly) entry.automaticResolution = 'review';
    else entry.automaticResolution = 'allowed';
  }
  return {
    schemaVersion: RECOGNITION_BOOK_CONTRACT,
    codebookVersion: String(codebook.version || ''),
    lexiconVersion: String(lexicon.version || ''),
    knowledgeVersion: knowledge ? String(knowledge.version || '') : null,
    normalizationContract: 'coffee-normalization/1.0',
    fieldAliases: fieldAliases(lexicon),
    entries
  };
}

function buildIndex(book) {
  const cached = BOOK_INDEX_CACHE.get(book);
  if (cached) return cached;
  const index = new Map();
  for (const entry of book?.entries || []) {
    for (const value of [...(entry.names || []), ...(entry.aliases || [])]) {
      const key = `${entry.field}:${normalizeMatchKey(value)}`;
      if (!key.endsWith(':')) {
        const current = index.get(key) || [];
        if (!current.some((item) => item.canonicalId === entry.canonicalId)) current.push(entry);
        index.set(key, current);
      }
    }
  }
  BOOK_INDEX_CACHE.set(book, index);
  return index;
}

export function canonicalRecognitionField(field) {
  const value = String(field || '');
  return FIELD_ALIASES[value] || value;
}

export function resolveRecognitionValue(book, { field, value, locale = 'en', evidenceRefs = [] } = {}) {
  if (book?.schemaVersion !== RECOGNITION_BOOK_CONTRACT) throw new Error('Unsupported RecognitionBook contract');
  const adapter = createNormalizationAdapter({ locale });
  const canonicalField = canonicalRecognitionField(field);
  const normalized = adapter.normalize(value);
  const candidates = buildIndex(book).get(`${canonicalField}:${normalized.matchKey}`) || [];
  const safeCandidates = candidates.map((entry) => ({
    canonicalId: entry.canonicalId,
    coreCode: entry.coreCode,
    display: entry.names?.[0] || normalized.display,
    confidence: entry.confidence,
    qrEligible: entry.qrEligible,
    knowledgeOnly: entry.knowledgeOnly,
    automaticResolution: entry.automaticResolution
  }));

  let status = 'unknown';
  let reason = 'no-match';
  let selected = null;
  if (safeCandidates.length > 1) {
    status = 'conflict';
    reason = 'ambiguous-alias';
  } else if (safeCandidates.length === 1) {
    selected = safeCandidates[0];
    if (selected.automaticResolution === 'allowed') {
      status = 'confirmed';
      reason = 'unique-core-match';
    } else {
      status = 'review';
      reason = selected.knowledgeOnly ? 'knowledge-only-manual-confirmation' : 'automatic-resolution-blocked';
    }
  }

  return {
    schemaVersion: FIELD_DECISION_CONTRACT,
    field: canonicalField,
    rawValue: normalized.raw,
    normalizedValue: normalized.display,
    matchKey: normalized.matchKey,
    locale: normalized.locale,
    status,
    reason,
    selected,
    candidates: safeCandidates,
    evidenceRefs: uniqueStrings(evidenceRefs)
  };
}

export function fieldForCoreCode(code) {
  return fieldForCode(code);
}
