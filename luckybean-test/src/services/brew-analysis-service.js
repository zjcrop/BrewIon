import { get, put } from '../db.js';
import { sha256Hex } from '../utils.js';

export const BREW_ANALYSIS_CONTRACT = 'brew-analysis/2.0';
export const BREW_SPATIAL_CONTRACT = 'brew-spatial/1.1';
export const BREW_ANALYSIS_ENDPOINT = 'https://vaxwncdcuvbpvdbbketb.supabase.co/functions/v1/brew-analyze-v2';
export const BREW_ANALYSIS_SERVICE_VERSION = 'luckybean-analysis-client/1.1.0';

const SUPABASE_KEY = 'sb_publishable_MsB0RFoxxf5zJbbT9PPBjQ_WP7GBMMn';
const SESSION_KEY = 'luckybean.supabase.session.v099d';
const CACHE_PREFIX = 'brew.analysis.cache.v2.';
const DEFAULT_TIMEOUT_MS = 6500;

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

async function inputFingerprint(input) {
  return `sha256:${await sha256Hex(JSON.stringify(canonical(input)))}`;
}

async function cacheKey(input) {
  return `${CACHE_PREFIX}${(await inputFingerprint(input)).slice(7)}`;
}

function assertFinite(value, field) {
  if (!Number.isFinite(Number(value))) throw new Error(`专业分析结果字段无效：${field}`);
  return Number(value);
}

function validateSpatial(spatial) {
  if (!spatial || spatial.schemaVersion !== BREW_SPATIAL_CONTRACT) {
    throw new Error(`专业分析缺少 ${BREW_SPATIAL_CONTRACT} 三维轨迹`);
  }
  if (!spatial.planFingerprint) throw new Error('专业分析三维轨迹缺少方案指纹');
  if (!Array.isArray(spatial.path) || spatial.path.length < 2) throw new Error('专业分析三维轨迹点不足');
  let previousTime = -Infinity;
  let previousWater = -Infinity;
  for (const [index, point] of spatial.path.entries()) {
    if (!Array.isArray(point) || point.length < 3) throw new Error(`三维轨迹第 ${index + 1} 点格式无效`);
    const time = assertFinite(point[0], `trajectory.path[${index}].time`);
    assertFinite(point[1], `trajectory.path[${index}].temperature`);
    const water = assertFinite(point[2], `trajectory.path[${index}].water`);
    if (time < previousTime) throw new Error('三维轨迹时间必须单调递增');
    if (water < previousWater) throw new Error('三维轨迹累计注水必须单调递增');
    previousTime = time;
    previousWater = water;
  }
  if (!Array.isArray(spatial.targets)) throw new Error('专业分析缺少三维风味靶区');
  return spatial;
}

function validateAnalysis(analysis, { expectedInputFingerprint = '' } = {}) {
  if (!analysis || analysis.contract !== BREW_ANALYSIS_CONTRACT) {
    throw new Error(`专业分析接口契约不匹配，应为 ${BREW_ANALYSIS_CONTRACT}`);
  }
  if (!analysis.analysisFingerprint) throw new Error('专业分析缺少统一计算指纹');
  if (!analysis.plan || typeof analysis.plan !== 'object') throw new Error('专业分析缺少冲煮方案');
  validateSpatial(analysis.trajectory);
  const metadata = analysis.metadata || {};
  const planFingerprint = metadata.planFingerprint || analysis.plan.metadata?.fingerprint || '';
  if (planFingerprint && analysis.trajectory.planFingerprint !== planFingerprint) {
    throw new Error('冲煮方案与三维轨迹指纹不一致');
  }
  if (expectedInputFingerprint && metadata.inputFingerprint !== expectedInputFingerprint) {
    throw new Error('专业分析返回的输入指纹与本次请求不一致');
  }
  return analysis;
}

function mapStage(stage, index) {
  const start = Number(stage.start ?? stage.startSec ?? 0);
  const end = Number(stage.end ?? (start + Number(stage.durationSec ?? 0)));
  const pour = Number(stage.pour ?? stage.stageWaterG ?? 0);
  const cumulative = Number(stage.cumulative ?? stage.cumulativeWaterG ?? pour);
  const temperature = Number(stage.pourTemperature ?? stage.temperatureC ?? stage.temp ?? 90);
  const bedTemperature = Number(stage.bedTemperatureEnd ?? stage.estimatedBedTemperature ?? stage.coreTemperatureC ?? temperature);
  const flow = Number(stage.flow ?? stage.flowGPerSec ?? 0);
  return {
    ...stage,
    index: Number(stage.index ?? index + 1),
    start,
    end,
    pour,
    cumulative,
    temp: temperature,
    flow,
    startSec: start,
    durationSec: Math.max(0, end - start),
    stageWaterG: pour,
    cumulativeWaterG: cumulative,
    temperatureC: temperature,
    coreTemperatureC: bedTemperature,
    flowGPerSec: flow
  };
}

