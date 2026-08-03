import { all, bulkPut, getSetting, setSetting } from './db.js';

export const SYNC_FORMAT = 'luckybean-sync-v2';
export const CHUNK_FORMAT = 'luckybean-chunk-v2';
export const SYNC_SCHEMA_VERSION = 2;
export const KDF_ITERATIONS = 180000;
export const BASE_TIME_MS = Date.UTC(2020, 0, 1);

const enc = new TextEncoder();
const dec = new TextDecoder();

// Shared semantic dictionary. BrewIon country/region/entity/variety/process/flavor codes remain
// unchanged; this table covers UI labels and values that are not part of the external codebook.
export const SEMANTIC_DICTIONARY = Object.freeze([
  '', '无', '低', '中', '强', '高', '适中', '微酸', '圆润舒适', '尖锐', '偏高', '焦苦',
  '白花', '茉莉', '玫瑰', '橙花', '紫罗兰', '洋甘菊', '花香', '果香', '柑橘', '莓果',
  '桃子', '苹果', '葡萄', '热带水果', '干果', '茶感', '红茶', '乌龙茶', '香料', '坚果',
  '可可', '巧克力', '蜂蜜', '蔗糖', '红糖', '焦糖', '枫糖', '糖浆', '太妃糖', '成熟水果',
  '甜感清晰', '甜感弱', '无明显甜感', '明亮', '活泼', '圆润', '柔和', '柑橘酸', '苹果酸',
  '酒石酸', '醋酸感', '发酵酸', '轻盈', '丝滑', '顺滑', '奶油感', '饱满', '厚重', '多汁',
  '茶汤感', '粗糙', '干涩', '收敛', '干净', '持久', '短促', '甜感延续', '果香延续',
  '茶感延续', '苦感', '涩感', '干燥', '杂味', '纸味', '木质', '土味', '霉味', '发酵过度',
  '药感', '橡胶', '金属感', '霉腐', '坏发酵', '轻微涩', '酒香', '发酵感', '草本', '谷物',
  '烘烤', '烟熏', '计划', '已完成', '已终止', '已评价', '修正方案', 'planned', 'completed',
  'terminated', 'evaluated', 'corrected', 'manual', 'photo', 'text', 'qr', 'consume', 'correct', 'none',
  'gentle-swirl', '中心注水', '绕圈注水', '中心向外绕圈', '外圈向中心绕圈', '浸泡/搅拌', '截流/排空',
  '闷蒸', '尾段收束', '主萃', '模型推荐', '一刀流', '两段式', '三段式', '四六法', '46法·平底净化',
  '五段式', '30g/15秒脉冲', 'recommended', 'one-pour', 'two-pulse', 'three-pulse', 'four-six-v17',
  'flat46-clean', 'five-pulse', 'pulse-30x15', 'professional', 'player', 'note', 'local-compatible-engine',
  '香气倾向', '整体质量', '第一雷达贡献', '第二雷达贡献', '明缺陷', '暗缺陷', '瑕疵扣分',
  '应用映射建议分', '花香 / 干湿香', '风味 / 余韵', '酸质', '甜感', '口感', '醇厚', '干净度',
  '一致性', '平衡度', '正面', '负面'
]);
const DICT_TO_CODE = new Map(SEMANTIC_DICTIONARY.map((value, index) => [value, index]));

const round10 = value => Math.round((Number(value) || 0) * 10);
const unround10 = value => Number(value || 0) / 10;
const round100 = value => Math.round((Number(value) || 0) * 100);
const unround100 = value => Number(value || 0) / 100;
const compactTime = value => {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? Math.round((ms - BASE_TIME_MS) / 60000) : 0;
};
const expandTime = value => value ? new Date(BASE_TIME_MS + Number(value) * 60000).toISOString() : '';
const compactDate = value => String(value || '').replaceAll('-', '').slice(0, 8);
const expandDate = value => /^\d{8}$/.test(String(value || '')) ? `${String(value).slice(0, 4)}-${String(value).slice(4, 6)}-${String(value).slice(6, 8)}` : String(value || '');
const monthKey = value => {
  const date = String(value || '').slice(0, 7).replace('-', '');
  return /^\d{6}$/.test(date) ? date : 'undated';
};
const token = value => {
  const text = String(value ?? '');
  return DICT_TO_CODE.has(text) ? DICT_TO_CODE.get(text) : text;
};
const untoken = value => typeof value === 'number' && SEMANTIC_DICTIONARY[value] !== undefined ? SEMANTIC_DICTIONARY[value] : String(value ?? '');
const tokenArray = values => (Array.isArray(values) ? values : []).map(token);
const untokenArray = values => (Array.isArray(values) ? values : []).map(untoken);

