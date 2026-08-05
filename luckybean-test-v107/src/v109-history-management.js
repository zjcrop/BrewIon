import { all, bulkPut, openDb } from './db.js';
import { esc, formatDate, uid } from './utils.js';

const NOTE_ONLY_KEY = 'luckybean.sensory.note-only.v109';

function setNoteOnly(active) {
  if (active) sessionStorage.setItem(NOTE_ONLY_KEY, '1');
  else sessionStorage.removeItem(NOTE_ONLY_KEY);
  applyNoteOnlyLock();
}

function noteOnlyActive() {
  return sessionStorage.getItem(NOTE_ONLY_KEY) === '1';
}

function applyNoteOnlyLock() {
  if (!noteOnlyActive()) return;
  const evaluation = document.querySelector('.sensory-evaluation');
  if (!evaluation) return;
  evaluation.dataset.noteOnly = 'true';
  const previous = evaluation.querySelector('#prevSensoryNodeBtn');
  if (previous) {
    previous.disabled = true;
    previous.hidden = true;
    previous.setAttribute('aria-hidden', 'true');
  }
}

function consumedBySession(events, sessionId) {
  return events
    .filter(event => event.sessionId === sessionId && Number(event.amountG) < 0 && ['consume', 'brew-consume'].includes(String(event.type || 'consume')))
    .reduce((sum, event) => sum + Math.abs(Number(event.amountG) || 0), 0);
}

function sessionTitle(session) {
  return session.profile?.label || String(session.profileVersion || '').split('@')[0] || '冲煮方案';
}

function sessionStatus(session) {
  if (session.status === 'completed') return '已完成';
  if (session.status === 'terminated') return '已中止';
  if (session.status === 'corrected' || session.correction) return '已修正';
  return '方案记录';
}

async function resolveBeanIdFromDetail(panel) {
  const sessionId = panel.querySelector('[data-replay-session]')?.dataset.replaySession;
  if (!sessionId) return '';
  const sessions = await all('brewSessions');
  return sessions.find(session => session.id === sessionId)?.beanId || '';
}

function setBatchMessage(message, kind = '') {
  const node = document.querySelector('#v109BatchMessage');
  if (!node) return;
  node.textContent = message;
  node.className = `v109-batch-message ${kind}`.trim();
}

async function openBatchHistoryManager(beanId) {
  const [sessions, events, beans] = await Promise.all([all('brewSessions'), all('inventoryEvents'), all('beans')]);
  const bean = beans.find(item => item.id === beanId);
  const beanSessions = sessions
    .filter(session => session.beanId === beanId)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const root = document.querySelector('#overlayRoot');
  if (!root) return;

  root.innerHTML = `<div class="overlay full" data-overlay="v109-brew-history"><div class="dialog v109-history-dialog">
    <div class="dialog-header"><div><h2>管理全部冲煮记录</h2><p>${esc(bean?.name || '当前豆卡')} · 共 ${beanSessions.length} 条</p></div><button type="button" class="close-button" data-v109-close>×</button></div>
    <div class="v109-history-toolbar"><button type="button" data-v109-select-all>全选</button><button type="button" data-v109-select-none>清空选择</button><span id="v109SelectedCount">已选 0 条</span></div>
    <div class="v109-history-list">${beanSessions.length ? beanSessions.map(session => {
      const consumed = consumedBySession(events, session.id);
      return `<label class="v109-history-row"><input type="checkbox" value="${esc(session.id)}" data-v109-session><span><strong>${esc(sessionTitle(session))}</strong><small>${formatDate(session.createdAt)} · ${esc(sessionStatus(session))}${consumed > 0 ? ` · 已扣 ${consumed.toFixed(1)}g` : ' · 未发现扣重记录'}</small></span></label>`;
    }).join('') : '<p class="muted">没有可管理的冲煮记录。</p>'}</div>
    <p id="v109BatchMessage" class="v109-batch-message"></p>
    <div class="v109-history-actions"><button type="button" class="button subtle" data-v109-close>返回</button><button type="button" class="button danger" data-v109-delete-selected${beanSessions.length ? '' : ' disabled'}>删除所选记录</button></div>
  </div></div>`;

  const updateCount = () => {
    const count = root.querySelectorAll('[data-v109-session]:checked').length;
    const node = root.querySelector('#v109SelectedCount');
    if (node) node.textContent = `已选 ${count} 条`;
  };

  root.querySelectorAll('[data-v109-session]').forEach(input => input.addEventListener('change', updateCount));
  root.querySelectorAll('[data-v109-close]').forEach(button => button.addEventListener('click', () => { root.innerHTML = ''; }));
  root.querySelector('[data-v109-select-all]')?.addEventListener('click', () => {
    root.querySelectorAll('[data-v109-session]').forEach(input => { input.checked = true; });
    updateCount();
  });
  root.querySelector('[data-v109-select-none]')?.addEventListener('click', () => {
    root.querySelectorAll('[data-v109-session]').forEach(input => { input.checked = false; });
    updateCount();
  });
  root.querySelector('[data-v109-delete-selected]')?.addEventListener('click', async () => {
    const ids = [...root.querySelectorAll('[data-v109-session]:checked')].map(input => input.value);
    if (!ids.length) return setBatchMessage('请先选择需要删除的记录。', 'warn');
    await confirmBatchDelete(beanId, ids);
  });
}

