const SUPABASE_URL = 'https://vaxwncdcuvbpvdbbketb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_MsB0RFoxxf5zJbbT9PPBjQ_WP7GBMMn';
const FUNCTION_NAME = 'brew-plan-v21';
const SESSION_KEY = 'luckybean.supabase.session.v099d';
const CACHE_KEY = 'luckybean.brew.profiles.v21';
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CLIENT_VERSION = '1.0.7-consolidated';
let memoryCache = null;
let syncPromise = null;

function readJson(storage, key, fallback = null) {
  try { return JSON.parse(storage?.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

function writeJson(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); }
  catch { /* private mode or quota failure: keep memory cache only */ }
}

function loadCache() {
  if (memoryCache) return memoryCache;
  const value = readJson(globalThis.localStorage, CACHE_KEY, null);
  memoryCache = value && Array.isArray(value.profiles) ? value : { profiles: [], updatedAt: '', apiVersion: '' };
  return memoryCache;
}

function sanitizeProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const id = String(profile.id || '').trim();
  const label = String(profile.label || '').trim();
  if (!id || !label || id.length > 120 || label.length > 120) return null;
  return {
    id,
    label,
    version: String(profile.version || 'server'),
    status: String(profile.status || 'active'),
    tags: Array.isArray(profile.tags) ? profile.tags.map(String).slice(0, 20) : [],
    description: String(profile.description || '').slice(0, 600),
    source: String(profile.source || 'brew-profiles/private-service').slice(0, 240),
    compatibleDripperGroups: Array.isArray(profile.compatibleDripperGroups)
      ? profile.compatibleDripperGroups.map(String).slice(0, 12)
      : [],
    autoRecommend: profile.autoRecommend === true,
    remote: true
  };
}

function activeSession() {
  const session = readJson(globalThis.localStorage, SESSION_KEY, null);
  return session?.access_token && session?.user?.id ? session : null;
}

async function refreshSession(session) {
  if (!session?.refresh_token) throw new Error('AUTH_REQUIRED');
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) throw new Error('AUTH_REQUIRED');
  const next = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || session.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600),
    user: payload.user || session.user
  };
  writeJson(globalThis.localStorage, SESSION_KEY, next);
  return next;
}

async function validSession() {
  let session = activeSession();
  if (!session) throw new Error('AUTH_REQUIRED');
  const expiresAt = Number(session.expires_at || 0);
  if (expiresAt && Date.now() >= (expiresAt - 45) * 1000) session = await refreshSession(session);
  return session;
}

async function serviceRequest(path, options = {}, timeoutMs = 12000) {
  let session = await validSession();
  const request = async token => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}${path}`, {
        ...options,
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Client-Info': `luckybean/${CLIENT_VERSION}`,
          'X-Request-Id': crypto.randomUUID(),
          ...(options.headers || {})
        },
        cache: 'no-store',
        signal: controller.signal
      });
    } finally { clearTimeout(timer); }
  };
  let response = await request(session.access_token);
  if (response.status === 401 && session.refresh_token) {
    session = await refreshSession(session);
    response = await request(session.access_token);
  }
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok || payload?.ok === false) {
    const message = payload?.details?.errors?.map(item => item.message).filter(Boolean).join('；')
      || payload?.code || payload?.message || `BREW_SERVICE_HTTP_${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function getSyncedBrewProfiles() {
  return loadCache().profiles.map(profile => ({ ...profile, tags: [...(profile.tags || [])] }));
}

export function getBrewProfileSyncStatus() {
  const cache = loadCache();
  const updated = Date.parse(cache.updatedAt || '') || 0;
  return {
    authenticated: Boolean(activeSession()),
    count: cache.profiles.length,
    updatedAt: cache.updatedAt || '',
    apiVersion: cache.apiVersion || '',
    stale: !updated || Date.now() - updated > CACHE_MAX_AGE_MS,
    syncing: Boolean(syncPromise)
  };
}

export async function syncBrewProfileCatalog({ force = false } = {}) {
  const status = getBrewProfileSyncStatus();
  if (!status.authenticated) return { ...status, updated: false, reason: 'auth-required' };
  if (!force && !status.stale && status.count) return { ...status, updated: false, reason: 'fresh-cache' };
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const payload = await serviceRequest('?mode=profiles', { method: 'GET' });
    const profiles = (payload?.profiles || []).map(sanitizeProfile).filter(Boolean);
    if (!profiles.length) throw new Error('私有冲煮服务未返回可用方案');
    const unique = [...new Map(profiles.map(profile => [profile.id, profile])).values()];
    memoryCache = {
      profiles: unique,
      updatedAt: new Date().toISOString(),
      apiVersion: String(payload.apiVersion || ''),
      source: 'brew-plan-v21'
    };
    writeJson(globalThis.localStorage, CACHE_KEY, memoryCache);
    return { ...getBrewProfileSyncStatus(), updated: true };
  })().finally(() => { syncPromise = null; });
  return syncPromise;
}