function packBean(bean = {}) {
  return [
    bean.id || '', bean.name || '', bean.countryCode || '', bean.regionCode || '', bean.entityCode || '',
    bean.varietyCode || '', bean.processCode || '', Number(bean.roastColor || 0), bean.roastCode || '',
    compactDate(bean.roastDate), round10(bean.initialWeight), round10(bean.remainingWeight), bean.refrigerated ? 1 : 0,
    compactDate(bean.freezeDate), round100(bean.price), bean.roasterName || bean.roaster || '', Number(bean.altitude || 0),
    bean.notes || '', Array.isArray(bean.flavorCodes) ? bean.flavorCodes : [], bean.archived ? 1 : 0, token(bean.source || 'manual'),
    Number(bean.codebookSchemaVersion || 1), String(bean.codebookDataVersion || ''), compactTime(bean.createdAt), compactTime(bean.updatedAt)
  ];
}

function unpackBean(row = []) {
  return {
    id: row[0] || '', name: row[1] || '', countryCode: row[2] || '', regionCode: row[3] || '', entityCode: row[4] || '',
    varietyCode: row[5] || '', processCode: row[6] || '', roastColor: Number(row[7] || 0) || '', roastCode: row[8] || '',
    roastDate: expandDate(row[9]), initialWeight: unround10(row[10]), remainingWeight: unround10(row[11]), refrigerated: Boolean(row[12]),
    freezeDate: expandDate(row[13]), price: unround100(row[14]), roasterName: row[15] || '', altitude: Number(row[16] || 0),
    notes: row[17] || '', flavorCodes: Array.isArray(row[18]) ? row[18] : [], archived: Boolean(row[19]), source: untoken(row[20]) || 'manual',
    codebookSchemaVersion: Number(row[21] || 1), codebookDataVersion: String(row[22] || ''), createdAt: expandTime(row[23]), updatedAt: expandTime(row[24])
  };
}

function packInput(input = {}) {
  const bean = input.bean || {};
  const brew = input.brew || {};
  const water = input.water || {};
  const targets = input.targets || {};
  return [
    Number(input.schemaVersion || 2),
    [bean.countryCode || '', bean.regionCode || '', bean.entityCode || '', bean.varietyCode || '', bean.processCode || '', bean.roastCode || '', Number(bean.roastColor || 0), compactDate(bean.roastDate), Number(bean.altitude || 0)],
    [token(brew.mode || 'professional'), token(brew.method || 'pourover'), round10(brew.doseG), round10(brew.ratio), token(brew.profileId || 'recommended'), token(brew.segmentMode || 'auto'), Number(brew.segments || 0), brew.dripperCode || '', brew.filterPaper || '', brew.filterPaperId || '', brew.grinder || '', token(brew.firstCoolingMode || 'auto'), round10(brew.firstTemperatureC), token(brew.tailCoolingMode || 'auto'), round10(brew.tailTemperatureC), brew.lowTempFirst === false ? 0 : 1, round10(brew.temperatureTune), round10(brew.grindTune), Number(brew.bloomTune || 0), brew.repeatability ? 1 : 0, brew.waterProfileId || ''],
    [water.profileId || '', round10(water.recipeVolumeL), round10(water.tdsMgL), water.customProfile ? [round10(water.customProfile.tds), round10(water.customProfile.ca), round10(water.customProfile.mg), round10(water.customProfile.hco3)] : null],
    [round10(targets.floral), round10(targets.acidity), round10(targets.sweetness), round10(targets.body), round10(targets.bitterness)]
  ];
}

