import fs from 'node:fs';
import assert from 'node:assert/strict';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const fixes = fs.readFileSync(new URL('../src/v108-local-first-history.js', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../src/v099d-supabase-auth.js', import.meta.url), 'utf8');

assert.match(index, /class="app-shell"/);
assert.match(index, /v108-local-first-history\.js\?v=1\.0\.8-test/);
assert.match(fixes, /data-v108-manage-history/);
assert.match(fixes, /restore-brew-deletion/);
assert.match(fixes, /prevSensoryNodeBtn/);
assert.match(fixes, /luckybean:auth-missing/);
assert.match(auth, /verifySession: restore/);
assert.match(auth, /persistVerifiedIdentity/);

console.log('v1.0.8 local-first static checks passed');