export function isSyncedBrewProfile(profileId) {
  return getSyncedBrewProfiles().some(profile => profile.id === profileId);
}

function roastLevel(code) {
  const value = Number(String(code || '').match(/L([0-6])/)?.[1] ?? 2);
  return ['ultraLight', 'light', 'light', 'medium', 'mediumDark', 'dark', 'ultraDark'][Math.max(0, Math.min(6, value))];
}

function processName(value) {
  const text = String(value || '').toLowerCase();
  if (/natural|nat|dry|日晒/.test(text)) return 'natural';
  if (/honey|蜜/.test(text)) return 'honey';
  if (/wet|湿刨/.test(text)) return 'wetHulled';
  return 'washed';
}

function altitudeBand(value) {
  const altitude = Number(value || 0);
  if (altitude >= 1900) return 'veryHigh';
  if (altitude >= 1600) return 'high';
  if (altitude >= 1200) return 'mid';
  return 'low';
}

function varietyName(value) {
  const text = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/74110/.test(text)) return '74110';
  if (/74112/.test(text)) return '74112';
  if (/74158/.test(text)) return '74158';
  if (/gesha|geisha|瑰夏/.test(text)) return 'gesha';
  if (/pinkbourbon|粉波旁/.test(text)) return 'pinkBourbon';
  if (/bourbon|波旁/.test(text)) return 'bourbon';
  if (/typica|铁皮卡/.test(text)) return 'typica';
  if (/caturra|卡杜拉/.test(text)) return 'caturra';
  if (/catuai|卡图艾/.test(text)) return 'catuai';
  if (/pacamara|帕卡马拉/.test(text)) return 'pacamara';
  if (/sl28/.test(text)) return 'sl28';
  if (/sl34/.test(text)) return 'sl34';
  return 'heirloomBlend';
}

function dripperName(value) {
  const text = String(value || '').toLowerCase();
  if (/b75/.test(text)) return 'b75';
  if (/april/.test(text)) return 'april';
  if (/orea/.test(text)) return 'orea';
  if (/kalita.*155|155/.test(text)) return 'kalita155';
  if (/kalita.*185|185/.test(text)) return 'kalita185';
  if (/switch|浸泡/.test(text)) return 'switch_immersion';
  if (/clever/.test(text)) return 'clever';
  if (/pulsar/.test(text)) return 'pulsar';
  if (/tricolate|低旁路/.test(text)) return 'tricolate';
  if (/kono/.test(text)) return 'kono';
  if (/origami/.test(text)) return 'origami_cone';
  if (/v60|锥形/.test(text)) return 'v60_02';
  if (/平底/.test(text)) return 'b75';
  return 'custom';
}

function grinderModel(value) {
  const text = String(value || '').toLowerCase();
  if (/c40|comandante/.test(text)) return 'c40';
  if (/zp6/.test(text)) return 'zp6';
  if (/k6|kingrinder/.test(text)) return 'k6';
  if (/幻刺/.test(text)) return 'huanci';
  return 'generic';
}

