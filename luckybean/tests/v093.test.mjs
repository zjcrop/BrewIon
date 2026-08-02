import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const text = async path => readFile(new URL(path, root), 'utf8');

test('0.9.6 version and visual assets', async () => {
  const [pkg, html, css, sw, manifest, ui] = await Promise.all([
    text('package.json'), text('index.html'), text('styles-v095.css'), text('sw.js'), text('manifest.webmanifest'), text('src/v095-ui.js')
  ]);
  assert.equal(JSON.parse(pkg).version, '0.9.6');
  assert.match(html, /id="splashScreen"/);
  assert.match(html, /splash-red\.jpg\?v=095/);
  assert.match(css, /v095-settings-mascot/);
  assert.match(sw, /luckybean-v0\.9\.6/);
  assert.match(ui, /splash-white\.jpg/);
  assert.equal(JSON.parse(manifest).icons.length, 1);
  for (const path of ['public/app-logo.webp', 'public/splash-red.jpg', 'public/splash-white.jpg', 'public/settings-mascot.png']) {
    assert.ok((await stat(new URL(path, root))).size > 500);
  }
});

test('0.9.3 sensory, cold storage and gear requirements remain available', async () => {
  const [app, css, codebook] = await Promise.all([text('src/app.js'), text('styles.css'), text('src/codebook.js')]);
  for (const marker of ['dripperPrice', 'data-dripper-item', '点击展开滤杯列表', 'intensity: true', '风味强度', '酵感强度', '增味强度', '札记', 'frozen-weight', '❄️', 'score-head-row', 'score-derived-row']) {
    assert.ok(app.includes(marker) || css.includes(marker), marker);
  }
  assert.ok(app.includes("floral: { 1: ['无'] }"));
  assert.ok(app.includes('取消</button><button id="prevSensoryNodeBtn"'));
  assert.doesNotMatch(app, /范围 -10 至 \+10/);
  assert.match(codebook, /row.length >= 9 \? row\[4\] : row\[1\]/);
  assert.match(app, /row\[4\]/);
});