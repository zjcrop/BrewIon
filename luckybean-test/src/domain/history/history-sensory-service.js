import { openDb } from '../../db.js';
import { BREW_HISTORY_SCHEMA } from './history-service.js';

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB请求失败'));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('品鉴关联事务失败'));
    tx.onabort = () => reject(tx.error || new Error('品鉴关联事务已回滚'));
  });
}

export async function attachSensoryToCompletedBrew({ recordId, sensoryRecord, nextPlanDraft = null }) {
  if (!recordId) throw new Error('缺少冲煮历史记录ID');
  if (!sensoryRecord?.id) throw new Error('缺少品鉴记录ID');
  const db = await openDb();
  const tx = db.transaction(['brewSessions', 'sensoryRecords', 'historyRevisions', 'syncOutbox'], 'readwrite');
  const sessions = tx.objectStore('brewSessions');
  const sensory = tx.objectStore('sensoryRecords');
  const revisions = tx.objectStore('historyRevisions');
  const outbox = tx.objectStore('syncOutbox');
  try {
    const record = await requestValue(sessions.get(recordId));
    if (!record || record.schemaVersion !== BREW_HISTORY_SCHEMA) {
      tx.abort();
      throw new Error('关联对象不是正式完成冲煮记录');
    }
    const at = new Date().toISOString();
    const revision = Number(record.revision || 1) + 1;
    const revisionId = `${record.id}:revision:${revision}`;
    const linked = {
      ...structuredClone(sensoryRecord),
      brewSessionId: record.id,
      updatedAt: at
    };
    const next = {
      ...record,
      sensoryRecordIds: [...new Set([...(record.sensoryRecordIds || []), linked.id])],
      sensoryRecordId: linked.id,
      sensoryNote: linked.naturalNote || '',
      autoScore: Number(linked.autoScore || 0),
      subjectiveScore: Number(linked.subjectiveScore ?? linked.score ?? 0),
      scoreDelta: Number(linked.scoreDelta || 0),
      nextPlanDraft: nextPlanDraft ? structuredClone(nextPlanDraft) : (record.nextPlanDraft || null),
      correctedPlanId: nextPlanDraft?.id || record.correctedPlanId || '',
      revision,
      revisionHeadId: revisionId,
      updatedAt: at,
      syncState: 'pending'
    };
    sensory.put(linked);
    sessions.put(next);
    revisions.put({
      id: revisionId,
      brewSessionId: record.id,
      revision,
      kind: nextPlanDraft ? 'sensory-linked-with-next-plan-draft' : 'sensory-linked',
      snapshot: structuredClone(next),
      createdAt: at
    });
    outbox.put({
      id: `${record.id}:outbox:${revision}`,
      entity: 'brewSessions',
      entityId: record.id,
      operation: 'upsert',
      payload: structuredClone(next),
      createdAt: at,
      attempts: 0
    });
    await transactionDone(tx);
    document.dispatchEvent(new CustomEvent('luckybean:data-changed', {
      detail: { store: 'brewSessions', operation: 'sensory-linked', recordId: record.id, at }
    }));
    return { record: next, sensoryRecord: linked };
  } catch (error) {
    try { tx.abort(); } catch { /* transaction already settled */ }
    throw error;
  }
}
