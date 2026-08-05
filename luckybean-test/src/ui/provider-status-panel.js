import { getActiveProvider, PROVIDER_REGISTRY } from '../services/provider-package-service.js';
import { get } from '../db.js';
import { BREW_ANALYSIS_CONTRACT, BREW_SPATIAL_CONTRACT } from '../services/brew-analysis-service.js';
import { openCodebookReconciliationScreen } from './codebook-reconciliation-screen.js';

const LABELS = Object.freeze({
  brewion: 'BrewIon编码表',
  'grind-psd': 'Grind-PSD研磨参考',
  'brew-water-calibrato': '萃离水型'
});
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));

async function statusData() {
  const providers = await Promise.all(Object.keys(PROVIDER_REGISTRY).map(async id => [id, await getActiveProvider(id)]));
  const reconciliation = await get('syncMetadata', 'codebook.reconciliation.latest').catch(() => null);
  return { providers: Object.fromEntries(providers), reconciliation };
}

function providerRow(id, active) {
  const version = active?.dataVersion || '内置版本';
  const state = active?.artifactSha256 ? '已校验' : active ? '本地可用' : '等待后台检查';
  return `<div class="provider-status-row"><div><strong>${esc(LABELS[id] || id)}</strong><small>${esc(version)}</small></div><span class="provider-status-state">${esc(state)}</span></div>`;
}

export async function renderProviderStatusPanel(host) {
  if (!host) return;
  host.innerHTML = '<p class="muted small">正在读取本地数据源状态…</p>';
  const { providers, reconciliation } = await statusData();
  const pending = Number(reconciliation?.pending || 0);
  host.innerHTML = `<div class="provider-status-list">
    ${Object.keys(PROVIDER_REGISTRY).map(id => providerRow(id, providers[id])).join('')}
    <div class="provider-status-row"><div><strong>专业分析协议</strong><small>${esc(BREW_ANALYSIS_CONTRACT)}</small></div><span class="provider-status-state">正式契约</span></div>
    <div class="provider-status-row"><div><strong>三维轨迹协议</strong><small>${esc(BREW_SPATIAL_CONTRACT)}</small></div><span class="provider-status-state">正式契约</span></div>
    <div class="provider-status-row"><div><strong>自定义编码整理</strong><small>已自动归并 ${Number(reconciliation?.merged || 0)} 项</small></div><span class="provider-status-state${pending ? ' pending' : ''}">${pending ? `${pending}项待确认` : '无待确认项'}</span></div>
    ${pending ? '<button type="button" class="provider-review-button" data-provider-review-codes>处理待确认编码</button>' : ''}
  </div>`;
  host.querySelector('[data-provider-review-codes]')?.addEventListener('click', openCodebookReconciliationScreen);
}

export async function refreshProviderStatusPanel(host) {
  await renderProviderStatusPanel(host);
}
