from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, content):
    (ROOT / path).write_text(content, encoding='utf-8')

def replace_once(content, old, new, label):
    if new in content:
        return content
    if old not in content:
        raise RuntimeError(f'{label}: expected text not found')
    return content.replace(old, new, 1)

# index.html: allow the pinned OCR worker/WASM and load the built-in provider before capture UI.
index = read('index.html')
index = replace_once(
    index,
    "script-src 'self' https://cdn.jsdelivr.net;",
    "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; worker-src 'self' blob: https://cdn.jsdelivr.net;",
    'CSP worker policy'
)
index = replace_once(
    index,
    '  <script type="module" src="./src/v096-package-capture.js?v=096a"></script>',
    '  <script type="module" src="./src/v096-web-ocr.js?v=096c"></script>\n  <script type="module" src="./src/v096-package-capture.js?v=096c"></script>',
    'web OCR runtime entry'
)
index = index.replace('./src/app.js?v=096b', './src/app.js?v=096c')
write('index.html', index)

# Service worker: invalidate old modules and retain the OCR provider offline after first app update.
sw = read('sw.js')
sw = re.sub(r"const CACHE_NAME = 'luckybean-v0\.9\.6-[^']+';", "const CACHE_NAME = 'luckybean-v0.9.6-ocr-qr-c';", sw, count=1)
if "'./src/v096-web-ocr.js'" not in sw:
    sw = sw.replace("'./src/app.js',", "'./src/app.js', './src/v096-web-ocr.js',", 1)
write('sw.js', sw)

# Package capture: report the engine accurately and stop telling users that installation is pending.
capture = read('src/v096-package-capture.js')
capture = capture.replace("capabilities.webPaddle ? '网页 PP-OCR 可用'", "capabilities.webPaddle ? '内置网页 OCR 可用'")
capture = capture.replace(
    "当前版本已完成拍摄与识别桥接，PP-OCR 模型尚未加入仓库。可先粘贴豆袋文字继续测试字段解析。",
    "内置网页 OCR 未能启动。首次使用需要联网下载语言模型；请检查网络后重试，或先手工粘贴文字。"
)
write('src/v096-package-capture.js', capture)

# QR decoder: only accept binary data as BrewIon when the CRC is actually valid.
qr = read('src/qr.js')
helper = """
function hasValidBrewIonCrc(input) {
  try {
    const bytes = normalizeBytes(input);
    if (bytes.length < CORE_LEN + CRC_LEN) return false;
    const core = bytes.slice(0, -CRC_LEN);
    return readCrc(bytes.slice(-CRC_LEN)) === crc16(core);
  } catch {
    return false;
  }
}

"""
if 'function hasValidBrewIonCrc' not in qr:
    qr = qr.replace('export function decodeBrewIonBytes(input, codebook) {', helper + 'export function decodeBrewIonBytes(input, codebook) {', 1)

candidate_pattern = re.compile(r"function isSupportedCandidate\(result\) \{.*?\n\}", re.S)
candidate_replacement = """function isSupportedCandidate(result) {
  const text = String(result?.data || '').trim();
  if (/^HEX\\s*:/i.test(text)) return true;
  if (/^[\\[{]/.test(text)) return true;
  if (extractShareEncoded(text)) return true;
  return hasValidBrewIonCrc(result?.binaryData || []);
}"""
qr, count = candidate_pattern.subn(candidate_replacement, qr, count=1)
if count != 1:
    raise RuntimeError('QR candidate guard not found')

decode_pattern = re.compile(r"export function decodeJsQrResult\(result, codebook\) \{.*?\n\}", re.S)
decode_replacement = """export function decodeJsQrResult(result, codebook) {
  if (!result) throw new Error('二维码结果为空');
  const text = String(result.data || '').trim();

  // Text formats must be parsed before raw bytes. QR libraries expose the UTF-8
  // bytes of ordinary URLs/JSON as binaryData; treating those bytes as BrewIon
  // packets caused false CRC16 failures.
  if (/^HEX\\s*:/i.test(text)) return decodeBrewIonBytes(text, codebook);
  try {
    const object = JSON.parse(text);
    if (object && typeof object === 'object') return { ...object, source: object.source || 'json-qr' };
  } catch { /* not JSON */ }

  if (extractShareEncoded(text)) throw new Error('分享二维码未完成解压，请重新扫描');

  const bytes = result.binaryData || result.rawBytes || null;
  if (bytes && hasValidBrewIonCrc(bytes)) return decodeBrewIonBytes(bytes, codebook);
  if (bytes?.length >= CORE_LEN + CRC_LEN && !text) {
    throw new Error('二维码包含二进制数据，但不是有效的 BrewIon CRC16 编码');
  }
  throw new Error('二维码不是受支持的 BrewIon 或 Lucky Bean 数据');
}"""
qr, count = decode_pattern.subn(decode_replacement, qr, count=1)
if count != 1:
    raise RuntimeError('decodeJsQrResult not found')
write('src/qr.js', qr)

# Static checks and documentation.
static_check = read('tests/static-check.mjs')
if "'src/v096-web-ocr.js'" not in static_check:
    static_check = static_check.replace("'src/v096-package-capture.js',", "'src/v096-package-capture.js','src/v096-web-ocr.js',", 1)
write('tests/static-check.mjs', static_check)

readme = read('README.md')
marker = '- 当前阶段完成采集、质量评估、桥接和业务交接，PP-OCR 模型文件及原生插件将在后续阶段接入。'
replacement = '- 网页版已内置 Tesseract.js 6.0.1 OCR，支持英文与简体中文；首次识别会联网下载语言模型并缓存在浏览器。原生 PP-OCR 插件仍作为后续移动端增强方案。'
if marker in readme:
    readme = readme.replace(marker, replacement, 1)
if '二维码文本优先解析' not in readme:
    anchor = '识别架构详见 `docs/recognition-architecture.md`。'
    readme = readme.replace(anchor, anchor + '\n\n- 二维码采用文本/分享编码优先、合法 CRC16 二进制其次的解码顺序，避免把普通网址或 JSON 二维码误报为 CRC 错误；\n- 摄像头与相册二维码均继续使用 ZXing、BarcodeDetector 和 jsQR 多级回退。', 1)
write('README.md', readme)

print('Applied v0.9.6 OCR and QR regression patch.')
