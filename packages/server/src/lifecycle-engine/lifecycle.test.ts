import { inc } from 'semver'
import { test, expect } from 'bun:test'
import { FRAMEWORK_VERSION, PluginLifecycle, emptyLifecycleState, type LifecycleProject, type LifecycleStore, type LifecyclePlugin, type LifecycleRequest } from './index'
function fixture() {
  let state = emptyLifecycleState(), locked = false
  const calls: string[] = []
  const store: LifecycleStore = {
    read: async () => structuredClone(state),
    async withLock(fn) {
      if (locked) throw new Error('locked'); locked = true
      try { return await fn({ read: async () => structuredClone(state), write: async next => { state = structuredClone(next) } }) } finally { locked = false }
    },
  }
  const plugin: LifecyclePlugin = { id: 'notes', version: '1.0.0', framework: '^' + FRAMEWORK_VERSION, migrations: [
    { id: '001', scope: 'database', sql: { sqlite: ['CREATE TABLE notes (tenant_id TEXT, content TEXT)'] } },
    { id: '002', scope: 'tenant', sql: { sqlite: ['INSERT INTO notes VALUES (:tenantId, \'hello\')'] } },
  ] }
  const project: LifecycleProject = { store, plugins: [plugin], backends: [
    { id: 'shared', databaseId: 'shared-db', mode: 'shared', dialect: 'sqlite' },
    { id: 'dedicated', databaseId: 'dedicated-db', mode: 'dedicated', tenantId: 'alpha', dialect: 'sqlite' },
  ], quiesce: async () => {}, migrate: async step => { calls.push(step.key) } }
  const create = () => new PluginLifecycle(project)
  const request = (operation: LifecycleRequest['operation'], tenantId = 'alpha', backendId = 'shared'): LifecycleRequest => ({ operation, tenantId, backendId, pluginId: 'notes' })
  const apply = async (operation: LifecycleRequest['operation'], tenant = 'alpha', backend = 'shared') => { const manager = create(); await manager.apply(await manager.plan(request(operation, tenant, backend))) }
  return { create, request, project, plugin, calls, apply }
}
test('plans are read-only; shared DDL once, tenant data separately; install never enables', async () => {
  const f = fixture(); const plan = await f.create().plan(f.request('install'))
  expect(plan.migrations).toHaveLength(2); expect(f.calls).toHaveLength(0)
  expect((await f.project.store.read()).revision).toBe(0)
  await f.apply('install'); expect(await f.create().isEnabled('shared', 'alpha', 'notes')).toBe(false)
  await f.apply('enable'); expect(await f.create().isEnabled('shared', 'alpha', 'notes')).toBe(true)
  await f.apply('install', 'beta'); await f.apply('enable', 'beta')
  expect(f.calls).toHaveLength(3)
  await f.apply('disable'); expect(await f.create().isEnabled('shared', 'alpha', 'notes')).toBe(false)
  expect(await f.create().isEnabled('shared', 'beta', 'notes')).toBe(true)
  await expect(f.apply('uninstall')).rejects.toThrow('every tenant')
  await f.apply('disable', 'beta'); await f.apply('uninstall')
  expect(Object.keys((await f.project.store.read()).migrations)).toHaveLength(3)
  await f.apply('install'); await f.apply('enable'); expect(f.calls).toHaveLength(3)
})
test('dedicated placement denies another tenant; placement cannot silently change database', async () => {
  const f = fixture()
  await expect(f.apply('install', 'beta', 'dedicated')).rejects.toThrow('tenant mismatch')
  await f.apply('install', 'alpha', 'dedicated'); await f.apply('enable', 'alpha', 'dedicated')
  expect(await f.create().isEnabled('dedicated', 'alpha', 'notes')).toBe(true)
  f.project.backends[1].databaseId = 'new-db'
  await expect(f.apply('install', 'alpha', 'dedicated')).rejects.toThrow('immutable')
})
test('stale or edited plans never execute; repeated install does not repeat SQL', async () => {
  const f = fixture(), manager = f.create(), plan = await manager.plan(f.request('install'))
  const tampered = structuredClone(plan); tampered.migrations[0].statements = ['DROP TABLE notes']
  await expect(manager.apply(tampered)).rejects.toThrow('modified')
  await manager.apply(plan)
  await expect(manager.apply(plan)).rejects.toThrow('Stale')
  await f.apply('install'); expect(f.calls).toHaveLength(2)
})
test('failed migrations block retries and activation; previous activity is revoked before DDL', async () => {
  const f = fixture(); await f.apply('install'); await f.apply('enable')
  f.plugin.version = '1.1.0'; f.plugin.migrations.push({ id: '003', scope: 'database', sql: { sqlite: ['ALTER TABLE notes ADD COLUMN title TEXT'] } })
  f.project.migrate = async () => {
    expect(await f.create().isEnabled('shared', 'alpha', 'notes')).toBe(false)
    throw new Error('DDL failure')
  }
  await expect(f.apply('update')).rejects.toThrow('DDL failure')
  await expect(f.apply('update')).rejects.toThrow('reconciliation')
  await expect(f.apply('enable')).rejects.toThrow('Install/migrate')
  expect(Object.values((await f.project.store.read()).migrations).at(-1)?.status).toBe('failed')
})
test('applied migrations cannot be changed/removed, even after uninstall', async () => {
  const f = fixture(); await f.apply('install'); await f.apply('uninstall')
  f.plugin.version = '1.1.0'; f.plugin.migrations[0].sql.sqlite = ['DROP TABLE notes']
  await expect(f.apply('install')).rejects.toThrow('changed or removed')
})
test('dependency ordering, cascade enable, and safe removal', async () => {
  const f = fixture()
  const base = { id: 'base', version: '1.0.0', framework: '^' + FRAMEWORK_VERSION, migrations: [] }
  f.project.plugins.push(base); f.plugin.dependencies = { base: '^1.0.0' }
  expect((await f.create().plan(f.request('install'))).plugins.map(p => p.id)).toEqual(['base', 'notes'])
  await f.apply('install'); await f.apply('enable')
  expect(await f.create().isEnabled('shared', 'alpha', 'base')).toBe(true)
  await expect(f.create().plan({ ...f.request('disable'), pluginId: 'base' })).rejects.toThrow('dependent')
  await f.apply('disable'); await f.apply('uninstall')
  await f.create().apply(await f.create().plan({ ...f.request('disable'), pluginId: 'base' }))
})
test('dependency cycles and incompatible core versions fail before side effects', async () => {
  const f = fixture(); f.plugin.dependencies = { notes: '*' }
  await expect(f.apply('install')).rejects.toThrow('cycle'); f.plugin.dependencies = {}
  f.plugin.framework = '^99.0.0'; await expect(f.apply('install')).rejects.toThrow('Incompatible')
  expect(f.calls).toHaveLength(0)
})
test('core upgrade retains compatible activation and blocks incompatible release while allowing disable', async () => {
  const f = fixture(); await f.apply('install'); await f.apply('enable')
  expect(await new PluginLifecycle(f.project, inc(FRAMEWORK_VERSION, 'patch')!).isEnabled('shared', 'alpha', 'notes')).toBe(true)
  const next = new PluginLifecycle(f.project, inc(FRAMEWORK_VERSION, 'minor')!)
  expect(await next.isEnabled('shared', 'alpha', 'notes')).toBe(false)
  await next.apply(await next.plan(f.request('disable')))
})
test('infrastructure is explicit, before migrations, and never destroyed on uninstall', async () => {
  const f = fixture(); f.plugin.infrastructure = { storage: true }
  const plan = await f.create().plan(f.request('install'))
  await expect(f.create().apply(plan)).rejects.toThrow('executor')
  expect(f.calls).toHaveLength(0)
  f.project.infrastructure = { identity: 'test', preview: async () => 'preview', apply: async () => { f.calls.push('infra') } }
  const executable = await f.create().plan(f.request('install'))
  expect(await f.create().preview(executable)).toEqual(['preview']); expect(f.calls).toHaveLength(0)
  await f.create().apply(executable); expect(f.calls[0]).toBe('infra')
  await f.apply('uninstall'); expect(f.calls).toHaveLength(3)
})
test('updated shared schema disables all affected backends and rejects old code reactivation', async () => {
  const f = fixture(); f.project.backends.push({ id: 'other', databaseId: 'shared-db', dialect: 'sqlite', mode: 'shared' })
  await f.apply('install'); await f.apply('enable')
  await f.apply('install', 'beta', 'other'); await f.apply('enable', 'beta', 'other')
  const old = f.create()
  f.plugin.version = '1.1.0'; f.plugin.migrations.push({ id: '003', scope: 'database', sql: { sqlite: ['ALTER TABLE notes ADD COLUMN title TEXT'] } })
  await f.apply('update')
  expect(await old.isEnabled('other', 'beta', 'notes')).toBe(false)
  await expect(old.plan(f.request('enable', 'beta', 'other'))).rejects.toThrow('Install/migrate')
})
test('active upgrades require an explicit drain executor and fail closed when drain fails', async () => {
 const f = fixture(); await f.apply('install'); await f.apply('enable')
 f.plugin.version = '1.1.0'; delete f.project.quiesce
 await expect(f.apply('update')).rejects.toThrow('quiesce')
 f.project.quiesce = async affected => { expect(affected).toHaveLength(1); throw new Error('worker still active') }
 await expect(f.apply('update')).rejects.toThrow('worker still active')
 expect(await f.create().isEnabled('shared', 'alpha', 'notes')).toBe(false)
 expect(f.calls).toHaveLength(2)
})
test('plan is detached from registered release objects', async () => {
 const f = fixture(), manager = f.create(), plan = await manager.plan(f.request('install'))
 plan.plugins[0].version = '99.0.0'
 expect((await manager.plan(f.request('install'))).plugins[0].version).toBe('1.0.0')
})
test('applied migration ordering cannot change or insert a migration before applied history', async () => {
 const f = fixture(); await f.apply('install'); await f.apply('uninstall')
 f.plugin.version = '1.1.0'; f.plugin.migrations.unshift({ id: '000-earlier', scope: 'database', sql: { sqlite: ['SELECT 1'] } })
 await expect(f.apply('install')).rejects.toThrow('changed or removed')
 expect(f.calls).toHaveLength(2)
})

