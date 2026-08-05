import {
  listCompletedBrews,
  archiveBrewRecords,
  moveBrewRecordsToRecycleBin,
  restoreBrewRecordsFromRecycleBin,
  permanentlyDeleteBrewRecords
} from '../../domain/history/history-service.js';
import { all } from '../../db.js';
import { formatDate } from '../../utils.js';
import { compareAnalyses, changeReasons } from '../../domain/history/history-comparison.js';

const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const overlayRoot = () => document.querySelector('#overlayRoot');
let state = { beanId: '', query: '', archived: false, recycle: false, selected: new Set() };

function profileTitle(record) {
  const plan = record.analysisSnapshot?.plan || {};
  return plan.profile?.label || plan.metadata?.profileId || plan.profileVersion?.split('@')[0] || '冲煮方案';
}
function recordSearchText(record, bean) {
  const plan = record.analysisSnapshot?.plan || {};
  return [bean?.name, profileTitle(record), record.execution?.notes?.join(' '), plan.warnings?.map?.(item => item.message || item)?.join(' ')].filter(Boolean).join(' ').toLowerCase();
}
function rowHtml(record, bean) {
  const selected = state.selected.has(record.id);
  const plan = record.analysisSnapshot?.plan || {};
  const totalWater = Number(plan.summary?.totalWater ?? plan.totals?.waterG ?? 0);
  return `<article class="history-row" data-history-record="${esc(record.id)}">
    <label class="history-select"><input type="checkbox" data-history-select="${esc(record.id)}"${selected?' checked':''}><span></span></label>
    <button class="history-row-main" type="button" data-history-open="${esc(record.id)}">
      <strong>${esc(bean?.name || '未命名豆卡')} · ${esc(profileTitle(record))}</strong>
      <small>${esc(formatDate(record.createdAt))} · ${Number(record.deductedWeightG).toFixed(1)}g${totalWater?` · ${totalWater.toFixed(0)}g水`:''}</small>
    </button>
  </article>`;
}

async function data() {
  const [records, beans, recycle] = await Promise.all([
    listCompletedBrews({ beanId: state.beanId, includeArchived: true }),
    all('beans'),
    all('recycleBin').catch(() => [])
  ]);
  const beanMap = new Map(beans.map(bean => [bean.id, bean]));
  if (state.recycle) {
    const rows = recycle.filter(item => item.entity === 'brewSessions' && item.payload?.schemaVersion === 'brew-history/1.0').map(item => item.payload);
    return { records: rows.filter(record => !state.beanId || record.beanId === state.beanId), beanMap };
  }
  return { records: records.filter(record => state.archived ? Boolean(record.archivedAt) : !record.archivedAt), beanMap };
}

export async function openHistoryScreen(options = {}) {
  state = { ...state, beanId: options.beanId ?? state.beanId, selected: new Set() };
  const root = overlayRoot(); if (!root) return;
  const { records, beanMap } = await data();
  const query = state.query.trim().toLowerCase();
  const filtered = records.filter(record => !query || recordSearchText(record, beanMap.get(record.beanId)).includes(query));
  root.innerHTML = `<div class="overlay full" data-overlay="formal-history"><div class="dialog history-dialog">
    <div class="dialog-header"><div><h2>冲煮历史</h2><p>仅显示已完成并确认扣豆的正式记录</p></div><button class="close-button" type="button" data-history-close>×</button></div>
    <div class="history-tabs"><button type="button" data-history-tab="active"${!state.archived&&!state.recycle?' class="active"':''}>记录</button><button type="button" data-history-tab="archived"${state.archived?' class="active"':''}>归档</button><button type="button" data-history-tab="recycle"${state.recycle?' class="active"':''}>回收站</button></div>
    <div class="history-toolbar"><input id="historySearchInput" class="control" placeholder="搜索豆卡、方案或札记" value="${esc(state.query)}"><button type="button" data-history-search>搜索</button><button type="button" data-history-select-all>全选</button><span data-history-count>已选 ${state.selected.size} 条</span></div>
    <div class="history-list">${filtered.length ? filtered.map(record => rowHtml(record,beanMap.get(record.beanId))).join('') : '<p class="empty-state">没有符合条件的正式冲煮记录。</p>'}</div>
    <div class="history-actions">
      ${state.recycle ? '<button type="button" data-history-restore>恢复所选</button><button type="button" class="danger" data-history-permanent>永久删除</button>' : `<button type="button" data-history-compare>对比两条记录</button><button type="button" data-history-archive>${state.archived?'取消归档':'归档所选'}</button><button type="button" class="danger" data-history-recycle>移至回收站</button>`}
    </div>
  </div></div>`;
  bindHistory(root, filtered, beanMap);
}

