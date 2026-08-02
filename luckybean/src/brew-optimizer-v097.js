// Lucky Bean inverse brew optimizer.
// Derived from the v17 calculation chain: bean chemistry -> preference target ->
// device/water constraints -> target/risk windows -> profile fitting -> sensory feedback.
export const BREW_OPTIMIZER_VERSION = 'lucky-brew-optimizer-0.9.7.1';
export const TRAJECTORY_MODEL_VERSION = 'lucky-trajectory-inverse-fit-0.9.7.1';

const CHEMISTRY_PRIORS = Object.freeze({"default":{"label":"均衡阿拉比卡参考","markers":["柠檬酸簇","糖-美拉德前体","中性挥发物"],"thresholdText":"多数单体酸在咖啡液中处于亚阈值或近阈值区，最终感知更像“总酸骨架 + VOCs + 触觉”的合成结果，而不是单一有机酸被直接辨认。","profileShift":{"aroma":0,"flavor":0,"acidity":0,"body":0,"balance":0},"axisShift":{"floral":0,"fruity":0,"jammy":0,"stonefruit":0,"tea":0,"cacao":0},"chemistryShift":{"acid":0,"sweet":0,"bitter":0,"volatility":0,"solubility":0,"density":0},"phaseShift":{"acid":0,"aroma":0,"tail":0},"sensitivity":{"temp":0.58,"alkalinity":0.62,"magnesium":0.58,"calcium":0.46,"tail":0.6,"pulse":0.56},"range":{"temp":1.2,"flow":0.36,"water":6},"execution":"以总酸骨架、挥发物保留与尾段苦味控制之间的平衡为主。"},"gesha":{"label":"瑰夏·低阈值萜烯型","markers":["芳樟醇","柠檬烯","香叶醇"],"thresholdText":"核心高光来自低嗅阈值萜烯与茶感 VOCs；高碱度、高钙交联和尾段过洗会比浓度不足更快毁掉花香与佛手柑高光。","profileShift":{"aroma":0.35,"flavor":0.18,"acidity":0.08,"body":-0.18,"balance":0.12},"axisShift":{"floral":1.4,"fruity":0.4,"jammy":-0.3,"stonefruit":0.2,"tea":1.1,"cacao":-0.8},"chemistryShift":{"acid":0.18,"sweet":0.1,"bitter":-0.28,"volatility":0.95,"solubility":-0.08,"density":0.22},"phaseShift":{"acid":0,"aroma":0.05,"tail":-0.05},"sensitivity":{"temp":0.95,"alkalinity":0.96,"magnesium":0.62,"calcium":0.74,"tail":0.94,"pulse":0.86},"range":{"temp":0.7,"flow":0.22,"water":4},"execution":"偏低碱度、较紧的尾段截流、轻量连续脉冲，优先保花香而非盲目追求高 EY。"},"sl28":{"label":"SL28·磷酸触觉型","markers":["磷酸","苹果酸","柠檬酸","含硫酯类"],"thresholdText":"SL28 的亮度并不等于“苹果酸越多越好”，而是磷酸触觉、近阈值有机酸与高活性 VOCs 共同形成的酸质爆发感。","profileShift":{"aroma":0.14,"flavor":0.12,"acidity":0.34,"body":-0.06,"balance":0.06},"axisShift":{"floral":0,"fruity":0.6,"jammy":-0.2,"stonefruit":0.3,"tea":0.2,"cacao":-0.4},"chemistryShift":{"acid":0.46,"sweet":0.02,"bitter":-0.1,"volatility":0.25,"solubility":0.08,"density":0.26},"phaseShift":{"acid":0.06,"aroma":0.02,"tail":-0.04},"sensitivity":{"temp":0.72,"alkalinity":0.92,"magnesium":0.8,"calcium":0.42,"tail":0.74,"pulse":0.68},"range":{"temp":1,"flow":0.3,"water":5},"execution":"允许前段略强，但必须压住 HCO₃⁻ 与后段过洗，避免把明亮感钝化成硬酸。"},"sl34":{"label":"SL34·高酸甜平衡型","markers":["磷酸","苹果酸","柠檬酸","吡嗪/硫醇前体"],"thresholdText":"和 SL28 相比，SL34 的甜润与圆整度更高，仍受低碱度驱动，但对主段密度与体感更宽容。","profileShift":{"aroma":0.1,"flavor":0.15,"acidity":0.2,"body":0.06,"balance":0.14},"axisShift":{"floral":0,"fruity":0.5,"jammy":-0.1,"stonefruit":0.25,"tea":0.1,"cacao":-0.2},"chemistryShift":{"acid":0.28,"sweet":0.14,"bitter":-0.08,"volatility":0.2,"solubility":0.1,"density":0.2},"phaseShift":{"acid":0.04,"aroma":0.02,"tail":-0.02},"sensitivity":{"temp":0.66,"alkalinity":0.86,"magnesium":0.7,"calcium":0.48,"tail":0.66,"pulse":0.62},"range":{"temp":1.1,"flow":0.32,"water":5},"execution":"比 SL28 更能接受中段甜感回收，但仍应保持低碱度与偏紧尾段。"},"jarc74110":{"label":"74110·花果甜感型","markers":["酯类","醛类","葫芦巴碱","蔗糖前体"],"thresholdText":"甜感更多来自前体在烘焙后生成的低阈值芳香物与跨模态甜感，不是蔗糖本身在杯中直接越阈。","profileShift":{"aroma":0.22,"flavor":0.18,"acidity":0.1,"body":0.02,"balance":0.18},"axisShift":{"floral":0.8,"fruity":0.6,"jammy":0.1,"stonefruit":0.6,"tea":0.4,"cacao":-0.3},"chemistryShift":{"acid":0.12,"sweet":0.42,"bitter":-0.22,"volatility":0.5,"solubility":0.1,"density":0.2},"phaseShift":{"acid":0.02,"aroma":0.05,"tail":-0.03},"sensitivity":{"temp":0.84,"alkalinity":0.78,"magnesium":0.74,"calcium":0.48,"tail":0.82,"pulse":0.78},"range":{"temp":0.9,"flow":0.28,"water":5},"execution":"中段香气窗口要比默认更长，尾段要偏早收。"},"jarc74112":{"label":"74112·花香柑橘清亮型","markers":["酯类","醛类","葫芦巴碱","蔗糖前体"],"thresholdText":"相比 74110 更偏花香与清亮柑橘线条，对高碱度和高尾段洗脱更敏感。","profileShift":{"aroma":0.26,"flavor":0.16,"acidity":0.14,"body":-0.02,"balance":0.2},"axisShift":{"floral":0.9,"fruity":0.5,"jammy":-0.1,"stonefruit":0.5,"tea":0.5,"cacao":-0.4},"chemistryShift":{"acid":0.16,"sweet":0.38,"bitter":-0.24,"volatility":0.58,"solubility":0.08,"density":0.22},"phaseShift":{"acid":0.03,"aroma":0.05,"tail":-0.04},"sensitivity":{"temp":0.88,"alkalinity":0.82,"magnesium":0.72,"calcium":0.5,"tail":0.86,"pulse":0.8},"range":{"temp":0.85,"flow":0.26,"water":5},"execution":"更适合细密脉冲和偏低尾段注水温度。"},"jarc74158":{"label":"74158·甜感浆果型","markers":["酮类","长链酯类","蔗糖前体","发酵副产物耦合"],"thresholdText":"74158 的“甜浆果”高度依赖品种 × 处理法耦合，适度过程风味可以放大正面甜感，但尾段过洗会迅速转向发酵钝甜。","profileShift":{"aroma":0.18,"flavor":0.22,"acidity":0.02,"body":0.12,"balance":0.1},"axisShift":{"floral":0.2,"fruity":0.7,"jammy":0.5,"stonefruit":0.3,"tea":-0.1,"cacao":0},"chemistryShift":{"acid":0,"sweet":0.46,"bitter":-0.08,"volatility":0.36,"solubility":0.18,"density":0.18},"phaseShift":{"acid":-0.02,"aroma":0.05,"tail":-0.03},"sensitivity":{"temp":0.72,"alkalinity":0.7,"magnesium":0.68,"calcium":0.56,"tail":0.78,"pulse":0.72},"range":{"temp":1,"flow":0.32,"water":6},"execution":"允许稍厚中段与轻微更高体感，但尾段仍需及时收敛。"},"yellowbourbon":{"label":"黄波旁·前体甜感型","markers":["葫芦巴碱","3-CQA","糖-美拉德前体"],"thresholdText":"黄波旁的“甜”主要来自前体与芳香网络的跨模态协同，而不是杯中糖分直接越阈；它比高挥发花香型更能容忍 Ca 带来的体感。","profileShift":{"aroma":0.06,"flavor":0.12,"acidity":-0.04,"body":0.2,"balance":0.16},"axisShift":{"floral":-0.1,"fruity":0.1,"jammy":0.1,"stonefruit":0.2,"tea":-0.2,"cacao":0.6},"chemistryShift":{"acid":-0.04,"sweet":0.3,"bitter":0.02,"volatility":0.08,"solubility":0.16,"density":0.14},"phaseShift":{"acid":-0.03,"aroma":0.02,"tail":0.01},"sensitivity":{"temp":0.48,"alkalinity":0.56,"magnesium":0.54,"calcium":0.64,"tail":0.56,"pulse":0.46},"range":{"temp":1.4,"flow":0.4,"water":7},"execution":"允许更宽容的主段与稍厚尾段，但要防深苦后段堆积。"},"typica":{"label":"Typica·细瘦均衡型","markers":["柠檬酸簇","轻花香 VOCs","温和糖前体"],"thresholdText":"Typica 更像细瘦均衡模板，适合用较克制的尾段与中等脉冲把清晰度维持住。","profileShift":{"aroma":0.06,"flavor":0.08,"acidity":0.04,"body":-0.04,"balance":0.12},"axisShift":{"floral":0.1,"fruity":0.1,"jammy":-0.2,"stonefruit":0.1,"tea":0.2,"cacao":-0.2},"chemistryShift":{"acid":0.04,"sweet":0.08,"bitter":-0.06,"volatility":0.1,"solubility":0,"density":0.1},"phaseShift":{"acid":0,"aroma":0.02,"tail":-0.02},"sensitivity":{"temp":0.62,"alkalinity":0.66,"magnesium":0.58,"calcium":0.48,"tail":0.62,"pulse":0.56},"range":{"temp":1.2,"flow":0.34,"water":6},"execution":"偏向清晰、细长、不过洗。"},"bourbonfamily":{"label":"波旁系·甜润平衡型","markers":["葫芦巴碱","糖-美拉德前体","适中有机酸簇"],"thresholdText":"波旁系的优势在甜润和平衡，允许略高一点的体感与更宽的冲煮窗口。","profileShift":{"aroma":0.04,"flavor":0.1,"acidity":0,"body":0.1,"balance":0.16},"axisShift":{"floral":0,"fruity":0.1,"jammy":0.1,"stonefruit":0.2,"tea":0,"cacao":0.2},"chemistryShift":{"acid":0,"sweet":0.18,"bitter":-0.04,"volatility":0.08,"solubility":0.1,"density":0.1},"phaseShift":{"acid":-0.01,"aroma":0.02,"tail":-0.01},"sensitivity":{"temp":0.56,"alkalinity":0.62,"magnesium":0.6,"calcium":0.56,"tail":0.58,"pulse":0.5},"range":{"temp":1.3,"flow":0.38,"water":6},"execution":"平衡主轴下，允许适度甜感回收与中等体感。"},"sidra":{"label":"Sidra·花果茶感复合型","markers":["萜烯簇","酯类","轻发酵芳香物"],"thresholdText":"Sidra 兼具花果与茶感，和瑰夏一样对高碱度与尾段拖长较敏感，但体感容错略高。","profileShift":{"aroma":0.24,"flavor":0.18,"acidity":0.08,"body":0.02,"balance":0.14},"axisShift":{"floral":0.8,"fruity":0.5,"jammy":0,"stonefruit":0.4,"tea":0.7,"cacao":-0.4},"chemistryShift":{"acid":0.12,"sweet":0.18,"bitter":-0.18,"volatility":0.6,"solubility":0.04,"density":0.16},"phaseShift":{"acid":0.01,"aroma":0.05,"tail":-0.04},"sensitivity":{"temp":0.84,"alkalinity":0.86,"magnesium":0.68,"calcium":0.62,"tail":0.84,"pulse":0.78},"range":{"temp":0.9,"flow":0.26,"water":5},"execution":"适合中等密度多脉冲，避免尾段长时间洗脱。"},"pinkbourbon":{"label":"Pink Bourbon·高挥发花果型","markers":["花香 VOCs","果香酯类","近阈值有机酸簇"],"thresholdText":"粉波旁经常以高挥发花果物与清亮酸骨架见长，对主段温度和低碱度都较敏感。","profileShift":{"aroma":0.22,"flavor":0.16,"acidity":0.12,"body":-0.02,"balance":0.14},"axisShift":{"floral":0.6,"fruity":0.5,"jammy":-0.1,"stonefruit":0.3,"tea":0.4,"cacao":-0.3},"chemistryShift":{"acid":0.18,"sweet":0.12,"bitter":-0.16,"volatility":0.55,"solubility":0.04,"density":0.14},"phaseShift":{"acid":0.02,"aroma":0.04,"tail":-0.03},"sensitivity":{"temp":0.82,"alkalinity":0.84,"magnesium":0.7,"calcium":0.58,"tail":0.82,"pulse":0.74},"range":{"temp":0.95,"flow":0.28,"water":5},"execution":"优先保护花果清晰度，避免尾段甜浊。"},"cgaheavy":{"label":"抗病/杂交系·CGA/咖啡因偏高型","markers":["绿原酸","咖啡因","潜在苯基茚满路径"],"thresholdText":"这类豆往往不是“香气不够”，而是后段和高温更容易把绿原酸内酯与苯基茚满苦味路径拉高；模型必须更重视尾段风险。","profileShift":{"aroma":-0.1,"flavor":-0.04,"acidity":-0.06,"body":0.08,"balance":-0.08},"axisShift":{"floral":-0.3,"fruity":-0.1,"jammy":0,"stonefruit":0,"tea":-0.2,"cacao":0.4},"chemistryShift":{"acid":-0.06,"sweet":-0.04,"bitter":0.36,"volatility":-0.12,"solubility":0.28,"density":0.1},"phaseShift":{"acid":-0.02,"aroma":0,"tail":-0.05},"sensitivity":{"temp":0.74,"alkalinity":0.68,"magnesium":0.54,"calcium":0.6,"tail":0.96,"pulse":0.64},"range":{"temp":0.9,"flow":0.24,"water":4},"execution":"必须强化尾段降温与截流；优先降低恶性苦味路径，而不是追求更高总萃取。"}});
const ARCHETYPES = Object.freeze([{"id":"ethiopia_washed_floral","label":"埃塞高海拔水洗花香型","countries":["ethiopia"],"varieties":["heirloomblend","kurume","daga","wolisho","74110","74112","74158"],"processes":["washed"],"altitudeMin":1650,"descriptors":["茉莉花","佛手柑","柑橘","红茶感"],"scores":{"aroma":8.5,"flavor":8.38,"acidity":8.38,"body":7.88,"balance":8.13},"aromaAxes":{"floral":8.8,"fruity":7.4,"jammy":4.9,"stonefruit":5.7,"tea":7.9,"cacao":2.2},"chemistry":{"acid":8.6,"sweet":7.3,"bitter":3,"volatility":8.9,"solubility":4.3,"density":8.1}},{"id":"kenya_sl_bright","label":"肯尼亚 SL 高酸高香型","countries":["kenya"],"varieties":["sl28","sl34","batian","ruiru11"],"processes":["washed"],"altitudeMin":1550,"descriptors":["黑加仑","番茄叶","柑橘","明亮酸质"],"scores":{"aroma":8.2,"flavor":8.35,"acidity":8.8,"body":8,"balance":8.1},"aromaAxes":{"floral":5.8,"fruity":8.6,"jammy":6.1,"stonefruit":5.5,"tea":5.8,"cacao":3.4},"chemistry":{"acid":9.1,"sweet":7.1,"bitter":3.5,"volatility":8.2,"solubility":4.4,"density":8.4}},{"id":"panama_geisha_terpene","label":"巴拿马瑰夏萜烯高挥发型","countries":["panama"],"varieties":["gesha"],"processes":["washed","natural","honey","anaerobic"],"altitudeMin":1500,"descriptors":["茉莉","佛手柑","柠檬草","白桃"],"scores":{"aroma":9,"flavor":8.7,"acidity":8.4,"body":7.7,"balance":8.4},"aromaAxes":{"floral":9.4,"fruity":7.9,"jammy":5.1,"stonefruit":7.2,"tea":8.4,"cacao":1.5},"chemistry":{"acid":8.4,"sweet":7.7,"bitter":2.4,"volatility":9.4,"solubility":4,"density":8.3}},{"id":"colombia_anaerobic","label":"哥伦比亚厌氧发酵果香型","countries":["colombia"],"varieties":["castillo","caturra","colombia","pinkbourbon","sidra","gesha"],"processes":["anaerobic","natural"],"altitudeMin":1400,"descriptors":["莓果","热带水果","酒香","发酵甜感"],"scores":{"aroma":8.5,"flavor":8.5,"acidity":7.9,"body":8.4,"balance":7.8},"aromaAxes":{"floral":5.8,"fruity":8.8,"jammy":8.4,"stonefruit":7.6,"tea":4.2,"cacao":4.6},"chemistry":{"acid":7.4,"sweet":8.7,"bitter":3.8,"volatility":8.3,"solubility":5.2,"density":6.9}},{"id":"brazil_yellow_bourbon","label":"巴西黄波旁经典甜感型","countries":["brazil"],"varieties":["yellowbourbon","redbourbon","mundoNovo","catuai","yellowcatuai","topazio","arara"],"processes":["natural","honey"],"altitudeMin":900,"descriptors":["坚果","巧克力","焦糖","熟果"],"scores":{"aroma":7.8,"flavor":8.2,"acidity":7.2,"body":8.4,"balance":8.3},"aromaAxes":{"floral":2.6,"fruity":6,"jammy":6.8,"stonefruit":5.2,"tea":2.8,"cacao":8.8},"chemistry":{"acid":6.4,"sweet":8.8,"bitter":4.3,"volatility":6.4,"solubility":5.4,"density":5.9}},{"id":"colombia_classic","label":"哥伦比亚传统平衡型","countries":["colombia"],"varieties":["castillo","caturra","colombia","tabi","typica","bourbon"],"processes":["washed","honey"],"altitudeMin":1200,"descriptors":["红苹果","焦糖","柑橘","可可"],"scores":{"aroma":8,"flavor":8.2,"acidity":7.8,"body":8.1,"balance":8.4},"aromaAxes":{"floral":4.8,"fruity":7,"jammy":5.8,"stonefruit":6.2,"tea":4.6,"cacao":6.4},"chemistry":{"acid":7.2,"sweet":8.1,"bitter":3.8,"volatility":7,"solubility":5,"density":6.8}},{"id":"sumatra_wet_hulled","label":"印尼湿刨厚重香料型","countries":["indonesia"],"varieties":["ateng","catimor","andungsari","typica","java"],"processes":["wetHulled"],"altitudeMin":1100,"descriptors":["草本","香料","黑巧","木质"],"scores":{"aroma":7.6,"flavor":7.9,"acidity":6.8,"body":8.8,"balance":7.7},"aromaAxes":{"floral":2.4,"fruity":4.4,"jammy":5,"stonefruit":3.8,"tea":5.4,"cacao":8.3},"chemistry":{"acid":5.8,"sweet":7,"bitter":5.4,"volatility":5.9,"solubility":5.3,"density":5.9}},{"id":"yunnan_catimor","label":"云南水洗卡蒂姆香料烘烤型","countries":["china"],"varieties":["catimor","s795","s288","typica"],"processes":["washed","natural","honey"],"altitudeMin":1100,"descriptors":["坚果","香料","红果","烘烤"],"scores":{"aroma":7.5,"flavor":7.8,"acidity":7,"body":8.1,"balance":7.8},"aromaAxes":{"floral":3.2,"fruity":5.8,"jammy":5.4,"stonefruit":4.6,"tea":4.4,"cacao":7.4},"chemistry":{"acid":6.1,"sweet":7.2,"bitter":5.1,"volatility":6,"solubility":5.4,"density":6.2}},{"id":"guatemala_antigua","label":"危地马拉安提瓜辛香醇厚型","countries":["guatemala"],"varieties":["bourbon","caturra","pache","typica","pacamara"],"processes":["washed","honey"],"altitudeMin":1300,"descriptors":["可可","香料","红苹果","焦糖"],"scores":{"aroma":7.9,"flavor":8.2,"acidity":7.5,"body":8.4,"balance":8.3},"aromaAxes":{"floral":4,"fruity":6.4,"jammy":5.6,"stonefruit":5.6,"tea":4,"cacao":7.8},"chemistry":{"acid":6.8,"sweet":7.9,"bitter":4.2,"volatility":6.8,"solubility":5,"density":7}},{"id":"sea_liberica_excelsa","label":"东南亚木质发酵高体感型","countries":["vietnam","thailand","myanmar","png"],"varieties":["robustablend","catimor","typica","pacamara"],"processes":["natural","anaerobic","wetHulled"],"altitudeMin":500,"descriptors":["熟果","木质","香料","发酵"],"scores":{"aroma":7.3,"flavor":7.6,"acidity":6.5,"body":8.8,"balance":7.2},"aromaAxes":{"floral":2.2,"fruity":5.8,"jammy":6.6,"stonefruit":4.8,"tea":4.4,"cacao":7.5},"chemistry":{"acid":5.4,"sweet":6.8,"bitter":6.2,"volatility":5.4,"solubility":5.8,"density":5.5}},{"id":"fallback_africa","label":"非洲高地通用花果型","countries":[],"varieties":[],"processes":[],"altitudeMin":1500,"descriptors":["花香","柑橘","莓果","茶感"],"scores":{"aroma":8.2,"flavor":8.1,"acidity":8.1,"body":7.8,"balance":8},"aromaAxes":{"floral":7.2,"fruity":7.7,"jammy":5.6,"stonefruit":6,"tea":6.6,"cacao":3},"chemistry":{"acid":8,"sweet":7.3,"bitter":3.4,"volatility":8,"solubility":4.5,"density":7.7}},{"id":"fallback_america","label":"美洲平衡通用型","countries":[],"varieties":[],"processes":[],"altitudeMin":1100,"descriptors":["柑橘","焦糖","核果","可可"],"scores":{"aroma":7.9,"flavor":8.1,"acidity":7.6,"body":8.1,"balance":8.2},"aromaAxes":{"floral":4.8,"fruity":6.8,"jammy":5.7,"stonefruit":6.1,"tea":4.5,"cacao":6.2},"chemistry":{"acid":7,"sweet":7.9,"bitter":4,"volatility":6.8,"solubility":5,"density":6.8}},{"id":"fallback_asia","label":"亚洲厚感通用型","countries":[],"varieties":[],"processes":[],"altitudeMin":800,"descriptors":["坚果","香料","熟果","可可"],"scores":{"aroma":7.5,"flavor":7.8,"acidity":6.9,"body":8.5,"balance":7.7},"aromaAxes":{"floral":3,"fruity":5.6,"jammy":5.8,"stonefruit":4.8,"tea":4.7,"cacao":7.4},"chemistry":{"acid":6,"sweet":7.2,"bitter":5.2,"volatility":5.8,"solubility":5.4,"density":6}}]);
const PROFILE_IDS = Object.freeze([
  'one-pour','two-pulse','three-pulse','four-six-v17',
  'flat46-clean','five-pulse','pulse-30x15'
]);

