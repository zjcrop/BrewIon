import { sha256Hex } from '../utils.js';

const ANALYSIS_CONTRACT = 'brew-analysis/2.0';
const SPATIAL_CONTRACT = 'brew-spatial/1.1';

function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function stagePath(input, plan) {
  const ambient = number(input?.environment?.ambientTemperatureC ?? input?.brew?.ambientTemperatureC, 25);
  const points = [[0, ambient, 0]];
  for (const stage of plan?.stages || []) {
    const start = number(stage.startSec ?? stage.start, points.at(-1)?.[0] || 0);
    const duration = Math.max(1, number(stage.durationSec, number(stage.end, start) - start || 1));
    const end = number(stage.end, start + duration);
    const temperature = number(stage.coreTemperatureC ?? stage.temperatureC ?? stage.pourTemperature ?? stage.temp, 90);
    const cumulative = number(stage.cumulativeWaterG ?? stage.cumulative, points.at(-1)?.[2] || 0);
    points.push([end, temperature, cumulative]);
  }
  return points.length >= 2 ? points : [[0, ambient, 0], [1, ambient, 0]];
}

export async function createLocalReferenceAnalysis(input, plan, reason = '') {
  const path = stagePath(input, plan);
  const fingerprint = `local:${await sha256Hex(JSON.stringify({ input, stages: plan?.stages || [] }))}`;
  const trajectory = {
    schemaVersion: SPATIAL_CONTRACT,
    generatedBy: 'luckybean-local-reference/1.0.0',
    planFingerprint: fingerprint,
    axes: {
      x: { id: 'time_s', label: '时间', unit: 's' },
      y: { id: 'bed_temperature_c', label: '粉床温度', unit: '°C' },
      z: { id: 'cumulative_water_g', label: '累计注水量', unit: 'g' }
    },
    bounds: {
      min: [Math.min(...path.map(point => point[0])), Math.min(...path.map(point => point[1])), Math.min(...path.map(point => point[2]))],
      max: [Math.max(...path.map(point => point[0])), Math.max(...path.map(point => point[1])), Math.max(...path.map(point => point[2]))]
    },
    path,
    targets: [],
    signals: {},
    aggregate: { positive: [], negative: [], net: [] },
    summary: [],
    prediction: {
      suitability: 0,
      positiveNegativeRatio: 0,
      verdict: '本地参考方案仅提供执行方向，不生成专业风味靶区判断。',
      strengths: [],
      risks: reason ? [reason] : [],
      confidence: 'local-reference'
    },
    trajectoryModel: {
      initialBedTemperature: path[0][1],
      initialCumulativeWater: 0,
      sampleIntervalSeconds: 1,
      temperatureBasis: 'stage-reference-only',
      waterBasis: 'stage-cumulative-reference'
    },
    rendering: {
      background: '#ffffff',
      pathColor: '#202225',
      cloudGradient: ['#d9e7ef', '#eef4f7'],
      spaceColor: 'rgba(188,223,241,.18)',
      gridColor: 'rgba(146,153,160,.22)',
      viewportAspect: 'fullscreen',
      verticalScale: 1
    }
  };
  return {
    contract: ANALYSIS_CONTRACT,
    requestId: `local-${crypto.randomUUID()}`,
    generatedAt: new Date().toISOString(),
    analysisFingerprint: fingerprint,
    engine: { endpoint: 'local-reference', apiVersion: '1.0.0', outputContract: 'local-reference-plan/1.0' },
    input: structuredClone(input || {}),
    plan: structuredClone(plan || {}),
    trajectory,
    prediction: trajectory.prediction,
    integrations: {
      sourceVersions: {},
      beanDataAvailable: true,
      waterDataAvailable: true,
      grinderReference: null,
      providerWarnings: ['当前为本地参考计算，未调用BrewProfiles专业引擎。']
    },
    warnings: ['当前为本地参考计算，结果用于方向判断，不作为专业模型输出。', ...(reason ? [reason] : [])]
  };
}
