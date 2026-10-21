import { describe, expect, test } from 'bun:test'
import { calculateRetryDelay, classifyAIError } from './resilience'

describe('AI resilience helpers', () => {
  test('classifies the first matching rule and preserves verified context', () => {
    const result = classifyAIError({
      error: new Error('request returned 429 rate limit'),
      rules: [
        { pattern: 'validation', code: 'ERR_VALIDATION', category: 'validation', severity: 'error', retryable: false, hint: 'Fix input' },
        { pattern: '429|rate limit', code: 'ERR_RATE_LIMIT', category: 'llm', severity: 'warning', retryable: true, hint: 'Retry later' },
      ],
      context: { tenantId: 'tenant-1', traceId: 'trace-1' },
    })
    expect(result).toMatchObject({ code: 'ERR_RATE_LIMIT', category: 'llm', retryable: true, context: { tenantId: 'tenant-1' } })
  })

  test('returns a closed fallback for unknown errors', () => {
    expect(classifyAIError({ error: { message: 'not an Error instance' }, rules: [] })).toMatchObject({ code: 'ERR_UNKNOWN', retryable: false, severity: 'error' })
  })

  test('calculates capped exponential delay with injected jitter', () => {
    const policy = { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 250, backoffMultiplier: 2, jitterFactor: 0.5 }
    expect(calculateRetryDelay({ attempt: 1, policy, random: 0 })).toBe(100)
    expect(calculateRetryDelay({ attempt: 2, policy, random: 1 })).toBe(250)
    expect(() => calculateRetryDelay({ attempt: 0, policy })).toThrow()
  })
})
