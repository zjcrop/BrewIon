import { getSetting, setSetting } from './db.js';

if (!globalThis.__LuckyBeanV099iMigrationsLoaded) {
  globalThis.__LuckyBeanV099iMigrationsLoaded = true;
  (async () => {
    const GROUP_KEY = 'luckybean.group.method.v098';
    if (localStorage.getItem(GROUP_KEY) === 'freshness-state') localStorage.setItem(GROUP_KEY, 'roast');

    const [current, legacy] = await Promise.all([
      getSetting('v099i.group.mode', ''),
      getSetting('v099f.group.mode', 'native')
    ]);
    if (!current && legacy === 'freshness') {
      await Promise.all([
        setSetting('v099i.group.mode', 'freshness-ratio'),
        setSetting('v099f.group.mode', 'native')
      ]);
    }
  })().catch(() => {});
}
