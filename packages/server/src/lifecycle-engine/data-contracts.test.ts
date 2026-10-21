import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { PluginLifecycle, emptyLifecycleState, type DataContract, type LifecyclePlugin, type LifecycleState } from './index'

const contract: DataContract = {
 id: 'customers', version: '1.0.0', description: 'Shared customer identity',
 schema: { type: 'object', properties: { tenant_id: { type: 'string' }, id: { type: 'string' } }, required: ['tenant_id', 'id'], 'x-db': { tableName: 'customers' } },
 migrations: [{ id: '001', scope: 'database', sql: { sqlite: ['CREATE TABLE customers (tenant_id TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (tenant_id,id))'] } }],
}
const feature = (id: string): LifecyclePlugin => ({ id, version: '1.0.0', framework: '*', migrations: [], schemaDependencies: { customers: '^1.0.0' } })
function fixture(contracts = [contract], plugins = [feature('billing')]) {
 let state = emptyLifecycleState()
 const database = new Database(':memory:')
 const calls: string[] = []
 const manager = new PluginLifecycle({
  plugins, dataContracts: contracts, backends: [{ id: 'shared', databaseId: 'db', dialect: 'sqlite', mode: 'shared' }],
  store: { read: async () => structuredClone(state), withLock: async fn => fn({ read: async () => structuredClone(state), write: async s => { state = structuredClone(s) } }) },
  migrate: async step => { for (const sql of step.statements) { calls.push(sql); database.exec(sql) } },
  quiesce: async () => {},
 }, '0.4.4')
 const request = (operation: 'install' | 'update' | 'enable' | 'disable' | 'uninstall', pluginId = 'billing') => ({ operation, pluginId, backendId: 'shared', tenantId: 'a' })
 const apply = async (operation: Parameters<typeof request>[0], pluginId?: string) => manager.apply(await manager.plan(request(operation, pluginId)))
 return { manager, database, calls, request, apply, state: () => state, setState: (s: LifecycleState) => { state = s } }
}

test('a feature prepares shared data without installing or enabling an owner feature; consumers reuse DDL', async () => {
 const f = fixture([contract], [feature('billing'), feature('sales')])
 try {
  const plan = await f.manager.plan(f.request('install'))
  expect(plan.plugins.map(p => p.id)).toEqual(['billing'])
  expect(plan.dataCatalog?.tables.map(t => t.name)).toEqual(['customers'])
  await f.manager.apply(plan); await f.apply('enable')
  f.database.exec("INSERT INTO customers VALUES ('a','customer-1')")
  await f.apply('install', 'sales'); await f.apply('enable', 'sales')
  expect(f.calls).toHaveLength(1)
  await f.apply('disable', 'sales'); await f.apply('uninstall', 'sales')
  expect(await f.manager.isEnabled('shared', 'a', 'billing')).toBe(true)
  expect(f.database.query('SELECT COUNT(*) AS count FROM customers').get()).toEqual({ count: 1 })
  expect(f.manager.schemaCatalog(['billing']).contracts.map(c => c.id)).toEqual(['customers'])
 } finally { f.database.close() }
})

test('conflicting table ownership, contract definitions and incompatible requirements fail before SQL', () => {
 expect(() => fixture([{ ...contract, id: 'other' }, contract])).toThrow('multiple')
 expect(() => fixture([contract], [{ ...feature('billing'), schemaDependencies: { customers: '^2.0.0' } }])).toThrow('Unsatisfied')
 expect(() => fixture([contract], [{ ...feature('billing'), schemaContracts: [{ ...contract, version: '1.1.0' }] }])).toThrow('Conflicting')
})

