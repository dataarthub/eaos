import { test, expect } from 'bun:test'
import { createPluginRouter, createStandardPluginServer, jsonBody } from '../src/plugin-data/index'

test('plugin router reports the body limit without exposing unexpected errors', async () => {
 let executions = 0
 const app = createPluginRouter(async () => ({ tenantId: 'a', userId: 'u', roles: [] }))
 app.post('/', async c => { await jsonBody(c); executions++; return c.json({ ok: true }) })
 app.get('/fail', () => { throw new Error('private provider details') })
 const body = JSON.stringify({ payload: 'x'.repeat(128 * 1024) })
 for (const headers of [{ 'Content-Type': 'application/json' }, { 'Content-Type': 'application/json', 'Content-Length': String(body.length) }]) {
  const response = await app.request('/', { method: 'POST', headers, body })
  expect(response.status).toBe(413)
  expect(await response.json()).toEqual({ error: 'Request body too large' })
 }
 expect(executions).toBe(0)
 const failure = await app.request('/fail')
 expect(failure.status).toBe(500)
 expect(await failure.json()).toEqual({ error: 'Plugin operation failed' })
})

test('standard plugin server binds the authenticated operation route and MCP tools once', async () => {
 class Service {
  constructor(readonly options: { prefix: string }) {}
  execute(principal: { tenantId: string }, operation: string, input: Record<string, unknown>) {
   return Promise.resolve({ tenantId: principal.tenantId, operation, input, prefix: this.options.prefix })
  }
 }
 const tool = { name: 'standard_echo', description: 'echo', parameters: {}, handler: async (_args: unknown, context?: { service?: Service }) => context?.service?.options.prefix }
 const plugin = createStandardPluginServer(
  { id: 'standard-test', name: 'Standard test', version: '1', description: '', icon: '', category: 'test', targets: [], dependencies: [], tier: 'free', industries: [], contracts: [], subscribes: [], publishes: [], navigation: {}, schema: {}, api: {} } as any,
  Service,
  service => [{ ...tool, handler: args => tool.handler(args, { service }) }],
  { prefix: 'ok' },
  async () => ({ tenantId: 'tenant-a', userId: 'user-a', roles: [] }),
 )
 const response = await plugin.createRoutes().request('/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 1 }) })
 expect(response.status).toBe(200)
 expect(await response.json()).toEqual({ tenantId: 'tenant-a', operation: 'run', input: { value: 1 }, prefix: 'ok' })
 expect(await plugin.mcp.tools[0].handler({})).toBe('ok')
})
