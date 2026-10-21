import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { Hono } from 'hono'
import { createAtomicRepository, createSqliteAtomicDriver, verifyAtomicAudit } from '../plugin-data/index'
import { createPluginAssetRouter, createPluginEntitlementGuard, PluginEntitlementRuntime } from './index'
import { createErpEngine } from '../engine'
import { PluginRegistry, McpGatekeeper, type PluginManifest } from '@alneas/eaos-core'
import { createMcpRouter } from '../mcp'
const principal = { tenantId: 't-a', userId: 'u', roles: ['member'] }
const rule = { tier: 'pro' as const, addonId: 'addon-quant', metering: { unit: 'run', defaultMonthlyQuota: 3 } }
const manifest: PluginManifest = { id: 'quant', name: 'Quant', version: '1.0.0', description: '', icon: '', category: '', targets: [], dependencies: [], tier: 'free', industries: [], contracts: [], subscribes: [], publishes: [], navigation: {}, schema: { storagePolicy: { maxPayloadBytes: 1024, objectStorage: 'optional', historyRetentionDays: null, archive: { mode: 'none' } }, ownedTables: [], externalReferences: {}, migrationOrder: 0 }, api: { prefix: '/quant' }, entitlement: rule }
test('Engine meters the prefix root exactly once and Corporate is hidden before legacy module checks', async () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE control_records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))')
  const repository = createAtomicRepository('control_records', createSqliteAtomicDriver(db))
  const runtime = new PluginEntitlementRuntime({ repository, isActive: async () => true, load: async tenantId => ({ tenantId, plan: 'pro', status: 'active', addons: ['addon-quant'] }) })
  const plugin = { ...manifest, entitlement: { ...rule, metering: { ...rule.metering, defaultMonthlyQuota: 1 } }, createRoutes: () => new Hono().get('/', c => c.text('ok')) }
  const engine = createErpEngine({ appName: 'entitlement-engine', plugins: [plugin] }); await engine.initialize()
  const app = engine.createApp({ entitlements: runtime, resolveEntitlementPrincipal: async () => principal, enableModuleGuard: false })
  expect((await app.request('/quant')).status).toBe(200)
  expect((await app.request('/quant')).status).toBe(402)
  const corp = createErpEngine({ appName: 'corporate-engine', plugins: [{ ...plugin, entitlement: { tier: 'corporate', allowedTenants: ['t-b'] } }] }); await corp.initialize()
  expect((await corp.createApp({ entitlements: runtime, resolveEntitlementPrincipal: async () => principal }).request('/quant')).status).toBe(404)
  db.close()
})
test('MCP discovery and both invocation transports share current contracts and quota', async () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE control_records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))')
  let subscribed = false, dependencies = 0, calls = 0
  const repository = createAtomicRepository('control_records', createSqliteAtomicDriver(db))
  const runtime = new PluginEntitlementRuntime({ repository, isActive: async () => true, load: async tenantId => ({ tenantId, plan: 'pro', status: 'active', addons: subscribed ? ['addon-quant'] : [] }) })
  const registry = new PluginRegistry()
  registry.register({ ...manifest, entitlement: { ...rule, metering: { ...rule.metering, defaultMonthlyQuota: 1 } }, mcp: { tools: [{ name: 'simulate', description: '', parameters: { type: 'object' }, handler: async () => { calls++; return 'ok' } }] } })
  const app = createMcpRouter({ registry, gatekeeper: new McpGatekeeper() }, { entitlements: runtime, resolvePrincipal: async () => ({ ...principal, roles: [...principal.roles], enabledPluginIds: ['quant'] }), createToolContext: async () => { dependencies++; return {} } })
  expect((await (await app.request('/tools')).json()).tools).toHaveLength(0)
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  expect((await post('/execute', { name: 'simulate', args: {} })).status).toBe(402)
  expect(dependencies).toBe(0)
  subscribed = true
  expect((await (await app.request('/tools')).json()).tools).toHaveLength(1)
  expect((await post('/execute', { name: 'simulate', args: {} })).status).toBe(200)
  const rpc = await (await post('/message', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'simulate', arguments: {} } })).json()
  expect(rpc.error.data.status).toBe(402); expect(calls).toBe(1)
  subscribed = false
  expect((await (await app.request('/tools')).json()).tools).toHaveLength(0)
  db.close()
})
test('concurrent requests reserve quota atomically with durable audit, survive runtime restart, and reset monthly', async () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE control_records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))')
  const repo = createAtomicRepository('control_records', createSqliteAtomicDriver(db))
  let active = true, subscribed = true, time = new Date('2026-10-17T00:00:00Z')
  const options = { repository: repo, clock: () => time, isActive: async () => active, load: async (tenantId: string) => ({ tenantId, plan: 'standard' as const, status: 'active' as const, addons: subscribed ? ['addon-quant'] : [] }) }
  const runtime = new PluginEntitlementRuntime(options)
  const responses = await Promise.allSettled(Array.from({ length: 8 }, () => runtime.admit(principal, 'quant', rule, 'test')))
  expect(responses.filter(r => r.status === 'fulfilled')).toHaveLength(3)
  expect((await repo.run(principal, tx => verifyAtomicAudit(tx, principal))).count).toBe(3)
  await expect(new PluginEntitlementRuntime(options).admit(principal, 'quant', rule, 'restart')).rejects.toThrow('quota-exceeded')
  await runtime.admit({ ...principal, tenantId: 't-b' }, 'quant', rule, 'foreign tenant')
  time = new Date('2026-11-01T00:00:00Z')
  await runtime.admit(principal, 'quant', rule, 'new month')
  subscribed = false
  await expect(runtime.admit(principal, 'quant', rule, 'revoked addon')).rejects.toThrow('addon-required')
  subscribed = true; active = false
  expect((await runtime.check(principal, 'quant', rule)).allowed).toBe(false)
  db.close()
})
test('metering and audit roll back together on audit failure', async () => {
  const db = new Database(':memory:')
  db.exec("CREATE TABLE control_records(tenant_id TEXT,id TEXT CHECK(id NOT LIKE 'audit/%'),revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))")
  const repository = createAtomicRepository('control_records', createSqliteAtomicDriver(db))
  const runtime = new PluginEntitlementRuntime({ repository, isActive: async () => true, load: async tenantId => ({ tenantId, plan: 'pro', status: 'active', addons: ['addon-quant'] }) })
  await expect(runtime.admit(principal, 'quant', rule, 'fail')).rejects.toThrow()
  expect(db.query('SELECT count(*) AS n FROM control_records').get()).toEqual({ n: 0 })
  db.close()
})
test('HTTP fails closed without licensing service; protected assets deny foreign tenants and post-sign revocation', async () => {
  const app = new Hono().use('*', createPluginEntitlementGuard('quant', rule, undefined, async () => principal)).get('/', c => c.text('secret'))
  expect((await app.request('/')).status).toBe(503)
  const db = new Database(':memory:')
  db.exec('CREATE TABLE control_records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))')
  let active = true, signed = 0
  const runtime = new PluginEntitlementRuntime({ repository: createAtomicRepository('control_records', createSqliteAtomicDriver(db)), isActive: async () => active, load: async () => null })
  const assets = createPluginAssetRouter({ runtime, resolvePrincipal: async () => principal, plugins: { corp: { tier: 'corporate', allowedTenants: ['t-b'] }, local: { tier: 'corporate', allowedTenants: ['t-a'] } }, assets: ['corp', 'local'].map(pluginId => ({ pluginId, id: 'model', key: 'private/model.onnx', sha256: 'a'.repeat(64), contentType: 'application/octet-stream' })), sign: async () => { signed++; active = false; return 'https://private.example/signed' } })
  expect((await assets.request('/corp/model')).status).toBe(404)
  expect(signed).toBe(0)
  expect((await assets.request('/local/model')).status).toBe(404)
  expect(signed).toBe(1)
  db.close()
})

