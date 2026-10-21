import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createPluginRouter, createSqlRecordStore, exactKeys, jsonBody, PluginError, type PluginPrincipal, type PluginRecordStore } from '@alneas/eaos-server/plugin-data'
import { createRoutes, lifecycle, type ApprovalDocument } from '../src'
import { FRAMEWORK_VERSION, PluginLifecycle, emptyLifecycleState, type LifecycleState } from '@alneas/eaos-server/lifecycle-engine'
import { createApprovalBinding } from '@alneas/eaos-core'
import type { Context } from 'hono'

type FieldCustomization = { display_label?: string; is_required?: boolean; is_hidden?: boolean; type?: 'string' | 'number' | 'boolean'; enum?: string[] }
interface FieldDefinition { fields: Record<string, FieldCustomization> }
const fieldsLifecycle = { id: 'field-customization', version: '0.1.0', framework: '^' + FRAMEWORK_VERSION, migrations: [{ id: '001-records', scope: 'database' as const, sql: { sqlite: ['CREATE TABLE eaos_field_definitions (tenant_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (tenant_id, id))'] } }] }
function fieldRoutes(options: { store: PluginRecordStore<FieldDefinition>; authorize: (principal: PluginPrincipal, action: 'read' | 'write', resource: string) => Promise<boolean>; resolveSchema: (principal: PluginPrincipal, resource: string) => Promise<any> }, resolvePrincipal: (c: Context) => Promise<PluginPrincipal | null>) {
 const app = createPluginRouter(resolvePrincipal)
 const getSchema = async (p: PluginPrincipal, resource: string, action: 'read' | 'write') => {
  if (!await options.authorize(p, action, resource)) throw new PluginError(403, 'Field customization access denied')
  const schema = await options.resolveSchema(p, resource)
  if (!schema || schema.type !== 'object' || !schema.properties) throw new PluginError(404, 'Resource unavailable')
  return schema
 }
 const result = (id: string, revision: number, fields: Record<string, FieldCustomization>, schema: any) => ({ id, revision, fields, schema: { ...schema, properties: { ...schema.properties, ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { ...(schema.properties[key] ?? {}), ...(value.type ? { type: value.type } : {}), ...(value.enum ? { enum: value.enum } : {}) }])) }, required: [...new Set([...(schema.required ?? []), ...Object.entries(fields).filter(([, value]) => value.is_required).map(([key]) => key)])] } })
 app.get('/resources/:id', async c => { const p = c.get('principal'), id = c.req.param('id'), schema = await getSchema(p, id, 'read'), record = await options.store.read(p.tenantId, id); return c.json(result(id, record?.revision ?? 0, record?.value.fields ?? {}, schema)) })
 app.put('/resources/:id', async c => {
  const p = c.get('principal'), id = c.req.param('id'), input = await jsonBody(c); exactKeys(input, ['revision', 'fields'])
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0 || !input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields)) throw new PluginError(400, 'Invalid fields')
  const schema = await getSchema(p, id, 'write'), fields = input.fields as Record<string, FieldCustomization>
  for (const [key, value] of Object.entries(fields)) {
   const existing = schema.properties[key]
   if (!/^[a-z][a-z0-9_]{0,62}$/.test(key) || !value || typeof value !== 'object' || (existing && value.is_required === false) || (!existing && (!/^custom_[a-z][a-z0-9_]{0,55}$/.test(key) || !['string', 'number', 'boolean'].includes(value.type ?? '')))) throw new PluginError(400, 'Invalid field')
  }
  const expected = Number(input.revision), current = await options.store.read(p.tenantId, id)
  if ((current?.revision ?? 0) !== expected) throw new PluginError(409, 'Field definition changed')
  const record = { id, revision: expected + 1, value: { fields: structuredClone(fields) } }
  if (current ? !await options.store.replace(p.tenantId, record, expected) : await options.store.create(p.tenantId, record).then(() => false)) throw new PluginError(409, 'Field definition changed')
  return c.json(result(id, record.revision, record.value.fields, schema))
 })
 return app
}