test('common columns use append-only migrations; existing rows survive; all consumers are drained', async () => {
 const f = fixture(); await f.apply('install'); await f.apply('enable')
 f.database.exec("INSERT INTO customers VALUES ('a','customer-1')")
 const next: DataContract = { ...contract, version: '1.1.0', schema: { ...contract.schema, properties: { ...(contract.schema.properties as object), company_number: { type: 'string' } } }, migrations: [...contract.migrations, { id: '002', scope: 'database', sql: { sqlite: ['ALTER TABLE customers ADD COLUMN company_number TEXT'] } }] }
 const updated = new PluginLifecycle({ dataContracts: [next], plugins: [feature('billing')], backends: [{ id:'shared',databaseId:'db',dialect:'sqlite',mode:'shared' }], store: {read:async()=>structuredClone(f.state()),withLock:async fn=>fn({read:async()=>structuredClone(f.state()),write:async s=>f.setState(structuredClone(s))})},migrate:async step=>{for(const sql of step.statements)f.database.exec(sql)},quiesce:async()=>{} }, '0.4.4')
 try {
  const plan = await updated.plan(f.request('update'))
  expect(plan.migrations.map(m => m.record.migrationId)).toEqual(['002'])
  expect(plan.deactivate).toHaveLength(1)
  await updated.apply(plan)
  expect(await f.manager.isEnabled('shared','a','billing')).toBe(false)
  expect(f.database.query('SELECT * FROM customers').get()).toEqual({tenant_id:'a',id:'customer-1',company_number:null})
  await updated.apply(await updated.plan(f.request('enable')))
  expect(await updated.isEnabled('shared','a','billing')).toBe(true)
 } finally { f.database.close() }
})

test('legacy migration ledger identity adopts existing table without replaying CREATE', async () => {
 const c = { ...contract, migrationIdentity: 'billing' }
 const f = fixture([c])
 const state = f.state()
 const { lifecycleDigest } = await import('./index')
 state.migrations[JSON.stringify(['db','billing','001','*'])] = {databaseId:'db',pluginId:'billing',migrationId:'001',position:0,tenantId:null,checksum:lifecycleDigest(c.migrations[0]),status:'applied'}
 f.database.exec(c.migrations[0].sql.sqlite![0])
 try { await f.apply('install'); expect(f.calls).toEqual([]); await f.apply('enable'); expect(await f.manager.isEnabled('shared','a','billing')).toBe(true) } finally { f.database.close() }
})

test('failed contract DDL blocks every consumer and cannot be retried automatically', async () => {
 const f = fixture([{...contract,migrations:[{...contract.migrations[0],sql:{sqlite:['INVALID SQL']}}]}])
 try { await expect(f.apply('install')).rejects.toThrow(); expect(await f.manager.isEnabled('shared','a','billing')).toBe(false); await expect(f.apply('install')).rejects.toThrow('reconciliation') } finally { f.database.close() }
})

test('a retained contract migration identity does not block an unrelated feature with that name', async () => {
 const shared = { ...contract, migrationIdentity: 'billing' }
 const billing: LifecyclePlugin = { id: 'billing', version: '1.0.0', framework: '*', migrations: [] }
 const f = fixture([shared], [feature('sales'), billing])
 try {
  await f.apply('install', 'sales')
  await f.apply('install', 'billing')
  await f.apply('enable', 'billing')
  expect(await f.manager.isEnabled('shared', 'a', 'billing')).toBe(true)
  expect((await f.manager.plan(f.request('install', 'billing'))).migrations).toEqual([])
  expect(f.calls).toHaveLength(1)
  const state = f.state(), migration = Object.values(state.migrations)[0]
  migration.checksum = 'tampered'
  expect(await f.manager.isEnabled('shared', 'a', 'billing')).toBe(false)
  await expect(f.manager.plan(f.request('install', 'billing'))).rejects.toThrow('changed or removed')
  migration.checksum = (await import('./index')).lifecycleDigest(shared.migrations[0])
  migration.status = 'failed'
  expect(await f.manager.isEnabled('shared', 'a', 'billing')).toBe(false)
  await expect(f.manager.plan(f.request('install', 'billing'))).rejects.toThrow('changed or removed')
 } finally { f.database.close() }
})

test('contract-backed features cannot add their own DDL to shared tables', () => {
 expect(() => fixture([contract], [{...feature('billing'),migrations:contract.migrations}])).toThrow('put DDL in data contracts')
})