test('unmetered Public works without subscriptions while verified principal and live lifecycle remain mandatory', async () => {
 let authenticated = true, active = true
 const plugin = { ...manifest, tier: 'public' as const, entitlement: {tier:'public' as const}, createRoutes: () => new Hono().get('/', c=>c.text('public')) }
 const engine = createErpEngine({appName:'public',plugins:[plugin]}); await engine.initialize()
 const app = engine.createApp({enableModuleGuard:false,resolveEntitlementPrincipal:async()=>authenticated?principal:null})
 expect((await app.request('/quant')).status).toBe(200)
 authenticated=false; expect((await app.request('/quant')).status).toBe(401)
 const registry = new PluginRegistry()
 registry.register({...plugin,mcp:{tools:[{name:'read_public',description:'',parameters:{type:'object'},handler:async()=> 'public'}]}})
 const mcp = createMcpRouter({registry,gatekeeper:new McpGatekeeper()},{resolvePrincipal:async()=>authenticated?{...principal,enabledPluginIds:['quant']}:null,isPluginEnabled:async()=>active})
 expect((await mcp.request('/tools')).status).toBe(401)
 authenticated=true
 expect((await (await mcp.request('/tools')).json()).tools).toHaveLength(1)
 const invoke=()=>mcp.request('/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'read_public',args:{}})})
 expect((await invoke()).status).toBe(200)
 active=false;expect((await invoke()).status).toBe(404)
 expect((await (await mcp.request('/tools')).json()).tools).toHaveLength(0)
 for(const rule of [{tier:'standard' as const},{tier:'public' as const,allowedTenants:['t-a']},{tier:'public' as const,metering:{unit:'request',defaultMonthlyQuota:1}}]){
  const restricted = new Hono().use('*',createPluginEntitlementGuard('quant',rule,undefined,async()=>principal)).get('/',c=>c.text('denied'))
  expect((await restricted.request('/')).status).toBe(503)
 }
})
test('contract reads join the quota transaction without nesting the serialized SQLite driver', async () => {
 const db = new Database(':memory:')
 db.exec('CREATE TABLE control_records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))')
 const repository = createAtomicRepository('control_records', createSqliteAtomicDriver(db))
 await repository.run(principal, tx => tx.put('contract', { tenantId: principal.tenantId, plan: 'pro', status: 'active', addons: ['addon-quant'] }, 0))
 let joined = 0
 const runtime = new PluginEntitlementRuntime({ repository, isActive: async () => true,
  load: async () => { throw Error('Reservation must read the joined contract') },
  loadInTransaction: async (p, tx) => { joined++; expect(p).toEqual(principal); return (await tx.get<any>('contract'))!.value },
 })
 try { await runtime.admit(principal, 'quant', rule, 'joined'); expect(joined).toBe(1) } finally { db.close() }
}, 2000)