const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const clone = value => structuredClone(value);
const gaussian = (x, center, width) => Math.exp(-0.5 * ((x - center) / Math.max(0.01, width)) ** 2);
const normalizeText = value => String(value ?? '').trim().toLowerCase().replace(/[\s_./-]+/g, '');
const target01 = (value, fallback = 1.5) => clamp(Number.isFinite(Number(value)) ? Number(value) : fallback, 0, 3) / 3;

function roastLevel(bean = {}) {
  const code = String(bean.roastCode || '');
  const parsed = Number(code.replace(/\D/g, ''));
  if (Number.isFinite(parsed)) return clamp(parsed, 0, 6);
  const agtron = Number(bean.roastColor || bean.agtron || 0);
  if (!agtron) return 2;
  if (agtron >= 95) return 0;
  if (agtron >= 85) return 1;
  if (agtron >= 75) return 2;
  if (agtron >= 65) return 3;
  if (agtron >= 55) return 4;
  if (agtron >= 45) return 5;
  return 6;
}

function countryKey(bean = {}) {
  const text = normalizeText(bean.countryCode || bean.country || '');
  const map = [
    [/coea|ethiopia|埃塞/, 'ethiopia'], [/coke|kenya|肯尼亚/, 'kenya'],
    [/copa|panama|巴拿马/, 'panama'], [/coco|colombia|哥伦比亚/, 'colombia'],
    [/cobr|brazil|巴西/, 'brazil'], [/coid|indonesia|sumatra|印尼|苏门答腊/, 'indonesia'],
    [/cocn|china|yunnan|中国|云南/, 'china'], [/cogt|guatemala|危地马拉/, 'guatemala'],
    [/cost|salvador|萨尔瓦多/, 'elsalvador'], [/cocr|costarica|哥斯达黎加/, 'costarica'],
    [/cope|peru|秘鲁/, 'peru'], [/corw|rwanda|卢旺达/, 'rwanda'],
    [/cobu|burundi|布隆迪/, 'burundi'], [/copg|png|papua|巴布亚/, 'png']
  ];
  return map.find(([regex]) => regex.test(text))?.[1] || text;
}