test('official plugins: lifecycle + SQLite + authenticated commands + isolation + CAS + retained data', async () => {
 const db = new Database(':memory:')
 try {
 let state: LifecycleState = emptyLifecycleState(), locked = false
 const store = { read: async () => structuredClone(state), withLock: async (fn: any) => { if (locked) throw new Error('locked'); locked = true; try { return await fn({ read: async () => structuredClone(state), write: async (s: LifecycleState) => { state = structuredClone(s) } }) } finally { locked = false } } }
 const manager = new PluginLifecycle({ store, backends: [{ id: 'shared', databaseId: 'test', mode: 'shared', dialect: 'sqlite' }], plugins: [lifecycle, fieldsLifecycle], migrate: async step => { for (const sql of step.statements) db.exec(sql) } })
 const change = async (operation: any, pluginId: string, tenantId = 'alpha') => manager.apply(await manager.plan({ operation, pluginId, backendId: 'shared', tenantId }))
 for (const id of ['approval', 'field-customization']) { await change('install', id); await change('enable', id) }
 const driver = { dialect: 'sqlite' as const, execute: async (_tenant: string, sql: string, binds: unknown[]) => {
  if (sql.startsWith('SELECT')) return { rows: db.query(sql).all(...binds as any[]) as any[] }
  return { affectedRows: db.query(sql).run(...binds as any[]).changes }
 } }
 let principal = { tenantId: 'alpha', userId: 'requester', roles: ['member'] }
 const app = createRoutes({ store: createSqlRecordStore<ApprovalDocument>('eaos_platform_records', driver, { namespace: 'approval' }), authorize: async p => manager.isEnabled('shared', p.tenantId, 'approval'), resolveTemplate: async () => ({ id: 'standard', stages: [{ id: 'review', label: 'Review', roles: ['reviewer'] }, { id: 'final', label: 'Final', userIds: ['final'] }] }), verifyBinding: async (_p, value) => value.operation === 'note.publish' }, async () => principal)
 const request = (path: string, body?: unknown, method = 'POST') => app.request(path, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
 expect((await request('/requests', { templateId: 'standard', title: 'Test', targetType: 'note', targetId: '1', tenantId: 'beta' })).status).toBe(400)
 const binding = createApprovalBinding({ tenantId: 'alpha', requestedBy: 'requester', operation: 'note.publish', target: { type: 'note', id: '1', revision: 3 }, input: { noteId: '1' }, contract: { operation: 'note.publish', version: '1.0.0', permission: 'note.publish', sideEffect: 'external', riskLevel: 'high', approvalLevel: 'L3_MANAGER', inputSchema: { type: 'object' } } })
 const created = await request('/requests', { templateId: 'standard', title: 'Test', targetType: 'note', targetId: '1', binding }); expect(created.status).toBe(201)
 const item = await created.json() as any; expect(item.value.binding.bindingHash).toBe(binding.bindingHash)
 principal.roles = ['reviewer']
 expect((await request(`/requests/${item.id}/decisions`, { revision: 1, action: 'approve' })).status).toBe(403)
 principal = { tenantId: 'alpha', userId: 'reviewer', roles: ['reviewer'] }
 const decisions = await Promise.all([1, 2].map(() => request(`/requests/${item.id}/decisions`, { revision: 1, action: 'approve' })))
 expect(decisions.map(r => r.status).sort()).toEqual([200, 409])
 principal.tenantId = 'beta'
 await change('install', 'approval', 'beta'); await change('enable', 'approval', 'beta')
 expect((await request(`/requests/${item.id}`)).status).toBe(404)
 principal = { tenantId: 'alpha', userId: 'final', roles: [] }
 expect((await request(`/requests/${item.id}/decisions`, { revision: 2, action: 'approve' })).status).toBe(200)
 const approved = await (await request(`/requests/${item.id}`)).json() as any
 expect(approved.value.status).toBe('approved')
 expect(approved.value.decisionReceipt).toMatchObject({ approvalId: item.id, tenantId: 'alpha', decision: 'approved', actorId: 'final', stageId: 'final', revision: 3, bindingHash: binding.bindingHash })
 expect(approved.value.decisionReceipt.receiptId).toBeString()
 await change('disable', 'approval')
 expect((await request(`/requests/${item.id}`)).status).toBe(403)
 await change('disable', 'approval', 'beta')
 await change('uninstall', 'approval')
 expect(db.query('SELECT count(*) AS n FROM eaos_platform_records').get()).toEqual({ n: 1 })
 const fieldApp = fieldRoutes({ store: createSqlRecordStore<FieldDefinition>('eaos_field_definitions', driver), authorize: async (p, action) => await manager.isEnabled('shared', p.tenantId, 'field-customization') && (action === 'read' || p.roles.includes('admin')), resolveSchema: async (_p, resource) => ['notes', 'fresh'].includes(resource) ? { type: 'object', properties: { title: { type: 'string', minLength: 1 } }, required: ['title'] } : null }, async () => principal)
 const put = (fields: unknown, revision = 0) => fieldApp.request('/resources/notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, fields }) })
 expect((await put({})).status).toBe(403); principal.roles = ['admin']
 expect((await put({ title: { is_required: false } })).status).toBe(400)
 expect((await put({ rogue: { type: 'string' } })).status).toBe(400)
 expect((await put({ title: { display_label: 'Name', is_hidden: true }, custom_priority: { type: 'string', enum: ['low', 'high'], is_required: true } })).status).toBe(200)
 const firstWrites = await Promise.all([1, 2].map(() => fieldApp.request('/resources/fresh', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0, fields: {} }) })))
 expect(firstWrites.map(r => r.status).sort()).toEqual([200, 409])
 const fields = await (await fieldApp.request('/resources/notes')).json() as any
 expect(fields.schema.required).toEqual(['title', 'custom_priority']); expect(fields.schema.properties.title.minLength).toBe(1)
 expect((await put({})).status).toBe(409)
 await change('disable', 'field-customization'); expect((await fieldApp.request('/resources/notes')).status).toBe(403)
 } finally { db.close() }
})
