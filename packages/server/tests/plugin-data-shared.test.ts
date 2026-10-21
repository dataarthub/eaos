import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createAtomicRepository, createSqliteAtomicDriver, createSqlRecordStore } from '../src/plugin-data/index'

describe('shared plugin record storage', () => {
 test('keeps logical ids isolated by namespace on one physical table', async () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE eaos_shared_records (tenant_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY (tenant_id,id))')
  const driver = { dialect: 'sqlite' as const, execute: async (_tenant: string, sql: string, bindings: unknown[]) => sql.startsWith('SELECT') ? { rows: db.query(sql).all(...bindings as any[]) as Record<string, unknown>[] } : { affectedRows: db.query(sql).run(...bindings as any[]).changes } }
  const properties = createSqlRecordStore<{ kind: string }>('eaos_shared_records', driver, { namespace: 'estate_properties' })
  const dashboard = createSqlRecordStore<{ kind: string }>('eaos_shared_records', driver, { namespace: 'estate_dashboard' })
  await properties.create('tenant-a', { id: 'same-id', revision: 1, value: { kind: 'property' } })
  await dashboard.create('tenant-a', { id: 'same-id', revision: 1, value: { kind: 'dashboard' } })
  expect((await properties.read('tenant-a', 'same-id'))?.value.kind).toBe('property')
  expect((await dashboard.read('tenant-a', 'same-id'))?.value.kind).toBe('dashboard')
  expect((await properties.list('tenant-a', 10)).map(record => record.id)).toEqual(['same-id'])
 })

 test('keeps atomic workflow keys isolated by namespace on one physical table', async () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE eaos_shared_records (tenant_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY (tenant_id,id))')
  const driver = createSqliteAtomicDriver(db)
  const sop = createAtomicRepository('eaos_shared_records', driver, { namespace: 'sop' })
  const training = createAtomicRepository('eaos_shared_records', driver, { namespace: 'training' })
  const principal = { tenantId: 'tenant-a', userId: 'user-a', roles: [] }
  await sop.run(principal, session => session.put('command/one', { owner: 'sop' }, 0))
  await training.run(principal, session => session.put('command/one', { owner: 'training' }, 0))
  expect(await sop.run(principal, session => session.get<{ owner: string }>('command/one'))).toMatchObject({ value: { owner: 'sop' } })
  expect(await training.run(principal, session => session.get<{ owner: string }>('command/one'))).toMatchObject({ value: { owner: 'training' } })
 })
})
