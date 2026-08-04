/* Obsolete 099e compatibility stub.
 * Cloud sync is owned by v099f-cloud-sync.js and v099p-settings-rebuild.js.
 * This module intentionally performs no observation or injection.
 */
document.querySelectorAll('[data-v099e-cloud-panel], .v099e-cloud-panel').forEach(node => node.remove());
document.getElementById('v099e-cloud-style')?.remove();
globalThis.LuckyBeanCloudSyncLegacy099eDisabled = true;
