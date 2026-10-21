/**
 * Declared detector families; the current configuration validator accepts only zscore and iqr.
 * @see {@link analyzeLatestMetric}
 */
export type AIAnomalyAlgorithm = 'zscore' | 'iqr' | 'ewma'
/**
 * Severity derived from the detector threshold ratio.
 * @see {@link analyzeLatestMetric}
 */
export type AIAnomalySeverity = 'info' | 'warning' | 'critical'

/**
 * Finite numeric observation with caller-defined timestamp units and optional labels.
 * @see {@link analyzeLatestMetric}
 */
export interface AINumericMetricPoint {
  
  
  /** Finite caller-defined numeric time coordinate; points must be in nondecreasing order and use consistent units. */
  timestamp: number
  
  
  /** Finite numeric observation compared with preceding history; all points for a metric must use consistent units. */
  value: number
  
/** Optional provider labels or metric dimensions carried without framework interpretation. */
  labels?: Readonly<Record<string, string>>
}

/**
 * History threshold and detector tuning for latest-point analysis.
 * @see {@link analyzeLatestMetric}
 */
export interface AIAnomalyConfig {
  
/** Minimum historical points, from 2 to 10000; defaults to 30 and excludes the latest point. */
  minSamples?: number
  
/** Detector sensitivity strictly between zero and one; defaults to 0.95 for z-score thresholds. */
  sensitivity?: number
  
/** Detector order; defaults to zscore and iqr. Current validation rejects ewma despite its declared type. */
  algorithms?: readonly AIAnomalyAlgorithm[]
  
/** EWMA smoothing factor greater than zero and at most one; defaults to 0.3, though ewma selection is currently rejected. */
  ewmaAlpha?: number
}

/**
 * Estimated history envelope and population mean/standard deviation.
 * @see {@link analyzeLatestMetric}
 */
export interface AIAnomalyExpectedRange {
  
/** Estimated lower history bound for the detector output. */
  min: number
  
/** Estimated upper history bound for the detector output. */
  max: number
  
/** Arithmetic mean of the history used for the detector result. */
  mean: number
  
/** Population standard deviation of the history used for the detector result. */
  stdDev: number
}

/**
 * One detector outcome for the latest point with bounded score and optional diagnostics.
 * @see {@link analyzeLatestMetric}
 */
export interface AIAnomalyResult {
  
/** Whether the latest value crosses the selected detector threshold. */
  detected: boolean
  
/** Detector that produced this result. */
  algorithm: AIAnomalyAlgorithm
  
/** Nonempty metric label used to correlate the detector result. */
  metric: string
  
  
  /** Timestamp coordinate copied from the latest metric point, in the input metric units. */
  timestamp: number
  
  
  /** Latest observation value copied into this detector result. */
  value: number
  
/** Provider/detector relevance or anomaly score; interpret using the owning result contract. */
  score: number
  
  /** Handling/alert severity attached to the classified error or detector result. */
  severity: AIAnomalySeverity
  
/** Optional estimated history envelope; absent for insufficient samples. */
  expectedRange?: AIAnomalyExpectedRange
  
/** Optional numeric diagnostics, including sample counts or detector threshold components. */
  details?: Readonly<Record<string, number>>
}

const DEFAULT_ALGORITHMS: readonly AIAnomalyAlgorithm[] = ['zscore', 'iqr']

/**
 * Analyze the last metric point against prior points without persistence or side effects.
 * Hosts/plugins own buffering, cooldowns, alert routing and durable audit records.
 * @param input - Nonempty metric name, nonempty finite observations ordered by timestamp, and optional detection configuration. Timestamp units are caller-defined and must be consistent.
 * @returns One result per configured algorithm, in configuration order; insufficient history yields detected false with sample counts.
 * @throws Error for invalid metric, observations or configuration. The current validator accepts zscore/iqr and rejects ewma even though the algorithm type includes it.
 * @remarks Defaults: 30 historical samples, sensitivity 0.95, zscore/iqr and ewmaAlpha 0.3. No buffering, alerts or durable audit records are created.
 * @example
 * ```typescript
 * import { analyzeLatestMetric } from "@alneas/eaos-core/ai/anomaly";
 * const results = analyzeLatestMetric({ metric: "latency", points: [{ timestamp: 1, value: 10 }, { timestamp: 2, value: 10 }, { timestamp: 3, value: 100 }], config: { minSamples: 2 } });
 * console.log(results.map(result => result.detected));
 * ```
 */
export function analyzeLatestMetric(input: {
  
  /**
   * Nonblank metric label included in each detector result.
   */
  metric: string
  
  /**
   * Nonempty finite observations ordered by nondecreasing timestamp; the last point is tested against preceding history without changing the input array.
   */
  points: readonly AINumericMetricPoint[]
  
  /**
   * Optional detector settings; defaults are 30 prior samples, sensitivity 0.95, zscore/iqr and alpha 0.3. Current validation rejects ewma selection.
   */
  config?: AIAnomalyConfig
}): readonly AIAnomalyResult[] {
  if (typeof input.metric !== 'string' || !input.metric.trim()) throw new Error('Metric name is required')
  if (!Array.isArray(input.points) || input.points.length === 0) throw new Error('At least one metric point is required')
  for (let i = 0; i < input.points.length; i++) {
    const point = input.points[i]
    if (!Number.isFinite(point.timestamp) || !Number.isFinite(point.value)) throw new Error('Metric points must contain finite timestamp and value')
    if (i > 0 && point.timestamp < input.points[i - 1].timestamp) throw new Error('Metric points must be ordered by timestamp')
  }

  const config = normalizeConfig(input.config)
  const latest = input.points.at(-1)!
  const history = input.points.slice(0, -1).map(point => point.value)
  return config.algorithms.map(algorithm => {
    if (history.length < config.minSamples) return createInsufficientResult(input.metric, latest, algorithm, history.length, config.minSamples)
    if (algorithm === 'zscore') return analyzeZScore(input.metric, latest, history, config.sensitivity)
    if (algorithm === 'iqr') return analyzeIqr(input.metric, latest, history)
    return analyzeEwma(input.metric, latest, history, config.ewmaAlpha, config.sensitivity)
  })
}

