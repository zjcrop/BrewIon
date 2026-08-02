import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const text = async path => readFile(new URL(path, root), 'utf8');

test('0.9.6 keeps 0.9.2 interaction baseline', async () => {
  const [pkg, html, app, css, sw] = await Promise.all([
    text('package.json'), text('index.html'), text('src/app.js'), text('styles.css'), text('sw.js')
  ]);
  assert.equal(JSON.parse(pkg).version, '0.9.6');
  assert.match(html, /centered-page-heading beans-page-heading/);
  assert.match(html, /centered-page-heading brew-page-heading/);
  assert.doesNotMatch(html, /id="filterBtn"/);
  for (const label of ['榜魁','味盛','价冠','拾余','拈签']) assert.match(app, new RegExp(label));
  assert.match(css, /preference-board-top3/);
  assert.match(sw, /luckybean-v0\.9\.6/);
});

test('recommendation animation and prompt libraries are complete', async () => {
  const app = await text('src/app.js');
  for (const phrase of [
    '直取榜首，不问其余。','此只风味精绝，君既选中，甚是妥当。','此只价冠诸豆，足见君之慧眼独钟。',
    '余粒无多，宜趁兴饮尽，为此豆作结。','闭目拈签，任其自然。'
  ]) assert.match(app, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(app, /Math\.floor\(Math\.random\(\) \* 6\) \+ 4/);
  assert.match(app, /duration: 800/);
  assert.match(app, /recommendationExpandedAll/);
});

test('timer, inventory, delta wheel and trajectory requirements', async () => {
  const [app, css] = await Promise.all([text('src/app.js'), text('styles.css')]);
  assert.match(app, /stopSpeech\(\)/);
  assert.match(app, /同时扣除滤纸/);
  assert.match(app, /filter\.quantity = Math\.max\(0, Number\(filter\.quantity\|\|0\)-1\)/);
  assert.match(app, /sensoryDeltaWheel/);
  assert.match(app, /min="-10" max="10"/);
  for (const label of ['花香','甜','酸','果香','苦','涩']) assert.match(app, new RegExp(label));
  for (const color of ['#ffd928','#8fd3ff','#30e3d2','#f2ead7','#f3a04b','#75b96b','#ff5a52']) assert.match(css, new RegExp(color));
});