function processKey(bean = {}) {
  const text = normalizeText(bean.processCode || bean.process || '');
  if (/ana|厌氧|carbon|cm|ferment|发酵/.test(text)) return 'anaerobic';
  if (/natural|prna|日晒|dry/.test(text)) return 'natural';
  if (/honey|prho|蜜处理/.test(text)) return 'honey';
  if (/wethull|prwh|湿刨/.test(text)) return 'wetHulled';
  if (/washed|prwa|水洗/.test(text)) return 'washed';
  return 'washed';
}

function varietyPriorKey(bean = {}) {
  const text = normalizeText(bean.varietyCode || bean.variety || '');
  if (/gesha|geisha|vage|瑰夏/.test(text)) return 'gesha';
  if (/sl28/.test(text)) return 'sl28';
  if (/sl34/.test(text)) return 'sl34';
  if (/74110|ja10/.test(text)) return 'jarc74110';
  if (/74112|ja12/.test(text)) return 'jarc74112';
  if (/74158|ja58/.test(text)) return 'jarc74158';
  if (/yellowbourbon|黄波旁/.test(text)) return 'yellowbourbon';
  if (/pinkbourbon|粉波旁/.test(text)) return 'pinkbourbon';
  if (/sidra|希爪拉/.test(text)) return 'sidra';
  if (/typica|铁皮卡/.test(text)) return 'typica';
  if (/bourbon|波旁|catuai|卡图艾/.test(text)) return 'bourbonfamily';
  if (/castillo|catimor|ruiru|batian|robusta|colombia|ateng|andungsari|timor|卡蒂姆|卡斯蒂略/.test(text)) return 'cgaheavy';
  return 'default';
}

function altitudeMeters(bean = {}) {
  const exact = Number(bean.altitude || bean.altitudeM || bean.elevation || 0);
  if (exact > 0) return exact;
  const band = normalizeText(bean.altitudeBand || '');
  if (/veryhigh|超高/.test(band)) return 2050;
  if (/high|高/.test(band)) return 1750;
  if (/mid|中/.test(band)) return 1400;
  if (/low|低/.test(band)) return 1000;
  return 1500;
}

