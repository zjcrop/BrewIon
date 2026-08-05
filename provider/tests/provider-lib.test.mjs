import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDeltaAndCorrections, compareReleases } from '../scripts/provider-lib.mjs';

function book(code = 'CO-A', name = 'A') {
  return {
    countries: [[code, name]],
    regions: [['RE-A', code, 'R']],
    entities: [['EN-A', code, 'station', 'E']],
    varieties: [['VA-A', 'V']],
    processes: [['PR-A', 'P']],
    flavors: [['FL-A', 'fruit', 'berry', 1, 'F']],
    relations: [[code, 'RE-A', 'contains', 'high']],
    aliases: [['EN-A', 'Alias']]
  };
}

test('append-only delta and corrections reconstruct the current codebook', () => {
  const previous = book();
  const current = structuredClone(previous);
  current.countries[0][1] = 'A corrected';
  current.countries.push(['CO-B', 'B']);
  current.aliases.push(['CO-B', 'Bee']);
  const compared = compareReleases(previous, current);
  const rebuilt = applyDeltaAndCorrections(previous, { startingIndexes: compared.startingIndexes, tables: compared.tables }, { operations: compared.operations });
  assert.deepEqual(rebuilt, current);
  assert.equal(compared.tables.countries.length, 1);
  assert.ok(compared.operations.some((item) => item.operation === 'replace-row-metadata'));
});

test('reordering or replacing an indexed code is rejected', () => {
  const previous = book();
  const current = book('CO-X');
  assert.throws(() => compareReleases(previous, current), /index compatibility is broken/);
});
