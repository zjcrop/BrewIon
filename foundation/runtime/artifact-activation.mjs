export const FOUNDATION_CANDIDATE_CONTRACT = 'coffee-foundation-candidate/1.0';

const SHA256 = /^[a-f0-9]{64}$/i;

function utf8Bytes(value) {
  return new TextEncoder().encode(String(value));
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function contractMajor(contract) {
  const match = /\/(\d+)(?:\.|$)/.exec(String(contract || ''));
  if (!match) throw new Error(`Invalid contract: ${contract}`);
  return Number(match[1]);
}

export function contractFamily(contract) {
  const value = String(contract || '');
  const slash = value.lastIndexOf('/');
  if (slash <= 0) throw new Error(`Invalid contract: ${contract}`);
  return value.slice(0, slash);
}

export function assertCompatibleContract(supported, incoming) {
  if (contractFamily(supported) !== contractFamily(incoming) || contractMajor(supported) !== contractMajor(incoming)) {
    throw new Error(`Incompatible contract: supported ${supported}, received ${incoming}`);
  }
  return true;
}

export async function sha256Text(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  return hex(await globalThis.crypto.subtle.digest('SHA-256', utf8Bytes(value)));
}

export async function verifyArtifactText(text, descriptor) {
  if (!descriptor || !SHA256.test(String(descriptor.sha256 || ''))) throw new Error('Artifact descriptor has no valid SHA-256');
  const bytes = utf8Bytes(text).byteLength;
  if (bytes !== descriptor.bytes) throw new Error(`Artifact byte mismatch: expected ${descriptor.bytes}, got ${bytes}`);
  const digest = await sha256Text(text);
  if (digest !== descriptor.sha256) throw new Error(`Artifact SHA-256 mismatch: expected ${descriptor.sha256}, got ${digest}`);
  return { bytes, sha256: digest };
}

export async function verifyFoundationCandidate(candidate, { supportedMajor = 1, loadArtifact } = {}) {
  if (candidate?.schemaVersion !== FOUNDATION_CANDIDATE_CONTRACT) throw new Error('Unsupported foundation candidate envelope');
  assertCompatibleContract(`coffee-foundation/${supportedMajor}.0`, candidate.contract);
  if (typeof loadArtifact !== 'function') throw new TypeError('loadArtifact must be a function');
  if (!String(candidate.releaseId || '').trim()) throw new Error('Foundation candidate has no releaseId');
  if (!Array.isArray(candidate.artifacts)) throw new Error('Foundation candidate artifacts must be an array');
  const verified = [];
  const kinds = new Set();
  for (const descriptor of candidate.artifacts || []) {
    if (!String(descriptor?.kind || '').trim()) throw new Error('Foundation artifact has no kind');
    if (kinds.has(descriptor.kind)) throw new Error(`Duplicate foundation artifact kind: ${descriptor.kind}`);
    kinds.add(descriptor.kind);
    const text = await loadArtifact(descriptor);
    const integrity = await verifyArtifactText(text, descriptor);
    if (descriptor.mediaType === 'application/json') {
      try { JSON.parse(text); } catch { throw new Error(`Foundation JSON artifact is invalid: ${descriptor.kind}`); }
    }
    verified.push({ ...descriptor, ...integrity, text });
  }
  if (!verified.length) throw new Error('Foundation candidate contains no artifacts');
  return {
    schemaVersion: FOUNDATION_CANDIDATE_CONTRACT,
    contract: candidate.contract,
    releaseId: candidate.releaseId,
    verifiedAt: new Date().toISOString(),
    artifacts: verified
  };
}

export function createAtomicFoundationActivator(storage) {
  for (const method of ['readActive', 'stage', 'activate', 'discard']) {
    if (typeof storage?.[method] !== 'function') throw new TypeError(`storage.${method} must be a function`);
  }
  return Object.freeze({
    async active() {
      return storage.readActive();
    },
    async install(candidate, options) {
      const previous = await storage.readActive();
      let staged = null;
      try {
        staged = await verifyFoundationCandidate(candidate, options);
        await storage.stage(staged);
        await storage.activate(staged.releaseId);
        return { ok: true, releaseId: staged.releaseId, previousReleaseId: previous?.releaseId || null };
      } catch (error) {
        if (staged?.releaseId) await storage.discard(staged.releaseId);
        return {
          ok: false,
          retainedReleaseId: previous?.releaseId || null,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  });
}