function unpackInput(row = []) {
  const bean = row[1] || [];
  const brew = row[2] || [];
  const water = row[3] || [];
  const target = row[4] || [];
  return {
    schemaVersion: Number(row[0] || 2),
    bean: { countryCode: bean[0] || '', regionCode: bean[1] || '', entityCode: bean[2] || '', varietyCode: bean[3] || '', processCode: bean[4] || '', roastCode: bean[5] || '', roastColor: Number(bean[6] || 0) || null, roastDate: expandDate(bean[7]), altitude: Number(bean[8] || 0) || null },
    brew: { mode: untoken(brew[0]) || 'professional', method: untoken(brew[1]) || 'pourover', doseG: unround10(brew[2]), ratio: unround10(brew[3]), profileId: untoken(brew[4]) || 'recommended', segmentMode: untoken(brew[5]) || 'auto', segments: Number(brew[6] || 0), dripperCode: brew[7] || '', filterPaper: brew[8] || '', filterPaperId: brew[9] || '', grinder: brew[10] || '', firstCoolingMode: untoken(brew[11]) || 'auto', firstTemperatureC: unround10(brew[12]), tailCoolingMode: untoken(brew[13]) || 'auto', tailTemperatureC: unround10(brew[14]), lowTempFirst: brew[15] !== 0, temperatureTune: unround10(brew[16]), grindTune: unround10(brew[17]), bloomTune: Number(brew[18] || 0), repeatability: Boolean(brew[19]), waterProfileId: brew[20] || '' },
    water: { profileId: water[0] || '', recipeVolumeL: unround10(water[1]), tdsMgL: unround10(water[2]), customProfile: water[3] ? { tds: unround10(water[3][0]), ca: unround10(water[3][1]), mg: unround10(water[3][2]), hco3: unround10(water[3][3]) } : undefined },
    targets: { floral: unround10(target[0]), acidity: unround10(target[1]), sweetness: unround10(target[2]), body: unround10(target[3]), bitterness: unround10(target[4]) }
  };
}

function packStage(stage = {}) {
  return [
    Number(stage.index || 0), token(stage.name || ''), compactTime(stage.startedAt), Number(stage.startSec || 0), Number(stage.durationSec || 0),
    round10(stage.stageWaterG), round10(stage.cumulativeWaterG), round10(stage.temperatureC), round10(stage.flowGPerSec),
    stage.methodCode || '', token(stage.method || ''), Number(stage.drainWaitSec || 0), stage.drainTargetMm == null ? null : round10(stage.drainTargetMm),
    token(stage.agitation || 'none'), token(stage.notice || '')
  ];
}

function unpackStage(row = [], index = 0) {
  return {
    index: Number(row[0] || index + 1), name: untoken(row[1]) || (index === 0 ? '闷蒸' : `主萃 ${index}`), startedAt: expandTime(row[2]), startSec: Number(row[3] || 0), durationSec: Number(row[4] || 0),
    stageWaterG: unround10(row[5]), cumulativeWaterG: unround10(row[6]), temperatureC: unround10(row[7]), flowGPerSec: unround10(row[8]),
    methodCode: row[9] || '', method: untoken(row[10]), drainWaitSec: Number(row[11] || 0), drainTargetMm: row[12] == null ? null : unround10(row[12]),
    agitation: untoken(row[13]) || 'none', notice: untoken(row[14])
  };
}

function packBrew(record = {}) {
  const profileId = record.profile?.id || String(record.profileVersion || '').split('@')[0] || '';
  const profileLabel = record.profile?.label || '';
  const water = record.water || {};
  const waterProfile = water.profile || {};
  const grinder = record.grinder || {};
  const correction = record.correction || null;
  return [
    record.id || '', record.beanId || '', compactTime(record.createdAt), compactTime(record.completedAt), token(record.status || 'planned'),
    Number(record.schemaVersion || 2), record.engineVersion || '', record.profileVersion || '', token(record.source || ''), record.inputHash || '',
    [token(profileId), token(profileLabel)], (record.stages || []).map(packStage),
    [round10(record.totals?.doseG), round10(record.totals?.waterG), round10(record.totals?.ratio), Number(record.totals?.targetTimeSec || 0)],
    [round10(record.temperature?.mainC), round10(record.temperature?.firstC), round10(record.temperature?.tailC)],
    grinder ? [token(grinder.model || ''), token(grinder.label || ''), round10(grinder.recommended), token(grinder.unit || ''), round10(grinder.offset), grinder.note || ''] : null,
    water ? [waterProfile.id || '', token(waterProfile.name || ''), round10(waterProfile.tdsMid ?? waterProfile.tds?.[0]), round10(waterProfile.ca), round10(waterProfile.mg), round10(waterProfile.hco3), round10(water.volumeL)] : null,
    tokenArray(record.warnings), token(record.firstPourReason || ''), tokenArray(record.explanation), record.input ? packInput(record.input) : null,
    record.flavorFit ? [round100(record.flavorFit.floral), round100(record.flavorFit.acidity), round100(record.flavorFit.sweetness), round100(record.flavorFit.body), round100(record.flavorFit.bitterness), round100(record.flavorFit.clarity)] : null,
    correction ? [correction.sourcePlanId || '', correction.sourceSensoryId || '', tokenArray(correction.changes), correction.issues || {}, round10(correction.subjectiveScore), round10(correction.autoScore), compactTime(correction.createdAt)] : null,
    record.sensoryRecordId || '', record.sensoryNote || '', round10(record.autoScore), round10(record.subjectiveScore), round10(record.scoreDelta), record.correctedPlanId || ''
  ];
}

