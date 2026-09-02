#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const registryPath = path.resolve(ROOT, 'coffee-knowledge/source_registry_v1.json');
const maintenanceDir = path.resolve(ROOT, 'coffee-knowledge/maintenance');
const statePath = path.resolve(ROOT, process.env.COFFEE_MAINTENANCE_STATE || 'coffee-knowledge/maintenance/source_state_v1.json');
const candidatePath = path.join(maintenanceDir, 'weekly_candidates.json');
const reportPath = path.join(maintenanceDir, 'weekly_report.md');
const model = process.env.ZHIPU_MODEL || 'glm-4.7-flash';
const forceAiScan = process.env.FORCE_AI_SCAN === '1';
const maxSourceBytes = Number(process.env.COFFEE_MAX_SOURCE_BYTES || 25 * 1024 * 1024);
const now = new Date().toISOString();

fs.mkdirSync(maintenanceDir, { recursive: true });
fs.mkdirSync(path.dirname(statePath), { recursive: true });

const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
let state = { version: 1, updatedAt: null, sources: {} };
if (fs.existsSync(statePath)) {
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { /* use empty state */ }
}
if (!state.sources) state.sources = {};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function compactHtml(text) {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTextLike(contentType) {
  const type = String(contentType || '').toLowerCase();
  return type.startsWith('text/') ||
    type.includes('application/json') ||
    type.includes('application/xhtml+xml') ||
    type.includes('application/xml') ||
    type.includes('application/rss+xml') ||
    type.includes('application/atom+xml');
}

function normalizeText(buffer, contentType) {
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const type = String(contentType || '').toLowerCase();
  if (type.includes('html') || type.includes('xhtml')) return compactHtml(decoded);
  return decoded.replace(/\s+/g, ' ').trim();
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(source.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'BrewIon-Coffee-Knowledge-Maintainer/1.1 (+https://github.com/zjcrop/BrewIon)',
        'accept': 'text/html,application/xhtml+xml,application/json,text/plain,application/xml,application/pdf;q=0.8,*/*;q=0.1',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > maxSourceBytes) throw new Error(`source too large: ${declaredLength} bytes > ${maxSourceBytes}`);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > maxSourceBytes) throw new Error(`source too large after download: ${buffer.length} bytes > ${maxSourceBytes}`);

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const aiEligible = isTextLike(contentType);
    const text = aiEligible ? normalizeText(buffer, contentType) : '';
    return {
      ok: true,
      status: response.status,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      contentType,
      bytes: buffer.length,
      hash: sha256(buffer),
      aiEligible,
      text,
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(changed) {
  const payload = changed.map((item) => ({
    sourceId: item.source.id,
    publisher: item.source.publisher,
    authorityLevel: item.source.authorityLevel,
    scope: item.source.scope,
    url: item.source.url,
    contentType: item.result.contentType,
    excerpt: item.result.text.slice(0, 12000),
  }));
  return [
    '你是 BrewIon 咖啡知识库维护器。只能依据提供的来源文本提出候选，不得凭记忆补事实，也不得调用或假定外部搜索。',
    '目标：识别咖啡国家/产区/庄园/农场/处理站/合作社/豆种/品种谱系/处理法/发酵/干燥等新增或修订线索。',
    '语言：核心名称尽量同时给出 zh-Hans 和 en；ja/ko 允许生成 ai_translated 或 ai_transliterated 候选，但必须保留原文，不能标成 official。',
    '严禁：直接修改二维码索引、重排旧 code、把 AI 推断当事实、把不同实体因同名强行合并。',
    '只返回 JSON。结构：{"candidates":[{"action":"ADD|CORRECT|ALIAS|RELATION|DEPRECATE","entityType":"country|region|farm|estate|producer|cooperative|factory|washing_station|wet_mill|dry_mill|exporter|variety|species|process|fermentation|drying|other","canonicalNameEn":"","canonicalNameZh":"","originalName":"","originalLanguage":"","nameJa":"","nameKo":"","sourceId":"","evidence":"","confidence":0.0,"notes":""}],"summary":""}',
    `来源数据：${JSON.stringify(payload)}`,
  ].join('\n\n');
}

async function callZhipu(changed) {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) return { ok: false, skipped: true, reason: 'ZHIPU_API_KEY is not configured' };
  if (!changed.length) return { ok: false, skipped: true, reason: 'no AI-eligible changed sources' };
  const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你是严格的数据抽取器。输出必须是有效 JSON，不输出 Markdown。' },
        { role: 'user', content: buildPrompt(changed) },
      ],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      temperature: 0.1,
      max_tokens: 8192,
      stream: false,
    }),
  });
  if (!response.ok) return { ok: false, reason: `Zhipu HTTP ${response.status}: ${(await response.text()).slice(0, 500)}` };
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  if (!content) return { ok: false, reason: 'Zhipu response has no message content' };
  try {
    const parsed = JSON.parse(content);
    return { ok: true, data: parsed, usage: body.usage || null };
  } catch (error) {
    return { ok: false, reason: `Zhipu JSON parse failed: ${error.message}` };
  }
}

