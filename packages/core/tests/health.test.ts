import { describe, expect, test } from 'bun:test'
import { createLivenessReport, runReadinessChecks } from '../src/health/index'

describe('health contracts', () => {
  test('liveness does not inspect dependencies', () => {
    expect(createLivenessReport(new Date('2026-09-19T00:00:00.000Z'))).toEqual({ state: 'alive', checkedAt: '2026-09-19T00:00:00.000Z' })
  })

  test('critical failures make readiness unavailable while optional failures degrade', async () => {
    await expect(runReadinessChecks([{ id: 'database', run: async () => false }], new Date('2026-09-19T00:00:00.000Z'))).resolves.toMatchObject({ state: 'not_ready', checks: [{ state: 'failed', critical: true }] })
    await expect(runReadinessChecks([{ id: 'telemetry', critical: false, run: () => false }], new Date('2026-09-19T00:00:00.000Z'))).resolves.toMatchObject({ state: 'degraded', checks: [{ state: 'failed', critical: false }] })
  })

  test('timeouts are bounded and do not expose the thrown error', async () => {
    const report = await runReadinessChecks([{ id: 'database', timeoutMs: 5, run: () => new Promise<boolean>(() => {}) }])
    expect(report.state).toBe('not_ready')
    expect(report.checks[0]).toMatchObject({ id: 'database', state: 'timed_out' })
    expect(report.checks[0]).not.toHaveProperty('error')
  })
})
