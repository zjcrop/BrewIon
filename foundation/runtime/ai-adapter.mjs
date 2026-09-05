import { sha256Text } from './artifact-activation.mjs';

export const AI_ENRICHMENT_RESULT_CONTRACT = 'ai-enrichment-result/1.0';
export const ZHIPU_CHAT_COMPLETIONS_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

const TASKS = new Set(['translate', 'normalize', 'alias', 'resolve', 'enrich', 'review']);
const STATUSES = new Set(['candidate', 'review', 'rejected', 'confirmed']);

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return null;
  const rows = value.filter(nonEmpty).map((item) => item.trim());
  return rows.length === value.length && new Set(rows).size === rows.length ? rows : null;
}

export function validateAiEnrichmentResult(value, { expectedFingerprint } = {}) {
  const root = record(value);
  if (!root) return { ok: false, errors: ['result-must-be-object'] };
  const allowedRoot = new Set(['schemaVersion', 'task', 'engine', 'model', 'createdAt', 'inputFingerprint', 'candidates', 'policy', 'extensions']);
  const errors = Object.keys(root).filter((key) => !allowedRoot.has(key)).map((key) => `unknown-root-property:${key}`);
  if (root.schemaVersion !== AI_ENRICHMENT_RESULT_CONTRACT) errors.push('unsupported-schema-version');
  if (!TASKS.has(root.task)) errors.push('invalid-task');
  if (!nonEmpty(root.engine)) errors.push('invalid-engine');
  if (root.model != null && !nonEmpty(root.model)) errors.push('invalid-model');
  if (!nonEmpty(root.createdAt) || !Number.isFinite(Date.parse(root.createdAt))) errors.push('invalid-created-at');
  if (!nonEmpty(root.inputFingerprint)) errors.push('invalid-input-fingerprint');
  if (expectedFingerprint && root.inputFingerprint !== expectedFingerprint) errors.push('input-fingerprint-mismatch');
  if (!Array.isArray(root.candidates)) errors.push('candidates-must-be-array');
  else root.candidates.forEach((candidate, index) => {
    const row = record(candidate);
    if (!row) { errors.push(`candidate-${index}-must-be-object`); return; }
    const allowed = new Set(['field', 'value', 'canonicalId', 'locale', 'confidence', 'status', 'reason', 'evidenceRefs']);
    for (const key of Object.keys(row)) if (!allowed.has(key)) errors.push(`candidate-${index}-unknown-property:${key}`);
    if (!nonEmpty(row.field)) errors.push(`candidate-${index}-invalid-field`);
    if (!Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) errors.push(`candidate-${index}-invalid-confidence`);
    if (!STATUSES.has(row.status)) errors.push(`candidate-${index}-invalid-status`);
    if (row.canonicalId != null && !nonEmpty(row.canonicalId)) errors.push(`candidate-${index}-invalid-canonical-id`);
    if (row.locale != null && !nonEmpty(row.locale)) errors.push(`candidate-${index}-invalid-locale`);
    if (!uniqueStrings(row.evidenceRefs)) errors.push(`candidate-${index}-invalid-evidence-refs`);
  });
  const policy = record(root.policy);
  if (!policy || policy.authority !== 'advisory' || policy.mayOverwriteFact !== false || Object.keys(policy).some((key) => !['authority', 'mayOverwriteFact'].includes(key))) {
    errors.push('invalid-advisory-policy');
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: root };
}

export async function fingerprintAiInput(input) {
  return sha256Text(JSON.stringify(input));
}

export function buildCoffeeBatchEnrichmentPrompt(samples, inputFingerprint) {
  return [
    '你是 Coffee Foundation 的结构化咖啡样品解析器。只能依据输入行提取候选，不得补写输入中不存在的事实。',
    '每条候选必须用 evidenceRefs 指向 sample:<index>；不确定项使用 review，禁止让模型结果覆盖用户确认值。',
    '只返回 JSON，不返回 Markdown。根结构必须严格为 ai-enrichment-result/1.0。',
    `inputFingerprint 必须原样返回：${inputFingerprint}`,
    '字段限于 label,country,region,entity,farm,station,producer,cooperative,variety,species,process,lot,grade,roast,roastDate,harvest,altitude,roaster,weight,flavorNotes。',
    `输入：${JSON.stringify(samples.map((text, index) => ({ evidenceRef: `sample:${index + 1}`, text })))}`
  ].join('\n\n');
}

export function createZhipuAiAdapter({ apiKey, model = 'glm-4-flash', endpoint = ZHIPU_CHAT_COMPLETIONS_URL, fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  return {
    provider: 'zhipu', model,
    async enrichCoffeeBatch(samples) {
      const rows = Array.isArray(samples) ? samples.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
      if (rows.length < 2) return { ok: false, skipped: true, reason: 'minimum-two-samples' };
      if (!nonEmpty(apiKey)) return { ok: false, skipped: true, reason: 'api-key-unavailable' };
      if (typeof fetchImpl !== 'function') return { ok: false, skipped: true, reason: 'fetch-unavailable' };
      const inputFingerprint = await fingerprintAiInput(rows);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST', signal: controller.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: '你是严格的 JSON 数据抽取器。不得输出 Markdown。' },
              { role: 'user', content: buildCoffeeBatchEnrichmentPrompt(rows, inputFingerprint) }
            ],
            response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, temperature: 0.1,
            max_tokens: 8192, stream: false
          })
        });
        if (!response.ok) return { ok: false, reason: `http-${response.status}` };
        const body = await response.json();
        const content = body?.choices?.[0]?.message?.content;
        if (!nonEmpty(content)) return { ok: false, reason: 'empty-response' };
        let parsed;
        try { parsed = JSON.parse(content); }
        catch { return { ok: false, reason: 'invalid-json' }; }
        const validation = validateAiEnrichmentResult(parsed, { expectedFingerprint: inputFingerprint });
        if (!validation.ok) return { ok: false, reason: 'schema-invalid', errors: validation.errors };
        return { ok: true, result: validation.value, usage: body?.usage ?? null };
      } catch (error) {
        return { ok: false, reason: error?.name === 'AbortError' ? 'timeout' : 'network-error' };
      } finally { clearTimeout(timer); }
    }
  };
}