test('inventory distinguishes registered, installed and enabled using one read-only snapshot', async () => {
  const f = fixture()
  const initial = await f.create().list({ backendId: 'shared', tenantId: 'alpha' })
  expect(initial.plugins[0]).toMatchObject({ registeredVersion: '1.0.0', installedVersion: null, installationStatus: 'not-installed', tenants: [{ tenantId: 'alpha', requestedEnabled: false, enabled: false }] })
  await f.apply('install'); await f.apply('enable')
  await f.apply('install', 'beta'); await f.apply('enable', 'beta'); await f.apply('disable', 'beta')
  const before = await f.project.store.read(), calls = f.calls.length
  let reads = 0
  f.project.store = { read: async () => { reads++; return structuredClone(before) }, withLock: async () => { throw new Error('Listing must not lock/write') } }
  const snapshot = await f.create().list({ backendId: 'shared' })
  expect(reads).toBe(1)
  expect(snapshot.revision).toBe(before.revision)
  expect(snapshot.plugins[0]).toMatchObject({ installedVersion: '1.0.0', installationStatus: 'installed', releaseMatches: true, tenants: [{ tenantId: 'alpha', requestedEnabled: true, enabled: true }, { tenantId: 'beta', requestedEnabled: false, enabled: false }] })
  expect(f.calls).toHaveLength(calls)
})

