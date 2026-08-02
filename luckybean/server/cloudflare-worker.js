const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
}

function isOriginAllowed(request, env) {
  const allowed = allowedOrigins(env);
  const origin = request.headers.get('origin') || '';
  return !allowed.length || !origin || allowed.includes(origin);
}

function cors(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = allowedOrigins(env);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || 'null';
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'vary': 'origin'
  };
}

function json(body, status, request, env) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors(request, env) } });
}

function clamp(value, min, max) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : min));
}

async function checkRateLimit(request, env) {
  if (!env.RATE_LIMIT_KV) return { allowed: true };
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const minute = Math.floor(Date.now() / 60000);
  const key = `brew:${ip}:${minute}`;
  const current = Number(await env.RATE_LIMIT_KV.get(key) || 0);
  const limit = clamp(env.REQUESTS_PER_MINUTE || 30, 1, 300);
  if (current >= limit) return { allowed: false, retryAfter: 60 - Math.floor((Date.now() % 60000) / 1000) };
  await env.RATE_LIMIT_KV.put(key, String(current + 1), { expirationTtl: 120 });
  return { allowed: true };
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请求必须是对象');
  if (input.schemaVersion !== 1) throw new Error('请求 Schema 版本不兼容');
  if (!input.bean || !input.brew) throw new Error('请求缺少 bean 或 brew');
  const dose = Number(input.brew.doseG);
  const ratio = Number(input.brew.ratio);
  if (!Number.isFinite(dose) || dose < 5 || dose > 40) throw new Error('粉量超出 5–40g');
  if (!Number.isFinite(ratio) || ratio < 8 || ratio > 25) throw new Error('粉水比超出 8–25');
  return input;
}

async function loadPrivateProfile(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY || !env.PROFILE_PATH) throw new Error('服务端未配置私有仓库凭据');
  const ref = env.GITHUB_REF || 'main';
  const url = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/contents/${env.PROFILE_PATH}?ref=${encodeURIComponent(ref)}`;
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'luckybean-brew-api',
      'x-github-api-version': '2022-11-28'
    },
    cf: { cacheTtl: 60, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`私有配置读取失败：GitHub HTTP ${response.status}`);
  const payload = await response.json();
  const text = atob(String(payload.content || '').replace(/\s/g, ''));
  const bytes = Uint8Array.from(text, char => char.charCodeAt(0));
  const profile = JSON.parse(new TextDecoder().decode(bytes));
  if (profile.schemaVersion !== 1 || !profile.version) throw new Error('私有配置 Schema 无效');
  return profile;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}

async function compute(input, profile) {
  const dose = clamp(input.brew.doseG, 5, 40);
  const ratio = clamp(input.brew.ratio, 8, 25);
  const water = Math.round(dose * ratio);
  const roastLevel = Number(String(input.bean.roastCode || 'RL-L2').replace(/\D/g, '')) || 2;
  const temperature = Math.round(clamp((profile.temperature?.baseC ?? 94) - roastLevel * (profile.temperature?.roastSlope ?? 1.2), 84, 96));
  const bloom = Math.round(clamp(dose * (profile.bloom?.multiple ?? 2.8), profile.bloom?.minG ?? 30, profile.bloom?.maxG ?? 55));
  const weights = Array.isArray(profile.pourover?.weights) && profile.pourover.weights.length ? profile.pourover.weights : [0.32, 0.28, 0.22, 0.18];
  const weightSum = weights.reduce((sum, value) => sum + Number(value), 0);
  const remaining = water - bloom;
  let cumulative = bloom;
  let startSec = 0;
  const stages = [{ index: 1, name: '闷蒸', startSec, durationSec: profile.bloom?.durationSec ?? 35, stageWaterG: bloom, cumulativeWaterG: bloom, temperatureC: temperature - 2, flowGPerSec: 2.5, method: profile.bloom?.method || '中心湿润' }];
  startSec += stages[0].durationSec;
  weights.forEach((weight, index) => {
    const stageWater = index === weights.length - 1 ? water - cumulative : Math.round(remaining * Number(weight) / weightSum);
    cumulative += stageWater;
    const durationSec = Math.round(clamp(stageWater / (profile.pourover?.flowGPerSec ?? 4) + 10, 20, 50));
    stages.push({ index: index + 2, name: `第 ${index + 2} 段`, startSec, durationSec, stageWaterG: stageWater, cumulativeWaterG: cumulative, temperatureC: index === weights.length - 1 ? temperature - 1 : temperature, flowGPerSec: profile.pourover?.flowGPerSec ?? 4, method: index === weights.length - 1 ? (profile.pourover?.tailMethod || '大水流快速收尾') : (profile.pourover?.method || '稳定绕圈注水') });
    startSec += durationSec;
  });
  return {
    schemaVersion: 1,
    engineVersion: profile.engineVersion || 'private-profile-engine-1',
    profileVersion: profile.version,
    inputHash: `sha256:${await sha256(input)}`,
    stages,
    totals: { doseG: dose, waterG: water, ratio, targetTimeSec: startSec },
    warnings: [],
    explanation: profile.explanation || []
  };
}

export default {
  async fetch(request, env) {
    if (!isOriginAllowed(request, env)) return json({ error: 'origin_not_allowed' }, 403, request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, request, env);
    const rate = await checkRateLimit(request, env);
    if (!rate.allowed) return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { ...JSON_HEADERS, ...cors(request, env), 'retry-after': String(rate.retryAfter) } });
    try {
      const contentLength = Number(request.headers.get('content-length') || 0);
      if (contentLength > 65536) return json({ error: 'payload_too_large' }, 413, request, env);
      const input = validateInput(await request.json());
      const profile = await loadPrivateProfile(env);
      return json(await compute(input, profile), 200, request, env);
    } catch (error) {
      return json({ error: 'brew_compute_failed', message: error.message }, 400, request, env);
    }
  }
};
