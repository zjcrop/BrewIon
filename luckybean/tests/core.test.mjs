import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateCodebook, makeIndex, parseNaturalLanguage, mergeCodebooks, displayName } from '../src/codebook.js';
import { computeFallbackPlan, validatePlan, buildCorrectedPlan, listBrewProfiles } from '../src/brew-engine.js';
import { calculateWaterRecipe, inferWaterProfile, listWaterProfiles } from '../src/water-profiles.js';
import { computeAutomaticScore, sensoryPreferenceTags, buildPreferenceModel, recommendedBeanIds } from '../src/preference-model.js';
import { buildCompactSharePayload, encodeSharePayload, decodeSharePayload } from '../src/share-codec.js';
import { decodeBrewIonBytes } from '../src/qr.js';
import { freshnessProfile } from '../src/utils.js';

const root = new URL('../', import.meta.url);
async function text(path) { return readFile(new URL(path, root), 'utf8'); }

const sampleInput = {
  schemaVersion: 2,
  bean: { countryCode: 'CO-PA', varietyCode: 'VA-GE', processCode: 'PR-WA', roastCode: 'RL-L1', roastColor: 82, roastDate: '2026-07-20' },
  brew: { method: 'pourover', doseG: 15, ratio: 15.5, profileId: 'recommended', segments: 3, lowTempFirst: true, dripperCode: '平底滤杯', grinder: 'C40' },
  water: { profileId: 'geisha', recipeVolumeL: 5, tdsMgL: 85 },
  targets: { floral: 2.5, acidity: 2, sweetness: 2, body: 1, bitterness: 2 }
};

test('BrewIon 回退编码表结构完整且编码唯一', async () => {
  const book = JSON.parse(await text('public/fallback-codebook.json'));
  validateCodebook(book);
  assert.equal(book._format, 'coffee-qr-codebook');
  assert.equal(book._schemaVersion, 1);
  assert.ok(book.countries.length >= 50);
  assert.ok(book.regions.length >= 200);
  assert.ok(book.entities.length >= 400);
  assert.ok(book.varieties.length >= 50);
  assert.ok(book.processes.length >= 20);
  assert.ok(book.flavors.length >= 120);
  assert.equal(book.flavors.some(row => String(row[0]).startsWith('FL-')), false);
  const index = makeIndex(book);
  assert.equal(index.countries.size, book.countries.length);
  assert.equal(index.flavors.size, book.flavors.length);
});

test('Beta 冲煮引擎输出完整协议、守恒和专业模型', async () => {
  const plan = await computeFallbackPlan(sampleInput);
  validatePlan(plan);
  assert.equal(plan.schemaVersion, 2);
  assert.equal(plan.totals.waterG, Math.round(15 * 15.5));
  assert.equal(plan.stages.at(-1).cumulativeWaterG, plan.totals.waterG);
  assert.equal(plan.stages.reduce((sum, stage) => sum + stage.stageWaterG, 0), plan.totals.waterG);
  assert.ok(plan.stages.every(stage => /^\d{2}$/.test(stage.methodCode)));
  assert.ok(plan.stages.every(stage => stage.temperatureC >= 80 && stage.temperatureC <= 97));
  assert.ok(plan.engineVersion.includes('0.9.0-beta'));
  assert.ok(plan.trajectoryModel?.points?.length >= 40);
  assert.ok(plan.trajectoryModel?.windows?.length >= 4);
  assert.ok(plan.extractionModel?.targetEY >= 18);
  assert.ok(plan.temperature?.model?.sensitivityText);
  assert.ok(plan.stages.every(stage => stage.advanceSpeech && stage.notice));
  assert.ok(plan.profile?.id);
  assert.ok(plan.recommendation?.candidates?.length >= 3);
  assert.ok(plan.trajectory.length === plan.stages.length);
  assert.ok(plan.professional?.hydraulics);
  assert.ok(plan.water?.doses?.length === 4);
  assert.ok(plan.grinder?.recommended !== undefined);
});

test('冲煮方案库覆盖旧版主要方案类型', () => {
  const ids = new Set(listBrewProfiles().map(profile => profile.id));
  for (const id of ['one-pour','two-pulse','three-pulse','four-six-v17','flat46-clean','five-pulse','pulse-30x15']) assert.ok(ids.has(id), id);
});

