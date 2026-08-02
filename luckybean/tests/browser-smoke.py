import asyncio, json, re, base64
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]

FAKE_IDB=r'''
(() => {
  const databases = new Map();
  class NameList { constructor(record){this.record=record;} contains(name){return this.record.stores.has(name);} [Symbol.iterator](){return this.record.stores.keys();} }
  function request(action){const req={result:undefined,error:null,onsuccess:null,onerror:null};setTimeout(()=>{try{req.result=action();req.onsuccess?.({target:req});}catch(e){req.error=e;req.onerror?.({target:req});}},0);return req;}
  function dbObject(record){return {objectStoreNames:new NameList(record),createObjectStore(name,options={}){record.stores.set(name,{map:new Map(),keyPath:options.keyPath||'id'});return {};},transaction(name){const tx={oncomplete:null,onerror:null,onabort:null,error:null};tx.objectStore=(storeName)=>{const store=record.stores.get(storeName);if(!store)throw new Error('store not found '+storeName);return {getAll:()=>request(()=>[...store.map.values()].map(v=>structuredClone(v))),get:(key)=>request(()=>store.map.has(key)?structuredClone(store.map.get(key)):undefined),put:(value)=>request(()=>{const key=value[store.keyPath];if(key===undefined)throw new Error('missing key');store.map.set(key,structuredClone(value));return key;}),delete:(key)=>request(()=>store.map.delete(key)),clear:()=>request(()=>{store.map.clear();})};};setTimeout(()=>tx.oncomplete?.(),20);return tx;},close(){}};}
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,writable:true,value:{open(name,version){const req={result:null,error:null,onsuccess:null,onerror:null,onupgradeneeded:null,transaction:null};setTimeout(()=>{let record=databases.get(name);const fresh=!record;if(!record){record={version:version||1,stores:new Map()};databases.set(name,record);}const tx={aborted:false,abort(){this.aborted=true;}};req.transaction=tx;req.result=dbObject(record);if(fresh)req.onupgradeneeded?.({target:req});setTimeout(()=>{if(tx.aborted){databases.delete(name);req.error=new Error('AbortError');req.onerror?.({target:req});}else req.onsuccess?.({target:req});},0);},0);return req;},deleteDatabase(name){databases.delete(name);return request(()=>undefined);}}});
})();
'''

def bundle():
    parts=[]
    order=['utils.js','db.js','codebook.js','qr.js','water-profiles.js','preference-model.js','share-codec.js','brew-model-v09.js','brew-engine.js','app.js']
    for name in order:
        text=(ROOT/'src'/name).read_text()
        text=re.sub(r'^import\s+.*?;\s*$', '', text, flags=re.M)
        text=re.sub(r'\bexport\s+', '', text)
        parts.append(f'\n/* {name} */\n{text}')
    code='\n'.join(parts)
    cb=base64.b64encode((ROOT/'public/fallback-codebook.json').read_bytes()).decode()
    lm=base64.b64encode((ROOT/'public/legacy-flavor-map.json').read_bytes()).decode()
    code=code.replace("const FALLBACK_CODEBOOK_URL = './public/fallback-codebook.json';", f"const FALLBACK_CODEBOOK_URL = 'data:application/json;base64,{cb}';")
    code=code.replace("fetch('./public/legacy-flavor-map.json')", f"fetch('data:application/json;base64,{lm}')")
    return code

async def click_backdrop(page, overlay_id):
    await page.locator(f'[data-overlay="{overlay_id}"]').evaluate("e=>e.dispatchEvent(new MouseEvent('click',{bubbles:true}))")
    await page.wait_for_timeout(50)

