import { clamp, sha256Hex } from './utils.js';

export const FALLBACK_ENGINE_VERSION = 'fallback-0.6.0';

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
  let temperature = 94 - level * 1.25;
  if (process.natural) temperature -= 1;
  if (process.washed) temperature += 0.5;
  temperature = Math.round(clamp(temperature, 84, 96));
  const bloom = Math.round(clamp(dose * (level <= 1 ? 3 : 2.5), 28, 55));
  const remaining = total - bloom;
  const weightsByCount = {
    2: [0.58, 0.42], 3: [0.42, 0.34, 0.24], 4: [0.32, 0.28, 0.22, 0.18], 5: [0.24, 0.22, 0.20, 0.18, 0.16]
  };
  const weights = weightsByCount[segments] || weightsByCount[4];
  const stages = [{
    index: 1, name: '闷蒸', startSec: 0, durationSec: level <= 1 ? 40 : 32,
    stageWaterG: bloom, cumulativeWaterG: bloom, temperatureC: Math.max(84, temperature - 2),
    flowGPerSec: 2.5, method: '中心湿润并轻摇'
  }];
  let cumulative = bloom;
  let elapsed = stages[0].durationSec;
  for (let i = 0; i < segments; i++) {
    let water = i === segments - 1 ? total - cumulative : Math.round(remaining * weights[i]);
    cumulative += water;
    const tail = i === segments - 1;
    const duration = Math.round(clamp(water / (tail ? 4.5 : 3.8) + (tail ? 8 : 12), 22, 48));
    stages.push({
      index: i + 2, name: `第 ${i + 2} 段`, startSec: elapsed, durationSec: duration,
      stageWaterG: water, cumulativeWaterG: cumulative, temperatureC: tail ? Math.max(84, temperature - 1) : temperature,
      flowGPerSec: tail ? 4.5 : 3.8,
      method: tail ? '大水流快速收尾，减少浸泡' : (i % 2 ? '中心至外圈稳定注水' : '外圈至中心大水流注水')
    });
    elapsed += duration;
  }
  stages.at(-1).cumulativeWaterG = total;
  const profileVersion = method === 'pourover' ? 'pourover-flatbed-fastflow-2026.07' : `${method}-basic-2026.07`;
  return {
    schemaVersion: 1,
    engineVersion: FALLBACK_ENGINE_VERSION,
    profileVersion,
    inputHash: await inputHash(input),
    source: 'local-fallback',
    stages,
    totals: { doseG: dose, waterG: total, ratio, targetTimeSec: elapsed },
    warnings: ['当前使用本地回退引擎；私有 brew-profiles API 未返回有效结果。'],
    explanation: [
      '平底滤杯、较细研磨和较大水流用于提高均匀性与清晰度。',
      '每段结束减少无控制浸泡，以降低杂味豆尾段过萃风险。'
    ],
    trajectory: stages.map((stage, i) => ({ x: stage.cumulativeWaterG / total, y: clamp(0.18 + i * 0.16 - level * 0.015, 0.1, 0.95) })),
    flavorFit: { floral: level <= 2 ? 0.82 : 0.45, acidity: clamp(0.84 - level * 0.1, 0.25, 0.9), sweetness: process.natural ? 0.84 : 0.72, body: clamp(0.42 + level * 0.08, 0.35, 0.9) }
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
  for (const stage of plan.stages) {
    for (const key of ['index', 'durationSec', 'stageWaterG', 'cumulativeWaterG', 'temperatureC']) {
      if (!Number.isFinite(Number(stage[key]))) throw new Error(`阶段字段 ${key} 无效`);
    }
    if (Number(stage.cumulativeWaterG) < last) throw new Error('累计注水量倒退');
    last = Number(stage.cumulativeWaterG);
  }
  return plan;
}