function unpackBrew(row = []) {
  const profile = row[10] || [];
  const stages = (row[11] || []).map(unpackStage);
  const totals = row[12] || [];
  const temperature = row[13] || [];
  const grinder = row[14];
  const water = row[15];
  const fit = row[20];
  const correction = row[21];
  const trajectory = stages.map((stage, index) => ({ x: stages.length <= 1 ? 1 : index / (stages.length - 1), y: stages.length <= 1 ? 1 : (index + 1) / stages.length }));
  return {
    id: row[0] || '', beanId: row[1] || '', createdAt: expandTime(row[2]), completedAt: expandTime(row[3]), status: untoken(row[4]) || 'planned',
    schemaVersion: Number(row[5] || 2), engineVersion: row[6] || '', profileVersion: row[7] || '', source: untoken(row[8]), inputHash: row[9] || '',
    profile: { id: untoken(profile[0]), label: untoken(profile[1]) || '冲煮方案' }, stages,
    totals: { doseG: unround10(totals[0]), waterG: unround10(totals[1]), ratio: unround10(totals[2]), targetTimeSec: Number(totals[3] || 0) },
    temperature: { mainC: unround10(temperature[0]), firstC: unround10(temperature[1]), tailC: unround10(temperature[2]) },
    grinder: grinder ? { model: untoken(grinder[0]), label: untoken(grinder[1]), recommended: unround10(grinder[2]), unit: untoken(grinder[3]), offset: unround10(grinder[4]), note: grinder[5] || '' } : null,
    water: water ? { profile: { id: water[0] || '', name: untoken(water[1]), tdsMid: unround10(water[2]), ca: unround10(water[3]), mg: unround10(water[4]), hco3: unround10(water[5]) }, volumeL: unround10(water[6]) } : null,
    warnings: untokenArray(row[16]), firstPourReason: untoken(row[17]), explanation: untokenArray(row[18]), input: row[19] ? unpackInput(row[19]) : null,
    flavorFit: fit ? { floral: unround100(fit[0]), acidity: unround100(fit[1]), sweetness: unround100(fit[2]), body: unround100(fit[3]), bitterness: unround100(fit[4]), clarity: unround100(fit[5]) } : null,
    correction: correction ? { sourcePlanId: correction[0] || '', sourceSensoryId: correction[1] || '', changes: untokenArray(correction[2]), issues: correction[3] || {}, subjectiveScore: unround10(correction[4]), autoScore: unround10(correction[5]), createdAt: expandTime(correction[6]) } : null,
    sensoryRecordId: row[22] || '', sensoryNote: row[23] || '', autoScore: unround10(row[24]), subjectiveScore: unround10(row[25]), scoreDelta: unround10(row[26]), correctedPlanId: row[27] || '', trajectory
  };
}

function packAnswers(answers = {}) {
  return Object.entries(answers).map(([node, groups]) => [token(node), Object.entries(groups || {}).map(([index, values]) => [Number(index), tokenArray(values)])]);
}
function unpackAnswers(rows = []) {
  const answers = {};
  for (const [node, groups] of rows || []) {
    const key = untoken(node);
    answers[key] = {};
    for (const [index, values] of groups || []) answers[key][index] = untokenArray(values);
  }
  return answers;
}