async def complete_sensory(page):
    seen=[]
    while await page.locator('#nextSensoryNodeBtn').count():
        heading=await page.locator('.panel-title h2').last.inner_text()
        seen.append(heading)
        if '总分' in heading:
            auto=float(await page.locator('#sensoryAutoScore').inner_text())
            subjective=max(50,auto-10)
            await page.fill('#sensoryScore',str(subjective))
            await page.locator('#nextSensoryNodeBtn').click()
            continue
        if '札记' in heading:
            await page.fill('#sensoryNaturalNote','酸尖，甜不足，尾段干涩；花香仍清晰。')
            await page.locator('#nextSensoryNodeBtn').click()
            break
        groups=page.locator('.question-group')
        count=await groups.count()
        for index in range(count):
            group=groups.nth(index)
            label=(await group.locator('h4').inner_text()) if await group.locator('h4').count() else ''
            choice=None
            if '酸' in heading and '强度' in label: choice='尖锐'
            elif '甜' in heading and '强度' in label: choice='低'
            elif '苦' in heading: choice='偏高'
            elif '口感' in heading: choice='干涩'
            elif '负面' in heading: choice='无'
            else:
                choice=await group.locator('.sensory-option').first.inner_text()
            await page.get_by_role('button',name=choice,exact=True).first.click()
            await page.wait_for_timeout(20)
        await page.locator('#nextSensoryNodeBtn').click()
    return seen