/**
 * Adds compatibility aliases only. No stage value, recommendation, risk or trajectory
 * is recalculated in LuckyBean; BrewProfiles remains authoritative.
 */
export function adaptAuthoritativePlan(analysis) {
  validateAnalysis(analysis);
  const source = structuredClone(analysis.plan);
  const stages = (source.stages || []).map(mapStage);
  const summary = source.summary || {};
  const totalWater = Number(summary.totalWater ?? source.totals?.waterG ?? stages.at(-1)?.cumulative ?? 0);
  const dose = Number(summary.dose ?? source.totals?.doseG ?? analysis.input?.brew?.doseG ?? 0);
  const ratio = Number(summary.ratio ?? source.totals?.ratio ?? (dose > 0 ? totalWater / dose : 0));
  const totalTime = Number(summary.totalTime ?? source.totals?.targetTimeSec ?? stages.at(-1)?.end ?? 0);
  return {
    ...source,
    stages,
    totals: {
      ...(source.totals || {}),
      doseG: dose,
      waterG: totalWater,
      ratio,
      targetTimeSec: totalTime
    },
    trajectory: analysis.trajectory,
    visualization3d: analysis.trajectory,
    prediction: analysis.prediction,
    integrations: analysis.integrations,
    analysisContract: analysis.contract,
    analysisFingerprint: analysis.analysisFingerprint,
    analysisRequestId: analysis.requestId,
    analysisGeneratedAt: analysis.generatedAt,
    analysisSnapshot: structuredClone(analysis),
    executionSource: 'brew-profiles-authoritative',
    clientAdjusted: false
  };
}

async function cached(input) {
  const id = await cacheKey(input);
  const expected = await inputFingerprint(input);
  const record = await get('syncMetadata', id).catch(() => null);
  if (!record?.analysis) return null;
  try {
    return { analysis: validateAnalysis(record.analysis, { expectedInputFingerprint: expected }), cacheId: id, cached: true };
  } catch {
    return null;
  }
}

async function persistCache(input, analysis) {
  const id = await cacheKey(input);
  await put('syncMetadata', {
    id,
    analysis: structuredClone(analysis),
    contract: BREW_ANALYSIS_CONTRACT,
    fingerprint: analysis.analysisFingerprint,
    inputFingerprint: await inputFingerprint(input),
    engineVersion: analysis.metadata?.engineVersion || '',
    createdAt: new Date().toISOString()
  });
  return id;
}

async function accessToken() {
  const cloud = globalThis.LuckyBeanCloudAuth;
  if (cloud?.getAccessToken) return cloud.getAccessToken();
  return readSession()?.access_token || '';
}

async function fetchAnalysis(input, { endpoint = BREW_ANALYSIS_ENDPOINT, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const token = await accessToken();
  if (!token) {
    const error = new Error('专业冲煮分析需要登录云端账号');
    error.code = 'AUTH_REQUIRED';
    throw error;
  }
  const expected = await inputFingerprint(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${token}`,
        'x-client-info': BREW_ANALYSIS_SERVICE_VERSION,
        'x-request-id': crypto.randomUUID()
      },
      body: JSON.stringify(input),
      cache: 'no-store',
      signal: controller.signal
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; }
    catch { payload = null; }
    if (!response.ok) {
      const error = new Error(payload?.message || payload?.error || payload?.code || `专业冲煮分析失败（HTTP ${response.status}）`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return validateAnalysis(payload, { expectedInputFingerprint: expected });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('专业冲煮分析连接超时');
      timeoutError.code = 'NETWORK_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestBrewAnalysis(input, options = {}) {
  const cacheRecord = await cached(input);
  if (cacheRecord && options.preferFresh !== true) {
    return { ...cacheRecord, plan: adaptAuthoritativePlan(cacheRecord.analysis) };
  }
  try {
    const analysis = await fetchAnalysis(input, options);
    const cacheId = await persistCache(input, analysis);
    return { analysis, plan: adaptAuthoritativePlan(analysis), cacheId, cached: false };
  } catch (error) {
    if (cacheRecord) return { ...cacheRecord, plan: adaptAuthoritativePlan(cacheRecord.analysis), stale: true, networkError: error.message };
    throw error;
  }
}

export async function requestAuthoritativePlan(input, options = {}) {
  return (await requestBrewAnalysis(input, options)).plan;
}
