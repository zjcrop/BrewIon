/* Obsolete 099e compatibility stub.
 * Account and storage controls are owned by v099p-settings-rebuild.js.
 * This module intentionally performs no observation or injection.
 */
document.querySelectorAll('[data-v099e-account-actions], [data-v099e-cloud-panel], .v099e-cloud-panel').forEach(node => node.remove());
document.getElementById('v099e-cloud-style')?.remove();
globalThis.LuckyBeanAccountBridgeLegacy099eDisabled = true;
