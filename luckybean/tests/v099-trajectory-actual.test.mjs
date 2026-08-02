import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('highlighted trajectory is driven by modeled positive signal minus risk', async () => {
  const [bridge, html, sw, runtime] = await Promise.all([
    read('src/v099-trajectory-signal-bridge.js'), read('index.html'),
    read('sw.js'), read('src/v099-runtime.js')
  ]);
  assert.match(bridge, /modeled-positive-signal-minus-risk/);
  assert.match(bridge, /floralN \* \.38 \+ acidityN \* \.28 \+ sweetnessN \* \.34/);
  assert.match(bridge, /1 - riskN \* \.35/);
  assert.match(bridge, /\.v098-flavor-line/);
  assert.match(bridge, /data-v099-signal|v099Signal/);
  assert.match(bridge, /预测萃取轨迹/);
  assert.match(html, /release-revision" content="099b/);
  assert.match(html, /src\/v099-trajectory-signal-bridge\.js\?v=099b/);
  assert.match(sw, /luckybean-v0\.9\.9-main-099b/);
  assert.match(sw, /src\/v099-trajectory-signal-bridge\.js/);
  assert.match(runtime, /深入解读/);
});