function scoreArchetype(arch, bean, altitude, variety, process, country) {
  let score = 0;
  if ((arch.countries || []).includes(country)) score += 5;
  if ((arch.varieties || []).some(item => variety.includes(normalizeText(item)))) score += 5;
  if ((arch.processes || []).includes(process)) score += 3;
  if (altitude >= Number(arch.altitudeMin || 0)) score += 1.5;
  if (String(arch.id).startsWith('fallback_')) score += 0.25;
  return score;
}

function mixAxis(base, shift, min = 0.8, max = 9.8) {
  return clamp(Number(base || 0) + Number(shift || 0), min, max);
}

export function buildBeanChemistryModel(input = {}) {
  const bean = input.bean || {};
  const level = roastLevel(bean);
  const roastDevelopment = level / 6;
  const lightness = 1 - roastDevelopment;
  const altitude = altitudeMeters(bean);
  const country = countryKey(bean);
  const process = processKey(bean);
  const variety = normalizeText(bean.varietyCode || bean.variety || '');
  const priorKey = varietyPriorKey(bean);
  const prior = CHEMISTRY_PRIORS[priorKey] || CHEMISTRY_PRIORS.default;

  let archetype = ARCHETYPES[0];
  let bestScore = -Infinity;
  for (const candidate of ARCHETYPES) {
    const score = scoreArchetype(candidate, bean, altitude, variety, process, country);
    if (score > bestScore) { archetype = candidate; bestScore = score; }
  }

  const altitudeBoost = clamp((altitude - 1200) / 900, -0.25, 1.15);
  const processShift = {
    washed: { fruit: 0.00, ferment: 0.00, solubility: 0.00 },
    natural: { fruit: 0.55, ferment: 0.28, solubility: 0.18 },
    honey: { fruit: 0.28, ferment: 0.12, solubility: 0.10 },
    anaerobic: { fruit: 0.72, ferment: 0.65, solubility: 0.28 },
    wetHulled: { fruit: -0.12, ferment: 0.18, solubility: 0.24 }
  }[process] || { fruit: 0, ferment: 0, solubility: 0 };

  const profile = {
    aroma: mixAxis(archetype.scores?.aroma, prior.profileShift?.aroma + lightness * 0.45 - roastDevelopment * 0.25),
    flavor: mixAxis(archetype.scores?.flavor, prior.profileShift?.flavor + processShift.fruit * 0.10),
    acidity: mixAxis(archetype.scores?.acidity, prior.profileShift?.acidity + lightness * 0.62 - roastDevelopment * 0.55 + altitudeBoost * 0.20),
    body: mixAxis(archetype.scores?.body, prior.profileShift?.body + roastDevelopment * 0.58 - lightness * 0.16),
    balance: mixAxis(archetype.scores?.balance, prior.profileShift?.balance - Math.abs(roastDevelopment - 0.45) * 0.16)
  };

  const axes = {};
  for (const key of ['floral','fruity','jammy','stonefruit','tea','cacao']) {
    axes[key] = mixAxis(archetype.aromaAxes?.[key], prior.axisShift?.[key]);
  }
  axes.floral = mixAxis(axes.floral, lightness * 0.48 - roastDevelopment * 0.42);
  axes.fruity = mixAxis(axes.fruity, processShift.fruit);
  axes.jammy = mixAxis(axes.jammy, process === 'anaerobic' ? 0.75 : process === 'natural' ? 0.45 : 0);
  axes.tea = mixAxis(axes.tea, lightness * 0.30 - roastDevelopment * 0.30);
  axes.cacao = mixAxis(axes.cacao, roastDevelopment * 1.25 - lightness * 0.30);

  const chemistry = {};
  for (const key of ['acid','sweet','bitter','volatility','solubility','density']) {
    chemistry[key] = mixAxis(archetype.chemistry?.[key], prior.chemistryShift?.[key], 2, 9.8);
  }
  chemistry.acid = mixAxis(chemistry.acid, altitudeBoost * 0.28 - roastDevelopment * 0.46, 2, 9.8);
  chemistry.sweet = mixAxis(chemistry.sweet, process === 'natural' ? 0.28 : process === 'honey' ? 0.20 : 0, 2, 9.8);
  chemistry.bitter = mixAxis(chemistry.bitter, roastDevelopment * 1.10 + (priorKey === 'cgaheavy' ? 0.35 : 0), 2, 9.8);
  chemistry.volatility = mixAxis(chemistry.volatility, lightness * 0.42 - roastDevelopment * 0.28, 2, 9.8);
  chemistry.solubility = mixAxis(chemistry.solubility, roastDevelopment * 1.22 + processShift.solubility - altitudeBoost * 0.16, 2, 9.8);
  chemistry.density = mixAxis(chemistry.density, altitudeBoost * 0.40 - roastDevelopment * 0.18, 2, 9.8);

  return {
    model: 'bean-chemistry-prior',
    archetypeId: archetype.id,
    archetypeLabel: archetype.label,
    matchConfidence: round(clamp(0.55 + bestScore * 0.045, 0.58, 0.96), 3),
    descriptors: [...new Set([...(archetype.descriptors || []), ...(prior.markers || [])])].slice(0, 8),
    markerFamilies: prior.markers || [],
    priorKey,
    priorLabel: prior.label,
    country,
    process,
    altitude,
    roastLevel: level,
    roastDevelopment,
    profile,
    axes,
    chemistry,
    sensitivity: prior.sensitivity || CHEMISTRY_PRIORS.default.sensitivity,
    executionRange: prior.range || CHEMISTRY_PRIORS.default.range,
    uncertainty: 1 - round(clamp(0.55 + bestScore * 0.045, 0.58, 0.96), 3)
  };
}

function objectOrText(value) {
  if (value && typeof value === 'object') return value;
  return { label: String(value || '') };
}

export function buildDeviceHydraulicModel(input = {}) {
  const brew = input.brew || {};
  const gear = input.gear || input.equipment || {};
  const dripperRaw = objectOrText(brew.dripper || brew.dripperCode || gear.dripper);
  const paperRaw = objectOrText(brew.filterPaper || brew.filterPaperCode || gear.filterPaper);
  const dripper = normalizeText(dripperRaw.label || dripperRaw.name || dripperRaw.code || brew.dripperCode || '');
  const paper = normalizeText(paperRaw.label || paperRaw.name || paperRaw.code || brew.filterPaperCode || '');

  let group = 'cone';
  let contact = 0.58;
  let bypass = 0.55;
  let drainage = 1.00;
  let uniformity = 0.70;
  let thermalMass = 0.55;
  if (/flat|平底|b75|kalita|orea|april|origamiflat/.test(dripper)) {
    group = 'flat'; contact = 0.66; bypass = 0.43; drainage = 0.91; uniformity = 0.86; thermalMass = 0.62;
  }
  if (/lowbypass|低旁路|pulsar|tricolate|stagg|无旁通|negotiated/.test(dripper)) {
    group = 'low-bypass'; contact = 0.86; bypass = 0.15; drainage = 0.66; uniformity = 0.90; thermalMass = 0.72;
  }
  if (/immersion|浸泡|switch|clever|aero/.test(dripper)) {
    group = 'immersion'; contact = 0.92; bypass = 0.08; drainage = 0.48; uniformity = 0.92; thermalMass = 0.78;
  }
  if (/kono|短肋/.test(dripper)) { contact += 0.06; bypass -= 0.08; drainage -= 0.08; }
  if (/flower|cafec/.test(dripper)) { drainage += 0.10; bypass += 0.04; }

  let permeability = 1.0;
  let retention = 1.0;
  let clogging = 1.0;
  if (/fast|快流|abaca|t90/.test(paper)) { permeability = 1.18; retention = 0.92; clogging = 0.80; }
  if (/slow|慢流|thick|厚/.test(paper)) { permeability = 0.82; retention = 1.08; clogging = 1.22; }
  if (/wave|波浪/.test(paper)) { permeability = 0.92; retention = 1.02; clogging = 1.05; bypass -= 0.04; }
  if (/negotiated|贴合|无旁通/.test(paper)) { permeability = 0.78; retention = 1.10; clogging = 1.16; bypass -= 0.10; contact += 0.07; }

  const mergeNumber = (raw, key, fallback) => Number.isFinite(Number(raw?.[key])) ? Number(raw[key]) : fallback;
  contact = mergeNumber(dripperRaw, 'contact', contact);
  bypass = mergeNumber(dripperRaw, 'bypass', bypass);
  drainage = mergeNumber(dripperRaw, 'drainage', drainage);
  uniformity = mergeNumber(dripperRaw, 'uniformity', uniformity);
  thermalMass = mergeNumber(dripperRaw, 'thermalMass', thermalMass);
  permeability = mergeNumber(paperRaw, 'permeability', permeability);
  retention = mergeNumber(paperRaw, 'retention', retention);
  clogging = mergeNumber(paperRaw, 'clogging', clogging);

  const maxFlow = clamp(6.2 * drainage * permeability * (0.82 + bypass * 0.25), 2.8, 7.2);
  const minFlow = clamp(2.4 + (contact - 0.55) * 0.8, 2.2, 3.5);
  const drainWait = clamp(7 + (1 / Math.max(0.2, drainage * permeability) - 1) * 11, 4, 28);
  const thermalLoss = clamp(1.7 + thermalMass * 1.4 + contact * 0.55, 2.0, 4.5);

  return {
    model: 'device-hydraulic-envelope',
    group,
    label: dripperRaw.label || dripperRaw.name || String(brew.dripperCode || '滤杯'),
    paperLabel: paperRaw.label || paperRaw.name || String(brew.filterPaperCode || '滤纸'),
    contact: round(clamp(contact, 0.3, 0.98), 3),
    bypass: round(clamp(bypass, 0.02, 0.8), 3),
    drainage: round(clamp(drainage, 0.3, 1.35), 3),
    uniformity: round(clamp(uniformity, 0.45, 0.98), 3),
    thermalMass: round(clamp(thermalMass, 0.3, 0.95), 3),
    permeability: round(clamp(permeability, 0.55, 1.4), 3),
    retention: round(clamp(retention, 0.75, 1.2), 3),
    clogging: round(clamp(clogging, 0.65, 1.4), 3),
    minFlow: round(minFlow, 2),
    maxFlow: round(maxFlow, 2),
    drainWait: round(drainWait, 1),
    thermalLoss: round(thermalLoss, 2)
  };
}