function selectedIds(root) { return [...root.querySelectorAll('[data-history-select]:checked')].map(input => input.dataset.historySelect); }
function updateCount(root) { const ids=selectedIds(root); state.selected=new Set(ids); const node=root.querySelector('[data-history-count]'); if(node)node.textContent=`已选 ${ids.length} 条`; }
function bindHistory(root, records, beanMap) {
  root.querySelector('[data-history-close]')?.addEventListener('click',()=>{root.innerHTML='';});
  root.querySelectorAll('[data-history-tab]').forEach(button=>button.addEventListener('click',()=>{const tab=button.dataset.historyTab;state.archived=tab==='archived';state.recycle=tab==='recycle';openHistoryScreen();}));
  root.querySelector('[data-history-search]')?.addEventListener('click',()=>{state.query=root.querySelector('#historySearchInput')?.value||'';openHistoryScreen();});
  root.querySelector('#historySearchInput')?.addEventListener('keydown',event=>{if(event.key==='Enter'){state.query=event.currentTarget.value;openHistoryScreen();}});
  root.querySelectorAll('[data-history-select]').forEach(input=>input.addEventListener('change',()=>updateCount(root)));
  root.querySelector('[data-history-select-all]')?.addEventListener('click',()=>{root.querySelectorAll('[data-history-select]').forEach(input=>{input.checked=true;});updateCount(root);});
  root.querySelectorAll('[data-history-open]').forEach(button=>button.addEventListener('click',()=>openHistoryDetail(records.find(record=>record.id===button.dataset.historyOpen),beanMap.get(records.find(record=>record.id===button.dataset.historyOpen)?.beanId))));
  root.querySelector('[data-history-compare]')?.addEventListener('click',()=>{const ids=selectedIds(root);if(ids.length!==2)return;openHistoryComparison(records.filter(record=>ids.includes(record.id)),beanMap);});
  root.querySelector('[data-history-archive]')?.addEventListener('click',async()=>{const ids=selectedIds(root);if(!ids.length)return;await archiveBrewRecords(ids,!state.archived);await openHistoryScreen();});
  root.querySelector('[data-history-recycle]')?.addEventListener('click',async()=>{const ids=selectedIds(root);if(!ids.length)return;await moveBrewRecordsToRecycleBin(ids);await openHistoryScreen();});
  root.querySelector('[data-history-restore]')?.addEventListener('click',async()=>{const ids=selectedIds(root);if(!ids.length)return;await restoreBrewRecordsFromRecycleBin(ids);await openHistoryScreen();});
  root.querySelector('[data-history-permanent]')?.addEventListener('click',()=>openPermanentDelete(selectedIds(root)));
}

function stageRows(record) {
  return (record.analysisSnapshot?.plan?.stages || []).map(stage=>`<div class="history-stage"><strong>${esc(stage.name||`第${stage.index}段`)}</strong><span>${Number(stage.pour??stage.stageWaterG??0).toFixed(0)}g · 累计${Number(stage.cumulative??stage.cumulativeWaterG??0).toFixed(0)}g · ${Number(stage.pourTemperature??stage.temperatureC??0).toFixed(0)}°C</span></div>`).join('');
}
function openHistoryDetail(record, bean) {
  if(!record)return;
  const root=overlayRoot();const analysis=record.analysisSnapshot;const plan=analysis.plan||{};
  root.innerHTML=`<div class="overlay full" data-overlay="history-detail"><div class="dialog history-detail-dialog">
    <div class="dialog-header"><div><h2>${esc(bean?.name||'未命名豆卡')}</h2><p>${esc(profileTitle(record))} · ${esc(formatDate(record.createdAt))}</p></div><button class="close-button" type="button" data-history-back>×</button></div>
    <div class="history-detail-summary"><span>扣豆 <strong>${Number(record.deductedWeightG).toFixed(1)}g</strong></span><span>实际时间 <strong>${Math.round(Number(record.execution?.actualTotalTimeSec||0))}s</strong></span><span>引擎 <strong>${esc(analysis.engine?.apiVersion||'—')}</strong></span></div>
    <section class="panel"><div class="panel-title"><h3>执行方案</h3></div><div class="history-stages">${stageRows(record)}</div></section>
    <section class="panel"><div class="panel-title"><h3>执行偏差与札记</h3></div><p>${esc((record.execution?.notes||[]).join('；')||'未记录')}</p></section>
    <div class="history-detail-actions"><button type="button" data-history-spatial>查看三维轨迹</button><button type="button" data-history-replay>载入复刻</button><button type="button" data-history-back>返回</button></div>
  </div></div>`;
  root.querySelectorAll('[data-history-back]').forEach(button=>button.addEventListener('click',()=>openHistoryScreen()));
  root.querySelector('[data-history-spatial]')?.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('luckybean:open-spatial-scene',{detail:{scene:analysis.trajectory}})));
  root.querySelector('[data-history-replay]')?.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('luckybean:request-history-replay',{detail:{recordId:record.id}})));
}