async function confirmBatchDelete(beanId, ids) {
  const [sessions, events, beans] = await Promise.all([all('brewSessions'), all('inventoryEvents'), all('beans')]);
  const selected = sessions.filter(session => ids.includes(session.id) && session.beanId === beanId);
  const bean = beans.find(item => item.id === beanId);
  const restorable = selected.reduce((sum, session) => sum + consumedBySession(events, session.id), 0);
  const missingCount = selected.filter(session => consumedBySession(events, session.id) <= 0).length;
  const root = document.querySelector('#overlayRoot');
  if (!root || !selected.length) return;

  root.innerHTML = `<div class="overlay" data-overlay="v109-batch-confirm"><div class="dialog v109-confirm-dialog">
    <div class="dialog-header"><div><h2>确认批量删除</h2><p>将永久删除 ${selected.length} 条冲煮记录。</p></div></div>
    ${restorable > 0 ? `<p class="status-warn">这些记录对应的豆子扣减合计为 <strong>${restorable.toFixed(1)}g</strong>。请选择是否补回“${esc(bean?.name || '当前豆卡')}”的剩余克重。</p>` : '<p>所选记录没有找到可回补的扣重事件。</p>'}
    ${missingCount ? `<p class="muted small">其中 ${missingCount} 条未发现扣重事件，不会推算或补回克重。</p>` : ''}
    <div class="v109-confirm-actions"><button type="button" class="button subtle" data-v109-cancel-confirm>取消</button><button type="button" class="button danger" data-v109-delete-only>仅删除记录</button>${restorable > 0 && bean ? `<button type="button" class="button primary" data-v109-delete-restore>删除并补回 ${restorable.toFixed(1)}g</button>` : ''}</div>
  </div></div>`;

  root.querySelector('[data-v109-cancel-confirm]')?.addEventListener('click', () => openBatchHistoryManager(beanId));
  root.querySelector('[data-v109-delete-only]')?.addEventListener('click', () => executeBatchDelete(beanId, selected, false));
  root.querySelector('[data-v109-delete-restore]')?.addEventListener('click', () => executeBatchDelete(beanId, selected, true));
}

async function executeBatchDelete(beanId, selectedSessions, restoreWeight) {
  const root = document.querySelector('#overlayRoot');
  if (root) root.querySelectorAll('button').forEach(button => { button.disabled = true; });
  const [events, beans, sensoryRecords] = await Promise.all([all('inventoryEvents'), all('beans'), all('sensoryRecords')]);
  const bean = beans.find(item => item.id === beanId);
  const sessionIds = new Set(selectedSessions.map(session => session.id));
  const now = new Date().toISOString();
  const total = selectedSessions.reduce((sum, session) => sum + consumedBySession(events, session.id), 0);
  const detached = sensoryRecords
    .filter(record => sessionIds.has(record.brewSessionId))
    .map(record => ({ ...record, brewSessionId: '', detachedFromBrewSessionId: record.brewSessionId, updatedAt: now }));

  try {
    if (detached.length) await bulkPut('sensoryRecords', detached);
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['brewSessions', 'beans', 'inventoryEvents'], 'readwrite');
      const brewStore = tx.objectStore('brewSessions');
      const beanStore = tx.objectStore('beans');
      const eventStore = tx.objectStore('inventoryEvents');
      selectedSessions.forEach(session => brewStore.delete(session.id));

      if (restoreWeight && bean && total > 0) {
        let runningWeight = Number(bean.remainingWeight || 0);
        selectedSessions.forEach(session => {
          const amount = consumedBySession(events, session.id);
          if (amount <= 0) return;
          runningWeight += amount;
          eventStore.put({
            id: uid('inv'),
            beanId,
            type: 'restore-brew-deletion',
            amountG: amount,
            resultingWeightG: runningWeight,
            sourceSessionId: session.id,
            note: `批量删除冲煮记录并补回 ${amount.toFixed(1)}g`,
            createdAt: now
          });
        });
        beanStore.put({ ...bean, remainingWeight: runningWeight, updatedAt: now });
      }

      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('批量删除事务失败'));
      tx.onabort = () => reject(tx.error || new Error('批量删除事务中止'));
    });

    if (root) root.innerHTML = `<div class="overlay"><div class="dialog v109-confirm-dialog"><h2>处理完成</h2><p>已删除 ${selectedSessions.length} 条冲煮记录。${restoreWeight && total > 0 ? `已补回 ${total.toFixed(1)}g 到豆卡剩余克重。` : '豆卡克重未改动。'}</p></div></div>`;
    setTimeout(() => location.reload(), 700);
  } catch (error) {
    if (root) root.innerHTML = `<div class="overlay"><div class="dialog v109-confirm-dialog"><h2>删除失败</h2><p>${esc(error.message)}</p><button type="button" class="button" onclick="location.reload()">重新载入</button></div></div>`;
  }
}

