import { expect, test } from 'bun:test'
import { createDataContractBaseline, emptyLifecycleState, lifecycleDigest, PluginLifecycle, rebaseDataContractBaseline, type DataContract } from './index'
const source: DataContract = { id: 'records', version: '1.0.0', description: 'Records', schema: { type: 'object', properties: { tenant_id: { type: 'string' }, id: { type: 'string' } }, required: ['tenant_id', 'id'], 'x-db': { tableName: 'records' } }, migrations: [{ id: '001', scope: 'database', sql: { sqlite: ['CREATE TABLE records(tenant_id TEXT,id TEXT,PRIMARY KEY(tenant_id,id))'] } }, { id: '002', scope: 'database', sql: { sqlite: ['CREATE INDEX records_tenant ON records(tenant_id)'] } }] }
const baseline = createDataContractBaseline(source, '1.1.0', { sqlite: source.migrations.flatMap(m => m.sql.sqlite!) })
function fixture() {
  let state = emptyLifecycleState()
  state.dataContracts = { '["db","records"]': { contract: source, digest: lifecycleDigest(source), status: 'installed' } }
  source.migrations.forEach((m, position) => { state.migrations[JSON.stringify(['db', 'data-records', m.id, '*'])] = { databaseId: 'db', pluginId: 'data-records', migrationId: m.id, position, tenantId: null, checksum: lifecycleDigest(m), status: 'applied' } })
  const store = { read: async () => structuredClone(state), withLock: async <T>(fn: (writer: any) => Promise<T>) => fn({ read: async () => structuredClone(state), write: async (next: typeof state) => { state = next } }) }
  return { store, state: () => state, set: (s: typeof state) => { state = s } }
}
test('baseline rebase preserves old evidence and skips DDL for exact applied history', async () => {
  const f = fixture()
  const result = await rebaseDataContractBaseline(f.store, 'db', baseline, { expectedRevision: 0 })
  expect(result.ddlExecuted).toBe(false)
  expect(Object.values(f.state().migrations).map(m => m.migrationId)).toEqual([baseline.target.migrations[0].id])
  expect(Object.values(f.state().baselineHistory!)[0].migrations['["db","data-records","001","*"]'].status).toBe('applied')
  const manager = new PluginLifecycle({ plugins: [{ id: 'feature', version: '1.0.0', framework: '*', schemaDependencies: { records: '^1.0.0' }, migrations: [] }], dataContracts: [baseline.target], backends: [{ id: 'host', databaseId: 'db', dialect: 'sqlite', mode: 'shared' }], store: f.store, migrate: async () => { throw Error('must not run DDL') } }, '0.4.4')
  const plan = await manager.plan({ operation: 'install', pluginId: 'feature', backendId: 'host', tenantId: 't-a' })
  expect(plan.migrations).toHaveLength(0)
  await manager.apply(plan)
})
test('partial, failed, changed, stale and tampered histories cannot be rebased', async () => {
  for (const mutate of [
    (s: ReturnType<typeof emptyLifecycleState>) => { delete s.migrations['["db","data-records","002","*"]'] },
    (s: ReturnType<typeof emptyLifecycleState>) => { s.migrations['["db","data-records","001","*"]'].status = 'failed' },
    (s: ReturnType<typeof emptyLifecycleState>) => { s.migrations['["db","data-records","001","*"]'].checksum = 'bad' },
    (s: ReturnType<typeof emptyLifecycleState>) => { s.revision++ },
  ]) {
    const f = fixture(), changed = f.state(); mutate(changed); f.set(changed)
    const before = JSON.stringify(f.state())
    await expect(rebaseDataContractBaseline(f.store, 'db', baseline, { expectedRevision: 0 })).rejects.toThrow()
    expect(JSON.stringify(f.state())).toBe(before)
  }
  await expect(rebaseDataContractBaseline(fixture().store, 'db', { ...baseline, hash: 'bad' }, { expectedRevision: 0 })).rejects.toThrow('integrity')
})