test('调水模块对标 Brew-Water-Calibrato 咖啡参数', () => {
  assert.ok(listWaterProfiles().length >= 10);
  assert.equal(inferWaterProfile(sampleInput.bean), 'geisha');
  const recipe = calculateWaterRecipe('geisha', { volumeL: 5, targets: sampleInput.targets });
  assert.equal(recipe.volumeL, 5);
  assert.ok(recipe.profile.ca >= 4 && recipe.profile.ca <= 18);
  assert.ok(recipe.profile.mg >= 5 && recipe.profile.mg <= 22);
  assert.ok(recipe.profile.hco3 >= 10 && recipe.profile.hco3 <= 48);
  assert.equal(recipe.doses.length, 4);
  assert.match(recipe.warning, /pH不能由TDS|pH不能由/);
});

test('低分品鉴可生成问题定向修正方案', async () => {
  const original = await computeFallbackPlan(sampleInput);
  original.id = 'brew_1';
  const sensory = {
    id: 'sensory_1', brewSessionId: 'brew_1', autoScore: 86, subjectiveScore: 74,
    naturalNote: '酸尖，甜不足，尾段略干涩',
    answers: {
      acid: { 0: ['柑橘'], 1: ['尖锐'] },
      bitter: { 0: ['偏高'] }, sweet: { 0: ['蜂蜜'], 1: ['低'] },
      mouthfeel: { 0: ['干涩'] }, negative: { 0: ['无'] }
    }
  };
  const corrected = await buildCorrectedPlan(sampleInput, sensory, original);
  validatePlan(corrected);
  assert.equal(corrected.correction.sourcePlanId, 'brew_1');
  assert.equal(corrected.correction.issues.overAcid, true);
  assert.equal(corrected.correction.issues.lowSweet, true);
  assert.equal(corrected.correction.issues.dry, true);
  assert.ok(corrected.correction.changes.length >= 2);
  assert.ok(corrected.input);
});

test('自动得分、主观分差和偏好标签可累计', () => {
  const answers = { floral:{0:['茉莉']}, fruit:{0:['莓果']}, other:{0:['茶感']}, sweet:{0:['蜂蜜'],1:['高']}, acid:{0:['柑橘'],1:['圆润舒适']}, bitter:{0:['低']}, mouthfeel:{0:['顺滑']}, negative:{0:['无']} };
  const auto = computeAutomaticScore(answers);
  assert.ok(auto > 80 && auto <= 96);
  const bean = { id:'b1', countryCode:'CO-PA', varietyCode:'VA-GE', processCode:'PR-WA', roastCode:'RL-L1', flavorCodes:['FV-100'] };
  const record = { beanId:'b1', answers, autoScore:auto, subjectiveScore:auto+3, scoreDelta:3 };
  const tags = sensoryPreferenceTags(record, bean);
  assert.ok(tags.includes('flavor:FV-100'));
  assert.ok(tags.includes('floral:茉莉'));
  const model = buildPreferenceModel([bean], [{...record, preferenceTags:tags}]);
  assert.ok(model.beanStats.get('b1').preferenceScore > 0);
  assert.deepEqual([...recommendedBeanIds([bean], [record])], ['b1']);
});

test('压缩分享包含 BrewIon 字段、冲煮记录与品鉴记录', async () => {
  const plan = await computeFallbackPlan(sampleInput); plan.id='brew_1'; plan.beanId='b1'; plan.createdAt='2026-07-28T00:00:00Z';
  const sensory = { id:'s1', beanId:'b1', brewSessionId:'brew_1', createdAt:'2026-07-28T00:00:00Z', autoScore:84, subjectiveScore:87, scoreDelta:3, answers:{floral:{0:['茉莉']}}, summary:['花香:茉莉'], naturalNote:'花香清晰' };
  const compact = buildCompactSharePayload({ appVersion:'0.8.0-beta', user:{publicId:'LB-X',nickname:'测试'}, bean:{id:'b1',...sampleInput.bean,flavorCodes:['FV-100']}, brewSessions:[plan], sensoryRecords:[sensory], names:{displayName:'巴拿马 · 瑰夏'} });
  const encoded = await encodeSharePayload(compact);
  assert.match(encoded, /^LB8[RDGJ]\./);
  const decoded = await decodeSharePayload(encoded);
  assert.equal(decoded.bean.countryCode, 'CO-PA');
  assert.equal(decoded.bean.varietyCode, 'VA-GE');
  assert.equal(decoded.brewSessions.length, 1);
  assert.equal(decoded.sensoryRecords.length, 1);
  assert.equal(decoded.brewSessions[0].stages.reduce((sum, stage)=>sum+stage.stageWaterG,0), plan.totals.waterG);
  assert.equal(decoded.sensoryRecords[0].naturalNote, '花香清晰');
});