export function buildWaterExtractionModel(input = {}, plan = {}) {
  const profile = plan.water?.profile || input.water?.customProfile || input.water?.profile || {};
  const rawTds = profile.tdsMid ?? profile.tds ?? input.water?.tdsMgL ?? input.water?.tds ?? 85;
  const tds = Array.isArray(rawTds)
    ? (Number(rawTds[0] || 0) + Number(rawTds[1] || rawTds[0] || 0)) / 2
    : (Number(rawTds) || 85);
  const profileId = String(input.water?.profileId || profile.id || 'balanced').toLowerCase();
  let ca = Number(profile.ca);
  let mg = Number(profile.mg);
  let hco3 = Number(profile.hco3);
  if (!Number.isFinite(ca) || !Number.isFinite(mg) || !Number.isFinite(hco3)) {
    const dist = /geisha|floral|clarity/.test(profileId)
      ? { ca: 0.24, mg: 0.46, hco3: 0.18 }
      : /sweet|natural/.test(profileId)
        ? { ca: 0.28, mg: 0.40, hco3: 0.20 }
        : /dark|acidguard/.test(profileId)
          ? { ca: 0.34, mg: 0.23, hco3: 0.34 }
          : { ca: 0.30, mg: 0.34, hco3: 0.27 };
    ca = tds * dist.ca; mg = tds * dist.mg; hco3 = tds * dist.hco3;
  }
  const extractionPower = clamp(0.72 + mg * 0.006 + ca * 0.0025 - Math.max(0, hco3 - 35) * 0.003, 0.62, 1.25);
  const aromaSupport = clamp(0.78 + mg * 0.0055 - hco3 * 0.0025, 0.58, 1.20);
  const bodySupport = clamp(0.78 + ca * 0.005 + mg * 0.0015, 0.68, 1.22);
  const acidBuffer = clamp(0.25 + hco3 / 65 + ca / 180, 0.22, 1.25);
  const clarity = clamp(0.90 + mg * 0.003 - hco3 * 0.004 + (105 - tds) * 0.0015, 0.55, 1.18);
  return {
    model: 'ion-response-envelope', profileId, tds: round(tds, 1), ca: round(ca, 1), mg: round(mg, 1), hco3: round(hco3, 1),
    extractionPower: round(extractionPower, 4), aromaSupport: round(aromaSupport, 4),
    bodySupport: round(bodySupport, 4), acidBuffer: round(acidBuffer, 4), clarity: round(clarity, 4)
  };
}

export function deriveSensoryFeedback(record = {}, previousPlan = null) {
  const values = Object.values(record.answers || {})
    .flatMap(groups => Object.values(groups || {}).flat())
    .map(value => String(value));
  const professional = Object.values(record.professional?.selections || {}).flat().map(String);
  const text = [...values, ...professional, record.naturalNote || '', ...(record.summary || [])].join(' ').toLowerCase();
  const has = regex => regex.test(text);
  const feedback = {
    underExtracted: has(/酸尖|尖锐|酸薄|咸|空洞|寡淡|未萃取|under|sour/),
    overExtracted: has(/焦苦|苦重|木质|干涩|收敛|涩|over|astring|woody/),
    lowSweet: has(/甜不足|甜感弱|不甜|low sweet/),
    lowAroma: has(/香气弱|花香弱|果香弱|闷|香气不足|low aroma/),
    muddy: has(/浑浊|混浊|不干净|杂味|muddy/),
    thin: has(/单薄|水感|轻薄|thin/),
    heavy: has(/厚重|滞重|闷厚|heavy/)
  };
  const score = Number(record.subjectiveScore ?? record.score ?? 0);
  const auto = Number(record.autoScore || 0);
  const lowScore = score > 0 && score < 80;
  const previousControls = previousPlan?.optimizer?.controls || {};
const controls = {
  tempOffset: Number(previousControls.tempOffset || 0),
  flowOffset: Number(previousControls.flowOffset || 0),
  grindDelta: Number(previousControls.grindDelta || 0),
  ratioDelta: Number(previousControls.ratioDelta || 0),
  tailDrop: Number(previousControls.tailDrop || 3),
  bloomFactor: Number(previousControls.bloomFactor || 1),
    midWeight: 0, tailPenalty: 0, aromaWeight: 0
  };
  if (feedback.underExtracted) { controls.tempOffset += 0.8; controls.grindDelta -= 0.75; controls.ratioDelta += 0.25; controls.flowOffset -= 0.15; }
  if (feedback.overExtracted) { controls.tempOffset -= 0.7; controls.grindDelta += 0.85; controls.ratioDelta -= 0.30; controls.tailDrop += 1.6; controls.tailPenalty += 0.35; }
  if (feedback.lowSweet) { controls.grindDelta -= 0.35; controls.midWeight += 0.30; controls.ratioDelta += 0.15; }
  if (feedback.lowAroma) { controls.tempOffset -= 0.25; controls.aromaWeight += 0.35; controls.flowOffset += 0.10; }
  if (feedback.muddy) { controls.grindDelta += 0.45; controls.flowOffset += 0.20; controls.tailPenalty += 0.20; }
  if (feedback.thin) { controls.grindDelta -= 0.30; controls.ratioDelta -= 0.20; controls.midWeight += 0.18; }
  if (feedback.heavy) { controls.grindDelta += 0.30; controls.ratioDelta += 0.20; controls.flowOffset += 0.15; }
  if (lowScore && !Object.values(feedback).some(Boolean)) controls.midWeight += 0.12;
  controls.tempOffset = round(clamp(controls.tempOffset, -2, 2), 2);
  controls.flowOffset = round(clamp(controls.flowOffset, -0.8, 0.8), 2);
  controls.grindDelta = round(clamp(controls.grindDelta, -1.8, 1.8), 2);
  controls.ratioDelta = round(clamp(controls.ratioDelta, -0.8, 0.8), 2);
  controls.tailDrop = round(clamp(controls.tailDrop, 1, 9), 2);
  return {
    version: 1,
    sourceRecordId: record.id || '',
    sourcePlanId: previousPlan?.id || record.brewSessionId || '',
    scoreDelta: round(score - auto, 1),
    flags: feedback,
    controls,
    evidence: text.slice(0, 240)
  };
}

export function buildPreferenceTarget(input = {}, feedback = null) {
  const targets = input.targets || {};
  const controls = feedback?.controls || {};
  const floral = target01(targets.floral);
  const acidity = target01(targets.acidity);
  const sweetness = target01(targets.sweetness);
  const body = target01(targets.body);
  // Existing Lucky Bean semantics: a higher bitterness target means stronger restraint.
  const bitterRestraint = target01(targets.bitterness);
  return {
    floral: clamp(floral + Number(controls.aromaWeight || 0) * 0.18, 0, 1),
    acidity,
    fruit: clamp((floral * 0.25 + acidity * 0.35 + sweetness * 0.40), 0, 1),
    sweetness: clamp(sweetness + Number(controls.midWeight || 0) * 0.20, 0, 1),
    body,
    bitterRestraint: clamp(bitterRestraint + Number(controls.tailPenalty || 0) * 0.20, 0, 1),
    clarity: clamp(0.45 + floral * 0.25 + acidity * 0.18 - body * 0.12, 0.2, 0.95),
    feedbackApplied: Boolean(feedback)
  };
}

function window(id, label, markers, center, width, weight, risk = false) {
  return {
    id, label, markers, center: round(clamp(center, 0.02, 0.98), 4),
    width: round(clamp(width, 0.035, 0.30), 4),
    start: round(clamp(center - width * 1.6, 0, 1), 4),
    end: round(clamp(center + width * 1.6, 0, 1), 4),
    weight: round(clamp(weight, 0, 1.5), 4), risk
  };
}