function comparisonDirectionRow(item) {
  return `<div class="history-compare-signal ${esc(item.direction.key)}"><span>${esc(item.label)}</span><strong>${esc(item.direction.arrow)} ${esc(item.direction.label)}</strong></div>`;
}

function openHistoryComparison(selected, beanMap) {
  if (!Array.isArray(selected) || selected.length !== 2) return;
  const [previous, current] = [...selected].sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  const comparison = compareAnalyses(previous, current);
  const reasons = changeReasons(comparison);
  const root = overlayRoot();
  if (!root) return;
  root.innerHTML = `<div class="overlay full" data-overlay="history-comparison"><div class="dialog history-comparison-dialog">
    <div class="dialog-header"><div><h2>冲煮记录对比</h2><p>${esc(beanMap.get(previous.beanId)?.name || '豆卡')} · ${esc(formatDate(previous.createdAt))} → ${esc(formatDate(current.createdAt))}</p></div><button class="close-button" type="button" data-history-comparison-back>×</button></div>
    <section class="panel"><div class="panel-title"><div><h3>总体趋势</h3><p>${esc(comparison.headline)}</p></div></div><div class="history-compare-signals">${comparison.signals.length?comparison.signals.map(comparisonDirectionRow).join(''):'<p class="muted">两条记录没有共同的可比较风味信号。</p>'}</div></section>
    <section class="panel"><div class="panel-title"><h3>方案参数变化</h3></div><div class="history-compare-parameters">${comparison.parameters.map(item=>`<div><span>${esc(item.label)}</span><strong>${item.before==null?'—':esc(item.before)}${esc(item.unit)} → ${item.after==null?'—':esc(item.after)}${esc(item.unit)}</strong></div>`).join('')}</div>${reasons.length?`<p class="muted small">${reasons.map(esc).join('；')}</p>`:''}</section>
    <p class="muted small">风味结果采用方向比较，不表示实验室级绝对测量。</p>
    <div class="history-detail-actions"><button type="button" data-history-comparison-spatial="previous">查看前次三维</button><button type="button" data-history-comparison-spatial="current">查看本次三维</button><button type="button" data-history-comparison-back>返回</button></div>
  </div></div>`;
  root.querySelectorAll('[data-history-comparison-back]').forEach(button=>button.addEventListener('click',()=>openHistoryScreen()));
  root.querySelectorAll('[data-history-comparison-spatial]').forEach(button=>button.addEventListener('click',()=>{
    const record=button.dataset.historyComparisonSpatial==='previous'?previous:current;
    document.dispatchEvent(new CustomEvent('luckybean:open-spatial-scene',{detail:{scene:record.analysisSnapshot?.trajectory}}));
  }));
}

function openPermanentDelete(ids) {
  if(!ids.length)return;
  const root=overlayRoot();
  root.innerHTML=`<div class="overlay" data-overlay="history-permanent-delete"><div class="dialog history-delete-dialog">
    <div class="dialog-header"><div><h2>永久删除 ${ids.length} 条记录</h2><p>请选择豆量和关联品鉴的处理方式。操作不可撤销。</p></div></div>
    <label class="toggle"><input id="historyRestoreWeight" type="checkbox">补回原库存事件记录的扣豆量</label>
    <label class="field"><span>关联品鉴</span><select id="historySensoryMode" class="control"><option value="detach">保留品鉴并解除关联</option><option value="delete">同时删除关联品鉴</option></select></label>
    <div class="history-detail-actions"><button type="button" data-delete-cancel>取消</button><button type="button" class="danger" data-delete-confirm>永久删除</button></div>
  </div></div>`;
  root.querySelector('[data-delete-cancel]')?.addEventListener('click',()=>openHistoryScreen());
  root.querySelector('[data-delete-confirm]')?.addEventListener('click',async event=>{event.currentTarget.disabled=true;try{await permanentlyDeleteBrewRecords(ids,{restoreWeight:root.querySelector('#historyRestoreWeight').checked,sensoryMode:root.querySelector('#historySensoryMode').value});await openHistoryScreen();}catch(error){event.currentTarget.disabled=false;event.currentTarget.textContent=error.message;}});
}
