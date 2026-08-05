import { all, openDb, getSetting, setSetting } from '../../db.js';
import { createLocalReferenceAnalysis } from '../../services/local-reference-analysis.js';

const MIGRATION_KEY = 'migration.brew-history.v1';
const SCHEMA = 'brew-history/1.0';

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('旧冲煮记录迁移失败'));
    tx.onabort = () => reject(tx.error || new Error('旧冲煮记录迁移已回滚'));
  });
}

export async function migrateLegacyBrewHistory() {
  if (await getSetting(MIGRATION_KEY, false)) return { migrated: 0, recycled: 0 };
  const [sessions, events] = await Promise.all([all('brewSessions'), all('inventoryEvents')]);
  const legacy = sessions.filter(session => session?.schemaVersion !== SCHEMA);
  if (!legacy.length) { await setSetting(MIGRATION_KEY, true); return { migrated: 0, recycled: 0 }; }
  const db = await openDb();
  let migrated = 0;
  let recycled = 0;

  for (const session of legacy) {
    const consumption = events.find(event => event.sessionId === session.id && Number(event.amountG) < 0 && ['consume', 'brew-consume'].includes(String(event.type || '')));
    const tx = db.transaction(['brewSessions', 'recycleBin', 'historyRevisions'], 'readwrite');
    const sessionsStore = tx.objectStore('brewSessions');
    const recycleStore = tx.objectStore('recycleBin');
    const revisions = tx.objectStore('historyRevisions');
    if (!consumption) {
      recycleStore.put({
        id: `legacy:${session.id}`,
        entity: 'legacy-brew-session',
        payload: structuredClone(session),
        recycledAt: new Date().toISOString(),
        migrationReason: '缺少确认扣豆事件，不属于正式冲煮历史'
      });
      sessionsStore.delete(session.id);
      recycled += 1;
      await done(tx);
      continue;
    }

    const input = structuredClone(session.input || {});
    const analysis = session.analysisSnapshot?.contract === 'brew-analysis/2.0'
      ? structuredClone(session.analysisSnapshot)
      : await createLocalReferenceAnalysis(input, session, '由旧版冲煮记录迁移，缺少当时的专业三维快照');
    const createdAt = session.completedAt || session.createdAt || consumption.createdAt || new Date().toISOString();
    const revisionId = `${session.id}:revision:1`;
    const record = {
      id: session.id,
      schemaVersion: SCHEMA,
      beanId: session.beanId,
      createdAt,
      updatedAt: new Date().toISOString(),
      deductedWeightG: Math.abs(Number(consumption.amountG)),
      inventoryEventId: consumption.id,
      rawInput: input,
      normalizedInput: structuredClone(analysis.input || input),
      analysisSnapshot: analysis,
      execution: {
        startedAt: session.startedAt || session.createdAt || createdAt,
        finishedAt: createdAt,
        actualTotalTimeSec: Number(session.actualTotalTimeSec || session.totals?.targetTimeSec || session.summary?.totalTime || 0),
        stageExecutions: [],
        deviations: [],
        notes: ['由旧版正式扣豆记录迁移'],
        environment: { ambientTemperatureC: 25, relativeHumidityPct: null, initialBedTemperatureC: 25 }
      },
      providerVersions: structuredClone(analysis.integrations?.sourceVersions || {}),
      sensoryRecordIds: [],
      revision: 1,
      revisionHeadId: revisionId,
      archivedAt: null,
      recycledAt: null,
      syncState: 'pending'
    };
    sessionsStore.put(record);
    revisions.put({ id: revisionId, brewSessionId: record.id, revision: 1, kind: 'legacy-migration', snapshot: structuredClone(record), createdAt: record.updatedAt });
    migrated += 1;
    await done(tx);
  }
  await setSetting(MIGRATION_KEY, true);
  document.dispatchEvent(new CustomEvent('luckybean:history-migrated', { detail: { migrated, recycled } }));
  return { migrated, recycled };
}