function targetChoice(value, low, mid, high) {
  const number = Number(value || 0);
  if (number < 1) return low;
  if (number < 2.2) return mid;
  return high;
}

function serviceInput(input, profileId) {
  const bean = input?.bean || {};
  const brew = input?.brew || {};
  const water = input?.water || {};
  const target = input?.targets || {};
  const custom = water.customProfile || {};
  return {
    dose: Number(brew.doseG || 15),
    roastLevel: roastLevel(bean.roastCode),
    roastColorValue: Number(bean.roastColor || 65),
    process: processName(bean.processCode),
    altitudeBand: altitudeBand(bean.altitude),
    variety: varietyName(bean.varietyCustomName || bean.varietyCode),
    beanCondition: 'normal',
    flavorNote: String(bean.flavorNote || ''),
    dripper: dripperName(brew.dripperCode),
    filterPaper: /fast|快/i.test(brew.filterPaper || '') ? 'fast' : /slow|慢/i.test(brew.filterPaper || '') ? 'slow' : 'wave',
    kettleFlowBase: 5.5,
    brewStyle: profileId,
    useLowBloom: brew.lowTempFirst !== false,
    bloomTemp: brew.firstCoolingMode === 'custom' ? Number(brew.firstTemperatureC || 86) : null,
    water: {
      type: 'custom',
      tds: Number(custom.tds || water.tdsMgL || 90),
      calcium: custom.ca == null ? null : Number(custom.ca),
      magnesium: custom.mg == null ? null : Number(custom.mg),
      bicarbonate: custom.hco3 == null ? null : Number(custom.hco3),
      intent: targetChoice(target.floral, 'body', 'balanced', 'clarity')
    },
    grinder: { model: grinderModel(brew.grinder), manualOffset: Number(brew.grindTune || 0) },
    target: {
      aroma: targetChoice(target.floral, 'balanced', 'fruity', 'floral'),
      acidity: targetChoice(target.acidity, 'soft', 'bright', 'sharp'),
      sweetness: targetChoice(target.sweetness, 'balanced', 'cleanSweet', 'highSweet'),
      bitterness: targetChoice(target.bitterness, 'balanced', 'suppressed', 'suppressed'),
      body: targetChoice(target.body, 'light', 'balanced', 'full'),
      smoothness: 'clean'
    },
    tune: {
      temperature: Number(brew.temperatureTune || 0),
      water: 0,
      bloomSeconds: Number(brew.bloomTune || 0),
      flow: 0,
      tailTemperature: brew.tailCoolingMode === 'custom' ? Number(brew.tailTemperatureC || 0) - 88 : 0,
      grind: Number(brew.grindTune || 0)
    }
  };
}

function warningText(warning) {
  if (typeof warning === 'string') return warning;
  return [warning?.code, warning?.message].filter(Boolean).join('：') || '私有服务端返回提示';
}

