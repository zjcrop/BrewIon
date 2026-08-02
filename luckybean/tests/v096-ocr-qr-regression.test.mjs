import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeJsQrResult } from '../src/qr.js';
import { parseNaturalLanguage } from '../src/codebook.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const codebook = {
  countries: [['CT-ET', '埃塞俄比亚', 'Ethiopia']],
  regions: [['RG-GUJI', 'CT-ET', '古吉', 'Guji']],
  entities: [['EN-TEST', 'CT-ET', 'RG-GUJI', '测试处理站', 'Test Station']],
  varieties: [['VR-001', '原生种', 'Heirloom']],
  processes: [['PROC-WASHED', '水洗', 'Washed']],
  flavors: [['FL-JASMINE', '', '', '', '茉莉', 'Jasmine']]
};

test('JSON QR text is parsed before misleading raw bytes', () => {
  const decoded = decodeJsQrResult({
    data: JSON.stringify({ countryCode: 'CT-ET', varietyCode: 'VR-001' }),
    binaryData: Array.from({ length: 96 }, (_, index) => (index * 17) % 256)
  }, {});
  assert.equal(decoded.countryCode, 'CT-ET');
  assert.equal(decoded.varietyCode, 'VR-001');
  assert.equal(decoded.source, 'json-qr');
});

test('official codebook codes from OCR text are parsed directly', () => {
  const parsed = parseNaturalLanguage('豆仓编码 CT－ET  RG - GUJI  VR-001  PROC-WASHED  FL-JASMINE  RL-L1', codebook);
  assert.equal(parsed.countryCode, 'CT-ET');
  assert.equal(parsed.regionCode, 'RG-GUJI');
  assert.equal(parsed.varietyCode, 'VR-001');
  assert.equal(parsed.processCode, 'PROC-WASHED');
  assert.equal(parsed.roastCode, 'RL-L1');
  assert.deepEqual(parsed.flavorCodes, ['FL-JASMINE']);
  assert.equal(parsed.confidence.countryCode, 0.995);
});

test('codebook text QR is decoded without CRC branch', () => {
  const decoded = decodeJsQrResult({ data: '豆仓编码 CT-ET / VR-001 / PROC-WASHED / RL-L1' }, codebook);
  assert.equal(decoded.countryCode, 'CT-ET');
  assert.equal(decoded.varietyCode, 'VR-001');
  assert.equal(decoded.processCode, 'PROC-WASHED');
  assert.equal(decoded.source, 'codebook-text-qr');
});

test('invalid binary QR no longer exposes a raw CRC16 error', () => {
  assert.throws(
    () => decodeJsQrResult({ data: '', binaryData: new Array(64).fill(65) }, {}),
    /不是有效的 BrewIon 固定字段编码/
  );
});

test('Chinese-first OCR runtime and direct camera are loaded and cached', async () => {
  const [html, sw, ocr, qr, camera, css] = await Promise.all([
    read('index.html'), read('sw.js'), read('src/v096-web-ocr.js'), read('src/qr.js'),
    read('src/v096-direct-camera.js'), read('styles-v096-recognition.css')
  ]);
  const ocrIndex = html.indexOf('src/v096-web-ocr.js?v=096e');
  const captureIndex = html.indexOf('src/v096-package-capture.js?v=096e');
  const cameraIndex = html.indexOf('src/v096-direct-camera.js?v=096e');
  assert.ok(ocrIndex >= 0, 'web OCR entry missing');
  assert.ok(captureIndex > ocrIndex, 'web OCR must load before package capture');
  assert.ok(cameraIndex > captureIndex, 'direct camera must intercept after package capture');
  assert.match(html, /worker-src 'self' blob: https:\/\/cdn\.jsdelivr\.net/);
  assert.match(html, /'wasm-unsafe-eval'/);
  assert.match(sw, /luckybean-v0\.9\.6-ui-fix-i/);
  assert.match(sw, /src\/v096-web-ocr\.js/);
  assert.match(sw, /src\/v096-direct-camera\.js/);
  assert.match(sw, /src\/qr-core\.js/);
  assert.match(ocr, /return \['chi_sim', 'eng'\]/);
  assert.match(ocr, /prepareOcrVariants/);
  assert.match(ocr, /tessedit_pageseg_mode/);
  assert.match(ocr, /preserve_interword_spaces/);
  assert.match(ocr, /user_defined_dpi/);
  assert.match(ocr, /cjk \* 3\.2/);
  assert.match(camera, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(camera, /facingMode: \{ ideal: facingMode \}/);
  assert.match(camera, /new ImageCapture\(track\)/);
  assert.match(camera, /new DataTransfer\(\)/);
  assert.match(css, /\.lb-direct-camera/);
  assert.match(qr, /decodeCodebookText/);
  assert.match(qr, /latin1Bytes/);
});
