import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqlLifecycleStore, controlSchemaSql } from '../src/sql-lifecycle/index'
import { FRAMEWORK_VERSION, PluginLifecycle } from '@alneas/eaos-server/lifecycle-engine'
test('independent control clients observe committed states and exclusive writers; crashes retain lock', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'eaos-control-')), a = new Database(join(dir, 'state.db')), b = new Database(join(dir, 'state.db'))
 const driver = (db: Database) => ({ dialect: 'sqlite' as const, execute: async (sql: string, binds: unknown[]) => sql.startsWith('SELECT') ? { rows: db.query(sql).all(...binds as any[]) as any[] } : { affectedRows: db.query(sql).run(...binds as any[]).changes } })
 try {
  for (const sql of controlSchemaSql.sqlite) a.exec(sql)
  const first = new SqlLifecycleStore(driver(a), 'main'), second = new SqlLifecycleStore(driver(b), 'main')
  await expect(first.read()).rejects.toThrow('not initialized'); await first.initialize(); await second.initialize()
  await first.withLock(async writer => {
   await expect(second.withLock(async () => {})).rejects.toThrow('locked')
   const state = await writer.read(); state.revision++; await writer.write(state)
   expect((await second.read()).revision).toBe(1)
   await expect(writer.write(state)).rejects.toThrow('revision transition')
  })
  const plugin = { id: 'notes', version: '1.0.0', framework: '^' + FRAMEWORK_VERSION, migrations: [] }
  const config = { backends: [{ id: 'shared', databaseId: 'data', mode: 'shared' as const, dialect: 'sqlite' as const }, { id: 'private', databaseId: 'private-data', mode: 'dedicated' as const, tenantId: 'alpha', dialect: 'sqlite' as const }], plugins: [plugin], migrate: async () => {} }
  const manager = new PluginLifecycle({ ...config, store: first }), observer = new PluginLifecycle({ ...config, store: second })
  for (const backendId of ['shared', 'private']) {
   for (const operation of ['install', 'enable'] as const) await manager.apply(await manager.plan({ operation, pluginId: 'notes', backendId, tenantId: 'alpha' }))
   expect(await observer.isEnabled(backendId, 'alpha', 'notes')).toBe(true)
   await manager.apply(await manager.plan({ operation: 'disable', pluginId: 'notes', backendId, tenantId: 'alpha' })); expect(await observer.isEnabled(backendId, 'alpha', 'notes')).toBe(false)
  }
  await expect(observer.plan({ operation: 'enable', pluginId: 'notes', backendId: 'private', tenantId: 'beta' })).rejects.toThrow()
  a.exec("UPDATE eaos_lifecycle_state SET writer_token = 'crashed'")
  await expect(second.withLock(async () => {})).rejects.toThrow('reconcile')
 } finally { a.close(); b.close(); await rm(dir, { recursive: true, force: true }) }
})
test('a failed migration remains dirty across control clients/restart', async () => {
 const db = new Database(':memory:')
 try {
  db.exec(controlSchemaSql.sqlite[0]); const driver = { dialect: 'sqlite' as const, execute: async (sql: string, binds: unknown[]) => sql.startsWith('SELECT') ? { rows: db.query(sql).all(...binds as any[]) as any[] } : { affectedRows: db.query(sql).run(...binds as any[]).changes } }
  const store = new SqlLifecycleStore(driver, 'main'); await store.initialize()
  const options = { store, backends: [{ id: 'shared', databaseId: 'data', mode: 'shared' as const, dialect: 'sqlite' as const }], plugins: [{ id: 'notes', version: '1.0.0', framework: '^' + FRAMEWORK_VERSION, migrations: [{ id: '001', scope: 'database' as const, sql: { sqlite: ['bad SQL'] } }] }], migrate: async () => { throw new Error('DDL failed') } }
  const manager = new PluginLifecycle(options), req = { operation: 'install' as const, pluginId: 'notes', backendId: 'shared', tenantId: 'alpha' }
  await expect(manager.apply(await manager.plan(req))).rejects.toThrow('DDL failed')
  const restarted = new SqlLifecycleStore(driver, 'main'); expect(Object.values((await restarted.read()).migrations)[0].status).toBe('failed')
  await expect(new PluginLifecycle({ ...options, store: restarted }).plan(req)).rejects.toThrow()
 } finally { db.close() }
})

test('atomic control writes roll back with host records and keep a durable exclusive token', async () => {
 const dir=await mkdtemp(join(tmpdir(),'eaos-atomic-control-')), db=new Database(join(dir,'state.db')), observerDb=new Database(join(dir,'state.db'))
 const driver=(connection:Database)=>({dialect:'sqlite' as const,execute:async(sql:string,binds:unknown[])=>sql.startsWith('SELECT')?{rows:connection.query(sql).all(...binds as any[]) as any[]}:{affectedRows:connection.query(sql).run(...binds as any[]).changes}})
 const primary=driver(db), store=new SqlLifecycleStore(primary,'main'), observer=new SqlLifecycleStore(driver(observerDb),'main')
 const transaction=async <T>(fn:(driver:typeof primary)=>Promise<T>)=>{db.exec('BEGIN IMMEDIATE');try {const result=await fn(primary);db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}}
 try {
  db.exec(controlSchemaSql.sqlite[0]);db.exec('CREATE TABLE memberships (id TEXT PRIMARY KEY)');await store.initialize()
  await expect(store.withAtomicLock(transaction,async(writer,sql)=>{const state=await writer.read();state.revision++;await writer.write(state);await sql.execute('INSERT INTO memberships (id) VALUES (?)',['admin']);expect((await observer.read()).revision).toBe(0);expect(observerDb.query('SELECT writer_token FROM eaos_lifecycle_state').get()).toEqual({writer_token:expect.any(String)});throw Error('audit failed')})).rejects.toThrow('audit failed')
  expect((await observer.read()).revision).toBe(0);expect(db.query('SELECT id FROM memberships').all()).toEqual([])
  await store.withAtomicLock(transaction,async(writer,sql)=>{const state=await writer.read();state.revision++;await writer.write(state);await sql.execute('INSERT INTO memberships (id) VALUES (?)',['admin'])})
  expect((await observer.read()).revision).toBe(1);expect(observerDb.query('SELECT id FROM memberships').all()).toEqual([{id:'admin'}]);expect(observerDb.query('SELECT writer_token FROM eaos_lifecycle_state').get()).toEqual({writer_token:null})
 } finally {db.close();observerDb.close();await rm(dir,{recursive:true,force:true})}
})
