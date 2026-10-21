import { test, expect } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { FRAMEWORK_VERSION, PluginLifecycle, emptyLifecycleState } from '@alneas/eaos-server/lifecycle-engine'
import { FileLifecycleStore, createLifecycleGuard, runLifecycleJob } from './index'
test('durable store survives recreation, excludes writers and denies corrupt state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'eaos-ledger-')), path = join(dir, 'state.json')
  try {
    const store = new FileLifecycleStore(path)
    await store.withLock(async writer => {
      await expect(new FileLifecycleStore(path).withLock(async () => {})).rejects.toThrow('locked')
      const state = emptyLifecycleState(); state.revision = 42; await writer.write(state)
    })
    expect((await new FileLifecycleStore(path).read()).revision).toBe(42)
    await writeFile(path, 'corrupt')
    await expect(store.read()).rejects.toThrow()
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('HTTP/webhook admission and job execution stop immediately on the next call after disable', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'eaos-runtime-'))
 try {
  const manager = new PluginLifecycle({ store: new FileLifecycleStore(join(dir, 'state.json')), plugins: [{ id: 'notes', version: '1.0.0', framework: '^' + FRAMEWORK_VERSION, migrations: [] }], backends: [{ id: 'shared', databaseId: 'db', dialect: 'sqlite', mode: 'shared' }], migrate: async () => {} })
  const request = { pluginId: 'notes', backendId: 'shared', tenantId: 'alpha' }
  for (const operation of ['install', 'enable'] as const) await manager.apply(await manager.plan({ ...request, operation }))
  const app = new Hono(); let executed = 0
  const guard = createLifecycleGuard({ lifecycle: manager, backendId: 'shared', resolveTenant: async c => c.req.header('Authorization') === 'Bearer verified-test' ? 'alpha' : null }, 'notes')
  app.use('*', guard); app.post('/webhook', c => { executed++; return c.json({ ok: true }) }); app.get('/notes', c => c.json({ ok: true }))
  const headers = { Authorization: 'Bearer verified-test' }
  expect((await app.request('/notes')).status).toBe(401)
  expect((await app.request('/notes', { headers })).status).toBe(200)
  expect((await app.request('/webhook', { method: 'POST', headers })).status).toBe(200)
  await manager.run('shared', 'alpha', 'notes', async () => { executed++ })
  await runLifecycleJob({ lifecycle: manager, backendId: 'shared', resolveTenant: async () => 'alpha' }, { tenantId: 'alpha', pluginId: 'notes' }, async () => { executed++ })
  await manager.apply(await manager.plan({ ...request, operation: 'disable' }))
  expect((await app.request('/notes', { headers })).status).toBe(403)
  expect((await app.request('/webhook', { method: 'POST', headers })).status).toBe(403)
  await expect(manager.run('shared', 'alpha', 'notes', async () => { executed++ })).rejects.toThrow('inactive')
  await expect(runLifecycleJob({ lifecycle: manager, backendId: 'shared', resolveTenant: async () => 'alpha' }, { tenantId: 'alpha', pluginId: 'notes' }, async () => { executed++ })).rejects.toThrow('inactive')
  expect(executed).toBe(3)
 } finally { await rm(dir, { recursive: true, force: true }) }
})

test('shared HTTP and jobs use the dedicated lifecycle target and deny missing placement', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'eaos-target-runtime-'))
 try {
  const manager = new PluginLifecycle({ store: new FileLifecycleStore(join(dir, 'state.json')), plugins: [{ id: 'notes', version: '1.0.0', framework: '^' + FRAMEWORK_VERSION, migrations: [] }], backends: [
   {id:'shared',databaseId:'db1',dialect:'sqlite',mode:'shared'},
   {id:'dedicated',databaseId:'db2',dialect:'sqlite',mode:'dedicated',tenantId:'alpha'},
  ], migrate: async () => {} })
  for (const operation of ['install','enable'] as const) await manager.apply(await manager.plan({operation,pluginId:'notes',backendId:'dedicated',tenantId:'alpha'}))
  const runtime = {lifecycle:manager,backendId:'shared',resolveTenant:async()=> 'alpha',resolveBackend:async()=> 'dedicated'}
  const app = new Hono();app.use('*',createLifecycleGuard(runtime,'notes'));app.get('/',c=>c.json({ok:true}))
  expect((await app.request('/')).status).toBe(200)
  expect(await runLifecycleJob(runtime,{tenantId:'alpha',pluginId:'notes'},async()=> 'dedicated-job')).toBe('dedicated-job')
  const denied={...runtime,resolveBackend:async()=> null}
  const unavailable=new Hono();unavailable.use('*',createLifecycleGuard(denied,'notes'));unavailable.get('/',c=>c.text('unexpected'))
  expect((await unavailable.request('/')).status).toBe(403)
  await expect(runLifecycleJob(denied,{tenantId:'alpha',pluginId:'notes'},async()=> 'unexpected')).rejects.toThrow('unavailable')
 } finally { await rm(dir,{recursive:true,force:true}) }
})