function packSensory(record = {}) {
  return [
    record.id || '', record.beanId || '', record.brewSessionId || '', compactTime(record.createdAt), compactTime(record.updatedAt),
    record.engineVersion || '', record.profileVersion || '', token(record.evaluationMode || ''), record.direct ? 1 : 0,
    packAnswers(record.answers || {}), round10(record.autoScore), round10(record.subjectiveScore ?? record.score), round10(record.scoreDelta),
    record.naturalNote || '', tokenArray(record.summary), record.correctedPlanId || '',
    record.rawScore90 == null ? null : round10(record.rawScore90), record.qualityRaw90 == null ? null : round10(record.qualityRaw90)
  ];
}

function unpackSensory(row = []) {
  const subjectiveScore = unround10(row[11]);
  return {
    id: row[0] || '', beanId: row[1] || '', brewSessionId: row[2] || '', createdAt: expandTime(row[3]), updatedAt: expandTime(row[4]),
    engineVersion: row[5] || '', profileVersion: row[6] || '', evaluationMode: untoken(row[7]), direct: Boolean(row[8]), answers: unpackAnswers(row[9]),
    autoScore: unround10(row[10]), subjectiveScore, score: subjectiveScore, scoreDelta: unround10(row[12]), naturalNote: row[13] || '',
    summary: untokenArray(row[14]), correctedPlanId: row[15] || '', rawScore90: row[16] == null ? undefined : unround10(row[16]), qualityRaw90: row[17] == null ? undefined : unround10(row[17])
  };
}

function packInventory(record = {}) {
  return [record.id || '', record.beanId || '', token(record.type || ''), round10(record.amountG), round10(record.resultingWeightG), record.sessionId || '', record.note || '', compactTime(record.createdAt)];
}
function unpackInventory(row = []) {
  return { id: row[0] || '', beanId: row[1] || '', type: untoken(row[2]), amountG: unround10(row[3]), resultingWeightG: unround10(row[4]), sessionId: row[5] || '', note: row[6] || '', createdAt: expandTime(row[7]) };
}

function splitRows(rows, size = 24) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result.length ? result : [[]];
}

