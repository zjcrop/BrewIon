import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCompactSharePayload, encodeSharePayload } from '../src/share-codec.js';
import { extractShareEncoded, normalizeQrResult, decodeJsQrResult } from '../src/qr.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Lucky Bean encrypted share URL QR is expanded to a bean record', async () => {
  const compact = buildCompactSharePayload({
    appVersion: '0.9.6',
    user: { publicId: 'tester', nickname: '测试者' },
    bean: {
      countryCode: 'ET', regionCode: 'ET-YIR', entityCode: 'ET-TEST',
      varietyCode: 'VAR-74110', processCode: 'PROC-WASHED', roastCode: 'RL-L1',
      roastDate: '2026-07-30', flavorCodes: ['FL-JASMINE', 'FL-CITRUS'], roastColor: 92
    },
    names: { displayName: '测试豆' }
  });
  const encoded = await encodeSharePayload(compact);
  assert.match(encoded, /^LB8[JR]\.E\./);
  const url = `https://zjcrop.github.io/BrewIon/luckybean/#share=${encoded}`;
  assert.equal(extractShareEncoded(url), encoded);
  const normalized = await normalizeQrResult({ data: url }, 'unit-test');
  const bean = decodeJsQrResult(normalized, {});
  assert.equal(bean.countryCode, 'ET');
  assert.equal(bean.varietyCode, 'VAR-74110');
  assert.equal(bean.processCode, 'PROC-WASHED');
  assert.equal(bean.source, 'luckybean-share-qr');
  assert.match(bean.notes, /二维码分享/);
});

test('QR wrapper preserves pinned scanner core and parses text before bytes', async () => {
  const [wrapper, core, share] = await Promise.all([read('src/qr.js'), read('src/qr-core.js'), read('src/share-codec.js')]);
  for (const marker of ['@zxing/browser@0.2.0/+esm','BrowserQRCodeReader','decodeFromConstraints','BarcodeDetector','jsqr@1.4.0','自动捕捉已开启','extractShareEncoded','decodeSharePayload']) assert.ok(core.includes(marker), marker);
  for (const marker of ["import * as core from './qr-core.js'","import { decodeSharePayload } from './share-codec.js'",'sanitizeStructuredResult','decodeCodebookText','latin1Bytes','不是有效的 BrewIon 固定字段编码']) assert.ok(wrapper.includes(marker), marker);
  assert.match(share, /LB8\$\{packed\.code\}\.E\./);
  assert.match(share, /AES-GCM-256/);
});

test('post-brew flow cancels automatic evaluation and restores mode selection', async () => {
  const module = await read('src/v095-postbrew-sensory.js');
  for (const marker of ['#recordConsumptionBtn','#cancelEvaluationBtn','professional-v2','v095-postbrew-mode-choice','waiting-for-mode-choice']) assert.ok(module.includes(marker), marker);
});

test('QR capture UI and integrity runtime files are loaded and cached', async () => {
  const [html, sw, css, ui] = await Promise.all([read('index.html'),read('sw.js'),read('styles-qr-scan.css'),read('src/v095-qr-ui.js')]);
  for (const marker of [
    'styles-qr-scan.css?v=096b','src/v095-postbrew-sensory.js?v=096b','src/v095-qr-ui.js?v=096b',
    'src/v096-web-ocr.js?v=096e','src/v096-direct-camera.js?v=096e','src/v096-integrity-ui.js?v=096f',
    'src/v097-ui-fixes.js?v=097d'
  ]) assert.ok(html.includes(marker), marker);
  assert.match(sw, /luckybean-v0\.9\.6-ui-fix-i/);
  for (const marker of ['./styles-qr-scan.css','./src/v095-postbrew-sensory.js','./src/v095-qr-ui.js','./src/v096-web-ocr.js','./src/v096-direct-camera.js','./src/qr-core.js','./src/v096-integrity-ui.js','./src/v097-ui-fixes.js']) assert.ok(sw.includes(marker), marker);
  assert.match(css, /自动捕捉|v095-qr-frame/);
  assert.match(ui, /无需按快门/);
});
