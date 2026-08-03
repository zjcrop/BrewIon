/* Lucky Bean 099l: top-level settings accordion and data-module placement. */
if (!globalThis.__LuckyBeanV099lUiFixesLoaded) {
  globalThis.__LuckyBeanV099lUiFixesLoaded = true;
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  let rootObserver=null,observedRoot=null,queued=false;
  function topLevelCategories(root=$('#settingsContent')){return root?$$(':scope > .settings-categories > details.settings-category',root):[]}
  function closeOtherCategories(current){if(!current)return;for(const item of topLevelCategories())if(item!==current&&item.open)item.open=false}
  function bindExclusiveAccordion(){for(const item of topLevelCategories()){if(item.dataset.v099lAccordionBound==='1')continue;item.dataset.v099lAccordionBound='1';item.addEventListener('toggle',()=>{if(item.open)closeOtherCategories(item)})}}
  function dataCategoryBody(){return $('#settingsContent > .settings-categories > details.settings-category.data-category > .settings-category-body')}
  function placeDataModules(){const body=dataCategoryBody();if(!body)return;let modules=$('#v099fBeanModules');if(!modules){modules=document.createElement('section');modules.id='v099fBeanModules';modules.className='v099f-bean-modules v099l-data-modules';modules.innerHTML='<button type="button" data-v099f-preference>风味喜好数字侧写</button><button type="button" data-v099f-world>咖啡世界</button>'}modules.classList.add('v099l-data-modules');const preference=$('[data-v099f-preference]',modules),world=$('[data-v099f-world]',modules);if(preference)preference.textContent='风味喜好数字侧写';if(world)world.textContent='咖啡世界';if(modules.parentElement!==body||modules!==body.lastElementChild)body.append(modules)}
  function cleanLegacyFreshnessButtons(){$$('.popup-menu [data-v098-group-method="freshness-state"]').forEach(b=>b.remove());$$('.popup-menu button').forEach(b=>{if(b.textContent.replace(/\s*✓\s*$/,'').trim()==='按赏味期状态')b.remove()});const buttons=$$('.popup-menu [data-v099f-group-freshness],.popup-menu [data-v099i-group-freshness]');buttons.forEach((b,i)=>{if(i)b.remove();else b.textContent=`按赏味期阶段${b.textContent.includes('✓')?' ✓':''}`})}
  function renamePreferenceTitle(){const title=$('[data-overlay="v099f-preference"] h2');if(title&&title.textContent!=='风味喜好数字侧写')title.textContent='风味喜好数字侧写'}
  function sync(){queued=false;bindExclusiveAccordion();placeDataModules();cleanLegacyFreshnessButtons();renamePreferenceTitle()}
  function queueSync(){if(queued)return;queued=true;requestAnimationFrame(sync)}
  function observeSettings(){const root=$('#settingsContent');if(!root||root===observedRoot)return;rootObserver?.disconnect();observedRoot=root;rootObserver=new MutationObserver(queueSync);rootObserver.observe(root,{childList:true,subtree:true})}
  document.addEventListener('click',event=>{const summary=event.target.closest?.('#settingsContent > .settings-categories > details.settings-category > summary');if(summary)closeOtherCategories(summary.parentElement);if(event.target.closest?.('[data-v099f-preference]'))[0,80,240,600].forEach(delay=>setTimeout(renamePreferenceTitle,delay));if(event.target.closest?.('[data-page-target="settings"],#groupBtn'))setTimeout(()=>{observeSettings();queueSync()},0)},true);
  addEventListener('pageshow',()=>{observeSettings();queueSync()});observeSettings();queueSync();globalThis.LuckyBeanV099lUiFixes={sync,closeOtherCategories,placeDataModules};
}
