import { openDb } from '../../db.js';
import { sha256Hex } from '../../utils.js';

export const BREW_HISTORY_SCHEMA = 'brew-history/1.0';
const ANALYSIS_CONTRACT = 'brew-analysis/2.0';
const SPATIAL_CONTRACT = 'brew-spatial/1.1';

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB请求失败'));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('历史记录事务失败'));
    tx.onabort = () => reject(tx.error || new Error('历史记录事务已回滚'));
  });
}

function clone(value) { return structuredClone(value); }
function nowIso() { return new Date().toISOString(); }
function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field}必须大于0`);
  return number;
}

function validateAnalysisSnapshot(snapshot) {
  if (!snapshot || snapshot.contract !== ANALYSIS_CONTRACT) throw new Error(`历史记录必须保存${ANALYSIS_CONTRACT}完整分析快照`);
  if (!snapshot.analysisFingerprint) throw new Error('历史记录缺少分析指纹');
  if (!snapshot.plan || typeof snapshot.plan !== 'object') throw new Error('历史记录缺少方案快照');
  if (snapshot.trajectory?.schemaVersion !== SPATIAL_CONTRACT) throw new Error(`历史记录缺少${SPATIAL_CONTRACT}三维快照`);
  if (!Array.isArray(snapshot.trajectory.path) || snapshot.trajectory.path.length < 2) throw new Error('历史记录三维轨迹点不足');
  return snapshot;
}

function validateExecution(execution) {
  const startedAt = String(execution?.startedAt || '');
  const finishedAt = String(execution?.finishedAt || '');
  if (!startedAt || !finishedAt) throw new Error('实际执行必须包含开始和结束时间');
  const actualTotalTimeSec = Number(execution?.actualTotalTimeSec);
  if (!Number.isFinite(actualTotalTimeSec) || actualTotalTimeSec < 0) throw new Error('实际总时间无效');
  return {
    startedAt,
    finishedAt,
    actualTotalTimeSec,
    stageExecutions: Array.isArray(execution.stageExecutions) ? clone(execution.stageExecutions) : [],
    deviations: Array.isArray(execution.deviations) ? clone(execution.deviations) : [],
    notes: Array.isArray(execution.notes) ? execution.notes.map(String) : [],
    environment: {
      ambientTemperatureC: Number(execution.environment?.ambientTemperatureC ?? 25),
      relativeHumidityPct: execution.environment?.relativeHumidityPct == null ? null : Number(execution.environment.relativeHumidityPct),
      initialBedTemperatureC: Number(execution.environment?.initialBedTemperatureC ?? execution.environment?.ambientTemperatureC ?? 25)
    }
  };
}

function validateInventoryEvidence(record, inventoryEvent) {
  if (!record.inventoryEventId) throw new Error(`冲煮记录${record.id}缺少库存事件引用，必须先修复数据`);
  if (!inventoryEvent) throw new Error(`冲煮记录${record.id}对应的原始扣豆事件不存在，必须先修复数据`);
  const deducted = positiveNumber(record.deductedWeightG, '历史扣豆量');
  const consumed = Math.abs(Number(inventoryEvent.amountG));
  const valid = inventoryEvent.id === record.inventoryEventId
    && inventoryEvent.sessionId === record.id
    && inventoryEvent.beanId === record.beanId
    && inventoryEvent.type === 'brew-consume'
    && Number.isFinite(consumed)
    && Math.abs(consumed - deducted) <= 0.001;
  if (!valid) throw new Error(`冲煮记录${record.id}与原始库存事件不一致，禁止删除或猜测豆量`);
  return consumed;
}

async function deterministicId(prefix, idempotencyKey) {
  if (!idempotencyKey) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${(await sha256Hex(String(idempotencyKey))).slice(0, 32)}`;
}

function emitChanged(detail) {
  document.dispatchEvent(new CustomEvent('luckybean:data-changed', { detail: { ...detail, at: nowIso() } }));
  document.dispatchEvent(new CustomEvent('luckybean:history-changed', { detail }));
}

