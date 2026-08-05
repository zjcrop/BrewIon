const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const RESEARCHED_PROFILES = [
  ['four-six-33666', '46法改进版（33666）'],
  ['hoffmann-one-cup', 'Hoffmann 单杯五段法'],
  ['april-two-pour', 'April 平底两段法'],
  ['matt-winton-five', 'Matt Winton 五次等量法'],
  ['lance-daily-two', 'Lance 日常两段法'],
  ['switch-hybrid-50-50', 'Switch 50/50 混合法'],
  ['mugen-one-pour', 'Kasuya Mugen 一刀流'],
  ['onyx-center-spiral', 'Onyx 中心—绕圈法']
];

function ensureProfileOptions() {
  const select = $('#brewProfile');
  if (!select) return;
  for (const [value, label] of RESEARCHED_PROFILES) {
    if ([...select.options].some(option => option.value === value)) continue;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}

function renameProfessionalContent() {
  $$('details.professional-result > summary').forEach(summary => {
    const next = '深入解读';
    if (summary.textContent.trim() !== next) summary.textContent = next;
  });
}

function markRecommendationRun(event) {
  if (!event.target.closest?.('#fabRecommendBtn,[data-recommend-mode]')) return;
  const container = $('#beanGroups');
  if (!container) return;
  container.dataset.v099NativeRecommendation = '1';
  container.dataset.v098Signature = '';
  const before = localStorage.getItem('luckybean.selected.bean.v098') || '';
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const selected = $('.bean-card.recommended[data-bean-id]', container);
    if (selected?.dataset.beanId && selected.dataset.beanId !== before) {
      localStorage.setItem('luckybean.selected.bean.v098', selected.dataset.beanId);
      $$('.bean-card.v098-selected', container).forEach(card => card.classList.toggle('v098-selected', card === selected));
      selected.classList.add('v098-selected');
      clearInterval(timer);
      setTimeout(() => delete container.dataset.v099NativeRecommendation, 900);
      return;
    }
    if (attempts >= 30) {
      clearInterval(timer);
      delete container.dataset.v099NativeRecommendation;
    }
  }, 100);
}

function sync() {
  ensureProfileOptions();
  renameProfessionalContent();
}

document.addEventListener('click', markRecommendationRun, true);
document.addEventListener('DOMContentLoaded', sync, { once: true });
let queued = false;
{
  const runtimeObserver1 = new MutationObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    sync();
  });
});
  ["#brewContent","#overlayRoot"].forEach(selector => {
    const root = document.querySelector(selector);
    if (root) runtimeObserver1.observe(root, { childList: true, subtree: true });
  });
}
sync();

globalThis.LuckyBeanV099Runtime = { ensureProfileOptions, renameProfessionalContent };