export function buildFlavorWindows(bean, target, water, device) {
  const prior = CHEMISTRY_PRIORS[bean.priorKey] || CHEMISTRY_PRIORS.default;
  const phase = prior.phaseShift || CHEMISTRY_PRIORS.default.phaseShift;
  const c = bean.chemistry;
  const a = bean.axes;
  const roast = bean.roastDevelopment;
  const positive = [
    window('acid', '明亮酸与触觉窗口', /sl28/.test(bean.priorKey) ? ['磷酸触觉','柠檬酸骨架'] : ['有机酸骨架'],
      0.20 + phase.acid - (water.acidBuffer - 0.55) * 0.035,
      0.095 + target.acidity * 0.025,
      (c.acid / 10) * (0.35 + target.acidity * 0.65)),
    window('floral', '花香/茶感挥发窗口', prior.markers?.slice(0, 3) || ['挥发性芳香族群'],
      0.33 + phase.aroma - roast * 0.025,
      0.11 + bean.sensitivity.pulse * 0.025,
      ((a.floral + a.tea) / 20) * (0.30 + target.floral * 0.70) * water.aromaSupport),
    window('fruit', '果香/酯类代理窗口', ['果香酯类','醛酮类代理'],
      0.46 + (bean.process === 'anaerobic' ? 0.025 : 0),
      0.13,
      ((a.fruity + a.jammy + a.stonefruit) / 30) * (0.30 + target.fruit * 0.70)),
    window('sweetness', '甜感协同窗口', ['糖-美拉德前体代理','跨模态甜感'],
      0.59 + phase.aroma * 0.35,
      0.14 + target.sweetness * 0.025,
      (c.sweet / 10) * (0.28 + target.sweetness * 0.72)),
    window('body', '醇厚与质地窗口', ['可溶性高分子与油脂体感代理'],
      0.72 + target.body * 0.035,
      0.13,
      (bean.profile.body / 10) * (0.25 + target.body * 0.75) * water.bodySupport)
  ];
  const risks = [
    window('harsh-acid', '酸尖/刺激风险', ['高驱动早段','浸润不均'], 0.12, 0.065,
      clamp((c.acid / 10) * (1 - target.acidity * 0.35) * (1.05 - water.acidBuffer * 0.25), 0.12, 0.95), true),
    window('ferment-over', '发酵钝重风险', ['过程风味过表达'],
      0.57, 0.12,
      bean.process === 'anaerobic' ? 0.85 : bean.process === 'natural' ? 0.48 : 0.12, true),
    window('astringency', '干涩/收敛风险', ['细粉迁移','多酚与高流速扰动'], 0.82, 0.09,
      clamp(0.35 + device.clogging * 0.20 + bean.sensitivity.tail * 0.28, 0.20, 1.05), true),
    window('woody', '木质尾段风险', ['后段高分子与木质感代理'], 0.90, 0.075,
      clamp(0.30 + roast * 0.20 + bean.sensitivity.tail * 0.35, 0.18, 1.05), true),
    window('bitter', '苦味尾段风险', ['咖啡因/CGA降解物代理'], 0.95, 0.065,
      clamp((c.bitter / 10) * (0.45 + target.bitterRestraint * 0.75), 0.20, 1.20), true)
  ];
  return { positive, risks, all: [...positive, ...risks] };
}

function profileId(plan = {}) {
  return String(plan.profile?.id || String(plan.profileVersion || '').split('@')[0] || 'three-pulse');
}

function grinderStep(plan = {}) {
  const model = String(plan.grinder?.model || '').toLowerCase();
  if (/zp6/.test(model)) return 0.1;
  if (/k6/.test(model)) return 5;
  if (/c40|c5/.test(model)) return 1;
  return 0.5;
}

function targetDensityAt(x, windows) {
  const positive = windows.positive.reduce((sum, item) => sum + item.weight * gaussian(x, item.center, item.width), 0);
  const risk = windows.risks.reduce((sum, item) => sum + item.weight * gaussian(x, item.center, item.width), 0);
  return Math.max(0.001, positive - risk * 0.58);
}

function quantileFractions(count, windows) {
  if (count <= 1) return [1];
  const samples = 300;
  const density = [];
  let total = 0;
  for (let i = 0; i <= samples; i++) {
    const x = i / samples;
    const value = targetDensityAt(x, windows);
    density.push(value);
    total += value;
  }
  const boundaries = [];
  let accumulated = 0;
  let targetIndex = 1;
  for (let i = 0; i <= samples && targetIndex < count; i++) {
    accumulated += density[i];
    if (accumulated >= total * targetIndex / count) {
      boundaries.push(i / samples);
      targetIndex += 1;
    }
  }
  boundaries.push(1);
  const fractions = [];
  let previous = 0;
  for (const boundary of boundaries) {
    fractions.push(Math.max(0.02, boundary - previous));
    previous = boundary;
  }
  const sum = fractions.reduce((a, b) => a + b, 0);
  return fractions.map(value => value / sum);
}

function allocateInteger(total, fractions) {
  const exact = fractions.map(value => total * value);
  const values = exact.map(Math.floor);
  let remainder = total - values.reduce((a, b) => a + b, 0);
  const order = exact.map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remainder; i++) values[order[i % order.length].index] += 1;
  return values;
}

function profileWaterAllocation(basePlan, totalWater, dose, windows, bean) {
  const stages = basePlan.stages || [];
  const id = profileId(basePlan);
  if (!stages.length) return [];
  if (id === 'pulse-30x15') {
    const values = [];
    let remaining = totalWater;
    while (remaining > 0 && values.length < stages.length) {
      const value = Math.min(30, remaining);
      values.push(value);
      remaining -= value;
    }
    if (remaining > 0) values[values.length - 1] += remaining;
    while (values.length < stages.length) values.push(0);
    return values;
  }

  const baseFractions = stages.map(stage => Number(stage.stageWaterG || 0) / Math.max(1, Number(basePlan.totals?.waterG || totalWater)));
  const idealFractions = quantileFractions(stages.length, windows);
  let blend = baseFractions.map((value, index) => value * 0.62 + (idealFractions[index] || 0) * 0.38);

  const bloomTarget = clamp(dose * (2.25 + bean.chemistry.density / 18 + (1 - bean.roastDevelopment) * 0.35), 28, Math.min(62, totalWater * 0.26));
  blend[0] = clamp((blend[0] * totalWater * 0.45 + bloomTarget * 0.55) / totalWater, 0.10, 0.26);

  if (id === 'one-pour' && stages.length === 2) blend = [blend[0], 1 - blend[0]];
  if ((id === 'four-six-v17' || id === 'flat46-clean') && stages.length === 5) {
    const first40 = 0.40;
    const pairSum = Math.max(0.01, blend[0] + blend[1]);
    blend[0] = first40 * blend[0] / pairSum;
    blend[1] = first40 - blend[0];
    const restSum = Math.max(0.01, blend.slice(2).reduce((a, b) => a + b, 0));
    for (let i = 2; i < blend.length; i++) blend[i] = 0.60 * blend[i] / restSum;
  }
  if (id === 'five-pulse' && stages.length === 6) {
    for (let i = 1; i < blend.length; i++) blend[i] = clamp(blend[i], 0.10, 0.22);
  }
  const sum = blend.reduce((a, b) => a + b, 0);
  return allocateInteger(totalWater, blend.map(value => value / sum));
}

function stageProgress(index, count) {
  return count <= 1 ? 1 : index / (count - 1);
}

function rebuildCandidate(input, basePlan, models, controls) {
  const plan = clone(basePlan);
  const dose = Number(input.brew?.doseG || plan.totals?.doseG || 15);
  const baseRatio = Number(input.brew?.ratio || plan.totals?.ratio || 15.5);
  const hasExplicitRatio = Number.isFinite(Number(input.brew?.ratio));
const ratioLocked = input.brew?.ratioLocked === true
  || input.brew?.ratioMode === 'manual'
  || (hasExplicitRatio && input.brew?.ratioMode !== 'auto' && input.brew?.allowRatioOptimization !== true);
  const ratio = clamp(baseRatio + (ratioLocked ? 0 : controls.ratioDelta), 12.5, 19);
  const totalWater = Math.max(1, Math.round(dose * ratio));
  const waters = profileWaterAllocation(plan, totalWater, dose, models.windows, models.bean);
  const stages = plan.stages || [];
  const baseMainTemp = stages.length
    ? stages.slice(1).reduce((sum, item) => sum + Number(item.temperatureC || 90), 0) / Math.max(1, stages.length - 1)
    : 91;
  const mainTemp = clamp(baseMainTemp + controls.tempOffset, 80, 97);
  const flowBase = stages.length
    ? stages.slice(1).reduce((sum, item) => sum + Number(item.flowGPerSec || 4.4), 0) / Math.max(1, stages.length - 1)
    : 4.4;
  const flowCenter = clamp(flowBase + controls.flowOffset, models.device.minFlow, models.device.maxFlow);
  let cumulative = 0;
  let elapsed = 0;

  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index];
    const progress = stageProgress(index, stages.length);
    const water = waters[index] ?? Number(stage.stageWaterG || 0);
    const tailDrop = controls.tailDrop * Math.max(0, (progress - 0.45) / 0.55) ** 1.45;
    const aromaCooling = models.target.floral * gaussian(progress, 0.42, 0.22) * 0.45;
    const temperature = index === 0
      ? clamp(mainTemp - (2.4 + (1 - models.bean.roastDevelopment) * 1.7 + models.bean.chemistry.volatility / 12), 76, mainTemp - 1)
      : clamp(mainTemp - tailDrop - aromaCooling, 76, 97);
    const phaseFlow = index === 0 ? -0.45 : progress < 0.42 ? 0.25 : progress > 0.74 ? -0.30 : 0;
    const flow = clamp(flowCenter + phaseFlow, models.device.minFlow, models.device.maxFlow);
    const pourSeconds = water / Math.max(0.1, flow);
    let wait = models.device.drainWait * (index === 0 ? 1.25 : index === stages.length - 1 ? 1.10 : 0.72);
    if (profileId(plan) === 'one-pour' && index > 0) wait *= 0.55;
    if (profileId(plan) === 'pulse-30x15' && index > 0) wait = Math.max(0, 15 - pourSeconds);
    const bloomBase = Number(stage.durationSec || 35);
    const duration = index === 0
      ? clamp(bloomBase * controls.bloomFactor, 22, 75)
      : clamp(pourSeconds + wait, Math.max(8, pourSeconds), 52);
    cumulative += water;
    stage.index = index + 1;
    stage.startSec = round(elapsed);
    stage.durationSec = round(duration);
    stage.stageWaterG = water;
    stage.cumulativeWaterG = cumulative;
    stage.temperatureC = round(temperature);
    stage.flowGPerSec = round(flow, 1);
    stage.drainWaitSec = round(Math.max(0, duration - pourSeconds));
    stage.optimizerPhase = progress < 0.30 ? 'early' : progress < 0.72 ? 'middle' : 'tail';
    elapsed += duration;
  }

  plan.totals ||= {};
  plan.totals.doseG = round(dose, 1);
  plan.totals.ratio = round(ratio, 2);
  plan.totals.waterG = totalWater;
  plan.grinder ||= {};
  const step = grinderStep(plan);
  const baseGrind = Number(plan.grinder.recommended || 0);
  plan.grinder.recommended = round(baseGrind + controls.grindDelta * step, step < 1 ? 1 : 0);
  plan.grinder.optimizerDelta = round(controls.grindDelta, 2);
  plan.grinder.note = `${plan.grinder.note || ''} 逆向轨迹优化修正 ${controls.grindDelta >= 0 ? '+' : ''}${round(controls.grindDelta, 2)} 标准单位。`.trim();
  return plan;
}