test('inventory never reports stale enabled flags as effective admission', async () => {
  const f = fixture()
  await f.apply('install'); await f.apply('enable')
  f.project.plugins[0].version = '1.1.0'
  const row = (await f.create().list({ backendId: 'shared', tenantId: 'alpha' })).plugins[0]
  expect(row).toMatchObject({ registeredVersion: '1.1.0', installedVersion: '1.0.0', releaseMatches: false, tenants: [{ requestedEnabled: true, enabled: false }] })
  f.project.plugins[0].version = '1.0.0'
  await f.project.store.withLock(async writer => {
    const state = await writer.read()
    Object.values(state.migrations)[0].status = 'failed'
    await writer.write(state)
  })
  expect((await f.create().list({ backendId: 'shared', tenantId: 'alpha' })).plugins[0].tenants[0].enabled).toBe(false)
})

test('inventory retains orphaned installations after code or backend configuration is removed', async () => {
  const f = fixture()
  await f.apply('install'); await f.apply('enable')
  f.project.plugins = []; f.project.backends = []
  expect((await f.create().list()).plugins[0]).toMatchObject({ pluginId: 'notes', backendId: 'shared', backendConfigured: false, registeredVersion: null, installedVersion: '1.0.0', releaseMatches: false, tenants: [{ requestedEnabled: true, enabled: false }] })
})

