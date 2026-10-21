import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createAdminRoutes } from '../src'
test('admin explorer requires explicit catalog, role, activation and tenant; filters are bound', async () => {
 const db = new Database(':memory:'); db.exec("CREATE TABLE notes (id TEXT, tenant_id TEXT, title TEXT, secret TEXT); INSERT INTO notes VALUES ('1','alpha','A','hidden'),('2','beta','B','secret')")
 try {
  let enabled = true, auditCount = 0
  const principal = { tenantId: 'alpha', userId: 'u', roles: ['admin'] }
  const app = createAdminRoutes({ resources: [{ id: 'notes', label: 'Notes', table: 'notes', tenantColumn: 'tenant_id', keyColumn: 'id', columns: [{ name: 'id', label: 'ID', type: 'string' }, { name: 'title', label: 'Title', type: 'string' }] }], authorize: async () => enabled, audit: async () => { auditCount++ }, driver: () => ({ dialect: 'sqlite', execute: async (_tenant, sql, binds) => ({ rows: db.query(sql).all(...binds as any[]) as any[] }) }) }, async () => principal)
  const query = (body: unknown = {}) => app.request('/resources/notes/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const response = await query(); expect(await response.json()).toEqual({ rows: [{ id: '1', title: 'A' }], limit: 50, offset: 0 }); expect(auditCount).toBe(1)
  for (const input of [{ columns: ['secret'] }, { filter: { tenant_id: 'beta' } }, { sql: 'delete from notes' }, { limit: 5000 }, { filter: { "title OR 1=1": 'x' } }]) expect((await query(input)).status).toBe(400)
  expect((await app.request('/resources/unknown/schema')).status).toBe(404)
  expect((await query({ filter: { title: "' OR 1=1" } })).status).toBe(200)
  enabled = false; expect((await query()).status).toBe(403)
  enabled = true; principal.roles = ['USER']; expect((await query()).status).toBe(403)
  principal.roles = ['admin']; principal.tenantId = 'beta'; expect((await (await query()).json() as any).rows[0].title).toBe('B')
 } finally { db.close() }
})