/**
 * The caller may invoke this only after the brew timer finished and the user explicitly
 * confirmed both actual dose and bean deduction. There is intentionally no status field:
 * existence of the record is the completion proof.
 */
export async function commitCompletedBrew({
  beanId,
  deductedWeightG,
  rawInput,
  normalizedInput,
  analysisSnapshot,
  execution,
  providerVersions,
  idempotencyKey
}) {
  if (!beanId) throw new Error('未指定豆卡');
  const amount = positiveNumber(deductedWeightG, '实际使用豆量');
  const analysis = validateAnalysisSnapshot(analysisSnapshot);
  const actualExecution = validateExecution(execution);
  const recordId = await deterministicId('brew', idempotencyKey || `${beanId}:${actualExecution.finishedAt}:${analysis.analysisFingerprint}`);
  const inventoryEventId = `${recordId}:consume`;
  const revisionId = `${recordId}:revision:1`;
  const outboxId = `${recordId}:outbox:create`;
  const createdAt = nowIso();
  const db = await openDb();
  const tx = db.transaction(['beans', 'inventoryEvents', 'brewSessions', 'historyRevisions', 'syncOutbox'], 'readwrite');
  const beans = tx.objectStore('beans');
  const inventory = tx.objectStore('inventoryEvents');
  const sessions = tx.objectStore('brewSessions');
  const revisions = tx.objectStore('historyRevisions');
  const outbox = tx.objectStore('syncOutbox');

  const existing = await requestValue(sessions.get(recordId));
  if (existing) {
    tx.abort();
    return { record: existing, duplicate: true };
  }
  const bean = await requestValue(beans.get(beanId));
  if (!bean) { tx.abort(); throw new Error('豆卡不存在，无法保存冲煮记录'); }
  const remainingBefore = Number(bean.remainingWeight || 0);
  if (!Number.isFinite(remainingBefore) || remainingBefore < amount) {
    tx.abort();
    throw new Error(`豆卡余量不足：当前${Math.max(0, remainingBefore).toFixed(1)}g，实际使用${amount.toFixed(1)}g`);
  }
  const remainingAfter = Number((remainingBefore - amount).toFixed(3));
  const record = {
    id: recordId,
    schemaVersion: BREW_HISTORY_SCHEMA,
    beanId,
    createdAt,
    updatedAt: createdAt,
    deductedWeightG: amount,
    inventoryEventId,
    rawInput: clone(rawInput || {}),
    normalizedInput: clone(normalizedInput || rawInput || {}),
    analysisSnapshot: clone(analysis),
    execution: actualExecution,
    providerVersions: clone(providerVersions || analysis.integrations?.sourceVersions || {}),
    sensoryRecordIds: [],
    revision: 1,
    revisionHeadId: revisionId,
    archivedAt: null,
    recycledAt: null,
    syncState: 'pending'
  };
  const inventoryEvent = {
    id: inventoryEventId,
    beanId,
    sessionId: recordId,
    type: 'brew-consume',
    amountG: -amount,
    resultingWeightG: remainingAfter,
    note: `确认完成冲煮并扣除${amount.toFixed(1)}g`,
    createdAt
  };
  const revision = {
    id: revisionId,
    brewSessionId: recordId,
    revision: 1,
    kind: 'created',
    snapshot: clone(record),
    createdAt
  };
  const queueItem = {
    id: outboxId,
    entity: 'brewSessions',
    entityId: recordId,
    operation: 'upsert',
    payload: clone(record),
    createdAt,
    attempts: 0
  };

  beans.put({ ...bean, remainingWeight: remainingAfter, updatedAt: createdAt });
  inventory.put(inventoryEvent);
  sessions.put(record);
  revisions.put(revision);
  outbox.put(queueItem);
  await transactionDone(tx);
  emitChanged({ store: 'brewSessions', operation: 'completed-brew-commit', recordId, beanId });
  return { record, inventoryEvent, duplicate: false };
}

