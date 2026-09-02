#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const corePath = path.resolve(ROOT, 'coffee-qr-codebook/coffee_qr_codebook_v6.json');
const knowledgePath = path.resolve(ROOT, 'coffee-knowledge/catalog/wcr_high_priority_varieties_v1.json');
const outputArg = process.argv.slice(2).find((x) => x.startsWith('--output='));
const outDir = outputArg ? path.resolve(outputArg.slice('--output='.length)) : path.resolve(ROOT, 'coffee-v7-preview');

const v6 = JSON.parse(fs.readFileSync(corePath, 'utf8'));
const knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const indexedTables = ['countries', 'regions', 'entities', 'varieties', 'processes', 'flavors'];

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'UNKNOWN';
}

function preferredPreviewZh(detail) {
  const localized = (knowledge.localizedNames || []).find((row) =>
    row?.targetId === detail.id && row?.language === 'zh-Hans' && row?.nameType === 'canonical' && Number(row?.confidence || 0) >= 0.99
  );
  return String(localized?.name || detail.canonicalNameEn || '').trim();
}

const preview = structuredClone(v6);
preview.version = '7-preview';
preview.updatedAt = new Date().toISOString().slice(0, 10);
preview._preview = {
  productionReady: false,
  sourceCoreVersion: String(v6.version),
  purpose: 'Append-only index migration proof for reviewed WCR high-priority knowledge nodes.',
  warning: 'This file is a non-production preview. Candidate rows must not be used for QR encoding until explicit production approval and consumer/OCR usage review.',
  generatedFrom: 'coffee-knowledge/catalog/wcr_high_priority_varieties_v1.json'
};

const existingCodes = new Set((v6.varieties || []).map((row) => String(row?.[0] || '')));
const appended = [];
for (const detail of knowledge.varietyDetails || []) {
  const nameEn = String(detail?.canonicalNameEn || '').trim();
  if (!detail?.id || !nameEn) throw new Error('High-priority knowledge node is missing id/canonicalNameEn.');
  let code = `VA-V7-${slug(nameEn)}`;
  let n = 2;
  while (existingCodes.has(code)) code = `VA-V7-${slug(nameEn).slice(0, 20)}-${n++}`;
  existingCodes.add(code);
  const nameZh = preferredPreviewZh(detail);
  const row = [code, nameZh, nameEn, nameEn, 'candidate'];
  preview.varieties.push(row);
  appended.push({
    index: preview.varieties.length,
    code,
    knowledgeId: detail.id,
    nameEn,
    nameZhPreview: nameZh,
    recordType: detail.recordType || '',
    coreEligibility: detail.coreEligibility || '',
    productionApproved: false
  });
}

if (appended.length !== 16) throw new Error(`Expected 16 high-priority preview rows, got ${appended.length}.`);

for (const table of indexedTables) {
  const before = v6[table] || [];
  const after = preview[table] || [];
  if (after.length < before.length) throw new Error(`${table} shrank in v7 preview.`);
  before.forEach((row, index) => {
    if (JSON.stringify(after[index]) !== JSON.stringify(row)) {
      throw new Error(`${table}[${index + 1}] changed; append-only QR index contract violated.`);
    }
  });
  if (table !== 'varieties' && after.length !== before.length) {
    throw new Error(`${table} unexpectedly appended rows in variety-only v7 preview.`);
  }
}

const previewPath = path.join(outDir, 'coffee_qr_codebook_v7_preview.json');
const audit = {
  _format: 'coffee-v7-preview-audit',
  _schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  productionReady: false,
  sourceCoreVersion: String(v6.version),
  previewVersion: preview.version,
  indexedTablePrefixIntegrity: true,
  v6VarietyCount: (v6.varieties || []).length,
  appendedVarietyCount: appended.length,
  previewVarietyCount: (preview.varieties || []).length,
  oldQrIndexesChanged: false,
  appended,
  blockers: [
    'explicit_production_approval_required',
    'consumer_or_ocr_frequency_review_required',
    'pending_market_verification_names_must_not_be_promoted_to_official_display_names'
  ]
};
fs.writeFileSync(previewPath, `${JSON.stringify(preview, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(outDir, 'v7_preview_audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  sourceVersion: String(v6.version),
  v6Varieties: audit.v6VarietyCount,
  appended: audit.appendedVarietyCount,
  previewVarieties: audit.previewVarietyCount,
  oldQrIndexesChanged: false,
  productionReady: false
}, null, 2));
