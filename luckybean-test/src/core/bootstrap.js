let scheduled = false;
let completed = false;

function scheduleCloudReconcile(reason = 'startup') {
  if (scheduled || completed) return;
  const sync = globalThis.LuckyBeanCloudSync;
  const session = globalThis.LuckyBeanCloudAuth?.getSession?.();
  if (!sync?.reconcile || !session?.user?.id) return;
  scheduled = true;
  const run = () => {
    sync.reconcile({ reason }).catch(() => {}).finally(() => {
      scheduled = false;
      completed = true;
    });
  };
  if ('requestIdleCallback' in globalThis) requestIdleCallback(run, { timeout: 1800 });
  else setTimeout(run, 350);
}

document.addEventListener('luckybean:local-app-ready', () => scheduleCloudReconcile('local-app-ready'));
document.addEventListener('luckybean:cloud-auth-state', event => {
  if (event.detail?.state === 'authenticated') scheduleCloudReconcile('auth-ready');
});
document.addEventListener('luckybean:cloud-login-success', () => {
  completed = false;
  scheduleCloudReconcile('login');
});

queueMicrotask(() => scheduleCloudReconcile('startup'));
