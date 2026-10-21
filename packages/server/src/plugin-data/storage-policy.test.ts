import { describe, expect, test } from 'bun:test'
import { createPluginRecordStore } from './index'

describe('manifest storage policy enforcement', () => {
  test('passes the plugin payload limit into the tenant-scoped record store', async () => {
    const calls: unknown[][] = []
    const store = createPluginRecordStore({ schema: { ownedTables: ['records'], externalReferences: {}, migrationOrder: 1, storagePolicy: { maxPayloadBytes: 8, objectStorage: 'optional', historyRetentionDays: null, archive: { mode: 'none' } } } }, { dialect: 'sqlite', async execute(_tenant, _sql, bindings) { calls.push(bindings); return { affectedRows: 1 } } })
    await expect(store.create('tenant-a', { id: 'r1', revision: 1, value: { tooLarge: true } })).rejects.toThrow('payload limit')
    expect(calls).toHaveLength(0)
  })
})