function normalizeConfig(config: AIAnomalyConfig | undefined): Required<AIAnomalyConfig> {
  const minSamples = config?.minSamples ?? 30
  const sensitivity = config?.sensitivity ?? 0.95
  const algorithms = config?.algorithms ?? DEFAULT_ALGORITHMS
  const ewmaAlpha = config?.ewmaAlpha ?? 0.3
  if (!Number.isSafeInteger(minSamples) || minSamples < 2 || minSamples > 10000) throw new Error('Invalid anomaly minSamples')
  if (!Number.isFinite(sensitivity) || sensitivity <= 0 || sensitivity >= 1) throw new Error('Invalid anomaly sensitivity')
  if (!algorithms.length || algorithms.some(algorithm => !DEFAULT_ALGORITHMS.includes(algorithm))) throw new Error('Invalid anomaly algorithm')
  if (!Number.isFinite(ewmaAlpha) || ewmaAlpha <= 0 || ewmaAlpha > 1) throw new Error('Invalid anomaly ewmaAlpha')
  return { minSamples, sensitivity, algorithms, ewmaAlpha }
}

function analyzeZScore(metric: string, latest: AINumericMetricPoint, values: readonly number[], sensitivity: number): AIAnomalyResult {
  const mean = average(values)
  const stdDev = standardDeviation(values, mean)
  const threshold = zScoreThreshold(sensitivity)
  const zScore = stdDev === 0 ? (latest.value === mean ? 0 : Number.POSITIVE_INFINITY) : Math.abs((latest.value - mean) / stdDev)
  return createResult(metric, latest, 'zscore', zScore, threshold, {
    expectedRange: { min: mean - threshold * stdDev, max: mean + threshold * stdDev, mean, stdDev },
    details: { mean, stdDev, zScore, threshold },
  })
}

function analyzeIqr(metric: string, latest: AINumericMetricPoint, values: readonly number[]): AIAnomalyResult {
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = percentile(sorted, 0.25)
  const q3 = percentile(sorted, 0.75)
  const iqr = q3 - q1
  const lower = q1 - 1.5 * iqr
  const upper = q3 + 1.5 * iqr
  const distance = iqr === 0 ? (latest.value === q1 ? 0 : Number.POSITIVE_INFINITY) : latest.value < lower ? (lower - latest.value) / iqr : latest.value > upper ? (latest.value - upper) / iqr : 0
  return createResult(metric, latest, 'iqr', distance, 0, {
    expectedRange: { min: lower, max: upper, mean: average(values), stdDev: standardDeviation(values) },
    details: { q1, q3, iqr, lower, upper, distance },
  })
}

function analyzeEwma(metric: string, latest: AINumericMetricPoint, values: readonly number[], alpha: number, sensitivity: number): AIAnomalyResult {
  let mean = values[0]
  let variance = 0
  for (const value of values.slice(1)) {
    const error = value - mean
    variance = (1 - alpha) * variance + alpha * error * error
    mean += alpha * error
  }
  const stdDev = Math.sqrt(variance)
  const threshold = zScoreThreshold(sensitivity)
  const zScore = stdDev === 0 ? (latest.value === mean ? 0 : Number.POSITIVE_INFINITY) : Math.abs((latest.value - mean) / stdDev)
  return createResult(metric, latest, 'ewma', zScore, threshold, {
    expectedRange: { min: mean - threshold * stdDev, max: mean + threshold * stdDev, mean, stdDev },
    details: { mean, variance, stdDev, zScore, threshold, alpha },
  })
}

function createInsufficientResult(metric: string, point: AINumericMetricPoint, algorithm: AIAnomalyAlgorithm, actual: number, required: number): AIAnomalyResult {
  return { detected: false, algorithm, metric, timestamp: point.timestamp, value: point.value, score: 0, severity: 'info', details: { samples: actual, requiredSamples: required } }
}

function createResult(metric: string, point: AINumericMetricPoint, algorithm: AIAnomalyAlgorithm, distance: number, threshold: number, extra: { expectedRange: AIAnomalyExpectedRange; details: Readonly<Record<string, number>> }): AIAnomalyResult {
  const ratio = threshold > 0 ? distance / threshold : distance
  const detected = threshold > 0 ? distance >= threshold : distance > 0
  return { detected, algorithm, metric, timestamp: point.timestamp, value: point.value, score: Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio / 2)) : 1, severity: detected ? ratio >= 2 ? 'critical' : 'warning' : 'info', expectedRange: extra.expectedRange, details: extra.details }
}

function average(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length }

function standardDeviation(values: readonly number[], mean = average(values)): number { return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) }

function percentile(sorted: readonly number[], fraction: number): number {
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index), upper = Math.ceil(index)
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

function zScoreThreshold(sensitivity: number): number {
  if (sensitivity <= 0.9) return 1.645
  if (sensitivity <= 0.95) return 1.96
  if (sensitivity <= 0.975) return 2.24
  if (sensitivity <= 0.99) return 2.576
  if (sensitivity <= 0.995) return 2.81
  return 3.29
}
