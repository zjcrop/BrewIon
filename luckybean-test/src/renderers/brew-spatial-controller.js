import { brewSpatialView } from './brew-spatial-view.js';

function sceneFromPlan(plan) {
  return plan?.visualization3d
    || (plan?.trajectory?.schemaVersion === 'brew-spatial/1.1' ? plan.trajectory : null)
    || plan?.analysisSnapshot?.trajectory
    || null;
}

async function mount(plan) {
  const scene = sceneFromPlan(plan);
  if (!scene) return;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const host = document.querySelector('#planResult #generatedPlan')
    || document.querySelector('#planResult')
    || document.querySelector('#brewContent');
  if (!host) return;
  brewSpatialView.mountPreview(host, scene);
}

document.addEventListener('luckybean:plan-ready', event => mount(event.detail?.plan));
document.addEventListener('luckybean:history-plan-loaded', event => mount(event.detail?.plan));
document.addEventListener('luckybean:open-spatial-scene', event => {
  if (brewSpatialView.setScene(event.detail?.scene)) brewSpatialView.open();
});

globalThis.LuckyBeanSpatial = {
  revision: 'brew-spatial-view/1.0.0',
  mount,
  open(scene) { if (brewSpatialView.setScene(scene)) brewSpatialView.open(); },
  close() { brewSpatialView.close(); }
};
