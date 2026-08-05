import { all } from '../db.js';
import { getActiveProvider } from '../services/provider-package-service.js';
import { confirmCustomCodeMerge, reconcileCustomCodes } from '../services/codebook-reconciliation-service.js';

const TABLE_LABELS = Object.freeze({
  countries: '国家', regions: '产区', entities: '庄园／处理站',
  varieties: '品种', processes: '处理法', flavors: '风味'
});
const TABLE_ALIASES = Object.freeze({
  country: 'countries', countries: 'countries', region: 'regions', regions: 'regions',
  entity: 'entities', entities: 'entities', farm: 'entities', station: 'entities', producer: 'entities',
  variety: 'varieties', varieties: 'varieties', process: 'processes', processes: 'processes',
  flavor: 'flavors', flavors: 'flavors'
});
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const root = () => document.querySelector('#overlayRoot');

function tableOf(record) {
  return TABLE_ALIASES[String(record.table || record.type || record.category || '').toLowerCase()] || '';
}
function customLabel(record) {
  return record.name || record.label || record.value || record.zh || record.en || record.code;
}
function officialLabel(row) {
  if (!Array.isArray(row)) return '未知正式项目';
  const values = row.slice(1).filter(value => typeof value === 'string' && value && !['active','candidate','deprecated'].includes(value));
  return values.find(value => /[\u3400-\u9fff]/.test(value)) || values[0] || row[0];
}
function findCandidate(codebook, code, preferredTable = '') {
  const tables = preferredTable ? [preferredTable] : Object.keys(TABLE_LABELS);
  for (const table of tables) {
    const row = (codebook?.[table] || []).find(item => item?.[0] === code);
    if (row) return { table, row };
  }
  return null;
}

async function context() {
  const [customs, provider] = await Promise.all([all('customCodes'), getActiveProvider('brewion')]);
  const codebook = provider?.data || null;
  const pending = customs.filter(record => ['custom_matched','custom_conflict'].includes(record.status));
  return { customs, pending, codebook, provider };
}

function candidateOptions(record, codebook) {
  const preferredTable = tableOf(record);
  const rows = (record.officialCandidates || []).map(code => {
    const found = findCandidate(codebook, code, preferredTable) || findCandidate(codebook, code);
    return found ? { code, ...found } : null;
  }).filter(Boolean);
  return rows.map((item, index) => `<option value="${esc(item.code)}" data-table="${esc(item.table)}"${index===0?' selected':''}>${esc(officialLabel(item.row))} · ${esc(item.code)}</option>`).join('');
}

export async function openCodebookReconciliationScreen() {
  const overlay = root();
  if (!overlay) return;
  const { pending, codebook, provider } = await context();
  if (!codebook) {
    overlay.innerHTML = `<div class="overlay"><div class="dialog codebook-review-dialog"><div class="dialog-header"><div><h2>编码整理</h2><p>BrewIon正式编码表尚未在本地激活。</p></div><button class="close-button" type="button" data-codebook-review-close>×</button></div><button type="button" data-codebook-review-refresh>重新校验数据源</button></div></div>`;
    bind(overlay, codebook);
    return;
  }
  overlay.innerHTML = `<div class="overlay full" data-overlay="codebook-reconciliation"><div class="dialog codebook-review-dialog">
    <div class="dialog-header"><div><h2>编码整理</h2><p>BrewIon ${esc(provider?.dataVersion || '')} · 仅处理无法唯一确认的自定义项目</p></div><button class="close-button" type="button" data-codebook-review-close>×</button></div>
    <div class="codebook-review-summary"><span>待确认 <strong>${pending.length}</strong> 项</span><button type="button" data-codebook-review-rescan>重新扫描</button></div>
    <div class="codebook-review-list">${pending.length ? pending.map(record => {
      const options = candidateOptions(record, codebook);
      return `<section class="codebook-review-row" data-custom-code="${esc(record.code)}">
        <div class="codebook-review-source"><strong>${esc(customLabel(record))}</strong><small>${esc(TABLE_LABELS[tableOf(record)] || '未分类')} · ${esc(record.code)}</small></div>
        <label class="field"><span>对应正式项目</span><select class="control" data-codebook-candidate>${options || '<option value="">没有可用候选</option>'}</select></label>
        <button type="button" data-codebook-confirm${options?'':' disabled'}>确认归并</button>
        <p class="codebook-review-message" data-codebook-message></p>
      </section>`;
    }).join('') : '<p class="empty-state">没有需要人工确认的自定义编码。</p>'}</div>
    <div class="codebook-review-actions"><button type="button" data-codebook-review-close>返回</button></div>
  </div></div>`;
  bind(overlay, codebook);
}

function bind(overlay, codebook) {
  overlay.querySelectorAll('[data-codebook-review-close]').forEach(button => button.addEventListener('click', () => { overlay.innerHTML = ''; }));
  overlay.querySelector('[data-codebook-review-refresh]')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    await globalThis.LuckyBeanProviders?.refresh?.({ force: true }).catch(() => {});
    await openCodebookReconciliationScreen();
  });
  overlay.querySelector('[data-codebook-review-rescan]')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    await reconcileCustomCodes(codebook, { automatic: true });
    await openCodebookReconciliationScreen();
  });
  overlay.querySelectorAll('[data-codebook-confirm]').forEach(button => button.addEventListener('click', async () => {
    const row = button.closest('[data-custom-code]');
    const select = row?.querySelector('[data-codebook-candidate]');
    const option = select?.selectedOptions?.[0];
    const oldCode = row?.dataset.customCode;
    const newCode = select?.value;
    const found = findCandidate(codebook, newCode, option?.dataset.table) || findCandidate(codebook, newCode);
    const message = row?.querySelector('[data-codebook-message]');
    if (!oldCode || !newCode || !found) return;
    button.disabled = true;
    if (message) message.textContent = '正在归并并迁移豆卡引用…';
    try {
      const result = await confirmCustomCodeMerge(oldCode, newCode, found.table, codebook);
      if (message) message.textContent = `已归并，更新${result.changedBeans}张豆卡。`;
      setTimeout(() => openCodebookReconciliationScreen(), 350);
    } catch (error) {
      button.disabled = false;
      if (message) message.textContent = error.message;
    }
  }));
}

globalThis.LuckyBeanCodebookReview = { open: openCodebookReconciliationScreen };
