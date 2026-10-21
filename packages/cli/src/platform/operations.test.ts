import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { FRAMEWORK_VERSION, emptyLifecycleState, PluginLifecycle, type LifecycleState, type LifecycleProject } from '@alneas/eaos-server/lifecycle-engine'
import { generatePlatform } from './index'
import { initializePreset } from '../presets/oci-adb/template'
import { executePlatformOperation, planPlatformOperation, upPlatform, type PlatformOperations, type OperationPorts } from './operations'
const roots: string[] = [], dbs: DatabaseSync[] = []
afterEach(async () => { for (const db of dbs.splice(0)) db.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eaos-release-')); roots.push(root)
  const manifest = { preset: 'oci-adb', platform: { appName: 'example', baseDomain: 'example.com' }, runtime: { backend: { id: 'primary', databaseId: 'db', dialect: 'sqlite', mode: 'shared' } },
    deployment: { target: 'both', images: { backend: 'registry.example.com/app-backend:v2', frontend: 'registry.example.com/app-frontend:v2', worker: 'registry.example.com/app-worker:v2' }, kamal: { host: 'edge', ssh: { user: 'ubuntu' }, worker: { host: 'worker', privateAddress: '10.0.1.3', kratosAdminUrl: 'http://10.0.0.3:4434', ssh: { user: 'ubuntu' } } } } }
  await writeFile(join(root, 'eaos.platform.json'), JSON.stringify(manifest)); await writeFile(join(root, 'package.json'), '{}')
  await generatePlatform(root)
  let state = emptyLifecycleState(), locked = false
  const db = new DatabaseSync(':memory:'); dbs.push(db)
  const project: LifecycleProject = { store: { read: async () => structuredClone(state), withLock: async fn => {
    if (locked) throw new Error('locked')
    locked = true
    try { return await fn({ read: async () => structuredClone(state), write: async next => { state = structuredClone(next) } }) } finally { locked = false }
  } }, backends: [manifest.runtime.backend as any], plugins: [{ id: 'plugin-a', version: '1.0.0', framework: '^' + FRAMEWORK_VERSION, migrations: [{ id: 'initial', scope: 'database', sql: { sqlite: ['CREATE TABLE records (id TEXT PRIMARY KEY)'] } }] }], migrate: async step => { for (const sql of step.statements) db.exec(sql) } }
  const calls: string[] = []
  const operations: PlatformOperations = { formatVersion: 1, environment: 'test', lifecycle: project, migrations: [{ backendId: 'primary', tenantId: 'tenant-a', pluginIds: ['plugin-a'] }], withLock: async (_context, fn) => { calls.push('lock'); try { return await fn() } finally { calls.push('unlock') } }, health: ['worker', 'backend', 'frontend'].map(role => ({ role, url: `https://${role}.example.com/health` })) as PlatformOperations['health'] }
  const ports: OperationPorts = { operations, deploy: async opt => { calls.push(opt.configFile.split('/').at(-1)!); expect(opt.version).toBe('v2') }, fetch: (async () => new Response(null, { headers: { 'x-eaos-release': 'v2' } })) as typeof fetch }
  return { root, manifest, project, operations, calls, ports, db, state: () => state }
}
test('release uses actual lifecycle migrations, deploys worker/backend/frontend, verifies version and retains immutable receipts', async () => {
  const f = await fixture()
  const result = await executePlatformOperation(f.root, 'release', {}, f.ports)
  expect(result.status).toBe('succeeded')
  expect(f.calls).toEqual(['lock', 'kamal-worker.yml', 'kamal-backend.yml', 'kamal-frontend.yml', 'unlock'])
  expect(f.db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").get()).toMatchObject({ name: 'records' })
  expect(Object.values(f.state().migrations).map(m => m.status)).toEqual(['applied'])
  const first = await readFile((result as any).receipt, 'utf8')
  expect(JSON.parse(first).lifecyclePlans).toHaveLength(1)
  await executePlatformOperation(f.root, 'release', {}, f.ports)
  expect(await readFile((result as any).receipt, 'utf8')).toBe(first)
  expect(Object.values(f.state().activations)).toEqual([])
})
test('dirty DDL stops dependent deployment and refuses automatic replay on the next release', async () => {
  const f = await fixture(); let attempts = 0
  f.project.migrate = async () => { attempts++; throw new Error('secret-sql-password') }
  await expect(executePlatformOperation(f.root, 'release', {}, f.ports)).rejects.toThrow('stopped at migrate')
  await expect(executePlatformOperation(f.root, 'release', {}, f.ports)).rejects.toThrow('stopped at migrate')
  expect(attempts).toBe(1); expect(f.calls).toEqual(['lock', 'unlock', 'lock', 'unlock'])
  for (const name of await readdir(join(f.root, '.eaos/operations'))) {
    const receipt = await readFile(join(f.root, '.eaos/operations', name), 'utf8')
    expect(receipt).not.toContain('secret-sql-password'); expect(JSON.parse(receipt).status).toBe('failed')
  }
})
test('active upgrade drains and restores existing grants only after successful versioned health', async () => {
  const f = await fixture(), manager = new PluginLifecycle(f.project)
  const request = { backendId: 'primary', tenantId: 'tenant-a', pluginId: 'plugin-a' }
  await manager.apply(await manager.plan({ ...request, operation: 'install' }))
  await manager.apply(await manager.plan({ ...request, operation: 'enable' }))
  f.project.plugins[0] = { ...f.project.plugins[0], version: '1.1.0', migrations: [...f.project.plugins[0].migrations, { id: 'append', scope: 'database', sql: { sqlite: ['ALTER TABLE records ADD COLUMN name TEXT'] } }] }
  f.project.quiesce = async () => { f.calls.push('drain') }
  f.ports.fetch = (async () => { expect(await new PluginLifecycle(f.project).isEnabled('primary', 'tenant-a', 'plugin-a')).toBe(false); return new Response(null, { headers: { 'x-eaos-release': 'v2' } }) }) as typeof fetch
  await executePlatformOperation(f.root, 'release', {}, f.ports)
  expect(f.calls).toContain('drain')
  expect(await new PluginLifecycle(f.project).isEnabled('primary', 'tenant-a', 'plugin-a')).toBe(true)
})
test('stale generation, edited inputs and failed health never produce successful deployment evidence', async () => {
  const f = await fixture()
  await writeFile(join(f.root, 'eaos.platform.json'), JSON.stringify({ ...f.manifest, platform: { ...f.manifest.platform, appName: 'changed' } }))
  await expect(executePlatformOperation(f.root, 'release', {}, f.ports)).rejects.toThrow('stale')
  expect(f.calls).toEqual(['lock', 'unlock'])
  await writeFile(join(f.root, 'eaos.platform.json'), JSON.stringify(f.manifest))
  f.ports.deploy = async () => { await writeFile(join(f.root, 'package.json'), '{"changed":true}') }
  await expect(executePlatformOperation(f.root, 'release', {}, f.ports)).rejects.toThrow('inputs changed')
  await writeFile(join(f.root, 'package.json'), '{}')
  f.ports.deploy = async () => {}
  f.ports.fetch = (async () => new Response(null, { headers: { 'x-eaos-release': 'old' } })) as typeof fetch
  await expect(executePlatformOperation(f.root, 'release', {}, f.ports)).rejects.toThrow('stopped at health')
})
test('plan does not import executable host configuration; interrupted operations keep their lock', async () => {
  const f = await fixture()
  await writeFile(join(f.root, 'eaos.operations.ts'), 'throw new Error("must never import plan")')
  expect((await planPlatformOperation(f.root, 'release')).mode).toBe('plan-only')
  await writeFile(join(f.root, '.eaos/operation.lock'), 'interrupted-release')
  await expect(executePlatformOperation(f.root, 'release', {}, f.ports)).rejects.toThrow()
  expect(await readFile(join(f.root, '.eaos/operation.lock'), 'utf8')).toBe('interrupted-release')
  expect(f.calls).toHaveLength(0)
})
test('bootstrap validates adapters and runs explicit stack before DB, identity and one-time administrator delivery', async () => {
  const f = await fixture()
  await initializePreset(f.root)
  f.operations.bootstrap = { initializeControlDatabase: async () => { f.calls.push('db') }, startIdentity: async () => { f.calls.push('identity') }, issueAdminRegistration: async () => { f.calls.push('one-time-code-delivered') } }
  f.ports.run = async (command, args) => { f.calls.push(command); expect(args).toEqual(['up', '--yes', '--non-interactive', '--stack', 'org/project/staging']) }
  await executePlatformOperation(f.root, 'bootstrap', { stack: 'org/project/staging' }, f.ports)
  expect(f.calls).toEqual(['lock', 'pulumi', 'db', 'identity', 'one-time-code-delivered', 'unlock'])
})
test('local compose starts database then identity migration then services and stops on failure', async () => {
  const f = await fixture(), calls: string[][] = []
  await upPlatform(f.root, {}, async (_command, argv) => { calls.push(argv) })
  expect(calls).toHaveLength(3); expect(calls[0].at(-1)).toBe('kratos-db'); expect(calls[1].at(-1)).toBe('kratos-migrate')
  calls.length = 0
  await expect(upPlatform(f.root, {}, async (_command, argv) => { calls.push(argv); throw new Error('failed') })).rejects.toThrow('failed')
  expect(calls).toHaveLength(1)
})

test('reviewed baseline release rebases applied history without replaying DDL and initializes fresh databases from the same target', async () => {
  const { createDataContractBaseline } = await import('@alneas/eaos-server/lifecycle-engine')
  const source = { id: 'business', version: '1.0.0', description: 'Business records', schema: { type: 'object', properties: { tenant_id: { type: 'string' }, id: { type: 'string' } }, required: ['tenant_id', 'id'], 'x-db': { tableName: 'business' } }, migrations: [{ id: '001', scope: 'database' as const, sql: { sqlite: ['CREATE TABLE business(tenant_id TEXT,id TEXT,PRIMARY KEY(tenant_id,id))'] } }, { id: '002', scope: 'database' as const, sql: { sqlite: ['CREATE INDEX business_tenant ON business(tenant_id)'] } }] }
  const baseline = createDataContractBaseline(source, '1.1.0', { sqlite: source.migrations.flatMap(m => m.sql.sqlite) })
  const f = await fixture()
  f.project.plugins[0].schemaDependencies = { business: '^1.0.0' }
  f.project.plugins[0].migrations = []
  f.project.dataContracts = [source]
  const manager = new PluginLifecycle(f.project)
  await manager.apply(await manager.plan({ operation: 'install', backendId: 'primary', tenantId: 'tenant-a', pluginId: 'plugin-a' }))
  f.project.dataContracts = [baseline.target]
  f.operations.baselines = [{ backendId: 'primary', baseline }]
  f.project.migrate = async () => { throw new Error('must never replay applied DDL') }
  await executePlatformOperation(f.root, 'release', {}, f.ports)
  expect(Object.values(f.state().baselineHistory!)).toHaveLength(1)
  expect(Object.values(f.state().migrations).some(m => m.migrationId === baseline.target.migrations[0].id)).toBe(true)
  const fresh = await fixture()
  fresh.project.plugins[0].schemaDependencies = { business: '^1.0.0' }
  fresh.project.plugins[0].migrations = []
  fresh.project.dataContracts = [baseline.target]
  fresh.operations.baselines = [{ backendId: 'primary', baseline }]
  await executePlatformOperation(fresh.root, 'release', {}, fresh.ports)
  expect(fresh.db.prepare("SELECT name FROM sqlite_schema WHERE name='business'").get()).toBeTruthy()
  expect(fresh.state().baselineHistory).toBeUndefined()
})
test('a lock adapter cannot silently skip the operation and report success', async () => {
  const f = await fixture()
  f.operations.withLock = async () => undefined as any
  await expect(executePlatformOperation(f.root, 'release', {}, f.ports)).rejects.toThrow('did not execute')
  expect(f.calls).toHaveLength(0)
})
test('release refuses changed imported host adapters inside the shared lock', async () => {
 const f = await fixture()
 await mkdir(join(f.root, 'src/operations'), { recursive: true })
 await writeFile(join(f.root, 'src/operations/host.ts'), 'export const policy = 1')
 const lock = f.ports.operations!.withLock
 f.ports.operations!.withLock = async (context, action) => lock(context, async () => {
  await writeFile(join(f.root, 'src/operations/host.ts'), 'export const policy = 2')
  return action()
 })
 await expect(executePlatformOperation(f.root, 'release', {}, f.ports)).rejects.toThrow('inputs changed')
 expect(f.calls.filter(c => c.endsWith('.yml'))).toEqual([])
})
test('existing hosts can retain verified deployment and infrastructure bindings without skipping stages', async () => {
 const f = await fixture()
 f.ports.deploy = undefined
 f.operations.deploy = async input => { expect(input.context.root.endsWith(f.root.split('/').at(-1)!)).toBe(true);expect(input.version).toBe('v2');expect(input.image).toContain(':v2');f.calls.push(input.role) }
 await executePlatformOperation(f.root, 'release', {}, f.ports)
 expect(f.calls).toEqual(['lock','worker','backend','frontend','unlock'])
 f.calls.length=0
 f.operations.bootstrap = { provisionInfrastructure: async (_context,stack) => { expect(stack).toBe('existing/dev');f.calls.push('existing-infra') }, initializeControlDatabase:async()=>{f.calls.push('db')},startIdentity:async()=>{f.calls.push('identity')},issueAdminRegistration:async()=>{f.calls.push('administrator')} }
 await executePlatformOperation(f.root,'bootstrap',{stack:'existing/dev'},f.ports)
 expect(f.calls).toEqual(['lock','existing-infra','db','identity','administrator','unlock'])
})
