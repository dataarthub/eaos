import { describe, expect, test } from 'bun:test'
import { analyzeLatestMetric } from './anomaly'

const points = (values: readonly number[]) => values.map((value, index) => ({ timestamp: index, value }))

describe('AI anomaly analyzer', () => {
  test('does not use the latest point to dilute its own baseline', () => {
    const result = analyzeLatestMetric({ metric: 'occupancy', points: points([...Array(30).fill(100), 150]), config: { algorithms: ['zscore'], minSamples: 30 } })[0]
    expect(result.detected).toBe(true)
    expect(result.algorithm).toBe('zscore')
    expect(result.expectedRange?.mean).toBe(100)
    expect(result.severity).toBe('critical')
  })

  test('supports IQR and returns no signal until enough history exists', () => {
    const insufficient = analyzeLatestMetric({ metric: 'revenue', points: points([1, 2, 3]), config: { algorithms: ['iqr'], minSamples: 3 } })[0]
    expect(insufficient.detected).toBe(false)
    expect(insufficient.details).toEqual({ samples: 2, requiredSamples: 3 })

    const result = analyzeLatestMetric({ metric: 'revenue', points: points([...Array(30).fill(10), 100]), config: { algorithms: ['iqr'], minSamples: 30 } })[0]
    expect(result.detected).toBe(true)
    expect(result.expectedRange?.mean).toBe(10)
  })

  test('rejects unordered or non-finite input', () => {
    expect(() => analyzeLatestMetric({ metric: 'x', points: [{ timestamp: 2, value: 1 }, { timestamp: 1, value: 2 }] })).toThrow('ordered')
    expect(() => analyzeLatestMetric({ metric: 'x', points: [{ timestamp: 1, value: Number.NaN }] })).toThrow('finite')
  })
})