test('inventory shows failed installs, rejects unknown filters and honors dedicated tenants', async () => {
  const f = fixture()
  f.project.migrate = async () => { throw new Error('simulated failure') }
  await expect(f.apply('install')).rejects.toThrow('simulated failure')
  expect((await f.create().list({ backendId: 'shared' })).plugins[0].installationStatus).toBe('failed')
  await expect(f.create().list({ backendId: 'typo' })).rejects.toThrow('Unknown backend')
  await expect(f.create().list({ backendId: 'dedicated', tenantId: 'beta' })).rejects.toThrow('dedicated backend')
  expect((await f.create().list({ tenantId: 'beta' })).plugins.map(p => p.backendId)).toEqual(['shared'])
})

test('inventory supports code-only catalogs and rejects corrupt/unavailable state', async () => {
  const f = fixture()
  f.project.backends = []
  expect((await f.create().list()).plugins[0]).toMatchObject({ backendId: null, registeredVersion: '1.0.0', installedVersion: null })
  f.project.store.read = async () => ({ ...emptyLifecycleState(), format: 9 } as any)
  await expect(f.create().list()).rejects.toThrow('Invalid lifecycle state')
  f.project.store.read = async () => { throw new Error('store offline') }
  await expect(f.create().list()).rejects.toThrow('store offline')
})

test('bundle aliases expand operator plans while retaining individual lifecycle records', async () => {
  const f = fixture()
  const base = { id: 'base', version: '1.0.0', framework: '^' + FRAMEWORK_VERSION, migrations: [] }
  f.project.plugins.push(base)
  f.plugin.dependencies = { base: '^1.0.0' }
  f.project.bundles = { estate: ['base', 'notes'] }
  const manager = f.create()
  const request = { operation: 'install' as const, pluginId: 'estate', backendId: 'shared', tenantId: 'alpha' }
  const bundlePlan = await manager.planBundle(request)
  expect(bundlePlan.plans.map(plan => plan.request.pluginId)).toEqual(['base', 'notes'])
  await manager.applyBundle(bundlePlan)
  expect((await manager.list({ backendId: 'shared', tenantId: 'alpha' })).plugins.map(plugin => plugin.pluginId)).toEqual(['base', 'notes'])
  await expect(manager.plan({ ...request, operation: 'install' })).rejects.toThrow('Plugin code not registered')
})