test('导航、田字快捷区和双字题注严格对应', async () => {
  const html = await text('index.html');
  for (const term of ['>藏<','>酌<','>鉴<','>器<','>豆藏<','>小酌<','>品鉴<','>器设<','>搜索<','>添丁<','>溯旧<','>选择<']) assert.ok(html.includes(term), `缺少 ${term}`);
  for (const label of ['豆藏：咖啡豆管理','小酌：冲煮制作','品鉴：感官评价','器设：设备与系统设置']) assert.ok(html.includes(label));
  assert.ok(html.includes('action-grid'));
});

test('HTML 不含重复 ID 或内联事件处理器', async () => {
  const html = await text('index.html');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = ids.filter((id,index)=>ids.indexOf(id)!==index);
  assert.deepEqual(duplicates, []);
  assert.equal(/\son[a-z]+\s*=/i.test(html), false);
});

test('应用代码保持单一初始化和主渲染函数', async () => {
  const app = await text('src/app.js');
  for (const fn of ['init','renderBeans','detailBean','renderBrew','saveEvaluation']) assert.equal((app.match(new RegExp(`function ${fn}\\s*\\(`,'g'))||[]).length,1,fn);
  assert.ok(app.includes('duration: 800'));
  assert.ok(app.includes("state.groupAnimationMode = automatic ? 'auto' : 'manual'"));
  assert.equal(app.includes('id="beanRemainingWeight"'), false);
});

test('私有仓库凭据和私有 GitHub API 不进入前端', async () => {
  const files=['index.html','src/app.js','src/brew-engine.js','src/codebook.js','src/qr.js','src/share-codec.js'];
  const combined=(await Promise.all(files.map(text))).join('\n');
  assert.equal(/github_pat_|ghp_[A-Za-z0-9]{20,}|GITHUB_TOKEN\s*=/.test(combined),false);
  assert.equal(combined.includes('api.github.com/repos/zjcrop/brew-profiles'),false);
});

test('自然语言识别回填确定性字段和 BrewIon 代码', async () => {
  const book=JSON.parse(await text('public/fallback-codebook.json'));
  const parsed=parseNaturalLanguage('埃塞俄比亚 古吉 日晒 埃塞原生种 浅烘 2026-07-20 海拔2100m 净重150g 茉莉 蓝莓 蜂蜜',book);
  assert.equal(parsed.countryCode,'CO-EA'); assert.equal(parsed.processCode,'PR-NA'); assert.equal(parsed.varietyCode,'VA-EH');
  assert.equal(parsed.roastCode,'RL-L1'); assert.equal(parsed.roastDate,'2026-07-20'); assert.equal(parsed.altitude,2100); assert.equal(parsed.initialWeight,150);
  assert.ok(parsed.flavorCodes.length>=2); assert.ok(Object.keys(parsed.evidence).length>=6);
});

function crc16(bytes){let crc=0xffff;for(const value of bytes){crc^=value<<8;for(let bit=0;bit<8;bit++)crc=crc&0x8000?((crc<<1)^0x1021):crc<<1;crc&=0xffff;}return crc;}
test('BrewIon 固定字段二维码执行 CRC 和行索引解码', async () => {
  const book=JSON.parse(await text('public/fallback-codebook.json'));
  const fixed='01'+'**'+'***'+'***'+'01'+'01'+'*1'+'**'+'01'+'**'+'**'+'**'+'**'+'000'+'0';
  const core=new TextEncoder().encode(fixed);const crc=crc16(core);const bytes=Uint8Array.from([...core,crc>>8,crc&0xff]);
  const decoded=decodeBrewIonBytes(bytes,book);
  assert.equal(decoded.countryCode,book.countries[0][0]);assert.equal(decoded.varietyCode,book.varieties[0][0]);assert.equal(decoded.processCode,book.processes[0][0]);
  assert.deepEqual(decoded.flavorCodes,[book.flavors[0][0]]);assert.equal(decoded.roastCode,'RL-L1');
  const corrupted=Uint8Array.from(bytes);corrupted[0]^=1;assert.throws(()=>decodeBrewIonBytes(corrupted,book),/CRC16/);
});

test('视觉、卡片、分组、搜索和撷页交互标记已落地', async () => {
  const [html,css,app]=await Promise.all([text('index.html'),text('styles.css'),text('src/app.js')]);
  assert.ok(html.includes('class="fab-wrap action-grid"'));
  assert.ok(css.includes('.bean-card.compact'));
  assert.ok(css.includes('.group-collapse'));
  assert.ok(css.includes('.fab-wrap.action-grid'));
  assert.ok(app.includes('data-open-group'));
  assert.ok(app.includes('data-collapse-group'));
  assert.ok(app.includes("backdropClose: true"));
  assert.ok(app.includes("dialogHeader('撷'"));
  assert.ok(app.includes('class="bottom-return"'));
  assert.ok(app.includes('data-open-recommend-board'));
});