function stageAt(stages, second) {
  return stages.find(item => second < Number(item.startSec || 0) + Number(item.durationSec || 0)) || stages.at(-1);
}

function simulateCandidate(input, plan, models, controls) {
  const stages = plan.stages || [];
  const totalTime = Math.max(1, stages.reduce((max, stage) => Math.max(max, Number(stage.startSec || 0) + Number(stage.durationSec || 0)), 0));
  const totalWater = Number(plan.totals?.waterG || 1);
  const targetEY = clamp(
    17.8
      + models.bean.roastDevelopment * 1.55
      + models.water.extractionPower * 0.85
      + models.device.contact * 0.45
      + models.target.sweetness * 0.55
      + models.target.body * 0.30
      - models.target.bitterRestraint * 0.70
      - (models.bean.chemistry.density - 6.5) * 0.12,
    17.1, 22.2
  );
  const samples = 81;
  const dt = totalTime / (samples - 1);
  const points = [];
  let extraction = 0;
  let lastWater = 0;
  const grindDrive = clamp(Math.exp(-controls.grindDelta * 0.16), 0.72, 1.34);
  const solubility = clamp(0.65 + models.bean.chemistry.solubility / 13, 0.75, 1.35);
  const positiveAccum = Object.fromEntries(models.windows.positive.map(item => [item.id, 0]));
  const positiveTarget = Object.fromEntries(models.windows.positive.map(item => [item.id, 0]));
  const riskAccum = Object.fromEntries(models.windows.risks.map(item => [item.id, 0]));

  for (let index = 0; index < samples; index++) {
    const second = index * dt;
    const stage = stageAt(stages, second);
    const within = clamp(second - Number(stage.startSec || 0), 0, Number(stage.durationSec || 1));
    const flow = Math.max(0.1, Number(stage.flowGPerSec || 4.4));
    const pourDuration = clamp(Number(stage.stageWaterG || 0) / flow, 0.4, Number(stage.durationSec || 1));
    const pouredFraction = clamp(within / pourDuration, 0, 1);
    const previousWater = Number(stage.cumulativeWaterG || 0) - Number(stage.stageWaterG || 0);
    const cumulativeWater = clamp(previousWater + Number(stage.stageWaterG || 0) * pouredFraction, 0, totalWater);
    const activeFlow = within <= pourDuration ? flow : 0;
    const waterProgress = clamp(cumulativeWater / totalWater, 0, 1);
    const coreTemp = Number(stage.temperatureC || 90)
      - models.device.thermalLoss
      - 0.55 * (within / Math.max(1, Number(stage.durationSec || 1)));
    const tempDrive = clamp(Math.exp((coreTemp - 88) / 23), 0.58, 1.55);
    const hydraulic = clamp(
      (activeFlow > 0 ? 0.72 + activeFlow / 11 : 0.42)
      * (0.78 + models.device.contact * 0.34)
      * (1.08 - models.device.bypass * 0.20)
      * models.device.permeability,
      0.35, 1.55
    );
    const freshWater = clamp((cumulativeWater - lastWater) / Math.max(1, totalWater / 12), 0, 1.6);
    const saturation = clamp(extraction / Math.max(0.01, targetEY / 100), 0, 1.2);
    const depletion = clamp(1.08 - saturation * 0.82, 0.10, 1.08);
    const rate = 0.00465
      * tempDrive * grindDrive * solubility * models.water.extractionPower
      * hydraulic * depletion * (0.42 + freshWater * 0.58);
    if (index > 0) extraction += rate * dt;
    extraction = clamp(extraction, 0, targetEY / 100 * 1.15);
    lastWater = cumulativeWater;

    const extractionN = clamp(extraction / Math.max(0.001, targetEY / 100), 0, 1.15);
    const rateN = clamp(rate / 0.014, 0, 1.6);
    const positiveSignals = {};
    let targetSignal = 0;
    let actualSignal = 0;
    for (const item of models.windows.positive) {
      const targetValue = item.weight * gaussian(waterProgress, item.center, item.width);
      const retention = item.id === 'floral'
        ? clamp(models.water.aromaSupport * (1.12 - Math.max(0, coreTemp - 91) * 0.035), 0.45, 1.25)
        : item.id === 'body' ? models.water.bodySupport : 1;
      const releasePosition = clamp(waterProgress * 0.65 + extractionN * 0.35, 0, 1.2);
      const actualValue = rateN * gaussian(releasePosition, item.center, item.width * 1.18) * retention;
      positiveSignals[item.id] = actualValue;
      targetSignal += targetValue;
      actualSignal += actualValue * item.weight;
      positiveAccum[item.id] += Math.min(targetValue, actualValue) * dt;
      positiveTarget[item.id] += targetValue * dt;
    }

    const fineRisk = Math.max(0, -controls.grindDelta) * 0.08;
    const highFlowRisk = Math.max(0, activeFlow - models.device.maxFlow * 0.86) * 0.07;
    const lateDrive = clamp((waterProgress - 0.68) / 0.32, 0, 1);
    const riskSignals = {};
    for (const item of models.windows.risks) {
      let dynamic = 1;
      if (item.id === 'harsh-acid') dynamic += Math.max(0, coreTemp - 92) * 0.05 + highFlowRisk;
      if (item.id === 'ferment-over') dynamic += Math.max(0, coreTemp - 91) * 0.04;
      if (item.id === 'astringency') dynamic += fineRisk + highFlowRisk + models.device.clogging * 0.08;
      if (item.id === 'woody' || item.id === 'bitter') dynamic += lateDrive * (0.35 + Math.max(0, coreTemp - 88) * 0.035);
      const value = rateN * gaussian(waterProgress, item.center, item.width) * item.weight * dynamic;
      riskSignals[item.id] = value;
      riskAccum[item.id] += value * dt;
    }

    const floral = clamp(positiveSignals.floral || 0, 0, 1);
    const acidity = clamp(positiveSignals.acid || 0, 0, 1);
    const sweetness = clamp(positiveSignals.sweetness || 0, 0, 1);
    const body = clamp(positiveSignals.body || 0, 0, 1);
    const bitterRisk = clamp((riskSignals.bitter || 0) + (riskSignals.woody || 0) * 0.45, 0, 1);
    const astringency = clamp(riskSignals.astringency || 0, 0, 1);
    points.push({
      x: round(index / (samples - 1), 4), second: round(second, 1), stage: Number(stage.index || 1),
      temperatureC: round(coreTemp, 2), flowGPerSec: round(activeFlow, 2),
      cumulativeWaterG: round(cumulativeWater, 1), cumulativeN: round(waterProgress, 4),
      extractionEY: round(extraction * 100, 2), extractionN: round(extractionN, 4),
      targetSignal: round(targetSignal, 4), actualSignal: round(actualSignal, 4),
      floral: round(floral, 4), acidity: round(acidity, 4), sweetness: round(sweetness, 4), body: round(body, 4),
      fruit: round(clamp(positiveSignals.fruit || 0, 0, 1), 4),
      bitterRisk: round(bitterRisk, 4), astringency: round(astringency, 4)
    });
  }

  const maxTarget = Math.max(0.001, ...points.map(point => point.targetSignal));
  const maxActual = Math.max(0.001, ...points.map(point => point.actualSignal));
  let fitError = 0;
  for (const point of points) fitError += ((point.targetSignal / maxTarget) - (point.actualSignal / maxActual)) ** 2;
  const targetFit = clamp(1 - Math.sqrt(fitError / points.length), 0, 1);
  const coverages = {};
  for (const item of models.windows.positive) {
    coverages[item.id] = clamp(positiveAccum[item.id] / Math.max(0.001, positiveTarget[item.id]), 0, 1);
  }
  const positiveCoverage = models.windows.positive.reduce((sum, item) => sum + coverages[item.id] * item.weight, 0)
    / Math.max(0.001, models.windows.positive.reduce((sum, item) => sum + item.weight, 0));
  const rawRiskExposure = models.windows.risks.reduce((sum, item) => sum + riskAccum[item.id] * item.weight, 0)
    / Math.max(1, totalTime * models.windows.risks.reduce((sum, item) => sum + item.weight, 0));
  const riskExposure = clamp(rawRiskExposure * 4.5, 0, 1);
  const finalEY = points.at(-1)?.extractionEY || 0;
  const eyFit = clamp(1 - Math.abs(finalEY - targetEY) / 4.2, 0, 1);
  const deviceViolation = points.reduce((sum, point) => sum + Math.max(0, point.flowGPerSec - models.device.maxFlow), 0) / points.length;
  const id = profileId(plan);
  const complexity = { 'one-pour':0.01,'two-pulse':0.02,'three-pulse':0.035,'four-six-v17':0.05,'flat46-clean':0.055,'five-pulse':0.075,'pulse-30x15':0.07 }[id] || 0.04;
  let compatibilityPenalty = 0;
  if (id === 'flat46-clean' && models.device.group !== 'flat') compatibilityPenalty += 0.16;
  if ((id === 'five-pulse' || id === 'pulse-30x15') && models.device.group === 'immersion') compatibilityPenalty += 0.10;
  if (id === 'one-pour' && models.target.floral > 0.82 && models.bean.chemistry.volatility > 8) compatibilityPenalty += 0.08;
  const objective = clamp(
    100 * (positiveCoverage * 0.38 + targetFit * 0.26 + eyFit * 0.18 + models.device.uniformity * 0.10 + (1 - riskExposure) * 0.18)
    - riskExposure * 38 - deviceViolation * 18 - complexity * 100 - compatibilityPenalty * 100,
    0, 100
  );

  const phases = stages.map(stage => ({
  index: Number(stage.index || 1),
  label: stage.name || `第${stage.index || 1}段`,
  start: round(Number(stage.startSec || 0) / totalTime, 4),
  end: round((Number(stage.startSec || 0) + Number(stage.durationSec || 0)) / totalTime, 4)
}));

return {
  version: TRAJECTORY_MODEL_VERSION,
  model: 'time-stepped-variable-release',
  optimizerModel: 'inverse-target-window-fit',
  axes: {
    timeSec: round(totalTime), waterG: totalWater,
    temperatureC: [76, 98], flowGPerSec: [0, round(models.device.maxFlow, 1)],
    extractionEY: round(targetEY, 2)
  },
  water: { ca: models.water.ca, mg: models.water.mg, hco3: models.water.hco3, tds: models.water.tds },
  phases,
  points,
  windows: models.windows.all,
    positiveCoverage: round(positiveCoverage, 4),
    coverageByFamily: Object.fromEntries(Object.entries(coverages).map(([key, value]) => [key, round(value, 4)])),
    riskExposure: round(riskExposure, 4),
    riskByFamily: Object.fromEntries(Object.entries(riskAccum).map(([key, value]) => [key, round(value / Math.max(1, totalTime), 5)])),
    targetFit: round(targetFit, 4),
    targetEY: round(targetEY, 2),
    predictedEY: round(finalEY, 2),
    eyFit: round(eyFit, 4),
    objectiveScore: round(objective, 2),
    drivers: {
      beanPrior: models.bean.priorKey, archetype: models.bean.archetypeId,
      deviceGroup: models.device.group, dripper: models.device.label, filterPaper: models.device.paperLabel,
      water: { ca: models.water.ca, mg: models.water.mg, hco3: models.water.hco3, tds: models.water.tds },
      controls: { ...controls }
    },
    disclaimer: '风味物质窗口是基于豆种、处理、烘焙和感官阈值的代理族群，不代表对单一化合物浓度的直接测量。'
  };
}