export async function buildLogicalPackets() {
  const [beans, brews, sensory, inventory, customCodes, appSettings] = await Promise.all([
    all('beans'), all('brewSessions'), all('sensoryRecords'), all('inventoryEvents'), all('customCodes'), getSetting('app.settings', null)
  ]);
  const codebookVersion = String(beans.find(bean => bean.codebookDataVersion)?.codebookDataVersion || '6');
  const packets = [];
  const byBean = new Map(beans.map(bean => [bean.id, { bean, months: new Map() }]));
  const orphan = { brews: [], sensory: [], inventory: [] };
  const bucket = (beanId, date, kind, value) => {
    const target = byBean.get(beanId);
    if (!target) { orphan[kind].push(value); return; }
    const month = monthKey(date);
    if (!target.months.has(month)) target.months.set(month, { brews: [], sensory: [], inventory: [] });
    target.months.get(month)[kind].push(value);
  };
  brews.forEach(record => bucket(record.beanId, record.createdAt, 'brews', record));
  sensory.forEach(record => bucket(record.beanId, record.createdAt, 'sensory', record));
  inventory.forEach(record => bucket(record.beanId, record.createdAt, 'inventory', record));

  for (const { bean, months } of byBean.values()) {
    packets.push({ logicalKey: `bean:${bean.id}:meta`, packet: { v: SYNC_SCHEMA_VERSION, f: SYNC_FORMAT, cb: codebookVersion, k: 'bean-meta', b: packBean(bean) } });
    for (const [month, group] of [...months.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const merged = [
        ...group.brews.map(value => ['r', value.createdAt, packBrew(value)]),
        ...group.sensory.map(value => ['s', value.createdAt, packSensory(value)]),
        ...group.inventory.map(value => ['i', value.createdAt, packInventory(value)])
      ].sort((a, b) => String(a[1] || '').localeCompare(String(b[1] || '')));
      splitRows(merged, 24).forEach((part, index) => {
        packets.push({ logicalKey: `bean:${bean.id}:${month}:${index}`, packet: { v: SYNC_SCHEMA_VERSION, f: SYNC_FORMAT, cb: codebookVersion, k: 'bean-records', b: bean.id, m: month, p: index, x: part.map(([kind, , value]) => [kind, value]) } });
      });
    }
  }

  if (orphan.brews.length || orphan.sensory.length || orphan.inventory.length) {
    const merged = [
      ...orphan.brews.map(value => ['r', packBrew(value)]),
      ...orphan.sensory.map(value => ['s', packSensory(value)]),
      ...orphan.inventory.map(value => ['i', packInventory(value)])
    ];
    splitRows(merged, 24).forEach((part, index) => packets.push({ logicalKey: `global:orphan:${index}`, packet: { v: SYNC_SCHEMA_VERSION, f: SYNC_FORMAT, cb: codebookVersion, k: 'orphan', p: index, x: part } }));
  }

  const safeSettings = appSettings ? structuredClone(appSettings) : null;
  if (safeSettings?.identity) safeSettings.identity = { mode: safeSettings.identity.mode || 'guest', nickname: safeSettings.identity.nickname || '本地用户' };
  if (safeSettings?.brew) delete safeSettings.brew.apiEndpoint;
  packets.push({ logicalKey: 'global:settings', packet: { v: SYNC_SCHEMA_VERSION, f: SYNC_FORMAT, cb: codebookVersion, k: 'settings', s: safeSettings, c: customCodes } });
  packets.sort((a, b) => a.logicalKey.localeCompare(b.logicalKey));
  return { packets, codebookVersion, counts: { beans: beans.length, brews: brews.length, sensory: sensory.length, inventory: inventory.length, customCodes: customCodes.length } };
}

export function encodePacket(packet) {
  return enc.encode(JSON.stringify(packet));
}
export function decodePacket(bytes) {
  const packet = JSON.parse(dec.decode(bytes));
  if (packet?.f !== SYNC_FORMAT || Number(packet?.v) !== SYNC_SCHEMA_VERSION) throw new Error('云端分包格式不兼容');
  return packet;
}

export async function compressBytes(bytes) {
  if (!globalThis.CompressionStream) return { bytes, algorithm: 'none' };
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), algorithm: 'gzip' };
}
export async function decompressBytes(bytes, algorithm = 'gzip') {
  if (algorithm !== 'gzip') return bytes;
  if (!globalThis.DecompressionStream) throw new Error('当前浏览器不支持GZIP解压');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function restorePackets(packets = []) {
  const data = { beans: [], brewSessions: [], sensoryRecords: [], inventoryEvents: [], customCodes: [], settings: null };
  for (const packet of packets) {
    if (packet.k === 'bean-meta' && packet.b) data.beans.push(unpackBean(packet.b));
    if (packet.k === 'bean-records' || packet.k === 'orphan') {
      for (const [kind, row] of packet.x || []) {
        if (kind === 'r') data.brewSessions.push(unpackBrew(row));
        if (kind === 's') data.sensoryRecords.push(unpackSensory(row));
        if (kind === 'i') data.inventoryEvents.push(unpackInventory(row));
      }
    }
    if (packet.k === 'settings') {
      data.settings = packet.s || null;
      data.customCodes.push(...(Array.isArray(packet.c) ? packet.c : []));
    }
  }
  if (data.beans.length) await bulkPut('beans', data.beans);
  if (data.brewSessions.length) await bulkPut('brewSessions', data.brewSessions);
  if (data.sensoryRecords.length) await bulkPut('sensoryRecords', data.sensoryRecords);
  if (data.inventoryEvents.length) await bulkPut('inventoryEvents', data.inventoryEvents);
  if (data.customCodes.length) await bulkPut('customCodes', data.customCodes);
  if (data.settings) {
    const local = await getSetting('app.settings', {});
    const merged = {
      ...local, ...data.settings,
      identity: local?.identity || data.settings.identity,
      ui: { ...(local?.ui || {}), ...(data.settings.ui || {}) },
      brew: { ...(local?.brew || {}), ...(data.settings.brew || {}) },
      gear: { ...(local?.gear || {}), ...(data.settings.gear || {}) }
    };
    await setSetting('app.settings', merged);
  }
  return { beans: data.beans.length, brews: data.brewSessions.length, sensory: data.sensoryRecords.length, inventory: data.inventoryEvents.length, customCodes: data.customCodes.length };
}
