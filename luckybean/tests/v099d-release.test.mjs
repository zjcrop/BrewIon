import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('radar scroll guard preserves dialog and page positions', async () => {
  const source = await read('src/v099d-radar-scroll.js');
  assert.match(source, /dialogTop: dialog\.scrollTop/);
  assert.match(source, /window\.scrollTo\(snapshot\.pageX, snapshot\.pageY\)/);
  assert.match(source, /focus\?\.\(\{ preventScroll: true \}\)/);
  assert.match(source, /event\.preventDefault\(\)/);
});

test('Chinese OCR wrapper uses immutable base function and conditional multipass', async () => {
  const source = await read('src/v099d-ocr-quality.js');
  assert.match(source, /const BASE_RECOGNIZE/);
  assert.match(source, /\['chi_sim', 'eng'\]/);
  assert.match(source, /\['chi_sim'\]/);
  assert.match(source, /\[90, -90\]/);
  assert.match(source, /coffee-domain correction/);
  assert.doesNotMatch(source, /return PROVIDER\.recognizeCoffeeBag\(images/);
});

test('Supabase auth reuses public Grind PSD project without privileged secret', async () => {
  const source = await read('src/v099d-supabase-auth.js');
  assert.match(source, /phwqpxmnrogddrajwpqm\.supabase\.co/);
  assert.match(source, /sb_publishable_/);
  assert.match(source, /source_app: SOURCE_APP/);
  assert.match(source, /\/auth\/v1\/signup/);
  assert.match(source, /grant_type=password/);
  assert.match(source, /enterThroughNativeIdentity/);
  assert.doesNotMatch(source, /measurements/);
});

test('099d publication includes all runtime modules and cache boundary', async () => {
  const [html, sw, manifest, bootstrap] = await Promise.all([
    read('index.html'), read('sw.js'), read('manifest.webmanifest'), read('src/v095-sensory-bootstrap.js')
  ]);
  assert.match(html, /release-revision" content="099d/);
  assert.match(html, /styles-v099d\.css\?v=099d/);
  assert.match(html, /v099d-ocr-quality\.js\?v=099d/);
  assert.match(html, /v099d-radar-scroll\.js\?v=099d/);
  assert.match(html, /v099d-supabase-auth\.js\?v=099d/);
  assert.match(sw, /luckybean-v0\.9\.9-main-099d/);
  assert.match(sw, /v099d-supabase-auth\.js/);
  assert.match(sw, /v099d-ocr-quality\.js/);
  assert.match(manifest, /099d/);
  assert.match(bootstrap, /v095-sensory-pro\.js\?v=099d/);
});