test('feature-only columns use a separate contract and are not provisioned for other features', async () => {
 const extension: DataContract = { id:'sales-details',version:'1.0.0',description:'Sales-only customer fields',dependencies:{customers:'^1.0.0'},schema:{type:'object',properties:{tenant_id:{type:'string'},customer_id:{type:'string'},prospect_rank:{type:'string'}},required:['tenant_id','customer_id'],'x-db':{tableName:'sales_customer_details'}},migrations:[{id:'001',scope:'database',sql:{sqlite:['CREATE TABLE sales_customer_details (tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, prospect_rank TEXT, PRIMARY KEY (tenant_id,customer_id))']}}] }
 const f = fixture([contract,extension], [feature('billing'),{...feature('sales'),schemaDependencies:{'sales-details':'^1.0.0'}}])
 try {
  await f.apply('install')
  expect(f.database.query("SELECT name FROM sqlite_master WHERE name = 'sales_customer_details'").get()).toBeNull()
  const plan = await f.manager.plan(f.request('install','sales'))
  expect(plan.migrations).toHaveLength(1)
  expect(plan.plugins.map(p=>p.id)).toEqual(['sales'])
  await f.manager.apply(plan)
  expect(f.database.query("SELECT name FROM sqlite_master WHERE name = 'sales_customer_details'").get()).toEqual({name:'sales_customer_details'})
 } finally {f.database.close()}
})

test('data contracts support json extensions (virtual columns and zero-downtime constraints)', async () => {
 const { generateJsonExtensionSql, buildJsonMergeExpression } = await import('@alneas/appkit-core/data/schema')
 const extensions = {
  jsonColumn: 'payload',
  virtualColumns: [
   {
    name: 'room_id',
    jsonPath: '$.plugins.hotel.roomId',
    type: { default: 'TEXT' },
    unique: true,
   },
  ],
 }
 const ddl = generateJsonExtensionSql('eaos_hospitality_records', extensions, 'sqlite')

 const hotelContract: DataContract = {
  id: 'hospitality-records-v2',
  version: '2.0.0',
  description: 'Hospitality records with virtual column extraction',
  schema: {
   type: 'object',
   properties: {
    tenant_id: { type: 'string' },
    id: { type: 'string' },
    payload: { type: 'string' },
    room_id: { type: 'string' },
   },
   required: ['tenant_id', 'id', 'payload'],
   'x-db': { tableName: 'eaos_hospitality_records' },
   'x-virtual-columns': extensions.virtualColumns,
  },
  migrations: [
   {
    id: '001',
    scope: 'database',
    sql: {
     sqlite: [
      'CREATE TABLE eaos_hospitality_records (tenant_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (tenant_id, id))',
     ],
    },
   },
   {
    id: '002',
    scope: 'database',
    sql: {
     sqlite: ddl,
    },
   },
  ],
 }

 const hotelFeature: LifecyclePlugin = {
  id: 'hotel',
  version: '1.0.0',
  framework: '*',
  migrations: [],
  schemaDependencies: { 'hospitality-records-v2': '^2.0.0' },
 }
 const f = fixture([hotelContract], [hotelFeature])
 try {
  await f.apply('install', 'hotel')
  await f.apply('enable', 'hotel')

  // Insert initial data with another plugin (e.g. CRM)
  f.database.exec(
   "INSERT INTO eaos_hospitality_records (tenant_id, id, payload) VALUES ('t1', 'rec-1', '{\"plugins\":{\"crm\":{\"lead\":\"ok\"}}}')"
  )

  // Verify virtual column is initially null
  let row = f.database.query("SELECT room_id FROM eaos_hospitality_records WHERE id = 'rec-1'").get() as { room_id: string | null }
  expect(row.room_id).toBeNull()

  // Use app-core partial update helper to update hotel without overwriting CRM
  const merge = buildJsonMergeExpression('payload', '$.plugins.hotel', { roomId: 'room-101' }, 'sqlite')
  f.database.run(
   `UPDATE eaos_hospitality_records SET payload = ${merge.valueExpression} WHERE id = 'rec-1'`,
   [merge.paramValue]
  )

  // Verify virtual column automatically extracts room_id
  row = f.database.query("SELECT room_id FROM eaos_hospitality_records WHERE id = 'rec-1'").get() as { room_id: string }
  expect(row.room_id).toBe('room-101')

  // Verify other plugin data remains intact
  const raw = f.database.query("SELECT payload FROM eaos_hospitality_records WHERE id = 'rec-1'").get() as { payload: string }
  const parsed = JSON.parse(raw.payload)
  expect(parsed.plugins.crm).toEqual({ lead: 'ok' })
  expect(parsed.plugins.hotel).toEqual({ roomId: 'room-101' })
 } finally {
  f.database.close()
 }
})
