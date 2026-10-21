import { describe, expect, test } from 'bun:test'
import { assertStorageBudget, assertStorageUsage } from './index'

describe('storage capacity contracts', () => {
  test('accepts tenant-plane usage and budgets', () => {
    expect(assertStorageUsage({ tenantId: 'tenant-a', measuredAt: '2026-09-23T00:00:00.000Z', bytes: { database: 10, object: 20, vector: 30, graph: 40 } }).bytes.graph).toBe(40)
    expect(assertStorageBudget({ tenantId: 'tenant-a', limits: { database: 20 * 1024 ** 3 }, warnAtRatio: 0.8 }).warnAtRatio).toBe(0.8)
  })

  test('rejects invalid plane, negative size and invalid warning ratio', () => {
    expect(() => assertStorageUsage({ tenantId: 'tenant-a', measuredAt: '2026-09-23T00:00:00.000Z', bytes: { archive: 1 } as never })).toThrow('plane')
    expect(() => assertStorageBudget({ tenantId: 'tenant-a', limits: { database: -1 } })).toThrow('limit')
    expect(() => assertStorageBudget({ tenantId: 'tenant-a', limits: {}, warnAtRatio: 1.1 })).toThrow('warning')
  })
})