function candidateValues(center, offsets, min, max) {
  return [...new Set(offsets.map(value => round(clamp(center + value, min, max), 3)))];
}

function optimizeControls(input, basePlan, models, feedback) {
  const prior = feedback?.controls || {};
  let controls = {
    tempOffset: Number(prior.tempOffset || 0),
    flowOffset: Number(prior.flowOffset || 0),
    grindDelta: Number(prior.grindDelta || 0),
    ratioDelta: Number(prior.ratioDelta || 0),
    tailDrop: Number(prior.tailDrop || 3),
    bloomFactor: Number(prior.bloomFactor || 1)
  };
  let bestPlan = rebuildCandidate(input, basePlan, models, controls);
  let bestTrajectory = simulateCandidate(input, bestPlan, models, controls);

  const tailFloor = feedback?.flags?.overExtracted ? Math.min(9, Number(prior.tailDrop || 3)) : 0.5;
  const dimensions = [
    ['tempOffset', [-1.5,-0.75,0,0.75,1.5], -3, 3],
    ['flowOffset', [-0.6,-0.3,0,0.3,0.6], -1.2, 1.2],
    ['grindDelta', [-1.2,-0.6,0,0.6,1.2], -2.5, 2.5],
    ['ratioDelta', [-0.5,-0.25,0,0.25,0.5], -1.2, 1.2],
    ['tailDrop', [-1.5,-0.75,0,0.75,1.5], tailFloor, 9],
    ['bloomFactor', [-0.18,-0.09,0,0.09,0.18], 0.72, 1.35]
  ];

  for (let pass = 0; pass < 2; pass++) {
    for (const [key, offsets, min, max] of dimensions) {
      let localBest = { controls, plan: bestPlan, trajectory: bestTrajectory };
      for (const value of candidateValues(controls[key], offsets.map(offset => offset / (pass + 1)), min, max)) {
        const trialControls = { ...controls, [key]: value };
        const trialPlan = rebuildCandidate(input, basePlan, models, trialControls);
        const trialTrajectory = simulateCandidate(input, trialPlan, models, trialControls);
        if (trialTrajectory.objectiveScore > localBest.trajectory.objectiveScore + 1e-9) {
          localBest = { controls: trialControls, plan: trialPlan, trajectory: trialTrajectory };
        }
      }
      controls = localBest.controls;
      bestPlan = localBest.plan;
      bestTrajectory = localBest.trajectory;
    }
  }
  return { controls, plan: bestPlan, trajectory: bestTrajectory };
}

export function optimizeBrewPlan(input = {}, basePlan = {}, options = {}) {
  const feedback = options.feedback || null;
  const bean = buildBeanChemistryModel(input);
  const device = buildDeviceHydraulicModel(input);
  const water = buildWaterExtractionModel(input, basePlan);
  const target = buildPreferenceTarget(input, feedback);
  const windows = buildFlavorWindows(bean, target, water, device);
  const models = { bean, device, water, target, windows };
  const optimized = optimizeControls(input, basePlan, models, feedback);
  const plan = optimized.plan;
  const trajectory = optimized.trajectory;
  plan.trajectoryModel = trajectory;
  plan.professional ||= {};
  plan.professional.trajectoryModel = trajectory;
  plan.professional.inverseOptimization = {
    version: BREW_OPTIMIZER_VERSION,
    objectiveScore: trajectory.objectiveScore,
    positiveCoverage: trajectory.positiveCoverage,
    targetFit: trajectory.targetFit,
    riskExposure: trajectory.riskExposure,
    controls: optimized.controls,
    beanModel: bean,
    deviceModel: device,
    waterModel: water,
    targetModel: target,
    feedback
  };
  plan.optimizer = plan.professional.inverseOptimization;
  plan.engineVersion = `${plan.engineVersion || 'lucky-brew'}+${BREW_OPTIMIZER_VERSION}`;
  plan.extractionModel ||= {};
  plan.extractionModel.targetEY = trajectory.targetEY;
  plan.extractionModel.predictedEY = trajectory.predictedEY;
  plan.extractionModel.positiveCoverage = trajectory.positiveCoverage;
  plan.extractionModel.riskExposure = trajectory.riskExposure;
  plan.explanation = [
    ...(plan.explanation || []).filter(value => !String(value).includes('萃取轨迹')),
    `逆向求解先构造正面风味代理窗口与负面风险窗口，再搜索研磨、粉水比、温度、流量、等待和分段水量，使预测轨迹最大化目标覆盖并降低尾段风险。拟合分 ${trajectory.objectiveScore}。`,
    trajectory.disclaimer
  ];
  plan.warnings = [...new Set([
    ...(plan.warnings || []),
    bean.uncertainty > 0.35 ? '豆种/产地信息不足，化学先验不确定性较高；建议通过品鉴反馈继续校准。' : ''
  ].filter(Boolean))];
  return plan;
}

export function optimizerProfileIds(input = {}) {
  const group = buildDeviceHydraulicModel(input).group;
  const ids = [...PROFILE_IDS];
  if (group !== 'flat') return ids.filter(id => id !== 'flat46-clean');
  return ids;
}

export function summarizeCandidate(plan) {
  return {
    profileId: profileId(plan),
    score: Number(plan.optimizer?.objectiveScore || 0),
    positiveCoverage: Number(plan.optimizer?.positiveCoverage || 0),
    targetFit: Number(plan.optimizer?.targetFit || 0),
    riskExposure: Number(plan.optimizer?.riskExposure || 0),
    controls: plan.optimizer?.controls || {}
  };
}
