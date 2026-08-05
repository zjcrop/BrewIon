import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const INDEX_TABLES = ['countries', 'regions', 'entities', 'varieties', 'processes', 'flavors'];
export const MUTABLE_TABLES = ['relations', 'aliases'];

export function stableStringify(value) {
  return JSON.stringify(value, null, 2) + '\n';
}
export function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}
export function sha256Value(value) {
  return sha256Text(JSON.stringify(value));
}
export function normalizeSemver(value) {
  const raw = String(value ?? '').trim();
  if (/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(raw)) return raw;
  if (/^\d+\.\d+$/.test(raw)) return `${raw}.0`;
  if (/^\d+$/.test(raw)) return `${raw}.0.0`;
  throw new Error(`Unsupported codebook version: ${raw}`);
}
export function ensureCodebookShape(codebook) {
  if (!codebook || typeof codebook !== 'object') throw new Error('Codebook must be an object.');
  for (const table of [...INDEX_TABLES, ...MUTABLE_TABLES]) {
    if (!Array.isArray(codebook[table])) throw new Error(`Missing array table: ${table}`);
  }
  const seen = new Map();
  for (const table of INDEX_TABLES) {
    codebook[table].forEach((row, index) => {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0]) {
        throw new Error(`${table}[${index}] must be an array whose first cell is a code.`);
      }
      const code = row[0];
      if (seen.has(code)) throw new Error(`Duplicate code ${code} in ${table}[${index}] and ${seen.get(code)}.`);
      seen.set(code, `${table}[${index}]`);
    });
  }
  for (const [index, relation] of codebook.relations.entries()) {
    if (!Array.isArray(relation) || relation.length < 2) throw new Error(`relations[${index}] is invalid.`);
    if (!seen.has(relation[0]) || !seen.has(relation[1])) {
      throw new Error(`relations[${index}] references missing code: ${relation[0]} -> ${relation[1]}`);
    }
  }
  return seen;
}
export function compareReleases(previous, current) {
  ensureCodebookShape(current);
  const startingIndexes = {};
  const tables = {};
  const operations = [];
  for (const table of INDEX_TABLES) {
    const before = previous?.[table] ?? [];
    const after = current[table];
    if (after.length < before.length) throw new Error(`${table} shrank from ${before.length} to ${after.length}.`);
    startingIndexes[table] = before.length;
    tables[table] = after.slice(before.length);
    for (let index = 0; index < before.length; index += 1) {
      const previousCode = before[index]?.[0];
      const currentCode = after[index]?.[0];
      if (previousCode !== currentCode) {
        throw new Error(`${table}[${index}] code changed from ${previousCode} to ${currentCode}; index compatibility is broken.`);
      }
      if (JSON.stringify(before[index]) !== JSON.stringify(after[index])) {
        operations.push({
          operation: 'replace-row-metadata',
          table,
          index,
          code: currentCode,
          beforeSha256: sha256Value(before[index]),
          afterSha256: sha256Value(after[index]),
          value: after[index]
        });
      }
    }
  }
  for (const table of MUTABLE_TABLES) {
    const before = previous?.[table] ?? [];
    const after = current[table];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      operations.push({
        operation: 'replace-table',
        table,
        code: null,
        beforeSha256: previous ? sha256Value(before) : null,
        afterSha256: sha256Value(after),
        value: after
      });
    }
  }
  return { startingIndexes, tables, operations };
}
export function applyDeltaAndCorrections(previous, delta, corrections) {
  const result = structuredClone(previous);
  for (const table of INDEX_TABLES) {
    if (result[table].length !== delta.startingIndexes[table]) {
      throw new Error(`${table} local length ${result[table].length} does not match delta start ${delta.startingIndexes[table]}.`);
    }
    result[table].push(...delta.tables[table]);
  }
  for (const op of corrections.operations) {
    if (op.operation === 'replace-row-metadata') {
      const currentCode = result[op.table]?.[op.index]?.[0];
      if (currentCode !== op.code) throw new Error(`Correction code mismatch for ${op.table}[${op.index}].`);
      result[op.table][op.index] = op.value;
    } else if (op.operation === 'replace-table') {
      result[op.table] = op.value;
    }
  }
  return result;
}
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stableStringify(value), 'utf8');
}
export function artifact(baseDir, kind, file, extra = {}) {
  const absolute = path.join(baseDir, file);
  const text = fs.readFileSync(absolute, 'utf8');
  return { kind, path: file.replaceAll('\\', '/'), mediaType: 'application/json', bytes: Buffer.byteLength(text), sha256: sha256Text(text), ...extra };
}
