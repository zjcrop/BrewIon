import { openDb, get } from '../db.js';
import { sha256Hex } from '../utils.js';

export const PROVIDER_REGISTRY = Object.freeze({
  brewion: {
    contract: 'coffee-codebook/1.0', required: true,
    manifestUrl: 'https://raw.githubusercontent.com/zjcrop/BrewIon/main/provider/releases/latest.json'
  },
  'grind-psd': {
    contract: 'grinder-reference/1.0', required: false,
    manifestUrl: 'https://raw.githubusercontent.com/zjcrop/Grind-PSD/main/provider/releases/latest.json'
  },
  'brew-water-calibrato': {
    contract: 'water-formulation/1.0', required: false,
    manifestUrl: 'https://raw.githubusercontent.com/zjcrop/Brew-Water-Calibrato/main/provider/releases/latest.json'
  }
});

const ACTIVE_PREFIX = 'provider.active.';
const CANDIDATE_PREFIX = 'provider.candidate.';
const CHECK_PREFIX = 'provider.checked.';
const timeoutFetch = async (url, timeoutMs = 10000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes, text: new TextDecoder().decode(bytes), url };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Provider连接超时');
    throw error;
  } finally { clearTimeout(timer); }
};

function requestDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Provider原子切换失败'));
    tx.onabort = () => reject(tx.error || new Error('Provider切换已回滚'));
  });
}
function artifactFor(manifest) {
  return manifest?.artifacts?.find(item => item.kind === 'full') || manifest?.artifacts?.find(item => item.kind === 'catalog') || manifest?.artifacts?.[0];
}
function validateManifest(provider, registry, manifest) {
  if (!manifest || manifest.provider !== provider) throw new Error(`${provider} Manifest身份不匹配`);
  if (manifest.contract !== registry.contract) throw new Error(`${provider}契约不匹配：${manifest.contract || 'missing'}`);
  if (!manifest.releaseId || !manifest.dataVersion) throw new Error(`${provider} Manifest缺少版本`);
  const artifact = artifactFor(manifest);
  if (!artifact?.url || !artifact.sha256 || !Number.isFinite(Number(artifact.bytes))) throw new Error(`${provider}缺少可校验的完整数据包`);
  return artifact;
}
async function parseAndVerify(provider, manifest, artifact) {
  const response = await timeoutFetch(artifact.url, 15000);
  if (response.bytes.byteLength !== Number(artifact.bytes)) throw new Error(`${provider}数据包字节数不一致`);
  const hash = await sha256Hex(response.text);
  if (hash.toLowerCase() !== String(artifact.sha256).toLowerCase()) throw new Error(`${provider}数据包SHA-256校验失败`);
  let data;
  try { data = JSON.parse(response.text); } catch { throw new Error(`${provider}数据包不是有效JSON`); }
  return { data, hash, bytes: response.bytes.byteLength, artifactUrl: response.url };
}

export async function getActiveProvider(provider) {
  return get('syncMetadata', `${ACTIVE_PREFIX}${provider}`).catch(() => null);
}

export async function updateProvider(provider, { force = false } = {}) {
  const registry = PROVIDER_REGISTRY[provider];
  if (!registry) throw new Error(`未知Provider：${provider}`);
  const current = await getActiveProvider(provider);
  if (!navigator.onLine && !force) return { updated: false, active: current, offline: true };
  const manifestResponse = await timeoutFetch(registry.manifestUrl, 10000);
  let manifest;
  try { manifest = JSON.parse(manifestResponse.text); } catch { throw new Error(`${provider} Manifest不是有效JSON`); }
  const artifact = validateManifest(provider, registry, manifest);
  if (!force && current?.releaseId === manifest.releaseId && current?.artifactSha256 === artifact.sha256) {
    return { updated: false, active: current, checked: true };
  }
  const verified = await parseAndVerify(provider, manifest, artifact);
  const candidate = {
    id: `${CANDIDATE_PREFIX}${provider}`,
    provider,
    contract: manifest.contract,
    releaseId: manifest.releaseId,
    dataVersion: manifest.dataVersion,
    schemaVersion: manifest.schemaVersion || '',
    generatedAt: manifest.generatedAt || '',
    manifest: structuredClone(manifest),
    artifactSha256: verified.hash,
    artifactBytes: verified.bytes,
    artifactUrl: verified.artifactUrl,
    data: verified.data,
    stagedAt: new Date().toISOString()
  };
  const db = await openDb();
  const tx = db.transaction('syncMetadata', 'readwrite');
  const store = tx.objectStore('syncMetadata');
  store.put(candidate);
  store.put({ ...candidate, id: `${ACTIVE_PREFIX}${provider}`, activatedAt: new Date().toISOString() });
  store.put({ id: `${CHECK_PREFIX}${provider}`, provider, checkedAt: new Date().toISOString(), releaseId: manifest.releaseId, ok: true });
  await requestDone(tx);
  const active = { ...candidate, id: `${ACTIVE_PREFIX}${provider}` };
  document.dispatchEvent(new CustomEvent('luckybean:provider-updated', { detail: { provider, previous: current, active } }));
  return { updated: true, previous: current, active };
}

export async function updateAllProviders(options = {}) {
  const results = {};
  for (const provider of Object.keys(PROVIDER_REGISTRY)) {
    try { results[provider] = await updateProvider(provider, options); }
    catch (error) {
      results[provider] = { updated: false, error: error.message, active: await getActiveProvider(provider) };
      if (PROVIDER_REGISTRY[provider].required && !results[provider].active) throw error;
    }
  }
  return results;
}

export async function providerVersions() {
  const rows = await Promise.all(Object.keys(PROVIDER_REGISTRY).map(async provider => [provider, await getActiveProvider(provider)]));
  return Object.fromEntries(rows.map(([provider, value]) => [provider, value?.dataVersion || null]));
}