async function enhanceBeanDetail() {
  const detail = document.querySelector('[data-overlay="bean-detail"]');
  if (!detail) return;
  const panel = [...detail.querySelectorAll('.panel')].find(node => node.querySelector('h3')?.textContent.trim() === '冲煮记录');
  if (!panel || panel.querySelector('[data-v109-manage-history]')) return;
  const title = panel.querySelector('.panel-title');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button v109-manage-history';
  button.dataset.v109ManageHistory = 'true';
  button.textContent = '批量管理';
  title?.append(button);
  button.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();
    const beanId = await resolveBeanIdFromDetail(panel);
    if (!beanId) return;
    await openBatchHistoryManager(beanId);
  });
}

function injectStyles() {
  if (document.querySelector('#v109HistoryStyles')) return;
  const style = document.createElement('style');
  style.id = 'v109HistoryStyles';
  style.textContent = `
    .v109-manage-history{margin-left:auto}
    .v109-history-dialog{width:min(680px,96vw);max-height:90vh;display:flex;flex-direction:column}
    .v109-history-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0 12px}
    .v109-history-toolbar button{border:1px solid #74664a;background:#1d1b17;color:#f3e8ca;border-radius:9px;padding:8px 10px}
    .v109-history-toolbar span{margin-left:auto;color:#cdb77e;font-size:13px}
    .v109-history-list{overflow:auto;display:grid;gap:8px;min-height:120px}
    .v109-history-row{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:center;padding:12px;border:1px solid rgba(160,145,110,.28);border-radius:12px;background:rgba(255,255,255,.025)}
    .v109-history-row input{width:20px;height:20px}
    .v109-history-row span{display:grid;gap:4px}
    .v109-history-row small{color:#aaa59a}
    .v109-history-actions,.v109-confirm-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}
    .v109-batch-message{min-height:20px;margin:8px 0 0}
    .v109-batch-message.warn{color:#e2b45f}
    .v109-confirm-dialog{width:min(520px,94vw)}
    .sensory-evaluation[data-note-only="true"] .sensory-navigation{grid-template-columns:1fr auto}
    .sensory-evaluation[data-note-only="true"] #prevSensoryNodeBtn{display:none!important}
    @media(max-width:560px){.v109-history-actions .button,.v109-confirm-actions .button{flex:1 1 100%}}
  `;
  document.head.append(style);
}

document.addEventListener('click', event => {
  if (event.target.closest('[data-v095-mode="note"]')) setNoteOnly(true);
  if (noteOnlyActive() && event.target.closest('#prevSensoryNodeBtn')) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  if (event.target.closest('#cancelEvaluationBtn')) setNoteOnly(false);
  const next = event.target.closest('#nextSensoryNodeBtn');
  if (next && noteOnlyActive() && /完成品鉴/.test(next.textContent || '')) {
    setTimeout(() => setNoteOnly(false), 500);
  }
}, true);

const observer = new MutationObserver(() => {
  applyNoteOnlyLock();
  enhanceBeanDetail().catch(() => {});
});
observer.observe(document.documentElement, { childList: true, subtree: true });

injectStyles();
applyNoteOnlyLock();
enhanceBeanDetail().catch(() => {});
