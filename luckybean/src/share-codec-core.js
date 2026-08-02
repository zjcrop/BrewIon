/**
 * Lucky Bean compact share format.
 *
 * Bean fields keep BrewIon codes. Brew stages use numeric dictionaries:
 * methodCode = <pour pattern 1-6><flow level 1-3>.
 */
export const SHARE_FORMAT_VERSION = 1;
export const SHARE_PREFIX = 'LB8';

export const POUR_PATTERN_DICTIONARY = Object.freeze({
  1: '中心注水',
  2: '绕圈注水',
  3: '中心向外绕圈',
  4: '外圈向中心绕圈',
  5: '浸泡/搅拌',
  6: '截流/排空'
});
export const FLOW_DICTIONARY = Object.freeze({ 1: '小流量', 2: '中流量', 3: '大流量' });

const PROFILE_CODES = Object.freeze({
  'recommended': 0,
  'one-pour': 1,
  'two-pulse': 2,
  'three-pulse': 3,
  'four-six-v17': 4,
  'flat46-clean': 5,
  'five-pulse': 6,
  'pulse-30x15': 7
});
const PROFILE_IDS = Object.freeze(Object.fromEntries(Object.entries(PROFILE_CODES).map(([key, value]) => [value, key])));

const SENSORY_DICTIONARY = Object.freeze([
  '无','白花','茉莉','玫瑰','橙花','紫罗兰','洋甘菊','柑橘','莓果','桃子','苹果','葡萄','热带水果','干果',
  '茶感','香料','坚果','巧克力','酒香','草本','豆腐/豆味','蜂蜜','蔗糖','红糖','焦糖','枫糖','糖浆','太妃糖',
  '低','适中','高','微酸','圆润舒适','尖锐','醋酸','柠檬','醋栗','偏高','焦苦','轻盈','顺滑','圆润','奶油感',
  '厚重','干涩','收敛','纸味','木质','土味','霉味','发酵过度','药感','橡胶','金属感'
]);
const SENSORY_TO_CODE = new Map(SENSORY_DICTIONARY.map((value, index) => [value, index]));