const fetched = [];
for (const source of (registry.sources || []).filter((x) => x.enabled !== false)) {
  const result = await fetchSource(source);
  const previous = state.sources[source.id] || null;
  const isFirstBaseline = result.ok && !previous?.hash && !forceAiScan;
  const changed = result.ok && (forceAiScan || (!!previous?.hash && previous.hash !== result.hash));
  fetched.push({ source, result, previous, isFirstBaseline, changed });
}

const changedSources = fetched.filter((x) => x.changed);
const aiChangedSources = changedSources.filter((x) => x.result.aiEligible && x.result.text);
const manualChangedSources = changedSources.filter((x) => !x.result.aiEligible || !x.result.text);
let ai = { ok: false, skipped: true, reason: 'no AI-eligible changed sources' };
if (aiChangedSources.length) ai = await callZhipu(aiChangedSources);

for (const item of fetched) {
  if (!item.result.ok) continue;
  const canAdvance = item.isFirstBaseline ||
    !item.changed ||
    !item.result.aiEligible ||
    ai.ok;
  if (!canAdvance) continue;
  state.sources[item.source.id] = {
    url: item.source.url,
    hash: item.result.hash,
    etag: item.result.etag,
    lastModified: item.result.lastModified,
    contentType: item.result.contentType,
    bytes: item.result.bytes,
    aiEligible: item.result.aiEligible,
    checkedAt: now,
  };
}
state.updatedAt = now;
fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

const candidates = Array.isArray(ai.data?.candidates) ? ai.data.candidates : [];
const candidateDoc = {
  _format: 'coffee-knowledge-weekly-candidates',
  generatedAt: now,
  model,
  paidSearchUsed: false,
  aiUsed: ai.ok,
  changedSources: changedSources.map((x) => x.source.id),
  aiEligibleChangedSources: aiChangedSources.map((x) => x.source.id),
  manualReviewChangedSources: manualChangedSources.map((x) => x.source.id),
  aiUsage: ai.usage || null,
  summary: ai.data?.summary || '',
  candidates,
};
fs.writeFileSync(candidatePath, `${JSON.stringify(candidateDoc, null, 2)}\n`, 'utf8');

const firstBaselines = fetched.filter((x) => x.isFirstBaseline).map((x) => x.source.id);
const failures = fetched.filter((x) => !x.result.ok);
const lines = [
  '# BrewIon Coffee Knowledge Weekly Report',
  '',
  `- Run: ${now}`,
  `- Sources checked: ${fetched.length}`,
  `- First-time baselines: ${firstBaselines.length}`,
  `- Changed sources: ${changedSources.length}`,
  `- AI-eligible changed sources: ${aiChangedSources.length}`,
  `- Manual-review changed sources: ${manualChangedSources.length}`,
  `- Fetch failures: ${failures.length}`,
  `- GLM model: ${model}`,
  `- AI used: ${ai.ok ? 'yes' : 'no'}`,
  `- Candidate count: ${candidates.length}`,
  '- Paid search used: no',
  '',
  '## Changed text/HTML sources',
  ...(aiChangedSources.length ? aiChangedSources.map((x) => `- ${x.source.id}: ${x.source.url}`) : ['- None']),
  '',
  '## Changed binary/manual-review sources',
  ...(manualChangedSources.length ? manualChangedSources.map((x) => `- ${x.source.id}: ${x.source.url} (${x.result.contentType})`) : ['- None']),
  '',
  '## Fetch failures',
  ...(failures.length ? failures.map((x) => `- ${x.source.id}: ${x.result.error}`) : ['- None']),
  '',
  '## AI status',
  ai.ok ? '- Completed. Candidates require human review before any formal database change.' : `- ${ai.reason || 'Skipped'}`,
  '',
  '## Safety',
  '- Binary/PDF sources are content-hashed but are not decoded as UTF-8 or sent as garbled text to GLM.',
  '- No QR indexed row was edited by this job.',
  '- No paid web search was used.',
  '- AI candidates are not official data and are never auto-merged.',
  '',
];
fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
