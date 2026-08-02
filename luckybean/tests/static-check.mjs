import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

async function walk(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await walk(full)); else output.push(full);
  }
  return output;
}

const files = await walk(root);
for (const file of files.filter(file => file.endsWith('.js') || file.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${path.relative(root, file)}: ${result.stderr.trim()}`);
}

for (const file of files.filter(file => file.endsWith('.json'))) {
  try { JSON.parse(await readFile(file, 'utf8')); } catch (error) { failures.push(`${path.relative(root, file)}: JSON ${error.message}`); }
}

const html = await readFile(path.join(root, 'index.html'), 'utf8');
const requiredIds = ['loginScreen','appShell','pageBeans','pageBrew','pageSensory','pageSettings','beanGroups','brewContent','sensoryContent','settingsContent','fabWrap','bottomNav','overlayRoot','toast'];
for (const id of requiredIds) if (!html.includes(`id="${id}"`)) failures.push(`index.html 缺少 #${id}`);

const app = await readFile(path.join(root, 'src/app.js'), 'utf8');
const requiredFeatures = ['scanQrFile','CameraScanner','parseNaturalLanguage','requestPrivatePlan','computeFallbackPlan','inventoryEvents','SENSORY_NODES','openShareDialog','checkCodebookUpdate'];
for (const feature of requiredFeatures) if (!app.includes(feature)) failures.push(`app.js 缺少 ${feature}`);

const recognitionFiles = ['styles-v096-recognition.css','src/v096-package-capture.js','src/image-quality.js','src/recognition-bridge.js','docs/recognition-architecture.md'];
for (const relative of recognitionFiles) {
  if (!files.includes(path.join(root, relative))) failures.push(`缺少豆袋识别文件 ${relative}`);
}
if (!html.includes('v096-package-capture.js')) failures.push('index.html 未加载豆袋采集模块');
if (!html.includes('styles-v096-recognition.css')) failures.push('index.html 未加载豆袋采集样式');

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const utils = await readFile(path.join(root, 'src/utils.js'), 'utf8');
const manifest = await readFile(path.join(root, 'manifest.webmanifest'), 'utf8');
const readme = await readFile(path.join(root, 'README.md'), 'utf8');
const serviceWorker = await readFile(path.join(root, 'sw.js'), 'utf8');
if (!utils.includes(`APP_VERSION = '${version}'`)) failures.push('src/utils.js 与 package.json 版本不一致');
if (!manifest.includes(version)) failures.push('manifest.webmanifest 与 package.json 版本不一致');
if (!readme.includes(`v${version}`)) failures.push('README 与 package.json 版本不一致');
if (!serviceWorker.includes(`v${version}`)) failures.push('sw.js 缓存名与 package.json 版本不一致');
for (const asset of ['styles-v096-recognition.css','src/v096-package-capture.js','src/image-quality.js','src/recognition-bridge.js']) {
  if (!serviceWorker.includes(asset)) failures.push(`sw.js 未缓存 ${asset}`);
}

const codebookStats = await stat(path.join(root, 'public/fallback-codebook.json'));
if (codebookStats.size < 50000) failures.push('回退编码表体积异常');

const secretPattern = /(github_pat_|ghp_[A-Za-z0-9]{20,}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----)/;
for (const file of files.filter(file => !file.includes(`${path.sep}tests${path.sep}`) && !file.endsWith('.jpg') && !file.endsWith('.png'))) {
  const content = await readFile(file, 'utf8').catch(() => '');
  if (secretPattern.test(content)) failures.push(`${path.relative(root, file)} 疑似包含密钥`);
}

if (failures.length) {
  console.error('静态校验失败：');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`静态校验通过：${files.length} 个文件；JS 语法、JSON、必要入口、版本、离线资源、敏感信息均通过。`);
