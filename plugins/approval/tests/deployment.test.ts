import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FRAMEWORK_VERSION, PluginLifecycle, type LifecycleProject, type Operation } from '@alneas/eaos-server/lifecycle-engine'
import { SqlLifecycleStore, controlSchemaSql } from '@alneas/eaos-server/sql-lifecycle'
import { createSqlRecordStore, type PluginPrincipal } from '@alneas/eaos-server/plugin-data'
import { createRoutes, lifecycle, type ApprovalDocument } from '../src'

test('approval: shared/dedicated deployments, independent control clients, retained data, upgrade and restart', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'eaos-approval-deploy-')), dbs: Database[] = []
 const open = (name: string) => { const db = new Database(join(dir, name)); dbs.push(db); return db }
 const control1 = open('control.sqlite'), control2 = open('control.sqlite')
 const shared = open('shared.sqlite'), dedicated = open('dedicated.sqlite')
 const sql = (db: Database) => async (text: string, binds: unknown[]) => text.startsWith('SELECT') ? { rows: db.query(text).all(...binds as any[]) as any[] } : { affectedRows: db.query(text).run(...binds as any[]).changes }
 try {
  control1.exec(controlSchemaSql.sqlite[0])
  const store1 = new SqlLifecycleStore({ dialect: 'sqlite', execute: sql(control1) }, 'test')
  const store2 = new SqlLifecycleStore({ dialect: 'sqlite', execute: sql(control2) }, 'test')
  await store1.initialize()
  const drained: string[][] = []
  const project: LifecycleProject = {
   store: store1,
   backends: [{ id: 'shared', databaseId: 'shared-db', mode: 'shared', dialect: 'sqlite' }, { id: 'dedicated', databaseId: 'dedicated-db', mode: 'dedicated', tenantId: 'alpha', dialect: 'sqlite' }],
   plugins: [lifecycle],
   migrate: async (step, backend) => { const db = backend.id === 'shared' ? shared : dedicated; for (const statement of step.statements) db.exec(statement) },
   // This fixture has no in-flight requests; record every affected activation to verify the host hook.
   quiesce: async activations => { drained.push(activations.map(a => a.tenantId).sort()) },
  }
  const writer = new PluginLifecycle(project), reader = new PluginLifecycle({ ...project, store: store2 })
  const change = async (manager: PluginLifecycle, operation: Operation, tenantId = 'alpha', backendId = 'shared') => manager.apply(await manager.plan({ operation, tenantId, backendId, pluginId: 'approval' }))
  for (const [backend, tenant] of [['shared','alpha'],['shared','beta'],['dedicated','alpha']]) { await change(writer, 'install', tenant, backend); await change(writer, 'enable', tenant, backend) }
  const tokens: Record<string, PluginPrincipal> = {
   'alpha-user': { tenantId: 'alpha', userId: 'requester', roles: ['member'] },
   'alpha-reviewer': { tenantId: 'alpha', userId: 'reviewer', roles: ['reviewer'] },
   'beta-user': { tenantId: 'beta', userId: 'other', roles: ['member'] },
  }
  const app = (backend: string, db: Database, manager: PluginLifecycle) => createRoutes({
  store: createSqlRecordStore<ApprovalDocument>('eaos_platform_records', { dialect: 'sqlite', execute: async (_tenant, text, binds) => sql(db)(text, binds) }, { namespace: 'approval' }),
   authorize: async (p, action) => (backend !== 'dedicated' || p.tenantId === 'alpha') && await manager.isEnabled(backend, p.tenantId, 'approval') && (action !== 'decide' || p.roles.includes('reviewer')),
   resolveTemplate: async () => ({ id: 'test', stages: [{ id: 'review', label: 'Review', roles: ['reviewer'] }] }),
  }, async c => tokens[c.req.header('Authorization')?.replace('Bearer ', '') ?? ''] ?? null)
  let sharedApp = app('shared', shared, reader)
  const dedicatedApp = app('dedicated', dedicated, reader)
  const request = (target: ReturnType<typeof app>, path: string, token: string, body?: object) => target.request(path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const input = { templateId: 'test', title: 'Deploy approval', targetType: 'note', targetId: 'one' }
  expect((await request(sharedApp, '/requests', 'unknown')).status).toBe(401)
  expect((await request(sharedApp, '/requests', 'alpha-user', { ...input, tenantId: 'beta' })).status).toBe(400)
  const response = await request(sharedApp, '/requests', 'alpha-user', input)
  expect(response.status).toBe(201); const record = await response.json() as any
  expect((await request(sharedApp, `/requests/${record.id}`, 'beta-user')).status).toBe(404)
  expect((await request(dedicatedApp, '/requests', 'beta-user')).status).toBe(403)
  expect((await request(dedicatedApp, `/requests/${record.id}`, 'alpha-user')).status).toBe(404)
  expect((await request(dedicatedApp, '/requests', 'alpha-user', input)).status).toBe(201)
  expect((await request(sharedApp, `/requests/${record.id}/decisions`, 'alpha-user', { revision: 1, action: 'approve' })).status).toBe(403)
  expect((await request(sharedApp, `/requests/${record.id}/decisions`, 'alpha-reviewer', { revision: 1, action: 'approve' })).status).toBe(200)
  await change(writer, 'disable')
  expect((await request(sharedApp, '/requests', 'alpha-user')).status).toBe(403)
  expect((await request(dedicatedApp, '/requests', 'alpha-user')).status).toBe(200)
  await change(writer, 'disable', 'beta'); await change(writer, 'uninstall')
  expect(shared.query('SELECT count(*) AS n FROM eaos_platform_records').get()).toEqual({ n: 1 })
  await change(writer, 'install'); await change(writer, 'enable')
  // A synthetic next release adds an index to the real plugin's immutable baseline.
  const previousContract = lifecycle.schemaContracts![0]
  const upgraded = { ...lifecycle, version: '2.0.1', schemaContracts: [{ ...previousContract, version: '1.1.1', migrations: [...previousContract.migrations, { id: '002-test-index', scope: 'database' as const, sql: { sqlite: ['CREATE INDEX approval_tenant_idx ON eaos_platform_records (tenant_id)'] } }] }] }
  const next = new PluginLifecycle({ ...project, store: store2, plugins: [upgraded] }, FRAMEWORK_VERSION)
  await change(next, 'update'); expect(drained.flat()).toContain('alpha')
  expect((await request(sharedApp, '/requests', 'alpha-user')).status).toBe(403)
  await change(next, 'enable')
  expect(await reader.isEnabled('shared', 'alpha', 'approval')).toBe(false) // Old release cannot serve updated data.
  const restarted = new PluginLifecycle({ ...project, store: new SqlLifecycleStore({ dialect: 'sqlite', execute: sql(open('control.sqlite')) }, 'test'), plugins: [upgraded] }, FRAMEWORK_VERSION)
  sharedApp = app('shared', open('shared.sqlite'), restarted)
  const retained = await (await request(sharedApp, `/requests/${record.id}`, 'alpha-user')).json() as any
  expect(retained.value.status).toBe('approved'); expect(retained.value.history).toHaveLength(2)
  expect(await new PluginLifecycle({ ...project, plugins: [upgraded] }, '0.2.0').isEnabled('shared', 'alpha', 'approval')).toBe(false)
  expect(shared.query("SELECT name FROM sqlite_master WHERE name = 'approval_tenant_idx'").get()).toBeTruthy()
 } finally { for (const db of dbs) db.close(); await rm(dir, { recursive: true, force: true }) }
})