function normalizeServerPlan(payload, originalInput, requestedProfileId) {
  const remote = payload?.plan;
  if (!remote || !Array.isArray(remote.stages) || !remote.stages.length) throw new Error('私有冲煮服务响应缺少阶段');
  const summary = remote.summary || {};
  const metadata = remote.metadata || {};
  const profile = sanitizeProfile(remote.profile || getSyncedBrewProfiles().find(item => item.id === requestedProfileId) || {
    id: requestedProfileId,
    label: requestedProfileId
  });
  const stages = remote.stages.map((stage, index) => {
    const start = Number(stage.start || 0);
    const end = Number(stage.end || start + 1);
    const pour = Number(stage.pour ?? stage.stageWaterG ?? 0);
    return {
      index: Number(stage.index || index + 1),
      name: String(stage.name || `第${index + 1}段`),
      startSec: start,
      durationSec: Math.max(1, end - start),
      stageWaterG: pour,
      cumulativeWaterG: Number(stage.cumulative ?? stage.cumulativeWaterG ?? pour),
      temperatureC: Number(stage.pourTemperature ?? stage.temperatureC ?? summary.basePourTemperature ?? 90),
      coreTemperatureC: Number(stage.pourTemperature ?? stage.temperatureC ?? summary.basePourTemperature ?? 90),
      flowGPerSec: Number(stage.flow ?? stage.flowGPerSec ?? (pour / Math.max(1, end - start))),
      method: String(stage.method || stage.pourPattern || '按阶段执行'),
      methodCode: String(stage.pourPattern || stage.methodCode || 'SERVER'),
      agitation: String(stage.agitation || 'none'),
      notice: String(stage.transitionCondition || stage.notice || '')
    };
  });
  const dose = Number(summary.dose || originalInput?.brew?.doseG || 15);
  const totalWater = Number(summary.totalWater || stages.at(-1)?.cumulativeWaterG || 0);
  const totalTime = Number(summary.totalTime || stages.reduce((sum, stage) => sum + stage.durationSec, 0));
  const target = originalInput?.targets || {};
  const waterModel = remote.models?.water || {};
  const cupModel = remote.models?.cup || {};
  return {
    schemaVersion: 2,
    engineVersion: String(metadata.engineVersion || payload.apiVersion || 'brew-plan-v21'),
    profileVersion: `${profile?.id || requestedProfileId}@${profile?.version || metadata.profileVersion || 'server'}`,
    source: 'brew-profiles-private-service',
    profile: profile || { id: requestedProfileId, label: requestedProfileId, tags: [] },
    recommendation: { selectedBy: remote.recommendation?.selectedBy || 'private-service', candidates: [] },
    totals: { doseG: dose, waterG: totalWater, ratio: Number(summary.ratio || totalWater / Math.max(1, dose)), targetTimeSec: totalTime },
    stages,
    grinder: summary.grinder ? {
      label: String(summary.grinder.modelLabel || summary.grinder.model || '私有服务端建议'),
      recommended: String(summary.grinder.finalSetting || summary.grinder.setting || '—'),
      unit: ''
    } : null,
    water: {
      profile: {
        name: '私有服务端水质模型',
        ca: waterModel.calcium ?? '—',
        mg: waterModel.magnesium ?? '—',
        hco3: waterModel.bicarbonate ?? '—'
      },
      modelVersion: String(metadata.engineVersion || payload.apiVersion || 'brew-plan-v21'),
      doses: []
    },
    flavorFit: {
      floral: Math.min(1, Number(target.floral || 0) / 3),
      acidity: Math.min(1, Number(target.acidity || 0) / 3),
      sweetness: Math.min(1, Number(target.sweetness || 0) / 3),
      body: Math.min(1, Number(target.body || 0) / 3),
      bitterness: Math.min(1, Number(target.bitterness || 0) / 3),
      clarity: 0.7
    },
    extractionModel: {
      targetEY: cupModel.predictedExtractionYield ?? '—',
      predictedTds: cupModel.predictedTds ?? '—'
    },
    professional: {
      calculationModelVersion: String(metadata.engineVersion || payload.apiVersion || 'brew-plan-v21'),
      hydraulics: { averageFlowGPerSec: stages.reduce((sum, stage) => sum + Number(stage.flowGPerSec || 0), 0) / stages.length }
    },
    firstPourReason: '首段参数由闭源 brew-plan-v21 服务按当前豆子、器具和目标计算。',
    warnings: (remote.warnings || []).map(warningText),
    privateService: {
      apiVersion: String(payload.apiVersion || ''),
      requestId: String(payload.requestId || ''),
      quotaRemaining: payload.quota?.remaining ?? null,
      outputContract: String(remote.integration?.outputContract || 'brew-plan/2.1')
    }
  };
}

export async function requestSyncedBrewPlan(input, profileId, timeoutMs = 15000) {
  const body = {
    input: serviceInput(input, profileId),
    options: { clientVersion: CLIENT_VERSION, platform: 'luckybean-android', ui: 'luckybean-v1' }
  };
  const payload = await serviceRequest('', { method: 'POST', body: JSON.stringify(body) }, timeoutMs);
  return normalizeServerPlan(payload, input, profileId);
}
