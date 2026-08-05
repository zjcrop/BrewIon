import { updateAllProviders, getActiveProvider } from './provider-package-service.js';
import { reconcileCustomCodes } from './codebook-reconciliation-service.js';
import { validateCodebook } from '../codebook.js';
import { activateCodebook } from '../db.js';

let running = null;

async function activateBrewIon(result) {
  const active = result?.active || await getActiveProvider('brewion');
  if (!active?.data) return null;
  const data = validateCodebook(structuredClone(active.data));
  const record = {
    id: 'active',
    data,
    source: 'brewion-provider',
    hash: active.artifactSha256,
    version: active.dataVersion,
    releaseId: active.releaseId,
    updatedAt: active.generatedAt,
    checkedAt: new Date().toISOString()
  };
  await activateCodebook(record);
  const reconciliation = await reconcileCustomCodes(data);
  document.dispatchEvent(new CustomEvent('luckybean:codebook-provider-activated', {
    detail: { data, meta: record, reconciliation }
  }));
  return { data, meta: record, reconciliation };
}

export async function refreshProviders({ force = false } = {}) {
  if (running) return running;
  running = (async () => {
    const results = await updateAllProviders({ force });
    const brewion = await activateBrewIon(results.brewion);
    document.dispatchEvent(new CustomEvent('luckybean:providers-ready', { detail: { results, brewion } }));
    return { results, brewion };
  })().finally(() => { running = null; });
  return running;
}

function schedule() {
  const run = () => refreshProviders().catch(error => {
    console.warn('Provider后台更新失败，继续使用最后有效本地版本', error);
    document.dispatchEvent(new CustomEvent('luckybean:provider-update-error', { detail: { message: error.message } }));
  });
  if ('requestIdleCallback' in globalThis) requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 1200);
}

document.addEventListener('luckybean:cloud-login-success', schedule);
window.addEventListener('online', schedule, { passive: true });
schedule();

globalThis.LuckyBeanProviders = { refresh: refreshProviders, active: getActiveProvider };
