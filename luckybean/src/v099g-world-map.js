import { all } from './db.js';
import { loadCodebook, makeIndex, displayName } from './codebook.js';

if (!globalThis.__LuckyBeanV099gWorldMapLoaded) {
  globalThis.__LuckyBeanV099gWorldMapLoaded = true;

  const CORE_URL = 'https://cdn.jsdelivr.net/npm/jsvectormap@1.7.0/dist/jsvectormap.min.js';
  const MAP_URL = 'https://cdn.jsdelivr.net/npm/jsvectormap@1.7.0/dist/maps/world.js';
  const CSS_URL = 'https://cdn.jsdelivr.net/npm/jsvectormap@1.7.0/dist/jsvectormap.min.css';
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>\"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let loaderPromise = null;
  let activeMap = null;
  let codebookPromise = null;

  const COUNTRY_ALIASES = Object.freeze([
    ['ET', ['埃塞俄比亚','埃塞','Ethiopia']], ['KE', ['肯尼亚','Kenya']], ['RW', ['卢旺达','Rwanda']], ['BI', ['布隆迪','Burundi']],
    ['TZ', ['坦桑尼亚','Tanzania']], ['UG', ['乌干达','Uganda']], ['CD', ['刚果民主共和国','刚果金','DR Congo']], ['CM', ['喀麦隆','Cameroon']],
    ['CI', ['科特迪瓦','Ivory Coast']], ['BR', ['巴西','Brazil']], ['CO', ['哥伦比亚','Colombia']], ['PE', ['秘鲁','Peru']],
    ['EC', ['厄瓜多尔','Ecuador']], ['BO', ['玻利维亚','Bolivia']], ['VE', ['委内瑞拉','Venezuela']], ['GT', ['危地马拉','Guatemala']],
    ['HN', ['洪都拉斯','Honduras']], ['SV', ['萨尔瓦多','El Salvador']], ['CR', ['哥斯达黎加','Costa Rica']], ['PA', ['巴拿马','Panama']],
    ['NI', ['尼加拉瓜','Nicaragua']], ['MX', ['墨西哥','Mexico']], ['JM', ['牙买加','Jamaica']], ['DO', ['多米尼加','Dominican Republic']],
    ['ID', ['印度尼西亚','印尼','Indonesia']], ['VN', ['越南','Vietnam']], ['CN', ['中国','China']], ['IN', ['印度','India']],
    ['TH', ['泰国','Thailand']], ['LA', ['老挝','Laos']], ['MM', ['缅甸','Myanmar']], ['PH', ['菲律宾','Philippines']],
    ['PG', ['巴布亚新几内亚','Papua New Guinea']], ['YE', ['也门','Yemen']], ['SA', ['沙特阿拉伯','Saudi Arabia']],
    ['AU', ['澳大利亚','Australia']], ['US', ['美国','United States']], ['PR', ['波多黎各','Puerto Rico']], ['CU', ['古巴','Cuba']]
  ]);

  function loadScript(src, id) {
    const existing = document.getElementById(id);
    if (existing?.dataset.loaded === '1') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = existing || document.createElement('script');
      script.id = id;
      script.src = src;
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      script.onload = () => { script.dataset.loaded = '1'; resolve(); };
      script.onerror = () => reject(new Error(`地图资源加载失败：${src.split('/').at(-1)}`));
      if (!existing) document.head.append(script);
    });
  }

  async function ensureLibrary() {
    if (typeof globalThis.jsVectorMap === 'function') return globalThis.jsVectorMap;
    if (loaderPromise) return loaderPromise;
    loaderPromise = (async () => {
      if (!$('#v099gVectorMapCss')) {
        const link = document.createElement('link');
        link.id = 'v099gVectorMapCss';
        link.rel = 'stylesheet';
        link.href = CSS_URL;
        link.crossOrigin = 'anonymous';
        document.head.append(link);
      }
      await loadScript(CORE_URL, 'v099gVectorMapCore');
      await loadScript(MAP_URL, 'v099gVectorMapWorld');
      if (typeof globalThis.jsVectorMap !== 'function') throw new Error('世界地图组件没有正确初始化');
      return globalThis.jsVectorMap;
    })().catch(error => { loaderPromise = null; throw error; });
    return loaderPromise;
  }

  async function codebookContext() {
    if (!codebookPromise) codebookPromise = loadCodebook().then(result => ({ index: makeIndex(result.data) }));
    return codebookPromise;
  }

  function resolveIso(code, name) {
    const normalizedCode = String(code || '').toUpperCase();
    if (/^[A-Z]{2}$/.test(normalizedCode)) return normalizedCode;
    const suffix = normalizedCode.match(/(?:^|[-_])([A-Z]{2})$/)?.[1];
    if (suffix && COUNTRY_ALIASES.some(([iso]) => iso === suffix)) return suffix;
    const text = String(name || '').toLowerCase();
    return COUNTRY_ALIASES.find(([, aliases]) => aliases.some(alias => text.includes(alias.toLowerCase())))?.[0] || '';
  }

  function levelFor(count) {
    if (count >= 20) return 5;
    if (count >= 11) return 4;
    if (count >= 6) return 3;
    if (count >= 3) return 2;
    return count > 0 ? 1 : 0;
  }

  async function buildStats() {
    const [{ index }, beans, brews] = await Promise.all([codebookContext(), all('beans'), all('brewSessions')]);
    const beanMap = new Map(beans.map(bean => [bean.id, bean]));
    const stats = new Map();
    const add = bean => {
      if (!bean?.countryCode) return;
      const name = displayName(index, 'countries', bean.countryCode, bean.countryCode || '未记录国家');
      const iso = resolveIso(bean.countryCode, name);
      if (!iso) return;
      const current = stats.get(iso) || { iso, name, count: 0 };
      current.count += 1;
      current.name = name || current.name;
      stats.set(iso, current);
    };
    beans.filter(bean => !bean.archived).forEach(add);
    brews.forEach(brew => add(beanMap.get(brew.beanId)));
    return [...stats.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  }

  function rankingHtml(stats) {
    return stats.length ? stats.map((item, index) => `<div><b>${index + 1}</b><span>${esc(item.name)}</span><strong>${item.count}次</strong></div>`).join('') : '<p class="muted">尚无豆卡或冲煮记录</p>';
  }

  async function openWorldPage() {
    const overlay = $('#overlayRoot');
    if (!overlay) return;
    activeMap?.destroy?.();
    activeMap = null;
    overlay.innerHTML = `<div class="overlay full v099f-world-overlay v099g-world-overlay" data-overlay="v099g-world"><div class="dialog v099f-world-dialog v099g-world-dialog">
      <div class="dialog-header"><div><h2>咖啡世界</h2><p>白色为尚未记录；拥有或喝过的国家按次数显示五级灰度。</p></div><button class="close-button" type="button" data-v099g-close>×</button></div>
      <div class="v099f-map-toolbar"><span>双指缩放 · 单指拖动 · 滚轮缩放</span><button class="button subtle" type="button" data-v099g-reset>复位</button></div>
      <div id="v099gWorldMap" class="v099g-world-map" role="img" aria-label="咖啡世界国家热度地图"><div class="v099g-map-loading">正在加载世界地图…</div></div>
      <div class="v099g-map-legend"><span><i data-level="0"></i>未记录</span><span><i data-level="1"></i>1–2次</span><span><i data-level="2"></i>3–5次</span><span><i data-level="3"></i>6–10次</span><span><i data-level="4"></i>11–19次</span><span><i data-level="5"></i>20次以上</span></div>
      <div class="v099f-world-ranking"><h3>国家热度</h3><div data-v099g-ranking><p class="muted">正在统计…</p></div></div>
    </div></div>`;

    const close = () => {
      activeMap?.destroy?.();
      activeMap = null;
      overlay.innerHTML = '';
    };
    $('[data-v099g-close]', overlay)?.addEventListener('click', close);

    try {
      const [MapCtor, stats] = await Promise.all([ensureLibrary(), buildStats()]);
      if (!$('#v099gWorldMap', overlay)) return;
      $('[data-v099g-ranking]', overlay).innerHTML = rankingHtml(stats);
      const values = Object.fromEntries(stats.map(item => [item.iso, levelFor(item.count)]).filter(([, level]) => level > 0));
      const labels = new Map(stats.map(item => [item.iso, item]));
      activeMap = new MapCtor({
        selector: '#v099gWorldMap',
        map: 'world',
        backgroundColor: '#dce7ef',
        zoomButtons: true,
        zoomOnScroll: true,
        panOnDrag: true,
        regionsSelectable: false,
        regionStyle: {
          initial: { fill: '#ffffff', stroke: '#8396a3', strokeWidth: 0.55, fillOpacity: 1 },
          hover: { fill: '#eef2f4', cursor: 'pointer' },
          selected: { fill: '#555555' }
        },
        series: {
          regions: [{
            attribute: 'fill',
            values,
            scale: ['#e2e2e2', '#bebebe', '#969696', '#676767', '#2d2d2d'],
            min: 1,
            max: 5,
            normalizeFunction: 'polynomial'
          }]
        },
        onRegionTooltipShow(event, tooltip, code) {
          const item = labels.get(code);
          if (item) tooltip.text(`${item.name} · ${item.count}次`);
        }
      });
      $('[data-v099g-reset]', overlay)?.addEventListener('click', () => activeMap?.reset?.());
    } catch (error) {
      const host = $('#v099gWorldMap', overlay);
      if (host) host.innerHTML = `<div class="v099g-map-error"><strong>世界地图加载失败</strong><p>${esc(error.message)}</p><button class="button" type="button" data-v099g-retry>重试</button></div>`;
      $('[data-v099g-retry]', overlay)?.addEventListener('click', openWorldPage);
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-v099f-world]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openWorldPage();
  }, true);

  globalThis.LuckyBeanWorldMapV099g = { open: openWorldPage };
}