export async function listCompletedBrews({ beanId = '', includeArchived = false } = {}) {
  const db = await openDb();
  const tx = db.transaction('brewSessions', 'readonly');
  const rows = await requestValue(tx.objectStore('brewSessions').getAll());
  return rows
    .filter(row => row?.schemaVersion === BREW_HISTORY_SCHEMA)
    .filter(row => !beanId || row.beanId === beanId)
    .filter(row => includeArchived || !row.archivedAt)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function archiveBrewRecords(ids, archived = true) {
  const selected = new Set(ids || []);
  if (!selected.size) return { changed: 0 };
  const db = await openDb();
  const tx = db.transaction(['brewSessions', 'historyRevisions', 'syncOutbox'], 'readwrite');
  const sessions = tx.objectStore('brewSessions');
  const revisions = tx.objectStore('historyRevisions');
  const outbox = tx.objectStore('syncOutbox');
  let changed = 0;
  for (const id of selected) {
    const record = await requestValue(sessions.get(id));
    if (!record || record.schemaVersion !== BREW_HISTORY_SCHEMA) continue;
    const at = nowIso();
    const revisionNumber = Number(record.revision || 1) + 1;
    const next = { ...record, archivedAt: archived ? at : null, updatedAt: at, revision: revisionNumber, revisionHeadId: `${id}:revision:${revisionNumber}`, syncState: 'pending' };
    sessions.put(next);
    revisions.put({ id: next.revisionHeadId, brewSessionId: id, revision: revisionNumber, kind: archived ? 'archived' : 'unarchived', snapshot: clone(next), createdAt: at });
    outbox.put({ id: `${id}:outbox:${revisionNumber}`, entity: 'brewSessions', entityId: id, operation: 'upsert', payload: clone(next), createdAt: at, attempts: 0 });
    changed += 1;
  }
  await transactionDone(tx);
  emitChanged({ store: 'brewSessions', operation: archived ? 'archive' : 'unarchive', count: changed });
  return { changed };
}

export async function moveBrewRecordsToRecycleBin(ids) {
  const selected = new Set(ids || []);
  if (!selected.size) return { changed: 0 };
  const db = await openDb();
  const tx = db.transaction(['brewSessions', 'recycleBin', 'syncOutbox'], 'readwrite');
  const sessions = tx.objectStore('brewSessions');
  const recycle = tx.objectStore('recycleBin');
  const outbox = tx.objectStore('syncOutbox');
  let changed = 0;
  for (const id of selected) {
    const record = await requestValue(sessions.get(id));
    if (!record || record.schemaVersion !== BREW_HISTORY_SCHEMA) continue;
    const at = nowIso();
    recycle.put({ id, entity: 'brewSessions', payload: clone(record), recycledAt: at });
    sessions.delete(id);
    outbox.put({ id: `${id}:outbox:recycle:${at}`, entity: 'brewSessions', entityId: id, operation: 'recycle', payload: null, createdAt: at, attempts: 0 });
    changed += 1;
  }
  await transactionDone(tx);
  emitChanged({ store: 'brewSessions', operation: 'recycle', count: changed });
  return { changed };
}

export async function restoreBrewRecordsFromRecycleBin(ids) {
  const selected = new Set(ids || []);
  if (!selected.size) return { changed: 0 };
  const db = await openDb();
  const tx = db.transaction(['brewSessions', 'recycleBin', 'syncOutbox'], 'readwrite');
  const sessions = tx.objectStore('brewSessions');
  const recycle = tx.objectStore('recycleBin');
  const outbox = tx.objectStore('syncOutbox');
  let changed = 0;
  for (const id of selected) {
    const item = await requestValue(recycle.get(id));
    if (!item?.payload || item.entity !== 'brewSessions') continue;
    const at = nowIso();
    const record = { ...item.payload, recycledAt: null, updatedAt: at, syncState: 'pending' };
    sessions.put(record);
    recycle.delete(id);
    outbox.put({ id: `${id}:outbox:restore:${at}`, entity: 'brewSessions', entityId: id, operation: 'upsert', payload: clone(record), createdAt: at, attempts: 0 });
    changed += 1;
  }
  await transactionDone(tx);
  emitChanged({ store: 'brewSessions', operation: 'restore', count: changed });
  return { changed };
}

export async function permanentlyDeleteBrewRecords(ids, { restoreWeight = false, sensoryMode } = {}) {
  const selected = new Set(ids || []);
  if (!selected.size) return { deleted: 0, restoredWeightG: 0 };
  if (!['delete', 'detach'].includes(sensoryMode)) throw new Error('必须明确选择删除关联品鉴或保留并解除关联');
  const db = await openDb();
  const tx = db.transaction(['brewSessions', 'recycleBin', 'inventoryEvents', 'beans', 'sensoryRecords', 'historyRevisions', 'syncOutbox'], 'readwrite');
  const sessions = tx.objectStore('brewSessions');
  const recycle = tx.objectStore('recycleBin');
  const inventory = tx.objectStore('inventoryEvents');
  const beans = tx.objectStore('beans');
  const sensory = tx.objectStore('sensoryRecords');
  const revisions = tx.objectStore('historyRevisions');
  const outbox = tx.objectStore('syncOutbox');
  const allSensory = await requestValue(sensory.getAll());
  const allRevisions = await requestValue(revisions.getAll());
  const weightByBean = new Map();
  let deleted = 0;
  let restoredWeightG = 0;
  const at = nowIso();

  for (const id of selected) {
    const active = await requestValue(sessions.get(id));
    const recycled = await requestValue(recycle.get(id));
    const record = active || recycled?.payload;
    if (!record || record.schemaVersion !== BREW_HISTORY_SCHEMA) continue;
    const originalInventoryEvent = await requestValue(inventory.get(record.inventoryEventId));
    const consumedAmount = validateInventoryEvidence(record, originalInventoryEvent);
    const linkedSensory = allSensory.filter(item => item.brewSessionId === id);
    for (const item of linkedSensory) {
      if (sensoryMode === 'delete') sensory.delete(item.id);
      else sensory.put({ ...item, brewSessionId: '', detachedFromBrewSessionId: id, updatedAt: at });
    }
    if (restoreWeight) {
      weightByBean.set(record.beanId, (weightByBean.get(record.beanId) || 0) + consumedAmount);
      restoredWeightG += consumedAmount;
      inventory.put({
        id: `${id}:restore:${crypto.randomUUID()}`,
        beanId: record.beanId,
        sessionId: id,
        sourceEventId: originalInventoryEvent.id,
        type: 'restore-brew-deletion',
        amountG: consumedAmount,
        note: `永久删除冲煮记录并补回${consumedAmount.toFixed(1)}g`,
        createdAt: at
      });
    }
    sessions.delete(id);
    recycle.delete(id);
    allRevisions.filter(item => item.brewSessionId === id).forEach(item => revisions.delete(item.id));
    outbox.put({ id: `${id}:outbox:delete:${at}`, entity: 'brewSessions', entityId: id, operation: 'delete', payload: null, createdAt: at, attempts: 0 });
    deleted += 1;
  }

  for (const [beanId, amount] of weightByBean) {
    const bean = await requestValue(beans.get(beanId));
    if (!bean) { tx.abort(); throw new Error(`补回豆量失败：豆卡${beanId}不存在`); }
    beans.put({ ...bean, remainingWeight: Number((Number(bean.remainingWeight || 0) + amount).toFixed(3)), updatedAt: at });
  }
  await transactionDone(tx);
  emitChanged({ store: 'brewSessions', operation: 'permanent-delete', count: deleted, restoredWeightG });
  return { deleted, restoredWeightG };
}