async def main():
  errors=[]; logs=[]; results={}
  async with async_playwright() as p:
    browser=await p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    context=await browser.new_context(viewport={"width":390,"height":844}, locale='zh-CN', service_workers='block', accept_downloads=True)
    page=await context.new_page(); page.set_default_timeout(8000)
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.on('console',lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error','warning') else None)
    html=(ROOT/'index.html').read_text()
    html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>','',html)
    html=re.sub(r'<link rel="(?:manifest|icon|stylesheet)"[^>]*>','',html)
    html=re.sub(r'<script type="module"[^>]*></script>','',html)
    html=html.replace('</head>',f'<style>{(ROOT/"styles.css").read_text()}</style></head>')
    await page.set_content(html,wait_until='domcontentloaded')
    await page.add_script_tag(content=FAKE_IDB)
    await page.add_script_tag(content="class QRCodeStub{constructor(box){box.innerHTML='<canvas width=220 height=220></canvas>';}};QRCodeStub.CorrectLevel={L:1};globalThis.QRCode=QRCodeStub;")
    await page.add_script_tag(content=bundle())
    await page.wait_for_timeout(800)

    await page.locator('#testBtn').click(); await page.wait_for_selector('#appShell:not(.hidden)'); await page.wait_for_timeout(300)
    results['nav']=await page.locator('.nav-button span').all_text_contents()
    results['headings']=await page.locator('.page-heading h1').all_text_contents()
    results['actions']=await page.locator('#fabWrap .fab').all_text_contents()
    results['group_cards']=await page.locator('.group-card').count()
    results['cards_before_group_open']=await page.locator('.bean-card').count()
    await page.locator('.group-card').first.click(); await page.wait_for_selector('.bean-card.compact')
    results['group_open_cards']=await page.locator('.bean-card.compact').count()
    results['compact_card']={
      'title':await page.locator('.bean-card h3').first.inner_text(),
      'process':await page.locator('.bean-card small').first.inner_text(),
      'pick':await page.locator('.compact-pick').first.inner_text(),
      'height':(await page.locator('.bean-card').first.bounding_box())['height']
    }
    results['freshness_progress']={
      'solid':await page.locator('.bean-freshness-solid').count(),
      'dashed':await page.locator('.bean-freshness-dashed').count(),
      'width':await page.locator('.bean-freshness-solid').first.get_attribute('style')
    }
    await page.locator('[data-collapse-group]').click(); results['group_collapsed']=await page.locator('.group-card').count()>0
    await page.locator('.group-card').first.click(); await page.wait_for_selector('[data-active-group-panel]')
    await page.locator('[data-active-group-panel]').evaluate("e=>e.dispatchEvent(new MouseEvent('click',{bubbles:true}))")
    await page.wait_for_timeout(550); results['group_blank_closed']=await page.locator('.group-card').count()>0
    await page.evaluate("openBeanForm({}, {type:'manual'})")
    await page.select_option('#beanCountry','CO-AU')
    region_texts=await page.locator('#beanRegion option').all_text_contents()
    results['bean_form']={'region_zh':any('阿瑟顿高原' in t for t in region_texts),'region_code_leak':any('CO-AU' in t for t in region_texts)}
    await page.locator('#editFlavorsBtn').click(); await page.wait_for_selector('[data-overlay="flavors"]')
    flavor_texts=await page.locator('[data-flavor-code]').all_text_contents()
    results['bean_form']['flavor_count']=len(flavor_texts); results['bean_form']['empty_flavors']=sum(1 for t in flavor_texts if not t.strip())
    await page.locator('#backFlavorsBtn').click(); await page.wait_for_selector('#beanForm')
    results['bean_form']['flavor_back_to_form']=await page.locator('#beanForm').count()==1
    await page.evaluate("closeOverlay()")
    await page.screenshot(path=str(ROOT/'docs/smoke-beta-beans.png'),full_page=True)

    # Search is a bottom sheet, no X, backdrop closes it.
    await page.locator('#fabSearchBtn').click(); await page.wait_for_selector('[data-overlay="bean-search"]')
    results['search']={'close_buttons':await page.locator('[data-overlay="bean-search"] [data-close-overlay]').count(),'flavors':await page.locator('[data-filter-flavor]').count(),'countries':await page.locator('#searchCountry option').count()}
    await click_backdrop(page,'bean-search'); results['search']['closed_by_blank']=await page.locator('[data-overlay="bean-search"]').count()==0

    # Recommendation directly expands the matching group and marks its target card.
    await page.locator('#fabRecommendBtn').click(); await page.locator('[data-recommend-mode="freshness"]').click()
    await page.wait_for_selector('.bean-card.recommended')
    results['recommend_focus']={'expanded':await page.locator('[data-active-group-panel]').count()==1,'marked':await page.locator('.bean-card.recommended').count()==1}

    # Bean detail retains the freshness curve/current point and blank backdrop closes it.
    await page.locator('.bean-card').first.click(); await page.wait_for_selector('[data-overlay="bean-detail"]')
    results['bean_detail']={'curve':await page.locator('.freshness-curve').count()==1,'today':await page.locator('.freshness-current-point').count()==1,'trend':('风味上升' in await page.locator('[data-overlay="bean-detail"]').inner_text()) or ('风味下降' in await page.locator('[data-overlay="bean-detail"]').inner_text())}
    await click_backdrop(page,'bean-detail'); results['bean_detail']['closed_by_blank']=await page.locator('[data-overlay="bean-detail"]').count()==0

    # Open again and route to brew. Use a known filter so consumption can verify -1 stock.
    if await page.locator('.bean-card').count()==0: await page.locator('.group-card').first.click()
    await page.locator('.bean-card').first.click(); await page.wait_for_selector('[data-overlay="bean-detail"]')
    await page.locator('#brewThisBeanBtn').click(); await page.wait_for_selector('#generatePlanBtn')
    await page.evaluate("state.settings.gear={filters:[{id:'filter_test',brand:'Cafec',type:'T-90',quantity:5,price:58}],drippers:[{id:'d1',name:'B75',type:'平底滤杯'}],grinders:'C40'}; state.settings.brew.filterPaperId='filter_test'; renderBrew();")
    await page.wait_for_selector('#brewFilterPaper')
    results['brew']={'direct_sensory':await page.locator('#directSensoryBtn').is_visible(),'rows':await page.locator('.brew-row').count(),'bean_heading':await page.locator('#brewHeadingBean select').count(),'filter_select':await page.locator('#brewFilterPaper').count(),'cooling_gold':'model-recommended' in (await page.locator('#firstCoolingMode').get_attribute('class') or '')}
    await page.locator('#generatePlanBtn').click(); await page.wait_for_selector('#generatedPlan')
    results['plan']={
      'stages':await page.locator('.plan-stage').count(),
      'trajectory':await page.locator('.trajectory-chart.detailed').count(),
      'trajectory_paths':await page.locator('.trajectory-series').count(),
      'trajectory_windows':await page.locator('.trajectory-window').count(),
      'trajectory_toggle':await page.locator('#trajectoryDefaultToggle').is_checked(),
      'professional_hidden':not await page.locator('.professional-result .details-content').is_visible(),
      'export':await page.locator('#exportPlanBtn').count(),
      'method_codes':await page.locator('.plan-stage small').count(),
      'water_text':'Ca ' in await page.locator('#generatedPlan').inner_text()
    }
    await page.screenshot(path=str(ROOT/'docs/smoke-beta-brew.png'),full_page=True)

    # Timer four controls and terminal path.
    await page.locator('#startBrewBtn').click(); await page.wait_for_selector('#timerEndBtn')
    results['timer_labels']=await page.locator('.timer-actions button').all_text_contents()
    await page.locator('#timerPauseBtn').click(); clock1=await page.locator('#timerClock').inner_text(); await page.wait_for_timeout(1100); clock2=await page.locator('#timerClock').inner_text()
    results['timer_pause']=clock1==clock2
    await page.locator('#timerEndBtn').click(); await page.wait_for_selector('#recordConsumptionBtn')
    results['consume']={'title':await page.locator('.consume-confirm h2').inner_text(),'dose':await page.locator('.consume-dose').inner_text(),'record':await page.locator('#recordConsumptionBtn').inner_text(),'skip':await page.locator('#skipConsumptionBtn').inner_text()}
    await page.locator('#recordConsumptionBtn').click(); await page.wait_for_selector('#nextSensoryNodeBtn')
    results['consume']['filter_after']=await page.evaluate("state.settings.gear.filters.find(item=>item.id==='filter_test').quantity")

    # Full sensory path, score comparison, natural-language note, correction plan.
    sensory_nodes=await complete_sensory(page); await page.wait_for_selector('[data-overlay="bean-detail"]')
    detail_text=await page.locator('[data-overlay="bean-detail"]').inner_text()
    results['sensory']={'nodes':sensory_nodes,'correction':'修' in detail_text,'note':'酸尖' in detail_text}
    await page.locator('[data-close-overlay]').click();
    results['recommended_badges']=await page.locator('.compact-score em').count()
    results['leaderboard']=await page.locator('[data-open-recommend-board]').count()

    # Replay the corrected session.
    if await page.locator('.group-card').count(): await page.locator('.group-card').first.click()
    await page.locator('.bean-card').first.click(); await page.wait_for_selector('[data-overlay="bean-detail"]')
    corrected=page.locator('[data-replay-session]').filter(has_text='修')
    results['replay_corrected']=await corrected.count()>0
    if await corrected.count():
      await corrected.first.click(); await page.wait_for_selector('#generatedPlan'); results['replay_loaded']='修正' in await page.locator('#generatedPlan').inner_text()

    # Share codec includes compact LB8 link and brew/sensory data.
    if await page.locator('[data-overlay="bean-detail"]').count()==0:
      await page.locator('[data-page-target="beans"]').click();
      if await page.locator('.group-card').count(): await page.locator('.group-card').first.click()
      await page.locator('.bean-card').first.click()
    await page.locator('#shareBeanBtn').click(); await page.wait_for_selector('#shareLinkTab'); await page.locator('#shareLinkTab').click()
    share_text=await page.locator('#shareLinkPanel').inner_text()
    results['share']={'compact':'LB8' in share_text,'records':'冲煮' in await page.locator('[data-overlay="share"]').inner_text()}
    await page.locator('[data-close-overlay]').click()

    # History is a non-full bottom sheet with full-row return.
    await page.locator('[data-page-target="beans"]').click(); await page.locator('#fabHistoryBtn').click(); await page.wait_for_selector('[data-overlay="history"]')
    box=await page.locator('[data-overlay="history"] .dialog').bounding_box()
    results['history']={'not_full':await page.locator('[data-overlay="history"].full').count()==0,'bottom':bool(box and box['y']+box['height']>=830),'return':await page.locator('.bottom-return').inner_text()}
    await page.locator('.bottom-return').click()

    # Low-stock filter paper marks the bottom nav and auto-opens the private gear section.
    await page.evaluate("updateLowStockIndicator(); switchPage('settings')")
    await page.wait_for_selector('#privateGearCategory[open]')
    results['gear']={'star':await page.locator('.nav-button [aria-label="滤纸库存低"]').count(),'low':await page.locator('[data-filter-item="filter_test"].low-stock').count(),'open':await page.locator('#privateGearCategory').get_attribute('open') is not None}
    await page.locator('.settings-category').first.locator('summary').click(); await page.wait_for_timeout(80)
    results['gear']['single_open']=await page.locator('#privateGearCategory').get_attribute('open') is None

    await browser.close()

  checks={
    'nav':results.get('nav')==['藏','拾','鉴','器'],
    'headings':results.get('headings')==['豆藏','拾味','品鉴','器设'],
    'action_grid':results.get('actions')==['寻','添','撷','择'],
    'groups':results.get('group_cards',0)>0 and results.get('cards_before_group_open')==0 and results.get('group_open_cards',0)>0 and results.get('group_collapsed') and results.get('group_blank_closed'),
    'compact_card':results.get('compact_card',{}).get('pick')=='拾' and results.get('compact_card',{}).get('height',999)<110 and results.get('freshness_progress',{}).get('solid',0)>0 and results.get('freshness_progress',{}).get('dashed',0)>0 and results.get('bean_detail',{}).get('curve') and results.get('bean_detail',{}).get('today') and results.get('bean_detail',{}).get('trend') and results.get('bean_detail',{}).get('closed_by_blank'),
    'bean_form':results.get('bean_form',{}).get('region_zh') and not results.get('bean_form',{}).get('region_code_leak') and results.get('bean_form',{}).get('flavor_count',0)>100 and results.get('bean_form',{}).get('empty_flavors')==0 and results.get('bean_form',{}).get('flavor_back_to_form'),
    'search':results.get('search',{}).get('close_buttons')==0 and results.get('search',{}).get('closed_by_blank') and results.get('search',{}).get('flavors',0)>0,
    'brew':results.get('brew',{}).get('direct_sensory') and results.get('brew',{}).get('rows')==4 and results.get('brew',{}).get('bean_heading')==1 and results.get('brew',{}).get('filter_select')==1 and results.get('brew',{}).get('cooling_gold'),
    'plan':results.get('plan',{}).get('stages',0)>=4 and results.get('plan',{}).get('trajectory')==1 and results.get('plan',{}).get('trajectory_paths',0)>=7 and results.get('plan',{}).get('trajectory_windows',0)>=4 and results.get('plan',{}).get('trajectory_toggle') and results.get('plan',{}).get('professional_hidden') and results.get('plan',{}).get('export')==1 and results.get('plan',{}).get('method_codes',0)>=4,
    'timer':results.get('timer_labels')==['退','驻','进','终'] and results.get('timer_pause'),
    'consume':results.get('consume',{}).get('record')=='扣除克重进入品鉴' and results.get('consume',{}).get('skip')=='不记录则返回拾味' and results.get('consume',{}).get('filter_after')==4,
    'sensory':any('总分' in node for node in results.get('sensory',{}).get('nodes',[])) and any('札记' in node for node in results.get('sensory',{}).get('nodes',[])) and results.get('sensory',{}).get('correction') and results.get('sensory',{}).get('note'),
    'recommend':results.get('recommended_badges',0)>0 and results.get('leaderboard',0)>0 and results.get('recommend_focus',{}).get('expanded') and results.get('recommend_focus',{}).get('marked'),
    'replay':results.get('replay_corrected') and results.get('replay_loaded'),
    'share':results.get('share',{}).get('compact') and results.get('share',{}).get('records'),
    'gear':results.get('gear',{}).get('star')==1 and results.get('gear',{}).get('low')==1 and results.get('gear',{}).get('open') and results.get('gear',{}).get('single_open'),
    'history':results.get('history',{}).get('not_full') and results.get('history',{}).get('bottom') and results.get('history',{}).get('return')=='退'
  }
  output={'results':results,'checks':checks,'page_errors':errors,'console':logs}
  (ROOT/'docs/browser-smoke-result.json').write_text(json.dumps(output,ensure_ascii=False,indent=2))
  print(json.dumps(output,ensure_ascii=False,indent=2))
  if errors or any(line.startswith('error:') for line in logs) or not all(checks.values()): raise SystemExit(1)

asyncio.run(main())
