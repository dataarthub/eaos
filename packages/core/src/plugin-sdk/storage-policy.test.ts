import { describe, expect, test } from 'bun:test'
import { assertPayloadWithinPolicy, assertPluginStoragePolicy, resolvePluginStoragePolicy } from './storage-policy'

describe('plugin storage policy', () => {
  test('resolves a default and enforces payload bytes', () => {
    const policy = resolvePluginStoragePolicy()
    expect(policy.maxPayloadBytes).toBe(4 * 1024 * 1024)
    expect(() => assertPayloadWithinPolicy({ ...policy, maxPayloadBytes: 4 }, { ok: true })).toThrow('payload limit')
  })

  test('requires object storage for object archives and finite retention for delete archives', () => {
    expect(() => assertPluginStoragePolicy({ maxPayloadBytes: 1024, objectStorage: 'forbidden', historyRetentionDays: null, archive: { mode: 'object-storage', afterDays: 30 } })).toThrow('objectStorage')
    expect(() => assertPluginStoragePolicy({ maxPayloadBytes: 1024, objectStorage: 'optional', historyRetentionDays: null, archive: { mode: 'delete-after-retention', afterDays: 30 } })).toThrow('finite')
  })

  test('requires object storage for cold archives', () => {
    expect(() => assertPluginStoragePolicy({ maxPayloadBytes: 1024, objectStorage: 'forbidden', historyRetentionDays: null, archive: { mode: 'cold-storage', afterDays: 30 } })).toThrow('External archive')
  })
})