test('豆卡名称、烘焙色值和现有数据筛选逻辑正确', async () => {
  const app=await text('src/app.js');
  assert.equal(app.includes('id="beanName"'),false);
  assert.ok(app.includes('id="beanRoastColor"'));assert.ok(app.includes('填写色值自动生成'));
  assert.ok(app.includes("name: `${codeName('countries'"));
  assert.ok(app.includes("uniqueRowsFromBeans('countries'"));assert.ok(app.includes("uniqueRowsFromBeans('varieties'"));assert.ok(app.includes('availableFlavorRows(activeBeans)'));
});

test('远程编码表与内置表合并时保留缺失风味', async () => {
  const fallback=JSON.parse(await text('public/fallback-codebook.json'));const primary=structuredClone(fallback);primary.flavors=primary.flavors.slice(0,3);
  const merged=mergeCodebooks(primary,fallback);assert.equal(merged.flavors.length,fallback.flavors.length);assert.equal(new Set(merged.flavors.map(row=>row[0])).size,merged.flavors.length);
});



test('编码表产区与庄园使用正确中文列且不生成空标签', async () => {
  const book = JSON.parse(await text('public/fallback-codebook.json'));
  const index = makeIndex(book);
  assert.equal(displayName(index, 'regions', book.regions[0][0]), book.regions[0][2]);
  assert.equal(displayName(index, 'entities', book.entities[0][0]), book.entities[0][3]);
  assert.notEqual(displayName(index, 'regions', book.regions[0][0]), book.regions[0][1]);
  assert.ok(book.flavors.every(row => String(row[1] || '').trim().length > 0));
});

test('十阶段赏味进度从20%起步并在赏味期后一周达到100%', () => {
  const bean = { roastCode: 'RL-L1', roastDate: '2026-07-29', varietyCode: 'VA-GE', processCode: 'PR-WA' };
  const start = freshnessProfile(bean, new Date('2026-07-29T12:00:00Z'));
  assert.equal(start.stage, 0);
  assert.equal(start.progress, 0.2);
  const full = freshnessProfile(bean, new Date(new Date('2026-07-29T00:00:00Z').getTime() + (start.fullDay + 1) * 86400000));
  assert.equal(full.progress, 1);
  assert.ok(full.stage >= 8);
});

test('负面缺陷扣分显著高于正面风味叠加', () => {
  const positive = computeAutomaticScore({ floral:{0:['茉莉','橙花']}, fruit:{0:['莓果','桃子']}, sweet:{0:['蜂蜜'],1:['高']}, negative:{0:['无']} });
  const defective = computeAutomaticScore({ floral:{0:['茉莉','橙花']}, fruit:{0:['莓果']}, bitter:{0:['焦苦']}, mouthfeel:{0:['干涩']}, negative:{0:['霉味','药感','橡胶']} });
  assert.ok(positive - defective >= 30, `${positive} vs ${defective}`);
});

test('v0.9 交互与器具库存标记完整', async () => {
  const [app, css, html] = await Promise.all([text('src/app.js'), text('styles.css'), text('index.html')]);
  for (const marker of ['brewHeadingBean','openCustomWaterDialog','openFlavorTargetDialog','openBrewTuneDialog','openCoolingDialog','trajectoryDefaultToggle','advanceSpeech','bean-freshness-progress','gear-low-star','data-filter-item']) assert.ok(app.includes(marker) || css.includes(marker) || html.includes(marker), marker);
  assert.equal(html.includes('filterSummaryBtn'), false);
  assert.ok(css.includes('animation: group-open-manual .5s'));
  assert.ok(css.includes('animation: group-open-auto .2s'));
  assert.ok(app.includes('filter.quantity = Math.max(0, Number(filter.quantity||0)-1)'));
});
test('计时、消耗、品鉴札记、复刻与方案导出功能已落地', async () => {
  const app=await text('src/app.js');
  for(const marker of ['timerPrevBtn','>退<','timerPauseBtn','>驻<','timerNextBtn','>进<','timerEndBtn','>终<','扣除咖啡豆与滤纸，进入品鉴','不记录则返回小酌','sensoryNaturalNote','主观分差','自动得分','buildCorrectedPlan','data-replay-session','exportCurrentPlan','JSON脚本']) assert.ok(app.includes(marker),marker);
});
