import { clamp, sha256Hex } from './utils.js';

export const FALLBACK_ENGINE_VERSION = 'fallback-0.7.0';

function roastLevel(code) { return Number(String(code || 'RL-L2').replace(/\D/g, '')) || 2; }
function processBias(code = '') {
  const c = code.toUpperCase();
  return {
    natural: /NAT|DRY|ANA|CM|CARBON/.test(c),
    washed: /WAS|WASH/.test(c),
    honey: /HON/.test(c)
  };
}

export async function inputHash(input) { return `sha256:${await sha256Hex(JSON.stringify(input))}`; }

export async function computeFallbackPlan(input) {
  const dose = clamp(input.brew?.doseG || 15, 5, 40);
  const ratio = clamp(input.brew?.ratio || 15.5, 8, 25);
  const total = Math.round(dose * ratio);
  const level = roastLevel(input.bean?.roastCode);
  const process = processBias(input.bean?.processCode);
  const method = input.brew?.method || 'pourover';
  const segments = clamp(input.brew?.segments || 4, 2, 5);
  const waterProfile = input.water?.profile || '平衡水';
  const targets = input.targets || {};
  let temperature = 94 - level * 1.25;
  if (process.natural) temperature -= 1;
  if (process.washed) temperature += 0.5;
  if (waterProfile === '抑酸水') temperature += 0.5;
  if (waterProfile === '花香水') temperature -= 0.5;
  temperature = Math.round(clamp(temperature, 84, 96));
  const lowTempFirst = input.brew?.lowTempFirst !== false;
  const firstTemperature = lowTempFirst ? Math.max(84, temperature - (level <= 1 ? 3 : 2)) : temperature;
  const bloom = Math.round(clamp(dose * (level <= 1 ? 3 : 2.5), 28, 55));
  const remaining = total - bloom;
  const weightsByCount = {
    2: [0.58, 0.42], 3: [0.42, 0.34, 0.24], 4: [0.32, 0.28, 0.22, 0.18], 5: [0.24, 0.22, 0.20, 0.18, 0.16]
  };
  const weights = weightsByCount[segments] || weightsByCount[4];
  const stages = [{
    index: 1, name: '闷蒸', startSec: 0, durationSec: level <= 1 ? 40 : 32,
    stageWaterG: bloom, cumulativeWaterG: bloom, temperatureC: firstTemperature,
    flowGPerSec: 2.5, method: level <= 1 ? '中心湿润，轻柔摇匀粉床' : '中心湿润并轻摇'
  }];
  let cumulative = bloom;
  let elapsed = stages[0].durationSec;
  for (let i = 0; i < segments; i++) {
    const water = i === segments - 1 ? total - cumulative : Math.round(remaining * weights[i]);
    cumulative += water;
    const tail = i === segments - 1;
    const floralBias = Number(targets.floral || 0) > Number(targets.body || 0);
    const duration = Math.round(clamp(water / (tail ? 4.6 : floralBias ? 4.1 : 3.7) + (tail ? 7 : 11), 20, 48));
    stages.push({
      index: i + 2, name: tail ? '收尾' : `主萃 ${i + 1}`, startSec: elapsed, durationSec: duration,
      stageWaterG: water, cumulativeWaterG: cumulative, temperatureC: tail ? Math.max(84, temperature - 1) : temperature,
      flowGPerSec: tail ? 4.6 : floralBias ? 4.1 : 3.7,
      method: tail ? '提高流量快速收尾，控制尾段浸泡' : (i % 2 ? '中心至外圈稳定注水，液位不过高' : '外圈至中心连续注水，段间不刻意停顿')
    });
    elapsed += duration;
  }
  stages.at(-1).cumulativeWaterG = total;
  const naturalBoost = process.natural ? 0.09 : 0;
  const targetScale = value => clamp(0.55 + Number(value || 0) * 0.12, 0.35, 0.95);
  return {
    schemaVersion: 1,
    engineVersion: FALLBACK_ENGINE_VERSION,
    profileVersion: method === 'pourover' ? 'pourover-v11-compatible-2026.07' : `${method}-complete-2026.07`,
    inputHash: await inputHash(input),
    source: 'local-fallback',
    stages,
    totals: { doseG: dose, waterG: total, ratio, targetTimeSec: elapsed },
    warnings: [],
    firstPourReason: lowTempFirst ? (level <= 2 ? '浅烘初段降温可抑制表层快速释放，保留花香、酸质和后段甜感。' : '初段小幅降温可降低苦涩物质的早期释放。') : '已按主萃温度执行，适合需要更高萃取推动力的设定。',
    explanation: [
      `模型根据烘焙度、处理法、${segments + 1}段注水和目标风味调整水温、流速与段间节奏。`,
      '连续控制液位并缩短尾段停留，避免后段无控制浸泡。'
    ],
    trajectory: stages.map((stage, index) => ({ x: stage.cumulativeWaterG / total, y: clamp(0.16 + index * (0.72 / Math.max(1, stages.length - 1)) - level * 0.012 + naturalBoost * 0.2, 0.08, 0.94) })),
    flavorFit: {
      floral: clamp(targetScale(targets.floral) + (level <= 2 ? 0.10 : -0.08), 0.2, 0.96),
      acidity: clamp(targetScale(targets.acidity) + (level <= 2 ? 0.08 : -0.06), 0.2, 0.94),
      sweetness: clamp(targetScale(targets.sweetness) + naturalBoost, 0.25, 0.96),
      body: clamp(targetScale(targets.body) + level * 0.025, 0.25, 0.95)
    }
  };
}

export async function requestPrivatePlan(endpoint, input, timeoutMs = 9000) {
  if (!endpoint) throw new Error('未配置私有冲煮 API 地址');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input), signal: controller.signal, credentials: 'omit'
    });
    if (!response.ok) throw new Error(`冲煮 API HTTP ${response.status}`);
    const plan = await response.json();
    validatePlan(plan);
    return { ...plan, source: 'private-api' };
  } finally { clearTimeout(timer); }
}

export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('方案响应不是对象');
  if (plan.schemaVersion !== 1) throw new Error('方案 Schema 版本不兼容');
  if (!plan.engineVersion || !plan.profileVersion) throw new Error('方案缺少版本信息');
  if (!Array.isArray(plan.stages) || !plan.stages.length) throw new Error('方案缺少阶段');
  let last = 0;
  let total = 0;
  for (const stage of plan.stages) {
    for (const key of ['index', 'durationSec', 'stageWaterG', 'cumulativeWaterG', 'temperatureC']) {
      if (!Number.isFinite(Number(stage[key]))) throw new Error(`阶段字段 ${key} 无效`);
    }
    if (Number(stage.cumulativeWaterG) < last) throw new Error('累计注水量倒退');
    if (Number(stage.durationSec) <= 0 || Number(stage.stageWaterG) < 0) throw new Error('阶段时间或注水量无效');
    total += Number(stage.stageWaterG);
    last = Number(stage.cumulativeWaterG);
  }
  if (Number.isFinite(Number(plan.totals?.waterG)) && Math.abs(total - Number(plan.totals.waterG)) > 1) throw new Error('分段注水量与总量不守恒');
  return plan;
}