function base64UrlEncode(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function base64UrlDecode(text) {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - text.length % 4) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function streamTransform(bytes, kind, format) {
  const Stream = kind === 'compress' ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (!Stream) throw new Error(`${kind === 'compress' ? 'Compression' : 'Decompression'}Stream unavailable`);
  const stream = new Blob([bytes]).stream().pipeThrough(new Stream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function compactDate(value) {
  const match = String(value || '').match(/^(20)?(\d{2})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}${match[3]}${match[4]}` : String(value || '');
}
function expandDate(value) {
  return /^\d{6}$/.test(String(value || '')) ? `20${String(value).slice(0,2)}-${String(value).slice(2,4)}-${String(value).slice(4,6)}` : String(value || '');
}
function sensoryCode(value) {
  const key = String(value || '');
  return SENSORY_TO_CODE.has(key) ? SENSORY_TO_CODE.get(key) : `~${key.slice(0, 40)}`;
}
function sensoryValue(code) {
  if (typeof code === 'number') return SENSORY_DICTIONARY[code] || '';
  return String(code || '').startsWith('~') ? String(code).slice(1) : String(code || '');
}
function inferMethodCode(stage = {}) {
  if (/^\d{2}$/.test(String(stage.methodCode || ''))) return String(stage.methodCode);
  const method = String(stage.method || '');
  let pattern = 1;
  if (/截流|排空|收尾/.test(method)) pattern = 6;
  else if (/浸泡|搅拌|摇/.test(method)) pattern = 5;
  else if (/外圈.{0,4}中心/.test(method)) pattern = 4;
  else if (/中心.{0,4}外/.test(method)) pattern = 3;
  else if (/绕圈|画圈/.test(method)) pattern = 2;
  const flow = Number(stage.flowGPerSec || 0) >= 5.3 ? 3 : Number(stage.flowGPerSec || 0) >= 3.7 ? 2 : 1;
  return `${pattern}${flow}`;
}
function decodeMethod(code) {
  const value = String(code || '12');
  return `${POUR_PATTERN_DICTIONARY[value[0]] || '中心注水'} · ${FLOW_DICTIONARY[value[1]] || '中流量'}`;
}

function packStage(stage = {}) {
  return [
    Math.round(Number(stage.durationSec || 0)),
    Math.round(Number(stage.stageWaterG || 0)),
    inferMethodCode(stage),
    Math.round(Number(stage.temperatureC || 0)),
    Math.round(Number(stage.drainWaitSec || 0)),
    stage.agitation && stage.agitation !== 'none' ? String(stage.agitation).slice(0, 12) : ''
  ];
}
function unpackStages(rows = []) {
  let cumulative = 0;
  let elapsed = 0;
  return rows.map((row, index) => {
    const [durationSec, stageWaterG, methodCode, temperatureC, drainWaitSec, agitation] = row;
    cumulative += Number(stageWaterG || 0);
    const stage = {
      index: index + 1,
      name: index === 0 ? '闷蒸' : (index === rows.length - 1 ? '尾段收束' : `主萃 ${index}`),
      startSec: elapsed,
      durationSec: Number(durationSec || 0),
      stageWaterG: Number(stageWaterG || 0),
      cumulativeWaterG: cumulative,
      temperatureC: Number(temperatureC || 0),
      methodCode: String(methodCode || '12'),
      method: decodeMethod(methodCode),
      drainWaitSec: Number(drainWaitSec || 0),
      agitation: agitation || 'none'
    };
    elapsed += stage.durationSec;
    return stage;
  });
}

function packPlan(plan = {}) {
  const profileId = plan.profile?.id || String(plan.profileVersion || '').split('@')[0];
  return {
    i: plan.id || '',
    d: compactDate(plan.createdAt),
    e: plan.engineVersion || '',
    p: PROFILE_CODES[profileId] ?? profileId,
    t: [Number(plan.totals?.doseG || 0), Number(plan.totals?.waterG || 0), Number(plan.totals?.ratio || 0), Number(plan.totals?.targetTimeSec || 0)],
    s: (plan.stages || []).map(packStage),
    w: plan.water ? [plan.water.profile?.id || '', plan.water.profile?.tdsMid || 0, plan.water.profile?.ca || 0, plan.water.profile?.mg || 0, plan.water.profile?.hco3 || 0] : null,
    g: plan.grinder ? [plan.grinder.model || '', plan.grinder.recommended ?? '', plan.grinder.unit || ''] : null,
    f: plan.flavorFit ? Object.values({ floral: plan.flavorFit.floral, acidity: plan.flavorFit.acidity, sweetness: plan.flavorFit.sweetness, body: plan.flavorFit.body, bitterness: plan.flavorFit.bitterness, clarity: plan.flavorFit.clarity }).map(value => Math.round(Number(value || 0) * 100)) : null,
    c: plan.correction ? [plan.correction.sourcePlanId || '', plan.correction.changes || []] : null
  };
}
function unpackPlan(row = {}) {
  const stages = unpackStages(row.s || []);
  const [doseG, waterG, ratio, targetTimeSec] = row.t || [];
  const fit = row.f || [];
  return {
    id: row.i || '',
    createdAt: expandDate(row.d),
    engineVersion: row.e || '',
    profileVersion: `${PROFILE_IDS[row.p] || row.p || 'shared'}@shared`,
    profile: { id: PROFILE_IDS[row.p] || row.p || 'shared', label: '分享方案' },
    source: 'shared-compact',
    schemaVersion: 2,
    stages,
    totals: { doseG: Number(doseG || 0), waterG: Number(waterG || stages.at(-1)?.cumulativeWaterG || 0), ratio: Number(ratio || 0), targetTimeSec: Number(targetTimeSec || stages.reduce((sum, stage) => sum + stage.durationSec, 0)) },
    water: row.w ? { profile: { id: row.w[0], name: row.w[0], tdsMid: row.w[1], ca: row.w[2], mg: row.w[3], hco3: row.w[4] } } : null,
    grinder: row.g ? { model: row.g[0], recommended: row.g[1], unit: row.g[2] } : null,
    flavorFit: fit.length ? { floral: fit[0] / 100, acidity: fit[1] / 100, sweetness: fit[2] / 100, body: fit[3] / 100, bitterness: fit[4] / 100, clarity: fit[5] / 100 } : null,
    correction: row.c ? { sourcePlanId: row.c[0], changes: row.c[1] || [] } : null
  };
}

function packSensory(record = {}) {
  const answers = Object.entries(record.answers || {}).map(([node, groups]) => [node, Object.entries(groups || {}).map(([index, values]) => [Number(index), (values || []).map(sensoryCode)])]);
  return {
    i: record.id || '',
    d: compactDate(record.createdAt),
    b: record.brewSessionId || '',
    a: Math.round(Number(record.autoScore || 0) * 10),
    u: Math.round(Number(record.subjectiveScore ?? record.score ?? 0) * 10),
    x: Math.round(Number(record.scoreDelta || 0) * 10),
    q: answers,
    n: String(record.naturalNote || '').slice(0, 300),
    m: (record.summary || []).slice(0, 16)
  };
}
function unpackSensory(row = {}) {
  const answers = {};
  for (const [node, groups] of row.q || []) {
    answers[node] = {};
    for (const [index, values] of groups || []) answers[node][index] = (values || []).map(sensoryValue);
  }
  const subjectiveScore = Number(row.u || 0) / 10;
  return {
    id: row.i || '',
    createdAt: expandDate(row.d),
    brewSessionId: row.b || '',
    autoScore: Number(row.a || 0) / 10,
    subjectiveScore,
    score: subjectiveScore,
    scoreDelta: Number(row.x || 0) / 10,
    answers,
    naturalNote: row.n || '',
    summary: row.m || []
  };
}

export function buildCompactSharePayload({ appVersion, user, bean, brewSessions = [], sensoryRecords = [], names = {} }) {
  const latestBrews = [...brewSessions].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 5);
  const latestSensory = [...sensoryRecords].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 5);
  return {
    v: SHARE_FORMAT_VERSION,
    a: String(appVersion || ''),
    d: compactDate(new Date().toISOString()),
    u: [String(user?.publicId || ''), String(user?.nickname || '匿名').slice(0, 24)],
    b: [bean.countryCode || '', bean.regionCode || '', bean.entityCode || '', bean.varietyCode || '', bean.processCode || '', bean.roastCode || '', compactDate(bean.roastDate), (bean.flavorCodes || []).slice(0, 12), Number(bean.roastColor || 0), names.displayName || ''],
    r: latestBrews.map(packPlan),
    s: latestSensory.map(packSensory)
  };
}

export function expandCompactSharePayload(payload) {
  if (!payload || Number(payload.v) !== SHARE_FORMAT_VERSION || !Array.isArray(payload.b)) throw new Error('分享格式版本不兼容');
  const bean = {
    countryCode: payload.b[0] || '',
    regionCode: payload.b[1] || '',
    entityCode: payload.b[2] || '',
    varietyCode: payload.b[3] || '',
    processCode: payload.b[4] || '',
    roastCode: payload.b[5] || '',
    roastDate: expandDate(payload.b[6]),
    flavorCodes: payload.b[7] || [],
    roastColor: Number(payload.b[8] || 0) || '',
    name: payload.b[9] || ''
  };
  const plans = (payload.r || []).map(unpackPlan);
  const sensory = (payload.s || []).map(unpackSensory);
  return {
    schemaVersion: 2,
    appVersion: payload.a || '',
    sharedAt: expandDate(payload.d),
    user: { publicId: payload.u?.[0] || '', nickname: payload.u?.[1] || '匿名' },
    bean,
    brewSessions: plans,
    sensoryRecords: sensory,
    plan: plans[0] || null,
    sensory: sensory[0] || null,
    compact: true
  };
}

export async function encodeSharePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  for (const [suffix, format] of [['R', 'deflate-raw'], ['D', 'deflate'], ['G', 'gzip']]) {
    try {
      const compressed = await streamTransform(bytes, 'compress', format);
      if (compressed.length < bytes.length) return `${SHARE_PREFIX}${suffix}.${base64UrlEncode(compressed)}`;
    } catch { /* try next format */ }
  }
  return `${SHARE_PREFIX}J.${base64UrlEncode(bytes)}`;
}

export async function decodeSharePayload(encoded) {
  const match = String(encoded || '').match(/^LB8([RDGJ])\.(.+)$/);
  if (!match) throw new Error('不是 Lucky Bean v0.8 分享编码');
  const bytes = base64UrlDecode(match[2]);
  const format = { R: 'deflate-raw', D: 'deflate', G: 'gzip' }[match[1]];
  const decoded = match[1] === 'J' ? bytes : await streamTransform(bytes, 'decompress', format);
  const compact = JSON.parse(new TextDecoder().decode(decoded));
  return expandCompactSharePayload(compact);
}
